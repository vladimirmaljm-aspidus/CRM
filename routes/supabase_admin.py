"""Admin API endpointi za Supabase migraciju.

Kroz ove endpoint-e admin iz CRM UI-ja može:
  * Testirati Supabase konekciju
  * Videti trenutni status migracije (šta je gde)
  * Pokrenuti dry-run migracije
  * Pokrenuti pravu migraciju (background thread da ne blokira request)
  * Prebaciti feature flag (USE_SUPABASE_DB) live bez editovanja .env-a
  * Emergency rollback

Sve operacije su admin-only i loguju se u audit_log.
"""
from __future__ import annotations
import db

import json
import os
import sqlite3
import subprocess
import sys
import threading
import time
from pathlib import Path

from flask import Blueprint, request, jsonify, session, render_template

from utils import login_required, log_audit, get_client_ip

supabase_admin_bp = Blueprint('supabase_admin', __name__)


@supabase_admin_bp.route('/admin/supabase', methods=['GET'])
@login_required
def supabase_admin_page():
    """Admin panel — dugmad za migraciju, status displej."""
    if session.get('role') != 'admin':
        return "Admin only.", 403
    return render_template('supabase_admin.html')


# ==========================================================
#  ERROR LOG — admin uvid u sve 5xx greške i security incidents
# ==========================================================

_ERROR_BUFFER = []       # in-memory ring buffer, poslednjih 500 grešaka
_ERROR_BUFFER_MAX = 500
_error_lock = threading.Lock()


def record_error(context: str, exc: Exception | str, request_id: str | None = None, meta: dict | None = None):
    """Poziva se iz svih backend-a kad neka operacija baci grešku koju
    treba da admin vidi. Čuva se u in-memory buffer-u + audit_log."""
    import traceback
    tb = ""
    msg = str(exc)
    if isinstance(exc, Exception):
        tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))[-2000:]

    entry = {
        "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        "context": context,
        "message": msg[:500],
        "traceback": tb,
        "request_id": request_id,
        "meta": meta or {},
    }
    with _error_lock:
        _ERROR_BUFFER.append(entry)
        if len(_ERROR_BUFFER) > _ERROR_BUFFER_MAX:
            _ERROR_BUFFER.pop(0)

    try:
        log_audit('ERROR', context, f'{msg[:400]} (req={request_id or "-"})',
                  is_suspicious=False)
    except Exception:
        pass


@supabase_admin_bp.route('/admin/errors', methods=['GET'])
@login_required
def admin_errors_page():
    """HTML stranica za admin — pregled poslednjih grešaka."""
    if session.get('role') != 'admin':
        return "Admin only.", 403
    return render_template('admin_errors.html')


@supabase_admin_bp.route('/api/admin/errors', methods=['GET'])
@login_required
def admin_errors_api():
    """JSON — vraća poslednjih N zapisa iz error buffer-a."""
    if session.get('role') != 'admin':
        return jsonify({"error": "Admin only."}), 403
    limit = int(request.args.get('limit', 100))
    with _error_lock:
        entries = list(reversed(_ERROR_BUFFER[-limit:]))
    return jsonify({"entries": entries, "total": len(_ERROR_BUFFER)})


@supabase_admin_bp.route('/api/admin/errors/clear', methods=['POST'])
@login_required
def admin_errors_clear():
    if session.get('role') != 'admin':
        return jsonify({"error": "Admin only."}), 403
    with _error_lock:
        n = len(_ERROR_BUFFER)
        _ERROR_BUFFER.clear()
    log_audit('EDIT', 'system', f'Admin cleared error buffer ({n} entries)', is_suspicious=False)
    return jsonify({"status": "ok", "cleared": n})


# ==========================================================
#  SESSION INFO — za Profile & Preferences panel
# ==========================================================

@supabase_admin_bp.route('/api/session/info', methods=['GET'])
@login_required
def session_info_api():
    """Vraca info o trenutnoj sesiji za Profile > Session tab."""
    from utils import FirewallCache
    ip = get_client_ip() or ''
    login_ts = session.get('login_time')
    last_ts = session.get('last_active', login_ts)
    ttl = int(FirewallCache.settings.get('crm_inactivity', 1200))
    return jsonify({
        "username": session.get('username'),
        "role": session.get('role'),
        "user_id": session.get('user_id'),
        "login_time": time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime(login_ts)) if login_ts else None,
        "last_active": time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime(last_ts)) if last_ts else None,
        "ttl_seconds": ttl,
        "ip": ip,
    })



@supabase_admin_bp.route('/api/users/me', methods=['GET'])
@login_required
def users_me_get():
    """Vrati profil trenutnog user-a — full_name, email, phone, notif_prefs.
    Koristi ga preferences.js pri otvaranju modala da popuni fields."""
    import sqlite3, json as _json
    from config import DB_FILE
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "no_session"}), 401
    conn = db.connect_raw(DB_FILE)
    try:
        c = conn.cursor()
        c.execute("SELECT username, role, full_name, email, phone, notif_prefs "
                  "FROM users WHERE id=?", (uid,))
        row = c.fetchone()
    finally:
        conn.close()
    if not row:
        return jsonify({"error": "user_not_found"}), 404
    try:
        prefs = _json.loads(row[5]) if row[5] else {}
    except (ValueError, TypeError):
        prefs = {}
    return jsonify({
        "username":  row[0],
        "role":      row[1],
        "full_name": row[2] or '',
        "email":     row[3] or '',
        "phone":     row[4] or '',
        "notif_prefs": prefs,
    })


