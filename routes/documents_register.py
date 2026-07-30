"""
Registar dokumenata — atomsko izdavanje brojeva, prevencija duplikata,
istorija revizija.

Filozofija:
  * Broj dokumenta je resurs koji se REZERVIŠE atomično. Nikad ne
    postoje dva izdata dokumenta sa istim brojem u istoj godini.
  * Kada admin promeni već izdat dokument (npr. korekcija cene posle
    slanja klijentu), SISTEM AUTOMATSKI dodaje suffix -R1, -R2, itd
    i snima punu snapshot kopiju u document_revisions. Original ostaje
    nedirnut u registru sa status='superseded'.
  * Endpointi:
      GET  /api/documents/next_number?docType=offer[&year=YYYY]
      POST /api/documents/issue                — rezerviši broj
      POST /api/documents/revise               — dodaj -Rn reviziju
      GET  /api/documents/history/<docNumber>  — vraća sve revizije
      GET  /api/documents/register?type=offer&year=YYYY
"""
import db
import json
import logging
import sqlite3
import uuid
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request, session

from config import DB_FILE
from utils import login_required, log_audit

logger = logging.getLogger(__name__)

documents_register_bp = Blueprint('documents_register_bp', __name__)


DOC_TYPE_PREFIX = {
    'offer': 'OFF',
    'invoice': 'INV',
    'proforma': 'PRO',
    'contract': 'CNT',
    'delivery_note': 'DN',
    'credit_note': 'CN',
}


def _current_year():
    return datetime.now(timezone.utc).year


def _format_number(prefix, seq, year, revision=0):
    """OFF-042/2026 ili OFF-042/2026-R1 za reviziju."""
    core = f"{prefix}-{seq:03d}/{year}"
    return core if revision <= 0 else f"{core}-R{revision}"


def _get_db():
    con = db.connect_raw(DB_FILE)
    return con


def _next_seq(cur, doc_type, year):
    """Atomsko pronalaženje sledećeg seq broja u datoj godini. Koristi
    max(seq) + 1 unutar transakcije (SQLite locking obezbeđuje serialization).
    Zadrži nu do commit-a → nema race condition-a."""
    row = cur.execute(
        'SELECT COALESCE(MAX(seq), 0) FROM document_register WHERE docType=? AND year=?',
        (doc_type, year)
    ).fetchone()
    return int(row[0]) + 1


# ==========================================================
#  ENDPOINT-i
# ==========================================================

@documents_register_bp.route('/api/documents/next_number', methods=['GET'])
@login_required
def next_number():
    doc_type = (request.args.get('docType') or 'offer').strip().lower()
    if doc_type not in DOC_TYPE_PREFIX:
        return jsonify({'error': 'INVALID_DOC_TYPE',
                        'allowed': list(DOC_TYPE_PREFIX.keys())}), 400
    try:
        year = int(request.args.get('year') or _current_year())
    except ValueError:
        return jsonify({'error': 'INVALID_YEAR'}), 400

    con = _get_db()
    try:
        cur = con.cursor()
        seq = _next_seq(cur, doc_type, year)
    finally:
        con.close()
    number = _format_number(DOC_TYPE_PREFIX[doc_type], seq, year)
    return jsonify({
        'docType': doc_type,
        'year': year,
        'seq': seq,
        'preview': number,
        'note': 'This is a preview only. Number is reserved via POST /api/documents/issue.'
    })


