"""
Round G — REAL-TIME ACTIVITY FEED
==================================
Materialized view iznad audit_logs. Dashboard prikazuje poslednjih 25 akcija
u sistemu — ko je sta uradio, kad, na kojoj entiteti.

Endpointi:
  GET  /api/activity/recent?limit=25     — poslednje aktivnosti (svih usera)
  GET  /api/activity/mine?limit=25       — samo moje
"""
from __future__ import annotations
import db

import sqlite3
from flask import Blueprint, jsonify, request, session

from config import AUDIT_DB_FILE
from utils import login_required

activity_feed_bp = Blueprint('activity_feed_bp', __name__)


# Akcije koje su relevantne za "activity feed" (ne security noise)
_RELEVANT = ('CREATE', 'EDIT', 'DELETE', 'LOGIN', 'ACCEPT', 'REJECT', 'UPLOAD', 'SEND')
_MODULES_EXCLUDED = ('firewall', 'session')  # skip auth housekeeping


@activity_feed_bp.route('/api/activity/recent', methods=['GET'])
@login_required
def recent_activity():
    limit = max(1, min(int(request.args.get('limit', 25)), 100))
    placeholders = ','.join(['?'] * len(_RELEVANT))
    excluded_placeholders = ','.join(['?'] * len(_MODULES_EXCLUDED))
    with db.connect_raw(AUDIT_DB_FILE) as conn:
        rows = conn.execute(
            f"SELECT timestamp, username, action, module, details "
            f"FROM audit_logs "
            f"WHERE action IN ({placeholders}) AND module NOT IN ({excluded_placeholders}) "
            f"ORDER BY timestamp DESC LIMIT ?",
            (*_RELEVANT, *_MODULES_EXCLUDED, limit)
        ).fetchall()
    return jsonify({
        'entries': [{
            'timestamp': r[0], 'username': r[1], 'action': r[2],
            'module': r[3], 'details': r[4],
        } for r in rows]
    })


@activity_feed_bp.route('/api/activity/mine', methods=['GET'])
@login_required
def my_activity():
    limit = max(1, min(int(request.args.get('limit', 25)), 100))
    uid = session.get('user_id')
    with db.connect_raw(AUDIT_DB_FILE) as conn:
        rows = conn.execute(
            "SELECT timestamp, action, module, details "
            "FROM audit_logs "
            "WHERE user_id=? "
            "ORDER BY timestamp DESC LIMIT ?",
            (uid, limit)
        ).fetchall()
    return jsonify({
        'entries': [{
            'timestamp': r[0], 'action': r[1],
            'module': r[2], 'details': r[3],
        } for r in rows]
    })
