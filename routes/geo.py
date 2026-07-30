"""Geo enrichment endpoints — thin caching proxy over free public APIs.

Sources:
    * REST Countries v3.1 (restcountries.com) — country details (calling code,
      currency, languages, timezone, capital, flag URL).
    * PubChem PUG-REST (pubchem.ncbi.nlm.nih.gov) — chemical CAS lookup.
    * VIES (ec.europa.eu/taxation_customs/vies) — EU VAT number validation.

All proxies cache aggressively (24h RAM) to protect the free tiers and to keep
latency sub-100ms once warm. Cache is per-process, cleared on restart.
"""
import json
import time
import urllib.request
import urllib.parse
import xml.sax.saxutils
from flask import Blueprint, jsonify, request

from utils import login_required, log_audit

geo_bp = Blueprint('geo', __name__, url_prefix='/api/geo')

# ---------- REST Countries ----------
_CTY_CACHE = {}         # {iso2: (expiry_ts, payload)}
_CTY_TTL_S = 24 * 3600  # 24h
_HTTP_TIMEOUT_S = 6

def _fetch_country_from_restcountries(iso2):
    """One-shot GET restcountries.com/v3.1/alpha/{iso2}. Returns compact
    normalized dict or None on failure. Never raises — network errors just
    return None so caller falls back to bundled ISO_COUNTRIES on frontend."""
    try:
        url = f'https://restcountries.com/v3.1/alpha/{urllib.parse.quote(iso2)}'
        req = urllib.request.Request(url, headers={'User-Agent': 'AspidusCRM/1.0'})
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT_S) as r:
            data = json.loads(r.read().decode('utf-8'))
        if not data or not isinstance(data, list):
            return None
        c = data[0]
        currencies = c.get('currencies') or {}
        cur_code = next(iter(currencies.keys()), None) if currencies else None
        cur = currencies.get(cur_code, {}) if cur_code else {}
        idd = c.get('idd') or {}
        root = idd.get('root') or ''
        suffixes = idd.get('suffixes') or []
        dial = root + (suffixes[0] if suffixes else '')
        return {
            'iso2': c.get('cca2'),
            'iso3': c.get('cca3'),
            'numeric': c.get('ccn3'),
            'name': (c.get('name') or {}).get('common'),
            'official_name': (c.get('name') or {}).get('official'),
            'capital': (c.get('capital') or [None])[0],
            'region': c.get('region'),
            'subregion': c.get('subregion'),
            'currency': cur_code,
            'currency_symbol': cur.get('symbol'),
            'currency_name': cur.get('name'),
            'dial_code': dial or None,
            'languages': list((c.get('languages') or {}).values()),
            'timezones': c.get('timezones') or [],
            'flag_url': (c.get('flags') or {}).get('svg') or (c.get('flags') or {}).get('png'),
            'source': 'restcountries.com',
        }
    except Exception:
        return None


def _country_cached(iso2):
    iso2 = (iso2 or '').upper().strip()
    if len(iso2) != 2:
        return None
    now = time.time()
    entry = _CTY_CACHE.get(iso2)
    if entry and entry[0] > now:
        return entry[1]
    data = _fetch_country_from_restcountries(iso2)
    if data:
        _CTY_CACHE[iso2] = (now + _CTY_TTL_S, data)
    return data


@geo_bp.route('/country/<iso2>', methods=['GET'])
@login_required
def get_country(iso2):
    data = _country_cached(iso2)
    if not data:
        return jsonify({'error': 'not_found', 'iso2': iso2}), 404
    return jsonify(data)


@geo_bp.route('/portal/country/<iso2>', methods=['GET'])
def portal_get_country(iso2):
    """Portal-side ekvivalent — bez CRM login-a, ali samo za ISO2 lookup.
    Ne otkriva ništa što nije javno na restcountries.com; služi da izbegne
    CORS na portal strani. Portal token nije obavezan jer sadržaj je javan."""
    data = _country_cached(iso2)
    if not data:
        return jsonify({'error': 'not_found', 'iso2': iso2}), 404
    return jsonify(data)


