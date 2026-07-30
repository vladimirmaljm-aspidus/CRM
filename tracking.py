"""Shipment tracking — container / vessel / cargo flight.

Sources (all free-tier / open):
  * 17TRACK.net API  — container + parcel tracking (Maersk, MSC, CMA, DHL,
                       FedEx, UPS…). Free tier: 1000 tracks/month with API
                       key registration.
  * AISHub.net       — vessel tracking (AIS data). Free access if you set up
                       a small feeder for their network; otherwise falls
                       back to public MMSI lookups.
  * MarineTraffic PS7— vessel positions & voyage data. Requires API key.
  * flightaware AeroAPI — cargo flight tracking. Free tier limited.

Cache aggressively (30 min for positions, 6h for parcel status) to protect
free-tier limits.
"""
import db
import json
import logging
import os
import sqlite3
import time
import urllib.parse
import urllib.request

from config import DB_FILE

logger = logging.getLogger(__name__)
_HTTP_TIMEOUT = 8


def _get_key(env_name, settings_name):
    """Ključ prvo iz env-a (za dev), pa iz settings tabele (za prod)."""
    v = (os.environ.get(env_name) or '').strip()
    if v: return v
    try:
        from utils import decrypt_data
        with db.connect_raw(DB_FILE) as conn:
            row = conn.execute("SELECT value FROM settings WHERE key=?", (settings_name,)).fetchone()
        if row and row[0]:
            try: return str(decrypt_data(row[0]) or '')
            except Exception: return ''
    except Exception:
        pass
    return ''


# ---------- 17TRACK container / parcel ----------

_TRK_CACHE = {}          # {number: (expiry_ts, payload)}
_TRK_TTL_S = 4 * 3600    # 4h — status ne menja često, ali kada stigne "delivered" želimo brzu detekciju


def track_shipment(number, carrier_hint=None):
    """Trace container ili parcel broj preko 17TRACK.
    number: container number (npr. MSCU1234567) ili tracking number (npr. FedEx airway bill).
    carrier_hint: opciono, ubrzava resolve kada 17TRACK ima više kandidata.

    Vraća {number, carrier, status, events: [{date, place, event}], last_update}
    ili None ako 17TRACK padne / ključ nije konfigurisan."""
    if not number:
        return None
    number = str(number).strip().upper()
    now = time.time()
    entry = _TRK_CACHE.get(number)
    if entry and entry[0] > now:
        return entry[1]

    api_key = _get_key('TRACK17_API_KEY', 'track17ApiKey')
    if not api_key:
        return None

    try:
        # Register endpoint — 17TRACK zahteva prvo /register da bi obradio broj
        register_body = json.dumps([{'number': number, 'carrier': int(carrier_hint) if carrier_hint else 0}]).encode('utf-8')
        req = urllib.request.Request(
            'https://api.17track.net/track/v2.2/register',
            data=register_body,
            headers={
                '17token': api_key,
                'Content-Type': 'application/json',
                'User-Agent': 'AspidusCRM/1.0 17track',
            },
        )
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT):
            pass

        # Get tracking info
        get_body = json.dumps([{'number': number}]).encode('utf-8')
        req = urllib.request.Request(
            'https://api.17track.net/track/v2.2/gettrackinfo',
            data=get_body,
            headers={
                '17token': api_key,
                'Content-Type': 'application/json',
                'User-Agent': 'AspidusCRM/1.0 17track',
            },
        )
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as r:
            data = json.loads(r.read().decode('utf-8'))
        accepted = ((data.get('data') or {}).get('accepted') or [])
        if not accepted:
            return None
        item = accepted[0]
        track = (item.get('track_info') or {})
        latest = track.get('latest_status') or {}
        events = []
        for ev in ((track.get('tracking') or {}).get('providers', [{}])[0].get('events') or [])[:20]:
            events.append({
                'date': ev.get('time_iso') or ev.get('time_utc'),
                'place': (ev.get('location') or {}).get('address') or ev.get('address'),
                'event': ev.get('description') or ev.get('stage'),
                'stage': ev.get('stage'),
            })
        result = {
            'number': number,
            'carrier': latest.get('carrier_name') or (item.get('carrier') or {}).get('name') or 'Unknown',
            'status': latest.get('status') or 'unknown',
            'sub_status': latest.get('sub_status'),
            'last_update': latest.get('time_iso') or latest.get('time_utc'),
            'events': events,
            'source': '17track.net',
        }
        _TRK_CACHE[number] = (now + _TRK_TTL_S, result)
        return result
    except Exception as e:
        logger.warning('17TRACK fetch failed for %s: %s', number, e)
        return None


