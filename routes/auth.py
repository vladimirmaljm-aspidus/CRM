import db
import datetime
import json
import sqlite3
import logging
from flask import Blueprint, request, jsonify, session
from werkzeug.security import generate_password_hash, check_password_hash
from config import DB_FILE
from utils import log_audit, login_required, FirewallCache, bump_user_token_version, get_user_token_version, get_ip_info, get_client_ip, is_strong_password
from totp import (generate_secret, totp_verify, provisioning_uri,
                  generate_recovery_codes, verify_recovery_code)

logger = logging.getLogger(__name__)

auth_bp = Blueprint('auth', __name__)


@auth_bp.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "MALFORMED_REQUEST"}), 400
        
    username = data.get('username')
    password = data.get('password')
    location = data.get('location', '')
    device_info = data.get('device', 'UNKNOWN_DEVICE')
    totp_code = str(data.get('totp_code', '')).strip()
    recovery_code = str(data.get('recovery_code', '')).strip()
    
    # 1. STRIKTNA KONTROLA LOKACIJE
    if not location or ',' not in location:
        log_audit('SECURITY', 'system', f'Failed login, missing or empty GPS location. User: {username}', is_suspicious=True, location='DENIED')
        return jsonify({"error": "LOCATION_REQUIRED"}), 403
    
    # 2. Provera da li je IP blokiran
    client_ip = get_client_ip()
        
    if client_ip in FirewallCache.blacklist:
        log_audit('SECURITY', 'system', f'Blocked Blacklisted IP Attempt: {client_ip}. Device: {device_info}', is_suspicious=True, location=location)
        return jsonify({"error": "AUTH_ERROR"}), 401
    
    # 3. Konekcija na bazu i provera korisnika
    user = None
    try:
        with db.connect_raw(DB_FILE) as conn:
            c = conn.cursor()
            c.execute('SELECT id, username, password, role, permissions, signature, totp_secret, totp_enabled, totp_recovery, locked_until FROM users WHERE LOWER(username)=LOWER(?)', (username,))
            user = c.fetchone()
    except Exception as e:
        # Detaljno logovanje u server log (Render) radi dijagnostike; klijent dobija generičku poruku.
        logger.error(f"LOGIN DB ERROR for user '{username}': {e}", exc_info=True)
        log_audit('CRITICAL_ERROR', 'system', f'Login failed due to database error: {e}', is_suspicious=True, location=location)
        return jsonify({"error": "INTERNAL_SERVER_ERROR"}), 500

    # ROUND F: account-level lockout — nezavisno od IP blacklist-a.
    # Napadac iz razlicitih IP-a moze i dalje pokusati previse puta protiv istog user-a;
    # sada, nakon N neuspelih pokusaja, konkretan nalog se zakljucava na M minuta.
    if user and len(user) > 9 and user[9]:
        try:
            _until = datetime.datetime.fromisoformat(user[9].replace('Z', '+00:00'))
            _now_dt = datetime.datetime.now(datetime.timezone.utc)
            if _until > _now_dt:
                remaining = int((_until - _now_dt).total_seconds())
                log_audit('SECURITY', 'system', f'Blocked login attempt on locked account: {username}',
                          is_suspicious=True, location=location)
                return jsonify({"error": "ACCOUNT_LOCKED", "retry_after_seconds": remaining}), 423
        except Exception:
            pass

    # Dijagnostika (samo u server log): razlog neuspeha, bez otkrivanja klijentu.
    if not user:
        logger.info(f"LOGIN: unknown username '{username}' from IP {client_ip}")
    elif not check_password_hash(user[2], password):
        logger.info(f"LOGIN: wrong password for '{username}' from IP {client_ip}")

    # 4. Uspešna provera lozinke
    if user and check_password_hash(user[2], password):
        # 4a. 2FA gate — ako je korisnik uključio TOTP, mora predati validan kod
        totp_secret_db = user[6] if len(user) > 6 else None
        totp_enabled_db = int(user[7] or 0) if len(user) > 7 else 0
        totp_recovery_db = user[8] if len(user) > 8 else None
        if totp_enabled_db and totp_secret_db:
            # Klijent ne šalje kod → tražimo drugi korak
            if not totp_code and not recovery_code:
                log_audit('LOGIN', 'system', f'Password OK, waiting for 2FA code: {username}', location=location)
                return jsonify({"status": "totp_required",
                                "message": "Enter the 6-digit code from your Authenticator app, or a recovery code."}), 200
            ok = False
            # Recovery code path — iskoristi (jedan-put) recovery i disable TOTP zahtev za tu prijavu
            if recovery_code:
                try:
                    recovery_list = json.loads(totp_recovery_db) if totp_recovery_db else []
                except Exception:
                    recovery_list = []
                matched, remaining = verify_recovery_code(recovery_list, recovery_code)
                if matched:
                    ok = True
                    # Overwriteuj recovery listu u bazi (skinut korišćeni kod)
                    try:
                        with db.connect_raw(DB_FILE) as _con:
                            _cc = _con.cursor()
                            _cc.execute("UPDATE users SET totp_recovery=? WHERE id=?",
                                        (json.dumps(remaining), user[0]))
                            _con.commit()
                        log_audit('SECURITY', 'system',
                                  f'2FA login via recovery code (one used): {username}. Remaining: {len(remaining)}',
                                  is_suspicious=True, location=location)
                    except Exception:
                        logger.warning('recovery code update failed', exc_info=True)
            # TOTP code path
            if not ok and totp_code:
                ok = totp_verify(totp_secret_db, totp_code)
            if not ok:
                log_audit('SECURITY', 'system', f'2FA failed: {username}', is_suspicious=True, location=location)
                return jsonify({"error": "TOTP_INVALID",
                                "message": "Invalid 2FA code. Try again or use a recovery code."}), 401
        session.permanent = True
        session['user_id'] = user[0]
        session['username'] = user[1]
        session['role'] = user[3]
        session['login_time'] = datetime.datetime.now(datetime.timezone.utc).timestamp()

        session['login_ip'] = client_ip
        session['login_ua'] = request.user_agent.string if request.user_agent else "Unknown"
        session['login_ua_family'] = f"{request.user_agent.browser or ''}|{request.user_agent.platform or ''}"
        # Snimi aktuelnu token_version u sesiju; promena lozinke uveća broj u bazi
        # i sve stare sesije padnu na prvoj sledećoj zaštićenoj ruti.
        session['token_version'] = get_user_token_version(user[0])

        if client_ip in FirewallCache.login_attempts:
            del FirewallCache.login_attempts[client_ip]

        # ANOMALY DETEKCIJA: iznenadna prijava iz druge zemlje u odnosu na prethodnu.
        try:
            _, ip_location, _tz = get_ip_info(client_ip) if client_ip else ('', '', '')
            # last_login_country se čuva u users tabeli (šema migrirana); poredimo
            # ipapi.co "network_info" reprezentaciju grada/zemlje.
            with db.connect_raw(DB_FILE) as _conn:
                _c = _conn.cursor()
                _c.execute("SELECT last_login_country FROM users WHERE id=?", (user[0],))
                prev = _c.fetchone()
                prev_country = (prev[0] or '').strip() if prev else ''
                # Grubo poređenje po "Country" tokenu (poslednji token u ipapi label-u)
                new_country = ''
                for _piece in [location, ip_location]:
                    if _piece and ',' in _piece:
                        new_country = _piece.split(',')[-1].strip()
                        if new_country: break
                if prev_country and new_country and prev_country != new_country:
                    log_audit('SECURITY', 'system',
                              f'ANOMALY: user {username} logged in from {new_country} — previous session was {prev_country}',
                              is_suspicious=True, location=location)
                if new_country:
                    _c.execute("UPDATE users SET last_login_country=? WHERE id=?", (new_country, user[0]))
                    _conn.commit()
        except Exception:
            logger.warning('anomaly detection failed', exc_info=True)

        # ROUND F: per-session tracking + known-IP notification
        try:
            from routes.security_center import (_create_session_row, record_login_ip,
                                                send_new_ip_alert)
            session['session_id'] = _create_session_row(user[0])
            if client_ip:
                is_new_ip = record_login_ip(user[0], client_ip)
                if is_new_ip:
                    send_new_ip_alert(user[0], client_ip)
        except Exception:
            logger.warning('session_row/known_ip tracking failed', exc_info=True)

        # ROUND F: must-change-password gate — postavi flag u response da frontend
        # gura na Security > Password. Ne blokiramo login (jer je password check prosao),
        # samo obavestimo klijenta i login_required ce nakon toga blokirati sve
        # ne-security rute dok se lozinka ne promeni.
        must_change = False
        try:
            with db.connect_raw(DB_FILE) as _pc:
                _r = _pc.execute("SELECT must_change_password FROM users WHERE id=?", (user[0],)).fetchone()
                must_change = bool(_r and _r[0])
        except Exception:
            pass

        full_details = f"Successful login. Device: {device_info}"
        log_audit('LOGIN', 'system', full_details, location=location)
        return jsonify({
            "status": "success",
            "user": {
                "id": user[0], "username": user[1], "role": user[3],
                "permissions": json.loads(user[4]) if user[4] else {},
                "signature": user[5] if len(user) > 5 else None,
            },
            "must_change_password": must_change,
        })
    
    # 5. Neuspešna prijava - beleženje pokušaja
    if client_ip not in FirewallCache.login_attempts:
        FirewallCache.login_attempts[client_ip] = []
    FirewallCache.login_attempts[client_ip].append(datetime.datetime.now(datetime.timezone.utc).timestamp())

    now = datetime.datetime.now(datetime.timezone.utc).timestamp()
    FirewallCache.login_attempts[client_ip] = [t for t in FirewallCache.login_attempts[client_ip] if now - t < 300]

    if len(FirewallCache.login_attempts[client_ip]) >= FirewallCache.settings.get('max_login', 10):
        FirewallCache.blacklist.add(client_ip)
        log_audit('SECURITY', 'firewall', f"Auto-blacklisted IP {client_ip} due to brutal force attempts.", is_suspicious=True, location=location)

    # ROUND F: account-level lockout — ako je user postojao (samo pogresna lozinka),
    # trag brojimo per-user. Nakon N neuspelih pokusaja (bilo iz kog IP-a) zakljucaj
    # nalog na M minuta. Admin i sam korisnik (magic-link) mogu da otkljucaju.
    if user:
        try:
            from routes.security_center import _get_policy
            policy = _get_policy()
            max_attempts = int(policy.get('max_login_attempts', 10))
            lockout_min = int(policy.get('lockout_minutes', 15))
            # Count recent failed logins iz audit_logs za ovog user-a (poslednjih 15 min)
            cutoff = (datetime.datetime.now(datetime.timezone.utc)
                      - datetime.timedelta(minutes=lockout_min)).isoformat().replace('+00:00', 'Z')
            from config import AUDIT_DB_FILE
            with db.connect_raw(AUDIT_DB_FILE) as _ac:
                # user_id nije jos postavljen na login (guest); brojimo po username-u u details.
                _pattern = f"%Failed login attempt: {username}.%"
                _fail_count = _ac.execute(
                    "SELECT COUNT(*) FROM audit_logs WHERE action='SECURITY' "
                    "AND details LIKE ? AND timestamp>=?",
                    (_pattern, cutoff)
                ).fetchone()[0]
            if _fail_count + 1 >= max_attempts:
                until_iso = (datetime.datetime.now(datetime.timezone.utc)
                             + datetime.timedelta(minutes=lockout_min)).isoformat().replace('+00:00', 'Z')
                with db.connect_raw(DB_FILE) as _lc:
                    _lc.execute("UPDATE users SET locked_until=? WHERE id=?", (until_iso, user[0]))
                log_audit('SECURITY', 'system',
                          f'Auto-locked account {username} for {lockout_min}min after {_fail_count+1} failed attempts',
                          is_suspicious=True, location=location)
                # Emailuj user-a sa unlock magic-link-om
                try:
                    with db.connect_raw(DB_FILE) as _uc:
                        _u = _uc.execute("SELECT email FROM users WHERE id=?", (user[0],)).fetchone()
                    if _u and _u[0]:
                        from routes.security_center import _hash_token, _now_iso
                        import secrets
                        tok = secrets.token_urlsafe(48)
                        expires = (datetime.datetime.now(datetime.timezone.utc)
                                   + datetime.timedelta(hours=2)).isoformat().replace('+00:00', 'Z')
                        with db.connect_raw(DB_FILE) as _tc:
                            _tc.execute(
                                "INSERT INTO magic_login_tokens (token, user_id, purpose, created_at, expires_at, request_ip) "
                                "VALUES (?, ?, 'unlock', ?, ?, ?)",
                                (_hash_token(tok), user[0], _now_iso(), expires, client_ip)
                            )
                        base = request.host_url.rstrip('/')
                        link = f"{base}/login/magic?t={tok}"
                        from utils_email import send_email_now
                        send_email_now(
                            _u[0], 'Aspidus — Account locked, unlock link',
                            f"<p>Hi {username},</p>"
                            f"<p>Your account was temporarily locked after {_fail_count+1} failed sign-in attempts. "
                            f"It will unlock automatically in {lockout_min} minutes.</p>"
                            f"<p>To unlock immediately, click: <a href=\"{link}\">Unlock my account</a> (valid 2h).</p>"
                            f"<p>If this wasn't you, someone is trying to guess your password — change it after signing in.</p>",
                            body_type='html'
                        )
                except Exception:
                    pass
                return jsonify({"error": "ACCOUNT_LOCKED",
                                "retry_after_seconds": lockout_min * 60,
                                "message": "Too many failed attempts. Check your email for an unlock link."}), 423
        except Exception:
            pass

    log_audit('SECURITY', 'system', f'Failed login attempt: {username}. Device: {device_info}', is_suspicious=True, location=location)
    return jsonify({"error": "AUTH_ERROR"}), 401