@documents_register_bp.route('/api/documents/issue', methods=['POST'])
@login_required
def issue_number():
    """Atomsko rezervisanje broja. Ako je entityId prosleđen i već ima
    izdat broj za isti (docType, entityId), vraća postojeći umesto novog
    — idempotentno je bezbedno pozvati više puta."""
    p = request.get_json(silent=True) or {}
    doc_type = (p.get('docType') or 'offer').strip().lower()
    if doc_type not in DOC_TYPE_PREFIX:
        return jsonify({'error': 'INVALID_DOC_TYPE'}), 400
    entity_id = p.get('entityId') or None
    try:
        year = int(p.get('year') or _current_year())
    except (TypeError, ValueError):
        return jsonify({'error': 'INVALID_YEAR'}), 400

    con = _get_db()
    try:
        cur = con.cursor()
        # Idempotentno: već izdato za istu entity
        if entity_id:
            existing = cur.execute(
                'SELECT docNumber, seq, revision FROM document_register '
                'WHERE docType=? AND entityId=? AND revision=0',
                (doc_type, entity_id)
            ).fetchone()
            if existing:
                return jsonify({
                    'docNumber': existing[0], 'seq': existing[1],
                    'revision': existing[2], 'year': year, 'status': 'existing'
                })

        seq = _next_seq(cur, doc_type, year)
        number = _format_number(DOC_TYPE_PREFIX[doc_type], seq, year)
        now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        try:
            cur.execute(
                'INSERT INTO document_register '
                '(docType, year, seq, docNumber, entityId, revision, status, issuedAt, issuedBy) '
                'VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)',
                (doc_type, year, seq, number, entity_id, 'active', now,
                 session.get('username') or 'system')
            )
            con.commit()
        except sqlite3.IntegrityError as e:
            # Duplikat UNIQUE(docNumber) → race → pokušaj još jednom
            logger.warning(f'Duplicate docNumber, retrying: {e}')
            seq = _next_seq(cur, doc_type, year)
            number = _format_number(DOC_TYPE_PREFIX[doc_type], seq, year)
            cur.execute(
                'INSERT INTO document_register '
                '(docType, year, seq, docNumber, entityId, revision, status, issuedAt, issuedBy) '
                'VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)',
                (doc_type, year, seq, number, entity_id, 'active', now,
                 session.get('username') or 'system')
            )
            con.commit()

        log_audit('CREATE', 'documents',
                  f'Document number issued: {number} (entity {entity_id})')
        return jsonify({
            'docNumber': number, 'seq': seq, 'revision': 0,
            'year': year, 'status': 'newly_issued'
        })
    finally:
        con.close()


@documents_register_bp.route('/api/documents/revise', methods=['POST'])
@login_required
def revise():
    """Kreira novu reviziju (R1, R2, ...) za već izdat broj. Prosleđuje
    se snapshot celokupnih podataka koji definišu novi sadržaj + reason."""
    p = request.get_json(silent=True) or {}
    base_number = (p.get('docNumber') or '').strip()
    snapshot = p.get('snapshot')
    change_reason = (p.get('changeReason') or '').strip()
    if not base_number or not isinstance(snapshot, dict):
        return jsonify({'error': 'DOC_NUMBER_AND_SNAPSHOT_REQUIRED'}), 400
    if not change_reason:
        return jsonify({'error': 'CHANGE_REASON_REQUIRED',
                        'message': 'Legal requirement — every revision must have a reason.'}), 400

    con = _get_db()
    try:
        cur = con.cursor()
        # Nadji originalnu row
        row = cur.execute(
            'SELECT docType, year, seq, entityId, revision FROM document_register '
            'WHERE docNumber=?', (base_number,)
        ).fetchone()
        if not row:
            return jsonify({'error': 'DOC_NUMBER_NOT_FOUND'}), 404
        doc_type, year, seq, entity_id, cur_rev = row
        # Najveća postojeća revizija za taj docType/year/seq
        max_rev = cur.execute(
            'SELECT COALESCE(MAX(revision), 0) FROM document_register '
            'WHERE docType=? AND year=? AND seq=?', (doc_type, year, seq)
        ).fetchone()[0]
        new_rev = int(max_rev) + 1
        new_number = _format_number(DOC_TYPE_PREFIX[doc_type], seq, year, revision=new_rev)
        now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        username = session.get('username') or 'system'

        # Snimi u register
        cur.execute(
            'INSERT INTO document_register '
            '(docType, year, seq, docNumber, entityId, revision, status, issuedAt, issuedBy) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (doc_type, year, seq, new_number, entity_id, new_rev, 'active', now, username)
        )
        # Označi sve prethodne kao superseded
        cur.execute(
            'UPDATE document_register SET status=? '
            'WHERE docType=? AND year=? AND seq=? AND revision<?',
            ('superseded', doc_type, year, seq, new_rev)
        )
        # Snimi puno snapshot podataka u revisions tabelu
        import hashlib
        binding_seed = json.dumps(snapshot, sort_keys=True, separators=(',', ':')).encode('utf-8')
        binding_hash = hashlib.sha256(binding_seed).hexdigest().upper()
        cur.execute(
            'INSERT INTO document_revisions '
            '(id, docNumber, revision, entityId, snapshot, bindingHash, '
            ' changeReason, changedBy, changedAt) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (str(uuid.uuid4()), new_number, new_rev, entity_id,
             json.dumps(snapshot, ensure_ascii=False), binding_hash,
             change_reason, username, now)
        )
        con.commit()
        log_audit('UPDATE', 'documents',
                  f'Document revised: {base_number} → {new_number} '
                  f'(reason: {change_reason[:80]})')
        return jsonify({
            'docNumber': new_number,
            'previousDocNumber': base_number,
            'revision': new_rev,
            'bindingHash': binding_hash,
            'issuedAt': now,
        })
    finally:
        con.close()


