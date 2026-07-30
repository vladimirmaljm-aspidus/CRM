"""
Round A backend — nested notes, deal documents, low-stock alerts,
audit CSV export, XLSX offer export, contact history.

Kompaktan modul koji drzi sve nove Round A endpointe na jednom mestu.
"""
from __future__ import annotations
import db

import csv
import io
import json
import sqlite3
import uuid
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request, session, send_file, Response

from config import DB_FILE, PORTAL_UPLOAD_FOLDER
from utils import decrypt_data, login_required, log_audit

entities_extras_bp = Blueprint('entities_extras_bp', __name__)


# ==========================================================
# 1. ENTITY NOTES — /api/notes
# ==========================================================
# Notes su vezane za bilo koji entity (partner|deal|offer|product).
# Sluze kao interni komentari tim-a; klijent ih ne vidi.

VALID_ENTITY_TYPES = {'partner', 'deal', 'offer', 'product'}


def _iso_now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


@entities_extras_bp.route('/api/notes/<entity_type>/<entity_id>', methods=['GET'])
@login_required
def notes_list(entity_type, entity_id):
    if entity_type not in VALID_ENTITY_TYPES:
        return jsonify({'error': 'invalid_entity_type'}), 400
    try:
        with db.connect_raw(DB_FILE) as conn:
            rows = conn.execute(
                "SELECT id, body, created_by, created_at, pinned FROM entity_notes "
                "WHERE entity_type=? AND entity_id=? "
                "ORDER BY pinned DESC, created_at DESC LIMIT 200",
                (entity_type, entity_id)
            ).fetchall()
    except sqlite3.OperationalError as e:
        return jsonify({'error': str(e)[:200]}), 500
    return jsonify({
        'entity_type': entity_type, 'entity_id': entity_id,
        'notes': [{'id': r[0], 'body': r[1], 'created_by': r[2],
                   'created_at': r[3], 'pinned': bool(r[4])} for r in rows],
    })


@entities_extras_bp.route('/api/notes/<entity_type>/<entity_id>', methods=['POST'])
@login_required
def notes_create(entity_type, entity_id):
    if entity_type not in VALID_ENTITY_TYPES:
        return jsonify({'error': 'invalid_entity_type'}), 400
    body = (request.get_json(silent=True) or {}).get('body', '')
    body = str(body or '').strip()
    if not body or len(body) < 2:
        return jsonify({'error': 'body_required'}), 400
    if len(body) > 5000:
        return jsonify({'error': 'body_too_long'}), 400

    nid = str(uuid.uuid4())
    try:
        with db.connect_raw(DB_FILE) as conn:
            conn.execute(
                "INSERT INTO entity_notes (id, entity_type, entity_id, body, created_by, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (nid, entity_type, entity_id, body[:5000],
                 session.get('username') or 'system', _iso_now())
            )
    except sqlite3.OperationalError as e:
        return jsonify({'error': str(e)[:200]}), 500
    log_audit('CREATE', entity_type, f'Note added to {entity_type}/{entity_id}')
    return jsonify({'id': nid, 'ok': True})


@entities_extras_bp.route('/api/notes/<note_id>', methods=['DELETE'])
@login_required
def notes_delete(note_id):
    """Brise note. Admin moze brisati bilo koju, obican user samo svoje."""
    try:
        with db.connect_raw(DB_FILE) as conn:
            r = conn.execute(
                "SELECT created_by FROM entity_notes WHERE id=?", (note_id,)
            ).fetchone()
            if not r:
                return jsonify({'error': 'note_not_found'}), 404
            is_owner = r[0] == session.get('username')
            is_admin = session.get('role') == 'admin'
            if not (is_owner or is_admin):
                return jsonify({'error': 'forbidden'}), 403
            conn.execute("DELETE FROM entity_notes WHERE id=?", (note_id,))
    except sqlite3.OperationalError as e:
        return jsonify({'error': str(e)[:200]}), 500
    return jsonify({'deleted': 1})


