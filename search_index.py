"""SQLite FTS5 unified search — brza globalna pretraga.

Šta radi: gradi jedan FTS5 virtuelni tabela `search_index` koji sadrži
tekst iz svih pretraživih entiteta (partneri, proizvodi, dilovi, ponude,
dokumenti). Poziv `search(query, limit=20)` vraća listu match-eva
rangovanih po BM25 relevance-u.

Zašto FTS5:
  - Podržava tokenizaciju, prefix-match (npr. "aspi*" → aspidus)
  - Ranker BM25 daje bolje rezultate od LIKE '%...%'
  - 10x-100x brže od LIKE nad većim setovima podataka (>10k entiteta)
  - Već je uključeno u standardnu Python distribuciju (compile-time flag)

Sinhronizacija: rebuild_index() briše i ponovo puni index iz izvornih
tabela. Poziva se:
  - Ručno preko admin dugmeta (Settings → Diagnostics → Rebuild search)
  - Automatski jednom dnevno preko housekeeping thread-a
  - Nakon batch import-a (CSV/XLSX partnera/proizvoda)
"""
import db
import json
import logging
import sqlite3
from typing import List, Dict

from config import DB_FILE

logger = logging.getLogger(__name__)


_SCHEMA = """
CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    entity_type UNINDEXED,       -- 'partner' | 'product' | 'deal' | 'offer' | 'document'
    entity_id   UNINDEXED,       -- ID zapisa za dubinski link
    title,                       -- glavno ime (npr. companyName, product.name)
    body,                        -- konkatenacija svih pretraživih polja
    tokenize = 'porter unicode61'
);
"""


def _get_conn():
    conn = db.connect_raw(DB_FILE)
    return conn


def _ensure_schema():
    with _get_conn() as conn:
        conn.executescript(_SCHEMA)
        conn.commit()


def rebuild_index() -> Dict:
    """Bris + ponovo puni ceo index iz izvornih tabela.
    Traje ~1-3s za 5000 entiteta. Vraća dictionary sa brojem indeksovanih
    zapisa po entity_type-u."""
    _ensure_schema()
    counts = {'partner': 0, 'product': 0, 'deal': 0, 'offer': 0, 'document': 0}

    with _get_conn() as conn:
        conn.execute('DELETE FROM search_index')

        # Podaci žive u pojedinačnim tabelama (partners, products, deals, offers)
        # gde je svaki red (id TEXT PRIMARY KEY, data TEXT) — JSON payload u data.
        data = {}
        for table in ('partners', 'products', 'deals', 'offers'):
            data[table] = []
            try:
                rows = conn.execute(f'SELECT data FROM {table}').fetchall()
                for (raw,) in rows:
                    if not raw: continue
                    try:
                        data[table].append(json.loads(raw))
                    except Exception:
                        continue
            except sqlite3.OperationalError:
                # tabela ne postoji u ovoj instanci
                pass

        for p in (data.get('partners') or []):
            pid = p.get('id')
            if not pid: continue
            title = p.get('companyName', '')
            body_parts = [
                p.get('taxId', ''), p.get('regNumber', ''),
                (p.get('address') or {}).get('city', ''),
                (p.get('address') or {}).get('country', ''),
                (p.get('contact') or {}).get('person', ''),
                (p.get('contact') or {}).get('email', ''),
                (p.get('bank') or {}).get('accountNumber', ''),
                p.get('notes', ''),
                ' '.join(p.get('types') or []),
            ]
            body = ' '.join([str(x) for x in body_parts if x])
            conn.execute("INSERT INTO search_index (entity_type, entity_id, title, body) VALUES ('partner', ?, ?, ?)",
                         (pid, title, body))
            counts['partner'] += 1

        for pr in (data.get('products') or []):
            prid = pr.get('id')
            if not prid: continue
            title = pr.get('name', '')
            body_parts = [
                pr.get('category', ''), pr.get('hsCode', ''),
                pr.get('sku', ''), pr.get('brand', ''),
                pr.get('casNumber', ''), pr.get('description', ''),
                pr.get('detailedSpec', ''),
            ]
            body = ' '.join([str(x) for x in body_parts if x])
            conn.execute("INSERT INTO search_index (entity_type, entity_id, title, body) VALUES ('product', ?, ?, ?)",
                         (prid, title, body))
            counts['product'] += 1

        for d in (data.get('deals') or []):
            did = d.get('id')
            if not did: continue
            title = f"{d.get('contractId', '')} — {d.get('productName', '')}"
            body_parts = [d.get('supplierName', ''), d.get('buyerName', ''),
                          d.get('status', ''), d.get('remarks', '')]
            body = ' '.join([str(x) for x in body_parts if x])
            conn.execute("INSERT INTO search_index (entity_type, entity_id, title, body) VALUES ('deal', ?, ?, ?)",
                         (did, title, body))
            counts['deal'] += 1

        for o in (data.get('offers') or []):
            oid = o.get('id')
            if not oid: continue
            title = f"{o.get('offerNo', '')} — {o.get('productName', '')}"
            body_parts = [o.get('buyerName', ''), o.get('status', ''), o.get('notes', '')]
            body = ' '.join([str(x) for x in body_parts if x])
            conn.execute("INSERT INTO search_index (entity_type, entity_id, title, body) VALUES ('offer', ?, ?, ?)",
                         (oid, title, body))
            counts['offer'] += 1

        # Documents: iz document_register tabele ako postoji
        try:
            docs = conn.execute("SELECT id, doc_type, doc_no, partner_name, hash_value FROM document_register").fetchall()
            for did, dtype, dno, pname, dh in docs:
                title = f"{dtype} {dno}"
                body = f"{pname or ''} {dh or ''}"
                conn.execute("INSERT INTO search_index (entity_type, entity_id, title, body) VALUES ('document', ?, ?, ?)",
                             (str(did), title, body))
                counts['document'] += 1
        except sqlite3.OperationalError:
            pass  # document_register tabela ne postoji u toj instanci

        conn.commit()

    logger.info(f'search_index rebuilt: {counts}')
    return counts