@supabase_admin_bp.route('/api/users/me', methods=['PATCH'])
@login_required
def users_me_patch():
    """Update trenutnog user-a profil. Prihvata:
      - full_name (ili fullName — kompatibilno sa starim frontend-om)
      - email
      - phone
      - notif_prefs (dict)
    Sve piše u prave kolone dodate v22 migracijom.
    """
    import sqlite3, json as _json
    from config import DB_FILE
    body = request.get_json(silent=True) or {}
    updates = {}
    # Prihvata i camelCase i snake_case (frontend-agnostic)
    if 'full_name' in body or 'fullName' in body:
        updates['full_name'] = str(body.get('full_name') or body.get('fullName') or '')[:200]
    if 'email' in body:
        em = str(body.get('email') or '').strip().lower()
        if em and '@' not in em:
            return jsonify({"error": "invalid_email"}), 400
        updates['email'] = em[:200]
    if 'phone' in body:
        updates['phone'] = str(body.get('phone') or '')[:60]
    if 'notif_prefs' in body:
        if not isinstance(body['notif_prefs'], dict):
            return jsonify({"error": "notif_prefs_must_be_object"}), 400
        updates['notif_prefs'] = _json.dumps(body['notif_prefs'])[:4000]

    if not updates:
        return jsonify({"error": "No fields to update."}), 400

    uid = session.get('user_id')
    conn = db.connect_raw(DB_FILE)
    try:
        c = conn.cursor()
        # Provera da user postoji
        r = c.execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone()
        if not r:
            return jsonify({"error": "user_not_found"}), 404
        sets = ", ".join([f"{k}=?" for k in updates])
        params = list(updates.values()) + [uid]
        c.execute(f"UPDATE users SET {sets} WHERE id=?", params)
        conn.commit()
    finally:
        conn.close()
    # V23.1 #1 — DUAL WRITE u Supabase: Render brise lokalne .db, korisnicke
    # preference MORAJU biti u Supabase. Best-effort — ako Supabase pukne, i
    # dalje smo sacuvali lokalno (WAL) pa nema gubitka. Kada je USE_SUPABASE_DB
    # aktivan, ovo je jedini put pisanja.
    try:
        from data_layer import upsert as _db_upsert
        supabase_row = {'id': uid}
        supabase_row.update(updates)
        if 'notif_prefs' in supabase_row:
            # data_layer JSONB kolonu ocekuje kao dict, ne string
            try:
                supabase_row['notif_prefs'] = _json.loads(supabase_row['notif_prefs'])
            except Exception:
                pass
        _db_upsert('users', supabase_row, on_conflict='id')
    except Exception as _sync_err:
        # Log-only — ne blokiramo user flow
        import logging as _logging
        _logging.getLogger(__name__).info(f'Supabase user prefs mirror skipped: {_sync_err}')

    log_audit('EDIT', 'users',
              f'User {session.get("username")} updated own profile: {list(updates.keys())}',
              is_suspicious=False)
    return jsonify({"status": "ok", "updated": list(updates.keys())})


@supabase_admin_bp.route('/admin/health', methods=['GET'])
@login_required
def admin_health_page():
    if session.get('role') != 'admin':
        return "Admin only.", 403
    return render_template('admin_health.html')


@supabase_admin_bp.route('/api/admin/health', methods=['GET'])
@login_required
def admin_health_api():
    if session.get('role') != 'admin':
        return jsonify({"error": "Admin only."}), 403
    try:
        from utils_reliability import full_health
        return jsonify(full_health())
    except Exception as e:
        return jsonify({"ok": False, "error": f"{type(e).__name__}: {e}"}), 500


@supabase_admin_bp.route('/api/health', methods=['GET'])
def public_health():
    """Public heartbeat — bez auth, minimalan info (za uptime monitor)."""
    try:
        import os
        from config import DB_FILE
        return jsonify({
            "ok": os.path.exists(DB_FILE),
            "service": "aspidus-crm",
            "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        })
    except Exception:
        return jsonify({"ok": False}), 503


@supabase_admin_bp.route('/api/users/change-password', methods=['POST'])
@login_required
def users_change_password():
    """CRM user menja svoju lozinku. Prava implementacija je u
    /api/auth/change_password (routes/auth.py) — ovaj endpoint je thin
    adapter za preferences.js koji koristi { current, next } payload umesto
    { new_password }."""
    import sqlite3
    from config import DB_FILE
    from werkzeug.security import generate_password_hash, check_password_hash
    body = request.get_json(silent=True) or {}
    current = str(body.get('current') or '')
    nxt = str(body.get('next') or '')
    if not current:
        return jsonify({"error": "Current password required."}), 400
    if len(nxt) < 8:
        return jsonify({"error": "New password too short (min 8 chars)."}), 400
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "no_session"}), 401
    try:
        conn = db.connect_raw(DB_FILE)
        c = conn.cursor()
        c.execute("SELECT password, token_version FROM users WHERE id=?", (uid,))
        row = c.fetchone()
        if not row:
            conn.close()
            return jsonify({"error": "user_not_found"}), 404
        if not check_password_hash(row[0], current):
            conn.close()
            log_audit('SECURITY', 'users',
                      f'Failed password change (wrong current) by {session.get("username")}',
                      is_suspicious=True)
            return jsonify({"error": "Current password is incorrect."}), 401
        # Match sto auth.py radi: nova lozinka, bump token_version, timestamp
        import time as _time
        now_iso = _time.strftime('%Y-%m-%dT%H:%M:%SZ', _time.gmtime())
        new_hash = generate_password_hash(nxt, method='scrypt:32768:8:1')
        new_ver = int(row[1] or 1) + 1
        c.execute("UPDATE users SET password=?, last_password_change_at=?, token_version=? WHERE id=?",
                  (new_hash, now_iso, new_ver, uid))
        conn.commit()
        conn.close()
        # Osvezi trenutnu sesiju sa novim token_version da user ne bude odjavljen
        session['token_version'] = new_ver
        log_audit('SECURITY', 'users',
                  f'User {session.get("username")} changed own password (token_version→{new_ver}).',
                  is_suspicious=False)
        return jsonify({"status": "success", "message": "Password updated."})
    except Exception as e:
        record_error('/api/users/change-password', e)
        return jsonify({"error": "server_error", "message": "Admin operation error"[:200]}), 500