@entities_extras_bp.route('/api/notes/<note_id>/pin', methods=['POST'])
@login_required
def notes_pin(note_id):
    pinned = bool((request.get_json(silent=True) or {}).get('pinned', True))
    try:
        with db.connect_raw(DB_FILE) as conn:
            n = conn.execute(
                "UPDATE entity_notes SET pinned=? WHERE id=?",
                (1 if pinned else 0, note_id)
            ).rowcount
    except sqlite3.OperationalError as e:
        return jsonify({'error': str(e)[:200]}), 500
    return jsonify({'updated': n, 'pinned': pinned})


# ==========================================================
# 2. DEAL DOCUMENTS — /api/deals/<id>/docs (attach any file)
# ==========================================================

@entities_extras_bp.route('/api/deals/<deal_id>/docs', methods=['GET'])
@login_required
def deal_docs_list(deal_id):
    try:
        with db.connect_raw(DB_FILE) as conn:
            rows = conn.execute(
                "SELECT id, file_url, filename, doc_kind, size_bytes, "
                "uploaded_by, uploaded_at, note "
                "FROM deal_documents WHERE deal_id=? ORDER BY uploaded_at DESC",
                (deal_id,)
            ).fetchall()
    except sqlite3.OperationalError as e:
        return jsonify({'error': str(e)[:200]}), 500
    return jsonify({
        'deal_id': deal_id,
        'documents': [{
            'id': r[0], 'file_url': r[1], 'filename': r[2], 'doc_kind': r[3],
            'size_bytes': r[4], 'uploaded_by': r[5], 'uploaded_at': r[6],
            'note': r[7]
        } for r in rows]
    })


@entities_extras_bp.route('/api/deals/<deal_id>/docs', methods=['POST'])
@login_required
def deal_docs_attach(deal_id):
    """Attach a file (already uploaded elsewhere) to a deal.
    Body: {file_url, filename, doc_kind?, size_bytes?, note?}"""
    body = request.get_json(silent=True) or {}
    file_url = str(body.get('file_url') or '').strip()
    filename = str(body.get('filename') or '').strip()
    if not file_url or not filename:
        return jsonify({'error': 'file_url_and_filename_required'}), 400
    doc_kind = str(body.get('doc_kind') or 'other').strip().lower()[:40]
    size_bytes = int(body.get('size_bytes') or 0)
    note = str(body.get('note') or '').strip()[:500]
    did = str(uuid.uuid4())
    try:
        with db.connect_raw(DB_FILE) as conn:
            # Verifikuj da deal postoji
            r = conn.execute("SELECT 1 FROM deals WHERE id=?", (deal_id,)).fetchone()
            if not r:
                return jsonify({'error': 'deal_not_found'}), 404
            conn.execute(
                "INSERT INTO deal_documents (id, deal_id, file_url, filename, doc_kind, "
                "size_bytes, uploaded_by, uploaded_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (did, deal_id, file_url, filename[:200], doc_kind, size_bytes,
                 session.get('username') or 'system', _iso_now(), note)
            )
    except sqlite3.OperationalError as e:
        return jsonify({'error': str(e)[:200]}), 500
    log_audit('CREATE', 'deal_documents',
              f'Attached "{filename}" ({doc_kind}) to deal {deal_id}')
    return jsonify({'id': did, 'ok': True})


@entities_extras_bp.route('/api/deals/docs/<doc_id>', methods=['DELETE'])
@login_required
def deal_docs_detach(doc_id):
    try:
        with db.connect_raw(DB_FILE) as conn:
            n = conn.execute("DELETE FROM deal_documents WHERE id=?", (doc_id,)).rowcount
    except sqlite3.OperationalError as e:
        return jsonify({'error': str(e)[:200]}), 500
    return jsonify({'deleted': n})


# ==========================================================
# 3. LOW-STOCK ALERTS — /api/inventory/low-stock
# ==========================================================