@documents_register_bp.route('/api/documents/history/<path:doc_number>', methods=['GET'])
@login_required
def document_history(doc_number):
    """Vraća sve revizije za dati broj (ili osnovni broj bez -R suffiksa)."""
    # Skini eventualni -Rn suffix da bi dobili base
    base = doc_number.split('-R')[0] if '-R' in doc_number else doc_number
    con = _get_db()
    try:
        cur = con.cursor()
        # Nadji tip/god/seq iz base
        core = cur.execute(
            'SELECT docType, year, seq FROM document_register '
            'WHERE docNumber=?', (base,)
        ).fetchone()
        if not core:
            return jsonify({'error': 'DOC_NUMBER_NOT_FOUND'}), 404
        doc_type, year, seq = core
        rows = cur.execute(
            'SELECT docNumber, revision, status, issuedAt, issuedBy, entityId '
            'FROM document_register WHERE docType=? AND year=? AND seq=? '
            'ORDER BY revision ASC', (doc_type, year, seq)
        ).fetchall()
        register_rows = [{
            'docNumber': r[0], 'revision': r[1], 'status': r[2],
            'issuedAt': r[3], 'issuedBy': r[4], 'entityId': r[5],
        } for r in rows]

        rev_rows = cur.execute(
            'SELECT docNumber, revision, snapshot, bindingHash, contentHash, '
            'changeReason, changedBy, changedAt FROM document_revisions '
            'WHERE docNumber IN ({}) ORDER BY revision ASC'.format(
                ','.join('?' * len(register_rows))
            ),
            tuple(r['docNumber'] for r in register_rows)
        ).fetchall() if register_rows else []
        revisions = [{
            'docNumber': r[0], 'revision': r[1],
            'snapshot': json.loads(r[2]) if r[2] else None,
            'bindingHash': r[3], 'contentHash': r[4],
            'changeReason': r[5], 'changedBy': r[6], 'changedAt': r[7],
        } for r in rev_rows]

        return jsonify({
            'baseDocNumber': base,
            'docType': doc_type, 'year': year, 'seq': seq,
            'register': register_rows,
            'revisions': revisions,
            'currentActive': next((r['docNumber'] for r in register_rows
                                   if r['status'] == 'active'), base),
        })
    finally:
        con.close()


@documents_register_bp.route('/api/documents/register', methods=['GET'])
@login_required
def register_list():
    doc_type = (request.args.get('docType') or '').strip().lower()
    year = request.args.get('year')
    limit = min(int(request.args.get('limit') or 200), 1000)

    con = _get_db()
    try:
        cur = con.cursor()
        q = 'SELECT docType, year, seq, docNumber, entityId, revision, status, issuedAt, issuedBy FROM document_register'
        clauses, params = [], []
        if doc_type:
            clauses.append('docType=?')
            params.append(doc_type)
        if year:
            try: clauses.append('year=?'); params.append(int(year))
            except ValueError: pass
        if clauses:
            q += ' WHERE ' + ' AND '.join(clauses)
        q += ' ORDER BY year DESC, seq DESC, revision DESC LIMIT ?'
        params.append(limit)
        rows = cur.execute(q, tuple(params)).fetchall()
    finally:
        con.close()
    return jsonify({
        'items': [{
            'docType': r[0], 'year': r[1], 'seq': r[2],
            'docNumber': r[3], 'entityId': r[4], 'revision': r[5],
            'status': r[6], 'issuedAt': r[7], 'issuedBy': r[8]
        } for r in rows]
    })


