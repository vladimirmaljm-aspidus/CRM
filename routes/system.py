"""System/health endpointi za admin monitoring.

Cilj: dati adminu instant pregled zdravlja instance (baze, disk, backup-i,
housekeeping thread) bez SSH-a na server. Ništa što otkriva čita se bez admin role.
"""
import db
import os
import sqlite3
import time
from datetime import datetime, timezone

from flask import Blueprint, jsonify, session, request

from config import DB_FILE, PORTAL_DB_FILE, AUDIT_DB_FILE, DATA_DIR, UPLOAD_FOLDER, PORTAL_UPLOAD_FOLDER
from utils import login_required, log_audit, FirewallCache, encrypt_data

system_bp = Blueprint('system', __name__, url_prefix='/api/system')


def _is_admin():
    return session.get('role') == 'admin'


def _db_stats(path):
    if not os.path.exists(path):
        return {'exists': False}
    try:
        st = os.stat(path)
        row_counts = {}
        with db.connect_raw(path, timeout=10.0) as conn:
            c = conn.cursor()
            c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
            tables = [r[0] for r in c.fetchall()]
            for t in tables:
                try:
                    row_counts[t] = c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                except Exception:
                    row_counts[t] = None
        return {
            'exists': True,
            'size_bytes': st.st_size,
            'size_mb': round(st.st_size / 1024 / 1024, 2),
            'modified_at': datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat().replace('+00:00', 'Z'),
            'tables': row_counts,
        }
    except Exception as e:
        return {'exists': True, 'error': str(e)}


def _dir_size(path):
    total = 0
    if not os.path.isdir(path):
        return 0
    try:
        for root, _dirs, files in os.walk(path):
            for f in files:
                try:
                    total += os.path.getsize(os.path.join(root, f))
                except Exception:
                    pass
    except Exception:
        pass
    return total


@system_bp.route('/health', methods=['GET'])
@login_required
def health():
    """Admin-only. Vraća JSON o stanju sistema — koristi se za dashboard indikator
    i za brzu dijagnostiku problema u produkciji."""
    if not _is_admin():
        return jsonify({"error": "ACCESS_DENIED"}), 403

    backups_dir = os.path.join(DATA_DIR, 'backups')
    backups = []
    if os.path.isdir(backups_dir):
        try:
            for name in sorted(os.listdir(backups_dir), reverse=True)[:20]:
                if not name.endswith('.fernet'):
                    continue
                p = os.path.join(backups_dir, name)
                try:
                    st = os.stat(p)
                    backups.append({
                        'name': name,
                        'size_kb': round(st.st_size / 1024, 1),
                        'created_at': datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat().replace('+00:00', 'Z'),
                    })
                except Exception:
                    pass
        except Exception:
            pass

    try:
        vfs = os.statvfs(DATA_DIR)
        disk = {
            'total_gb': round(vfs.f_frsize * vfs.f_blocks / 1e9, 2),
            'available_gb': round(vfs.f_frsize * vfs.f_bavail / 1e9, 2),
            'used_percent': round((1 - vfs.f_bavail / vfs.f_blocks) * 100, 1) if vfs.f_blocks else None,
        }
    except Exception:
        disk = {'error': 'statvfs unavailable'}

    firewall_snapshot = {
        'blacklist_size': len(FirewallCache.blacklist),
        'whitelist_size': len(FirewallCache.whitelist),
        'active_ips_tracking_logins': len(FirewallCache.login_attempts),
        'settings': dict(FirewallCache.settings),
    }

    # Bulletproof-DB pragme (WAL, busy_timeout, integrity_check) —
    # pokazuje da li je hardening iz db.py stvarno primenjen.
    db_pragmas = {}
    try:
        import db as _db
        for _name, _p in (('crm', DB_FILE), ('portal', PORTAL_DB_FILE), ('audit', AUDIT_DB_FILE)):
            db_pragmas[_name] = _db.health_check(_p)
    except Exception as _e:
        db_pragmas = {'error': str(_e)}

    payload = {
        'timestamp': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'databases': {
            'crm': _db_stats(DB_FILE),
            'portal': _db_stats(PORTAL_DB_FILE),
            'audit': _db_stats(AUDIT_DB_FILE),
        },
        'db_pragmas': db_pragmas,
        'storage': {
            'data_dir': DATA_DIR,
            'uploads_size_mb': round(_dir_size(UPLOAD_FOLDER) / 1024 / 1024, 2),
            'portal_uploads_size_mb': round(_dir_size(PORTAL_UPLOAD_FOLDER) / 1024 / 1024, 2),
            'backups_total_mb': round(_dir_size(backups_dir) / 1024 / 1024, 2) if os.path.isdir(backups_dir) else 0,
            'disk': disk,
        },
        'backups': {
            'directory': backups_dir,
            'count_recent': len(backups),
            'latest': backups[0] if backups else None,
            'recent': backups,
        },
        'firewall': firewall_snapshot,
    }
    return jsonify(payload)


