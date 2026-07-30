"""Supabase Auth integration — JWT verify + Auth admin helpers.

Ovaj modul je centralno mesto gde Flask komunicira sa Supabase Auth-om:

  * `verify_supabase_jwt(token)` — offline HS256 provera preko SUPABASE_JWT_SECRET.
    Ne pravi HTTP poziv — pouzdano i brzo. Vraća payload dict (sub, email, aud…)
    ili None ako je token nevalidan/istekao.

  * `admin_client()` — lazy singleton supabase-py klijent sa SERVICE_ROLE ključem.
    Koristi se za admin operacije (create user, send reset email, invite).

  * `create_or_get_auth_user(email, ...)` — idempotentno kreira Auth korisnika ako
    ne postoji, i vraća njegov Supabase user id. Koristi se za migraciju postojećih
    partnera.

  * `send_password_reset(email)` — traži od Supabase-a da pošalje email sa
    reset-linkom. Supabase koristi šablon "Reset Password" iz Dashboard-a (koji smo
    već stilizovali u docs/SUPABASE_EMAIL_TEMPLATES.md).

  * `send_magic_link(email)` — traži da Supabase pošalje magic-link.

Feature flag `USE_SUPABASE_AUTH` (env) kontroliše da li portal koristi Supabase
Auth (True) ili legacy OTP flow (False). Legacy uvek ostaje aktivan u kodu tako
da je rollback trenutan — samo promeniš env varijablu i reload WSGI-ja.
"""
from __future__ import annotations

import os
import threading
from typing import Optional

from utils_reliability import retry

_admin_client_lock = threading.Lock()
_admin_client = None


def _transient_exceptions():
    """Klase izuzetaka za koje retry ima smisla — network glitch, timeout.
    NIKAD ne retry-uj auth greske (pogresna sifra) ili 4xx (validacija)."""
    excs = [ConnectionError, TimeoutError, OSError]
    try:
        import httpx
        excs.extend([httpx.ConnectError, httpx.ReadTimeout, httpx.ConnectTimeout,
                     httpx.RemoteProtocolError, httpx.NetworkError])
    except ImportError:
        pass
    return tuple(excs)


def use_supabase_auth() -> bool:
    """Da li portal koristi Supabase Auth (True) ili legacy OTP (False).
    Feature flag; svaka nova sesija/import čita env, tako da promena u .env
    posle Reload-a odmah stupa na snagu."""
    return os.environ.get("USE_SUPABASE_AUTH", "false").strip().lower() in ("1", "true", "yes", "on")


def _jwt_secret() -> str:
    sec = os.environ.get("SUPABASE_JWT_SECRET", "").strip()
    if not sec:
        raise RuntimeError(
            "SUPABASE_JWT_SECRET nije postavljen u .env. "
            "Vidi docs/SETUP_PYTHONANYWHERE.md korak 1A."
        )
    return sec


def _supabase_url() -> str:
    url = os.environ.get("SUPABASE_URL", "").strip()
    if not url:
        raise RuntimeError("SUPABASE_URL nije postavljen u .env.")
    return url


def _service_role_key() -> str:
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not key:
        raise RuntimeError(
            "SUPABASE_SERVICE_ROLE_KEY nije postavljen u .env. "
            "Vidi .env.example."
        )
    return key


_jwks_client_cache = {}


def _get_jwks_client(jwks_url: str):
    """Kesirani PyJWKClient — preuzima Supabase-ove javne ključeve jednom
    (sa TTL-om) pa reuse-uje za sve dalje verifikacije."""
    if jwks_url in _jwks_client_cache:
        return _jwks_client_cache[jwks_url]
    from jwt import PyJWKClient
    _jwks_client_cache[jwks_url] = PyJWKClient(
        jwks_url,
        cache_keys=True,
        lifespan=3600,   # 1h refresh
        timeout=8.0,
    )
    return _jwks_client_cache[jwks_url]


