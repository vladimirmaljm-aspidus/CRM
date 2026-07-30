"""
Multimodalni logistički planer — backend blueprint.

Namena
------
Iz zadate polazne i odredišne tačke (adresa, koordinate ili UN/LOCODE) sistem:
  1. Pronalazi najbližu komercijalnu luku i najbliži veliki aerodrom,
  2. Računa distancu i vreme za svaki od tri režima (drum-only, drum→more→drum,
     drum→vazduh→drum),
  3. Za pomorsku etapu koristi "great circle" preko realističnih waypoint-a
     (Sueckog / Panamskog kanala, Malake, Gibraltara, Rt Dobre Nade, itd),
  4. Uzima u obzir aktuelne poremećaje (Crveno more, Panama restrikcije,
     zatvoreni vazdušni prostor Rusije/Ukrajine, ...),
  5. Vraća JSON koji frontend renderuje kao mapu + timeline.

Podaci
------
  data/ports_world.json     — 1.600+ svetskih luka (UN/LOCODE, lat, lon, country)
  data/airports_world.json  — 4.500+ komercijalnih aerodroma (IATA, ICAO, lat, lon)
  data/disruptions.json     — poremećaji ruta (admin ih može ažurirati)

Endpoint-i
----------
  GET  /api/logistics/ports              lista luka (opciono ?country=, ?q=, ?near_lat=&near_lon=)
  GET  /api/logistics/airports           lista aerodroma (isti filteri)
  GET  /api/logistics/disruptions        aktivni poremećaji
  PUT  /api/logistics/disruptions        admin — replace lista poremećaja
  POST /api/logistics/plan               glavni engine — vraća multimodal plan
  POST /api/logistics/geocode            proxy do javnog Nominatim-a (rate limited)

Sve rute su zaštićene login-om (za portal — poseban blueprint, ne ovaj).
"""

import json
import math
import os
import time
import logging
from flask import Blueprint, jsonify, request, session

from utils import login_required, log_audit

logger = logging.getLogger(__name__)

