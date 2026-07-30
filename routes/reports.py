"""
Round B — Report Builder.

Admin definise custom SQL SELECT upit (READ-ONLY) i cuva ga u
`custom_reports` tabelu. Dashboard onda renderuje rezultat kao KPI,
bar, line, pie, ili table chart preko Chart.js.

BEZBEDNOST:
  * Prihvata samo SELECT statement-e (SQL keyword whitelist)
  * Blokira sve pisace kljucne reci (INSERT/UPDATE/DELETE/DROP/ALTER/
    CREATE/REPLACE/GRANT/PRAGMA/ATTACH/DETACH)
  * Zabrana ";" (multi-statement injection)
  * Timeout 10s
  * Limit rezultata: 5000 redova
  * Vidljivo samo admin-u za sada
"""
from __future__ import annotations
import db

import json
import re
import sqlite3
import time
import uuid
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request, session, render_template

from config import DB_FILE
from utils import login_required, log_audit

reports_bp = Blueprint('reports_bp', __name__)


@reports_bp.route('/admin/reports', methods=['GET'])
@login_required
def reports_page():
    if session.get('role') != 'admin':
        return "Admin only.", 403
    return render_template('admin_reports.html')


VALID_CHART_TYPES = {'kpi', 'bar', 'line', 'pie', 'table'}

FORBIDDEN_KEYWORDS = {
    'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'REPLACE',
    'TRUNCATE', 'GRANT', 'REVOKE', 'PRAGMA', 'ATTACH', 'DETACH', 'VACUUM',
    'REINDEX', 'ANALYZE', 'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT',
}


def _validate_sql(sql: str) -> tuple[bool, str]:
    """Vrati (ok, error_message). Prihvata samo READ-ONLY SELECT."""
    if not sql or not isinstance(sql, str):
        return False, 'SQL required'
    sql = sql.strip()
    if len(sql) > 5000:
        return False, 'SQL too long (max 5000 chars)'
    # Ne dozvoli semicolons (multi-statement)
    if ';' in sql.rstrip(';'):
        return False, 'Multiple statements not allowed'
    sql_clean = sql.rstrip(';').strip()
    # Mora poceti sa SELECT ili WITH
    first_word = re.match(r'^\s*(\w+)', sql_clean)
    if not first_word:
        return False, 'Invalid SQL'
    fw = first_word.group(1).upper()
    if fw not in ('SELECT', 'WITH'):
        return False, f'Must start with SELECT or WITH, got {fw}'
    # Blokiraj forbidden keyword-e (case-insensitive word boundaries)
    upper = sql_clean.upper()
    for kw in FORBIDDEN_KEYWORDS:
        if re.search(r'\b' + kw + r'\b', upper):
            return False, f'Forbidden keyword: {kw}'
    return True, ''


@reports_bp.route('/api/reports', methods=['GET'])
@login_required
def reports_list():
    """Lista svih izvestaja koje user vidi: svoje + shared."""
    uid = session.get('user_id')
    role = session.get('role')
    try:
        with db.connect_raw(DB_FILE) as conn:
            if role == 'admin':
                # Admin vidi sve
                rows = conn.execute(
                    "SELECT id, owner_user_id, title, description, chart_type, "
                    "is_shared, created_at, updated_at FROM custom_reports "
                    "ORDER BY updated_at DESC"
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT id, owner_user_id, title, description, chart_type, "
                    "is_shared, created_at, updated_at FROM custom_reports "
                    "WHERE owner_user_id=? OR is_shared=1 "
                    "ORDER BY updated_at DESC",
                    (uid,)
                ).fetchall()
    except sqlite3.OperationalError as e:
        return jsonify({'error': str(e)[:200]}), 500
    return jsonify({
        'reports': [{
            'id': r[0], 'owner_user_id': r[1], 'title': r[2],
            'description': r[3], 'chart_type': r[4],
            'is_shared': bool(r[5]), 'created_at': r[6], 'updated_at': r[7],
            'is_owner': r[1] == uid,
        } for r in rows]
    })


