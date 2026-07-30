import os
import time
import logging
from datetime import timedelta
from flask import Flask, render_template, jsonify, request, abort
from werkzeug.middleware.proxy_fix import ProxyFix

from config import SECRET_KEY, MAX_CONTENT_LENGTH, UPLOAD_FOLDER, PORTAL_UPLOAD_FOLDER
from database import init_db
from utils import (FirewallCache, log_audit, verify_csrf_token, _ensure_csrf_token,
                   load_firewall_settings, start_housekeeping, get_client_ip)

from routes.auth import auth_bp
from routes.users import users_bp
from routes.files import files_bp
from routes.audit import audit_bp
from routes.data import data_bp
from routes.comms import comms_bp
from routes.portal import portal_bp
from routes.firewall import firewall_bp
from routes.vault import vault_bp
from routes.system import system_bp
from routes.documents import documents_bp
from routes.logistics import logistics_bp
from routes.geo import geo_bp
from routes.sanctions import sanctions_bp, screen_batch as sanctions_screen_batch
from routes.documents_register import documents_register_bp
from routes.inventory import inventory_bp
from routes.supabase_webhook import supabase_webhook_bp
from routes.entities_extras import entities_extras_bp
from routes.reports import reports_bp
from routes.security_center import security_bp
from routes.user_tasks import user_tasks_bp
from routes.saved_filters import saved_filters_bp
from routes.activity_feed import activity_feed_bp
from routes.v23_admin import v23_admin_bp
from routes.v23_extras import v23_extras_bp
from routes.verify_public import verify_bp

# Konfiguracija sistemskog logovanja (sprečava ispisivanje osetljivih grešaka korisnicima)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)

# OBAVEZNO ZA PRODUKCIJU (Nginx/Cloudflare): Rešava problem lažiranja IP adresa
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

from config import SECRET_KEY_IS_GENERATED
if SECRET_KEY_IS_GENERATED:
    logger.warning("SECURITY WARNING: SECRET_KEY is auto-generated (not from env). Set SECRET_KEY env var for stable sessions.")

app.secret_key = SECRET_KEY
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['PORTAL_UPLOAD_FOLDER'] = PORTAL_UPLOAD_FOLDER

# BRUTALNA ZAŠTITA SESIJE - VOJNI STANDARD
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=2)
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = os.getenv('SESSION_COOKIE_SAMESITE', 'Lax')
app.config['SESSION_COOKIE_SECURE'] = os.getenv('SESSION_COOKIE_SECURE', 'false').lower() in ('true', '1', 'yes')
if not app.config['SESSION_COOKIE_SECURE']:
    logger.warning("NAPOMENA: SESSION_COOKIE_SECURE je isključen (dev/localhost). U produkciji sa HTTPS-om postaviti env SESSION_COOKIE_SECURE=true.")

init_db()
load_firewall_settings()
start_housekeeping()

app.register_blueprint(auth_bp)
app.register_blueprint(users_bp)
app.register_blueprint(files_bp)
app.register_blueprint(audit_bp)
app.register_blueprint(data_bp)
app.register_blueprint(comms_bp)
app.register_blueprint(portal_bp)
app.register_blueprint(firewall_bp)
app.register_blueprint(vault_bp)
app.register_blueprint(system_bp)
app.register_blueprint(documents_bp)
app.register_blueprint(logistics_bp)
app.register_blueprint(geo_bp)
app.register_blueprint(sanctions_bp)
app.register_blueprint(documents_register_bp)
app.register_blueprint(inventory_bp)
app.register_blueprint(supabase_webhook_bp)
app.register_blueprint(entities_extras_bp)
app.register_blueprint(reports_bp)
app.register_blueprint(security_bp)
app.register_blueprint(user_tasks_bp)
app.register_blueprint(saved_filters_bp)
app.register_blueprint(activity_feed_bp)
app.register_blueprint(v23_admin_bp)
app.register_blueprint(v23_extras_bp)
app.register_blueprint(verify_bp)

from routes.supabase_admin import supabase_admin_bp, record_error  # noqa: E402
app.register_blueprint(supabase_admin_bp)


