"""
Round G — SAVED FILTERS
=======================
User cuva svoje "view"-ove: partneri po zemlji, deals u pipeline, offers po statusu,
itd. Frontend salje ceo filter state kao JSON i dobija id. Kasnije GET vraca sve
svoje + shared.

Endpointi:
  GET  /api/filters?entity=<type>        — moji + shared za dati entity
  POST /api/filters                      — save novi filter
  PATCH /api/filters/<id>                — update filter (samo owner)
  DELETE /api/filters/<id>               — obrisi (samo owner)
"""
from __future__ import annotations
import db

import json
import sqlite3
import uuid
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request, session

from config import DB_FILE
from utils import login_required

saved_filters_bp = Blueprint('saved_filters_bp', __name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


@saved_filters_bp.route('/api/filters', methods=['GET'])
@login_required
def list_filters():
    uid = session.get('user_id')
    entity = request.args.get('entity', '')
    with db.connect_raw(DB_FILE) as conn:
        if entity:
            rows = conn.execute(
                "SELECT id, name, entity_type, filter_json, is_shared, owner_user_id, "
                "created_at, updated_at FROM saved_filters "
                "WHERE entity_type=? AND (owner_user_id=? OR is_shared=1) "
                "ORDER BY name ASC",
                (entity, uid)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, name, entity_type, filter_json, is_shared, owner_user_id, "
                "created_at, updated_at FROM saved_filters "
                "WHERE owner_user_id=? OR is_shared=1 "
                "ORDER BY entity_type, name ASC",
                (uid,)
            ).fetchall()
    return jsonify({
        'filters': [{
            'id': r[0], 'name': r[1], 'entity_type': r[2],
            'filter': json.loads(r[3]) if r[3] else {},
            'is_shared': bool(r[4]),
            'is_owner': r[5] == uid,
            'created_at': r[6], 'updated_at': r[7],
        } for r in rows]
    })


@saved_filters_bp.route('/api/filters', methods=['POST'])
@login_required
def create_filter():
    body = request.get_json(silent=True) or {}
    name = str(body.get('name') or '').strip()[:100]
    entity = str(body.get('entity_type') or '').strip()[:40]
    filt = body.get('filter') if isinstance(body.get('filter'), dict) else None
    if not name or not entity or filt is None:
        return jsonify({'error': 'name_entity_filter_required'}), 400
    fid = str(uuid.uuid4())
    now = _now()
    with db.connect_raw(DB_FILE) as conn:
        conn.execute(
            "INSERT INTO saved_filters (id, owner_user_id, name, entity_type, "
            "filter_json, is_shared, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (fid, session.get('user_id'), name, entity, json.dumps(filt),
             1 if body.get('is_shared') else 0, now, now)
        )
    return jsonify({'id': fid})


@saved_filters_bp.route('/api/filters/<fid>', methods=['PATCH'])
@login_required
def update_filter(fid):
    body = request.get_json(silent=True) or {}
    uid = session.get('user_id')
    sets, params = [], []
    if 'name' in body:
        sets.append('name=?'); params.append(str(body['name'])[:100])
    if 'filter' in body and isinstance(body['filter'], dict):
        sets.append('filter_json=?'); params.append(json.dumps(body['filter']))
    if 'is_shared' in body:
        sets.append('is_shared=?'); params.append(1 if body['is_shared'] else 0)
    if not sets:
        return jsonify({'error': 'no_changes'}), 400
    sets.append('updated_at=?'); params.append(_now())
    params.extend([fid, uid])
    with db.connect_raw(DB_FILE) as conn:
        n = conn.execute(
            f"UPDATE saved_filters SET {', '.join(sets)} WHERE id=? AND owner_user_id=?",
            params
        ).rowcount
    if not n:
        return jsonify({'error': 'not_found_or_not_owner'}), 404
    return jsonify({'updated': True})


@saved_filters_bp.route('/api/filters/<fid>', methods=['DELETE'])
@login_required
def delete_filter(fid):
    with db.connect_raw(DB_FILE) as conn:
        n = conn.execute("DELETE FROM saved_filters WHERE id=? AND owner_user_id=?",
                         (fid, session.get('user_id'))).rowcount
    return jsonify({'deleted': n})