@auth_bp.route('/api/auth/logout', methods=['POST'])
def logout():
    if 'login_time' in session:
        duration_seconds = int(datetime.datetime.now(datetime.timezone.utc).timestamp() - session['login_time'])
        h, remainder = divmod(duration_seconds, 3600)
        m, s = divmod(remainder, 60)
        log_audit('LOGOUT', 'system', f'Logout successful. Session duration: {h}h {m}m {s}s | Total seconds: {duration_seconds}')
    session.clear()
    return jsonify({"status": "success"})

@auth_bp.route('/api/auth/me', methods=['GET'])
def me():
    if 'user_id' in session:
        row = None
        try:
            with db.connect_raw(DB_FILE) as conn:
                c = conn.cursor()
                c.execute('SELECT permissions, signature, full_name, email, phone, notif_prefs '
                          'FROM users WHERE id=?', (session['user_id'],))
                row = c.fetchone()
        except Exception:
            pass

        notif_prefs = {}
        if row and row[5]:
            try: notif_prefs = json.loads(row[5])
            except Exception: pass

        return jsonify({
            "user": {
                "id": session['user_id'],
                "username": session['username'],
                "role": session['role'],
                "permissions": json.loads(row[0]) if row and row[0] else {},
                "signature": (row[1] if row and len(row) > 1 else None),
                "full_name": (row[2] if row and len(row) > 2 else '') or '',
                "email":     (row[3] if row and len(row) > 3 else '') or '',
                "phone":     (row[4] if row and len(row) > 4 else '') or '',
                "notif_prefs": notif_prefs,
            }
        })
    return jsonify({"error": "UNAUTHORIZED"}), 401

