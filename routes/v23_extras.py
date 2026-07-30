"""
V23.1 extras — bulk actions, custom fields, API keys, outbound webhooks.

Sve pod admin permissions kljucevima iz PERMISSION_CATALOG.
"""
from __future__ import annotations
import db

import hashlib
import hmac
import json
import secrets
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request, session

from config import DB_FILE
from utils import login_required, log_audit

from flask import render_template

v23_extras_bp = Blueprint('v23_extras_bp', __name__)


@v23_extras_bp.route('/admin/custom-fields', methods=['GET'])
@login_required
def custom_fields_page():
    if session.get('role') != 'admin':
        return "Admin only.", 403
    return render_template('admin_custom_fields.html')


@v23_extras_bp.route('/admin/webhooks', methods=['GET'])
@login_required
def webhooks_page():
    if session.get('role') != 'admin':
        return "Admin only.", 403
    return render_template('admin_webhooks.html')


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


# =========================================================================
#  BULK ACTIONS — apply operation to N entities at once
# =========================================================================

BULK_ALLOWED = {
    ('partners',  'archive'),  ('partners',  'unarchive'),  ('partners',  'tag'),   ('partners',  'delete'),
    ('products',  'archive'),  ('products',  'unarchive'),  ('products',  'tag'),   ('products',  'delete'),
    ('deals',     'archive'),  ('deals',     'unarchive'),  ('deals',     'tag'),   ('deals',     'delete'),
    ('offers',    'archive'),  ('offers',    'delete'),
    ('invoices',  'archive'),  ('invoices',  'delete'),
}

ALLOWED_SQL_TABLES = frozenset({'partners', 'products', 'deals', 'offers', 'invoices'})


@v23_extras_bp.route('/api/bulk/<entity>/<action>', methods=['POST'])
@login_required
def bulk_action(entity, action):
    if (entity, action) not in BULK_ALLOWED:
        return jsonify({'error': 'action_not_allowed_on_entity'}), 400
    if entity not in ALLOWED_SQL_TABLES:
        return jsonify({'error': 'invalid_entity'}), 400
    body = request.get_json(silent=True) or {}
    ids = body.get('ids') or []
    if not isinstance(ids, list) or not ids:
        return jsonify({'error': 'ids_required'}), 400
    if len(ids) > 500:
        return jsonify({'error': 'too_many_ids_max_500'}), 400

    tag_value = str(body.get('tag') or '').strip()[:60] if action == 'tag' else None

    ok = 0
    failed = 0
    with db.connect_raw(DB_FILE) as conn:
        for eid in ids:
            try:
                if action == 'delete':
                    n = conn.execute(f"DELETE FROM {entity} WHERE id=?", (eid,)).rowcount
                    if n:
                        ok += 1
                    else:
                        failed += 1
                else:
                    r = conn.execute(f"SELECT data FROM {entity} WHERE id=?", (eid,)).fetchone()
                    if not r:
                        failed += 1
                        continue
                    try:
                        data = json.loads(r[0]) if r[0] else {}
                    except Exception:
                        data = {}
                    if action == 'archive':
                        data['archived'] = True
                        data['archivedAt'] = _now()
                        data['archivedBy'] = session.get('username')
                    elif action == 'unarchive':
                        data['archived'] = False
                        data.pop('archivedAt', None)
                    elif action == 'tag':
                        tags = set(data.get('tags') or [])
                        if tag_value:
                            tags.add(tag_value)
                        data['tags'] = sorted(tags)
                    conn.execute(f"UPDATE {entity} SET data=? WHERE id=?", (json.dumps(data), eid))
                    ok += 1
            except Exception:
                failed += 1

    log_audit('EDIT', entity, f'Bulk {action}: {ok} OK, {failed} failed ({tag_value or "-"})')
    # Emit webhook event za bulk operations
    try:
        emit_event(f'{entity}.bulk_{action}', {'count_ok': ok, 'count_failed': failed, 'ids': ids[:50]})
    except Exception:
        pass
    return jsonify({'ok': ok, 'failed': failed})


# =========================================================================
#  CUSTOM FIELDS — admin definise, svaki entitet ih koristi kroz .customFields dict
# =========================================================================