# ---------- PubChem CAS lookup ----------
_CHEM_CACHE = {}         # {cas: (expiry_ts, payload)}
_CHEM_TTL_S = 7 * 24 * 3600   # 1 nedelja — PubChem podaci se retko menjaju

def _fetch_chem_by_cas(cas):
    """PubChem PUG-REST: CAS # → CID → compound properties + hazards.
    Vraca None ako CAS nije poznat ili PubChem ne odgovori u roku."""
    try:
        # 1) CAS → CID
        url = f'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/{urllib.parse.quote(cas)}/cids/JSON'
        req = urllib.request.Request(url, headers={'User-Agent': 'AspidusCRM/1.0'})
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT_S) as r:
            j = json.loads(r.read().decode('utf-8'))
        cids = ((j.get('IdentifierList') or {}).get('CID') or [])
        if not cids:
            return None
        cid = cids[0]

        # 2) CID → osnovne osobine
        prop_props = 'MolecularFormula,MolecularWeight,IUPACName,CanonicalSMILES,InChIKey,Title'
        url2 = f'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{cid}/property/{prop_props}/JSON'
        req2 = urllib.request.Request(url2, headers={'User-Agent': 'AspidusCRM/1.0'})
        with urllib.request.urlopen(req2, timeout=_HTTP_TIMEOUT_S) as r:
            j2 = json.loads(r.read().decode('utf-8'))
        props = ((j2.get('PropertyTable') or {}).get('Properties') or [{}])[0]

        return {
            'cas': cas,
            'cid': cid,
            'name': props.get('Title') or props.get('IUPACName'),
            'iupac_name': props.get('IUPACName'),
            'formula': props.get('MolecularFormula'),
            'molecular_weight': props.get('MolecularWeight'),
            'smiles': props.get('CanonicalSMILES'),
            'inchi_key': props.get('InChIKey'),
            'pubchem_url': f'https://pubchem.ncbi.nlm.nih.gov/compound/{cid}',
            'source': 'pubchem.ncbi.nlm.nih.gov',
        }
    except Exception:
        return None


def _chem_cached(cas):
    cas = (cas or '').strip()
    if not cas or len(cas) > 40:
        return None
    now = time.time()
    entry = _CHEM_CACHE.get(cas)
    if entry and entry[0] > now:
        return entry[1]
    data = _fetch_chem_by_cas(cas)
    if data:
        _CHEM_CACHE[cas] = (now + _CHEM_TTL_S, data)
    return data


@geo_bp.route('/chem/cas/<path:cas>', methods=['GET'])
@login_required
def get_chem(cas):
    data = _chem_cached(cas)
    if not data:
        return jsonify({'error': 'not_found', 'cas': cas}), 404
    return jsonify(data)


# ---------- VIES VAT validation ----------
_VAT_CACHE = {}         # {'DE_123456789': (expiry_ts, payload)}
_VAT_TTL_S = 24 * 3600

# EU VIES podržane zemlje (27 članica + Sev. Irska XI)
VIES_COUNTRIES = {
    'AT','BE','BG','CY','CZ','DE','DK','EE','EL','ES','FI','FR','HR','HU',
    'IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK','XI',
}
# Grčka koristi 'EL' kao VAT prefix, ne 'GR' — mapiramo obe strane
_VAT_ALIASES = {'GR': 'EL', 'EL': 'EL'}


def _vies_country(cc):
    cc = (cc or '').upper().strip()
    return _VAT_ALIASES.get(cc, cc)


