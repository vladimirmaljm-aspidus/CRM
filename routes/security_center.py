"""
Round F — SECURITY CENTER
==========================
Self-service security page za CRM korisnike i admin-only globalne kontrole.

Endpointi:
  /profile/security                       — HTML self-service (sessions, devices, history, password)
  /api/security/sessions                  — moje aktivne sesije
  /api/security/sessions/<sid>/revoke     — terminiraj jednu sesiju
  /api/security/login-history             — poslednjih 50 login-a
  /api/security/known-ips                 — moje pouzdane IP adrese
  /api/security/known-ips/<id>/forget     — obriši IP (sledeci login iz nje pravi novu notifikaciju)
  /api/security/trusted-devices           — spisak uredjaja
  /api/security/trusted-devices/<id>/revoke  — ukloni uredjaj
  /api/security/password/policy           — pravila (min duzina, age policy)
  /api/security/magic-link                — request magic-link login (email-based)
  /api/security/lockout/status            — proveri da li si zakljucan
  /api/admin/security/policy              — GET/POST global policy (2FA enforce, max attempts, lockout min)
  /api/admin/security/force-password-reset/<uid>   — postavi must_change_password=1
  /api/admin/security/unlock/<uid>        — otkljucaj zakljucanog user-a
  /api/admin/security/break-glass/<uid>   — generisi jednokratni recovery link za admin-a
"""
from __future__ import annotations
import db

import hashlib
import json
import secrets
import sqlite3
import uuid
from datetime import datetime, timezone, timedelta

from flask import Blueprint, jsonify, request, session, render_template

from config import DB_FILE
from utils import login_required, log_audit, get_client_ip

security_bp = Blueprint('security_bp', __name__)


# =========================================================================
#  HELPERS
# =========================================================================

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def _get_policy() -> dict:
    """Cita security policy iz settings tabele. Defaults ako nema entry-ja."""
    defaults = {
        'enforce_2fa_for_admins': False,
        'max_login_attempts': 10,
        'lockout_minutes': 15,
        'password_min_length': 12,
        'password_max_age_days': 0,        # 0 = disabled
        'password_history_count': 5,
        'notify_new_ip': True,
        'trusted_device_ttl_days': 30,
        'magic_link_ttl_minutes': 15,
    }
    try:
        with db.connect_raw(DB_FILE) as conn:
            row = conn.execute("SELECT value FROM settings WHERE key='security_policy'").fetchone()
            if row and row[0]:
                stored = json.loads(row[0])
                if isinstance(stored, dict):
                    defaults.update(stored)
    except Exception:
        pass
    return defaults


def _set_policy(patch: dict) -> dict:
    current = _get_policy()
    current.update({k: v for k, v in patch.items() if k in current})
    with db.connect_raw(DB_FILE) as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('security_policy', ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (json.dumps(current),)
        )
    return current


# =========================================================================
#  PAGE
# =========================================================================

@security_bp.route('/profile/security', methods=['GET'])
@login_required
def security_page():
    return render_template('security_center.html')


# =========================================================================
#  SESSIONS
# =========================================================================

@security_bp.route('/api/security/sessions', methods=['GET'])
@login_required
def my_sessions():
    uid = session.get('user_id')
    current_sid = session.get('session_id')
    with db.connect_raw(DB_FILE) as conn:
        rows = conn.execute(
            "SELECT id, created_at, last_seen_at, ip, country, ua_family, device_label, revoked "
            "FROM user_sessions WHERE user_id=? ORDER BY last_seen_at DESC LIMIT 50",
            (uid,)
        ).fetchall()
    return jsonify({
        'sessions': [{
            'id': r[0], 'created_at': r[1], 'last_seen_at': r[2],
            'ip': r[3], 'country': r[4], 'ua': r[5], 'device': r[6],
            'revoked': bool(r[7]), 'is_current': r[0] == current_sid,
        } for r in rows]
    })


@security_bp.route('/api/security/sessions/<sid>/revoke', methods=['POST'])
@login_required
def revoke_session(sid):
    uid = session.get('user_id')
    now = _now_iso()
    with db.connect_raw(DB_FILE) as conn:
        # user moze da revoke-uje SAMO svoje sesije (WHERE user_id=?)
        n = conn.execute(
            "UPDATE user_sessions SET revoked=1, revoked_at=?, revoked_reason='user_revoked' "
            "WHERE id=? AND user_id=? AND revoked=0",
            (now, sid, uid)
        ).rowcount
    if not n:
        return jsonify({'error': 'not_found_or_already_revoked'}), 404
    log_audit('SECURITY', 'session', f'User revoked session {sid[:8]}…')
    return jsonify({'revoked': True})