# =====================================================================
# ISPRAVKA: CSP nonce se sada generiše U BEFORE_REQUEST (ne u after_request).
# Ranije je nonce generisan tek u after_request — dakle NAKON renderovanja
# šablona — pa je {{ g.csp_nonce }} u index.html bio PRAZAN, dok je u CSP
# header bio DRUGI (pravi) nonce. Browser je zbog mismatch-a blokirao inline
# <script> u kom je login handler → forma nikada nije slala POST
# /api/auth/login, već je radila native GET submit i korisnik ostajao na
# login ekranu. Sada je nonce isti i u HTML-u i u headeru.
# =====================================================================
@app.before_request
def generate_csp_nonce():
    import secrets as _secrets_nonce
    from flask import g as _g_nonce
    _g_nonce.csp_nonce = _secrets_nonce.token_urlsafe(16)


@app.before_request
def enforce_csrf():
    """Odbija POST/PUT/DELETE/PATCH bez validnog X-CSRF-Token header-a.
    Portal rute i login se preskaču (imaju drugu odbranu — OTP odn. brute-force
    limit). GET/HEAD/OPTIONS su prirodno idempotentni."""
    if request.path.startswith('/static'):
        return
    if not verify_csrf_token():
        log_audit('SECURITY', 'system', f'CSRF token missing/invalid for {request.method} {request.path}', is_suspicious=True)
        return jsonify({"error": "CSRF_TOKEN_INVALID"}), 403

@app.before_request
def check_crm_session_timeout():
    from flask import session as flask_session
    if 'user_id' in flask_session and not request.path.startswith('/portal') and not request.path.startswith('/static'):
        now = time.time()
        last = flask_session.get('last_active', flask_session.get('login_time', 0))
        ttl = int(FirewallCache.settings.get('crm_inactivity', 1200))
        if now - last > ttl:
            username = flask_session.get('username', 'unknown')
            log_audit('SECURITY', 'system', f'Session expired due to inactivity for user: {username}', is_suspicious=False)
            flask_session.clear()
            if request.path.startswith('/api/'):
                return jsonify({"error": "SESSION_EXPIRED"}), 401
            return
        flask_session['last_active'] = now

@app.before_request
def limit_login_attempts():
    if request.endpoint == 'auth.login' and request.method == 'POST':
        ip = request.remote_addr
        if ip in FirewallCache.whitelist:
            return
        now = time.time()
        attempts = FirewallCache.login_attempts.get(ip, [])
        valid_attempts = [t for t in attempts if now - t < 300]
        if len(valid_attempts) >= FirewallCache.settings.get('max_login', 10):
            logger.warning(f"Brute force attempt blocked from IP: {ip}")
            log_audit('SECURITY_BLOCK', 'firewall', f'IP {ip} blocked due to excessive login attempts.', is_suspicious=True)
            abort(429, description="Too many login attempts. Your IP address is blocked for 5 minutes for security reasons.")
        valid_attempts.append(now)
        FirewallCache.login_attempts[ip] = valid_attempts

# === GLOBALNI HVATAČI GREŠAKA ===

@app.errorhandler(413)
def request_entity_too_large(error):
    logger.warning(f"Payload too large from IP: {request.remote_addr}")
    log_audit('SECURITY_WARNING', 'upload', f'Payload too large attempt from IP {request.remote_addr}', is_suspicious=True)
    return jsonify({"error": "File exceeds the maximum allowed size on the server."}), 413

@app.errorhandler(429)
def ratelimit_handler(e):
    return jsonify({"error": str(e.description)}), 429

@app.errorhandler(404)
def not_found_error(error):
    if request.path.startswith('/api/'):
        return jsonify({"error": "Requested resource not found."}), 404
    return render_template('index.html'), 404

@app.errorhandler(500)
def internal_server_error(error):
    import uuid
    req_id = uuid.uuid4().hex[:12]
    logger.error(f"Internal Server Error [{req_id}]: {request.path} - {str(error)}", exc_info=True)
    log_audit('CRITICAL_ERROR', 'system', f"Endpoint {request.path} failed (req={req_id}).", is_suspicious=True)
    try:
        record_error(
            context=request.path,
            exc=error,
            request_id=req_id,
            meta={
                "method": request.method,
                "ip": get_client_ip(),
                "user_agent": request.headers.get('User-Agent', ''),
                "referrer": request.headers.get('Referer', ''),
            },
        )
    except Exception:
        pass
    if request.path.startswith('/api/'):
        return jsonify({
            "error": "Internal Server Error",
            "message": "Došlo je do interne greške. Administrator je obavešten. Ako se ponovi, javi ga sa ID-em.",
            "request_id": req_id,
            "hint": "Detalji su vidljivi u /admin/errors stranici (admin only).",
        }), 500
    return render_template('index.html'), 500