def _fetch_vies(cc, vat):
    """SOAP call na VIES check_vat. Vraća dict sa validity + name + address
    kad je uspešno; None kad servis padne ili VAT ne postoji.
    VIES SOAP 1.1 endpoint prima jednostavan XML request."""
    envelope = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" '
        'xmlns:urn="urn:ec.europa.eu:taxud:vies:services:checkVat:types">'
        '<soapenv:Header/><soapenv:Body>'
        '<urn:checkVat>'
        f'<urn:countryCode>{cc}</urn:countryCode>'
        f'<urn:vatNumber>{xml.sax.saxutils.escape(str(vat))}</urn:vatNumber>'
        '</urn:checkVat></soapenv:Body></soapenv:Envelope>'
    ).encode('utf-8')
    try:
        req = urllib.request.Request(
            'https://ec.europa.eu/taxation_customs/vies/services/checkVatService',
            data=envelope,
            headers={
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': '',
                'User-Agent': 'AspidusCRM/1.0',
            },
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            body = r.read().decode('utf-8', 'ignore')
        # Regex-based tag extraction — bez pravog XML parsera, da izbegnemo
        # dependency na xml.etree za jednu jednostavnu response strukturu.
        import re
        def _tag(t):
            m = re.search(rf'<(?:\w+:)?{t}>([^<]*)</(?:\w+:)?{t}>', body)
            return (m.group(1).strip() if m else '')
        valid_txt = _tag('valid').lower()
        return {
            'valid': valid_txt in ('true', '1'),
            'country_code': _tag('countryCode') or cc,
            'vat_number': _tag('vatNumber') or vat,
            'request_date': _tag('requestDate'),
            'name': _tag('name'),
            'address': _tag('address').replace('\n', ', ').strip(),
            'source': 'vies.europa.eu',
        }
    except Exception:
        return None


def _validate_vat_format(cc, vat):
    """Osnovna struktura provera pre nego što VIES pogoditi.
    Vraća True ako format pluziblno odgovara toj zemlji."""
    import re
    patterns = {
        'AT': r'^U\d{8}$',
        'BE': r'^0\d{9}$',
        'BG': r'^\d{9,10}$',
        'CY': r'^\d{8}[A-Z]$',
        'CZ': r'^\d{8,10}$',
        'DE': r'^\d{9}$',
        'DK': r'^\d{8}$',
        'EE': r'^\d{9}$',
        'EL': r'^\d{9}$',
        'ES': r'^[A-Z0-9]\d{7}[A-Z0-9]$',
        'FI': r'^\d{8}$',
        'FR': r'^[A-Z0-9]{2}\d{9}$',
        'HR': r'^\d{11}$',
        'HU': r'^\d{8}$',
        'IE': r'^\d[A-Z0-9]\d{5}[A-Z]{1,2}$',
        'IT': r'^\d{11}$',
        'LT': r'^\d{9}(\d{3})?$',
        'LU': r'^\d{8}$',
        'LV': r'^\d{11}$',
        'MT': r'^\d{8}$',
        'NL': r'^\d{9}B\d{2}$',
        'PL': r'^\d{10}$',
        'PT': r'^\d{9}$',
        'RO': r'^\d{2,10}$',
        'SE': r'^\d{12}$',
        'SI': r'^\d{8}$',
        'SK': r'^\d{10}$',
        'XI': r'^\d{9}(\d{3})?$',
    }
    pat = patterns.get(cc)
    if not pat: return False
    return bool(re.match(pat, vat))


def _vat_cached(cc, vat):
    key = f'{cc}_{vat}'
    now = time.time()
    entry = _VAT_CACHE.get(key)
    if entry and entry[0] > now:
        return entry[1]
    data = _fetch_vies(cc, vat)
    if data:
        _VAT_CACHE[key] = (now + _VAT_TTL_S, data)
    return data


@geo_bp.route('/vat/validate', methods=['POST'])
@login_required
def validate_vat():
    """POST {vat_number: 'DE123456789'} — parse country prefix, VIES check.
    Vraća:
      { valid: true, name, address, country_code, vat_number, source }
      { valid: false, format_valid: false } — struktura ne odgovara
      { error: 'service_unavailable' } — VIES timeout ili down
    """
    payload = request.get_json(silent=True) or {}
    raw = str(payload.get('vat_number', '')).strip().upper().replace(' ', '').replace('-', '')
    if len(raw) < 4:
        return jsonify({'valid': False, 'reason': 'too_short'}), 200
    cc = _vies_country(raw[:2])
    vat = raw[2:]
    if cc not in VIES_COUNTRIES:
        return jsonify({'valid': False, 'reason': 'non_eu_country',
                        'country_code': cc,
                        'message': f'{cc} is not part of the EU VIES system'}), 200
    if not _validate_vat_format(cc, vat):
        return jsonify({'valid': False, 'format_valid': False,
                        'country_code': cc, 'vat_number': vat,
                        'reason': 'bad_format',
                        'message': f'{cc} VAT number format does not match'}), 200
    data = _vat_cached(cc, vat)
    if data is None:
        return jsonify({'error': 'service_unavailable',
                        'message': 'VIES service temporarily unreachable — please retry'}), 502
    return jsonify(data)


# ---------- open-meteo weather forecast ----------
_WX_CACHE = {}      # {(lat,lon,days): (expiry_ts, payload)}
_WX_TTL_S = 30 * 60  # 30min — vremenska prognoza se često menja

def _fetch_openmeteo(lat, lon, days=3):
    """POST-less GET na api.open-meteo.com. Bez API ključa. Vraća:
       { current: {temperature, weather_code, wind_speed, ...},
         daily: [ {date, tmin, tmax, weather_code, precipitation}, ... ] }"""
    try:
        params = urllib.parse.urlencode({
            'latitude': f'{float(lat):.4f}',
            'longitude': f'{float(lon):.4f}',
            'current': 'temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,precipitation',
            'daily': 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max',
            'forecast_days': str(min(max(int(days or 3), 1), 16)),
            'timezone': 'auto',
        })
        req = urllib.request.Request(
            f'https://api.open-meteo.com/v1/forecast?{params}',
            headers={'User-Agent': 'AspidusCRM/1.0'}
        )
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT_S) as r:
            raw = json.loads(r.read().decode('utf-8'))
        cur = raw.get('current') or {}
        daily = raw.get('daily') or {}
        # Kompaktiraj daily granice u niz redova
        d_rows = []
        times = daily.get('time') or []
        wcodes = daily.get('weather_code') or []
        tmaxs = daily.get('temperature_2m_max') or []
        tmins = daily.get('temperature_2m_min') or []
        prec = daily.get('precipitation_sum') or []
        wind = daily.get('wind_speed_10m_max') or []
        for i, dt in enumerate(times):
            d_rows.append({
                'date': dt,
                'weather_code': wcodes[i] if i < len(wcodes) else None,
                'tmax_c': tmaxs[i] if i < len(tmaxs) else None,
                'tmin_c': tmins[i] if i < len(tmins) else None,
                'precip_mm': prec[i] if i < len(prec) else None,
                'wind_max_kmh': wind[i] if i < len(wind) else None,
            })
        return {
            'latitude': raw.get('latitude'),
            'longitude': raw.get('longitude'),
            'timezone': raw.get('timezone'),
            'current': {
                'temperature_c': cur.get('temperature_2m'),
                'weather_code': cur.get('weather_code'),
                'wind_kmh': cur.get('wind_speed_10m'),
                'wind_dir_deg': cur.get('wind_direction_10m'),
                'precipitation_mm': cur.get('precipitation'),
                'time': cur.get('time'),
            },
            'daily': d_rows,
            'source': 'open-meteo.com',
        }
    except Exception:
        return None