# In-memory migracija stanje — vidljivo kroz /status endpoint
_migration_state = {
    "running": False,
    "started_at": None,
    "finished_at": None,
    "log": [],
    "tables": {},
    "error": None,
}
_migration_lock = threading.Lock()


def _admin_only():
    """Vraća None ako je admin, ili (response, code) tuple ako nije."""
    if session.get('role') != 'admin':
        log_audit('SECURITY', 'system',
                  f'Non-admin tried supabase-admin endpoint from '
                  f'{get_client_ip()}',
                  is_suspicious=True)
        return jsonify({"error": "Admin only."}), 403
    return None


@supabase_admin_bp.route('/api/supabase/status', methods=['GET'])
@login_required
def supabase_status():
    """Vraća pun status Supabase integracije — flag-ovi, konekcija, brojevi
    redova u SQLite vs Supabase, migracija progress."""
    r = _admin_only()
    if r: return r

    from config import DB_FILE, PORTAL_DB_FILE, AUDIT_DB_FILE

    # Env flag-ovi
    flags = {
        "USE_SUPABASE_AUTH": os.environ.get("USE_SUPABASE_AUTH", "false"),
        "USE_SUPABASE_DB": os.environ.get("USE_SUPABASE_DB", "false"),
        "USE_SUPABASE_STORAGE": os.environ.get("USE_SUPABASE_STORAGE", "false"),
        "DUAL_WRITE_MODE": os.environ.get("DUAL_WRITE_MODE", "false"),
        "DB_BACKEND": os.environ.get("DB_BACKEND", "rest"),
    }

    # SQLite brojevi
    sqlite_counts = {}
    for label, path in (("crm", DB_FILE), ("portal", PORTAL_DB_FILE), ("audit", AUDIT_DB_FILE)):
        if os.path.exists(path):
            try:
                conn = db.connect_raw(path, timeout=5.0)
                for (tname,) in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                ).fetchall():
                    try:
                        cnt = conn.execute(f'SELECT COUNT(*) FROM "{tname}"').fetchone()[0]
                        sqlite_counts[f"{label}.{tname}"] = int(cnt)
                    except Exception:
                        pass
                conn.close()
            except Exception as e:
                sqlite_counts[f"{label}.error"] = str(e)

    # Supabase brojevi (samo ako je kljuc podesen)
    supabase_counts = {}
    supabase_ok = False
    supabase_error = None
    try:
        from data_layer import get_backend, count as db_count
        backend = get_backend()
        supabase_ok = True
        for t in ("partners", "products", "deals", "kyc_submissions",
                  "portal_products", "audit_logs"):
            try:
                supabase_counts[t] = db_count(t)
            except Exception as e:
                supabase_counts[t] = f"error: {e.__class__.__name__}"
    except Exception as e:
        supabase_error = f"{e.__class__.__name__}: {e}"

    # Auth status
    auth_ok = False
    auth_users = None
    try:
        from auth_supabase import admin_client, use_supabase_auth
        if use_supabase_auth():
            client = admin_client()
            resp = client.auth.admin.list_users(page=1, per_page=1)
            auth_ok = True
            auth_users = "reachable"
    except Exception as e:
        auth_users = f"error: {e.__class__.__name__}"

    return jsonify({
        "flags": flags,
        "supabase": {
            "connection_ok": supabase_ok,
            "backend": os.environ.get("DB_BACKEND", "rest") if supabase_ok else None,
            "error": supabase_error,
            "counts": supabase_counts,
            "auth_ok": auth_ok,
            "auth_users": auth_users,
        },
        "sqlite_counts": sqlite_counts,
        "migration": dict(_migration_state),
    })