logistics_bp = Blueprint('logistics_bp', __name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
PORTS_FILE = os.path.join(DATA_DIR, 'ports_world.json')
AIRPORTS_FILE = os.path.join(DATA_DIR, 'airports_world.json')
DISRUPTIONS_FILE = os.path.join(DATA_DIR, 'disruptions.json')
PORT_OPS_FILE = os.path.join(DATA_DIR, 'port_operations.json')
VESSEL_TYPES_FILE = os.path.join(DATA_DIR, 'vessel_types.json')


# ==========================================================
#  UČITAVANJE PODATAKA (jednom u memoriji, uz mtime cache)
# ==========================================================

_cache = {'ports': None, 'ports_mtime': 0, 'airports': None, 'airports_mtime': 0}

def _load_json_cached(kind, path):
    try:
        mt = os.path.getmtime(path)
    except OSError:
        return []
    if _cache[kind] is not None and _cache[kind + '_mtime'] == mt:
        return _cache[kind]
    try:
        with open(path, 'r', encoding='utf-8') as f:
            raw = json.load(f)
        data = raw.get(kind) or []
        _cache[kind] = data
        _cache[kind + '_mtime'] = mt
        return data
    except Exception:
        logger.exception(f"Failed to load {path}")
        return []

def _load_ports():     return _load_json_cached('ports', PORTS_FILE)
def _load_airports():  return _load_json_cached('airports', AIRPORTS_FILE)

def _load_port_ops():
    """Vraća (ports_map, defaults, tiers) iz port_operations.json.
    ports_map: {UNLOCODE: {name, tier, ...}}
    defaults: baseline vrednosti za nepoznate luke
    tiers: skup baseline vrednosti po tier-u
    """
    try:
        with open(PORT_OPS_FILE, 'r', encoding='utf-8') as f:
            raw = json.load(f)
        return (raw.get('ports') or {},
                (raw.get('_meta') or {}).get('defaults') or {},
                (raw.get('_meta') or {}).get('tiers') or {})
    except Exception:
        return {}, {}, {}

def _port_ops_for(unlocode):
    """Za dati UN/LOCODE vraća merged dict operativnih parametara.
    Ako luka nije eksplicitno u bazi, koristi average tier defaults."""
    ports_map, defaults, tiers = _load_port_ops()
    fallback = dict(defaults or {})
    entry = ports_map.get(unlocode or '')
    if entry:
        tier = entry.get('tier') or 'average'
        tier_defs = tiers.get(tier) or tiers.get('average') or {}
        merged = {**fallback, **tier_defs}
        # per-port override polja (ako neko doda override koji nije tier baseline)
        for k, v in entry.items():
            if k in ('name', 'tier', 'notes', 'annual_teu_millions'): continue
            merged[k] = v
        merged['_source'] = 'known_port'
        merged['_tier'] = tier
        merged['_port_name'] = entry.get('name', '')
        merged['_notes'] = entry.get('notes', '')
        return merged
    # fallback: average tier
    tier_defs = tiers.get('average') or {}
    merged = {**fallback, **tier_defs}
    merged['_source'] = 'default_average'
    merged['_tier'] = 'average'
    return merged

def _load_vessels():
    try:
        with open(VESSEL_TYPES_FILE, 'r', encoding='utf-8') as f:
            raw = json.load(f)
        return raw.get('classes', [])
    except Exception:
        return []


def _match_vessels_for_cargo(profile, sea_distance_km):
    """Vraća listu vessel klasa koje su tehnički prikladne za dati cargo
    profil, sortiranu po fitness score-u. Score kombinuje:
      - kapacitet vs teret (previše veliki brod = niski score jer košta više po toni)
      - kategoriju (dry/tanker/gas/roro/container) vs cargo container_type
      - geared status (bitno za congested/male luke bez shore cranes)
      - trans-oceanski domet (VLOC/Capesize za ultra-long distance)
    """
    vessels = _load_vessels()
    if not vessels: return []

    ct = profile.get('container_type', '').lower()
    tons = float(profile.get('weight_tons') or 0)
    is_bulk_dry = ct in ('bulk_dry', 'breakbulk', 'oog')
    is_bulk_liquid_oil = ct in ('bulk_liquid',)
    is_gas = ct in ('lng', 'lpg')
    is_container = ct in ('teu', 'feu', 'reefer', 'lcl', 'parcel')

    hits = []
    for v in vessels:
        cat = v.get('category', '')
        # kategorijski filter — bulk cargo ne ide na tankerima itd
        if is_container and cat != 'container': continue
        if is_bulk_dry and cat not in ('dry_bulk', 'specialized'): continue
        if is_bulk_liquid_oil and cat != 'tanker': continue
        if is_gas and cat != 'gas_carrier': continue

        # Kapacitet filter — brod mora imati dovoljno DWT/TEU/CBM
        dwt_max = v.get('dwt_max') or v.get('dwt_typical') or 0
        teu_max = v.get('teu_capacity') or 0
        cbm_max = v.get('cbm_capacity') or 0
        capacity_ok = False
        capacity_use = 0.0

        if cat == 'container':
            containers = profile.get('container_count') or max(1, int(tons / 20))
            # FEU zauzima 2× TEU sloter — moramo pretvoriti u TEU-ekvivalent
            # pre poređenja sa teu_capacity, inače feeder od 1000 TEU deluje
            # dovoljan za 500 FEU (u stvarnosti bi trebalo 2× više).
            teu_equiv = containers * (2 if ct == 'feu' else 1)
            if teu_max >= teu_equiv:
                capacity_ok = True
                capacity_use = teu_equiv / teu_max
        elif cat in ('dry_bulk', 'specialized'):
            if dwt_max >= tons or (v.get('id') == 'heavy_lift' and profile.get('oversize')):
                capacity_ok = True
                capacity_use = tons / max(dwt_max, 1)
        elif cat == 'tanker':
            if dwt_max >= tons:
                capacity_ok = True
                capacity_use = tons / max(dwt_max, 1)
        elif cat == 'gas_carrier':
            # Za LPG/LNG korisnik unosi volume_m3 (npr. m³ tečnosti). Ako je 0,
            # vratimo natrag jer gas carrier ne sluzi za crude/dry bulk.
            vol = profile.get('volume_m3') or 0
            if cbm_max and vol > 0 and cbm_max >= vol:
                capacity_ok = True
                capacity_use = vol / max(cbm_max, 1)
        elif cat == 'roro':
            if profile.get('oversize'):
                capacity_ok = True
                capacity_use = 0.3

        if not capacity_ok: continue

        # Score bazira se na utilization sweet-spot 40-80%.
        #  < 10%  = ogroman brod za mali teret (ekonomski loše)
        #  10-40% = pomalo veliki (score neutral)
        #  40-80% = SWEET SPOT (booster +25)
        #  80-95% = tesno (mali booster)
        #  > 95%  = na granici kapaciteta (rizično — score -15)
        score = 60
        if capacity_use >= 0.95: score -= 15
        elif 0.8 <= capacity_use < 0.95: score += 10
        elif 0.4 <= capacity_use < 0.8: score += 25    # sweet spot
        elif 0.1 <= capacity_use < 0.4: score -= 5
        elif capacity_use < 0.1: score -= 25            # brod ogroman za teret

        if v.get('geared'): score += 8                  # geared = fleksibilno na svaku luku
        if sea_distance_km and sea_distance_km > 12000 and (dwt_max or 0) < 40000:
            score -= 15                                 # mali brodovi ne za ultra-long
        if profile.get('oversize') and v.get('id') == 'heavy_lift': score += 30

        cargo_days = 0
        rate = v.get('loading_rate_tph') or 0
        if rate and tons:
            cargo_days = round((tons / rate) * 2 / 24, 2)  # utovar + istovar u danima

        hits.append({
            'id': v['id'], 'name': v['name'], 'category': cat,
            'dwt': dwt_max, 'teu': teu_max, 'cbm': cbm_max,
            'draft_m': v.get('draft_m'), 'loa_m': v.get('loa_m'), 'beam_m': v.get('beam_m'),
            'geared': v.get('geared'), 'cranes': v.get('cranes'),
            'loading_rate_tph': v.get('loading_rate_tph'),
            'discharge_rate_tph': v.get('discharge_rate_tph'),
            'typical_speed_knots': v.get('typical_speed_knots'),
            'typical_cargo': v.get('typical_cargo') or [],
            'notes': v.get('notes') or '',
            'capacity_utilization': round(capacity_use, 3),
            'estimated_load_unload_days': cargo_days,
            'fitness_score': max(0, min(100, score)),
        })

    hits.sort(key=lambda x: -x['fitness_score'])
    return hits[:5]  # top 5 candidates


def _load_disruptions():
    try:
        with open(DISRUPTIONS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f).get('disruptions', [])
    except Exception:
        return []


# ==========================================================
#  GEODETSKE FUNKCIJE
# ==========================================================

EARTH_RADIUS_KM = 6371.0088

def _haversine_km(lat1, lon1, lat2, lon2):
    """Kraćeraskloni prekomorski put u km (great circle)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(p1) * math.cos(p2) * math.sin(dlon/2)**2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))

def _great_circle_polyline(lat1, lon1, lat2, lon2, segments=64):
    """Vraća listu [(lat, lon), ...] koja opisuje great-circle liniju."""
    lat1r, lon1r, lat2r, lon2r = map(math.radians, [lat1, lon1, lat2, lon2])
    d = 2 * math.asin(math.sqrt(math.sin((lat2r-lat1r)/2)**2 +
                                math.cos(lat1r) * math.cos(lat2r) *
                                math.sin((lon2r-lon1r)/2)**2))
    if d == 0:
        return [(lat1, lon1), (lat2, lon2)]
    pts = []
    for i in range(segments + 1):
        f = i / segments
        A = math.sin((1-f)*d) / math.sin(d)
        B = math.sin(f*d) / math.sin(d)
        x = A * math.cos(lat1r) * math.cos(lon1r) + B * math.cos(lat2r) * math.cos(lon2r)
        y = A * math.cos(lat1r) * math.sin(lon1r) + B * math.cos(lat2r) * math.sin(lon2r)
        z = A * math.sin(lat1r) + B * math.sin(lat2r)
        lat = math.degrees(math.atan2(z, math.sqrt(x*x + y*y)))
        lon = math.degrees(math.atan2(y, x))
        pts.append((round(lat, 4), round(lon, 4)))
    return pts

def _polyline_length_km(points):
    total = 0.0
    for i in range(1, len(points)):
        total += _haversine_km(points[i-1][0], points[i-1][1], points[i][0], points[i][1])
    return total


# ==========================================================
#  POMORSKI WAYPOINT-I (kanali i uski prolazi)
# ==========================================================

# Ovi waypoint-i su prosečne pozicije u samim kanalima. Brod ide great-circle
# do waypoint-a, zatim great-circle od waypoint-a do sledeće tačke. Time se
# izbegava da algoritam vodi rutu preko kopna (Sinajski poluostrvo, itd).
WAYPOINTS = {
    # KANALI I USKI PROLAZI (fizičke lokacije samih kanala)
    'suez':          (30.5852, 32.2654),   # Suez Canal (Egypt)
    'panama':        (9.0819, -79.6800),   # Panama Canal (Panama)
    'bosphorus':     (41.1200, 29.0400),   # Bosphorus Strait (Türkiye)
    'gibraltar':     (35.9660, -5.5500),   # Strait of Gibraltar
    'malacca':       (1.4300, 102.8900),   # Strait of Malacca (near Singapore)
    'cape_good_hope':(-34.8500, 20.0000),  # Cape of Good Hope (South Africa)
    'cape_horn':     (-55.9833, -67.2717), # Cape Horn (South America)
    'dover':         (51.0300, 1.3500),    # Strait of Dover
    'bab_el_mandeb': (12.5800, 43.3300),   # Bab-el-Mandeb (Red Sea / Gulf of Aden)
    'kiel':          (54.3667, 10.1333),   # Kiel Canal (North Sea → Baltic)

    # OCEANSKI KORIDORI — tačke usred okeana koje sprečavaju great-circle
    # segmente da prelaze preko kopna (Iberijski poluostrvo, Skandinavija,
    # Amerika, Afrika, Južna Azija). Bez ovih tačaka polyline seče kopno.
    'n_atlantic_mid':   (45.0, -30.0),     # Sredina Sev. Atlantika (EU ↔ US East)
    'n_atlantic_east':  (48.0, -12.0),     # Ulaz u La Manš (from Atlantic)
    'gib_atlantic':     (36.0, -8.5),      # Zapadno od Gibraltara
    'medit_west':       (37.0, 4.0),       # Zapadno Sredozemlje (Balearics)
    'medit_east':       (34.0, 22.0),      # Istočno Sredozemlje (Kreta)
    'red_sea_mid':      (20.0, 38.5),      # Sredina Crvenog mora
    'arabian_sea':      (13.0, 65.0),      # Arapsko more (između Bab-al-Mandeba i Malacca)
    'bengal_bay':       (7.0, 88.0),       # Bengalski zaliv (ulaz u Malacca sa juga)
    's_china_sea':      (10.0, 112.0),     # Južno kinesko more (posle Malacca)
    'e_china_sea':      (28.0, 125.0),     # Istočno kinesko more (Japan, Koreja)
    'n_pacific_mid':    (35.0, -170.0),    # Sredina sev. Pacifika (Azija ↔ US West)
    'n_pacific_west':   (35.0, 150.0),     # Zapadno sev. Pacifik (izlaz iz E Kine)
    'n_pacific_east':   (35.0, -130.0),    # Ulaz u LA/Long Beach sa okeana
    'panama_pacific':   (7.5, -80.5),      # Ulaz u Panamu iz Pacifika
    'panama_carib':     (9.5, -78.5),      # Ulaz u Panamu iz Kariba
    'carib_east':       (18.0, -65.0),     # Karibi (istok)
    'us_east_offshore': (32.0, -73.0),     # US Ist. obala (New York, Norfolk offshore)
    's_atlantic_mid':   (-20.0, -20.0),    # Sredina Juž. Atlantika (Brazil ↔ Afrika)
    's_atlantic_east':  (-30.0, 10.0),     # J. Atlantik istok (pre Cape of Good Hope)
    'agulhas':          (-36.0, 25.0),     # Južno od Cape Agulhas (pravi južni kraj)
    's_indian_mid':     (-30.0, 60.0),     # J. Indijski okean (Afrika ↔ Australija)
    's_indian_east':    (-30.0, 100.0),    # J. Indijski okean istok (pre Malacca)
    'oceania_north':    (-8.0, 130.0),     # Sever Australije / Timor Sea
    'oceania_east':     (-25.0, 165.0),    # Istočno od Australije (Nova Kaledonija)
    'north_sea_mid':    (56.0, 3.0),       # Severno more (Rotterdam ↔ Skandinavija)
    'baltic_west':      (55.0, 12.0),      # Zapadni Baltik (za Kiel corridor)
    'english_channel':  (50.0, -1.0),      # Kanal (odmah severno od Doverа)
    'biscay':           (46.0, -6.0),      # Biskajski zaliv (Španija/Francuska Atlantik)
    'north_of_horn':    (-45.0, -65.0),    # Severno od Cape Horna (S Amerika Atlantik)
    'south_of_horn':    (-58.0, -70.0),    # Južno od Cape Horna (Atl → Pac)
    'pac_of_horn':      (-45.0, -80.0),    # Zapadno od Cape Horna (S Amerika Pacifik)
}

# Regionalna klasifikacija luke — pomaže odabir kanala/rute.
def _classify_port_region(lat, lon):
    # Sredozemlje
    if 30 <= lat <= 46 and -6 <= lon <= 36: return 'medit'
    # Zapadna Evropa / Sev. more / Baltik
    if 43 <= lat <= 71 and -12 <= lon <= 30: return 'wesn_europe'
    # US East / Karibi
    if 10 <= lat <= 50 and -100 <= lon <= -55: return 'americas_east'
    # US West / Latin Am Pacific
    if -60 <= lat <= 62 and -170 <= lon <= -100: return 'americas_west'
    # Istočna Azija (Kina/Japan/Koreja/Vijetnam)
    if -12 <= lat <= 55 and 95 <= lon <= 155: return 'east_asia'
    # J. Azija / Indija / Pakistan / Perzijski zaliv
    if 5 <= lat <= 35 and 45 <= lon <= 95: return 'south_asia_gulf'
    # Južna Afrika / južni Atlantik / j. Ind. okean
    if -40 <= lat <= 0 and -20 <= lon <= 55: return 'africa'
    # Okeanija
    if -50 <= lat <= 5 and 100 <= lon <= 180: return 'oceania'
    return 'other'


def _sea_route_waypoints(a_lat, a_lon, b_lat, b_lon, avoid=None):
    """Vraća listu waypoint imena između luke A i B. UMESTO da vraća samo kanale
    (posle čega bi great-circle segmenti sekli kopno), sada vraćamo puni koridor
    otvorenog mora: strait_ulaz → kanal → strait_izlaz → ocean_mid → cilj.

    Redosled je bitno jer se polyline crta segment-po-segment; svaki uzastopni
    par mora imati čist morski put između sebe.

    `avoid` je set imena koje treba izbeći (npr. 'suez' zbog Crvenog mora)."""
    avoid = set(avoid or [])
    ra = _classify_port_region(a_lat, a_lon)
    rb = _classify_port_region(b_lat, b_lon)
    key = frozenset({ra, rb})
    # Utvrdi u kom smeru ide korisnik da bi se koridor prikladno okrenuo.
    # Praksa: ako je 'ra' na "levoj" strani (npr. wesn_europe), koridor kreće od
    # zapada; ako je desno (east_asia), invertujemo listu na kraju.

    corridor = None

    if key == {'wesn_europe', 'east_asia'}:
        corridor = ['english_channel','biscay','gib_atlantic','gibraltar','medit_west','medit_east',
                    'suez','red_sea_mid','bab_el_mandeb','arabian_sea','bengal_bay','malacca','s_china_sea','e_china_sea']
        if 'suez' in avoid:
            corridor = ['english_channel','biscay','gib_atlantic','s_atlantic_east','agulhas','cape_good_hope',
                        's_indian_mid','s_indian_east','malacca','s_china_sea','e_china_sea']

    elif key == {'wesn_europe', 'south_asia_gulf'}:
        corridor = ['english_channel','biscay','gib_atlantic','gibraltar','medit_west','medit_east',
                    'suez','red_sea_mid','bab_el_mandeb','arabian_sea']
        if 'suez' in avoid:
            corridor = ['english_channel','biscay','gib_atlantic','s_atlantic_east','agulhas','cape_good_hope','s_indian_mid','arabian_sea']

    elif key == {'medit', 'east_asia'}:
        corridor = ['medit_east','suez','red_sea_mid','bab_el_mandeb','arabian_sea','bengal_bay','malacca','s_china_sea','e_china_sea']
        if 'suez' in avoid:
            corridor = ['medit_west','gibraltar','gib_atlantic','s_atlantic_east','agulhas','cape_good_hope','s_indian_mid','s_indian_east','malacca','s_china_sea','e_china_sea']

    elif key == {'medit', 'south_asia_gulf'}:
        corridor = ['medit_east','suez','red_sea_mid','bab_el_mandeb','arabian_sea']
        if 'suez' in avoid:
            corridor = ['medit_west','gibraltar','gib_atlantic','s_atlantic_east','agulhas','cape_good_hope','s_indian_mid','arabian_sea']

    elif key == {'medit', 'americas_east'}:
        corridor = ['medit_west','gibraltar','gib_atlantic','n_atlantic_mid','us_east_offshore']

    elif key == {'medit', 'americas_west'}:
        corridor = ['medit_west','gibraltar','gib_atlantic','n_atlantic_mid','carib_east','panama_carib','panama','panama_pacific']

    elif key == {'wesn_europe', 'americas_east'}:
        corridor = ['english_channel','biscay','n_atlantic_mid','us_east_offshore']

    elif key == {'wesn_europe', 'americas_west'}:
        corridor = ['english_channel','biscay','n_atlantic_mid','carib_east','panama_carib','panama','panama_pacific']

    elif key == {'americas_east', 'east_asia'}:
        corridor = ['us_east_offshore','carib_east','panama_carib','panama','panama_pacific','n_pacific_east','n_pacific_mid','n_pacific_west']

    elif key == {'americas_west', 'east_asia'}:
        corridor = ['n_pacific_east','n_pacific_mid','n_pacific_west']

    elif key == {'americas_east', 'south_asia_gulf'}:
        corridor = ['us_east_offshore','n_atlantic_mid','gib_atlantic','gibraltar','medit_west','medit_east','suez','red_sea_mid','bab_el_mandeb','arabian_sea']
        if 'suez' in avoid:
            corridor = ['us_east_offshore','n_atlantic_mid','s_atlantic_mid','s_atlantic_east','agulhas','cape_good_hope','s_indian_mid','arabian_sea']

    elif key == {'africa', 'east_asia'}:
        corridor = ['s_atlantic_east','agulhas','cape_good_hope','s_indian_mid','s_indian_east','malacca','s_china_sea','e_china_sea']

    elif key == {'africa', 'wesn_europe'}:
        corridor = ['s_atlantic_east','agulhas','cape_good_hope','s_atlantic_mid','gib_atlantic','biscay','english_channel']

    elif key == {'africa', 'americas_east'}:
        corridor = ['s_atlantic_east','s_atlantic_mid','us_east_offshore']

    elif key == {'oceania', 'east_asia'}:
        corridor = ['oceania_north','s_china_sea','e_china_sea']

    elif key == {'oceania', 'wesn_europe'}:
        corridor = ['oceania_east','south_of_horn','north_of_horn','s_atlantic_mid','biscay','english_channel']

    else:
        corridor = []

    # Ako je 'ra' na "istočnijoj" strani od 'rb', invertujemo koridor
    # da bi listovi bili u smeru putovanja.
    if corridor and (ra in ('east_asia','south_asia_gulf','oceania') and rb not in ('east_asia','south_asia_gulf','oceania')):
        corridor = list(reversed(corridor))
    elif corridor and ra == 'americas_west' and rb == 'americas_east':
        corridor = list(reversed(corridor))

    return corridor


# ==========================================================
#  BLIZINA — najbliža luka / aerodrom
# ==========================================================

def _nearest(entities, lat, lon, k=1, key_lat='lat', key_lon='lon'):
    """Vraća k najbližih entiteta zajedno sa distancom (km)."""
    scored = []
    for e in entities:
        d = _haversine_km(lat, lon, e[key_lat], e[key_lon])
        scored.append((d, e))
    scored.sort(key=lambda x: x[0])
    return scored[:k]


# ==========================================================
#  POREMEĆAJI — koji utiču na traženi mod?
# ==========================================================

def _active_disruptions(mode, sea_waypoints=None):
    hits = []
    for d in _load_disruptions():
        if mode not in d.get('affects', []): continue
        # Za pomorsku etapu — proveri da li ruta ide kroz waypoint pogođen restrikcijom
        if mode == 'sea' and sea_waypoints:
            if d['id'] == 'red-sea-2024' and 'suez' in sea_waypoints:
                hits.append(d)
            elif d['id'] == 'panama-drought-2024' and 'panama' in sea_waypoints:
                hits.append(d)
            else:
                # generički: ako region padne u bbox ±3° oko waypoint-a
                pass
        elif mode == 'air':
            hits.append(d)
        elif mode == 'road':
            hits.append(d)
    return hits


# ==========================================================
#  BRZINE / EMISIJE (prosečne komercijalne vrednosti)
# ==========================================================

SPEED_KMH = {
    'road': 60,       # kamion prosečno
    'sea': 33,        # ~18 čvorova prosečan brzi container ship
    'air': 830,       # 450 kt prosečno cruise
}
CO2_G_PER_TKM = {     # gram CO2 po tonskom kilometru
    'road': 62,
    'sea': 8,
    'air': 602,
}


# ==========================================================
#  KANALSKI TROSKOVI I TRANZIT
# ==========================================================
# Podaci su medijani iz javnih tarifnih raspona 2024 (Suez SCA, Panama Canal
# Authority ACP, Kiel Canal WSA). Ne zamenjuju pravu rezervaciju agenta ali
# daju red veličine tolerantan +-25%. Naplata je uglavnom kombinacija:
#   base_usd  — administrativna taksa i pilot (nezavisno od tereta)
#   per_teu   — dodatak po TEU-u kontejnera (za container ships)
#   per_ton   — dodatak po netto toni (za bulk / breakbulk / tanker)
#   transit_h — koliko sati brod provede prolazeći kanal (bez čekanja konvoja)
#   wait_h    — prosečan čekanje na konvoj / booking slot
CANAL_FEES = {
    'suez': {
        'display_name': 'Suez Canal',
        'country': 'Egypt',
        'base_usd': 80000, 'per_teu': 50, 'per_ton': 8,
        'transit_h': 14, 'wait_h': 12,
        'notes': 'SCA convoys northbound & southbound. Toll applies to net tonnage; container ships pay TEU-based surcharge.',
    },
    'panama': {
        'display_name': 'Panama Canal',
        'country': 'Panama',
        'base_usd': 90000, 'per_teu': 60, 'per_ton': 10,
        'transit_h': 10, 'wait_h': 16,
        'notes': 'ACP booking system; slots auctioned. Dry-season drought may impose draft restrictions and additional wait.',
    },
    'kiel': {
        'display_name': 'Kiel Canal',
        'country': 'Germany',
        'base_usd': 5000, 'per_teu': 4, 'per_ton': 1.2,
        'transit_h': 8, 'wait_h': 3,
        'notes': 'North Sea ↔ Baltic short-cut. Pilotage compulsory above 25 m LOA.',
    },
    'bosphorus': {
        'display_name': 'Bosphorus + Dardanelles',
        'country': 'Türkiye',
        'base_usd': 3000, 'per_teu': 0, 'per_ton': 0.3,
        'transit_h': 6, 'wait_h': 2,
        'notes': 'Montreux Convention free-passage; pilot/tugs are optional but recommended.',
    },
    # Prirodni tesnaci — nema pravog "canal fee", ali VTS i pilot su naplaćeni:
    'malacca': {
        'display_name': 'Strait of Malacca',
        'country': 'Singapore / Malaysia',
        'base_usd': 3500, 'per_teu': 0, 'per_ton': 0.2,
        'transit_h': 20, 'wait_h': 0,
        'notes': 'MSDS (Malacca Straits Dues Scheme) light-dues.',
    },
    'gibraltar':      {'display_name': 'Strait of Gibraltar',      'country': 'Spain / Morocco', 'base_usd': 0, 'per_teu': 0, 'per_ton': 0, 'transit_h': 3, 'wait_h': 0, 'notes': 'Open passage.'},
    'bab_el_mandeb':  {'display_name': 'Bab-el-Mandeb',            'country': 'Yemen / Djibouti','base_usd': 0, 'per_teu': 0, 'per_ton': 0, 'transit_h': 3, 'wait_h': 0, 'notes': 'Open passage; check piracy/geopolitical warnings.'},
    'dover':          {'display_name': 'Strait of Dover',          'country': 'UK / France',     'base_usd': 0, 'per_teu': 0, 'per_ton': 0, 'transit_h': 3, 'wait_h': 0, 'notes': 'Open passage; Dover TSS traffic scheme.'},
    'cape_good_hope': {'display_name': 'Cape of Good Hope',        'country': 'South Africa',    'base_usd': 0, 'per_teu': 0, 'per_ton': 0, 'transit_h': 24, 'wait_h': 0, 'notes': 'Open ocean cape route; adds ~10-14 days vs Suez but no toll.'},
    'cape_horn':      {'display_name': 'Cape Horn',                'country': 'Chile',           'base_usd': 0, 'per_teu': 0, 'per_ton': 0, 'transit_h': 24, 'wait_h': 0, 'notes': 'Open ocean cape route; heavy seas year-round.'},
}


def _canal_passages_for_corridor(corridor_names, profile):
    """Vraća listu {name, display_name, country, fee_usd, transit_hours, wait_hours,
    notes} za svaki kanal/tesnac koji ruta prolazi. Fee se računa po cargo profilu:
    kontejneri → base + TEU*count; bulk/tanker → base + tons.
    """
    passages = []
    ct = profile.get('container_type', '')
    teu_count = max(1, profile.get('container_count', 0)) if ct in ('teu','feu','reefer','lcl') else 0
    # Za feu se za kanalsku taksu tretira kao 2 TEU
    if ct == 'feu':
        teu_count *= 2
    tons = profile.get('weight_tons', 0)

    for name in corridor_names:
        info = CANAL_FEES.get(name)
        if not info:
            continue
        fee = float(info['base_usd'])
        if teu_count > 0:
            fee += float(info['per_teu']) * teu_count
        else:
            fee += float(info['per_ton']) * tons
        passages.append({
            'name': name,
            'display_name': info['display_name'],
            'country': info['country'],
            'fee_usd': round(fee, 0),
            'transit_hours': info['transit_h'],
            'wait_hours': info['wait_h'],
            'notes': info['notes'],
        })
    return passages


# ==========================================================
#  GLAVNI ENGINE — /api/logistics/plan
# ==========================================================

def _bad(msg, code=400):
    return jsonify({"error": msg}), code

def _resolve_point(payload_key, payload):
    """
    Iz JSON payload-a vadi origin/destination. Prihvata:
      - {"lat": .., "lon": ..}
      - {"unlocode": "RSBEG"}       (nađe u portovima)
      - {"iata": "BEG"}             (nađe u aerodromima)
      - {"address": "Beograd, RS"}  (geokodira preko Nominatim-a, keš)
    Vraća (lat, lon, label) ili (None, None, error_msg).
    """
    p = payload.get(payload_key)
    if not isinstance(p, dict):
        return None, None, f'{payload_key} missing or wrong type'
    if 'lat' in p and 'lon' in p:
        try:
            return float(p['lat']), float(p['lon']), p.get('label') or 'GPS'
        except (TypeError, ValueError):
            return None, None, f'{payload_key}: invalid lat/lon'
    if p.get('unlocode'):
        for x in _load_ports():
            if x['unlocode'].upper() == p['unlocode'].upper():
                return x['lat'], x['lon'], f"{x['name']}, {x['country']}"
        return None, None, f"{payload_key}: unknown UN/LOCODE {p['unlocode']}"
    if p.get('iata'):
        for x in _load_airports():
            if x['iata'] and x['iata'].upper() == p['iata'].upper():
                return x['lat'], x['lon'], f"{x['name']} ({x['iata']})"
        return None, None, f"{payload_key}: unknown IATA {p['iata']}"
    if p.get('address'):
        # Ne geokodiramo server-side (klijent to radi preko Nominatim-a direktno).
        # Ovde samo ako je klijent vec resolvovao lat/lon i poslao ih.
        return None, None, f'{payload_key}: address given but no lat/lon resolved'
    return None, None, f'{payload_key}: no valid identifier'


@logistics_bp.route('/api/logistics/ports', methods=['GET'])
@login_required
def list_ports():
    return _list_locations(_load_ports(), 'unlocode', 'name')

@logistics_bp.route('/api/logistics/airports', methods=['GET'])
@login_required
def list_airports():
    return _list_locations(_load_airports(), 'iata', 'name')


# Portal-friendly ekvivalenti (ne traže login sesije CRM-a, već portal token).
# Rezervisano za budućnost — trenutno portal koristi read-only, isti fajl.
@logistics_bp.route('/api/portal/logistics/ports', methods=['GET'])
def portal_list_ports():
    # Portal ports/airports su reference podaci (UN/LOCODE, IATA) — otvoreni
    # za portal read-only bez auth-a (isti podaci su i inače public).
    # Ako u budućnosti dodamo per-tenant filtriranje, ovde dolazi auth check.
    return _list_locations(_load_ports(), 'unlocode', 'name')

@logistics_bp.route('/api/portal/logistics/airports', methods=['GET'])
def portal_list_airports():
    return _list_locations(_load_airports(), 'iata', 'name')


def _list_locations(items, id_key, name_key):
    q = (request.args.get('q') or '').strip().lower()
    country = (request.args.get('country') or '').strip().upper()
    near_lat = request.args.get('near_lat')
    near_lon = request.args.get('near_lon')
    limit = min(int(request.args.get('limit', 200) or 200), 500)

    out = items
    if country:
        out = [x for x in out if (x.get('country') or '').upper() == country]
    if q:
        out = [x for x in out if q in (x.get(name_key) or '').lower()
               or q in (x.get(id_key) or '').lower()
               or q in (x.get('municipality') or x.get('city') or '').lower()]
    if near_lat and near_lon:
        try:
            la, lo = float(near_lat), float(near_lon)
            out = sorted(out, key=lambda x: _haversine_km(la, lo, x['lat'], x['lon']))
        except ValueError:
            pass
    return jsonify({"items": out[:limit], "total": len(out)})


# ==========================================================
#  OBJEDINJENA PRETRAGA (luke + aerodromi + fuzzy scoring)
#  Frontend autocomplete koristi ovaj endpoint. Vraća "hits" listu
#  sortiranu po scoring-u, sa istim shape-om za sve tipove (port/airport).
# ==========================================================

def _score_match(q, name, code, municipality):
    """Rangira koliko dobro entry odgovara upitu. Veće = bolje."""
    if not q: return 0
    q = q.lower().strip()
    name = (name or '').lower()
    code = (code or '').lower()
    muni = (municipality or '').lower()
    score = 0
    if code == q: score += 100
    if code.startswith(q): score += 50
    if q in code: score += 25
    if name == q: score += 80
    if name.startswith(q): score += 40
    if q in name: score += 20
    if muni == q: score += 30
    if muni.startswith(q): score += 15
    if q in muni: score += 10
    return score


def _do_search(payload):
    q = (payload.get('q') or '').strip()
    limit = min(int(payload.get('limit') or 12), 25)
    types = payload.get('types') or ['port', 'airport']
    country = (payload.get('country') or '').strip().upper()

    if len(q) < 1:
        return []

    hits = []
    if 'port' in types:
        for p in _load_ports():
            if country and (p.get('country') or '').upper() != country:
                continue
            s = _score_match(q, p.get('name'), p.get('unlocode'), p.get('city'))
            if s > 0:
                hits.append({
                    'type': 'port',
                    'code': p.get('unlocode', ''),
                    'name': p.get('name', ''),
                    'label': f"{p.get('name','')} ({p.get('unlocode','')})",
                    'municipality': p.get('city') or p.get('name', ''),
                    'country': p.get('country', ''),
                    'lat': p['lat'], 'lon': p['lon'],
                    'score': s,
                })
    if 'airport' in types:
        for a in _load_airports():
            if country and (a.get('country') or '').upper() != country:
                continue
            code_pref = a.get('iata') or a.get('icao') or ''
            s = _score_match(q, a.get('name'), code_pref, a.get('municipality'))
            if s > 0:
                hits.append({
                    'type': 'airport',
                    'code': code_pref,
                    'name': a.get('name', ''),
                    'label': f"{a.get('name','')} ({code_pref})",
                    'municipality': a.get('municipality') or a.get('name', ''),
                    'country': a.get('country', ''),
                    'lat': a['lat'], 'lon': a['lon'],
                    'score': s,
                })
    hits.sort(key=lambda x: (-x['score'], x['name']))
    return hits[:limit]


@logistics_bp.route('/api/logistics/search', methods=['GET'])
@login_required
def search_locations():
    payload = {
        'q': request.args.get('q', ''),
        'limit': request.args.get('limit'),
        'types': (request.args.get('types') or 'port,airport').split(','),
        'country': request.args.get('country', ''),
    }
    return jsonify({'hits': _do_search(payload)})


@logistics_bp.route('/api/portal/logistics/search', methods=['GET'])
def portal_search_locations():
    payload = {
        'q': request.args.get('q', ''),
        'limit': request.args.get('limit'),
        'types': (request.args.get('types') or 'port,airport').split(','),
        'country': request.args.get('country', ''),
    }
    return jsonify({'hits': _do_search(payload)})


# ==========================================================
#  LIVE MARKET DATA (opciono) — Baltic Dry Index, IMB Piracy, GDACS
#  Ovi feed-ovi su besplatni i javno dostupni. Cache 4h u memoriji da ne
#  bismo forsirali external hit-ove.
# ==========================================================

_market_cache = {'ts': 0, 'data': None}

def _fetch_live_market_data():
    """Vraća {baltic_dry_index, bunker_price_ifo, freight_multiplier, source}.
    freight_multiplier = 1.0 na baseline (nema podataka), skalira sea cost estimate.
    Cache 4h. Ako network fail-uje, vraća baseline."""
    now = time.time()
    if _market_cache['data'] and (now - _market_cache['ts']) < 4 * 3600:
        return _market_cache['data']

    import urllib.request as _u
    baseline = {'baltic_dry_index': None, 'bunker_price_ifo': None,
                'freight_multiplier': 1.0, 'source': 'baseline (no network)'}
    try:
        # Baltic Dry Index je slobodno dostupan preko investing.com-style feed-a
        # ali oni ne pružaju stable JSON API. Umesto toga koristimo trading-economics
        # free tier endpoint (community mirror).
        req = _u.Request(
            'https://www.trading-economics.com/commodity/baltic',
            headers={'User-Agent': 'AspidusCRM/1.0 (+logistics)'}
        )
        with _u.urlopen(req, timeout=6) as r:
            html = r.read()[:200000].decode('utf-8', 'ignore')
            # Ekstraktujemo tekst poput 'Baltic Exchange Dry Index ... 1900'
            import re as _re
            m = _re.search(r'([Bb]altic[^0-9]{0,60})([\d,]{3,6})', html)
            if m:
                idx = int(m.group(2).replace(',', ''))
                baseline['baltic_dry_index'] = idx
                # Historijski median ~1500. Skaliraj sea cost proporcionalno.
                baseline['freight_multiplier'] = round(idx / 1500, 2)
                baseline['source'] = 'trading-economics'
                _market_cache['data'] = baseline
                _market_cache['ts'] = now
                return baseline
    except Exception:
        logger.debug('live market fetch failed', exc_info=True)

    _market_cache['data'] = baseline
    _market_cache['ts'] = now
    return baseline


@logistics_bp.route('/api/logistics/market', methods=['GET'])
@login_required
def get_market_data():
    return jsonify(_fetch_live_market_data())


@logistics_bp.route('/api/portal/logistics/market', methods=['GET'])
def portal_get_market_data():
    return jsonify(_fetch_live_market_data())


@logistics_bp.route('/api/logistics/vessels', methods=['GET'])
@login_required
def list_vessels():
    """Lista svih vessel klasa iz baze. Frontend ih koristi za pregled flote
    i za manuelni override predloga na sea planu."""
    return jsonify({'classes': _load_vessels()})


@logistics_bp.route('/api/portal/logistics/vessels', methods=['GET'])
def portal_list_vessels():
    return jsonify({'classes': _load_vessels()})


@logistics_bp.route('/api/logistics/disruptions', methods=['GET'])
@login_required
def get_disruptions():
    return jsonify({"disruptions": _load_disruptions()})

@logistics_bp.route('/api/portal/logistics/disruptions', methods=['GET'])
def portal_get_disruptions():
    return jsonify({"disruptions": _load_disruptions()})


@logistics_bp.route('/api/logistics/disruptions', methods=['PUT'])
@login_required
def update_disruptions():
    if session.get('role') != 'admin':
        return jsonify({"error": "UNAUTHORIZED"}), 403
    payload = request.get_json(silent=True) or {}
    items = payload.get('disruptions')
    if not isinstance(items, list):
        return _bad('disruptions must be a list')
    try:
        with open(DISRUPTIONS_FILE, 'w', encoding='utf-8') as f:
            json.dump({"disruptions": items}, f, ensure_ascii=False, indent=2)
        log_audit('INFO', 'logistics', f'disruptions list updated ({len(items)} items)')
        return jsonify({"ok": True, "count": len(items)})
    except Exception:
        logger.exception('Failed to write disruptions')
        return jsonify({"error": "WRITE_FAILED"}), 500


@logistics_bp.route('/api/logistics/plan', methods=['POST'])
@login_required
def plan_route():
    return _do_plan()

@logistics_bp.route('/api/portal/logistics/plan', methods=['POST'])
def portal_plan_route():
    return _do_plan()


# ==========================================================
#  CARGO PROFILE — sve što je bitno za smart odabir moda
# ==========================================================

def _cargo_profile(payload):
    """Normalizuje ulaz u cargo profil. Podržava naslijeđeni cargo_tons ali
    prihvata i puni profil sa volume, kontejnerima, hazmat i deadline-om.
    Sve vrednosti su sanitizovane (klemovane na razumnim granicama)."""
    def _num(v, mn=0.0, mx=1e9, dflt=0.0):
        try:
            n = float(v)
            if n != n or n < mn or n > mx: return dflt
            return n
        except (TypeError, ValueError):
            return dflt
    def _bool(v):
        if isinstance(v, bool): return v
        return str(v).lower() in ('1','true','yes','on')

    weight_tons = _num(payload.get('cargo_tons'), 0.001, 500000, 20.0)
    volume_m3 = _num(payload.get('cargo_volume_m3'), 0.001, 500000, 0.0)
    if volume_m3 == 0.0:
        # Ako ništa nije rečeno o volume, procenimo ga iz mase (prosečno 0.6 m3/t
        # za mešovitu robu, 3 m3/t za light-weight kartone itd). Za bezbedan default
        # uzimamo 1.0 m3 po toni što odgovara medium density robi.
        volume_m3 = weight_tons * 1.0

    container_type = str(payload.get('container_type') or '').lower()
    # Prihvatamo: 'teu' (20ft), 'feu' (40ft), 'reefer' (frižider), 'lcl'
    # (less-than-container-load), 'bulk_dry', 'bulk_liquid', 'breakbulk', 'oog'
    # (out-of-gauge). Ako nije zadato, izvodimo iz veličine tereta.
    if not container_type:
        if weight_tons <= 0.5 and volume_m3 <= 2:
            container_type = 'parcel'   # < 500kg — možda direktno kurir/air
        elif weight_tons <= 18 and volume_m3 <= 30:
            container_type = 'teu'
        elif weight_tons <= 26 and volume_m3 <= 60:
            container_type = 'feu'
        elif weight_tons > 100:
            container_type = 'bulk_dry'
        else:
            container_type = 'breakbulk'

    profile = {
        'weight_tons': round(weight_tons, 3),
        'volume_m3': round(volume_m3, 3),
        'container_type': container_type,
        'perishable': _bool(payload.get('perishable')),
        'hazmat': _bool(payload.get('hazmat')),
        'oversize': _bool(payload.get('oversize')),
        'high_value': _bool(payload.get('high_value')),
        'value_usd': _num(payload.get('value_usd'), 0, 1e10, 0),
        'deadline_days': _num(payload.get('deadline_days'), 0, 365, 0),
        'container_count': int(_num(payload.get('container_count'), 0, 10000, 0)),
    }
    # Auto-flag za high_value bazirano na $/kg (>50$/kg = uglavnom air freight kandidat)
    if not profile['high_value'] and profile['value_usd'] > 0 and profile['weight_tons'] > 0:
        usd_per_kg = profile['value_usd'] / (profile['weight_tons'] * 1000)
        if usd_per_kg >= 50:
            profile['high_value'] = True
    # Broj kontejnera derived (za estimate crane moves)
    if profile['container_count'] == 0:
        if container_type == 'teu':
            profile['container_count'] = max(1, int(round(profile['weight_tons'] / 18 + 0.4)))
        elif container_type == 'feu':
            profile['container_count'] = max(1, int(round(profile['weight_tons'] / 26 + 0.4)))
    return profile


def _port_dwell_hours(port_ops, profile):
    """Vraća procenu ukupnog vremena zadržavanja u luci (utovar + istovar +
    carina) za dati profil tereta i operativne parametre luke.

    Formula je fizički zasnovana:
      - Container:  moves = container_count; hours = moves / cranes_per_h × 2
                    (× 2 jer se broji i utovar i istovar), plus customs.
      - Bulk:       hours = tons / discharge_rate × 2 + customs.
      - Breakbulk:  hours = tons / handling_rate × 2 + customs.
      - Congested luke imaju multiplier 1.4x (out of the tier_defaults).
    """
    ct = profile['container_type']
    customs = float(port_ops.get('customs_clearance_hours', 24))
    congestion = float(port_ops.get('congestion_factor', 1.0))
    dwell = 0.0
    if ct in ('teu', 'feu', 'reefer', 'lcl', 'parcel'):
        cranes = float(port_ops.get('container_crane_moves_per_hour', 25))
        moves = max(1, profile['container_count'])
        # 2 × jer se broji i utovar u polaznoj i istovar u odredišnoj luci
        dwell = (moves / cranes) * 2
        # Baseline dwell (kontejner sedi u luci) je uglavnom veći od pure handling
        # time-a — dodajemo ga kao "yard buffer".
        dwell += float(port_ops.get('container_dwell_hours', 48))
    elif ct == 'bulk_dry':
        rate = float(port_ops.get('bulk_discharge_tons_per_hour', 800))
        dwell = (profile['weight_tons'] / max(rate, 1)) * 2
        dwell += float(port_ops.get('bulk_dwell_hours', 72))
    elif ct == 'bulk_liquid':
        rate = float(port_ops.get('bulk_discharge_tons_per_hour', 1500))
        dwell = (profile['weight_tons'] / max(rate, 1)) * 2
        dwell += float(port_ops.get('bulk_dwell_hours', 60))
    elif ct in ('breakbulk', 'oog'):
        rate = float(port_ops.get('breakbulk_tons_per_hour', 120))
        dwell = (profile['weight_tons'] / max(rate, 1)) * 2
        dwell += float(port_ops.get('breakbulk_dwell_hours', 120))
    else:
        dwell = float(port_ops.get('container_dwell_hours', 48))

    total = (dwell + customs) * congestion
    return round(total, 1)


def _airport_dwell_hours(profile):
    """Airport handling: cargo cutoff (min 4h pre leta), unload (1-3h),
    customs (typical 6-8h za normal, 24h za hazmat). Bez congestion faktora
    jer airport cargo terminali retko trpe zagušenja u istoj meri kao luke."""
    handling = 4 + 2  # cutoff + unload
    if profile['hazmat']: handling += 12
    if profile['perishable']: handling += 2  # reefer chain handoff
    customs = 12 if profile['hazmat'] else 6
    return round(handling + customs, 1)


def _port_charges_breakdown(port_ops, profile, is_origin):
    """Detaljna razrada troškova u luci. Vraća listu {label, hours, cost_usd,
    description}. Suma cost_usd = ukupna procenjena naknada, suma hours = dwell.

    Podaci su srednji sektorski proseci 2024 (Drewry / UNCTAD Port Handbook).
    Kontejnerske stavke:
      THC (Terminal Handling Charge) — utovar/istovar samog kontejnera
      Doc fee — B/L izdavanje, manifest, ISPS
      Port dues — po net-ton ship-a (za kontejnere fiksni surcharge)
      Pilotage — obavezan u većini luka
      Tugs — 2 tega za veći containership
      Storage — free time 5-7 dana, posle demurrage
    """
    ct = profile.get('container_type', '')
    tons = profile.get('weight_tons', 0)
    boxes = max(1, profile.get('container_count', 0))
    is_container = ct in ('teu','feu','reefer','lcl')
    is_bulk = ct in ('bulk_dry','bulk_liquid')

    # Skalirane stope po tier-u luke. Top-tier je efikasniji ali skuplji;
    # congested je jeftiniji po satu ali čeka duže → veći ukupni trošak dwell-a.
    tier = (port_ops.get('_tier') or 'average').lower()
    tier_thc_mul = {'top_tier': 1.15, 'efficient': 1.05, 'average': 1.0, 'congested': 0.9}.get(tier, 1.0)
    tier_hour_mul = float(port_ops.get('congestion_factor', 1.0))

    op_word = 'loading' if is_origin else 'discharge'
    items = []

    if is_container:
        cranes_h = float(port_ops.get('container_crane_moves_per_hour', 25))
        thc_per_teu = 210 * tier_thc_mul  # median THC 2024
        thc_multi = 2.0 if ct == 'feu' else 1.0
        items.append({
            'label': f'THC ({op_word})', 'category': 'handling',
            'hours': round((boxes / cranes_h) * tier_hour_mul, 1),
            'cost_usd': round(thc_per_teu * thc_multi * boxes, 0),
            'description': f'{boxes}× container crane moves at {int(cranes_h)}/h',
        })
        items.append({
            'label': 'Terminal storage / yard buffer', 'category': 'storage',
            'hours': round(float(port_ops.get('container_dwell_hours', 48)) * tier_hour_mul, 1),
            'cost_usd': round(35 * boxes, 0),  # 5-7 free days included; token yard fee
            'description': 'Container yard sit-time inside free-time window',
        })
    elif is_bulk:
        rate = float(port_ops.get('bulk_discharge_tons_per_hour', 1000))
        items.append({
            'label': f'Bulk {op_word}', 'category': 'handling',
            'hours': round((tons / max(rate, 1)) * tier_hour_mul, 1),
            'cost_usd': round(3.5 * tons * tier_thc_mul, 0),  # ~$3.5/t stevedoring
            'description': f'Grabs / conveyors at {int(rate)} t/h',
        })
        items.append({
            'label': 'Silo / tank storage', 'category': 'storage',
            'hours': round(float(port_ops.get('bulk_dwell_hours', 72)) * tier_hour_mul, 1),
            'cost_usd': round(0.4 * tons, 0),
            'description': 'Silo standby fee',
        })
    else:  # breakbulk / oog / parcel
        rate = float(port_ops.get('breakbulk_tons_per_hour', 120))
        items.append({
            'label': f'Breakbulk {op_word}', 'category': 'handling',
            'hours': round((tons / max(rate, 1)) * tier_hour_mul, 1),
            'cost_usd': round(12 * tons * tier_thc_mul, 0),
            'description': f'Slings / MAFI trailers at {int(rate)} t/h',
        })
        items.append({
            'label': 'Cargo shed storage', 'category': 'storage',
            'hours': round(float(port_ops.get('breakbulk_dwell_hours', 120)) * tier_hour_mul, 1),
            'cost_usd': round(0.8 * tons, 0),
            'description': 'Warehouse standby',
        })

    # Univerzalno: port dues, pilot, tugs, doc, ISPS security
    items.append({'label': 'Port dues',        'category': 'authority', 'hours': 0,   'cost_usd': round(1200 + 6 * tons, 0),  'description': 'Harbour master fee on net tonnage'})
    items.append({'label': 'Pilotage',         'category': 'authority', 'hours': 1,   'cost_usd': 2500,                       'description': 'Compulsory pilot in most commercial ports'})
    items.append({'label': 'Tug boats (2×)',   'category': 'authority', 'hours': 1,   'cost_usd': 3800,                       'description': 'In/out tugs for berthing'})
    items.append({'label': 'ISPS security',    'category': 'authority', 'hours': 0,   'cost_usd': 350,                        'description': 'International Ship & Port Security surcharge'})
    items.append({'label': 'Documentation / B/L', 'category': 'admin',  'hours': 0,   'cost_usd': 180,                        'description': 'B/L, manifest, EDI submissions'})

    # Carina — trošak zavisi od tereta
    customs_h = float(port_ops.get('customs_clearance_hours', 24)) * tier_hour_mul
    customs_fee = 250 if not profile.get('hazmat') else 650  # hazmat dodatna dozvola
    if profile.get('high_value'):
        customs_fee += 400  # insurance broker adder
    items.append({
        'label': 'Customs clearance', 'category': 'customs',
        'hours': round(customs_h, 1), 'cost_usd': customs_fee,
        'description': 'Import/export declaration, duty assessment' + (' + hazmat DGD' if profile.get('hazmat') else ''),
    })

    return items


def _sum_port_breakdown(items):
    return {
        'total_hours': round(sum(i['hours'] for i in items), 1),
        'total_cost_usd': round(sum(i['cost_usd'] for i in items), 0),
        'items': items,
    }


# ==========================================================
#  MOD FITNESS SCORING — koja je od 3 opcije NAJPAMETNIJA
#  za DATI cargo profil? Vraća score + human-readable razloge.
# ==========================================================

def _mode_fitness(mode, profile, plan):
    """Vraća (score, reasons_list). Score je 0-100. Viši = bolji fit
    za dati cargo profil. Reasons su UI-friendly stringovi."""
    reasons = []
    score = 50  # baseline
    wt = profile['weight_tons']
    vol = profile['volume_m3']

    if mode == 'air':
        # Air je optimalno za mali brz teret. Skalira loše sa masom.
        if wt <= 0.5:
            score += 30; reasons.append(f'Very light cargo ({wt} t) — air is standard.')
        elif wt <= 5:
            score += 20; reasons.append(f'Light cargo ({wt} t) fits well in air cargo.')
        elif wt <= 30:
            score -= 10; reasons.append(f'Cargo weight ({wt} t) approaches air freight cost efficiency limit.')
        else:
            score -= 30; reasons.append(f'Cargo weight ({wt} t) is too heavy for cost-effective air freight.')
        if profile['perishable']:
            score += 25; reasons.append('Perishable cargo — air minimizes transit time.')
        if profile['high_value']:
            score += 15; reasons.append('High-value shipment — air reduces insurance exposure.')
        if profile['deadline_days'] and profile['deadline_days'] <= 5:
            score += 20; reasons.append(f'Tight deadline ({int(profile["deadline_days"])}d) — only air can meet it reliably.')
        if profile['hazmat']:
            score -= 15; reasons.append('Hazmat restrictions apply to air cargo — extra documentation.')
        if profile['oversize'] or vol > 100:
            score -= 20; reasons.append('Oversized cargo — special charter needed.')

    elif mode == 'sea':
        # Sea je optimalno za velike količine, tolerantno na trajanje.
        if wt >= 10:
            score += 25; reasons.append(f'Bulk / container-friendly volume ({wt} t) — sea is most cost-effective.')
        elif wt >= 2:
            score += 10; reasons.append(f'Consolidatable cargo ({wt} t) fits well in LCL/FCL.')
        else:
            score -= 15; reasons.append(f'Small cargo ({wt} t) — LCL surcharges may make sea uneconomical.')
        if profile['perishable']:
            score -= 15; reasons.append('Perishable — sea transit exceeds shelf life unless reefer container is used.')
        if profile['deadline_days'] and profile['deadline_days'] <= 10:
            score -= 20; reasons.append(f'Deadline of {int(profile["deadline_days"])}d is aggressive for sea freight.')
        if profile['deadline_days'] and profile['deadline_days'] > 30:
            score += 15; reasons.append('Ample lead time — sea maximizes savings.')
        if profile['hazmat']:
            score -= 5; reasons.append('Hazmat manageable in dedicated ISO tanks or IMO classes.')
        if profile['oversize']:
            score += 10; reasons.append('Oversized / breakbulk cargo — sea handles it natively.')

    elif mode == 'road':
        # Road je optimalno za srednje distance, jedan continent, brzo za < 24t
        if plan['total_distance_km'] <= 800:
            score += 25; reasons.append(f'Short leg ({int(plan["total_distance_km"])} km) — road is fastest end-to-end.')
        elif plan['total_distance_km'] <= 2500:
            score += 10; reasons.append(f'Regional distance ({int(plan["total_distance_km"])} km) — road remains competitive.')
        elif plan['total_distance_km'] <= 5000:
            score -= 15; reasons.append(f'Long distance ({int(plan["total_distance_km"])} km) — driver hours and fuel add cost.')
        else:
            score -= 30; reasons.append(f'Distance ({int(plan["total_distance_km"])} km) exceeds practical road transit.')
        if wt > 24:
            score -= 15; reasons.append(f'Cargo weight ({wt} t) exceeds single-trailer capacity — multiple trucks required.')
        if profile['perishable'] and plan['total_days'] <= 3:
            score += 10; reasons.append('Perishable — road is fine at this distance with a reefer trailer.')
        if profile['hazmat']:
            score -= 5; reasons.append('ADR-compliant driver and vehicle required.')

    score = max(0, min(100, score))
    return score, reasons


def _pick_trailer(profile):
    """Bira tip prikolice/kamiona iz cargo profila. Vraća dict sa nazivom,
    tipičnom kapacitetom, i posebnim uslovima."""
    ct = profile.get('container_type', '')
    if profile.get('perishable'):
        return {'kind': 'reefer_trailer', 'display_name': 'Reefer trailer (13.6 m)',
                'capacity_tons': 24, 'volume_m3': 66,
                'notes': 'Temperature-controlled -25 °C to +25 °C. Genset fuel adds ~$60/day.'}
    if profile.get('hazmat'):
        return {'kind': 'adr_curtain', 'display_name': 'ADR-compliant curtain-side (13.6 m)',
                'capacity_tons': 24, 'volume_m3': 92,
                'notes': 'ADR driver certification, orange plates, DGD documentation.'}
    if profile.get('oversize') or ct == 'oog':
        return {'kind': 'lowloader', 'display_name': 'Low-loader / step-deck (13.6-16 m)',
                'capacity_tons': 40, 'volume_m3': 0,
                'notes': 'Requires abnormal-load permits, escort in some jurisdictions.'}
    if ct == 'bulk_liquid':
        return {'kind': 'tanker', 'display_name': 'ISO tank container / road tanker',
                'capacity_tons': 26, 'volume_m3': 33,
                'notes': 'Cleaning certificate required between different products.'}
    if ct == 'bulk_dry':
        return {'kind': 'tipper', 'display_name': 'Tipper / walking-floor trailer (13.6 m)',
                'capacity_tons': 25, 'volume_m3': 70,
                'notes': 'Discharges by tipping or moving floor.'}
    if ct in ('teu', 'feu', 'reefer', 'lcl'):
        return {'kind': 'container_chassis', 'display_name': "Container chassis (20'/40'/45')",
                'capacity_tons': 26, 'volume_m3': 76,
                'notes': 'Chassis matches box type; twist-locks mandatory.'}
    return {'kind': 'curtain_ftl', 'display_name': 'Curtain-side FTL (13.6 m)',
            'capacity_tons': 24, 'volume_m3': 92,
            'notes': 'Standard EU 13.6 m tautliner; 33 EUR pallets.'}


def _road_cost_breakdown(distance_km, profile, is_cross_border):
    """Detaljna razrada cene drumskog transporta. Vraća listu {label, cost_usd,
    description}. Suma = total road cost. Realni prosek EU 2024:
      Fuel:     ~$0.55/km (diesel 1.6 EUR/L @ 30 L/100 km × 1.08 USD/EUR)
      Driver:   ~$0.35/km (mid-range EU driver salary + per-diem)
      Tolls:    ~$0.15/km EU average
      Insurance & permit: fixed per trip
      Border:   ~$150-400 per crossing (documentation + wait)
    """
    trucks = max(1, int((profile['weight_tons'] + 23) // 24))
    trailer = _pick_trailer(profile)
    items = []
    fuel_per_km = 0.55 * (1.20 if trailer['kind'] == 'reefer_trailer' else 1.0)  # reefer troši više
    items.append({'label': f'Fuel × {trucks} truck(s)', 'category': 'fuel',
                  'cost_usd': round(fuel_per_km * distance_km * trucks, 0),
                  'description': f'Diesel ~30 L/100 km × 1.60 €/L{" (reefer +20%)" if trailer["kind"] == "reefer_trailer" else ""}'})
    items.append({'label': f'Driver wages × {trucks}', 'category': 'labor',
                  'cost_usd': round(0.35 * distance_km * trucks, 0),
                  'description': 'EU tariff incl. per-diem, weekly rest'})
    items.append({'label': 'Road tolls', 'category': 'infrastructure',
                  'cost_usd': round(0.15 * distance_km * trucks, 0),
                  'description': 'Highway tolls (EU AT/DE/HU/FR average)'})
    items.append({'label': 'Insurance & CMR', 'category': 'admin',
                  'cost_usd': 120 * trucks,
                  'description': 'CMR waybill + carrier liability'})
    if trailer['kind'] == 'reefer_trailer':
        days_est = distance_km / (60 * 12) + 1  # driving days assuming 12h drive/day
        items.append({'label': 'Reefer genset diesel', 'category': 'fuel',
                      'cost_usd': round(60 * days_est * trucks, 0),
                      'description': 'Refrigeration unit fuel'})
    if profile.get('hazmat'):
        items.append({'label': 'ADR surcharge', 'category': 'admin',
                      'cost_usd': 220 * trucks,
                      'description': 'ADR handling + DGD, orange plates, escort risk fee'})
    if profile.get('oversize'):
        items.append({'label': 'Oversize permit + escort', 'category': 'permit',
                      'cost_usd': round(900 * trucks, 0),
                      'description': 'Abnormal-load permit + police escort in EU'})
    if is_cross_border:
        borders = 1 if distance_km <= 1500 else 2 if distance_km <= 3500 else 3
        items.append({'label': f'Border crossings × {borders}', 'category': 'customs',
                      'cost_usd': 280 * borders * trucks,
                      'description': 'Customs broker, wait time, docs'})
    return {'trailer': trailer, 'trucks_needed': trucks,
            'total_cost_usd': round(sum(i['cost_usd'] for i in items), 0),
            'items': items}


def _pick_aircraft(profile, air_km):
    """Bira tip aviona za teret."""
    wt = profile.get('weight_tons', 0)
    if wt <= 0.5 and air_km <= 4000:
        return {'kind': 'belly_narrow', 'display_name': 'Passenger belly (A320/B737)',
                'capacity_tons': 3, 'notes': 'Cargo in passenger flight belly. Limited to ~3 t / narrow ULD.'}
    if wt <= 20 and air_km <= 8000:
        return {'kind': 'belly_wide', 'display_name': 'Passenger belly wide-body (A330/B777)',
                'capacity_tons': 20, 'notes': 'Cargo in wide-body passenger belly. LD-3/LD-6 ULD.'}
    if wt <= 45:
        return {'kind': 'freighter_narrow', 'display_name': 'Freighter narrow-body (B737-800F, A321F)',
                'capacity_tons': 45, 'notes': 'Dedicated freighter. Main-deck ULD access.'}
    if wt <= 100:
        return {'kind': 'freighter_wide', 'display_name': 'Freighter wide-body (B777F, B747-8F)',
                'capacity_tons': 100, 'notes': 'Long-range wide-body freighter with nose door on some variants.'}
    return {'kind': 'freighter_ana', 'display_name': 'Special freighter (An-124, B747F)',
            'capacity_tons': 250, 'notes': 'Very heavy / OOG cargo. Charter market.'}


def _air_cost_breakdown(distance_km, profile):
    """Air cargo troškovi razdvojeni po stavkama. Realni prosek 2024:
      Cargo rate ~ 2.50-4.50 $/kg intercontinental (uzimamo 3.20 base)
      Fuel surcharge ~ 0.55 $/kg (varijabilna po jet fuel indeksu)
      Security fee (100% X-ray) ~ 0.15 $/kg
      Terminal handling (origin+destination) ~ 0.35 $/kg
      Customs broker fee ~ $180 flat
      Insurance ~ 0.3% cargo value
    """
    kg = profile['weight_tons'] * 1000
    aircraft = _pick_aircraft(profile, distance_km)
    dist_factor = 1.0 + max(0, (distance_km - 3000) / 10000) * 0.3
    items = []
    items.append({'label': 'Air cargo base rate', 'category': 'freight',
                  'cost_usd': round(3.20 * kg * dist_factor, 0),
                  'description': f'IATA TACT median × distance factor {round(dist_factor,2)}'})
    items.append({'label': 'Fuel surcharge (FSC)', 'category': 'fuel',
                  'cost_usd': round(0.55 * kg, 0),
                  'description': 'Jet fuel index adjustment'})
    items.append({'label': 'Security screening', 'category': 'admin',
                  'cost_usd': round(0.15 * kg, 0),
                  'description': '100% cargo X-ray or ETD'})
    items.append({'label': 'Terminal handling (2×)', 'category': 'handling',
                  'cost_usd': round(0.35 * kg, 0),
                  'description': 'Origin + destination cargo terminals'})
    items.append({'label': 'Customs broker', 'category': 'customs',
                  'cost_usd': 180, 'description': 'Import declaration filing'})
    if profile.get('high_value') and profile.get('value_usd'):
        items.append({'label': 'Cargo insurance', 'category': 'admin',
                      'cost_usd': round(0.003 * profile['value_usd'], 0),
                      'description': '0.3% of declared value'})
    if profile.get('hazmat'):
        items.append({'label': 'DGR handling (IATA)', 'category': 'admin',
                      'cost_usd': 350, 'description': 'Dangerous Goods regulations surcharge'})
    if profile.get('perishable'):
        items.append({'label': 'Cool chain / reefer', 'category': 'handling',
                      'cost_usd': round(0.20 * kg, 0),
                      'description': 'Cold storage at both terminals'})
    return {'aircraft': aircraft,
            'total_cost_usd': round(sum(i['cost_usd'] for i in items), 0),
            'items': items}


def _cost_estimate_usd(mode, plan, profile):
    """Vrlo okvirno: koristi javne tarifne prosečne cene (per kg-km ili
    ton-km) da bi korisnik dobio red veličine. NE zamenjuje pravi tender.
    Izvor: DHL / MAERSK / IATA public rate cards 2024 median.
      - Air:  1.80-4.50 $/kg (uzimamo 3.00 $/kg average za intercontinental)
      - Sea container FCL:  ~2500-4000 $/TEU intercontinental (uzimamo 3200 avg)
      - Sea LCL:  ~40-80 $/CBM (uzimamo 60 $/CBM)
      - Road:   ~1.20-2.20 $/km per FTL (uzimamo 1.60 $/km × distance)
    """
    wt_kg = profile['weight_tons'] * 1000
    if mode == 'air':
        # Rate scaled po distanci (dulja = malo skuplje)
        base = 3.0
        dist_factor = 1.0 + max(0, (plan['total_distance_km'] - 3000) / 10000) * 0.3
        return round(base * dist_factor * wt_kg, 0)
    if mode == 'sea':
        ct = profile['container_type']
        # Baltic Dry Index utiče na bulk freight cene. Za container tržište
        # analog je SCFI ali za sada uzimamo isti multiplier.
        try:
            mkt = _fetch_live_market_data()
            m = float(mkt.get('freight_multiplier') or 1.0)
        except Exception:
            m = 1.0
        if ct in ('teu', 'feu', 'reefer'):
            per_container = 3200 if ct == 'teu' else 4200 if ct == 'feu' else 5200
            return round(per_container * max(1, profile['container_count']) * m, 0)
        elif ct == 'lcl' or profile['volume_m3'] < 15:
            return round(60 * max(1, profile['volume_m3']) * m, 0)
        else:
            # bulk: ~40 $/ton port-to-port, direktno skalirano BDI-jem
            return round(40 * profile['weight_tons'] * m, 0)
    if mode == 'road':
        # 1.60 $/km × trucks needed
        trucks = max(1, int((profile['weight_tons'] + 23) // 24))
        return round(1.6 * plan['total_distance_km'] * trucks, 0)
    return 0


def _do_plan():
    payload = request.get_json(silent=True) or {}
    o_lat, o_lon, o_lbl = _resolve_point('origin', payload)
    if o_lat is None: return _bad(o_lbl)
    d_lat, d_lon, d_lbl = _resolve_point('destination', payload)
    if d_lat is None: return _bad(d_lbl)

    profile = _cargo_profile(payload)
    cargo_tons = profile['weight_tons']
    prefer = (payload.get('prefer') or 'auto').lower()

    plans = []

    # --- 1. ROAD ONLY -----------------------------------------------------
    d_road = _haversine_km(o_lat, o_lon, d_lat, d_lon)
    road_ok = d_road < 6000
    if road_ok:
        d_road_actual = d_road * 1.3
        # Broj kamiona (24t FTL kapacitet). Vreme se ne povećava linearno sa
        # brojem kamiona — svi voze paralelno.
        trucks_needed = max(1, int((cargo_tons + 23) // 24))
        hours = d_road_actual / SPEED_KMH['road']
        # Border crossing overhead (5h EU intra, 8h EU-non-EU, 24h transit sa carinom)
        border_h = 8 if d_road_actual > 800 else 0
        total_h = hours + border_h
        co2_t = d_road_actual * cargo_tons * CO2_G_PER_TKM['road'] / 1_000_000
        road_breakdown = _road_cost_breakdown(d_road_actual, profile, is_cross_border=(border_h > 0))

        plan_road = {
            'mode': 'road',
            'label': 'Road only (truck)',
            'legs': [{
                'kind': 'road',
                'from_label': o_lbl, 'to_label': d_lbl,
                'from': [o_lat, o_lon], 'to': [d_lat, d_lon],
                'polyline': _great_circle_polyline(o_lat, o_lon, d_lat, d_lon, segments=24),
                'distance_km': round(d_road_actual, 1),
                'hours': round(hours, 1),
                'trucks_needed': trucks_needed,
                'border_crossing_hours': border_h,
                'trailer_type': road_breakdown['trailer'],
                'cost_breakdown_items': road_breakdown['items'],
                'cost_breakdown_total': road_breakdown['total_cost_usd'],
            }],
            'total_distance_km': round(d_road_actual, 1),
            'total_hours': round(total_h, 1),
            'total_days': round(total_h / 24, 2),
            'co2_tons': round(co2_t, 3),
            'warnings': [],
        }
        score, reasons = _mode_fitness('road', profile, plan_road)
        plan_road['fitness_score'] = score
        plan_road['fitness_reasons'] = reasons
        plan_road['estimated_cost_usd'] = road_breakdown['total_cost_usd']
        plan_road['cost_breakdown_usd'] = {'road_freight': road_breakdown['total_cost_usd']}
        plans.append(plan_road)

    # --- 2. ROAD → SEA → ROAD --------------------------------------------
    ports = _load_ports()
    n_o_port = _nearest(ports, o_lat, o_lon, k=1)[0] if ports else None
    n_d_port = _nearest(ports, d_lat, d_lon, k=1)[0] if ports else None
    if n_o_port and n_d_port:
        d_op, p_o = n_o_port
        d_dp, p_d = n_d_port
        land_o_km = d_op * 1.3
        land_d_km = d_dp * 1.3

        avoid = set()
        raw_wps = _sea_route_waypoints(p_o['lat'], p_o['lon'], p_d['lat'], p_d['lon'])
        if 'suez' in raw_wps:
            for dis in _load_disruptions():
                if dis['id'] == 'red-sea-2024' and dis.get('severity') in ('high', 'critical'):
                    avoid.add('suez')
        wps = _sea_route_waypoints(p_o['lat'], p_o['lon'], p_d['lat'], p_d['lon'], avoid=avoid)

        chain = [(p_o['lat'], p_o['lon'])]
        for name in wps:
            chain.append(WAYPOINTS[name])
        chain.append((p_d['lat'], p_d['lon']))
        sea_poly = []
        for i in range(1, len(chain)):
            seg = _great_circle_polyline(chain[i-1][0], chain[i-1][1], chain[i][0], chain[i][1], segments=32)
            if sea_poly and sea_poly[-1] == seg[0]: seg = seg[1:]
            sea_poly.extend(seg)
        sea_km = _polyline_length_km(sea_poly)

        # Per-luka dwell time + detaljni cost breakdown
        origin_ops = _port_ops_for(p_o.get('unlocode'))
        dest_ops = _port_ops_for(p_d.get('unlocode'))
        origin_breakdown = _sum_port_breakdown(_port_charges_breakdown(origin_ops, profile, is_origin=True))
        dest_breakdown = _sum_port_breakdown(_port_charges_breakdown(dest_ops, profile, is_origin=False))
        h_dwell_origin = origin_breakdown['total_hours']
        h_dwell_dest = dest_breakdown['total_hours']
        h_port_dwell = h_dwell_origin + h_dwell_dest

        # Kanalski troškovi + tranzit vreme
        canal_passages = _canal_passages_for_corridor(wps, profile)
        h_canal_transit = sum(cp['transit_hours'] + cp['wait_hours'] for cp in canal_passages)
        canal_cost_total = sum(cp['fee_usd'] for cp in canal_passages)

        h_road_o = land_o_km / SPEED_KMH['road']
        h_sea = sea_km / SPEED_KMH['sea']
        h_road_d = land_d_km / SPEED_KMH['road']
        # Sea leg vreme uključuje čist plov + kanalske tranzite (SPEED_KMH['sea']
        # je open-ocean brzina, brod dramatično usporava kroz kanal)
        total_h = h_road_o + h_sea + h_canal_transit + h_port_dwell + h_road_d
        total_km = land_o_km + sea_km + land_d_km
        co2_t = (
            land_o_km * cargo_tons * CO2_G_PER_TKM['road'] +
            sea_km * cargo_tons * CO2_G_PER_TKM['sea'] +
            land_d_km * cargo_tons * CO2_G_PER_TKM['road']
        ) / 1_000_000

        active_dis = [dis for dis in _load_disruptions()
                      if 'sea' in dis.get('affects', []) and
                      ((dis['id'] == 'red-sea-2024' and 'cape_good_hope' in wps) or
                       (dis['id'] == 'panama-drought-2024' and 'panama' in wps))]

        plan_sea = {
            'mode': 'sea',
            'label': 'Truck → Sea → Truck',
            'legs': [
                {
                    'kind': 'road',
                    'from_label': o_lbl, 'to_label': f"{p_o['name']} port ({p_o['unlocode']})",
                    'from': [o_lat, o_lon], 'to': [p_o['lat'], p_o['lon']],
                    'polyline': _great_circle_polyline(o_lat, o_lon, p_o['lat'], p_o['lon'], segments=16),
                    'distance_km': round(land_o_km, 1),
                    'hours': round(h_road_o, 1),
                    'trucks_needed': max(1, int((cargo_tons + 23) // 24)),
                },
                {
                    'kind': 'sea',
                    'from_label': f"{p_o['name']} port", 'to_label': f"{p_d['name']} port",
                    'from': [p_o['lat'], p_o['lon']], 'to': [p_d['lat'], p_d['lon']],
                    'polyline': sea_poly,
                    'via_waypoints': wps,
                    'distance_km': round(sea_km, 1),
                    'hours': round(h_sea, 1),
                    'canal_transit_hours': round(h_canal_transit, 1),
                    'canal_cost_usd': canal_cost_total,
                    'canal_passages': canal_passages,
                    'port_dwell_hours': round(h_port_dwell, 1),
                    'origin_port': {
                        'unlocode': p_o.get('unlocode'),
                        'name': p_o.get('name'),
                        'country': p_o.get('country'),
                        'tier': origin_ops.get('_tier'),
                        'dwell_hours': round(h_dwell_origin, 1),
                        'charges_usd': origin_breakdown['total_cost_usd'],
                        'charges_breakdown': origin_breakdown['items'],
                        'notes': origin_ops.get('_notes') or '',
                    },
                    'destination_port': {
                        'unlocode': p_d.get('unlocode'),
                        'name': p_d.get('name'),
                        'country': p_d.get('country'),
                        'tier': dest_ops.get('_tier'),
                        'dwell_hours': round(h_dwell_dest, 1),
                        'charges_usd': dest_breakdown['total_cost_usd'],
                        'charges_breakdown': dest_breakdown['items'],
                        'notes': dest_ops.get('_notes') or '',
                    },
                },
                {
                    'kind': 'road',
                    'from_label': f"{p_d['name']} port", 'to_label': d_lbl,
                    'from': [p_d['lat'], p_d['lon']], 'to': [d_lat, d_lon],
                    'polyline': _great_circle_polyline(p_d['lat'], p_d['lon'], d_lat, d_lon, segments=16),
                    'distance_km': round(land_d_km, 1),
                    'hours': round(h_road_d, 1),
                    'trucks_needed': max(1, int((cargo_tons + 23) // 24)),
                },
            ],
            'total_distance_km': round(total_km, 1),
            'total_hours': round(total_h, 1),
            'total_days': round(total_h / 24, 2),
            'co2_tons': round(co2_t, 3),
            'warnings': active_dis,
        }
        score, reasons = _mode_fitness('sea', profile, plan_sea)
        plan_sea['fitness_score'] = score
        plan_sea['fitness_reasons'] = reasons
        # Ukupno = sea freight + port fees (obe strane) + canal tolls + road za pre/post
        sea_freight = _cost_estimate_usd('sea', plan_sea, profile)
        road_pre_post = _cost_estimate_usd('road',
            {'total_distance_km': land_o_km + land_d_km}, profile)
        plan_sea['estimated_cost_usd'] = round(
            sea_freight + road_pre_post +
            origin_breakdown['total_cost_usd'] + dest_breakdown['total_cost_usd'] +
            canal_cost_total, 0)
        plan_sea['cost_breakdown_usd'] = {
            'sea_freight': sea_freight,
            'road_pre_and_post': road_pre_post,
            'port_origin': origin_breakdown['total_cost_usd'],
            'port_destination': dest_breakdown['total_cost_usd'],
            'canal_tolls': canal_cost_total,
        }
        # Predloži tipove brodova koji su tehnički prikladni za ovaj cargo profil
        plan_sea['vessel_recommendations'] = _match_vessels_for_cargo(profile, sea_km)
        plans.append(plan_sea)

    # --- 3. ROAD → AIR → ROAD --------------------------------------------
    airports = _load_airports()
    n_o_air = _nearest(airports, o_lat, o_lon, k=1)[0] if airports else None
    n_d_air = _nearest(airports, d_lat, d_lon, k=1)[0] if airports else None
    if n_o_air and n_d_air:
        d_oa, a_o = n_o_air
        d_da, a_d = n_d_air
        land_o_km = d_oa * 1.3
        land_d_km = d_da * 1.3
        air_poly = _great_circle_polyline(a_o['lat'], a_o['lon'], a_d['lat'], a_d['lon'], segments=48)
        air_km = _polyline_length_km(air_poly)
        h_road_o = land_o_km / SPEED_KMH['road']
        h_air = air_km / SPEED_KMH['air']
        h_air_dwell = _airport_dwell_hours(profile)
        h_road_d = land_d_km / SPEED_KMH['road']
        total_h = h_road_o + h_air + h_air_dwell + h_road_d
        total_km = land_o_km + air_km + land_d_km
        co2_t = (
            land_o_km * cargo_tons * CO2_G_PER_TKM['road'] +
            air_km * cargo_tons * CO2_G_PER_TKM['air'] +
            land_d_km * cargo_tons * CO2_G_PER_TKM['road']
        ) / 1_000_000

        active_dis = [d for d in _load_disruptions() if 'air' in d.get('affects', [])]

        # Detaljni breakdown-i
        air_breakdown = _air_cost_breakdown(air_km, profile)
        road_o_bd = _road_cost_breakdown(land_o_km, profile, is_cross_border=False)
        road_d_bd = _road_cost_breakdown(land_d_km, profile, is_cross_border=False)

        plan_air = {
            'mode': 'air',
            'label': 'Truck → Air Cargo → Truck',
            'legs': [
                {
                    'kind': 'road',
                    'from_label': o_lbl, 'to_label': f"{a_o['name']} ({a_o['iata'] or a_o['icao']})",
                    'from': [o_lat, o_lon], 'to': [a_o['lat'], a_o['lon']],
                    'polyline': _great_circle_polyline(o_lat, o_lon, a_o['lat'], a_o['lon'], segments=16),
                    'distance_km': round(land_o_km, 1),
                    'hours': round(h_road_o, 1),
                    'trailer_type': road_o_bd['trailer'],
                    'cost_breakdown_items': road_o_bd['items'],
                    'cost_breakdown_total': road_o_bd['total_cost_usd'],
                },
                {
                    'kind': 'air',
                    'from_label': f"{a_o['name']}", 'to_label': f"{a_d['name']}",
                    'from': [a_o['lat'], a_o['lon']], 'to': [a_d['lat'], a_d['lon']],
                    'polyline': air_poly,
                    'distance_km': round(air_km, 1),
                    'hours': round(h_air, 1),
                    'airport_dwell_hours': round(h_air_dwell, 1),
                    'origin_airport': {'iata': a_o.get('iata'), 'name': a_o.get('name')},
                    'destination_airport': {'iata': a_d.get('iata'), 'name': a_d.get('name')},
                    'aircraft_type': air_breakdown['aircraft'],
                    'cost_breakdown_items': air_breakdown['items'],
                    'cost_breakdown_total': air_breakdown['total_cost_usd'],
                },
                {
                    'kind': 'road',
                    'from_label': f"{a_d['name']}", 'to_label': d_lbl,
                    'from': [a_d['lat'], a_d['lon']], 'to': [d_lat, d_lon],
                    'polyline': _great_circle_polyline(a_d['lat'], a_d['lon'], d_lat, d_lon, segments=16),
                    'distance_km': round(land_d_km, 1),
                    'hours': round(h_road_d, 1),
                    'trailer_type': road_d_bd['trailer'],
                    'cost_breakdown_items': road_d_bd['items'],
                    'cost_breakdown_total': road_d_bd['total_cost_usd'],
                },
            ],
            'total_distance_km': round(total_km, 1),
            'total_hours': round(total_h, 1),
            'total_days': round(total_h / 24, 2),
            'co2_tons': round(co2_t, 3),
            'warnings': active_dis,
        }
        score, reasons = _mode_fitness('air', profile, plan_air)
        plan_air['fitness_score'] = score
        plan_air['fitness_reasons'] = reasons
        plan_air['estimated_cost_usd'] = round(
            air_breakdown['total_cost_usd'] +
            road_o_bd['total_cost_usd'] + road_d_bd['total_cost_usd'], 0)
        plan_air['cost_breakdown_usd'] = {
            'air_freight': air_breakdown['total_cost_usd'],
            'road_pre': road_o_bd['total_cost_usd'],
            'road_post': road_d_bd['total_cost_usd'],
        }
        plans.append(plan_air)

    if not plans:
        return _bad('No routing possible for given coordinates', 422)

    # ---- SMART RECOMMENDATION ----
    # Kombinujemo user preference sa fitness score-om. `auto` uzima best fitness;
    # `fastest`/`cheapest`/`green` favorizuje pojedinu metriku ali još uvek uzima
    # fitness u obzir.
    if prefer == 'green':
        recommended = min(plans, key=lambda p: p['co2_tons'] * (100 / max(p['fitness_score'], 20)))
        rec_reason = f"Lowest CO₂ option that also fits the cargo profile."
    elif prefer in ('cheap', 'cheapest'):
        recommended = min(plans, key=lambda p: p['estimated_cost_usd'] * (100 / max(p['fitness_score'], 20)))
        rec_reason = "Cheapest option that also fits the cargo profile."
    elif prefer in ('fast', 'fastest', 'time'):
        recommended = min(plans, key=lambda p: p['total_hours'] * (100 / max(p['fitness_score'], 20)))
        rec_reason = "Fastest option that also fits the cargo profile."
    else:  # 'auto'
        recommended = max(plans, key=lambda p: p['fitness_score'])
        rec_reason = f"Selected on smart-fit score ({recommended['fitness_score']}/100) for the given cargo profile."

    return jsonify({
        'origin': {'lat': o_lat, 'lon': o_lon, 'label': o_lbl},
        'destination': {'lat': d_lat, 'lon': d_lon, 'label': d_lbl},
        'cargo_profile': profile,
        'cargo_tons': cargo_tons,  # backward-compat
        'plans': plans,
        'recommended_mode': recommended['mode'],
        'recommendation_reason': rec_reason,
        'recommendation_score': recommended['fitness_score'],
        'generated_at': int(time.time()),
    })
