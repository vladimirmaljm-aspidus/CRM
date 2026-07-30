"""Magic-link authentication for portal — single-click sign-in.

Instead of asking the client to type a 6-digit OTP that may land in spam,
we email them a signed URL that logs them in on click. HMAC-SHA256 with
the app SECRET_KEY as the signing key; TTL enforced server-side.

Format of the URL: /portal/<token>?ml=<payload>.<sig>
    payload = base64url(json({t: token, iat: iso_now, exp: iso_now+ttl_min, jti: uuid}))
    sig     = base64url(hmac_sha256(SECRET_KEY, payload))

On click:
    1. Verify sig with constant-time compare.
    2. Ensure exp not passed.
    3. Ensure jti not already used (single-use).
    4. Grant portal session (same as after OTP verify).

Single-use is critical: without a jti register, an attacker who steals
the link (browser history export, referrer leak) can replay it. The
_USED_JTI set persists in the same DB used for portal sessions.
"""
import db
import base64
import hashlib
import hmac
import json
import os
import sqlite3
import time
import uuid
from datetime import datetime, timedelta, timezone

from config import DB_FILE


def _secret():
    """SECRET_KEY iz env-a. Ako nije postavljen, magični linkovi se
    onemogućavaju — NIKADA ne koristiti hardcoded fallback ključ jer
    bi svaka instanca sa istim source code-om delila isti signing key,
    što omogućava napadaču da forge-uje linkove za sve CRM instance."""
    key = (os.environ.get('SECRET_KEY') or '').strip()
    if key:
        return key.encode('utf-8')
    # Log upozorenje i vrati None — mint() i verify() moraju da ga proveravaju
    import logging
    logging.getLogger(__name__).warning(
        'MAGIC_LINK: SECRET_KEY nije postavljen — magic linkovi su onemogućeni. '
        'Postavite env SECRET_KEY pre upotrebe magic link funkcionalnosti.'
    )
    return None


def _b64url_enc(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode('ascii')


def _b64url_dec(s):
    pad = '=' * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _ensure_jti_table():
    with db.connect_raw(DB_FILE) as conn:
        conn.execute('''CREATE TABLE IF NOT EXISTS magic_link_used_jti (
            jti TEXT PRIMARY KEY,
            token TEXT,
            used_at TEXT NOT NULL,
            client_ip TEXT
        )''')
        # Housekeeping: pobrišemo jti-je starije od 7 dana (već su davno istekli)
        cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat().replace('+00:00','Z')
        conn.execute("DELETE FROM magic_link_used_jti WHERE used_at < ?", (cutoff,))
        conn.commit()


def mint(portal_token, ttl_minutes=15):
    """Vraća potpisan payload string koji ide u URL kao ?ml=<...>
    Vraća None ako SECRET_KEY nije konfigurisan."""
    secret = _secret()
    if secret is None:
        return None
    now = datetime.now(timezone.utc)
    payload = {
        't': portal_token,
        'iat': now.isoformat().replace('+00:00', 'Z'),
        'exp': (now + timedelta(minutes=int(ttl_minutes))).isoformat().replace('+00:00', 'Z'),
        'jti': uuid.uuid4().hex,
    }
    body = json.dumps(payload, separators=(',', ':')).encode('utf-8')
    p_b64 = _b64url_enc(body)
    sig = hmac.new(secret, p_b64.encode('ascii'), hashlib.sha256).digest()
    s_b64 = _b64url_enc(sig)
    return f'{p_b64}.{s_b64}'


def verify(ml_param, expected_portal_token, client_ip=None):
    """Vraća (ok, reason). Ne diže — pogrešan token je normal error path.

    Reason kodovi:
        'invalid_format', 'bad_signature', 'expired', 'token_mismatch',
        'already_used', 'no_secret_key', 'ok'
    """
    secret = _secret()
    if secret is None:
        return (False, 'no_secret_key')
    if not ml_param or '.' not in ml_param:
        return (False, 'invalid_format')
    try:
        p_b64, s_b64 = ml_param.split('.', 1)
        expected_sig = hmac.new(secret, p_b64.encode('ascii'), hashlib.sha256).digest()
        got_sig = _b64url_dec(s_b64)
        if not hmac.compare_digest(expected_sig, got_sig):
            return (False, 'bad_signature')
        payload = json.loads(_b64url_dec(p_b64).decode('utf-8'))
    except Exception:
        return (False, 'invalid_format')

    # Token match
    if str(payload.get('t')) != str(expected_portal_token):
        return (False, 'token_mismatch')

    # Expiry
    try:
        exp = datetime.fromisoformat(payload['exp'].replace('Z', '+00:00'))
    except Exception:
        return (False, 'invalid_format')
    if datetime.now(timezone.utc) > exp:
        return (False, 'expired')

    # Single-use (jti register)
    jti = payload.get('jti', '')
    if not jti:
        return (False, 'invalid_format')
    _ensure_jti_table()
    try:
        with db.connect_raw(DB_FILE) as conn:
            # Atomično: pokušaj INSERT — ako već postoji, PK conflict → already_used
            try:
                conn.execute(
                    "INSERT INTO magic_link_used_jti (jti, token, used_at, client_ip) VALUES (?, ?, ?, ?)",
                    (jti, expected_portal_token,
                     datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
                     (client_ip or '')[:64])
                )
                conn.commit()
            except db.IntegrityError:
                return (False, 'already_used')
    except Exception:
        return (False, 'invalid_format')

    return (True, 'ok')
