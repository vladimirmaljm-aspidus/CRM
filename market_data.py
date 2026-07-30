"""Live market data — currency rates + commodity spot prices.

Sources:
  * exchangerate.host      — ECB reference rates, free, no key, updated daily
  * frankfurter.app        — ECB historical rates fallback
  * Alpha Vantage TIME_SERIES  — commodity spot (WTI/Brent, Gold, Wheat, Corn,
    Coffee, Copper), 25 calls/day free (needs free API key)

Sve funkcije su cache-uju agresivno da bi radile i offline i da bi štedele
free-tier limite. Cache ključ je (currency-pair, day) — jer se ECB stope
menjaju samo jednom dnevno.
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

_HTTP_TIMEOUT = 6


# ---------- FX rates ----------

_FX_CACHE = {}     # {'day-base': (expiry_ts, {code: rate})}
_FX_TTL_S = 4 * 3600  # 4h — ECB stope se menjaju 16:00 CET, cache do svakih 4h


def _av_api_key():
    """Alpha Vantage API key. Prvo iz env-a, pa iz settings tabele."""
    key = (os.environ.get('ALPHA_VANTAGE_KEY') or '').strip()
    if key: return key
    try:
        from utils import decrypt_data
        with db.connect_raw(DB_FILE) as conn:
            row = conn.execute("SELECT value FROM settings WHERE key='alphaVantageKey'").fetchone()
        if row and row[0]:
            try: return str(decrypt_data(row[0]) or '')
            except Exception: return ''
    except Exception:
        pass
    return ''


def _fetch_ecb_rates(base='USD'):
    """Vraća {'USD': 1.0, 'EUR': 0.92, ...} sa reference kursa ECB.
    exchangerate.host je javan i besplatan; ako padne, pokušamo frankfurter.app."""
    for url in (
        f'https://api.exchangerate.host/latest?base={base}',
        f'https://api.frankfurter.app/latest?from={base}',
    ):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'AspidusCRM/1.0 fx'})
            with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as r:
                data = json.loads(r.read().decode('utf-8'))
            rates = data.get('rates') or {}
            if rates:
                rates[base] = 1.0
                return rates
        except Exception as e:
            logger.debug('%s failed: %s', url, e)
    return None


def fx_rates(base='USD'):
    """Public helper — vraća živi dict kurseva iz keša ili sa exchangerate.host.
    Ako oba servisa padnu, vraća None (call site treba fallback na hardcoded
    GLOBAL_RATES iz constants.js)."""
    base = (base or 'USD').upper()
    day = time.strftime('%Y-%m-%d')
    key = f'{day}-{base}'
    now = time.time()
    entry = _FX_CACHE.get(key)
    if entry and entry[0] > now:
        return entry[1]
    rates = _fetch_ecb_rates(base)
    if rates:
        _FX_CACHE[key] = (now + _FX_TTL_S, rates)
    return rates


def fx_convert(amount, from_ccy, to_ccy):
    """Konvertuje iznos iz jedne valute u drugu preko živih ECB stopa."""
    try:
        a = float(amount or 0)
    except (TypeError, ValueError):
        return None
    from_ccy = (from_ccy or 'USD').upper()
    to_ccy = (to_ccy or 'USD').upper()
    if from_ccy == to_ccy: return a
    r = fx_rates(from_ccy)
    if not r or to_ccy not in r: return None
    return round(a * r[to_ccy], 4)


# ---------- Commodity spot prices via Alpha Vantage ----------

_COM_CACHE = {}   # {symbol: (expiry_ts, payload)}
_COM_TTL_S = 6 * 3600   # 6h — commodity spot se menja tokom dana, ali free tier
                        # dopušta samo 25 poziva/dan pa cache mora biti generozan.

# Alpha Vantage functions za commodity vs stock:
#   WTI, BRENT, NATURAL_GAS, COPPER, ALUMINUM, WHEAT, CORN, COTTON, SUGAR, COFFEE
COMMODITY_MAP = {
    'wti':          {'function': 'WTI',           'interval': 'daily', 'label': 'Crude Oil (WTI)', 'unit': 'USD/barrel'},
    'brent':        {'function': 'BRENT',         'interval': 'daily', 'label': 'Crude Oil (Brent)', 'unit': 'USD/barrel'},
    'natural_gas':  {'function': 'NATURAL_GAS',   'interval': 'daily', 'label': 'Natural Gas',      'unit': 'USD/MMBtu'},
    'copper':       {'function': 'COPPER',        'interval': 'monthly','label': 'Copper',           'unit': 'USD/ton'},
    'aluminum':     {'function': 'ALUMINUM',      'interval': 'monthly','label': 'Aluminum',         'unit': 'USD/ton'},
    'wheat':        {'function': 'WHEAT',         'interval': 'monthly','label': 'Wheat',            'unit': 'USD/ton'},
    'corn':         {'function': 'CORN',          'interval': 'monthly','label': 'Corn',             'unit': 'USD/ton'},
    'cotton':       {'function': 'COTTON',        'interval': 'monthly','label': 'Cotton',           'unit': 'USD/pound'},
    'sugar':        {'function': 'SUGAR',         'interval': 'monthly','label': 'Sugar',            'unit': 'USD/pound'},
    'coffee':       {'function': 'COFFEE',        'interval': 'monthly','label': 'Coffee',           'unit': 'USD/pound'},
}


def commodity_price(symbol):
    """Vraća {price, date, unit, label} za dati commodity ili None ako
    Alpha Vantage nije konfigurisan / servis padne / free-tier iscrpljen."""
    symbol = (symbol or '').lower()
    spec = COMMODITY_MAP.get(symbol)
    if not spec: return None
    now = time.time()
    entry = _COM_CACHE.get(symbol)
    if entry and entry[0] > now:
        return entry[1]

    key = _av_api_key()
    if not key:
        return None
    try:
        url = ('https://www.alphavantage.co/query?'
               + urllib.parse.urlencode({
                   'function': spec['function'],
                   'interval': spec['interval'],
                   'apikey': key,
               }))
        req = urllib.request.Request(url, headers={'User-Agent': 'AspidusCRM/1.0 av'})
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as r:
            data = json.loads(r.read().decode('utf-8'))
        rows = data.get('data') or []
        if not rows: return None
        latest = rows[0]
        result = {
            'symbol': symbol,
            'label': spec['label'],
            'unit': spec['unit'],
            'price': float(latest.get('value')) if latest.get('value') and latest.get('value') != '.' else None,
            'date': latest.get('date'),
            'source': 'alphavantage.co',
        }
        _COM_CACHE[symbol] = (now + _COM_TTL_S, result)
        return result
    except Exception as e:
        logger.warning('commodity fetch failed for %s: %s', symbol, e)
        return None


def commodity_list():
    """Statička lista svih podržanih commodities za frontend dropdown."""
    return [{'symbol': k, **v} for k, v in COMMODITY_MAP.items()]