@auth_bp.route('/api/auth/change_password', methods=['POST'])
@login_required
def change_password():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "MALFORMED_REQUEST"}), 400
        
    new_password = data.get('new_password')
    if not new_password: 
        return jsonify({"error": "EMPTY_PASSWORD"}), 400
    
    if not is_strong_password(new_password):
        return jsonify({"error": "WEAK_PASSWORD"}), 400

    # HIBP breach check — odbija lozinke poznate iz curenja podataka. K-anonymity:
    # samo prvih 5 char SHA-1 hasha ide na haveibeenpwned.com; puna lozinka ne
    # napušta server. Ako je HIBP servis dole, propuštamo (fail-open).
    try:
        from security_ext import is_password_pwned
        pwned, hits = is_password_pwned(new_password, min_hits=1)
        if pwned:
            log_audit('SECURITY', 'users',
                      f'Password change blocked — new password found in {hits} known breaches. User: {session.get("username","?")}',
                      is_suspicious=True)
            return jsonify({
                "error": "PWNED_PASSWORD",
                "message": f"This password appears in {hits} known data breaches. Please choose a different one.",
                "hits": hits,
            }), 400
    except Exception:
        pass

    # ROUND F: password history — zabrani reuse poslednjih N lozinki
    try:
        from routes.security_center import check_password_reuse, add_password_history
        if check_password_reuse(session['user_id'], new_password):
            return jsonify({
                "error": "PASSWORD_REUSED",
                "message": "This password matches one you've used recently. Please choose a different one.",
            }), 400
    except Exception:
        pass

    try:
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
        pw_hash = generate_password_hash(new_password, method='scrypt:32768:8:1')
        with db.connect_raw(DB_FILE) as conn:
            c = conn.cursor()
            c.execute('UPDATE users SET password=?, last_password_change_at=? WHERE id=?', (pw_hash, now_iso, session['user_id']))
            conn.commit()
        try:
            add_password_history(session['user_id'], pw_hash)
        except Exception:
            pass
    except Exception:
        return jsonify({"error": "INTERNAL_SERVER_ERROR"}), 500

    # Invalidate SVE prethodne sesije (uključujući trenutnu) — korisnik mora ponovo
    # da se prijavi novom lozinkom. Ovim se hvataju napadi "kradja sesijskog cookie-a
    # pa promena lozinke ostaje trajna" — stari cookie odmah prestaje da radi.
    bump_user_token_version(session['user_id'])
    session.clear()

    log_audit('EDIT', 'users', 'User successfully changed their own password. All sessions invalidated.')
    return jsonify({"status": "success", "message": "Password changed. Please log in again."})