@system_bp.route('/backup/now', methods=['POST'])
@login_required
def backup_now():
    """Ručno pokreni backup ciklus (osim automatskog dnevnog).
    Radi u pozadinskom threadu — endpoint se odmah vraća."""
    if not _is_admin():
        return jsonify({"error": "ACCESS_DENIED"}), 403
    import threading
    from utils import _backup_loop
    # Ne pokrećemo ceo loop — samo jedan pass. Kopiramo logiku:
    from cryptography.fernet import Fernet
    from utils import cipher_suite

    def _one_shot():
        try:
            backups_dir = os.path.join(DATA_DIR, 'backups')
            os.makedirs(backups_dir, exist_ok=True)
            ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            for db_path in (DB_FILE, PORTAL_DB_FILE, AUDIT_DB_FILE):
                if not os.path.exists(db_path):
                    continue
                tmp = os.path.join(backups_dir, f'.tmp_{os.path.basename(db_path)}')
                src = db.connect_raw(db_path, timeout=30.0)
                dst = db.connect_raw(tmp, timeout=30.0)
                with dst:
                    src.backup(dst)
                dst.close(); src.close()
                with open(tmp, 'rb') as f: raw = f.read()
                out = os.path.join(backups_dir, f'{os.path.basename(db_path)}.{ts}.MANUAL.fernet')
                with open(out, 'wb') as f: f.write(cipher_suite.encrypt(raw))
                os.remove(tmp)
                try: os.chmod(out, 0o600)
                except Exception: pass
        except Exception:
            pass

    threading.Thread(target=_one_shot, daemon=True).start()
    log_audit('CREATE', 'system', 'Admin-triggered manual backup started', is_suspicious=False)
    return jsonify({"status": "success", "message": "Backup started in background."})


# ==========================================================
#  FULL BACKUP — sve baze + uploads + ključevi u jedan tar.gz
# ==========================================================
# Za razliku od /backup/now koji pravi šifrovane pojedinačne .fernet snapshote,
# ovaj endpoint pravi KOMPLETAN prenosivi arhiv (tar.gz):
#   • sve 3 baze (VACUUM-ovane, integrity-checked)
#   • uploads/ i portal_uploads/
#   • vault.key i secret.key (bez njih se šifrovane vrednosti ne mogu dešifrovati)
#   • meta.json (row count po tabeli, SHA256, verzija)
#   • RESTORE.md (uputstvo za oporavak — u samom arhivu)
# Streamuje se direktno klijentu — ništa se ne piše na disk servera.

@system_bp.route('/backup/full', methods=['GET'])
@login_required
def backup_full_download():
    """Admin-only. Streamuje kompletan .tar.gz backup — baze + fajlovi + ključevi."""
    if not _is_admin():
        return jsonify({"error": "ACCESS_DENIED"}), 403
    import io as _io
    import sys as _sys
    from flask import Response
    # Ubaci scripts/ u sys.path i pozovi build_backup u streaming režimu.
    _scripts = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'scripts')
    if _scripts not in _sys.path:
        _sys.path.insert(0, _scripts)
    try:
        from db_export_full import build_backup
    except Exception as e:
        return jsonify({"error": "BACKUP_MODULE_MISSING", "detail": str(e)}), 500

    buf = _io.BytesIO()
    try:
        build_backup(out_path=None, out_stream=buf, quiet=True)
    except Exception as e:
        log_audit('CREATE', 'system', f'Full backup failed: {e}', is_suspicious=False)
        return jsonify({"error": "BACKUP_FAILED", "detail": str(e)}), 500

    payload = buf.getvalue()
    ts = datetime.now(timezone.utc).strftime('%Y-%m-%d_%H-%M-%S')
    filename = f'ASPIDUS_FULL_BACKUP_{ts}.tar.gz'
    log_audit('CREATE', 'system',
              f'Admin downloaded full backup ({len(payload)/1024/1024:.2f} MB)',
              is_suspicious=False)
    return Response(
        payload,
        mimetype='application/gzip',
        headers={
            'Content-Disposition': f'attachment; filename="{filename}"',
            'Content-Length': str(len(payload)),
            'X-Backup-Format-Version': '1',
        },
    )