def search(query: str, limit: int = 20, entity_types: List[str] = None) -> List[Dict]:
    """Pretraži svih entiteta. FTS5 sintaksa je podržana:
        "aspidus"       — match token
        "aspi*"         — prefix
        "term1 term2"   — implicit AND
        "term1 OR term2" — eksplicit OR
    Vraća listu {entity_type, entity_id, title, snippet, rank}."""
    _ensure_schema()
    query = (query or '').strip()
    if not query:
        return []

    # FTS5 traži da sanitize-ujemo — dodajemo "*" na kraj da omogući prefix match
    # ako korisnik nije uneo eksplicitne operatore.
    safe = query.replace('"', ' ').replace("'", ' ').strip()
    if not any(op in safe for op in ('*', ' AND ', ' OR ', ' NOT ')):
        # split u tokene i dodaj prefix wildcard na svaki (osim ako je već tu)
        tokens = [t for t in safe.split() if t]
        safe = ' '.join(t if t.endswith('*') else (t + '*') for t in tokens)
    if not safe:
        return []

    sql = """
        SELECT entity_type, entity_id, title,
               snippet(search_index, 3, '[', ']', '…', 12) AS snip,
               rank
        FROM search_index
        WHERE search_index MATCH ?
    """
    params = [safe]
    if entity_types:
        placeholders = ','.join(['?'] * len(entity_types))
        sql += f' AND entity_type IN ({placeholders})'
        params.extend(entity_types)
    sql += ' ORDER BY rank LIMIT ?'
    params.append(int(limit))

    try:
        with _get_conn() as conn:
            rows = conn.execute(sql, params).fetchall()
    except sqlite3.OperationalError as e:
        logger.warning(f'search FTS5 error: {e}')
        return []

    return [
        {'entity_type': r[0], 'entity_id': r[1], 'title': r[2], 'snippet': r[3], 'rank': r[4]}
        for r in rows
    ]


def index_stats() -> Dict:
    """Vraća broj indeksovanih zapisa po tipu i ukupno."""
    _ensure_schema()
    try:
        with _get_conn() as conn:
            rows = conn.execute(
                "SELECT entity_type, COUNT(*) FROM search_index GROUP BY entity_type"
            ).fetchall()
            total = conn.execute("SELECT COUNT(*) FROM search_index").fetchone()[0]
        return {'by_type': dict(rows), 'total': total}
    except Exception as e:
        return {'error': str(e), 'total': 0}