@reports_bp.route('/api/reports', methods=['POST'])
@login_required
def reports_create():
    """Sacuvaj novi izvestaj."""
    if session.get('role') != 'admin':
        return jsonify({'error': 'admin_only'}), 403
    body = request.get_json(silent=True) or {}
    title = str(body.get('title') or '').strip()[:200]
    description = str(body.get('description') or '').strip()[:500]
    sql = str(body.get('sql_query') or '').strip()
    chart_type = str(body.get('chart_type') or 'table').lower()
    is_shared = bool(body.get('is_shared'))

    if not title:
        return jsonify({'error': 'title_required'}), 400
    if chart_type not in VALID_CHART_TYPES:
        return jsonify({'error': f'chart_type must be one of {sorted(VALID_CHART_TYPES)}'}), 400
    ok, err = _validate_sql(sql)
    if not ok:
        return jsonify({'error': 'invalid_sql', 'detail': err}), 400

    rid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    try:
        with db.connect_raw(DB_FILE) as conn:
            conn.execute(
                "INSERT INTO custom_reports (id, owner_user_id, title, description, "
                "sql_query, chart_type, is_shared, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (rid, session.get('user_id'), title, description, sql,
                 chart_type, 1 if is_shared else 0, now, now)
            )
    except sqlite3.OperationalError as e:
        return jsonify({'error': str(e)[:200]}), 500
    log_audit('CREATE', 'reports', f'Custom report "{title}" ({chart_type})')
    return jsonify({'id': rid, 'title': title, 'chart_type': chart_type})


@reports_bp.route('/api/reports/<rid>', methods=['GET'])
@login_required
def reports_get(rid):
    """Vrati definiciju izvestaja."""
    try:
        with db.connect_raw(DB_FILE) as conn:
            r = conn.execute(
                "SELECT id, owner_user_id, title, description, sql_query, "
                "chart_type, is_shared, created_at, updated_at FROM custom_reports WHERE id=?",
                (rid,)
            ).fetchone()
    except sqlite3.OperationalError as e:
        return jsonify({'error': str(e)[:200]}), 500
    if not r:
        return jsonify({'error': 'not_found'}), 404
    # Provera pristupa
    uid = session.get('user_id')
    if r[1] != uid and not r[6] and session.get('role') != 'admin':
        return jsonify({'error': 'forbidden'}), 403
    return jsonify({
        'id': r[0], 'owner_user_id': r[1], 'title': r[2], 'description': r[3],
        'sql_query': r[4], 'chart_type': r[5], 'is_shared': bool(r[6]),
        'created_at': r[7], 'updated_at': r[8],
    })


@reports_bp.route('/api/reports/<rid>', methods=['DELETE'])
@login_required
def reports_delete(rid):
    if session.get('role') != 'admin':
        return jsonify({'error': 'admin_only'}), 403
    try:
        with db.connect_raw(DB_FILE) as conn:
            n = conn.execute("DELETE FROM custom_reports WHERE id=?", (rid,)).rowcount
    except sqlite3.OperationalError as e:
        return jsonify({'error': str(e)[:200]}), 500
    return jsonify({'deleted': n})


@reports_bp.route('/api/reports/<rid>/run', methods=['GET'])
@login_required
def reports_run(rid):
    """Pokreni SQL izvestaja i vrati rezultat u obliku pogodnom za render."""
    # Ucitaj izvestaj
    try:
        with db.connect_raw(DB_FILE) as conn:
            r = conn.execute(
                "SELECT owner_user_id, sql_query, chart_type, is_shared, title "
                "FROM custom_reports WHERE id=?", (rid,)
            ).fetchone()
    except sqlite3.OperationalError as e:
        return jsonify({'error': str(e)[:200]}), 500
    if not r:
        return jsonify({'error': 'not_found'}), 404
    if r[0] != session.get('user_id') and not r[3] and session.get('role') != 'admin':
        return jsonify({'error': 'forbidden'}), 403

    sql = r[1]
    chart_type = r[2]
    title = r[4]

    # Duple provere sigurnosti (u slucaju izmene direktno u tabeli)
    ok, err = _validate_sql(sql)
    if not ok:
        return jsonify({'error': 'invalid_sql_in_stored_report', 'detail': err}), 500

    # Izvrsi read-only konekciju
    start = time.time()
    try:
        # SQLite read-only URI mode
        uri = f'file:{DB_FILE}?mode=ro'
        conn = sqlite3.connect(uri, uri=True, timeout=10.0)  # NOTE: in-memory/attach DB — cannot use db.connect_raw()
        conn.execute('PRAGMA query_only = 1')
        cur = conn.execute(sql + ' LIMIT 5000' if 'LIMIT' not in sql.upper() else sql)
        columns = [d[0] for d in cur.description] if cur.description else []
        rows = cur.fetchall()
        conn.close()
    except Exception as e:
        return jsonify({
            'error': 'query_failed',
            'detail': "QUERY_ERROR"
        }), 500

    elapsed_ms = int((time.time() - start) * 1000)
    data = [dict(zip(columns, row)) for row in rows]

    log_audit('READ', 'reports',
              f'Custom report run: "{title}" ({elapsed_ms}ms, {len(rows)} rows)')

    return jsonify({
        'id': rid, 'title': title, 'chart_type': chart_type,
        'columns': columns, 'rows': data,
        'row_count': len(rows), 'elapsed_ms': elapsed_ms,
    })