@auth_bp.route('/api/auth/logout_all', methods=['POST'])
@login_required
def logout_all_sessions():
    """Admin ili sam korisnik može da izbaci sve sesije za dati user_id.
    Ako user_id nije prosleđen, primenjuje se na sebe."""
    payload = request.get_json(silent=True) or {}
    target_id = (payload.get('user_id') or session['user_id']).strip()
    if target_id != session['user_id'] and session.get('role') != 'admin':
        log_audit('SECURITY', 'users', f'Prevented unauthorized logout_all for {target_id}', is_suspicious=True)
        return jsonify({"error": "Unauthorized"}), 403
    bump_user_token_version(target_id)
    log_audit('SECURITY', 'users', f'All sessions invalidated for user {target_id}', is_suspicious=False)
    if target_id == session['user_id']:
        session.clear()
    return jsonify({"status": "success"})

@auth_bp.route('/api/auth/signature', methods=['POST'])
@login_required
def set_signature():
    """Postavlja/uklanja LIČNI potpis trenutno ulogovanog korisnika.
    Svaki korisnik može da menja isključivo svoj potpis (izvodi se iz sesije),
    čime se garantuje da na dokumentima može stajati samo sopstveni potpis."""
    data = request.get_json(silent=True) or {}
    sig = data.get('signatureUrl')

    # Dozvoljena je samo interna putanja do uploadovanog fajla (ne proizvoljan URL),
    # ili prazna vrednost (uklanjanje potpisa).
    if sig not in (None, ''):
        sig = str(sig).strip()
        if not sig.startswith('/uploads/') or '..' in sig or len(sig) > 256:
            return jsonify({"error": "INVALID_SIGNATURE_PATH"}), 400
    else:
        sig = None

    try:
        with db.connect_raw(DB_FILE) as conn:
            conn.execute('UPDATE users SET signature=? WHERE id=?', (sig, session['user_id']))
            conn.commit()
    except Exception:
        return jsonify({"error": "INTERNAL_SERVER_ERROR"}), 500

    log_audit('EDIT', 'users', 'User updated their personal signature.' if sig else 'User removed their personal signature.')
    return jsonify({"status": "success", "signature": sig})


