import sqlite3
import json
import time
import secrets
import db as _db_portal
from flask import Blueprint
from config import PORTAL_DB_FILE, DB_FILE
from utils import decrypt_data, FirewallCache

portal_bp = Blueprint('portal', __name__)

# ==========================================================
#  PORTAL SESSION STORAGE — SQLite-backed
# ==========================================================
# Previously these were in-memory Python dicts, which meant sessions
# were lost on server restart. Now they are persisted in the portal
# database (portal_otps, portal_auth_sessions, pending_email_sessions).
#
# Schema:
#   portal_otps:          token -> {otp, expires, attempts}
#   portal_auth_sessions: token -> {key, expires, last_active, partner_id, bound_ip}
#   pending_email_sessions: session_id -> {token, partner_id, email, expires}

# Podrazumevani TTL-ovi (u sekundama). Admin ih menja preko settings.firewall
# i vrednosti se učitavaju u FirewallCache pri startu / posle svakog save-a.
PORTAL_SESSION_TTL = 3600
PORTAL_INACTIVITY_TTL = 900
PORTAL_OTP_TTL = 300
PORTAL_OTP_MAX_ATTEMPTS = 5


def _fw_ttl(key, default):
    """Uzmi konfigurabilnu vrednost iz FirewallCache (postavlja je admin), inače default."""
    try:
        return int(FirewallCache.settings.get(key, default))
    except (TypeError, ValueError):
        return default


def _portal_conn():
    """Vraća novu SQLite konekciju ka portal bazi."""
    return _db_portal.connect_raw(PORTAL_DB_FILE)