@v23_extras_bp.route('/api/custom-fields', methods=['GET'])
@login_required
def list_custom_fields():
    """Vraca sve aktivne definicije, opcionalno filter po entity_type."""
    entity = request.args.get('entity', '')
    with db.connect_raw(DB_FILE) as conn:
        if entity:
            rows = conn.execute(
                "SELECT id, entity_type, field_key, field_label, field_type, options_json, "
                "required, display_order FROM custom_field_defs "
                "WHERE entity_type=? AND is_active=1 ORDER BY display_order ASC",
                (entity,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, entity_type, field_key, field_label, field_type, options_json, "
                "required, display_order FROM custom_field_defs "
                "WHERE is_active=1 ORDER BY entity_type, display_order ASC"
            ).fetchall()
    out = []
    for r in rows:
        opts = None
        if r[5]:
            try: opts = json.loads(r[5])
            except Exception: opts = None
        out.append({
            'id': r[0], 'entity_type': r[1], 'field_key': r[2],
            'field_label': r[3], 'field_type': r[4],
            'options': opts, 'required': bool(r[6]),
            'display_order': r[7],
        })
    return jsonify({'fields': out})


@v23_extras_bp.route('/api/custom-fields', methods=['POST'])
@login_required
def create_custom_field():
    if session.get('role') != 'admin':
        return jsonify({'error': 'admin_only'}), 403
    body = request.get_json(silent=True) or {}
    entity = str(body.get('entity_type') or '').strip()[:40]
    key = str(body.get('field_key') or '').strip().lower()[:60]
    label = str(body.get('field_label') or '').strip()[:120]
    ftype = str(body.get('field_type') or 'text').strip()
    if ftype not in ('text', 'number', 'date', 'bool', 'select', 'url', 'email'):
        return jsonify({'error': 'invalid_type'}), 400
    if not entity or not key or not label:
        return jsonify({'error': 'entity_key_label_required'}), 400
    opts = body.get('options') if isinstance(body.get('options'), list) else None

    fid = str(uuid.uuid4())
    try:
        with db.connect_raw(DB_FILE) as conn:
            conn.execute(
                "INSERT INTO custom_field_defs (id, entity_type, field_key, field_label, "
                "field_type, options_json, required, display_order, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (fid, entity, key, label, ftype,
                 json.dumps(opts) if opts else None,
                 1 if body.get('required') else 0,
                 int(body.get('display_order') or 100),
                 _now())
            )
    except db.IntegrityError:
        return jsonify({'error': 'field_key_already_exists'}), 409
    return jsonify({'id': fid})


@v23_extras_bp.route('/api/custom-fields/<fid>', methods=['DELETE'])
@login_required
def delete_custom_field(fid):
    if session.get('role') != 'admin':
        return jsonify({'error': 'admin_only'}), 403
    with db.connect_raw(DB_FILE) as conn:
        conn.execute("UPDATE custom_field_defs SET is_active=0 WHERE id=?", (fid,))
    return jsonify({'deleted': True})


# =========================================================================
#  API KEYS — external system access via Bearer token
# =========================================================================

def _hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


@v23_extras_bp.route('/api/api-keys', methods=['GET'])
@login_required
def list_api_keys():
    uid = session.get('user_id')
    is_admin = session.get('role') == 'admin'
    with db.connect_raw(DB_FILE) as conn:
        if is_admin:
            rows = conn.execute(
                "SELECT id, name, key_prefix, owner_user_id, scope, rate_limit_per_min, "
                "created_at, last_used_at, revoked FROM api_keys ORDER BY created_at DESC"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, name, key_prefix, owner_user_id, scope, rate_limit_per_min, "
                "created_at, last_used_at, revoked FROM api_keys "
                "WHERE owner_user_id=? ORDER BY created_at DESC",
                (uid,)
            ).fetchall()
    return jsonify({
        'keys': [{
            'id': r[0], 'name': r[1], 'key_prefix': r[2], 'owner': r[3],
            'scope': r[4], 'rate_limit_per_min': r[5],
            'created_at': r[6], 'last_used_at': r[7],
            'revoked': bool(r[8]),
        } for r in rows]
    })


@v23_extras_bp.route('/api/api-keys', methods=['POST'])
@login_required
def create_api_key():
    body = request.get_json(silent=True) or {}
    name = str(body.get('name') or '').strip()[:100]
    if not name:
        return jsonify({'error': 'name_required'}), 400
    scope = str(body.get('scope') or 'read')
    if scope not in ('read', 'write', 'admin'):
        return jsonify({'error': 'invalid_scope'}), 400
    if scope == 'admin' and session.get('role') != 'admin':
        return jsonify({'error': 'admin_scope_admin_only'}), 403

    raw = 'ask_' + secrets.token_urlsafe(40)  # ask_ = Aspidus Key
    prefix = raw[:12]
    kid = str(uuid.uuid4())
    with db.connect_raw(DB_FILE) as conn:
        conn.execute(
            "INSERT INTO api_keys (id, name, key_hash, key_prefix, owner_user_id, "
            "scope, rate_limit_per_min, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (kid, name, _hash_key(raw), prefix, session.get('user_id'),
             scope, int(body.get('rate_limit_per_min') or 60), _now())
        )
    log_audit('CREATE', 'api_key', f'Created API key "{name}" ({scope})', is_suspicious=True)
    # Vratimo RAW jednom — sledeci put samo prefix
    return jsonify({'id': kid, 'raw_key': raw, 'name': name, 'scope': scope,
                    'warning': 'Save this key now — it will not be shown again.'})