@entities_extras_bp.route('/api/inventory/low-stock', methods=['GET'])
@login_required
def inventory_low_stock():
    """Vraca sve (partner_id, product_id) parove gde je qty_free <= threshold.
    Default threshold=0 (samo out-of-stock)."""
    try:
        threshold = float(request.args.get('threshold', 0))
    except ValueError:
        threshold = 0
    try:
        with db.connect_raw(DB_FILE) as conn:
            rows = conn.execute(
                "SELECT id, partner_id, product_id, qty_on_hand, qty_reserved, unit, last_movement_at "
                "FROM partner_inventory "
                "WHERE (qty_on_hand - qty_reserved) <= ? "
                "ORDER BY (qty_on_hand - qty_reserved) ASC, last_movement_at DESC LIMIT 500",
                (threshold,)
            ).fetchall()
    except sqlite3.OperationalError as e:
        return jsonify({'error': str(e)[:200]}), 500

    # Enrich sa partner + product names
    items = []
    with db.connect_raw(DB_FILE) as conn:
        for r in rows:
            partner_name = None; product_name = None
            try:
                pr = conn.execute("SELECT data FROM partners WHERE id=?", (r[1],)).fetchone()
                if pr and pr[0]:
                    d = decrypt_data(pr[0]) or {}
                    partner_name = d.get('companyName') if isinstance(d, dict) else None
            except Exception: pass
            try:
                pd = conn.execute("SELECT data FROM products WHERE id=?", (r[2],)).fetchone()
                if pd and pd[0]:
                    d = decrypt_data(pd[0]) or {}
                    product_name = d.get('name') if isinstance(d, dict) else None
            except Exception: pass
            free = float(r[3] or 0) - float(r[4] or 0)
            items.append({
                'id': r[0], 'partner_id': r[1], 'partner_name': partner_name,
                'product_id': r[2], 'product_name': product_name,
                'qty_on_hand': float(r[3] or 0), 'qty_reserved': float(r[4] or 0),
                'qty_free': free, 'unit': r[5], 'last_movement_at': r[6],
                'severity': 'critical' if free <= 0 else ('warning' if free <= threshold/2 else 'notice'),
            })
    return jsonify({'items': items, 'total': len(items), 'threshold': threshold})


# ==========================================================
# 4. AUDIT LOG CSV EXPORT — /api/audit/export.csv
# ==========================================================

@entities_extras_bp.route('/api/audit/export.csv', methods=['GET'])
@login_required
def audit_export_csv():
    """Preuzmi audit_log kao CSV. Admin only. Filter po datumu (from/to)."""
    if session.get('role') != 'admin':
        return jsonify({'error': 'Admin only.'}), 403
    from config import AUDIT_DB_FILE
    date_from = (request.args.get('from') or '').strip()
    date_to = (request.args.get('to') or '').strip()

    q = "SELECT timestamp, action, module, username, details, ip_address, is_suspicious FROM audit_log"
    conds = []; params = []
    if date_from:
        conds.append("timestamp >= ?"); params.append(date_from)
    if date_to:
        conds.append("timestamp <= ?"); params.append(date_to)
    if conds:
        q += " WHERE " + " AND ".join(conds)
    q += " ORDER BY timestamp DESC LIMIT 100000"

    try:
        conn = db.connect_raw(AUDIT_DB_FILE)
        rows = conn.execute(q, tuple(params)).fetchall()
        conn.close()
    except sqlite3.OperationalError as e:
        return jsonify({'error': str(e)[:200]}), 500

    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)
    w.writerow(['timestamp', 'action', 'module', 'username', 'details', 'ip_address', 'is_suspicious'])
    for r in rows:
        w.writerow([r[0], r[1], r[2], r[3], (r[4] or '')[:500], r[5], 1 if r[6] else 0])

    log_audit('READ', 'audit', f'CSV export by {session.get("username")}: {len(rows)} rows',
              is_suspicious=False)

    return Response(
        buf.getvalue(),
        mimetype='text/csv',
        headers={
            'Content-Disposition': f'attachment; filename="audit-log-{_iso_now()[:10]}.csv"'
        }
    )