# =========================================================================
#  LOGIN HISTORY (koristi audit_logs)
# =========================================================================

@security_bp.route('/api/security/login-history', methods=['GET'])
@login_required
def login_history():
    from config import AUDIT_DB_FILE
    uid = session.get('user_id')
    with db.connect_raw(AUDIT_DB_FILE) as conn:
        rows = conn.execute(
            "SELECT timestamp, action, ip_address, user_agent, details, location "
            "FROM audit_logs "
            "WHERE user_id=? AND action IN ('LOGIN','SECURITY','LOGOUT') "
            "ORDER BY timestamp DESC LIMIT 100",
            (uid,)
        ).fetchall()
    return jsonify({
        'events': [{
            'timestamp': r[0], 'action': r[1], 'ip': r[2],
            'user_agent': r[3], 'details': r[4], 'location': r[5],
        } for r in rows]
    })


# =========================================================================
#  KNOWN IPs
# =========================================================================

@security_bp.route('/api/security/known-ips', methods=['GET'])
@login_required
def known_ips():
    uid = session.get('user_id')
    with db.connect_raw(DB_FILE) as conn:
        rows = conn.execute(
            "SELECT id, ip, country, city, first_seen, last_seen, login_count "
            "FROM known_ips WHERE user_id=? ORDER BY last_seen DESC",
            (uid,)
        ).fetchall()
    return jsonify({
        'ips': [{
            'id': r[0], 'ip': r[1], 'country': r[2], 'city': r[3],
            'first_seen': r[4], 'last_seen': r[5], 'login_count': r[6],
        } for r in rows]
    })


@security_bp.route('/api/security/known-ips/<kid>/forget', methods=['POST'])
@login_required
def forget_ip(kid):
    uid = session.get('user_id')
    with db.connect_raw(DB_FILE) as conn:
        n = conn.execute("DELETE FROM known_ips WHERE id=? AND user_id=?",
                         (kid, uid)).rowcount
    log_audit('SECURITY', 'known_ips', f'User forgot known IP {kid}')
    return jsonify({'deleted': n})


# =========================================================================
#  TRUSTED DEVICES
# =========================================================================

@security_bp.route('/api/security/trusted-devices', methods=['GET'])
@login_required
def trusted_devices():
    uid = session.get('user_id')
    with db.connect_raw(DB_FILE) as conn:
        rows = conn.execute(
            "SELECT id, label, created_at, expires_at, last_seen_at, last_ip, revoked "
            "FROM trusted_devices WHERE user_id=? ORDER BY last_seen_at DESC NULLS LAST",
            (uid,)
        ).fetchall()
    return jsonify({
        'devices': [{
            'id': r[0], 'label': r[1], 'created_at': r[2], 'expires_at': r[3],
            'last_seen_at': r[4], 'last_ip': r[5], 'revoked': bool(r[6]),
        } for r in rows]
    })


@security_bp.route('/api/security/trusted-devices/<did>/revoke', methods=['POST'])
@login_required
def revoke_device(did):
    uid = session.get('user_id')
    with db.connect_raw(DB_FILE) as conn:
        n = conn.execute("UPDATE trusted_devices SET revoked=1 WHERE id=? AND user_id=?",
                         (did, uid)).rowcount
    log_audit('SECURITY', 'trusted_device', f'User revoked device {did}')
    return jsonify({'revoked': n})


# =========================================================================
#  POLICY (public — svako moze da vidi trenutna pravila)
# =========================================================================

@security_bp.route('/api/security/password/policy', methods=['GET'])
def password_policy_public():
    p = _get_policy()
    # Ne izlaze admin-only polja
    return jsonify({
        'password_min_length': p['password_min_length'],
        'password_max_age_days': p['password_max_age_days'],
        'password_history_count': p['password_history_count'],
        'magic_link_ttl_minutes': p['magic_link_ttl_minutes'],
    })


# =========================================================================
#  MAGIC LINK LOGIN (passwordless)
# =========================================================================