# ---------- Vessel tracking (MarineTraffic) ----------

_VESSEL_CACHE = {}
_VESSEL_TTL_S = 30 * 60   # pozicija se menja svakih ~1min, ali cache 30min stedi kvotu


def track_vessel(imo=None, mmsi=None, name=None):
    """Vraća poziciju + voyage brod. Prihvata IMO # (npr. 9704611),
    MMSI (npr. 636016432) ili ime broda.

    Free tier MarineTraffic-a je vrlo ograničen; ako ključ nije konfigurisan
    vraćamo None. Alternativa je AISHub (traži feeder participation)."""
    key_id = None
    if imo: key_id = f'imo-{imo}'
    elif mmsi: key_id = f'mmsi-{mmsi}'
    elif name: key_id = f'name-{name.strip().lower()}'
    if not key_id:
        return None
    now = time.time()
    entry = _VESSEL_CACHE.get(key_id)
    if entry and entry[0] > now:
        return entry[1]

    api_key = _get_key('MARINETRAFFIC_KEY', 'marineTrafficKey')
    if not api_key:
        return None

    try:
        # MarineTraffic PS07 vessel positions endpoint
        params = {'v': 3, 'protocol': 'jsono'}
        if imo: params['imo'] = imo
        elif mmsi: params['mmsi'] = mmsi
        url = f'https://services.marinetraffic.com/api/exportvessel/{api_key}?' + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={'User-Agent': 'AspidusCRM/1.0 mt'})
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as r:
            data = json.loads(r.read().decode('utf-8'))
        if not data: return None
        entry_obj = data[0] if isinstance(data, list) else data
        result = {
            'name': entry_obj.get('SHIPNAME') or entry_obj.get('name'),
            'imo': entry_obj.get('IMO') or imo,
            'mmsi': entry_obj.get('MMSI') or mmsi,
            'lat': float(entry_obj.get('LAT') or entry_obj.get('lat') or 0) or None,
            'lon': float(entry_obj.get('LON') or entry_obj.get('lon') or 0) or None,
            'speed_kn': float(entry_obj.get('SPEED') or 0) / 10 or None,
            'heading': entry_obj.get('COURSE'),
            'status': entry_obj.get('STATUS_NAME') or entry_obj.get('status'),
            'destination': entry_obj.get('DESTINATION'),
            'eta': entry_obj.get('ETA'),
            'last_report': entry_obj.get('TIMESTAMP'),
            'source': 'marinetraffic.com',
        }
        _VESSEL_CACHE[key_id] = (now + _VESSEL_TTL_S, result)
        return result
    except Exception as e:
        logger.warning('MarineTraffic fetch failed for %s: %s', key_id, e)
        return None


# ---------- Cargo flight tracking (FlightAware AeroAPI) ----------

_FLIGHT_CACHE = {}
_FLIGHT_TTL_S = 15 * 60


def track_flight(flight_number):
    """Vraća osnovne flight info: origin, destination, eta, aircraft, altitude.
    Koristi FlightAware AeroAPI free tier."""
    if not flight_number: return None
    fn = str(flight_number).strip().upper().replace(' ', '')
    now = time.time()
    entry = _FLIGHT_CACHE.get(fn)
    if entry and entry[0] > now:
        return entry[1]

    api_key = _get_key('FLIGHTAWARE_KEY', 'flightAwareKey')
    if not api_key: return None

    try:
        url = f'https://aeroapi.flightaware.com/aeroapi/flights/{urllib.parse.quote(fn)}'
        req = urllib.request.Request(url, headers={
            'x-apikey': api_key,
            'Accept': 'application/json',
            'User-Agent': 'AspidusCRM/1.0 fa',
        })
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as r:
            data = json.loads(r.read().decode('utf-8'))
        flights = data.get('flights') or []
        if not flights: return None
        f = flights[0]
        result = {
            'ident': f.get('ident'),
            'origin_code': (f.get('origin') or {}).get('code_iata'),
            'origin_name': (f.get('origin') or {}).get('name'),
            'destination_code': (f.get('destination') or {}).get('code_iata'),
            'destination_name': (f.get('destination') or {}).get('name'),
            'estimated_out': f.get('estimated_out'),
            'estimated_in': f.get('estimated_in'),
            'progress_percent': f.get('progress_percent'),
            'aircraft_type': f.get('aircraft_type'),
            'status': f.get('status'),
            'source': 'flightaware.com',
        }
        _FLIGHT_CACHE[fn] = (now + _FLIGHT_TTL_S, result)
        return result
    except Exception as e:
        logger.warning('FlightAware fetch failed for %s: %s', fn, e)
        return None


