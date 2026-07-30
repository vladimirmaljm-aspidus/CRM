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
# ISPRAVKA: ranije nije bio postavljen, pa je /portal_uploads/<filename> (u
# routes/portal/actions.py) uvek bacao KeyError -> 500 pri preuzimanju KYC/portal fajlova.
app.config['PORTAL_UPLOAD_FOLDER'] = PORTAL_UPLOAD_FOLDER

# BRUTALNA ZAŠTITA SESIJE - VOJNI STANDARD
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=2)
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Strict'

# Sesijski kolačić sa Secure flagom se NE ŠALJE preko nešifrovanog HTTP-a (npr.
# http://localhost), pa bi uključivanje ovoga u lokalnom razvoju "odjavljivalo"
# korisnika odmah nakon prijave. Zato je podrazumevano isključeno (za localhost),
# a u PRODUKCIJI (pravi domen sa HTTPS-om) OBAVEZNO postaviti env SESSION_COOKIE_SECURE=true.
app.config['SESSION_COOKIE_SECURE'] = os.getenv('SESSION_COOKIE_SECURE', 'false').lower() in ('true', '1', 'yes')
if not app.config['SESSION_COOKIE_SECURE']:
    logger.warning("NAPOMENA: SESSION_COOKIE_SECURE je isključen (dev/localhost). U produkciji sa HTTPS-om postaviti env SESSION_COOKIE_SECURE=true.")

# Inicijalizacija/migracija baze pri učitavanju aplikacije.
# VAŽNO: ranije se init_db() zvao samo u __main__ bloku, pa se pod
# `flask run` i gunicorn-om (produkcija) nije izvršavao — nove migracije
# (npr. kolona 'signature') se ne bi primenile. Sada se izvršava uvek.
init_db()

# V22.04.05: SQLite WAL bootstrap uklonjen - DB fajlovi se rekreiraju cisti pri prvom startu

# Učitaj firewall/session postavke (admin ih menja preko Settings modula) i
# pokreni pozadinsko održavanje (rotacija audit log-a, čišćenje kešova).
load_firewall_settings()
start_housekeeping()

# Registracija modula (Blueprints)
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
# /verify/<VER-hash> — javni endpoint koji vodi na potvrdu dokumenta iz QR koda
# na ponudi/fakturi. Bez registracije ovog bp-a, QR na PDF-u vodi u 404.
app.register_blueprint(verify_bp)

# Supabase admin API — status, migration control, feature flag switching.
# Sve rute su admin-only i loguju se u audit_log.
from routes.supabase_admin import supabase_admin_bp, record_error  # noqa: E402
app.register_blueprint(supabase_admin_bp)


# NOTE: postojao je duplirani @app.errorhandler(500) handler ispod ove tacke
# (internal_server_error) koji je _overridovao_ ovaj i klijentu nije vracao
# request_id. Merged u jedan handler dole (linija ~213).

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
    """
    Optimizovan i osiguran sistem za blokiranje Brute Force napada.
    """
    if request.endpoint == 'auth.login' and request.method == 'POST':
        ip = request.remote_addr
        
        if ip in FirewallCache.whitelist:
            return
        
        now = time.time()
        
        # Očisti stare pokušaje
        attempts = FirewallCache.login_attempts.get(ip, [])
        valid_attempts = [t for t in attempts if now - t < 300]
        
        # Provera pre nego što dodamo novi pokušaj (sprečava produžavanje kazne u beskraj)
        if len(valid_attempts) >= FirewallCache.settings.get('max_login', 10):
            logger.warning(f"Brute force attempt blocked from IP: {ip}")
            log_audit('SECURITY_BLOCK', 'firewall', f'IP {ip} blocked due to excessive login attempts.', is_suspicious=True)
            abort(429, description="Too many login attempts. Your IP address is blocked for 5 minutes for security reasons.")
        
        # Ako nije blokiran, upiši trenutni pokušaj
        valid_attempts.append(now)
        FirewallCache.login_attempts[ip] = valid_attempts

# === GLOBALNI HVATAČI GREŠAKA (ZABRANJUJU CURENJE INFORMACIJA) ===

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
    # Dodat pravilan HTTP status kod
    return render_template('index.html'), 404

@app.errorhandler(500)
def internal_server_error(error):
    """
    Napadaču ne curimo Python traceback — klijentu vraćamo generičku poruku
    + kratak request_id da može admin da nađe traceback u /admin/errors.
    """
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
    # Dodat pravilan HTTP status kod
    return render_template('index.html'), 405