@security_bp.route('/api/security/magic-link', methods=['POST'])
def request_magic_link():
    """Passwordless login: user daje username, dobije email sa jednokratnim linkom.
    Ne otkriva da li username postoji (constant-time response), ali stvarno salje mejl
    samo ako user postoji i ima email na profilu."""
    body = request.get_json(silent=True) or {}
    username = str(body.get('username') or '').strip().lower()
    if not username or len(username) > 100:
        return jsonify({'status': 'ok'})  # constant response

    ip = get_client_ip()
    with db.connect_raw(DB_FILE) as conn:
        row = conn.execute("SELECT id, email, username FROM users WHERE LOWER(username)=?",
                           (username,)).fetchone()

    if not row or not row[1]:
        # I dalje vracamo ok da napadac ne moze da otkrije koji username-i imaju email
        return jsonify({'status': 'ok'})

    uid, email, real_username = row
    tok = secrets.token_urlsafe(48)
    policy = _get_policy()
    expires = (datetime.now(timezone.utc) + timedelta(minutes=policy['magic_link_ttl_minutes'])).isoformat().replace('+00:00', 'Z')

    with db.connect_raw(DB_FILE) as conn:
        conn.execute(
            "INSERT INTO magic_login_tokens (token, user_id, purpose, created_at, expires_at, request_ip) "
            "VALUES (?, ?, 'login', ?, ?, ?)",
            (_hash_token(tok), uid, _now_iso(), expires, ip)
        )

    # Sastavi link i posalji preko utils_email
    from urllib.parse import urljoin
    base = request.host_url.rstrip('/')
    link = f"{base}/login/magic?t={tok}"
    try:
        from utils_email import send_email_now
        subject = 'Aspidus — Sign-in link'
        body_html = (
            f"<p>Hi {real_username},</p>"
            f"<p>Use this one-time link to sign in to Aspidus CRM. "
            f"It expires in {policy['magic_link_ttl_minutes']} minutes and can be used once.</p>"
            f"<p><a href=\"{link}\">Sign in now</a></p>"
            f"<p>Requested from IP {ip or 'unknown'}. If this wasn't you, ignore this message and change your password.</p>"
        )
        send_email_now(email, subject, body_html, body_type='html')
    except Exception as _e:
        pass  # ne otkrivamo email failure napadacu

    log_audit('SECURITY', 'magic_link', f'Magic-link requested for user {real_username}')
    return jsonify({'status': 'ok'})


@security_bp.route('/login/magic', methods=['GET'])
def consume_magic_link():
    """Ovaj endpoint klijent posećuje kroz link iz emaila. Aktivira sesiju
    i redirektuje na /. Ne trazi ni lozinku ni 2FA (magic link je vec dokaz)."""
    tok = request.args.get('t', '')
    if not tok:
        return "Missing token.", 400
    tok_hash = _hash_token(tok)
    now_iso = _now_iso()
    with db.connect_raw(DB_FILE) as conn:
        row = conn.execute(
            "SELECT user_id, expires_at, used_at, purpose FROM magic_login_tokens WHERE token=?",
            (tok_hash,)
        ).fetchone()
        if not row:
            return "Invalid or already-used link.", 400
        uid, expires_at, used_at, purpose = row
        if used_at:
            return "This link has already been used.", 400
        if expires_at < now_iso:
            return "This link has expired. Request a new one from the sign-in page.", 400
        # Ucitaj usera
        u = conn.execute("SELECT id, username, role, permissions, signature FROM users WHERE id=?", (uid,)).fetchone()
        if not u:
            return "User not found.", 400
        # Mark used
        conn.execute("UPDATE magic_login_tokens SET used_at=? WHERE token=?", (now_iso, tok_hash))

    # Postavi session isto kao standardni login (bez GPS/2FA gate-a — magic link je vec pouzdan)
    from utils import get_user_token_version
    session.permanent = True
    session['user_id'] = u[0]
    session['username'] = u[1]
    session['role'] = u[2]
    session['login_time'] = datetime.now(timezone.utc).timestamp()
    session['login_ip'] = get_client_ip()
    session['login_ua'] = request.user_agent.string if request.user_agent else 'Unknown'
    session['login_ua_family'] = f"{request.user_agent.browser or ''}|{request.user_agent.platform or ''}"
    session['token_version'] = get_user_token_version(u[0])
    session['session_id'] = _create_session_row(u[0])
    log_audit('LOGIN', 'system', f'Magic-link successful login for {u[1]} (purpose={purpose})')
    from flask import redirect
    if purpose == 'break_glass':
        return redirect('/profile/security#password')
    return redirect('/')