# ==========================================================
#  2FA / TOTP endpoints
# ==========================================================

@auth_bp.route('/api/auth/totp/setup_start', methods=['POST'])
@login_required
def totp_setup_start():
    """Korak 1: generiše novi TOTP secret i vraća ga korisniku sa provisioning
    URI-jem za QR skeniranje. Secret se NE UPISUJE u bazu odmah — prvo mora da
    korisnik potvrdi da može da generiše validan kod iz svog Authenticator app-a
    preko /totp/setup_confirm. Time se sprečava da korisnik izgubi pristup jer
    je skenirao QR pa app pomerio ekran pre nego što je proverio da radi."""
    uid = session['user_id']
    username = session.get('username', 'user')
    # Ako korisnik već ima uključen TOTP, prvo mora da ga isključi
    with db.connect_raw(DB_FILE) as conn:
        c = conn.cursor()
        c.execute("SELECT totp_enabled FROM users WHERE id=?", (uid,))
        row = c.fetchone()
        if row and int(row[0] or 0) == 1:
            return jsonify({"error": "ALREADY_ENABLED",
                            "message": "2FA is already enabled. Disable it first if you want to re-enroll."}), 400

    secret = generate_secret()
    # Issuer name — vidi se u Authenticator app-u pored korisničkog imena
    issuer = 'Aspidus CRM'
    uri = provisioning_uri(secret, username, issuer)
    # Vratimo secret klijentu — on ga privremeno čuva u memoriji dok završava setup.
    # Baza NE PAMTI ovaj secret dok korisnik ne potvrdi u sledećem koraku.
    log_audit('SECURITY', 'auth', f'2FA setup started for {username}', is_suspicious=False)
    return jsonify({
        "status": "success",
        "secret": secret,
        "provisioning_uri": uri,
        "issuer": issuer,
        "account": username,
    })


