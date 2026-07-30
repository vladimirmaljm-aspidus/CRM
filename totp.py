"""TOTP (RFC 6238) — implementation without external dependencies.

Compatible with Google Authenticator, Authy, Microsoft Authenticator, 1Password,
and every otpauth:// spec-compliant TOTP client.

We do not use the third-party `pyotp` library — this keeps requirements.txt
lean and avoids a dependency for a trivially-implementable algorithm.
"""
import base64
import hashlib
import hmac
import os
import secrets
import struct
import time
from urllib.parse import quote


def generate_secret(length_bytes=20):
    """Generiše kriptografski slučajan base32-enkodovan TOTP secret.
    20 bajtova (=32 base32 karaktera bez padding-a) je RFC 6238 preporučeno.
    """
    raw = secrets.token_bytes(length_bytes)
    return base64.b32encode(raw).decode('ascii').rstrip('=')


def _decode_secret(secret):
    """Pretvara base32 secret u binarne bajtove. Prihvata sa ili bez padding-a."""
    s = str(secret or '').upper().replace(' ', '').strip()
    if not s:
        return b''
    # Add padding if missing (base32 requires multiple of 8)
    pad = (-len(s)) % 8
    return base64.b32decode(s + ('=' * pad))


def _hotp(secret_bytes, counter, digits=6):
    """RFC 4226 HOTP core. counter je big-endian uint64."""
    msg = struct.pack('>Q', counter)
    digest = hmac.new(secret_bytes, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    truncated = struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(truncated % (10 ** digits)).zfill(digits)


def totp_now(secret, timestamp=None, digits=6, period=30):
    """Vraća trenutni TOTP kod za dati secret."""
    if timestamp is None:
        timestamp = time.time()
    counter = int(timestamp) // period
    return _hotp(_decode_secret(secret), counter, digits)


def totp_verify(secret, code, timestamp=None, digits=6, period=30, window=1):
    """Vraća True ako `code` odgovara trenutnom vremenu ± `window` perioda.
    Window=1 znači ±30s tolerancije za clock skew — RFC preporuka."""
    if not code or not secret:
        return False
    code = str(code).strip().replace(' ', '')
    if len(code) != digits or not code.isdigit():
        return False
    if timestamp is None:
        timestamp = time.time()
    counter = int(timestamp) // period
    secret_bytes = _decode_secret(secret)
    for w in range(-window, window + 1):
        # constant-time compare da spreči timing attack na sam kod
        if hmac.compare_digest(_hotp(secret_bytes, counter + w, digits), code):
            return True
    return False


def provisioning_uri(secret, account_name, issuer):
    """Vraća otpauth:// URI koji QR reader pretvara u profil za Authenticator.

    Format: otpauth://totp/Issuer:account?secret=BASE32&issuer=Issuer&algorithm=SHA1&digits=6&period=30
    """
    label = f'{issuer}:{account_name}' if issuer else account_name
    params = {
        'secret': secret,
        'issuer': issuer or '',
        'algorithm': 'SHA1',
        'digits': '6',
        'period': '30',
    }
    qs = '&'.join(f'{k}={quote(v, safe="")}' for k, v in params.items() if v)
    return f'otpauth://totp/{quote(label, safe=":")}?{qs}'


def generate_recovery_codes(count=8):
    """Generiše `count` recovery kodova formata XXXX-XXXX (8 char base32).
    Vraća listu plain kodova + listu njihovih sha256 hesova (samo hasovi se
    skladište u bazi — plain se pokazuje korisniku SAMO jednom pri setup-u)."""
    plain = []
    hashed = []
    for _ in range(count):
        raw = base64.b32encode(secrets.token_bytes(5)).decode('ascii').rstrip('=')[:8]
        code = f'{raw[:4]}-{raw[4:]}'
        plain.append(code)
        hashed.append(hashlib.sha256(code.upper().replace('-', '').encode('utf-8')).hexdigest())
    return plain, hashed


def verify_recovery_code(hashed_list, code):
    """Constant-time provera da li je code (case-insensitive, dash-tolerant) u
    listi hasovanih. Vraća (matched, new_hashed_list_bez_iskorišćenog)."""
    if not hashed_list or not code:
        return (False, hashed_list or [])
    target = hashlib.sha256(str(code).upper().replace('-', '').strip().encode('utf-8')).hexdigest()
    remaining = []
    matched = False
    for h in hashed_list:
        if not matched and hmac.compare_digest(h, target):
            matched = True   # izbaci iz liste — recovery kod je jednokratan
        else:
            remaining.append(h)
    return (matched, remaining)
