"""Portal auth endpoints koji koriste Supabase Auth.

Ovi endpoint-i se aktiviraju kada je USE_SUPABASE_AUTH=true u .env. Kada je
false, ostaju u kodu ali frontend ih ne poziva — legacy OTP flow radi.

Endpointi:

  POST /api/portal/auth/supabase/exchange
     Body: {"access_token": "<Supabase JWT>", "location": "lat,lng"}
     Verifikuje JWT offline (HS256 + JWT Secret), matchuje partnera po
     email-u, pravi standardnu portal_auth_session i vraća {auth_key, token, isPremium}.
     Ostatak portala ne mora ništa da menja — sve API pozive dalje ide isti
     `Authorization: Bearer <auth_key>` header kao i za OTP flow.

  POST /api/portal/auth/supabase/send-magic-link
     Body: {"email": "..."}
     Proxy poziv ka Supabase-u da pošalje magic-link mail. Fail-safe: generic
     poruka bez otkrivanja da li email postoji (prevencija enumeracije).

  POST /api/portal/auth/supabase/send-reset
     Body: {"email": "..."}
     Isto ali reset-password mail.
"""
from __future__ import annotations

import db
import time
from datetime import datetime, timezone

from flask import request, jsonify, abort

from utils import encrypt_data,  log_audit, get_client_ip
from . import (
    portal_bp, check_portal_rate_limit, find_partner_by_email,
    get_portal_session, is_partner_premium, log_portal_activity,
    create_portal_session,
)


def _client_ip():
    return get_client_ip() or ''


def _generic_reset_msg():
    """Vraća isti odgovor bez obzira da li email postoji — anti-enumeracija."""
    return jsonify({
        "status": "success",
        "message": "If this email is registered, we've sent you a link. Please check your inbox."
    })


@portal_bp.route('/api/portal/auth/supabase/exchange', methods=['POST'])
def supabase_auth_exchange():
    """Prima Supabase access_token, verifikuje JWT, matchuje partnera po email-u
    i vraća standardni portal auth_key kao i OTP flow. Ovo je 'session bridge'
    izmedju Supabase Auth-a i postojećih portal ruta."""
    ip = _client_ip()
    if not check_portal_rate_limit(ip):
        abort(429)

    payload = request.get_json(silent=True) or {}
    access_token = str(payload.get('access_token') or '').strip()
    location = str(payload.get('location') or '').strip()

    if not access_token:
        return jsonify({"error": "Missing access_token"}), 400

    # 1) Offline JWT verify (HS256 + JWT Secret)
    from auth_supabase import verify_supabase_jwt, use_supabase_auth
    if not use_supabase_auth():
        log_audit('SECURITY', 'portal',
                  'Supabase exchange called while USE_SUPABASE_AUTH=false',
                  is_suspicious=True)
        return jsonify({"error": "Supabase Auth is not enabled on this server."}), 503

    claims = verify_supabase_jwt(access_token)
    if not claims:
        log_audit('SECURITY', 'portal',
                  f'Supabase JWT verify failed from {ip}',
                  is_suspicious=True)
        return jsonify({"error": "Invalid or expired token."}), 401

    email = str(claims.get('email') or '').strip().lower()
    sub = str(claims.get('sub') or '').strip()
    if not email:
        return jsonify({"error": "Token missing email claim."}), 400

    # 2) Matchuj partnera po email-u
    partner_id, partner = find_partner_by_email(email)
    if not partner:
        # Ne otkrivamo klijentu — generic error. Log detaljan za admina.
        log_audit('SECURITY', 'portal',
                  f'Supabase JWT valid but no partner for email={email} sub={sub[:8]}',
                  is_suspicious=True)
        return jsonify({"error": "This account is not linked to any partner. Contact administrator."}), 403

    # 3) Kill Switch provera
    if partner.get('isPortalActive', True) is False:
        log_portal_activity(partner_id, 'LOGIN_BLOCKED',
                            f'Supabase login for revoked portal: {email}')
        log_audit('SECURITY', 'portal',
                  f'Supabase login blocked (kill switch) for {email}',
                  is_suspicious=True)
        return jsonify({"error": "Access Revoked. Please contact administrator."}), 403

    # 4) GPS gate (isti mehanizam kao OTP flow) — Premium izuzetak
    is_premium = is_partner_premium(partner)
    if not is_premium and (not location or ',' not in location):
        return jsonify({
            "error": "LOCATION_REQUIRED",
            "message": "Precise location must be shared to access the portal."
        }), 403

    # 5) Uveri se da partner ima portalToken — ako nema, generiši ga sad
    #    (moglo bi biti da je Supabase korisnik napravljen ali admin nije
    #     ranije generisao token URL). Bez tokena downstream API-ji neće raditi.
    token = partner.get('portalToken')
    if not token:
        import secrets as _sec
        from config import DB_FILE as _DBF
        token = _sec.token_urlsafe(32)
        partner['portalToken'] = token
        partner.setdefault('isPortalActive', True)
        conn = db.connect_raw(_DBF, timeout=30.0)
        try:
            conn.execute('UPDATE partners SET data=? WHERE id=?',
                         (encrypt_data(partner), partner_id))
            conn.commit()
        finally:
            conn.close()
        log_audit('EDIT', 'portal',
                  f'Auto-generated portalToken during Supabase exchange for partner {partner_id}',
                  is_suspicious=False)

    # 6) Kreiraj standardnu portal sesiju (identično kao OTP flow) — ne diramo
    #    ništa downstream. Auth key ide kroz Authorization header, kill switch
    #    i IP binding rade kao i pre.
    auth_key = create_portal_session(token, partner_id=partner_id)

    # 7) Logovanje uspešnog login-a sa GPS napomenom
    gps_note = f'GPS: {location}' if location else 'no GPS (premium)'
    log_portal_activity(partner_id, 'LOGIN_SUCCESS',
                        f'Supabase login ({gps_note}) email={email}')
    log_audit('LOGIN', 'portal',
              f'Portal Supabase login: {email} ({gps_note})',
              is_suspicious=False)

    return jsonify({
        "status": "success",
        "auth_key": auth_key,
        "token": token,
        "isPremium": is_premium,
        # Vraćamo i sub tako da frontend može da logout-uje ispravno iz Supabase-a
        "supabase_user_id": sub,
    })