@app.errorhandler(405)
def method_not_allowed(error):
    if request.path.startswith('/api/'):
        return jsonify({"error": "Method not allowed for this endpoint."}), 405
    return render_template('index.html'), 405

@app.after_request
def apply_brutal_security_headers(response):
    response.cache_control.no_store = True
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, post-check=0, pre-check=0, max-age=0'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Permissions-Policy'] = (
        'accelerometer=(), autoplay=(), camera=(), clipboard-read=(self), '
        'display-capture=(), encrypted-media=(), fullscreen=(self), '
        'geolocation=(self), gyroscope=(), hid=(), magnetometer=(), '
        'microphone=(), midi=(), payment=(), picture-in-picture=(), '
        'publickey-credentials-get=(self), screen-wake-lock=(), '
        'serial=(), sync-xhr=(self), usb=(), xr-spatial-tracking=()'
    )
    response.headers['Cross-Origin-Opener-Policy'] = 'same-origin'
    response.headers['Cross-Origin-Resource-Policy'] = 'same-origin'
    response.headers['X-Permitted-Cross-Domain-Policies'] = 'none'

    if request.path.startswith('/portal') or request.path.startswith('/api/portal'):
        response.headers['X-Robots-Tag'] = 'noindex, nofollow, noarchive, nosnippet'

    import os as _os_csp
    _sb_url = _os_csp.environ.get('SUPABASE_URL', '').strip().rstrip('/')
    _sb_host = ''
    if _sb_url:
        _sb_host = _sb_url.replace('https://', '').replace('http://', '')
    _sb_https = f'https://{_sb_host}' if _sb_host else ''

    # === ISPRAVKA: koristimo nonce koji je VeĆ generisan u before_request ===
    from flask import g as _g_csp
    _csp_nonce = getattr(_g_csp, 'csp_nonce', None)
    if not _csp_nonce:
        import secrets as _secrets_csp
        _csp_nonce = _secrets_csp.token_urlsafe(16)
        _g_csp.csp_nonce = _csp_nonce

    csp = (
        "default-src 'self'; "
        f"script-src 'self' 'nonce-{_csp_nonce}' "
        "https://cdn.tailwindcss.com https://cdn.jsdelivr.net "
        "https://cdnjs.cloudflare.com https://unpkg.com "
        "https://esm.sh "
        "https://hcaptcha.com https://*.hcaptcha.com; "
        "script-src-elem 'self' 'nonce-{_csp_nonce}' "
        "https://cdn.tailwindcss.com https://cdn.jsdelivr.net "
        "https://cdnjs.cloudflare.com https://unpkg.com "
        "https://esm.sh "
        "https://hcaptcha.com https://*.hcaptcha.com; "
        "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com "
        "https://cdn.jsdelivr.net https://cdnjs.cloudflare.com "
        "https://unpkg.com https://hcaptcha.com https://*.hcaptcha.com; "
        "font-src 'self' data: https://cdnjs.cloudflare.com; "
        "img-src 'self' data: blob: https://googleusercontent.com "
        "https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org; "
        "frame-src 'self' blob: https://hcaptcha.com https://*.hcaptcha.com; "
        "connect-src 'self' https://ip-api.com https://open.er-api.com "
        "https://api.exchangerate.host https://nominatim.openstreetmap.org "
        "https://router.project-osrm.org https://www.trading-economics.com "
        "https://esm.sh "
        + (f"{_sb_https} " if _sb_https else "")
        + "https://hcaptcha.com https://*.hcaptcha.com;"
    )
    response.headers['Content-Security-Policy'] = csp
    response.headers.pop('Server', None)
    return response

@app.route('/robots.txt', methods=['GET'])
def robots_txt():
    from flask import Response
    return Response(
        "User-agent: *\n"
        "Disallow: /portal\n"
        "Disallow: /portal/\n"
        "Disallow: /api/\n",
        mimetype='text/plain'
    )

@app.route('/api/csrf/token', methods=['GET'])
def csrf_token_endpoint():
    return jsonify({"csrf_token": _ensure_csrf_token()})

@app.route('/')
def index():
    _ensure_csrf_token()
    return render_template('index.html')

if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=5000)