def _wx_cached(lat, lon, days):
    key = (round(float(lat), 3), round(float(lon), 3), int(days))
    now = time.time()
    entry = _WX_CACHE.get(key)
    if entry and entry[0] > now:
        return entry[1]
    data = _fetch_openmeteo(lat, lon, days)
    if data:
        _WX_CACHE[key] = (now + _WX_TTL_S, data)
    return data


@geo_bp.route('/weather', methods=['GET'])
@login_required
def get_weather():
    try:
        lat = float(request.args.get('lat'))
        lon = float(request.args.get('lon'))
    except (TypeError, ValueError):
        return jsonify({'error': 'bad_coords'}), 400
    days = request.args.get('days', 3)
    data = _wx_cached(lat, lon, days)
    if not data:
        return jsonify({'error': 'service_unavailable'}), 502
    return jsonify(data)


@geo_bp.route('/portal/weather', methods=['GET'])
def portal_weather():
    """Portal-friendly ekvivalent; open-meteo je javan pa nema tajni."""
    try:
        lat = float(request.args.get('lat'))
        lon = float(request.args.get('lon'))
    except (TypeError, ValueError):
        return jsonify({'error': 'bad_coords'}), 400
    days = request.args.get('days', 3)
    data = _wx_cached(lat, lon, days)
    if not data:
        return jsonify({'error': 'service_unavailable'}), 502
    return jsonify(data)