@portal_bp.route('/api/portal/auth/supabase/set-password', methods=['POST'])
def supabase_set_password():
    """Recovery flow — postavlja novu lozinku i odmah pravi portal sesiju.

    Body: {"access_token": <recovery JWT>, "password": <nova>, "location": "lat,lng"}

    1) Offline verify JWT (HS256 + JWT Secret)
    2) admin.update_user_by_id(sub, {password: ...})
    3) find_partner_by_email → create_portal_session → return auth_key

    Ovaj endpoint eliminiše potrebu za supabase-js na klijentu za recovery
    tok — sve se radi serverski (brže, robusnije, radi i bez CDN-a).
    """
    ip = _client_ip()
    if not check_portal_rate_limit(ip):
        abort(429)

    from auth_supabase import (
        verify_supabase_jwt, update_user_password, use_supabase_auth,
    )
    if not use_supabase_auth():
        return jsonify({"error": "Supabase Auth is not enabled on this server."}), 503

    payload = request.get_json(silent=True) or {}
    access_token = str(payload.get('access_token') or '').strip()
    new_password = str(payload.get('password') or '')
    location = str(payload.get('location') or '').strip()

    if not access_token:
        return jsonify({"error": "Missing access_token"}), 400
    if not new_password or len(new_password) < 8:
        return jsonify({"error": "Password must be at least 8 characters."}), 400

    claims = verify_supabase_jwt(access_token)
    if not claims:
        log_audit('SECURITY', 'portal',
                  f'set-password: JWT verify failed from {ip}', is_suspicious=True)
        return jsonify({"error": "Invalid or expired recovery link."}), 401

    sub = str(claims.get('sub') or '').strip()
    email = str(claims.get('email') or '').strip().lower()
    if not sub or not email:
        return jsonify({"error": "Token missing sub/email claim."}), 400

    partner_id, partner = find_partner_by_email(email)
    if not partner:
        log_audit('SECURITY', 'portal',
                  f'set-password: valid JWT but no partner for {email}',
                  is_suspicious=True)
        return jsonify({"error": "This account is not linked to any partner."}), 403

    if partner.get('isPortalActive', True) is False:
        log_portal_activity(partner_id, 'LOGIN_BLOCKED',
                            f'set-password on revoked portal: {email}')
        return jsonify({"error": "Access Revoked. Contact administrator."}), 403

    ok, detail = update_user_password(sub, new_password)
    if not ok:
        log_audit('ERROR', 'portal',
                  f'set-password failed for {email}: {detail}', is_suspicious=False)
        return jsonify({"error": f"Could not save password: {detail}"}), 500

    # GPS gate (Premium izuzetak)
    is_premium = is_partner_premium(partner)
    if not is_premium and (not location or ',' not in location):
        # Lozinka JE postavljena — samo GPS fali. Neka klijent osveži sa GPS-om.
        return jsonify({
            "status": "password_saved",
            "error": "LOCATION_REQUIRED",
            "message": "Password saved. Please allow location and sign in.",
        }), 200

    # Uveri se da postoji portalToken (kao u exchange-u)
    token = partner.get('portalToken')
    if not token:
        import secrets as _sec
        from config import DB_FILE as _DBF
        token = _sec.token_urlsafe(32)
        partner['portalToken'] = token
        partner.setdefault('isPortalActive', True)
        conn = db.connect_raw(_DBF, timeout=30.0)
        try:
            conn.execute('UPDATE partners SET data=? WHERE id=?',
                         (encrypt_data(partner), partner_id))
            conn.commit()
        finally:
            conn.close()

    from . import create_portal_session
    auth_key = create_portal_session(token, partner_id=partner_id)
    gps_note = f'GPS: {location}' if location else 'no GPS (premium)'
    log_portal_activity(partner_id, 'LOGIN_SUCCESS',
                        f'Recovery→password set + sign-in ({gps_note}) email={email}')
    log_audit('LOGIN', 'portal',
              f'Portal password recovery: {email} ({gps_note})',
              is_suspicious=False)

    return jsonify({
        "status": "success",
        "auth_key": auth_key,
        "token": token,
        "isPremium": is_premium,
        "supabase_user_id": sub,
    })