@supabase_admin_bp.route('/api/supabase/dry-run', methods=['POST'])
@login_required
def supabase_dry_run():
    """Pokreće dry-run migracije — samo broji, ne piše. Sinhrono jer je brz."""
    r = _admin_only()
    if r: return r

    import io
    import contextlib

    buf = io.StringIO()
    try:
        script = Path(__file__).resolve().parent.parent / "scripts" / "migrate_data_to_supabase.py"
        result = subprocess.run(
            [sys.executable, str(script), "--dry-run"],
            capture_output=True, text=True, timeout=120,
        )
        output = (result.stdout or "") + (result.stderr or "")
    except subprocess.TimeoutExpired:
        return jsonify({"error": "Dry-run timed out (>120s)."}), 500
    except Exception as e:
        return jsonify({"error": f"{e.__class__.__name__}: {e}"}), 500

    log_audit('EDIT', 'system', 'Supabase migration dry-run executed',
              is_suspicious=False)
    return jsonify({"status": "ok", "output": output[-8000:]})


def _run_migration_thread(tables=None):
    """Pozadinski thread — poziva migration script i puni _migration_state."""
    global _migration_state
    with _migration_lock:
        _migration_state.update({
            "running": True,
            "started_at": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            "finished_at": None,
            "log": [],
            "tables": {},
            "error": None,
        })

    script = Path(__file__).resolve().parent.parent / "scripts" / "migrate_data_to_supabase.py"
    cmd = [sys.executable, str(script), "--confirm"]
    if tables:
        cmd += ["--tables", ",".join(tables)]

    try:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
        )
        for line in iter(proc.stdout.readline, ''):
            with _migration_lock:
                _migration_state["log"].append(line.rstrip("\n"))
                # keep last 500 lines to bound memory
                if len(_migration_state["log"]) > 500:
                    _migration_state["log"] = _migration_state["log"][-500:]
        proc.wait()
        with _migration_lock:
            _migration_state["running"] = False
            _migration_state["finished_at"] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            if proc.returncode != 0:
                _migration_state["error"] = f"Exit code {proc.returncode}"
    except Exception as e:
        with _migration_lock:
            _migration_state["running"] = False
            _migration_state["finished_at"] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            _migration_state["error"] = f"{e.__class__.__name__}: {e}"

    # Ovo trci u thread-u van request contexta; log_audit je vec sa
    # try/except iz thread-safe patcha (utils.py), ali dodatni guard
    # ovde stiti od bilo koje buduce promene u log_audit.
    try:
        log_audit('EDIT', 'system',
                  f'Supabase migration finished (error={_migration_state.get("error")})',
                  is_suspicious=False)
    except Exception as _log_err:
        import logging
        logging.getLogger(__name__).warning(
            'log_audit from migration thread failed: %s', _log_err)


@supabase_admin_bp.route('/api/supabase/migrate', methods=['POST'])
@login_required
def supabase_migrate():
    """Pokreće pravu migraciju u background thread-u. Frontend polluje /status."""
    r = _admin_only()
    if r: return r

    if _migration_state["running"]:
        return jsonify({"error": "Migration already running."}), 409

    body = request.get_json(silent=True) or {}
    tables = body.get("tables")

    t = threading.Thread(target=_run_migration_thread, kwargs={"tables": tables}, daemon=True)
    t.start()
    log_audit('EDIT', 'system',
              f'Supabase migration started (tables={tables or "all"})',
              is_suspicious=False)
    return jsonify({"status": "started", "message": "Migration running in background."})


@supabase_admin_bp.route('/api/supabase/set-flag', methods=['POST'])
@login_required
def supabase_set_flag():
    """Sets a feature flag u trenutnom procesu (RAM). Za trajno menjanje treba
    ručno editovati .env. Ovo je za brzo prebacivanje (rollback).

    Body: {"flag": "USE_SUPABASE_DB", "value": "true|false"}"""
    r = _admin_only()
    if r: return r

    body = request.get_json(silent=True) or {}
    flag = str(body.get("flag", "")).strip().upper()
    value = str(body.get("value", "")).strip().lower()

    allowed = {"USE_SUPABASE_AUTH", "USE_SUPABASE_DB",
               "USE_SUPABASE_STORAGE", "DUAL_WRITE_MODE",
               "DB_BACKEND", "BACKUP_OFFSITE"}
    if flag not in allowed:
        return jsonify({"error": f"Flag '{flag}' not allowed."}), 400
    # DB_BACKEND uzima 'rest' ili 'postgres', ostali su bool
    if flag == "DB_BACKEND":
        if value not in {"rest", "postgres", "pg"}:
            return jsonify({"error": "DB_BACKEND must be 'rest' or 'postgres'."}), 400
    else:
        if value not in {"true", "false", "1", "0", "yes", "no"}:
            return jsonify({"error": "Value must be true/false."}), 400

    old = os.environ.get(flag, "false")
    os.environ[flag] = value
    log_audit('EDIT', 'system',
              f'Supabase flag {flag}: {old} → {value} (in-process only)',
              is_suspicious=True)  # bezbednosno relevantno

    # Data layer keš — bustuj da novi backend uzme
    try:
        from data_layer import reset as _reset_layer
        _reset_layer()
    except Exception:
        pass

    return jsonify({
        "status": "ok",
        "flag": flag,
        "old": old,
        "new": value,
        "note": "In-process only. For permanent change, edit .env and Reload.",
    })


# ==========================================================
#  FAZA 2: SUPABASE STORAGE — bucket init + status
# ==========================================================

