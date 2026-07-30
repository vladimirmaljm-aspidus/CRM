"""Public document verification — /verify/<hash>

Third parties (banks, customs, clients scanning QR) can hit this route
without any auth to check if a document is authentic. We reverse the
deterministic verification hash back to the offer/invoice/proforma/
contract and render a compact page showing key fields + issue date +
matched status.

Never exposes anything beyond what's already on the printed PDF (buyer,
doc number, currency, total, date). No prices per item, no bank details,
no client contact info — only the "public envelope" of the document.
"""
import db
import hashlib
import json
import sqlite3
from datetime import datetime, timezone

from flask import Blueprint, render_template_string, abort

from config import DB_FILE
from utils import log_audit

verify_bp = Blueprint('verify_public', __name__)


def _hash_of(offer_id, offer_no):
    """MORA da bude identična implementaciji u pdf_generator._make_verification_hash."""
    seed = f"{offer_id or ''}|{offer_no or ''}"
    h = hashlib.sha256(seed.encode('utf-8')).hexdigest().upper()
    return f"VER-{h[:12]}-{h[12:20]}"


def _find_document_by_hash(hash_value):
    """Traži hash među offers, invoices (data JSON blobovi). Vraća (kind, data)
    ili (None, None) ako nema poklapanja.

    Ne pretražujemo cele tabele svaki put — čim nađemo, prekidamo. Za 10-100k
    dokumenata ovo je i dalje ms-brzo jer su offer_id + offer_no + docNumber
    kratki stringovi."""
    if not hash_value or not hash_value.startswith('VER-'):
        return (None, None)

    with db.connect_raw(DB_FILE) as conn:
        c = conn.cursor()
        # 1. Offers
        try:
            c.execute("SELECT id, data FROM offers")
            for row in c.fetchall():
                try: obj = json.loads(row[1])
                except Exception: continue
                if _hash_of(row[0], obj.get('offerNo')) == hash_value:
                    return ('offer', obj | {'id': row[0]})
        except Exception:
            pass
        # 2. Deals (mogu imati invoice number generisan iz deal-a)
        try:
            c.execute("SELECT id, data FROM deals")
            for row in c.fetchall():
                try: obj = json.loads(row[1])
                except Exception: continue
                # Deal može biti izvor invoice-a; hash generisan iz deal ID + invoiceNo/contractId
                if _hash_of(row[0], obj.get('invoiceNo')) == hash_value:
                    return ('invoice', obj | {'id': row[0]})
                if _hash_of(row[0], obj.get('contractId')) == hash_value:
                    return ('deal', obj | {'id': row[0]})
        except Exception:
            pass
        # 3. Document register — kanonski broj + entityId
        try:
            c.execute("SELECT docType, docNumber, entityId, issuedAt FROM document_register")
            for row in c.fetchall():
                if _hash_of(row[2], row[1]) == hash_value:
                    return (row[0], {
                        'docNumber': row[1],
                        'entityId': row[2],
                        'issuedAt': row[3],
                    })
        except Exception:
            pass
    return (None, None)


_PAGE = """<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Document Verification — {{ hash_value }}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
        min-height: 100vh; margin: 0; padding: 40px 20px; }
    .card { max-width: 620px; margin: 0 auto; background: #fff;
        border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,.08);
        padding: 40px; }
    .head { text-align: center; padding-bottom: 24px; border-bottom: 1px solid #e2e8f0; margin-bottom: 24px; }
    .status-ok { color: #059669; font-size: 44px; font-weight: 900; margin: 0; }
    .status-fail { color: #dc2626; font-size: 44px; font-weight: 900; margin: 0; }
    .sub { color: #64748b; font-size: 14px; margin-top: 8px; }
    .kv { display: grid; grid-template-columns: 1fr 2fr; gap: 12px 16px; }
    .k { color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; font-weight: 700; }
    .v { color: #0f172a; font-size: 14px; font-weight: 600; word-break: break-word; }
    .hash { font-family: monospace; background: #f1f5f9; padding: 8px 12px; border-radius: 6px; font-size: 12px; word-break: break-all; }
    .foot { margin-top: 30px; text-align: center; font-size: 11px; color: #94a3b8; }
</style></head><body>
<div class="card">
    {% if found %}
    <div class="head">
        <div class="status-ok">✓ AUTHENTIC</div>
        <div class="sub">This document is registered in Aspidus CRM and its verification hash matches.</div>
    </div>
    <div class="kv">
        <div class="k">Document type</div>
        <div class="v">{{ kind.upper() }}</div>
        <div class="k">Document number</div>
        <div class="v">{{ data.docNumber or data.offerNo or data.invoiceNo or data.contractId or '—' }}</div>
        <div class="k">Issue date</div>
        <div class="v">{{ data.date or data.createdAt or data.issuedAt or '—' }}</div>
        {% if data.customerId or data.buyerId %}
        <div class="k">Recipient ID</div>
        <div class="v" style="font-family:monospace;font-size:12px;">{{ data.customerId or data.buyerId }}</div>
        {% endif %}
        {% if data.total or data.grandTotal %}
        <div class="k">Total value</div>
        <div class="v">{{ '{:,.2f}'.format(data.grandTotal or data.total) }} {{ data.currency or 'USD' }}</div>
        {% endif %}
        {% if data.status %}
        <div class="k">Status</div>
        <div class="v">{{ data.status }}</div>
        {% endif %}
    </div>
    {% else %}
    <div class="head">
        <div class="status-fail">✗ NOT FOUND</div>
        <div class="sub">No document with this verification hash exists in the register. Either the hash is misread, or the document is not authentic.</div>
    </div>
    {% endif %}
    <div style="margin-top: 24px;">
        <div class="k" style="margin-bottom: 6px;">Verification hash</div>
        <div class="hash">{{ hash_value }}</div>
    </div>
    <div class="foot">
        Verified at {{ now_iso }} — Aspidus CRM public verification service<br>
        This page shows only public envelope data; commercial terms are not exposed.
    </div>
</div>
</body></html>"""


@verify_bp.route('/verify/<hash_value>', methods=['GET'])
def verify_page(hash_value):
    hash_value = (hash_value or '').strip().upper()
    if not hash_value.startswith('VER-') or len(hash_value) > 30:
        abort(404)
    kind, data = _find_document_by_hash(hash_value)
    try:
        log_audit('INFO', 'verify', f"Public verify hit for {hash_value} → {'match' if kind else 'no_match'}")
    except Exception:
        pass
    return render_template_string(
        _PAGE,
        hash_value=hash_value,
        found=bool(kind),
        kind=kind or '',
        data=data or {},
        now_iso=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')[:19],
    )