def init_portal_db():
    conn = None
    try:
        conn = _db_portal.connect_raw(PORTAL_DB_FILE)
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS kyc_submissions
                     (id TEXT PRIMARY KEY, partner_id TEXT, token TEXT, data JSON, submitted_at TEXT)''')
        c.execute('''CREATE TABLE IF NOT EXISTS portal_products
                     (id TEXT PRIMARY KEY, partner_id TEXT, data JSON, status TEXT, created_at TEXT)''')
        c.execute('''CREATE TABLE IF NOT EXISTS portal_activity_log
                     (id TEXT PRIMARY KEY, partner_id TEXT, action TEXT, details TEXT,
                      ip_address TEXT, user_agent TEXT, location TEXT, timestamp TEXT)''')
        # --- Portal session tables (persisted across restarts) ---
        c.execute('''CREATE TABLE IF NOT EXISTS portal_otps
                     (token TEXT PRIMARY KEY, otp TEXT, expires REAL, attempts INTEGER)''')
        c.execute('''CREATE TABLE IF NOT EXISTS portal_auth_sessions
                     (token TEXT PRIMARY KEY, key TEXT, expires REAL, last_active REAL,
                      partner_id TEXT, bound_ip TEXT)''')
        c.execute('''CREATE TABLE IF NOT EXISTS pending_email_sessions
                     (session_id TEXT PRIMARY KEY, token TEXT, partner_id TEXT,
                      email TEXT, expires REAL)''')
        conn.commit()
    finally:
        if conn: conn.close()

init_portal_db()


def check_portal_rate_limit(ip):
    if ip in FirewallCache.whitelist: return True
    now = time.time()
    FirewallCache.portal_attempts[ip] = [t for t in FirewallCache.portal_attempts.get(ip, []) if now - t < 60]
    if len(FirewallCache.portal_attempts.get(ip, [])) > FirewallCache.settings.get('max_portal', 50): return False
    FirewallCache.portal_attempts.setdefault(ip, []).append(now)
    return True


def safe_parse(data_str):
    """Pokušava JSON parse; ako ne uspe, pretpostavlja da je payload šifrovan
    Fernet-om pa poziva decrypt_data(). Bare except zamenjen preciznijim
    hvatanjem — hvatamo samo očekivane greške parsiranja/tipa, ne KeyboardInterrupt
    i sl."""
    if data_str is None or data_str == '':
        return {}
    try:
        return json.loads(data_str)
    except (json.JSONDecodeError, TypeError, ValueError):
        return decrypt_data(data_str)


# ==========================================================
#  CENTRALIZOVANA PORTAL AUTENTIFIKACIJA (SQLite-backed)
# ==========================================================

def _cleanup_expired():
    """Sprečava neograničeno rastenje baze od isteklih OTP-ova i sesija."""
    now = time.time()
    inactivity = _fw_ttl('portal_inactivity', PORTAL_INACTIVITY_TTL)
    try:
        conn = _portal_conn()
        try:
            conn.execute("DELETE FROM portal_otps WHERE expires < ?", (now,))
            conn.execute("DELETE FROM portal_auth_sessions WHERE expires < ? OR (? - last_active) > ?",
                         (now, now, inactivity))
            conn.execute("DELETE FROM pending_email_sessions WHERE expires < ?", (now,))
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass


# ---- Helper functions for external access (replaces direct dict access) ----

def get_portal_otp(token):
    """Vraća OTP record za dati token, ili None. (Replaces portal_otps.get(token))"""
    try:
        conn = _portal_conn()
        try:
            row = conn.execute(
                "SELECT otp, expires, attempts FROM portal_otps WHERE token=?",
                (token,)
            ).fetchone()
            if row:
                return {'otp': row[0], 'expires': row[1], 'attempts': row[2]}
        finally:
            conn.close()
    except Exception:
        pass
    return None


def delete_portal_otp(token):
    """Briše OTP record za dati token. (Replaces portal_otps.pop(token, None))"""
    try:
        conn = _portal_conn()
        try:
            conn.execute("DELETE FROM portal_otps WHERE token=?", (token,))
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass


def get_portal_session(token):
    """Vraća auth session record za dati token, ili None. (Replaces portal_auth_sessions.get(token))"""
    try:
        conn = _portal_conn()
        try:
            row = conn.execute(
                "SELECT key, expires, last_active, partner_id, bound_ip FROM portal_auth_sessions WHERE token=?",
                (token,)
            ).fetchone()
            if row:
                return {'key': row[0], 'expires': row[1], 'last_active': row[2],
                        'partner_id': row[3], 'bound_ip': row[4]}
        finally:
            conn.close()
    except Exception:
        pass
    return None


def delete_portal_session(token):
    """Briše auth session za dati token. (Replaces portal_auth_sessions.pop(token, None))"""
    try:
        conn = _portal_conn()
        try:
            conn.execute("DELETE FROM portal_auth_sessions WHERE token=?", (token,))
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass


def set_pending_email_session(session_id, data):
    """Snima pending email session. (Replaces pending_email_sessions[session_id] = data)"""
    try:
        conn = _portal_conn()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO pending_email_sessions (session_id, token, partner_id, email, expires) VALUES (?, ?, ?, ?, ?)",
                (session_id, data.get('token'), data.get('partner_id'),
                 data.get('email'), data.get('expires', 0))
            )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass


def get_pending_email_session(session_id):
    """Vraća pending email session, ili None. (Replaces pending_email_sessions.get(session_id))"""
    try:
        conn = _portal_conn()
        try:
            row = conn.execute(
                "SELECT token, partner_id, email, expires FROM pending_email_sessions WHERE session_id=?",
                (session_id,)
            ).fetchone()
            if row:
                return {'token': row[0], 'partner_id': row[1], 'email': row[2], 'expires': row[3]}
        finally:
            conn.close()
    except Exception:
        pass
    return None


def delete_pending_email_session(session_id):
    """Briše pending email session. (Replaces pending_email_sessions.pop(session_id, None))"""
    try:
        conn = _portal_conn()
        try:
            conn.execute("DELETE FROM pending_email_sessions WHERE session_id=?", (session_id,))
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass


def list_pending_email_sessions():
    """Vraća listu (session_id, data) tuples. (Replaces pending_email_sessions.items())"""
    try:
        conn = _portal_conn()
        try:
            rows = conn.execute(
                "SELECT session_id, token, partner_id, email, expires FROM pending_email_sessions"
            ).fetchall()
            return [(r[0], {'token': r[1], 'partner_id': r[2], 'email': r[3], 'expires': r[4]}) for r in rows]
        finally:
            conn.close()
    except Exception:
        return []


# ---- Core auth functions (now SQLite-backed) ----

def create_portal_otp(token):
    """Generiše novi OTP i resetuje brojač pokušaja za dati token."""
    _cleanup_expired()
    otp = str(secrets.randbelow(900000) + 100000)
    expires = time.time() + _fw_ttl('portal_otp', PORTAL_OTP_TTL)
    try:
        conn = _portal_conn()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO portal_otps (token, otp, expires, attempts) VALUES (?, ?, ?, 0)",
                (token, otp, expires)
            )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass
    return otp


def verify_portal_otp(token, user_otp):
    """Constant-time provera OTP-a sa limitom pokušaja (anti brute-force).
    Vraća novi auth_key na uspeh, ili None na neuspeh."""
    _cleanup_expired()
    record = get_portal_otp(token)
    if not record:
        return None
    if record['expires'] < time.time():
        delete_portal_otp(token)
        return None
    # Limit pokušaja: posle N grešaka, kod se poništava (mora nov OTP).
    if record.get('attempts', 0) >= PORTAL_OTP_MAX_ATTEMPTS:
        delete_portal_otp(token)
        return None
    if user_otp and secrets.compare_digest(str(record['otp']), str(user_otp)):
        delete_portal_otp(token)
        return create_portal_session(token)
    # Increment attempts
    try:
        conn = _portal_conn()
        try:
            conn.execute(
                "UPDATE portal_otps SET attempts = attempts + 1 WHERE token=?",
                (token,)
            )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass
    return None


def create_portal_session(token, partner_id=None):
    key = secrets.token_hex(32)
    now = time.time()
    from flask import request as _req
    ip = _req.headers.get('X-Forwarded-For', _req.remote_addr) if _req else ''
    if ip and ',' in ip: ip = ip.split(',')[0].strip()
    expires = now + _fw_ttl('portal_session', PORTAL_SESSION_TTL)
    try:
        conn = _portal_conn()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO portal_auth_sessions (token, key, expires, last_active, partner_id, bound_ip) VALUES (?, ?, ?, ?, ?, ?)",
                (token, key, expires, now, partner_id, ip or None)
            )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass
    return key


def verify_portal_session(token, auth_header):
    """Constant-time provera portal sesije sa isticanjem (TTL + inactivity + IP binding)."""
    if not token or not auth_header:
        return False
    sess = get_portal_session(token)
    if not sess:
        return False
    now = time.time()
    if sess['expires'] < now:
        delete_portal_session(token)
        return False
    if now - sess.get('last_active', 0) > _fw_ttl('portal_inactivity', PORTAL_INACTIVITY_TTL):
        delete_portal_session(token)
        return False
    if not secrets.compare_digest(sess['key'], auth_header):
        return False

    # IP binding — ako se sesija koristi sa druge IP-e, poništi je i loguj kao suspicious.
    try:
        from flask import request as _req
        cur_ip = _req.headers.get('X-Forwarded-For', _req.remote_addr) if _req else ''
        if cur_ip and ',' in cur_ip: cur_ip = cur_ip.split(',')[0].strip()
        if sess.get('bound_ip') and cur_ip and cur_ip != sess['bound_ip']:
            delete_portal_session(token)
            try:
                log_portal_activity(sess.get('partner_id'),
                                    'SESSION_HIJACK_BLOCKED',
                                    f'Portal auth_key seen from {cur_ip}, bound to {sess["bound_ip"]}',
                                    ip=cur_ip)
            except Exception:
                pass
            return False
    except Exception:
        pass

    # Update last_active in SQLite
    try:
        conn = _portal_conn()
        try:
            conn.execute(
                "UPDATE portal_auth_sessions SET last_active=? WHERE token=?",
                (now, token)
            )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass
    return True


def find_partner_by_token(cursor, token, enforce_active=True):
    """Pronalazi partnera po portalTokenu. Ako enforce_active i portal je opozvan
    (isPortalActive == False), tretira se kao da partner ne postoji (Kill Switch).
    Vraća (partner_id, partner_dict) ili (None, None)."""
    if not token:
        return None, None
    cursor.execute("SELECT id, data FROM partners")
    for r in cursor.fetchall():
        p_data = safe_parse(r[1])
        if p_data.get('portalToken') == token:
            if enforce_active and p_data.get('isPortalActive', True) is False:
                return None, None
            return r[0], p_data
    return None, None


def log_portal_activity(partner_id, action, details, ip=None, user_agent=None):
    """Beleži jedno dešavanje iz PORTALA (klijentski nalozi) u posebnu tabelu
    razdvojenu od CRM audit-a. Automatski obogaćuje unos IP geolokacijom
    (get_ip_info je kesiran, ne usporava) da admin može da vidi zemlju/grad
    i klikne na Google Maps za koordinate."""
    from flask import request as _req
    from utils import get_ip_info
    if ip is None:
        try:
            ip = _req.headers.get('X-Forwarded-For', _req.remote_addr)
            if ip and ',' in ip: ip = ip.split(',')[0].strip()
        except Exception:
            ip = None
    if user_agent is None:
        try:
            user_agent = _req.user_agent.string if _req.user_agent else 'Unknown'
        except Exception:
            user_agent = 'Unknown'

    # Geo lookup (kesiran)
    location_str = 'N/A'
    try:
        network_info, ip_location, _tz = get_ip_info(ip) if ip else ('N/A', 'N/A', 'N/A')
        # Sastavimo "grad, zemlja | lat,lng" format da UI može da parsira mapu.
        parts = []
        if network_info and network_info not in ('N/A', 'UNKNOWN_IP_LOCATION', 'LOCAL_NETWORK'):
            parts.append(network_info)
        if ip_location and ip_location != 'N/A':
            parts.append(ip_location)
        if parts:
            location_str = ' | '.join(parts)
    except Exception:
        pass

    entry_id = secrets.token_hex(12)
    timestamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    try:
        conn = _db_portal.connect_raw(PORTAL_DB_FILE)
        conn.execute(
            "INSERT INTO portal_activity_log (id, partner_id, action, details, ip_address, user_agent, location, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (entry_id, partner_id, action, details, ip, user_agent, location_str, timestamp)
        )
        conn.commit()
        conn.close()
    except Exception:
        pass


def is_partner_premium(cursor_or_data):
    """Vraća True ako je partner PREMIUM klijent — dobija poseban tretman:
      • GPS lokacija NIJE obavezna za OTP login
      • KYC status ne blokira pristup portalu (uvek 'approved' na svojoj strani)
      • KYC forma sva polja opciona (nema IBAN/BIC/VIES hard-block-ova)
      • Poseban vizuelni prikaz (Premium tema)

    Parametar može biti partner dict (već učitan) ili tuple (partner_id, partner_dict)
    ili samo partner_id string (u tom slučaju učitavamo iz baze)."""
    if isinstance(cursor_or_data, dict):
        return bool(cursor_or_data.get('isPremium'))
    if isinstance(cursor_or_data, tuple) and len(cursor_or_data) >= 2:
        return bool((cursor_or_data[1] or {}).get('isPremium'))
    # string ID case — učitaj iz baze
    pid = str(cursor_or_data or '').strip()
    if not pid:
        return False
    try:
        with _db_portal.connect_raw(DB_FILE, timeout=10.0) as conn:
            row = conn.execute("SELECT data FROM partners WHERE id=?", (pid,)).fetchone()
        if row:
            p = safe_parse(row[0])
            return bool(isinstance(p, dict) and p.get('isPremium'))
    except Exception:
        pass
    return False


def find_partner_by_email(email):
    if not email:
        return None, None
    email_lower = email.strip().lower()
    conn = _db_portal.connect_raw(DB_FILE)
    c = conn.cursor()
    c.execute('SELECT id, data FROM partners')
    for row in c.fetchall():
        p = safe_parse(row[1])
        p_email = (p.get('contact', {}).get('email') or p.get('email', '')).strip().lower()
        if p_email == email_lower:
            conn.close()
            return row[0], p
    conn.close()
    return None, None


# Učitavanje svih modula kako bi rute bile aktivne
from . import auth, data, actions, auth_supabase  # noqa: E402,F401