@portal_bp.route('/api/portal/auth/supabase/signin-password', methods=['POST'])
def supabase_signin_password():
    """Server-side password sign-in — ne zahteva supabase-js na klijentu.
    Body: {"email": "...", "password": "...", "location": "lat,lng"}
    """
    ip = _client_ip()
    if not check_portal_rate_limit(ip):
        abort(429)

    from auth_supabase import (
        signin_with_password, verify_supabase_jwt, use_supabase_auth,
    )
    if not use_supabase_auth():
        return jsonify({"error": "Supabase Auth is not enabled."}), 503

    payload = request.get_json(silent=True) or {}
    email = str(payload.get('email') or '').strip().lower()
    password = str(payload.get('password') or '')
    location = str(payload.get('location') or '').strip()

    if not email or not password:
        return jsonify({"error": "Email and password required."}), 400

    partner_id, partner = find_partner_by_email(email)
    if not partner:
        log_audit('SECURITY', 'portal',
                  f'signin-password: no partner for {email}', is_suspicious=True)
        return jsonify({"error": "Invalid email or password."}), 401
    if partner.get('isPortalActive', True) is False:
        log_portal_activity(partner_id, 'LOGIN_BLOCKED',
                            f'signin-password on revoked: {email}')
        return jsonify({"error": "Access Revoked. Contact administrator."}), 403

    session, detail = signin_with_password(email, password)
    if session is None:
        log_audit('SECURITY', 'portal',
                  f'signin-password failed for {email}: {detail}', is_suspicious=True)
        return jsonify({"error": "Invalid email or password."}), 401

    is_premium = is_partner_premium(partner)
    if not is_premium and (not location or ',' not in location):
        return jsonify({
            "error": "LOCATION_REQUIRED",
            "message": "Precise location must be shared to access the portal.",
        }), 403

    token = partner.get('portalToken')
    if not token:
        import secrets as _sec
        from config import DB_FILE as _DBF
        token = _sec.token_urlsafe(32)
        partner['portalToken'] = token
        partner.setdefault('isPortalActive', True)
        conn = db.connect_raw(_DBF, timeout=30.0)
        try:
            conn.execute('UPDATE partners SET data=? WHERE id=?',
                         (encrypt_data(partner), partner_id))
            conn.commit()
        finally:
            conn.close()

    from . import create_portal_session
    auth_key = create_portal_session(token, partner_id=partner_id)
    gps_note = f'GPS: {location}' if location else 'no GPS (premium)'
    log_portal_activity(partner_id, 'LOGIN_SUCCESS',
                        f'Supabase password login ({gps_note}) email={email}')
    log_audit('LOGIN', 'portal',
              f'Portal Supabase password login: {email}', is_suspicious=False)

    user = session.get('user') if isinstance(session, dict) else None
    sub = (user or {}).get('id', '')

    return jsonify({
        "status": "success",
        "auth_key": auth_key,
        "token": token,
        "isPremium": is_premium,
        "supabase_user_id": sub,
    })