def verify_supabase_jwt(token: str) -> Optional[dict]:
    """Verifikuje Supabase JWT — podržava i HS256 (legacy) i ES256/RS256/EdDSA
    (nova asimetrična šema).

    Za HS256 koristi SUPABASE_JWT_SECRET iz .env (offline, brzo).
    Za asimetrične algoritme preuzima javni ključ iz Supabase-ovog JWKS
    endpoint-a `/auth/v1/.well-known/jwks.json` (kesirano 1h) i verifikuje
    potpis PyJWT-om preko `cryptography` paketa.

    Vraća payload dict (sub, email, aud, exp, role, …) na uspeh, None ako je
    token nevalidan iz bilo kog razloga. Nikada ne baca izuzetak.

    Bezbednosne provere koje PyJWT radi:
      * Eksplicitna lista algoritama (blokira "none" napad)
      * exp (nije istekao)
      * aud="authenticated" (Supabase default)
      * sub obavezan
    """
    if not token or not isinstance(token, str):
        return None
    try:
        import jwt  # PyJWT
    except ImportError:
        raise RuntimeError(
            "PyJWT nije instaliran. Pokreni: pip install 'PyJWT>=2.8'"
        )

    # Peek na algorithm iz token headera pa odaberi put verifikacije
    try:
        header = jwt.get_unverified_header(token)
    except Exception:
        return None
    alg = str(header.get("alg", "")).upper()

    try:
        if alg == "HS256":
            payload = jwt.decode(
                token,
                _jwt_secret(),
                algorithms=["HS256"],
                audience="authenticated",
                options={"require": ["exp", "sub"]},
            )
        elif alg in ("ES256", "RS256", "EDDSA", "ES384", "RS384"):
            # Asimetrični algoritam — fetch JWKS iz Supabase-a i verifikuj
            # javnim ključem koji odgovara kid-u iz token header-a.
            jwks_url = f"{_supabase_url().rstrip('/')}/auth/v1/.well-known/jwks.json"
            jwks_client = _get_jwks_client(jwks_url)
            signing_key = jwks_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=[alg],
                audience="authenticated",
                options={"require": ["exp", "sub"]},
            )
        else:
            # Nepoznat algoritam — odbij (spreči downgrade napad).
            return None
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidAudienceError:
        return None
    except jwt.InvalidTokenError:
        return None
    except Exception:
        return None

    if not isinstance(payload, dict):
        return None
    return payload


def admin_client():
    """Lazy singleton supabase-py klijent sa SERVICE_ROLE key-em.
    Ovaj klijent bypass-uje RLS i može da radi admin operacije nad Auth-om.
    NIKAD ne izlaži u frontend."""
    global _admin_client
    if _admin_client is not None:
        return _admin_client
    with _admin_client_lock:
        if _admin_client is not None:
            return _admin_client
        try:
            from supabase import create_client
        except ImportError as e:
            raise RuntimeError(
                "supabase paket nije instaliran. "
                "Pokreni: pip install 'supabase>=2.0'"
            ) from e
        _admin_client = create_client(_supabase_url(), _service_role_key())
        return _admin_client


def get_user_by_email(email: str) -> Optional[dict]:
    """Vraća Supabase Auth user dict za dati email, ili None ako ne postoji.
    Koristi admin API (bypass RLS). Efikasno je jer paginira po 200."""
    if not email or "@" not in email:
        return None
    email_lower = email.strip().lower()
    client = admin_client()
    page = 1
    while page < 100:  # sigurnosni limit
        resp = client.auth.admin.list_users(page=page, per_page=200)
        # supabase-py 2.x vraća list ili objekat sa .users — normalizuj
        users = resp if isinstance(resp, list) else getattr(resp, "users", None) or []
        if not users:
            return None
        for u in users:
            u_email = getattr(u, "email", None) or (u.get("email") if isinstance(u, dict) else None)
            if u_email and u_email.strip().lower() == email_lower:
                return u if isinstance(u, dict) else u.model_dump()
        if len(users) < 200:
            return None
        page += 1
    return None


def create_or_get_auth_user(
    email: str,
    partner_id: Optional[str] = None,
    company_name: Optional[str] = None,
    email_confirm: bool = True,
) -> tuple[Optional[str], str]:
    """Idempotentno pravi Supabase Auth korisnika za dati email.

    OPTIMIZACIJA: umesto `list_users` pre-check-a (koji trosi Cloudflare rate
    limite i uzrokuje ES256 JWT parse greške), odmah pokušava CREATE i
    ako Supabase vrati "email already registered" onda tek radi lookup.
    Ovo znatno smanjuje broj admin-API poziva za novu populaciju.

    Vraća (user_id, status) gde status ∈ {"created", "existing", "error:<...>"}
    """
    if not email or "@" not in email:
        return None, "error:invalid_email"
    email_lower = email.strip().lower()
    client = admin_client()

    metadata = {}
    if partner_id:
        metadata["partner_id"] = str(partner_id)
    if company_name:
        metadata["company_name"] = str(company_name)

    try:
        resp = client.auth.admin.create_user({
            "email": email_lower,
            "email_confirm": bool(email_confirm),
            "user_metadata": metadata,
        })
        user = getattr(resp, "user", None) or (resp.get("user") if isinstance(resp, dict) else resp)
        uid = getattr(user, "id", None) or (user.get("id") if isinstance(user, dict) else None)
        if uid:
            return str(uid), "created"
        return None, "error:no_id_returned"
    except Exception as e:
        msg = str(e).lower()
        # Supabase vraća 422 "email address ... already been registered" ili
        # "user already registered" — u tom slučaju uradi lookup.
        if "already" in msg and ("registered" in msg or "exists" in msg):
            existing = get_user_by_email(email_lower)
            if existing:
                uid = existing.get("id") if isinstance(existing, dict) else getattr(existing, "id", None)
                return str(uid) if uid else None, "existing"
            return None, "error:exists_but_lookup_failed"
        return None, f"error:{e.__class__.__name__}:{e}"


