import db
import sqlite3
import json
import uuid
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify, session
from config import DB_FILE
from utils import login_required, log_audit, safe_parse, decrypt_data

vault_bp = Blueprint('vault', __name__)

def _get_role_and_perms(c):
    """Ucitava rolu i permisije trenutno ulogovanog korisnika."""
    c.execute('SELECT role, permissions FROM users WHERE id=?', (session['user_id'],))
    row = c.fetchone()
    if not row:
        return None, {}
    role = row[0]
    perms = decrypt_data(row[1]) if row[1] else {}
    return role, perms

@vault_bp.route('/api/vault/save', methods=['POST'])
@login_required
def save_document_to_vault():
    payload = request.get_json(silent=True)
    doc_id = f"doc_{uuid.uuid4().hex[:12]}"

    doc_data = {
        "id": doc_id,
        "partnerId": payload.get('partnerId'),
        "productId": payload.get('productId'),
        "docType": payload.get('docType', 'Document'),
        "fileName": payload.get('fileName', 'Document.pdf'),
        "fileUrl": payload.get('fileUrl'),
        "createdAt": datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    }

    if not doc_data['partnerId'] or not doc_data['fileUrl']:
        return jsonify({"error": "Partner ID and File URL are mandatory."}), 400

    conn = db.connect_raw(DB_FILE)
    try:
        c = conn.cursor()
        # ISPRAVKA: ova ruta je ranije potpuno zaobilazila permission model koji
        # postoji za shared_documents u routes/data.py (perm_map -> shared_documents_edit).
        # Bilo je moguce cuvati dokumente u trezoru bez ikakve dozvole.
        role, perms = _get_role_and_perms(c)
        if role is None:
            return jsonify({"error": "User not found"}), 401
        if role != 'admin' and not perms.get('shared_documents_edit', False):
            log_audit('SECURITY', 'vault', 'Prevented unauthorized write to document vault', is_suspicious=True)
            return jsonify({"error": "Unauthorized"}), 403

        c.execute("INSERT INTO shared_documents (id, data) VALUES (?, ?)", (doc_id, json.dumps(doc_data)))
        conn.commit()
    finally:
        conn.close()

    log_audit('CREATE', 'vault', f"Saved {doc_data['docType']} for partner {doc_data['partnerId']}", is_suspicious=False)
    return jsonify({"status": "success", "message": "Document secured in vault.", "document": doc_data}), 200

@vault_bp.route('/api/vault/documents', methods=['GET'])
@login_required
def get_vault_documents():
    partner_id = request.args.get('partnerId')
    product_id = request.args.get('productId')

    conn = db.connect_raw(DB_FILE)
    try:
        c = conn.cursor()
        # ISPRAVKA: ista permisija kao gore, sada i za citanje dokumenata.
        role, perms = _get_role_and_perms(c)
        if role is None:
            return jsonify({"error": "User not found"}), 401
        can_view = role == 'admin' or perms.get('shared_documents_view_all', False) or \
                   perms.get('shared_documents_view', False) or perms.get('shared_documents_edit', False)
        if not can_view:
            log_audit('SECURITY', 'vault', 'Prevented unauthorized read of document vault', is_suspicious=True)
            return jsonify([]), 403

        c.execute("SELECT id, data FROM shared_documents")
        rows = c.fetchall()
    finally:
        conn.close()

    docs = []
    for row in rows:
        d = safe_parse(row[1])
        if partner_id and d.get('partnerId') != partner_id:
            continue
        if product_id and d.get('productId') != product_id:
            continue
        docs.append(d)

    docs.sort(key=lambda x: x.get('createdAt', ''), reverse=True)
    return jsonify(docs)