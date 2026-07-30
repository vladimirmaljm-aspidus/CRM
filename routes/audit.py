import db
import sqlite3
from flask import Blueprint, request, jsonify, session
from config import AUDIT_DB_FILE, DB_FILE
from utils import log_audit, login_required, decrypt_data

audit_bp = Blueprint('audit', __name__)

def user_has_permission(perm_key):
    """Admin uvek; inače proverava eksplicitnu permisiju iz korisničkog naloga.
    decrypt_data korektno čita i kriptovane i čiste (json) permisije."""
    if session.get('role') == 'admin':
        return True
    if 'user_id' not in session:
        return False
    conn = db.connect_raw(DB_FILE)
    try:
        c = conn.cursor()
        c.execute('SELECT permissions FROM users WHERE id=?', (session['user_id'],))
        row = c.fetchone()
    finally:
        conn.close()
    perms = decrypt_data(row[0]) if row and row[0] else {}
    return bool(isinstance(perms, dict) and perms.get(perm_key))

@audit_bp.route('/api/audit/event', methods=['POST'])
@login_required
def log_client_event():
    data = request.get_json(silent=True)
    log_audit(data.get('action', 'UNKNOWN'), data.get('module', 'system'), data.get('details', ''))
    return jsonify({"status": "success"})

@audit_bp.route('/api/audit_logs', methods=['GET'])
@login_required
def get_audit_logs():
    # Admin ili radnik kome je admin eksplicitno dodelio 'audit_view'.
    if not user_has_permission('audit_view'):
        log_audit('SECURITY', 'audit', 'Unauthorized attempt to access audit logs', is_suspicious=True)
        return jsonify({"error": "Unauthorized"}), 403
    
    conn = None
    logs = []
    try:
        conn = db.connect_raw(AUDIT_DB_FILE)
        c = conn.cursor()
        c.execute('SELECT id, username, action, module, details, ip_address, user_agent, timestamp, is_suspicious, location FROM audit_logs ORDER BY timestamp DESC')
        logs = [{"id": r[0], "username": r[1], "action": r[2], "module": r[3], "details": r[4], "ip": r[5], "user_agent": r[6], "timestamp": r[7], "is_suspicious": bool(r[8]), "location": r[9] if r[9] else 'N/A'} for r in c.fetchall()]
    finally:
        if conn: conn.close()
        
    return jsonify(logs)