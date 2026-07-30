"""
Round G — USER TASKS / TODOS
============================
Personal task list per user. Moze se linkovati na entity (partner/deal/offer)
tako da je vidljivo iz detail view-a. Podseca preko email digest-a (koristi
postojeci _notification_digest_loop).

Endpointi:
  GET  /api/tasks                        — moja lista (filter po status, due)
  POST /api/tasks                        — kreiraj
  PATCH /api/tasks/<id>                  — update (title, priority, status, due)
  DELETE /api/tasks/<id>                 — obrisi
  POST /api/tasks/<id>/complete          — mark as done
  GET  /api/tasks/entity/<type>/<id>     — svi taskovi za entity (svi useri)
"""
from __future__ import annotations
import db

import sqlite3
import uuid
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request, session

from config import DB_FILE
from utils import login_required, log_audit

user_tasks_bp = Blueprint('user_tasks_bp', __name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


@user_tasks_bp.route('/api/tasks', methods=['GET'])
@login_required
def list_tasks():
    uid = session.get('user_id')
    status = request.args.get('status')  # open | done | canceled | all
    with db.connect_raw(DB_FILE) as conn:
        q = ("SELECT id, title, description, due_at, priority, status, "
             "linked_entity_type, linked_entity_id, created_at, completed_at "
             "FROM user_tasks WHERE owner_user_id=?")
        params = [uid]
        if status and status != 'all':
            q += " AND status=?"
            params.append(status)
        q += " ORDER BY CASE WHEN status='open' THEN 0 ELSE 1 END, priority ASC, due_at ASC NULLS LAST, created_at DESC"
        rows = conn.execute(q, params).fetchall()
    return jsonify({
        'tasks': [{
            'id': r[0], 'title': r[1], 'description': r[2], 'due_at': r[3],
            'priority': r[4], 'status': r[5],
            'linked_entity_type': r[6], 'linked_entity_id': r[7],
            'created_at': r[8], 'completed_at': r[9],
        } for r in rows]
    })


@user_tasks_bp.route('/api/tasks', methods=['POST'])
@login_required
def create_task():
    body = request.get_json(silent=True) or {}
    title = str(body.get('title') or '').strip()[:200]
    if not title:
        return jsonify({'error': 'title_required'}), 400
    tid = str(uuid.uuid4())
    with db.connect_raw(DB_FILE) as conn:
        conn.execute(
            "INSERT INTO user_tasks (id, owner_user_id, title, description, due_at, "
            "priority, linked_entity_type, linked_entity_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (tid, session.get('user_id'), title,
             str(body.get('description') or '')[:1000],
             str(body.get('due_at') or '') or None,
             int(body.get('priority') or 2),
             str(body.get('linked_entity_type') or '') or None,
             str(body.get('linked_entity_id') or '') or None,
             _now())
        )
    return jsonify({'id': tid, 'title': title})


@user_tasks_bp.route('/api/tasks/<tid>', methods=['PATCH'])
@login_required
def update_task(tid):
    body = request.get_json(silent=True) or {}
    allowed = {'title': 200, 'description': 1000, 'due_at': 40, 'priority': None, 'status': 20}
    sets, params = [], []
    for k, maxlen in allowed.items():
        if k in body:
            v = body[k]
            if maxlen and isinstance(v, str):
                v = v[:maxlen]
            sets.append(f'{k}=?')
            params.append(v)
    if not sets:
        return jsonify({'error': 'no_changes'}), 400
    params.extend([tid, session.get('user_id')])
    with db.connect_raw(DB_FILE) as conn:
        n = conn.execute(f"UPDATE user_tasks SET {', '.join(sets)} "
                         f"WHERE id=? AND owner_user_id=?", params).rowcount
    if not n:
        return jsonify({'error': 'not_found'}), 404
    return jsonify({'updated': True})


@user_tasks_bp.route('/api/tasks/<tid>', methods=['DELETE'])
@login_required
def delete_task(tid):
    with db.connect_raw(DB_FILE) as conn:
        n = conn.execute("DELETE FROM user_tasks WHERE id=? AND owner_user_id=?",
                         (tid, session.get('user_id'))).rowcount
    return jsonify({'deleted': n})


@user_tasks_bp.route('/api/tasks/<tid>/complete', methods=['POST'])
@login_required
def complete_task(tid):
    with db.connect_raw(DB_FILE) as conn:
        n = conn.execute(
            "UPDATE user_tasks SET status='done', completed_at=? "
            "WHERE id=? AND owner_user_id=?",
            (_now(), tid, session.get('user_id'))
        ).rowcount
    if not n:
        return jsonify({'error': 'not_found'}), 404
    return jsonify({'completed': True})


@user_tasks_bp.route('/api/tasks/entity/<etype>/<eid>', methods=['GET'])
@login_required
def entity_tasks(etype, eid):
    """Svi taskovi (svih usera) vezani za dati entity — koristi se u detail view-u."""
    with db.connect_raw(DB_FILE) as conn:
        rows = conn.execute(
            "SELECT ut.id, ut.title, ut.status, ut.due_at, ut.priority, ut.owner_user_id, "
            "COALESCE(u.username,'?') AS username "
            "FROM user_tasks ut LEFT JOIN users u ON u.id=ut.owner_user_id "
            "WHERE ut.linked_entity_type=? AND ut.linked_entity_id=? "
            "ORDER BY ut.status ASC, ut.due_at ASC NULLS LAST",
            (etype, eid)
        ).fetchall()
    return jsonify({
        'tasks': [{
            'id': r[0], 'title': r[1], 'status': r[2], 'due_at': r[3],
            'priority': r[4], 'owner_user_id': r[5], 'username': r[6],
        } for r in rows]
    })