def send_password_reset(email: str, redirect_to: Optional[str] = None) -> tuple[bool, str]:
    """Traži od Supabase-a da pošalje reset-password email. Šablon je onaj
    koji je admin podesio u Dashboard-u (Auth → Email Templates).
    Vraća (ok, detail)."""
    if not email or "@" not in email:
        return False, "invalid_email"
    client = admin_client()

    @retry(attempts=3, initial_delay=0.6, backoff=2.0, exceptions=_transient_exceptions())
    def _do():
        opts = {}
        if redirect_to:
            opts["redirect_to"] = redirect_to
        # supabase-py: reset_password_email(email, options={"redirect_to": ...})
        return client.auth.reset_password_email(email.strip().lower(), opts or None)

    try:
        _do()
        return True, "sent"
    except Exception as e:
        return False, f"{e.__class__.__name__}:{e}"


def signin_with_password(email: str, password: str) -> tuple[Optional[dict], str]:
    """Server-side password sign-in preko Supabase Auth REST API-ja.

    Ne zahteva supabase-js na klijentu — svaki HTTP klijent može da radi ovo.
    Vraća (session_dict, detail) gde session_dict sadrži {access_token,
    refresh_token, user, expires_at} na uspeh, ili (None, error_msg) na fail.

    Rate-limitovano na Supabase strani (default 30/hour po IP-u)."""
    if not email or not password:
        return None, "invalid_params"
    try:
        import httpx
    except ImportError:
        return None, "httpx_missing"
    anon = os.environ.get("SUPABASE_ANON_KEY", "").strip()
    if not anon:
        return None, "no_anon_key"
    url = f"{_supabase_url().rstrip('/')}/auth/v1/token?grant_type=password"

    @retry(attempts=3, initial_delay=0.5, backoff=2.0, exceptions=_transient_exceptions())
    def _post():
        return httpx.post(
            url,
            headers={"apikey": anon, "Content-Type": "application/json"},
            json={"email": email.strip().lower(), "password": password},
            timeout=15.0,
        )

    try:
        r = _post()
    except Exception as e:
        return None, f"network:{e.__class__.__name__}"
    if r.status_code == 200:
        data = r.json()
        return data, "signed_in"
    try:
        err = r.json()
        msg = err.get("error_description") or err.get("msg") or err.get("error") or str(err)
    except Exception:
        msg = r.text[:200] if r.text else f"http_{r.status_code}"
    return None, f"http_{r.status_code}:{msg}"


def update_user_password(user_id: str, new_password: str) -> tuple[bool, str]:
    """Postavi novu lozinku za korisnika preko Supabase admin API-ja.
    Koristi se u recovery flow-u: nakon što offline verifikujemo JWT
    iz reset link-a i izvadimo `sub`, ovaj poziv postavlja lozinku bez
    potrebe za klijentskom supabase-js sesijom.

    Vraća (ok, detail)."""
    if not user_id or not new_password:
        return False, "invalid_params"
    if len(new_password) < 12:
        return False, "password_too_short"
    client = admin_client()

    @retry(attempts=3, initial_delay=0.6, backoff=2.0, exceptions=_transient_exceptions())
    def _do():
        return client.auth.admin.update_user_by_id(str(user_id), {"password": new_password})

    try:
        _do()
        return True, "updated"
    except Exception as e:
        return False, f"{e.__class__.__name__}:{e}"


def send_magic_link(email: str, redirect_to: Optional[str] = None) -> tuple[bool, str]:
    """Traži od Supabase-a da pošalje magic-link (sign_in_with_otp bez lozinke).
    Vraća (ok, detail)."""
    if not email or "@" not in email:
        return False, "invalid_email"
    client = admin_client()

    @retry(attempts=3, initial_delay=0.6, backoff=2.0, exceptions=_transient_exceptions())
    def _do():
        opts = {"email": email.strip().lower()}
        if redirect_to:
            opts["options"] = {"email_redirect_to": redirect_to}
        return client.auth.sign_in_with_otp(opts)

    try:
        _do()
        return True, "sent"
    except Exception as e:
        return False, f"{e.__class__.__name__}:{e}"


def health() -> dict:
    """Za verify skript / admin health page. Ne vraća tajne."""
    try:
        client = admin_client()
        # Trivijalan admin poziv da proveri da li servis odgovara
        client.auth.admin.list_users(page=1, per_page=1)
        return {"ok": True, "supabase_auth_enabled": use_supabase_auth()}
    except Exception as e:
        return {"ok": False, "error": f"{e.__class__.__name__}:{e}", "supabase_auth_enabled": use_supabase_auth()}