# ==========================================================
#  OTP DELIVERY CONFIG — transactional email provider + magic link
# ==========================================================

@system_bp.route('/otp_delivery', methods=['GET'])
@login_required
def get_otp_delivery():
    """Vraća redigovanu konfiguraciju (API ključ se ne otkriva) — koristi Settings UI."""
    if not _is_admin():
        return jsonify({"error": "UNAUTHORIZED"}), 403
    from mail_providers import config_summary
    return jsonify(config_summary())


@system_bp.route('/otp_delivery', methods=['POST'])
@login_required
def set_otp_delivery():
    """Snima OTP delivery konfiguraciju. Encrypted u settings.otpMailProvider.
    API ključ se traži samo kad se menja provider ili kad admin eksplicitno pošalje
    'change_api_key: true' i novi 'api_key' — u suprotnom čuvamo postojeći ključ."""
    if not _is_admin():
        return jsonify({"error": "UNAUTHORIZED"}), 403
    import sqlite3, json
    from utils import decrypt_data
    from mail_providers import clear_config_cache

    payload = request.get_json(silent=True) or {}
    provider = str(payload.get('provider', 'smtp')).lower().strip()
    if provider not in ('smtp', 'resend', 'sendgrid', 'postmark'):
        return jsonify({"error": "INVALID_PROVIDER"}), 400

    # Učitaj postojeći config da sačuvamo API ključ ako korisnik ne menja
    existing = {}
    try:
        with db.connect_raw(DB_FILE) as conn:
            row = conn.execute("SELECT value FROM settings WHERE key='otpMailProvider'").fetchone()
            if row and row[0]:
                try: existing = decrypt_data(row[0]) or {}
                except Exception: existing = {}
    except Exception:
        pass

    new_cfg = {
        'provider': provider,
        'from_email': str(payload.get('from_email', existing.get('from_email', ''))).strip()[:120],
        'from_name': str(payload.get('from_name', existing.get('from_name', 'Aspidus'))).strip()[:80],
        'magic_link_enabled': bool(payload.get('magic_link_enabled', False)),
        'magic_link_ttl_min': max(5, min(int(payload.get('magic_link_ttl_min', 15) or 15), 60)),
    }

    # API key: menjaj samo ako je poslat, u suprotnom nasledi postojeći
    api_key_in = str(payload.get('api_key', '')).strip()
    if provider == 'smtp':
        new_cfg['api_key'] = ''  # SMTP nema api_key
    elif api_key_in:
        new_cfg['api_key'] = api_key_in
    else:
        new_cfg['api_key'] = existing.get('api_key', '')

    # Validacija api_key formata po provideru
    if provider == 'resend' and new_cfg['api_key'] and not new_cfg['api_key'].startswith('re_'):
        return jsonify({"error": "RESEND_KEY_INVALID",
                        "message": "Resend API key must start with 're_'"}), 400
    if provider == 'sendgrid' and new_cfg['api_key'] and not new_cfg['api_key'].startswith('SG.'):
        return jsonify({"error": "SENDGRID_KEY_INVALID",
                        "message": "SendGrid API key must start with 'SG.'"}), 400

    try:
        with db.connect_raw(DB_FILE) as conn:
            conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('otpMailProvider', ?)",
                         (encrypt_data(new_cfg),))
            conn.commit()
    except Exception as e:
        return jsonify({"error": "SAVE_FAILED", "message": str(e)}), 500

    clear_config_cache()
    log_audit('SECURITY', 'system',
              f'OTP delivery provider changed to {provider} by {session.get("username","?")}',
              is_suspicious=False)
    return jsonify({"status": "success", "provider": provider})