@app.after_request
def apply_brutal_security_headers(response):
    """
    Aplikacija bezbednosnih zaglavlja i onemogućavanje keširanja za osetljive rute.
    """
    response.cache_control.no_store = True
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, post-check=0, pre-check=0, max-age=0'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    
    # HSTS - Prisiljava pretraživač da narednih godinu dana komunicira isključivo preko HTTPS-a
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload'

    # Dodatni sloj: onemogući curenje referrer-a, isključi opasne browser API-je
    # (kamera/mikrofon/USB/serial), izoluj window od cross-origin popup-a, i
    # blokiraj Adobe/Silverlight cross-domain policy fajlove.
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

    # NOINDEX za PORTAL — B2B portal ne sme da se pojavi u Google/Bing rezultatima.
    # Zaposleni CRM je već iza login-a, ali portal linkovi kruže preko emaila i
    # neko može slučajno da ga podeli javno. Ovaj zaglavlje eksplicitno kaže
    # svim ozbiljnim crawler-ima da ga NE indeksiraju.
    if request.path.startswith('/portal') or request.path.startswith('/api/portal'):
        response.headers['X-Robots-Tag'] = 'noindex, nofollow, noarchive, nosnippet'
    
    # Sadržajna polisa (CSP) — dozvoljeni izvori za skripte/style/API
    #
    # BEZBEDNOSNA NAPOMENA: 'unsafe-inline' i 'unsafe-eval' su prethodno bili
    # globalno dozvoljeni u script-src — to praktično poništava CSP zaštitu
    # jer bilo koji XSS payload može da izvršava proizvoljan JS. Sada koristimo
    # per-request nonce (jednokratni broj) za inline skripte — frontend mora
    # da ubaci <script nonce="..."> atribut. 'unsafe-eval' je uklonjen jer
    # nije potreban osim ako se ne koristi eval()/new Function() što mi ne radimo.
    #
    # script-src:
    #  - 'nonce-<random>'      — inline skripte sa odgovarajućim nonce atributom
    #  - cdn.tailwindcss.com   — Tailwind runtime (utility CSS)
    #  - cdn.jsdelivr.net      — Chart.js (dashboard) + SheetJS (XLSX import), lazy-loaded
    #  - cdnjs.cloudflare.com  — jsPDF fallback + Leaflet + Font Awesome
    #  - unpkg.com             — Leaflet
    #  - hcaptcha.com + *.hcaptcha.com — portal anti-bot widget
    #
    # connect-src (XHR/fetch iz browser-a):
    #  - Sopstveni /api/*             — 'self'
    #  - ip-api.com                   — geo lookup pri login-u
    #  - open.er-api.com              — legacy FX (deal profit calc)
    #  - exchangerate.host            — nove FX rate (v22 dashboard)
    #  - nominatim.openstreetmap.org  — geocode adresa
    #  - router.project-osrm.org      — kopneno rutiranje (logistics)
    #  - hcaptcha.com                 — portal captcha verify
    #  - *.basemaps.cartocdn.com      — Leaflet tile-ovi (u img-src ispod)
    # Supabase host — čitamo iz env-a da nadaomo Auth i Storage endpoint-ima
    # u CSP allow-listu. Ako SUPABASE_URL nije postavljen, ostavljamo prazan
    # placeholder (nema efekta ni na koju konekciju).
    import os as _os_csp
    import secrets as _secrets_csp
    _sb_url = _os_csp.environ.get('SUPABASE_URL', '').strip().rstrip('/')
    _sb_host = ''
    if _sb_url:
        _sb_host = _sb_url.replace('https://', '').replace('http://', '')
    _sb_https = f'https://{_sb_host}' if _sb_host else ''

    # Generišemo per-request nonce i izlažemo ga kao g.csp_nonce radi korišćenja
    # u šablonima preko {{ g.csp_nonce }}.
    _csp_nonce = _secrets_csp.token_urlsafe(16)
    from flask import g as _g_csp
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
    
    # Brisanje Server zaglavlja kako napadači ne bi znali koju verziju softvera koristimo
    response.headers.pop('Server', None)
    
    return response

@app.route('/robots.txt', methods=['GET'])
def robots_txt():
    """Search engines dobiju eksplicitno Disallow za sve /portal i /api rute."""
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
    """Vraća aktuelni CSRF token trenutne sesije. Frontend ga poziva pri startu
    i posle svakog login-a; drži ga u memoriji i šalje u X-CSRF-Token header."""
    return jsonify({"csrf_token": _ensure_csrf_token()})


@app.route('/')
def index():
    _ensure_csrf_token()
    return render_template('index.html')

if __name__ == '__main__':
    # Pokretanje servera (OBAVEZNO debug=False za sigurnost)
    app.run(debug=False, host='0.0.0.0', port=5000)