# ==========================================================
#  FAZA 4: Per-deal quick-issue endpoint
# ==========================================================
# Convenience wrapper koji iz UI-ja (deal edit forma) rezervise sledeci broj
# za dati docType i vezuje ga za deal.id kao entityId. Idempotentno je - ako
# je vec izdat aktivni broj za taj (docType, dealId), vraca postojeci.
#
# POST /api/deals/<deal_id>/issue-document
# Body: { "docType": "proforma" | "contract" | "delivery_note" | "credit_note" }

@documents_register_bp.route('/api/deals/<deal_id>/issue-document', methods=['POST'])
@login_required
def issue_document_for_deal(deal_id):
    if not deal_id:
        return jsonify({'error': 'DEAL_ID_REQUIRED'}), 400
    p = request.get_json(silent=True) or {}
    doc_type = (p.get('docType') or '').strip().lower()
    if doc_type not in DOC_TYPE_PREFIX:
        return jsonify({'error': 'INVALID_DOC_TYPE',
                        'allowed': list(DOC_TYPE_PREFIX.keys())}), 400

    year = _current_year()
    con = _get_db()
    try:
        cur = con.cursor()
        # 1) Verifikuj da deal stvarno postoji (spreci pravljenje broja za tudju entity)
        row = cur.execute("SELECT 1 FROM deals WHERE id=?", (deal_id,)).fetchone()
        if not row:
            return jsonify({'error': 'DEAL_NOT_FOUND'}), 404

        # 2) Idempotentno: postojeci aktivan broj za (docType, dealId)?
        existing = cur.execute(
            'SELECT docNumber, seq, revision, issuedAt, issuedBy '
            'FROM document_register '
            'WHERE docType=? AND entityId=? AND revision=0',
            (doc_type, deal_id)
        ).fetchone()
        if existing:
            return jsonify({
                'docNumber': existing[0],
                'seq': existing[1],
                'revision': existing[2],
                'issuedAt': existing[3],
                'issuedBy': existing[4],
                'year': year,
                'status': 'existing'
            })

        # 3) Rezervisi novi seq atomicno
        seq = _next_seq(cur, doc_type, year)
        number = _format_number(DOC_TYPE_PREFIX[doc_type], seq, year)
        now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        username = session.get('username') or 'system'
        try:
            cur.execute(
                'INSERT INTO document_register '
                '(docType, year, seq, docNumber, entityId, revision, status, issuedAt, issuedBy) '
                'VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)',
                (doc_type, year, seq, number, deal_id, 'active', now, username)
            )
            con.commit()
        except sqlite3.IntegrityError as e:
            # Race na UNIQUE(docNumber) - probaj jos jednom sa novim seq
            logger.warning(f'Duplicate docNumber for deal {deal_id} {doc_type}: {e}')
            seq = _next_seq(cur, doc_type, year)
            number = _format_number(DOC_TYPE_PREFIX[doc_type], seq, year)
            cur.execute(
                'INSERT INTO document_register '
                '(docType, year, seq, docNumber, entityId, revision, status, issuedAt, issuedBy) '
                'VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)',
                (doc_type, year, seq, number, deal_id, 'active', now, username)
            )
            con.commit()

        log_audit('CREATE', 'documents',
                  f'Deal {deal_id}: issued {doc_type.upper()} → {number}')
        return jsonify({
            'docNumber': number, 'seq': seq, 'revision': 0,
            'year': year, 'issuedAt': now, 'issuedBy': username,
            'status': 'newly_issued'
        })
    finally:
        con.close()


@documents_register_bp.route('/api/deals/<deal_id>/documents', methods=['GET'])
@login_required
def list_deal_documents(deal_id):
    """Vrati sve dokumente izdate za dati deal, sortirano po issuedAt DESC."""
    if not deal_id:
        return jsonify({'error': 'DEAL_ID_REQUIRED'}), 400
    con = _get_db()
    try:
        cur = con.cursor()
        rows = cur.execute(
            'SELECT docType, docNumber, revision, status, issuedAt, issuedBy '
            'FROM document_register WHERE entityId=? '
            'ORDER BY issuedAt DESC, revision DESC',
            (deal_id,)
        ).fetchall()
    finally:
        con.close()
    return jsonify({
        'dealId': deal_id,
        'total': len(rows),
        'documents': [{
            'docType': r[0], 'docNumber': r[1], 'revision': r[2],
            'status': r[3], 'issuedAt': r[4], 'issuedBy': r[5]
        } for r in rows]
    })