@system_bp.route('/chat_webhooks', methods=['GET'])
@login_required
def get_chat_webhooks():
    """Redigovan pregled — API tokeni se ne otkrivaju."""
    if not _is_admin():
        return jsonify({"error": "UNAUTHORIZED"}), 403
    import sqlite3
    from utils import decrypt_data
    cfg = {}
    try:
        with db.connect_raw(DB_FILE) as conn:
            row = conn.execute("SELECT value FROM settings WHERE key='chatWebhooks'").fetchone()
            if row and row[0]:
                try: cfg = decrypt_data(row[0]) or {}
                except Exception: cfg = {}
    except Exception:
        pass
    def _mask(s):
        s = str(s or '')
        return (s[:8] + '…' + s[-4:]) if len(s) > 15 else ('•' * len(s))
    return jsonify({
        'slack': cfg.get('slack', ''),   # URL nije tajna, samo znak da je konfigurisano
        'teams': cfg.get('teams', ''),
        'telegram_bot_token': _mask(cfg.get('telegram_bot_token', '')) if cfg.get('telegram_bot_token') else '',
        'telegram_chat_id': cfg.get('telegram_chat_id', ''),
        'ntfy_url': cfg.get('ntfy_url', ''),
        'whatsapp_phone_id': cfg.get('whatsapp_phone_id', ''),
        'whatsapp_token': _mask(cfg.get('whatsapp_token', '')) if cfg.get('whatsapp_token') else '',
        'whatsapp_to': cfg.get('whatsapp_to', ''),
        'events': cfg.get('events', ['offer_accepted','offer_declined','kyc_submitted',
                                     'sanctions_flag','deal_created','document_signed']),
        'has_slack': bool(cfg.get('slack')),
        'has_teams': bool(cfg.get('teams')),
        'has_telegram': bool(cfg.get('telegram_bot_token') and cfg.get('telegram_chat_id')),
        'has_ntfy': bool(cfg.get('ntfy_url')),
        'has_whatsapp': bool(cfg.get('whatsapp_token') and cfg.get('whatsapp_phone_id')),
    })


@system_bp.route('/chat_webhooks', methods=['POST'])
@login_required
def set_chat_webhooks():
    """Snima chat notifikacijsku konfiguraciju. Sve tajne se enkriptuju."""
    if not _is_admin():
        return jsonify({"error": "UNAUTHORIZED"}), 403
    import sqlite3
    from utils import decrypt_data
    from webhooks import clear_cache

    payload = request.get_json(silent=True) or {}
    existing = {}
    try:
        with db.connect_raw(DB_FILE) as conn:
            row = conn.execute("SELECT value FROM settings WHERE key='chatWebhooks'").fetchone()
            if row and row[0]:
                try: existing = decrypt_data(row[0]) or {}
                except Exception: existing = {}
    except Exception:
        pass

    # Za tajne (bot_token, whatsapp_token): sačuvaj postojeći ako je nova
    # vrednost prazna ili maskirana (sadrži '…' ili samo '•')
    def _preserve(new, old):
        s = str(new or '').strip()
        if not s or '…' in s or set(s) <= {'•'}: return str(old or '')
        return s

    new_cfg = {
        'slack': str(payload.get('slack', '')).strip(),
        'teams': str(payload.get('teams', '')).strip(),
        'telegram_bot_token': _preserve(payload.get('telegram_bot_token'), existing.get('telegram_bot_token')),
        'telegram_chat_id':   str(payload.get('telegram_chat_id', '')).strip(),
        'ntfy_url':           str(payload.get('ntfy_url', '')).strip(),
        'whatsapp_phone_id':  str(payload.get('whatsapp_phone_id', '')).strip(),
        'whatsapp_token':     _preserve(payload.get('whatsapp_token'), existing.get('whatsapp_token')),
        'whatsapp_to':        str(payload.get('whatsapp_to', '')).strip(),
        'events':             list(payload.get('events') or []),
    }
    try:
        with db.connect_raw(DB_FILE) as conn:
            conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('chatWebhooks', ?)",
                         (encrypt_data(new_cfg),))
            conn.commit()
    except Exception as e:
        return jsonify({"error": "SAVE_FAILED", "message": str(e)}), 500

    clear_cache()
    log_audit('SECURITY', 'system',
              f'Chat webhooks reconfigured by {session.get("username","?")}',
              is_suspicious=False)
    return jsonify({"status": "success"})


@system_bp.route('/chat_webhooks/test', methods=['POST'])
@login_required
def test_chat_webhooks():
    """Šalje test poruku na sve konfigurisane kanale."""
    if not _is_admin():
        return jsonify({"error": "UNAUTHORIZED"}), 403
    from webhooks import notify
    notify('offer_accepted', {  # koristimo poznat event tip za test
        'Test': 'This is a test notification from Aspidus CRM',
        'Triggered by': session.get('username', '?'),
        'When': datetime.now(timezone.utc).isoformat().replace('+00:00','Z')[:19],
    })
    return jsonify({"status": "success", "message": "Test dispatched to all configured channels."})