# ---------- UN Comtrade trade stats ----------
_COMTRADE_CACHE = {}       # {(hs, reporter, partner): (expiry, payload)}
_COMTRADE_TTL_S = 24 * 3600

def _fetch_comtrade_stats(hs_code, reporter='all', partner='all'):
    """Comtrade free tier endpoint. Zove /public/v1/preview/C/A/HS.
    Zabranjuje > 500 zapisa i > 10 poziva u minuti bez ključa. Vraćamo top 8
    zemlje-partneri po trade value za posmatrani HS 6-cifreni kod, poslednja
    dostupna godina.
    """
    try:
        # Free preview API — bez ključa, ograničen ali dovoljan za info tab
        params = urllib.parse.urlencode({
            'r': reporter, 'p': partner,
            'ps': 'recent',           # najskorija godina
            'cc': str(hs_code)[:6],   # HS heading do 6 cifara
            'freq': 'A',              # annual
            'px': 'HS',
            'rg': '2',                # 1=Import, 2=Export, all=1&2
            'max': '10',
        })
        req = urllib.request.Request(
            f'https://comtradeapi.un.org/public/v1/preview/C/A/HS?{params}',
            headers={'User-Agent': 'AspidusCRM/1.0', 'Accept': 'application/json'}
        )
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT_S) as r:
            raw = json.loads(r.read().decode('utf-8'))
        rows = raw.get('data') or raw.get('result') or []
        top = []
        for r in rows[:10]:
            top.append({
                'reporter': r.get('reporterDesc') or r.get('rtTitle'),
                'partner':  r.get('partnerDesc')  or r.get('ptTitle'),
                'year':     r.get('refYear') or r.get('yr'),
                'trade_value_usd': r.get('primaryValue') or r.get('TradeValue'),
                'quantity': r.get('qty') or r.get('primaryQty'),
                'flow': r.get('flowDesc') or r.get('rgDesc'),
            })
        return {'hs_code': hs_code, 'rows': top, 'source': 'comtradeapi.un.org'}
    except Exception:
        return None


def _comtrade_cached(hs_code, reporter='all', partner='all'):
    key = (str(hs_code)[:6], reporter, partner)
    now = time.time()
    entry = _COMTRADE_CACHE.get(key)
    if entry and entry[0] > now:
        return entry[1]
    data = _fetch_comtrade_stats(hs_code, reporter, partner)
    if data:
        _COMTRADE_CACHE[key] = (now + _COMTRADE_TTL_S, data)
    return data

@geo_bp.route('/trade/<hs_code>', methods=['GET'])
@login_required
def get_trade_stats(hs_code):
    reporter = request.args.get('reporter', 'all')
    partner = request.args.get('partner', 'all')
    data = _comtrade_cached(hs_code, reporter, partner)
    if not data:
        return jsonify({'error': 'service_unavailable'}), 502
    return jsonify(data)


# ---------- Live FX + commodity market data ----------

@geo_bp.route('/fx/rates', methods=['GET'])
@login_required
def get_fx_rates():
    """Vraća {rates: {USD:1.0, EUR:0.92, ...}, base, source} — ECB reference
    kursevi preko exchangerate.host, cache 4h."""
    from market_data import fx_rates
    base = (request.args.get('base') or 'USD').upper()
    rates = fx_rates(base)
    if not rates:
        return jsonify({'error': 'service_unavailable'}), 502
    return jsonify({'base': base, 'rates': rates, 'source': 'exchangerate.host'})