@portal_bp.route('/api/portal/admin/send-portal-invite/<partner_id>', methods=['POST'])
def admin_send_portal_invite(partner_id):
    """Admin dugme — pošalje partneru invite/reset mail. Ako Auth user ne
    postoji, prvo ga napravi. Klijent klikne link, postavi lozinku, ulazi.
    """
    from flask import session as _fsess
    from utils import encrypt_data,  log_audit as _la
    if _fsess.get('role') != 'admin':
        return jsonify({"error": "Admin only."}), 403

    from auth_supabase import (
        create_or_get_auth_user, send_password_reset, use_supabase_auth,
    )
    if not use_supabase_auth():
        return jsonify({"error": "Supabase Auth is not enabled."}), 503

    import sqlite3, json as _json
    from config import DB_FILE
    conn = db.connect_raw(DB_FILE)
    try:
        c = conn.cursor()
        c.execute("SELECT data FROM partners WHERE id=?", (partner_id,))
        row = c.fetchone()
    finally:
        conn.close()
    if not row:
        return jsonify({"error": "Partner not found."}), 404
    try:
        partner = _json.loads(row[0]) if row[0] else {}
    except (ValueError, TypeError):
        from utils import encrypt_data,  decrypt_data
        partner = decrypt_data(row[0]) or {}

    email = (partner.get('contact', {}) or {}).get('email') or partner.get('email') or ''
    email = str(email).strip().lower()
    if not email:
        return jsonify({"error": "Partner has no email."}), 400

    uid, status = create_or_get_auth_user(
        email, partner_id=partner_id,
        company_name=partner.get('companyName', ''),
        email_confirm=True,
    )
    if not uid:
        return jsonify({"error": f"Could not resolve auth user: {status}"}), 500

    import os as _os
    portal_url = _os.environ.get('PORTAL_BASE_URL', '').strip() or \
                 f"{request.url_root.rstrip('/')}/portal/login"
    ok, detail = send_password_reset(email, redirect_to=portal_url)
    if not ok:
        return jsonify({"error": f"Send failed: {detail}"}), 500

    _la('EDIT', 'portal',
        f'Admin sent portal invite to partner {partner_id} ({email})',
        is_suspicious=False)
    return jsonify({
        "status": "success",
        "message": f"Invite/reset email sent to {email}",
        "auth_user_id": uid,
        "auth_user_status": status,
    })