# ==========================================================
# 5. XLSX OFFER EXPORT — /api/offers/<id>/export.xlsx
# ==========================================================
# openpyxl je optional — ako fali, vraca CSV kao fallback

@entities_extras_bp.route('/api/offers/<offer_id>/export.xlsx', methods=['GET'])
@login_required
def offer_export_xlsx(offer_id):
    conn = db.connect_raw(DB_FILE)
    try:
        r = conn.execute("SELECT data FROM offers WHERE id=?", (offer_id,)).fetchone()
        if not r:
            return jsonify({'error': 'offer_not_found'}), 404
        try: offer = decrypt_data(r[0]) if r[0] else {}
        except Exception: offer = {}
    finally:
        conn.close()

    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment
    except ImportError:
        # Fallback: CSV export
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(['Offer', offer.get('offerNo', offer_id)])
        w.writerow([])
        w.writerow(['#', 'Product', 'Qty', 'Unit', 'Unit Price', 'Total'])
        for i, item in enumerate(offer.get('items', []) or [], 1):
            w.writerow([
                i, item.get('name', ''),
                item.get('quantity', 0), item.get('unit', ''),
                item.get('unitPrice', 0),
                (item.get('quantity', 0) or 0) * (item.get('unitPrice', 0) or 0),
            ])
        return Response(
            buf.getvalue(), mimetype='text/csv',
            headers={'Content-Disposition': f'attachment; filename="offer-{offer.get("offerNo", offer_id)}.csv"'}
        )

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = f'Offer {offer.get("offerNo", offer_id)[:20]}'
    # Header
    ws['A1'] = 'Aspidus — Offer'; ws['A1'].font = Font(size=16, bold=True)
    ws['A3'] = 'Offer No:'; ws['B3'] = offer.get('offerNo', '')
    ws['A4'] = 'Date:';     ws['B4'] = offer.get('date', offer.get('createdAt', ''))
    ws['A5'] = 'Customer:'; ws['B5'] = offer.get('customerName', '')
    ws['A6'] = 'Currency:'; ws['B6'] = offer.get('currency', 'USD')

    # Items table
    headers = ['#', 'Product', 'Description', 'Qty', 'Unit', 'Unit Price', 'Total']
    row = 8
    for col, h in enumerate(headers, 1):
        cell = ws.cell(row=row, column=col, value=h)
        cell.font = Font(bold=True, color='FFFFFF')
        cell.fill = PatternFill(start_color='4F46E5', end_color='4F46E5', fill_type='solid')
        cell.alignment = Alignment(horizontal='center')

    grand_total = 0
    for i, item in enumerate(offer.get('items', []) or [], 1):
        row += 1
        qty = float(item.get('quantity', 0) or 0)
        price = float(item.get('unitPrice', 0) or 0)
        total = qty * price
        grand_total += total
        ws.cell(row=row, column=1, value=i)
        ws.cell(row=row, column=2, value=item.get('name', ''))
        ws.cell(row=row, column=3, value=item.get('description', ''))
        ws.cell(row=row, column=4, value=qty)
        ws.cell(row=row, column=5, value=item.get('unit', ''))
        ws.cell(row=row, column=6, value=price)
        ws.cell(row=row, column=7, value=total)

    row += 2
    ws.cell(row=row, column=6, value='TOTAL').font = Font(bold=True)
    ws.cell(row=row, column=7, value=grand_total).font = Font(bold=True, size=14)

    # Autosize
    for col in range(1, 8):
        ws.column_dimensions[openpyxl.utils.get_column_letter(col)].width = 18

    out = io.BytesIO()
    wb.save(out)
    out.seek(0)

    return send_file(
        out,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        as_attachment=True,
        download_name=f'offer-{offer.get("offerNo", offer_id)}.xlsx',
    )