@supabase_admin_bp.route('/api/supabase/storage/init', methods=['POST'])
@login_required
def supabase_storage_init():
    """Idempotentno kreira sve poznate bucket-ove (partner-docs, offer-pdfs,
    portal-uploads) kao PRIVATE. Sme se pozvati vise puta bez efekta."""
    r = _admin_only()
    if r: return r
    try:
        from utils_storage import bootstrap_storage, use_supabase_storage
        if not use_supabase_storage():
            return jsonify({
                "ok": False,
                "error": "USE_SUPABASE_STORAGE=false",
                "hint": "Prvo ukljuci flag USE_SUPABASE_STORAGE na Supabase admin panelu."
            }), 400
        result = bootstrap_storage()
        log_audit('CREATE', 'system',
                  f'Storage bootstrap: created={result.get("created")} skipped={result.get("skipped")}',
                  is_suspicious=False)
        return jsonify(result)
    except Exception as e:
        return jsonify({"ok": False, "error": f"{type(e).__name__}: {str(e)[:200]}"}), 500


@supabase_admin_bp.route('/api/supabase/storage/status', methods=['GET'])
@login_required
def supabase_storage_status():
    """Vraca listu bucket-ova sa velicinom (broj fajlova + ukupna velicina).
    Koristi se u admin panelu za pregled sta je vec u Supabase-u."""
    r = _admin_only()
    if r: return r
    try:
        from utils_storage import use_supabase_storage, _client, _KNOWN_BUCKETS
        if not use_supabase_storage():
            return jsonify({"ok": False, "enabled": False, "reason": "USE_SUPABASE_STORAGE=false"})
        c = _client()
        buckets_info = []
        for name in _KNOWN_BUCKETS:
            info = {"name": name, "exists": False, "file_count": 0}
            try:
                files = c.storage.from_(name).list("", {"limit": 1000, "sortBy": {"column": "created_at", "order": "desc"}})
                info["exists"] = True
                info["file_count"] = len(files) if files else 0
                if files:
                    info["recent"] = [
                        {"name": f.get("name"), "size": (f.get("metadata") or {}).get("size", 0),
                         "created_at": f.get("created_at")}
                        for f in files[:3]
                    ]
            except Exception as e:
                info["error"] = str(e)[:120]
            buckets_info.append(info)
        return jsonify({"ok": True, "enabled": True, "buckets": buckets_info})
    except Exception as e:
        return jsonify({"ok": False, "error": f"{type(e).__name__}: {str(e)[:200]}"}), 500


# ==========================================================
#  EMAIL QUEUE ADMIN UI
# ==========================================================

@supabase_admin_bp.route('/admin/mail-queue', methods=['GET'])
@login_required
def admin_mail_queue_page():
    if session.get('role') != 'admin':
        return "Admin only.", 403
    return render_template('admin_mail_queue.html')


@supabase_admin_bp.route('/api/admin/mail-queue', methods=['GET'])
@login_required
def admin_mail_queue_list():
    if session.get('role') != 'admin':
        return jsonify({"error": "Admin only."}), 403
    import sqlite3
    from config import DB_FILE
    status_filter = (request.args.get('status') or '').strip().lower()
    try:
        limit = min(int(request.args.get('limit') or 200), 500)
    except ValueError:
        limit = 200
    q = ("SELECT id, recipient, subject, status, attempts, last_error, "
         "queued_at, next_retry_at, sent_at, sending_started_at "
         "FROM email_queue")
    params = []
    if status_filter in ('pending', 'sending', 'sent', 'failed', 'dead'):
        q += " WHERE status=?"
        params.append(status_filter)
    q += " ORDER BY queued_at DESC LIMIT ?"
    params.append(limit)
    try:
        with db.connect_raw(DB_FILE) as conn:
            rows = conn.execute(q, tuple(params)).fetchall()
            # Ukupni brojevi po statusu (za summary)
            summary = {}
            for st in ('pending', 'sending', 'sent', 'failed', 'dead'):
                cnt = conn.execute(
                    "SELECT COUNT(*) FROM email_queue WHERE status=?",
                    (st,)
                ).fetchone()[0]
                summary[st] = cnt
    except db.OperationalError as e:
        return jsonify({"ok": False, "error": str(e)[:200]}), 500
    return jsonify({
        "ok": True,
        "summary": summary,
        "total_shown": len(rows),
        "emails": [{
            "id": r[0], "recipient": r[1], "subject": r[2] or '',
            "status": r[3], "attempts": r[4] or 0,
            "last_error": (r[5] or '')[:400],
            "queued_at": r[6], "next_retry_at": r[7],
            "sent_at": r[8], "sending_started_at": r[9],
        } for r in rows]
    })


@supabase_admin_bp.route('/api/admin/mail-queue/retry', methods=['POST'])
@login_required
def admin_mail_queue_retry():
    """Resetuje status='pending' + next_retry_at=NULL za date ID-eve (ili
    sve failed/dead ako je body prazan). Sledeci drain ce ih pokupiti."""
    if session.get('role') != 'admin':
        return jsonify({"error": "Admin only."}), 403
    import sqlite3
    from config import DB_FILE
    body = request.get_json(silent=True) or {}
    ids = body.get('ids') or []
    retry_all_failed = bool(body.get('retry_all_failed'))
    try:
        with db.connect_raw(DB_FILE) as conn:
            if ids:
                placeholders = ','.join('?' * len(ids))
                cnt = conn.execute(
                    f"UPDATE email_queue SET status='pending', next_retry_at=NULL, "
                    f"sending_started_at=NULL, worker_id=NULL WHERE id IN ({placeholders})",
                    tuple(ids)
                ).rowcount
            elif retry_all_failed:
                cnt = conn.execute(
                    "UPDATE email_queue SET status='pending', next_retry_at=NULL, "
                    "sending_started_at=NULL, worker_id=NULL "
                    "WHERE status IN ('failed', 'dead')"
                ).rowcount
            else:
                return jsonify({"error": "Nothing to retry — pass ids or retry_all_failed."}), 400
            conn.commit()
    except db.OperationalError as e:
        return jsonify({"ok": False, "error": str(e)[:200]}), 500

    log_audit('EDIT', 'system', f'Mail queue: retried {cnt} email(s) by {session.get("username")}',
              is_suspicious=False)
    return jsonify({"ok": True, "retried": cnt})


