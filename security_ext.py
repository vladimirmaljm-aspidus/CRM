"""External security checks — HIBP + hCaptcha + Open Ownership.

Have I Been Pwned Password API — Troy Hunt's free k-anonymity endpoint.
    We send the FIRST 5 hex chars of SHA-1(password); server returns list
    of hash suffixes seen in breaches. We check locally if OUR suffix is
    in that list. The full password NEVER leaves the server (only 5-char
    prefix goes over TLS). Reference:
        https://haveibeenpwned.com/API/v3#PwnedPasswords

hCaptcha — anti-bot on portal login (before OTP is even generated).
    Free tier: 1M sitekey validations/month. GDPR-friendly (EU DPA).
    Reference: https://docs.hcaptcha.com/

Open Ownership — PEP (Politically Exposed Persons) beneficial ownership
    register. Complements OpenSanctions with actual "who owns what"
    corporate structure data. Reference: https://register.openownership.org
"""
import db
import hashlib
import json
import logging
import sqlite3
import time
import urllib.parse
import urllib.request

from config import DB_FILE

logger = logging.getLogger(__name__)

_HTTP_TIMEOUT = 6


# ---------- HIBP Password API ----------

def is_password_pwned(password, min_hits=1):
    """Vraća (pwned: bool, hit_count: int). K-anonymity: šalje samo prvih 5
    heksa SHA-1 hasha, primi listu suffixa, poredi lokalno.

    min_hits=1 znači "odbij ako je ikad viđena". Za jače policy postaviti
    npr. 10 (samo često korišćene lozinke se blokiraju)."""
    if not password or len(password) < 8:
        return (False, 0)
    try:
        sha1 = hashlib.sha1(password.encode('utf-8')).hexdigest().upper()
        prefix, suffix = sha1[:5], sha1[5:]
        req = urllib.request.Request(
            f'https://api.pwnedpasswords.com/range/{prefix}',
            headers={
                'User-Agent': 'AspidusCRM/1.0 password-check',
                'Add-Padding': 'true',  # random padding za jos boljeg k-anonymity
            },
        )
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as r:
            body = r.read().decode('utf-8')
        for line in body.splitlines():
            parts = line.strip().split(':')
            if len(parts) != 2: continue
            if parts[0].strip().upper() == suffix:
                hits = int(parts[1].strip())
                return (hits >= min_hits, hits)
        return (False, 0)
    except Exception as e:
        # Konservativno: ako servis padne, ne blokiramo password change
        logger.warning('HIBP check failed (allowing): %s', e)
        return (False, 0)


# ---------- hCaptcha verification ----------

_HCAPTCHA_CACHE = {'ts': 0, 'secret': None}


def _hcaptcha_secret():
    """Čita hCaptcha secret iz settings.hcaptchaConfig. Cache 60s."""
    now = time.time()
    if _HCAPTCHA_CACHE['secret'] is not None and (now - _HCAPTCHA_CACHE['ts']) < 60:
        return _HCAPTCHA_CACHE['secret']
    from utils import decrypt_data
    secret = ''
    try:
        with db.connect_raw(DB_FILE) as conn:
            row = conn.execute("SELECT value FROM settings WHERE key='hcaptchaConfig'").fetchone()
        if row and row[0]:
            try: cfg = decrypt_data(row[0]) or {}
            except Exception: cfg = {}
            secret = str((cfg or {}).get('secret', ''))
    except Exception:
        pass
    _HCAPTCHA_CACHE['secret'] = secret
    _HCAPTCHA_CACHE['ts'] = now
    return secret


def clear_hcaptcha_cache():
    _HCAPTCHA_CACHE['secret'] = None
    _HCAPTCHA_CACHE['ts'] = 0


def verify_hcaptcha(token, remote_ip=None):
    """Server-side verify hCaptcha token-a. Vraća (ok, message).
    Ako secret nije konfigurisan → captcha je isključena, propušta sve
    (backwards-compat sa instalacijama koje ne koriste hCaptcha)."""
    secret = _hcaptcha_secret()
    if not secret:
        return (True, 'hCaptcha not configured')
    if not token:
        return (False, 'Missing captcha token')
    try:
        data = urllib.parse.urlencode({
            'secret': secret,
            'response': token,
            'remoteip': remote_ip or '',
        }).encode('utf-8')
        req = urllib.request.Request(
            'https://hcaptcha.com/siteverify',
            data=data,
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
        )
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as r:
            j = json.loads(r.read().decode('utf-8'))
        ok = bool(j.get('success', False))
        if not ok:
            reason = ','.join(j.get('error-codes') or []) or 'unknown'
            return (False, f'hcaptcha rejected ({reason})')
        return (True, 'ok')
    except Exception as e:
        # Fail-open — captcha servis dole ne sme da blokira legitiman login
        logger.warning('hCaptcha verify network error (allowing): %s', e)
        return (True, f'hcaptcha unavailable ({e})')


def get_public_sitekey():
    """Vraća hCaptcha sitekey (public) za frontend widget. Kad je prazan,
    frontend zna da ne renderuje widget."""
    from utils import decrypt_data
    try:
        with db.connect_raw(DB_FILE) as conn:
            row = conn.execute("SELECT value FROM settings WHERE key='hcaptchaConfig'").fetchone()
        if row and row[0]:
            try: cfg = decrypt_data(row[0]) or {}
            except Exception: cfg = {}
            return str((cfg or {}).get('sitekey', ''))
    except Exception:
        return ''
    return ''


# ---------- Open Ownership PEP register ----------

_OO_CACHE = {}  # {name_norm: (expiry_ts, results)}
_OO_TTL_S = 24 * 3600


def open_ownership_search(name):
    """Search po imenu preko Open Ownership Register API-ja. Vraća listu
    hits sa {name, jurisdiction, incorporated_at, statements_url}. Ako
    servis padne, vraća []."""
    if not name:
        return []
    key = name.strip().lower()
    now = time.time()
    entry = _OO_CACHE.get(key)
    if entry and entry[0] > now:
        return entry[1]
    try:
        params = urllib.parse.urlencode({'q': name})
        req = urllib.request.Request(
            f'https://register.openownership.org/entities.json?{params}',
            headers={'User-Agent': 'AspidusCRM/1.0 pep-check', 'Accept': 'application/json'},
        )
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as r:
            data = json.loads(r.read().decode('utf-8'))
        rows = data.get('entities') or data.get('data') or []
        out = []
        for e in rows[:15]:
            attr = e.get('attributes') or e
            out.append({
                'name': attr.get('name') or attr.get('title'),
                'jurisdiction': attr.get('jurisdiction') or attr.get('jurisdiction_code'),
                'incorporated_at': attr.get('incorporated_at') or attr.get('incorporated'),
                'entity_type': attr.get('entity_type') or 'entity',
                'url': (attr.get('links') or {}).get('self') or e.get('links', {}).get('self'),
            })
        _OO_CACHE[key] = (now + _OO_TTL_S, out)
        return out
    except Exception as e:
        logger.warning('Open Ownership search failed: %s', e)
        return []