@v23_extras_bp.route('/api/api-keys/<kid>/revoke', methods=['POST'])
@login_required
def revoke_api_key(kid):
    uid = session.get('user_id')
    is_admin = session.get('role') == 'admin'
    with db.connect_raw(DB_FILE) as conn:
        if is_admin:
            n = conn.execute("UPDATE api_keys SET revoked=1, revoked_at=? WHERE id=?",
                             (_now(), kid)).rowcount
        else:
            n = conn.execute("UPDATE api_keys SET revoked=1, revoked_at=? "
                             "WHERE id=? AND owner_user_id=?",
                             (_now(), kid, uid)).rowcount
    log_audit('SECURITY', 'api_key', f'Revoked API key {kid}')
    return jsonify({'revoked': n})


def verify_api_key(bearer_token: str) -> dict | None:
    """Middleware helper — vrati user info ili None. Zove je routes/api_v1.py
    (buduci blueprint). Ovde je API dostupan svima koji zele da naprave javni endpoint."""
    if not bearer_token or not bearer_token.startswith('ask_'):
        return None
    h = _hash_key(bearer_token)
    with db.connect_raw(DB_FILE) as conn:
        r = conn.execute(
            "SELECT ak.id, ak.owner_user_id, ak.scope, ak.rate_limit_per_min, "
            "u.username, u.role FROM api_keys ak "
            "LEFT JOIN users u ON u.id=ak.owner_user_id "
            "WHERE ak.key_hash=? AND ak.revoked=0",
            (h,)
        ).fetchone()
        if not r:
            return None
        conn.execute("UPDATE api_keys SET last_used_at=? WHERE id=?", (_now(), r[0]))
    return {
        'key_id': r[0], 'user_id': r[1], 'scope': r[2],
        'rate_limit_per_min': r[3], 'username': r[4], 'role': r[5],
    }


# =========================================================================
#  OUTBOUND WEBHOOKS — admin registruje URL + events, mi POST-ujemo
# =========================================================================

@v23_extras_bp.route('/api/webhooks', methods=['GET'])
@login_required
def list_webhooks():
    if session.get('role') != 'admin':
        return jsonify({'error': 'admin_only'}), 403
    with db.connect_raw(DB_FILE) as conn:
        rows = conn.execute(
            "SELECT id, name, target_url, events, is_active, created_at, "
            "created_by, last_fired_at, last_status, fail_count "
            "FROM outbound_webhooks ORDER BY created_at DESC"
        ).fetchall()
    return jsonify({
        'webhooks': [{
            'id': r[0], 'name': r[1], 'target_url': r[2],
            'events': (r[3] or '').split(','),
            'is_active': bool(r[4]), 'created_at': r[5],
            'created_by': r[6], 'last_fired_at': r[7],
            'last_status': r[8], 'fail_count': r[9],
        } for r in rows]
    })


@v23_extras_bp.route('/api/webhooks', methods=['POST'])
@login_required
def create_webhook():
    if session.get('role') != 'admin':
        return jsonify({'error': 'admin_only'}), 403
    body = request.get_json(silent=True) or {}
    name = str(body.get('name') or '').strip()[:100]
    url = str(body.get('target_url') or '').strip()[:500]
    events = body.get('events') or []
    if not name or not url.startswith(('http://', 'https://')):
        return jsonify({'error': 'name_and_valid_url_required'}), 400
    if not events or not isinstance(events, list):
        return jsonify({'error': 'events_list_required'}), 400
    events_csv = ','.join([str(e).strip()[:60] for e in events if str(e).strip()])[:1000]
    secret = 'whsec_' + secrets.token_urlsafe(32)
    wid = str(uuid.uuid4())
    with db.connect_raw(DB_FILE) as conn:
        conn.execute(
            "INSERT INTO outbound_webhooks (id, name, target_url, events, secret, "
            "created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (wid, name, url, events_csv, secret, _now(), session.get('username'))
        )
    log_audit('CREATE', 'webhook', f'Created webhook "{name}" → {url}', is_suspicious=True)
    return jsonify({'id': wid, 'secret': secret,
                    'warning': 'Signing secret shown once — save it now.'})


@v23_extras_bp.route('/api/webhooks/<wid>', methods=['DELETE'])
@login_required
def delete_webhook(wid):
    if session.get('role') != 'admin':
        return jsonify({'error': 'admin_only'}), 403
    with db.connect_raw(DB_FILE) as conn:
        conn.execute("DELETE FROM outbound_webhooks WHERE id=?", (wid,))
        conn.execute("DELETE FROM webhook_deliveries WHERE webhook_id=?", (wid,))
    return jsonify({'deleted': True})