@supabase_admin_bp.route('/api/admin/mail-queue/delete', methods=['POST'])
@login_required
def admin_mail_queue_delete():
    """Brise ID-eve iz email_queue tabele. Pazi — nema vracanja."""
    if session.get('role') != 'admin':
        return jsonify({"error": "Admin only."}), 403
    import sqlite3
    from config import DB_FILE
    body = request.get_json(silent=True) or {}
    ids = body.get('ids') or []
    purge_status = str(body.get('purge_status') or '').strip().lower()
    try:
        with db.connect_raw(DB_FILE) as conn:
            if ids:
                placeholders = ','.join('?' * len(ids))
                cnt = conn.execute(
                    f"DELETE FROM email_queue WHERE id IN ({placeholders})",
                    tuple(ids)
                ).rowcount
            elif purge_status in ('sent', 'failed', 'dead'):
                cnt = conn.execute(
                    "DELETE FROM email_queue WHERE status=?",
                    (purge_status,)
                ).rowcount
            else:
                return jsonify({"error": "Nothing to delete — pass ids or purge_status."}), 400
            conn.commit()
    except db.OperationalError as e:
        return jsonify({"ok": False, "error": str(e)[:200]}), 500

    log_audit('DELETE', 'system',
              f'Mail queue: deleted {cnt} email(s) by {session.get("username")} '
              f'(ids={len(ids)}, purge_status={purge_status or "-"})',
              is_suspicious=True)  # brisanje = suspicious
    return jsonify({"ok": True, "deleted": cnt})


@supabase_admin_bp.route('/api/admin/mail-queue/drain', methods=['POST'])
@login_required
def admin_mail_queue_drain():
    """Rucno pokreni obradu queue-a odmah (max 50 email-a). Vraca stats."""
    if session.get('role') != 'admin':
        return jsonify({"error": "Admin only."}), 403
    try:
        from utils_email import process_email_queue
        stats = process_email_queue(max_batch=50)
        return jsonify({"ok": True, "stats": stats or {}})
    except Exception as e:
        return jsonify({"ok": False, "error": f"{type(e).__name__}: {str(e)[:200]}"}), 500


# ==========================================================
#  RECONCILE + SYNC-BACK (Operations Center)
# ==========================================================

@supabase_admin_bp.route('/api/supabase/reconcile', methods=['POST'])
@login_required
def supabase_reconcile():
    r = _admin_only()
    if r: return r
    try:
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        try:
            from scripts.reconcile_sqlite_supabase import _get_supabase_client, _count_sqlite, _count_supabase, _open_db
            from scripts.migrate_data_to_supabase import MIGRATION_PLAN
        except ImportError as e:
            return jsonify({'ok': False, 'error': f'reconcile module import failed: {e}'}), 500
        client = _get_supabase_client()
        conns = {src: _open_db(src) for src in ('crm', 'portal', 'audit')}
        results = []
        drift = False
        for src, source_table, target_table, _ in MIGRATION_PLAN:
            sq = _count_sqlite(conns.get(src), source_table)
            sp_raw = _count_supabase(client, target_table)
            sp = None; sp_err = None
            if isinstance(sp_raw, dict) and '__err__' in sp_raw:
                sp_err = sp_raw['__err__']
            else:
                sp = sp_raw
            status = 'ok'
            if sp_err: status = 'sp_error'
            elif sq is None: status = 'sqlite_missing'
            elif sq != sp: status = 'drift'; drift = True
            results.append({
                'source': src, 'source_table': source_table, 'target_table': target_table,
                'sqlite_count': sq, 'supabase_count': sp,
                'supabase_error': sp_err, 'status': status,
            })
        for c in conns.values():
            if c is not None: c.close()
        return jsonify({'ok': True, 'drift': drift, 'results': results})
    except Exception as e:
        return jsonify({'ok': False, 'error': f'{type(e).__name__}: {str(e)[:200]}'}), 500