@portal_bp.route('/api/portal/admin/set-partner-password/<partner_id>', methods=['POST'])
def admin_set_partner_password(partner_id):
    """Admin dugme — direktno postavlja portal lozinku za partnera preko
    Supabase admin API-ja. Zaobilazi email reset dance flow.
    Body: {"password": "..."}"""
    from flask import session as _fsess
    from utils import encrypt_data,  log_audit as _la
    if _fsess.get('role') != 'admin':
        _la('SECURITY', 'portal',
            f'Non-admin tried set-partner-password for {partner_id}',
            is_suspicious=True)
        return jsonify({"error": "Admin only."}), 403

    from auth_supabase import (
        create_or_get_auth_user, update_user_password, use_supabase_auth,
    )
    if not use_supabase_auth():
        return jsonify({"error": "Supabase Auth is not enabled."}), 503

    data = request.get_json(silent=True) or {}
    new_password = str(data.get('password') or '')
    if len(new_password) < 8:
        return jsonify({"error": "Password must be at least 8 characters."}), 400

    import sqlite3
    import json as _json
    from config import DB_FILE
    conn = db.connect_raw(DB_FILE)
    try:
        c = conn.cursor()
        c.execute("SELECT data FROM partners WHERE id=?", (partner_id,))
        row = c.fetchone()
    finally:
        conn.close()
    if not row:
        return jsonify({"error": "Partner not found."}), 404
    try:
        partner = _json.loads(row[0]) if row[0] else {}
    except (ValueError, TypeError):
        from utils import encrypt_data,  decrypt_data
        partner = decrypt_data(row[0]) or {}

    email = (partner.get('contact', {}) or {}).get('email') or partner.get('email') or ''
    email = str(email).strip().lower()
    if not email:
        return jsonify({"error": "Partner has no email."}), 400

    uid, status = create_or_get_auth_user(
        email, partner_id=partner_id,
        company_name=partner.get('companyName', ''),
        email_confirm=True,
    )
    if not uid:
        return jsonify({"error": f"Could not resolve auth user: {status}"}), 500

    ok, detail = update_user_password(uid, new_password)
    if not ok:
        return jsonify({"error": f"Password update failed: {detail}"}), 500

    _la('EDIT', 'portal',
        f'Admin set portal password for partner {partner_id} ({email})',
        is_suspicious=False)
    return jsonify({
        "status": "success",
        "message": f"Password set for {email}. Partner can now sign in.",
        "auth_user_id": uid,
        "auth_user_status": status,
    })


@portal_bp.route('/api/portal/user/change-password', methods=['POST'])
def portal_user_change_password():
    """Ulogovan klijent menja svoju lozinku iz portala (Profile → Change Password).
    Traži trenutnu portal auth_key sesiju (već ulogovan) + trenutnu lozinku
    (revalidacija) + novu lozinku. Sve greške se vraćaju kao jasne poruke,
    a interne greške se loguju u admin error buffer."""
    ip = _client_ip()
    try:
        if not check_portal_rate_limit(ip):
            abort(429)

        from auth_supabase import (
            signin_with_password, update_user_password, get_user_by_email, use_supabase_auth,
        )
        from . import verify_portal_session, get_portal_session
        if not use_supabase_auth():
            return jsonify({"error": "Supabase Auth is not enabled on this server."}), 503

        payload = request.get_json(silent=True) or {}
        portal_token = str(payload.get('portal_token') or '').strip()
        current_password = str(payload.get('current_password') or '')
        new_password = str(payload.get('new_password') or '')
        auth_header = request.headers.get('X-Portal-Auth', '')

        if not verify_portal_session(portal_token, auth_header):
            return jsonify({"error": "Not authenticated. Please sign in again."}), 401
        if len(new_password) < 8:
            return jsonify({"error": "New password must be at least 8 characters."}), 400

        sess = get_portal_session(portal_token) or {}
        partner_id = sess.get('partner_id')
        if not partner_id:
            return jsonify({"error": "Portal session has no partner link. Sign out and sign in again."}), 400

        import sqlite3, json as _json
        from config import DB_FILE
        conn = db.connect_raw(DB_FILE)
        try:
            c = conn.cursor()
            c.execute("SELECT data FROM partners WHERE id=?", (partner_id,))
            row = c.fetchone()
        finally:
            conn.close()
        if not row:
            return jsonify({"error": "Partner record not found."}), 404
        try:
            partner = _json.loads(row[0]) if row[0] else {}
        except (ValueError, TypeError):
            from utils import encrypt_data,  decrypt_data
            partner = decrypt_data(row[0]) or {}
        email = (partner.get('contact', {}) or {}).get('email') or partner.get('email') or ''
        email = str(email).strip().lower()
        if not email:
            return jsonify({"error": "This account has no email — cannot change password."}), 400

        # Revalidacija trenutne lozinke
        session_data, sd_detail = signin_with_password(email, current_password)
        if session_data is None:
            log_audit('SECURITY', 'portal',
                      f'change-password: wrong current password for {email} ({sd_detail})',
                      is_suspicious=True)
            return jsonify({"error": "Current password is incorrect."}), 401

        # Nadji Supabase user id — prvo iz signin session-a (najbrže i najsigurnije)
        uid = None
        try:
            user = (session_data or {}).get('user') or {}
            uid = user.get('id')
        except Exception:
            uid = None
        if not uid:
            # Fallback: admin lookup po emailu
            supa_user = get_user_by_email(email)
            if supa_user:
                uid = supa_user.get('id') if isinstance(supa_user, dict) else getattr(supa_user, 'id', None)
        if not uid:
            return jsonify({"error": "Cannot resolve Supabase user. Contact administrator."}), 500

        ok, up_detail = update_user_password(str(uid), new_password)
        if not ok:
            log_audit('ERROR', 'portal',
                      f'change-password: update_user_password failed for {email}: {up_detail}',
                      is_suspicious=False)
            return jsonify({"error": f"Could not update password: {up_detail}"}), 500

        log_audit('EDIT', 'portal',
                  f'Client changed portal password: {email}', is_suspicious=False)
        return jsonify({"status": "success", "message": "Password changed successfully."})
    except Exception as e:
        # Poslednji safety net — svaka neuhvaćena greška ide u admin error buffer
        try:
            from routes.supabase_admin import record_error
            record_error(context='/api/portal/user/change-password', exc=e)
        except Exception:
            pass
        return jsonify({
            "error": "Internal error while changing password. Administrator has been notified.",
            "detail": str(e)[:200],
        }), 500