@v23_extras_bp.route('/api/webhooks/<wid>/deliveries', methods=['GET'])
@login_required
def webhook_deliveries(wid):
    if session.get('role') != 'admin':
        return jsonify({'error': 'admin_only'}), 403
    with db.connect_raw(DB_FILE) as conn:
        rows = conn.execute(
            "SELECT id, event, status_code, response_snippet, delivered_at, duration_ms "
            "FROM webhook_deliveries WHERE webhook_id=? "
            "ORDER BY delivered_at DESC LIMIT 100", (wid,)
        ).fetchall()
    return jsonify({
        'deliveries': [{
            'id': r[0], 'event': r[1], 'status_code': r[2],
            'response': r[3], 'delivered_at': r[4], 'duration_ms': r[5],
        } for r in rows]
    })


# =========================================================================
#  emit_event — pozivaju drugi moduli kada se nesto interesantno desi.
#  Sve slanje ide u background thread da ne blokira request.
# =========================================================================

def emit_event(event_name: str, payload: dict) -> None:
    """Broadcast na sve aktivne webhook-e koji su subscribed na event_name."""
    try:
        with db.connect_raw(DB_FILE) as conn:
            rows = conn.execute(
                "SELECT id, target_url, events, secret FROM outbound_webhooks "
                "WHERE is_active=1"
            ).fetchall()
    except Exception:
        return
    for r in rows:
        wid, url, events_csv, secret = r
        events = (events_csv or '').split(',')
        # Podrska za wildcard: "deal.*" matchuje "deal.created"
        matched = False
        for ev in events:
            ev = ev.strip()
            if ev == '*' or ev == event_name:
                matched = True; break
            if ev.endswith('.*') and event_name.startswith(ev[:-1]):
                matched = True; break
        if not matched:
            continue
        # Fire in background
        t = threading.Thread(target=_deliver_webhook,
                             args=(wid, url, secret, event_name, payload),
                             daemon=True)
        t.start()


def _deliver_webhook(wid, url, secret, event, payload):
    """POST na target_url sa X-Aspidus-Event i X-Aspidus-Signature (HMAC-SHA256)."""
    import urllib.request, urllib.error
    body_dict = {
        'event': event,
        'delivered_at': _now(),
        'payload': payload,
    }
    body = json.dumps(body_dict).encode('utf-8')
    sig = hmac.new(secret.encode('utf-8'), body, hashlib.sha256).hexdigest()
    started = time.time()
    status = 0
    snippet = ''
    try:
        req = urllib.request.Request(url, data=body, headers={
            'Content-Type': 'application/json',
            'X-Aspidus-Event': event,
            'X-Aspidus-Signature': f'sha256={sig}',
            'User-Agent': 'Aspidus-Webhook/1.0',
        }, method='POST')
        with urllib.request.urlopen(req, timeout=10) as resp:
            status = resp.status
            snippet = resp.read(500).decode('utf-8', errors='replace')
    except urllib.error.HTTPError as e:
        status = e.code
        try:
            snippet = e.read(500).decode('utf-8', errors='replace')
        except Exception:
            snippet = str(e)
    except Exception as e:
        status = 0
        snippet = f'{type(e).__name__}: {e}'
    duration_ms = int((time.time() - started) * 1000)

    outcome = 'ok' if 200 <= status < 300 else ('4xx' if 400 <= status < 500 else ('5xx' if status >= 500 else 'timeout'))

    try:
        with db.connect_raw(DB_FILE) as conn:
            conn.execute(
                "INSERT INTO webhook_deliveries (id, webhook_id, event, payload_hash, "
                "status_code, response_snippet, delivered_at, duration_ms) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (str(uuid.uuid4()), wid, event,
                 hashlib.sha256(body).hexdigest()[:32],
                 status, snippet[:500], _now(), duration_ms)
            )
            if outcome == 'ok':
                conn.execute(
                    "UPDATE outbound_webhooks SET last_fired_at=?, last_status='ok', "
                    "fail_count=0 WHERE id=?", (_now(), wid))
            else:
                conn.execute(
                    "UPDATE outbound_webhooks SET last_fired_at=?, last_status=?, "
                    "fail_count=fail_count+1 WHERE id=?", (_now(), outcome, wid))
                # Auto-disable after 20 consecutive fails
                fc = conn.execute("SELECT fail_count FROM outbound_webhooks WHERE id=?",
                                  (wid,)).fetchone()
                if fc and fc[0] >= 20:
                    conn.execute("UPDATE outbound_webhooks SET is_active=0 WHERE id=?", (wid,))
    except Exception:
        pass