# =========================================================================
#  LOCKOUT STATUS
# =========================================================================

@security_bp.route('/api/security/lockout/status', methods=['POST'])
def lockout_status():
    """Anonymous — client daje username, mi vratimo koliko sekundi je zakljucan.
    Ne otkriva da li username postoji (uvek vraca isti shape)."""
    body = request.get_json(silent=True) or {}
    username = str(body.get('username') or '').strip().lower()[:100]
    if not username:
        return jsonify({'locked': False, 'remaining_seconds': 0})
    with db.connect_raw(DB_FILE) as conn:
        row = conn.execute("SELECT locked_until FROM users WHERE LOWER(username)=?",
                           (username,)).fetchone()
    if not row or not row[0]:
        return jsonify({'locked': False, 'remaining_seconds': 0})
    try:
        until = datetime.fromisoformat(row[0].replace('Z', '+00:00'))
        remaining = int((until - datetime.now(timezone.utc)).total_seconds())
    except Exception:
        return jsonify({'locked': False, 'remaining_seconds': 0})
    if remaining <= 0:
        return jsonify({'locked': False, 'remaining_seconds': 0})
    return jsonify({'locked': True, 'remaining_seconds': remaining})


# =========================================================================
#  ADMIN POLICY
# =========================================================================

@security_bp.route('/api/admin/security/policy', methods=['GET'])
@login_required
def admin_policy_get():
    if session.get('role') != 'admin':
        return jsonify({'error': 'admin_only'}), 403
    return jsonify({'policy': _get_policy()})


@security_bp.route('/api/admin/security/policy', methods=['POST'])
@login_required
def admin_policy_set():
    if session.get('role') != 'admin':
        return jsonify({'error': 'admin_only'}), 403
    body = request.get_json(silent=True) or {}
    # Validacija
    valid_types = {
        'enforce_2fa_for_admins': bool,
        'max_login_attempts': int,
        'lockout_minutes': int,
        'password_min_length': int,
        'password_max_age_days': int,
        'password_history_count': int,
        'notify_new_ip': bool,
        'trusted_device_ttl_days': int,
        'magic_link_ttl_minutes': int,
    }
    patch = {}
    for k, t in valid_types.items():
        if k in body:
            try:
                if t is bool:
                    patch[k] = bool(body[k])
                else:
                    patch[k] = int(body[k])
            except (ValueError, TypeError):
                return jsonify({'error': f'invalid_type_{k}'}), 400
    updated = _set_policy(patch)
    log_audit('EDIT', 'security_policy', f'Admin updated policy: {list(patch.keys())}')
    return jsonify({'policy': updated})


@security_bp.route('/api/admin/security/force-password-reset/<uid>', methods=['POST'])
@login_required
def admin_force_reset(uid):
    if session.get('role') != 'admin':
        return jsonify({'error': 'admin_only'}), 403
    with db.connect_raw(DB_FILE) as conn:
        n = conn.execute("UPDATE users SET must_change_password=1 WHERE id=?", (uid,)).rowcount
    log_audit('SECURITY', 'admin', f'Admin forced password reset for user {uid}')
    return jsonify({'forced': n})


@security_bp.route('/api/admin/security/unlock/<uid>', methods=['POST'])
@login_required
def admin_unlock(uid):
    if session.get('role') != 'admin':
        return jsonify({'error': 'admin_only'}), 403
    with db.connect_raw(DB_FILE) as conn:
        n = conn.execute("UPDATE users SET locked_until=NULL WHERE id=?", (uid,)).rowcount
    log_audit('SECURITY', 'admin', f'Admin unlocked user {uid}')
    return jsonify({'unlocked': n})


