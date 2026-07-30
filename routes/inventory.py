"""
FAZA 5 — PER-PARTNER INVENTORY

Tracks stock per (partner, product) with append-only movements audit trail.
Every IN / OUT / ADJUST / RESERVE / RELEASE creates one row in
`inventory_movements` and idempotently updates the aggregated row in
`partner_inventory` inside the same SQL transaction.

Public endpoints:
  GET  /api/partners/<partner_id>/inventory            — current stock list
  POST /api/partners/<partner_id>/inventory/movements  — post a movement
  GET  /api/partners/<partner_id>/inventory/movements  — history
"""
from __future__ import annotations
import db

import logging
import sqlite3
import uuid
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request, session

from config import DB_FILE
from utils import login_required, log_audit

logger = logging.getLogger(__name__)

inventory_bp = Blueprint('inventory_bp', __name__)


VALID_KINDS = {"IN", "OUT", "ADJUST", "RESERVE", "RELEASE"}


def _get_db():
    con = db.connect_raw(DB_FILE)
    return con


def _now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def _apply_movement(cur, partner_id, product_id, kind, qty, unit):
    """Idempotentno update-uj partner_inventory red za dati (partner, product).

    Racuna:
      IN       → qty_on_hand += qty
      OUT      → qty_on_hand -= qty
      ADJUST   → qty_on_hand  = qty  (postavi absolutno)
      RESERVE  → qty_reserved += qty
      RELEASE  → qty_reserved -= qty

    Vraca (qty_on_hand, qty_reserved) posle primene.
    """
    row = cur.execute(
        "SELECT id, qty_on_hand, qty_reserved FROM partner_inventory "
        "WHERE partner_id=? AND product_id=?",
        (partner_id, product_id)
    ).fetchone()

    now = _now_iso()

    if row is None:
        # Prvi movement — kreiraj row
        on_hand, reserved = 0.0, 0.0
    else:
        on_hand, reserved = float(row[1] or 0), float(row[2] or 0)

    if kind == "IN":
        on_hand += float(qty)
    elif kind == "OUT":
        on_hand -= float(qty)
    elif kind == "ADJUST":
        on_hand = float(qty)
    elif kind == "RESERVE":
        reserved += float(qty)
    elif kind == "RELEASE":
        reserved -= float(qty)
    else:
        raise ValueError(f"Unknown kind: {kind}")

    if row is None:
        cur.execute(
            "INSERT INTO partner_inventory "
            "(id, partner_id, product_id, qty_on_hand, qty_reserved, unit, last_movement_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), partner_id, product_id, on_hand, reserved, unit or '', now)
        )
    else:
        cur.execute(
            "UPDATE partner_inventory SET qty_on_hand=?, qty_reserved=?, "
            "unit=COALESCE(NULLIF(?, ''), unit), last_movement_at=? WHERE id=?",
            (on_hand, reserved, unit or '', now, row[0])
        )
    return on_hand, reserved


@inventory_bp.route('/api/partners/<partner_id>/inventory', methods=['GET'])
@login_required
def list_partner_inventory(partner_id):
    """Sadasnje stanje po proizvodu za datog partnera."""
    if not partner_id:
        return jsonify({'error': 'PARTNER_ID_REQUIRED'}), 400
    con = _get_db()
    try:
        cur = con.cursor()
        rows = cur.execute(
            "SELECT id, product_id, qty_on_hand, qty_reserved, unit, last_movement_at "
            "FROM partner_inventory WHERE partner_id=? "
            "ORDER BY last_movement_at DESC",
            (partner_id,)
        ).fetchall()
    finally:
        con.close()

    return jsonify({
        'partnerId': partner_id,
        'total': len(rows),
        'items': [{
            'id': r[0], 'productId': r[1],
            'qtyOnHand': float(r[2] or 0), 'qtyReserved': float(r[3] or 0),
            'qtyFree': float(r[2] or 0) - float(r[3] or 0),
            'unit': r[4] or '', 'lastMovementAt': r[5]
        } for r in rows]
    })