@geo_bp.route('/fx/convert', methods=['GET'])
@login_required
def convert_fx():
    """?amount=100&from=USD&to=EUR → {amount, converted}"""
    from market_data import fx_convert
    try:
        amt = float(request.args.get('amount') or 0)
    except ValueError:
        return jsonify({'error': 'bad_amount'}), 400
    frm = request.args.get('from', 'USD')
    to = request.args.get('to', 'USD')
    out = fx_convert(amt, frm, to)
    if out is None:
        return jsonify({'error': 'unable_to_convert'}), 502
    return jsonify({'amount': amt, 'from': frm.upper(), 'to': to.upper(), 'converted': out})


@geo_bp.route('/commodity/<symbol>', methods=['GET'])
@login_required
def get_commodity(symbol):
    """Vraća najnoviju cenu za commodity (npr. wti, brent, wheat, corn).
    Vrati 404 ako simbol nije podržan, 502 ako Alpha Vantage padne ili
    ključ nije postavljen. Cache 6h."""
    from market_data import commodity_price, COMMODITY_MAP
    if symbol.lower() not in COMMODITY_MAP:
        return jsonify({'error': 'unknown_symbol'}), 404
    data = commodity_price(symbol)
    if not data:
        return jsonify({'error': 'service_unavailable',
                        'message': 'Alpha Vantage key not configured or rate limited'}), 502
    return jsonify(data)


@geo_bp.route('/commodity', methods=['GET'])
@login_required
def list_commodities():
    """Lista svih podržanih commodities — za frontend dropdown widget."""
    from market_data import commodity_list
    return jsonify({'items': commodity_list()})


# ---------- Shipment / vessel / flight tracking ----------

@geo_bp.route('/track/shipment/<path:number>', methods=['GET'])
@login_required
def track_shipment_ep(number):
    """Container / parcel tracking preko 17TRACK.
    Za container koristi UN/ISO container broj (npr. MSCU1234567), za parcel
    airway bill (FedEx/DHL). Odgovor sadrži status + events istoriju."""
    from tracking import track_shipment
    data = track_shipment(number, carrier_hint=request.args.get('carrier'))
    if not data:
        return jsonify({'error': 'not_found_or_unconfigured',
                        'message': '17TRACK unavailable or number not found. Configure API key in Settings > Tracking.'}), 502
    return jsonify(data)


@geo_bp.route('/track/vessel', methods=['GET'])
@login_required
def track_vessel_ep():
    """?imo=9704611 or ?mmsi=636016432 or ?name=MSC%20OSCAR"""
    from tracking import track_vessel
    imo = request.args.get('imo')
    mmsi = request.args.get('mmsi')
    name = request.args.get('name')
    data = track_vessel(imo=imo, mmsi=mmsi, name=name)
    if not data:
        return jsonify({'error': 'not_found_or_unconfigured',
                        'message': 'MarineTraffic unavailable. Configure API key in Settings > Tracking.'}), 502
    return jsonify(data)


@geo_bp.route('/track/flight/<flight_number>', methods=['GET'])
@login_required
def track_flight_ep(flight_number):
    from tracking import track_flight
    data = track_flight(flight_number)
    if not data:
        return jsonify({'error': 'not_found_or_unconfigured',
                        'message': 'FlightAware unavailable. Configure API key in Settings > Tracking.'}), 502
    return jsonify(data)


@geo_bp.route('/business_register/<country>/<reg_number>', methods=['GET'])
@login_required
def business_register_lookup(country, reg_number):
    """Lookup u nacionalnom biznis registru (GB/FR/OpenCorporates fallback za sve)."""
    from tracking import lookup_business
    data = lookup_business(country, reg_number=reg_number)
    if not data:
        return jsonify({'error': 'not_found'}), 404
    return jsonify(data)