@system_bp.route('/hcaptcha', methods=['GET'])
@login_required
def get_hcaptcha_config():
    """Redigovan pregled hCaptcha config-a."""
    if not _is_admin():
        return jsonify({"error": "UNAUTHORIZED"}), 403
    import sqlite3
    from utils import decrypt_data
    cfg = {}
    try:
        with db.connect_raw(DB_FILE) as conn:
            row = conn.execute("SELECT value FROM settings WHERE key='hcaptchaConfig'").fetchone()
            if row and row[0]:
                try: cfg = decrypt_data(row[0]) or {}
                except Exception: cfg = {}
    except Exception:
        pass
    secret = str(cfg.get('secret', ''))
    return jsonify({
        'sitekey': cfg.get('sitekey', ''),  # sitekey je public, otkriva se
        'has_secret': bool(secret),
        'secret_masked': (secret[:6] + '…' + secret[-4:]) if len(secret) > 12 else '',
    })


@system_bp.route('/hcaptcha', methods=['POST'])
@login_required
def set_hcaptcha_config():
    if not _is_admin():
        return jsonify({"error": "UNAUTHORIZED"}), 403
    import sqlite3
    from utils import decrypt_data
    from security_ext import clear_hcaptcha_cache

    payload = request.get_json(silent=True) or {}
    existing = {}
    try:
        with db.connect_raw(DB_FILE) as conn:
            row = conn.execute("SELECT value FROM settings WHERE key='hcaptchaConfig'").fetchone()
            if row and row[0]:
                try: existing = decrypt_data(row[0]) or {}
                except Exception: existing = {}
    except Exception:
        pass

    new_secret = str(payload.get('secret', '')).strip()
    if not new_secret or '…' in new_secret:
        new_secret = str(existing.get('secret', ''))

    cfg = {
        'sitekey': str(payload.get('sitekey', '')).strip(),
        'secret': new_secret,
    }
    try:
        with db.connect_raw(DB_FILE) as conn:
            conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('hcaptchaConfig', ?)",
                         (encrypt_data(cfg),))
            conn.commit()
    except Exception as e:
        return jsonify({"error": "SAVE_FAILED", "message": str(e)}), 500

    clear_hcaptcha_cache()
    log_audit('SECURITY', 'system', f'hCaptcha reconfigured by {session.get("username","?")}',
              is_suspicious=False)
    return jsonify({"status": "success", "enabled": bool(cfg['sitekey']) and bool(cfg['secret'])})


# ==========================================================
#  API KEYS — tracking (17TRACK, MarineTraffic, FlightAware,
#  Companies House) + market data (Alpha Vantage)
# ==========================================================

_API_KEYS = {
    'track17ApiKey':      {'label': '17TRACK API key',       'group': 'tracking'},
    'marineTrafficKey':   {'label': 'MarineTraffic PS7 key', 'group': 'tracking'},
    'flightAwareKey':     {'label': 'FlightAware AeroAPI',   'group': 'tracking'},
    'companiesHouseKey':  {'label': 'Companies House UK',    'group': 'tracking'},
    'alphaVantageKey':    {'label': 'Alpha Vantage key',     'group': 'market'},
}


def _mask_key(s):
    s = str(s or '')
    if not s: return ''
    if len(s) <= 8: return '•' * len(s)
    return s[:4] + '…' + s[-4:]


@system_bp.route('/service-keys', methods=['GET'])
@login_required
def get_api_keys():
    """Redigovan pregled svih integracijskih ključeva — vraća samo maske."""
    if not _is_admin():
        return jsonify({"error": "UNAUTHORIZED"}), 403
    import sqlite3
    from utils import decrypt_data
    out = {}
    try:
        with db.connect_raw(DB_FILE) as conn:
            for key, meta in _API_KEYS.items():
                row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
                val = ''
                if row and row[0]:
                    try: val = str(decrypt_data(row[0]) or '')
                    except Exception: val = ''
                out[key] = {
                    'label': meta['label'],
                    'group': meta['group'],
                    'has_value': bool(val),
                    'masked': _mask_key(val),
                }
    except Exception as e:
        return jsonify({"error": "READ_FAILED", "message": str(e)}), 500
    return jsonify(out)