@inventory_bp.route('/api/partners/<partner_id>/inventory/movements', methods=['POST'])
@login_required
def post_movement(partner_id):
    """Registruj IN/OUT/ADJUST/RESERVE/RELEASE za dati (partner, product).

    Body:
      product_id  (required)
      kind        (required) — IN | OUT | ADJUST | RESERVE | RELEASE
      qty         (required, > 0 for non-ADJUST; ADJUST prihvata 0+)
      unit        (optional)
      deal_id     (optional — za traceability)
      note        (optional)
    """
    if not partner_id:
        return jsonify({'error': 'PARTNER_ID_REQUIRED'}), 400
    p = request.get_json(silent=True) or {}
    product_id = str(p.get('product_id') or '').strip()
    kind = str(p.get('kind') or '').strip().upper()
    try:
        qty = float(p.get('qty', 0))
    except (TypeError, ValueError):
        return jsonify({'error': 'INVALID_QTY'}), 400

    if not product_id:
        return jsonify({'error': 'PRODUCT_ID_REQUIRED'}), 400
    if kind not in VALID_KINDS:
        return jsonify({'error': 'INVALID_KIND',
                        'allowed': sorted(VALID_KINDS)}), 400
    if kind != 'ADJUST' and qty <= 0:
        return jsonify({'error': 'QTY_MUST_BE_POSITIVE'}), 400
    if kind == 'ADJUST' and qty < 0:
        return jsonify({'error': 'ADJUST_QTY_MUST_BE_NON_NEGATIVE'}), 400

    unit = str(p.get('unit') or '').strip()
    deal_id = str(p.get('deal_id') or '').strip() or None
    note = str(p.get('note') or '').strip() or None
    username = session.get('username') or 'system'

    con = _get_db()
    try:
        cur = con.cursor()
        # Provera da partner postoji
        pex = cur.execute("SELECT 1 FROM partners WHERE id=?", (partner_id,)).fetchone()
        if not pex:
            return jsonify({'error': 'PARTNER_NOT_FOUND'}), 404
        # Provera da product postoji
        prx = cur.execute("SELECT 1 FROM products WHERE id=?", (product_id,)).fetchone()
        if not prx:
            return jsonify({'error': 'PRODUCT_NOT_FOUND'}), 404
        # Opciona deal validacija
        if deal_id:
            dex = cur.execute("SELECT 1 FROM deals WHERE id=?", (deal_id,)).fetchone()
            if not dex:
                return jsonify({'error': 'DEAL_NOT_FOUND'}), 404

        # 1) Primeni movement (istoj tx)
        on_hand, reserved = _apply_movement(cur, partner_id, product_id, kind, qty, unit)

        # 2) Upisi u append-only movements
        mov_id = str(uuid.uuid4())
        cur.execute(
            "INSERT INTO inventory_movements "
            "(id, partner_id, product_id, kind, qty, unit, deal_id, note, created_at, created_by) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (mov_id, partner_id, product_id, kind, qty, unit or '', deal_id, note, _now_iso(), username)
        )
        con.commit()

        log_audit('CREATE', 'inventory',
                  f'Partner {partner_id} · product {product_id} · {kind} {qty} {unit or ""} '
                  f'→ on_hand={on_hand} reserved={reserved}'
                  f'{" (deal " + deal_id + ")" if deal_id else ""}')
        return jsonify({
            'movementId': mov_id,
            'partnerId': partner_id, 'productId': product_id,
            'kind': kind, 'qty': qty, 'unit': unit or '',
            'qtyOnHand': on_hand, 'qtyReserved': reserved,
            'qtyFree': on_hand - reserved,
            'dealId': deal_id, 'note': note,
            'createdAt': _now_iso(), 'createdBy': username,
        })
    except Exception as e:
        con.rollback()
        logger.exception(f'Inventory movement failed for partner {partner_id}')
        return jsonify({'error': 'MOVEMENT_FAILED',
                        'detail': "MOVEMENT_FAILED"}), 500
    finally:
        con.close()


@inventory_bp.route('/api/partners/<partner_id>/inventory/movements', methods=['GET'])
@login_required
def list_movements(partner_id):
    """Istorija movements za datog partnera (opciono filtrirana po product_id / deal_id)."""
    if not partner_id:
        return jsonify({'error': 'PARTNER_ID_REQUIRED'}), 400
    product_id = (request.args.get('product_id') or '').strip()
    deal_id = (request.args.get('deal_id') or '').strip()
    try:
        limit = min(int(request.args.get('limit') or 200), 1000)
    except ValueError:
        limit = 200

    q = ("SELECT id, product_id, kind, qty, unit, deal_id, note, created_at, created_by "
         "FROM inventory_movements WHERE partner_id=?")
    params = [partner_id]
    if product_id:
        q += " AND product_id=?"
        params.append(product_id)
    if deal_id:
        q += " AND deal_id=?"
        params.append(deal_id)
    q += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    con = _get_db()
    try:
        cur = con.cursor()
        rows = cur.execute(q, tuple(params)).fetchall()
    finally:
        con.close()

    return jsonify({
        'partnerId': partner_id,
        'total': len(rows),
        'movements': [{
            'id': r[0], 'productId': r[1], 'kind': r[2],
            'qty': float(r[3] or 0), 'unit': r[4] or '',
            'dealId': r[5], 'note': r[6],
            'createdAt': r[7], 'createdBy': r[8]
        } for r in rows]
    })