@security_bp.route('/api/admin/security/break-glass/<uid>', methods=['POST'])
@login_required
def admin_break_glass(uid):
    """Generise jednokratni magic link koji dopusti admin-u pristup nalogu drugog user-a
    (npr. korisnik zaboravio lozinku i 2FA). Link se salje na email tog user-a, admin
    kaze user-u da otvori mejl. Nakon konzumacije, user_a se automatski gura na
    change-password stranicu (purpose='break_glass')."""
    if session.get('role') != 'admin':
        return jsonify({'error': 'admin_only'}), 403
    with db.connect_raw(DB_FILE) as conn:
        row = conn.execute("SELECT username, email FROM users WHERE id=?", (uid,)).fetchone()
    if not row or not row[1]:
        return jsonify({'error': 'user_has_no_email'}), 400

    tok = secrets.token_urlsafe(48)
    expires = (datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat().replace('+00:00', 'Z')
    with db.connect_raw(DB_FILE) as conn:
        conn.execute(
            "INSERT INTO magic_login_tokens (token, user_id, purpose, created_at, expires_at, request_ip) "
            "VALUES (?, ?, 'break_glass', ?, ?, ?)",
            (_hash_token(tok), uid, _now_iso(), expires, get_client_ip())
        )

    base = request.host_url.rstrip('/')
    link = f"{base}/login/magic?t={tok}"
    try:
        from utils_email import send_email_now
        send_email_now(
            row[1],
            'Aspidus — Emergency account recovery',
            f"<p>Hi {row[0]},</p>"
            f"<p>An administrator ({session.get('username')}) issued a one-time recovery link for your account. "
            f"It expires in 30 minutes. After clicking, you'll be signed in and asked to set a new password.</p>"
            f"<p><a href=\"{link}\">Recover my account</a></p>"
            f"<p>If you didn't request this, contact your administrator immediately.</p>",
            body_type='html'
        )
    except Exception as e:
        return jsonify({'error': f'email_failed: {e}'}), 500

    log_audit('SECURITY', 'admin', f'Admin issued break-glass link for user {row[0]}',
              is_suspicious=True)
    return jsonify({'sent_to': row[1]})


# =========================================================================
#  INTERNAL — create session row (called from auth.login on success)
# =========================================================================

def _create_session_row(uid: str) -> str:
    """Kreira row u user_sessions i vraca njegov id. Zovi ga iz login handler-a
    posle uspesnog auth-a; snimi vraceni id u session['session_id']."""
    ip = get_client_ip()
    ua = request.user_agent.string if request.user_agent else 'Unknown'
    ua_family = f"{request.user_agent.browser or ''}|{request.user_agent.platform or ''}"
    device_label = f"{request.user_agent.browser or 'Browser'} on {request.user_agent.platform or 'Device'}"
    sid = str(uuid.uuid4())
    now = _now_iso()

    country = None
    try:
        from utils import get_ip_info
        _, ip_loc, _ = get_ip_info(ip) if ip else ('', '', '')
        if ip_loc and ',' in ip_loc:
            country = ip_loc.split(',')[-1].strip()[:80]
    except Exception:
        pass

    row = {
        'id': sid, 'user_id': uid, 'created_at': now, 'last_seen_at': now,
        'ip': ip, 'country': country, 'user_agent': ua,
        'ua_family': ua_family, 'device_label': device_label,
    }
    with db.connect_raw(DB_FILE) as conn:
        conn.execute(
            "INSERT INTO user_sessions (id, user_id, created_at, last_seen_at, ip, country, "
            "user_agent, ua_family, device_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (sid, uid, now, now, ip, country, ua, ua_family, device_label)
        )
    # V23.1 #1 — Supabase mirror (best-effort). Ako se sesija ne prenese,
    # nista strasno — sledeci HEARTBEAT ce ponovo probati preko touch_session.
    try:
        from data_layer import upsert as _db_upsert
        _db_upsert('user_sessions', row, on_conflict='id')
    except Exception:
        pass
    return sid


def touch_session(sid: str) -> None:
    """Poziva se iz login_required da azurira last_seen_at. Best-effort."""
    if not sid:
        return
    try:
        with db.connect_raw(DB_FILE) as conn:
            conn.execute("UPDATE user_sessions SET last_seen_at=? WHERE id=?",
                         (_now_iso(), sid))
    except Exception:
        pass


def is_session_revoked(sid: str) -> bool:
    if not sid:
        return False
    try:
        with db.connect_raw(DB_FILE) as conn:
            row = conn.execute("SELECT revoked FROM user_sessions WHERE id=?", (sid,)).fetchone()
        return bool(row and row[0])
    except Exception:
        return False


# =========================================================================
#  KNOWN-IP TRACKING (called from auth.login on success)
# =========================================================================

def record_login_ip(uid: str, ip: str) -> bool:
    """Insertuje ili apdejtuje known_ips row. Vraca True ako je IP NOV (nikad
    videna) — pozivac tada može da posalje 'new login' email."""
    if not ip:
        return False
    now = _now_iso()
    is_new = False
    country = city = None
    try:
        from utils import get_ip_info
        network_info, ip_loc, _ = get_ip_info(ip)
        if ip_loc and ',' in ip_loc:
            parts = ip_loc.split(',')
            city = parts[0].strip()[:120]
            country = parts[-1].strip()[:80]
    except Exception:
        pass
    with db.connect_raw(DB_FILE) as conn:
        r = conn.execute("SELECT id FROM known_ips WHERE user_id=? AND ip=?", (uid, ip)).fetchone()
        if r:
            conn.execute("UPDATE known_ips SET last_seen=?, login_count=login_count+1 WHERE id=?",
                         (now, r[0]))
        else:
            is_new = True
            conn.execute(
                "INSERT INTO known_ips (id, user_id, ip, country, city, first_seen, last_seen) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (str(uuid.uuid4()), uid, ip, country, city, now, now)
            )
    return is_new


def send_new_ip_alert(uid: str, ip: str) -> None:
    """Salje email ako je user pretplaticen i policy notify_new_ip = True."""
    policy = _get_policy()
    if not policy.get('notify_new_ip'):
        return
    try:
        with db.connect_raw(DB_FILE) as conn:
            row = conn.execute("SELECT username, email FROM users WHERE id=?", (uid,)).fetchone()
        if not row or not row[1]:
            return
        username, email = row
        ua = 'Unknown'
        try:
            ua = request.user_agent.string
        except Exception:
            pass
        loc = ip
        try:
            from utils import get_ip_info
            _, ip_loc, _ = get_ip_info(ip)
            if ip_loc and ip_loc != 'N/A':
                loc = f"{ip_loc} ({ip})"
        except Exception:
            pass
        from utils_email import send_email_now
        send_email_now(
            email,
            'Aspidus — New sign-in from an unfamiliar location',
            f"<p>Hi {username},</p>"
            f"<p>A new sign-in to your Aspidus CRM account was detected:</p>"
            f"<ul>"
            f"<li><b>Location:</b> {loc}</li>"
            f"<li><b>Device:</b> {ua}</li>"
            f"<li><b>Time (UTC):</b> {_now_iso()}</li>"
            f"</ul>"
            f"<p>If this was you, no action is needed. If not, "
            f"open your Security Center and revoke the session, then change your password.</p>",
            body_type='html'
        )
    except Exception:
        pass


# =========================================================================
#  PASSWORD HISTORY / POLICY ENFORCEMENT
# =========================================================================

def check_password_reuse(uid: str, plain_password: str) -> bool:
    """Vraca True ako plain_password matchuje bilo koji od poslednjih N hasheva."""
    from werkzeug.security import check_password_hash
    policy = _get_policy()
    n = int(policy.get('password_history_count', 5))
    if n <= 0:
        return False
    with db.connect_raw(DB_FILE) as conn:
        rows = conn.execute(
            "SELECT password_hash FROM password_history "
            "WHERE user_id=? ORDER BY changed_at DESC LIMIT ?",
            (uid, n)
        ).fetchall()
    for (h,) in rows:
        try:
            if check_password_hash(h, plain_password):
                return True
        except Exception:
            pass
    return False


def add_password_history(uid: str, password_hash: str) -> None:
    now = _now_iso()
    policy = _get_policy()
    keep = int(policy.get('password_history_count', 5))
    with db.connect_raw(DB_FILE) as conn:
        conn.execute(
            "INSERT INTO password_history (id, user_id, password_hash, changed_at) "
            "VALUES (?, ?, ?, ?)",
            (str(uuid.uuid4()), uid, password_hash, now)
        )
        # Prune old
        if keep > 0:
            conn.execute(
                "DELETE FROM password_history WHERE user_id=? AND id NOT IN ("
                "SELECT id FROM password_history WHERE user_id=? ORDER BY changed_at DESC LIMIT ?)",
                (uid, uid, keep)
            )
        # Postavi password_expires_at ako je policy > 0
        max_age = int(policy.get('password_max_age_days', 0))
        if max_age > 0:
            expires = (datetime.now(timezone.utc) + timedelta(days=max_age)).isoformat().replace('+00:00', 'Z')
            conn.execute("UPDATE users SET password_expires_at=?, must_change_password=0 WHERE id=?",
                         (expires, uid))
        else:
            conn.execute("UPDATE users SET must_change_password=0 WHERE id=?", (uid,))