@supabase_admin_bp.route('/api/supabase/sync-back', methods=['POST'])
@login_required
def supabase_sync_back():
    r = _admin_only()
    if r: return r
    body = request.get_json(silent=True) or {}
    confirm = bool(body.get('confirm'))
    try:
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        try:
            from scripts.reconcile_sqlite_supabase import _get_supabase_client, _sample_ids_sqlite, _push_to_sqlite, _open_db
            from scripts.migrate_data_to_supabase import MIGRATION_PLAN
        except ImportError as e:
            return jsonify({'ok': False, 'error': f'sync-back module import failed: {e}'}), 500
        client = _get_supabase_client()
        conns = {src: _open_db(src) for src in ('crm', 'portal', 'audit')}
        results = []
        total_pushed = 0
        total_errors = 0
        for src, source_table, target_table, _ in MIGRATION_PLAN:
            sq_conn = conns.get(src)
            sq_ids = set(map(str, _sample_ids_sqlite(sq_conn, source_table, 10000)))
            sp_ids_all = []
            try:
                offset = 0
                while offset < 50000:
                    r2 = client.table(target_table).select('id').range(offset, offset + 999).execute()
                    page = [row.get('id') for row in (r2.data or [])]
                    if not page: break
                    sp_ids_all.extend(page)
                    if len(page) < 1000: break
                    offset += 1000
            except Exception as e:
                results.append({'source_table': source_table, 'n_pushed': 0, 'errors': [str(e)[:120]]})
                continue
            sp_ids = set(map(str, sp_ids_all))
            missing = list(sp_ids - sq_ids)
            if not missing:
                results.append({'source_table': source_table, 'n_pushed': 0, 'errors': []})
                continue
            n_pushed, errors = _push_to_sqlite(client, src, source_table, target_table, missing, dry_run=not confirm)
            results.append({'source_table': source_table, 'n_pushed': n_pushed, 'errors': errors})
            total_pushed += n_pushed
            total_errors += len(errors)
        for c in conns.values():
            if c is not None: c.close()
        log_audit('EDIT' if confirm else 'READ', 'system',
                  f'Sync-back {"COMMIT" if confirm else "DRY-RUN"}: {total_pushed} rows, {total_errors} errors',
                  is_suspicious=confirm)
        return jsonify({
            'ok': True, 'confirmed': confirm,
            'total_pushed': total_pushed, 'total_errors': total_errors,
            'results': results,
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': f'{type(e).__name__}: {str(e)[:200]}'}), 500


# ==========================================================
#  BATCH D — NEW: KILL-ALL-SESSIONS, MANUAL BACKUP, SIGNED URL
# ==========================================================

@supabase_admin_bp.route('/api/users/kill-all-sessions', methods=['POST'])
@login_required
def users_kill_all_sessions():
    """Bump token_version za trenutnog user-a — sve postojece sesije se
    trenutno prekidaju osim ove koja je pozvala. Koristi se kad user
    misli da je nalog kompromitovan (bez potrebe za password change)."""
    import sqlite3
    from config import DB_FILE
    uid = session.get('user_id')
    if not uid:
        return jsonify({"error": "no_session"}), 401
    try:
        with db.connect_raw(DB_FILE) as conn:
            row = conn.execute("SELECT token_version FROM users WHERE id=?", (uid,)).fetchone()
            if not row:
                return jsonify({"error": "user_not_found"}), 404
            new_ver = int(row[0] or 1) + 1
            conn.execute("UPDATE users SET token_version=? WHERE id=?", (new_ver, uid))
            conn.commit()
        # Osvezi trenutnu sesiju da NE ostanem odjavljen
        session['token_version'] = new_ver
        log_audit('SECURITY', 'users',
                  f'User {session.get("username")} killed all other sessions (token_version→{new_ver}).',
                  is_suspicious=True)
        return jsonify({"status": "ok", "new_token_version": new_ver,
                        "message": "All other sessions have been signed out."})
    except Exception as e:
        record_error('/api/users/kill-all-sessions', e)
        return jsonify({"error": "server_error", "message": "Admin operation error"[:200]}), 500


@supabase_admin_bp.route('/api/admin/backup/trigger', methods=['POST'])
@login_required
def admin_backup_trigger():
    """Rucno pokreni Fernet backup snapshot odmah. Ne ceka noc.
    Vraca listu kreiranih fajlova + off-site status."""
    if session.get('role') != 'admin':
        return jsonify({"error": "Admin only."}), 403
    try:
        import sqlite3, datetime as _dt, os as _os
        from config import DB_FILE, PORTAL_DB_FILE, AUDIT_DB_FILE, DATA_DIR
        from utils import cipher_suite
        backups_dir = _os.path.join(DATA_DIR, 'backups')
        _os.makedirs(backups_dir, exist_ok=True)
        ts = _dt.datetime.now(_dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        created = []
        errors = []
        offsite = []
        for db_path in (DB_FILE, PORTAL_DB_FILE, AUDIT_DB_FILE):
            if not _os.path.exists(db_path):
                continue
            tmp_copy = _os.path.join(backups_dir, f'.tmp_manual_{_os.path.basename(db_path)}')
            try:
                src_conn = db.connect_raw(db_path, timeout=30.0)
                dst_conn = db.connect_raw(tmp_copy, timeout=30.0)
                with dst_conn:
                    src_conn.backup(dst_conn)
                dst_conn.close(); src_conn.close()
                with open(tmp_copy, 'rb') as f:
                    raw = f.read()
                enc = cipher_suite.encrypt(raw)
                out = _os.path.join(backups_dir, f'{_os.path.basename(db_path)}.{ts}.MANUAL.fernet')
                with open(out, 'wb') as f:
                    f.write(enc)
                _os.remove(tmp_copy)
                try: _os.chmod(out, 0o600)
                except Exception: pass
                created.append({'file': _os.path.basename(out), 'size_bytes': len(enc)})
                # Off-site mirror ako je enabled
                if _os.environ.get('BACKUP_OFFSITE', '').strip().lower() in ('1','true','yes','on'):
                    try:
                        import utils_storage as _st
                        if _st.use_supabase_storage():
                            r = _st.upload_bytes('backups', f'manual/{_os.path.basename(out)}',
                                                 enc, content_type='application/octet-stream')
                            offsite.append({'file': _os.path.basename(out), 'ok': bool(r.get('ok'))})
                    except Exception as ee:
                        offsite.append({'file': _os.path.basename(out), 'error': str(ee)[:120]})
            except Exception as e:
                errors.append({'db': _os.path.basename(db_path), 'error': str(e)[:120]})
                try:
                    if _os.path.exists(tmp_copy): _os.remove(tmp_copy)
                except Exception: pass
        log_audit('CREATE', 'system',
                  f'Manual backup triggered by {session.get("username")}: {len(created)} files, {len(errors)} errors',
                  is_suspicious=False)
        return jsonify({
            'ok': len(errors) == 0,
            'created': created,
            'errors': errors,
            'offsite': offsite,
            'timestamp': ts,
        })
    except Exception as e:
        return jsonify({'ok': False, 'error': f'{type(e).__name__}: {str(e)[:200]}'}), 500


@supabase_admin_bp.route('/api/admin/backup/list', methods=['GET'])
@login_required
def admin_backup_list():
    """Lista svih .fernet backup fajlova sa metadata."""
    if session.get('role') != 'admin':
        return jsonify({"error": "Admin only."}), 403
    import os as _os
    from config import DATA_DIR
    backups_dir = _os.path.join(DATA_DIR, 'backups')
    if not _os.path.isdir(backups_dir):
        return jsonify({'files': [], 'total': 0})
    files = []
    for name in _os.listdir(backups_dir):
        if not name.endswith('.fernet'): continue
        p = _os.path.join(backups_dir, name)
        try:
            st = _os.stat(p)
            files.append({
                'name': name, 'size_bytes': st.st_size,
                'size_mb': round(st.st_size / (1024*1024), 2),
                'mtime': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(st.st_mtime)),
                'is_manual': '.MANUAL.' in name,
            })
        except Exception:
            pass
    files.sort(key=lambda x: x['mtime'], reverse=True)
    return jsonify({'files': files, 'total': len(files)})


@supabase_admin_bp.route('/api/admin/backup/restore', methods=['POST'])
@login_required
def admin_backup_restore():
    """Vrati SQLite bazu iz Fernet backup fajla.
    Body: {"backup_file": "aspidus_crm.db.20261228T080000Z.fernet",
           "target": "crm" | "portal" | "audit",
           "confirm": true}
    Ako confirm=false -> samo vrati info, ne dira nista.
    Ovo je DESTRUKTIVNA operacija — pravi backup postojeceg DB-a pre restore-a."""
    if session.get('role') != 'admin':
        return jsonify({"error": "Admin only."}), 403
    import os as _os, sqlite3 as _sq, tempfile as _tf
    from config import DB_FILE, PORTAL_DB_FILE, AUDIT_DB_FILE, DATA_DIR
    from utils import cipher_suite, log_audit as _log

    body = request.get_json(silent=True) or {}
    fname = str(body.get('backup_file') or '').strip()
    target = str(body.get('target') or '').strip().lower()
    confirm = bool(body.get('confirm'))

    if not fname or '/' in fname or '..' in fname or not fname.endswith('.fernet'):
        return jsonify({'error': 'invalid_backup_file'}), 400
    target_map = {'crm': DB_FILE, 'portal': PORTAL_DB_FILE, 'audit': AUDIT_DB_FILE}
    if target not in target_map:
        return jsonify({'error': 'target_must_be_crm_portal_or_audit'}), 400

    backups_dir = _os.path.join(DATA_DIR, 'backups')
    src_path = _os.path.join(backups_dir, fname)
    if not _os.path.isfile(src_path):
        return jsonify({'error': 'backup_not_found'}), 404

    target_path = target_map[target]

    # Dry-run: pokazi info sto ce se desiti
    if not confirm:
        try:
            src_size = _os.path.getsize(src_path)
            tgt_size = _os.path.getsize(target_path) if _os.path.exists(target_path) else 0
            return jsonify({
                'confirm_required': True,
                'backup_file': fname,
                'backup_size_mb': round(src_size / (1024 * 1024), 2),
                'target': target,
                'target_current_size_mb': round(tgt_size / (1024 * 1024), 2),
                'target_path': target_path,
                'warning': ('This will REPLACE the current database. '
                            'The existing DB will be quarantined as .pre_restore.<ts>. '
                            'Pass confirm=true to proceed.')
            })
        except Exception as e:
            return jsonify({'error': str(e)[:200]}), 500

    # Real restore
    # NAPOMENA: Od V22.04.05+ aplikacija koristi isključivo PostgreSQL (Supabase).
    # Restore SQLite backup nije podržan — svi podaci su na Supabase serveru.
    # Ostavljamo kao placeholder za budući Postgres pg_dump restore.
    return jsonify({
        'error': 'not_supported',
        'detail': 'SQLite backup restore is no longer supported. '
                  'All data is stored on Supabase PostgreSQL. '
                  'Use pg_dump/pg_restore for PostgreSQL backups.'
    }), 400