# ---------- EU business registers ----------

_REG_CACHE = {}
_REG_TTL_S = 7 * 24 * 3600   # kompanije se retko menjaju u registru


def lookup_business(country_iso2, reg_number=None, name=None):
    """Traži kompaniju u nacionalnom registru. Country prefix određuje endpoint:
        GB → Companies House UK        (traži API ključ)
        BE → KBO/BCE Belgium public    (open)
        DE → Handelsregister via OpenCorporates fallback
        NL → KVK Netherlands
        FR → Sirene (INSEE) — open, no key
        Fallback: OpenCorporates.com (public tier bez ključa)
    """
    if not country_iso2:
        return None
    country_iso2 = str(country_iso2).upper()[:2]
    key_id = f'{country_iso2}:{reg_number or name or ""}'.lower()
    now = time.time()
    entry = _REG_CACHE.get(key_id)
    if entry and entry[0] > now:
        return entry[1]

    result = None
    try:
        if country_iso2 == 'GB' and reg_number:
            # Companies House REST API — potreban ključ (email registracija dovoljna)
            api_key = _get_key('COMPANIES_HOUSE_KEY', 'companiesHouseKey')
            if api_key:
                import base64
                auth = base64.b64encode(f'{api_key}:'.encode()).decode()
                req = urllib.request.Request(
                    f'https://api.company-information.service.gov.uk/company/{reg_number}',
                    headers={'Authorization': f'Basic {auth}', 'User-Agent': 'AspidusCRM/1.0'},
                )
                with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as r:
                    data = json.loads(r.read().decode('utf-8'))
                result = {
                    'country': 'GB',
                    'name': data.get('company_name'),
                    'number': data.get('company_number'),
                    'status': data.get('company_status'),
                    'type': data.get('type'),
                    'incorporated_on': data.get('date_of_creation'),
                    'sic_codes': data.get('sic_codes', []),
                    'address': (data.get('registered_office_address') or {}),
                    'source': 'gov.uk',
                }
        elif country_iso2 == 'FR' and reg_number:
            # Sirene INSEE — open API, no key needed
            req = urllib.request.Request(
                f'https://recherche-entreprises.api.gouv.fr/search?q={urllib.parse.quote(reg_number)}',
                headers={'User-Agent': 'AspidusCRM/1.0'},
            )
            with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as r:
                data = json.loads(r.read().decode('utf-8'))
            rows = data.get('results') or []
            if rows:
                row = rows[0]
                result = {
                    'country': 'FR',
                    'name': row.get('nom_complet'),
                    'number': row.get('siren'),
                    'status': row.get('etat_administratif'),
                    'type': row.get('nature_juridique'),
                    'incorporated_on': row.get('date_creation'),
                    'sic_codes': [row.get('activite_principale')],
                    'address': {'address_line_1': (row.get('siege') or {}).get('adresse')},
                    'source': 'recherche-entreprises.api.gouv.fr',
                }
        else:
            # Fallback: OpenCorporates javni tier
            q = reg_number or name
            if q:
                url = ('https://api.opencorporates.com/v0.4/companies/search?'
                       + urllib.parse.urlencode({'q': q, 'jurisdiction_code': country_iso2.lower()}))
                req = urllib.request.Request(url, headers={'User-Agent': 'AspidusCRM/1.0'})
                with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as r:
                    data = json.loads(r.read().decode('utf-8'))
                rows = ((data.get('results') or {}).get('companies') or [])
                if rows:
                    row = rows[0].get('company') or {}
                    result = {
                        'country': country_iso2,
                        'name': row.get('name'),
                        'number': row.get('company_number'),
                        'status': row.get('current_status'),
                        'type': row.get('company_type'),
                        'incorporated_on': row.get('incorporation_date'),
                        'sic_codes': [c.get('code') for c in (row.get('industry_codes') or [])[:3]],
                        'address': {'address_line_1': row.get('registered_address_in_full')},
                        'source': 'opencorporates.com',
                    }
    except Exception as e:
        logger.warning('business register lookup failed for %s: %s', key_id, e)
        return None

    if result:
        _REG_CACHE[key_id] = (now + _REG_TTL_S, result)
    return result