@system_bp.route('/service-keys', methods=['POST'])
@login_required
def set_api_keys():
    """Snima jedan ili više ključeva. Prazna string / maska (sadrži '…' ili samo '•')
    znači 'ne menjaj postojeći'. Sve se enkriptuje pre snimanja."""
    if not _is_admin():
        return jsonify({"error": "UNAUTHORIZED"}), 403
    import sqlite3
    from utils import decrypt_data
    payload = request.get_json(silent=True) or {}
    updated = []
    try:
        with db.connect_raw(DB_FILE) as conn:
            for key in _API_KEYS.keys():
                if key not in payload:
                    continue
                incoming = str(payload.get(key, '') or '').strip()
                if not incoming or '…' in incoming or set(incoming) <= {'•'}:
                    continue
                conn.execute(
                    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
                    (key, encrypt_data(incoming))
                )
                updated.append(key)
            conn.commit()
    except Exception as e:
        return jsonify({"error": "SAVE_FAILED", "message": str(e)}), 500

    if updated:
        log_audit('SECURITY', 'system',
                  f'API keys updated ({",".join(updated)}) by {session.get("username","?")}',
                  is_suspicious=False)
    return jsonify({"status": "success", "updated": updated})


# ── Backward-compatible alias: /api_keys → /service-keys ──
# Test suite and some integrations reference /api_keys; the canonical
# route is /service-keys but we keep both for compatibility.
@system_bp.route('/api_keys', methods=['GET'])
@login_required
def get_api_keys_alias():
    return get_api_keys()


@system_bp.route('/api_keys', methods=['POST'])
@login_required
def set_api_keys_alias():
    return set_api_keys()


# ==========================================================
#  FTS5 UNIFIED SEARCH — globalna pretraga za Cmd+K
# ==========================================================

@system_bp.route('/search', methods=['GET'])
@login_required
def unified_search():
    """FTS5 pretraga preko svih entiteta. Query params:
       - q: search string (obavezno)
       - limit: max broj rezultata (default 20, max 100)
       - types: comma-separated list ('partner,product,deal,offer,document')
    """
    q = (request.args.get('q') or '').strip()
    if not q:
        return jsonify({"results": [], "query": ""})
    try:
        limit = min(int(request.args.get('limit', 20)), 100)
    except Exception:
        limit = 20
    types = None
    if request.args.get('types'):
        types = [t.strip() for t in request.args['types'].split(',') if t.strip()]

    from search_index import search
    results = search(q, limit=limit, entity_types=types)
    return jsonify({"query": q, "count": len(results), "results": results})


@system_bp.route('/search/rebuild', methods=['POST'])
@login_required
def rebuild_search_index():
    """Ručno pokreće rebuild FTS5 indeksa. Admin-only."""
    if not _is_admin():
        return jsonify({"error": "UNAUTHORIZED"}), 403
    from search_index import rebuild_index
    counts = rebuild_index()
    log_audit('INFO', 'system',
              f'Search index rebuilt: {counts} by {session.get("username","?")}',
              is_suspicious=False)
    return jsonify({"status": "success", "indexed": counts})


@system_bp.route('/search/stats', methods=['GET'])
@login_required
def search_stats():
    from search_index import index_stats
    return jsonify(index_stats())


@system_bp.route('/otp_delivery/test', methods=['POST'])
@login_required
def test_otp_delivery():
    """Šalje test mejl na admin-adresu preko trenutno konfigurisanog providera —
    admin može odmah da vidi da li konfiguracija radi bez čekanja klijenta."""
    if not _is_admin():
        return jsonify({"error": "UNAUTHORIZED"}), 403
    payload = request.get_json(silent=True) or {}
    to_email = str(payload.get('to', '')).strip().lower()
    if not to_email or '@' not in to_email:
        return jsonify({"error": "INVALID_EMAIL"}), 400
    from mail_providers import send_transactional
    ok, info = send_transactional(
        to_email,
        '[Aspidus] OTP delivery test',
        '<html><body><h2>✓ OTP delivery works</h2><p>This test was sent via the currently configured provider. If you received it in the inbox (not spam), the setup is correct.</p></body></html>',
        'OTP delivery works — this test was sent via the currently configured provider.',
    )
    log_audit('INFO', 'system',
              f'OTP delivery test to {to_email}: {"OK" if ok else "FAIL"} ({str(info)[:200]})',
              is_suspicious=False)
    return jsonify({"ok": bool(ok), "info": str(info)[:300]})