@auth_bp.route('/api/auth/totp/setup_confirm', methods=['POST'])
@login_required
def totp_setup_confirm():
    """Korak 2: korisnik unese kod iz svog Authenticator app-a + secret koji je
    dobio u prethodnom koraku. Ako se kod poklopi, upisujemo secret u bazu i
    generišemo 8 recovery kodova. Recovery kodovi se vraćaju SAMO OVDE (jednom),
    plain-text, i korisnik mora da ih sačuva. U bazi se čuvaju samo hasovi."""
    data = request.get_json(silent=True) or {}
    secret = str(data.get('secret', '')).strip()
    code = str(data.get('code', '')).strip()
    if not secret or not code:
        return jsonify({"error": "MISSING_INPUT"}), 400
    if not totp_verify(secret, code):
        return jsonify({"error": "INVALID_CODE",
                        "message": "The 6-digit code does not match. Check your Authenticator app time and try again."}), 400

    plain_codes, hashed_codes = generate_recovery_codes(count=8)
    uid = session['user_id']
    try:
        with db.connect_raw(DB_FILE) as conn:
            c = conn.cursor()
            c.execute("UPDATE users SET totp_secret=?, totp_enabled=1, totp_recovery=? WHERE id=?",
                      (secret, json.dumps(hashed_codes), uid))
            conn.commit()
    except Exception:
        return jsonify({"error": "INTERNAL_SERVER_ERROR"}), 500

    log_audit('SECURITY', 'auth', f'2FA enabled for {session.get("username")}', is_suspicious=False)
    return jsonify({
        "status": "success",
        "message": "2FA is now active. Save the recovery codes below in a safe place — they will not be shown again.",
        "recovery_codes": plain_codes,
    })


@auth_bp.route('/api/auth/totp/disable', methods=['POST'])
@login_required
def totp_disable():
    """Korisnik isključuje 2FA. Zahteva trenutnu lozinku + validan TOTP kod
    (ili recovery kod) kao dvostruku zaštitu — da niko ko slučajno provali
    sesiju ne može da olabavi bezbednost naloga."""
    data = request.get_json(silent=True) or {}
    password = data.get('password', '')
    code = str(data.get('code', '')).strip()
    if not password or not code:
        return jsonify({"error": "MISSING_INPUT",
                        "message": "Password and current 2FA code required."}), 400

    uid = session['user_id']
    with db.connect_raw(DB_FILE) as conn:
        c = conn.cursor()
        c.execute("SELECT password, totp_secret, totp_recovery FROM users WHERE id=?", (uid,))
        row = c.fetchone()
    if not row: return jsonify({"error": "USER_NOT_FOUND"}), 404
    if not check_password_hash(row[0], password):
        return jsonify({"error": "WRONG_PASSWORD"}), 401
    # Prihvatamo i TOTP kod i recovery kod
    ok = totp_verify(row[1], code) if row[1] else False
    if not ok and row[2]:
        try:
            recovery_list = json.loads(row[2])
        except Exception:
            recovery_list = []
        matched, _rest = verify_recovery_code(recovery_list, code)
        ok = matched
    if not ok:
        return jsonify({"error": "INVALID_CODE"}), 401

    try:
        with db.connect_raw(DB_FILE) as conn:
            c = conn.cursor()
            c.execute("UPDATE users SET totp_secret=NULL, totp_enabled=0, totp_recovery=NULL WHERE id=?", (uid,))
            conn.commit()
    except Exception:
        return jsonify({"error": "INTERNAL_SERVER_ERROR"}), 500

    log_audit('SECURITY', 'auth', f'2FA disabled for {session.get("username")}', is_suspicious=True)
    return jsonify({"status": "success", "message": "2FA is now disabled."})


@auth_bp.route('/api/auth/totp/status', methods=['GET'])
@login_required
def totp_status():
    """Klijent proverava da li je 2FA uključeno na svom nalogu."""
    uid = session['user_id']
    with db.connect_raw(DB_FILE) as conn:
        c = conn.cursor()
        c.execute("SELECT totp_enabled, totp_recovery FROM users WHERE id=?", (uid,))
        row = c.fetchone()
    if not row: return jsonify({"enabled": False, "recovery_codes_remaining": 0})
    remaining = 0
    if row[1]:
        try: remaining = len(json.loads(row[1]))
        except Exception: pass
    return jsonify({"enabled": bool(int(row[0] or 0)), "recovery_codes_remaining": remaining})