@portal_bp.route('/api/portal/auth/supabase/send-magic-link', methods=['POST'])
def supabase_send_magic_link():
    """Proxy — traži od Supabase-a da pošalje magic-link. Uvek isti odgovor
    (anti-enumeracija). Rate-limitovano kao ostatak portala."""
    ip = _client_ip()
    if not check_portal_rate_limit(ip):
        abort(429)

    from auth_supabase import send_magic_link, use_supabase_auth
    if not use_supabase_auth():
        return jsonify({"error": "Supabase Auth is not enabled on this server."}), 503

    data = request.get_json(silent=True) or {}
    email = str(data.get('email') or '').strip().lower()
    if not email or '@' not in email or '.' not in email:
        return jsonify({"error": "Please enter a valid email address."}), 400

    # Log pokušaj (ne otkriva u odgovoru)
    partner_id, partner = find_partner_by_email(email)
    if partner_id and partner and partner.get('isPortalActive', True) is not False:
        redirect_url = request.url_root.rstrip('/') + '/portal/login'
        ok, detail = send_magic_link(email, redirect_to=redirect_url)
        if ok:
            log_portal_activity(partner_id, 'MAGIC_LINK_SENT',
                                f'Supabase magic-link sent to {email}')
        else:
            log_audit('ERROR', 'portal',
                      f'Supabase magic-link send failed for {email}: {detail}',
                      is_suspicious=False)
    else:
        log_audit('SECURITY', 'portal',
                  f'Magic-link requested for unknown/revoked email: {email}',
                  is_suspicious=True)

    return _generic_reset_msg()


@portal_bp.route('/api/portal/auth/supabase/send-reset', methods=['POST'])
def supabase_send_reset():
    """Proxy — traži od Supabase-a da pošalje reset-password email. Uvek isti
    odgovor bez obzira na status naloga."""
    ip = _client_ip()
    if not check_portal_rate_limit(ip):
        abort(429)

    from auth_supabase import send_password_reset, use_supabase_auth
    if not use_supabase_auth():
        return jsonify({"error": "Supabase Auth is not enabled on this server."}), 503

    data = request.get_json(silent=True) or {}
    email = str(data.get('email') or '').strip().lower()
    if not email or '@' not in email or '.' not in email:
        return jsonify({"error": "Please enter a valid email address."}), 400

    partner_id, partner = find_partner_by_email(email)
    if partner_id and partner and partner.get('isPortalActive', True) is not False:
        redirect_url = request.url_root.rstrip('/') + '/portal/login'
        ok, detail = send_password_reset(email, redirect_to=redirect_url)
        if ok:
            log_portal_activity(partner_id, 'PWD_RESET_SENT',
                                f'Supabase password reset sent to {email}')
        else:
            log_audit('ERROR', 'portal',
                      f'Supabase reset send failed for {email}: {detail}',
                      is_suspicious=False)
    else:
        log_audit('SECURITY', 'portal',
                  f'Password reset requested for unknown/revoked email: {email}',
                  is_suspicious=True)

    return _generic_reset_msg()
