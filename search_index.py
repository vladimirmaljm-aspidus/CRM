"""PostgreSQL tsvector unified search — brza globalna pretraga.

Šta radi: održava jednu tabelu `search_index` sa tsvector kolonom za
full-text pretragu preko svih entiteta (partneri, proizvodi, dilovi,
ponude, dokumenti). Poziv `search(query, limit=20)` vraća listu match-eva
rangovanih po ts_rank relevance-u.

Zašto tsvector + GIN:
  - PostgreSQL native full-text search (zamenjuje SQLite FTS5)
  - Podržava prefix-match (npr. "aspi:*" → aspidus) preko to_tsquery
  - ts_rank daje relevantnost
  - GIN index daje 10x-100x brže pretrage od LIKE '%...%'
  - ts_headline automatski highlight-uje match

Sinhronizacija: rebuild_index() briše i ponovo puni index iz izvornih
tabela. Poziva se:
  - Ručno preko admin dugmeta (Settings → Diagnostics → Rebuild search)
  - Automatski jednom dnevno preko housekeeping thread-a
  - Nakon batch import-a (CSV/XLSX partnera/proizvoda)
"""
import db
import json
import logging
from typing import List, Dict

from config import DB_FILE

logger = logging.getLogger(__name__)


def _get_conn():
    conn = db.connect_raw(DB_FILE)
    return conn


def _to_tsvector_expr():
    """Vraća SQL izraz koji pravi tsvector iz title + body kolona."""
    return "to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, ''))"


def _ensure_schema():
    """Kreira tabelu i GIN index ako ne postoje. Idempotentno."""
    with _get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS search_index (
                id SERIAL PRIMARY KEY,
                entity_type TEXT NOT NULL,
                entity_id   TEXT NOT NULL,
                title       TEXT,
                body        TEXT,
                tsv         tsvector
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS search_index_tsv_idx
            ON search_index USING GIN(tsv)
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS search_index_entity_type_idx
            ON search_index(entity_type)
        """)
        conn.commit()


def rebuild_index() -> Dict:
    """Bris + ponovo puni ceo index iz izvornih tabela.
    Traje ~1-3s za 5000 entiteta. Vraća dictionary sa brojem indeksovanih
    zapisa po entity_type-u."""
    _ensure_schema()
    counts = {'partner': 0, 'product': 0, 'deal': 0, 'offer': 0, 'document': 0}

    with _get_conn() as conn:
        conn.execute('DELETE FROM search_index')

        # Reset SERIAL sequence posle DELETE-a
        try:
            conn.execute("SELECT setval(pg_get_serial_sequence('search_index', 'id'), 1, false)")
        except Exception:
            pass

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
            except db.OperationalError:
                # tabela ne postoji u ovoj instanci
                pass

        tsv_expr = _to_tsvector_expr()

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
            conn.execute(
                f"INSERT INTO search_index (entity_type, entity_id, title, body, tsv) "
                f"VALUES ('partner', ?, ?, ?, {tsv_expr})",
                (pid, title, body)
            )
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
            conn.execute(
                f"INSERT INTO search_index (entity_type, entity_id, title, body, tsv) "
                f"VALUES ('product', ?, ?, ?, {tsv_expr})",
                (prid, title, body)
            )
            counts['product'] += 1

        for d in (data.get('deals') or []):
            did = d.get('id')
            if not did: continue
            title = f"{d.get('contractId', '')} — {d.get('productName', '')}"
            body_parts = [d.get('supplierName', ''), d.get('buyerName', ''),
                          d.get('status', ''), d.get('remarks', '')]
            body = ' '.join([str(x) for x in body_parts if x])
            conn.execute(
                f"INSERT INTO search_index (entity_type, entity_id, title, body, tsv) "
                f"VALUES ('deal', ?, ?, ?, {tsv_expr})",
                (did, title, body)
            )
            counts['deal'] += 1

        for o in (data.get('offers') or []):
            oid = o.get('id')
            if not oid: continue
            title = f"{o.get('offerNo', '')} — {o.get('productName', '')}"
            body_parts = [o.get('buyerName', ''), o.get('status', ''), o.get('notes', '')]
            body = ' '.join([str(x) for x in body_parts if x])
            conn.execute(
                f"INSERT INTO search_index (entity_type, entity_id, title, body, tsv) "
                f"VALUES ('offer', ?, ?, ?, {tsv_expr})",
                (oid, title, body)
            )
            counts['offer'] += 1

        # Documents: iz document_register tabele ako postoji
        try:
            docs = conn.execute(
                "SELECT id, doc_type, doc_no, partner_name, hash_value FROM document_register"
            ).fetchall()
            for did, dtype, dno, pname, dh in docs:
                title = f"{dtype} {dno}"
                body = f"{pname or ''} {dh or ''}"
                conn.execute(
                    f"INSERT INTO search_index (entity_type, entity_id, title, body, tsv) "
                    f"VALUES ('document', ?, ?, ?, {tsv_expr})",
                    (str(did), title, body)
                )
                counts['document'] += 1
        except db.OperationalError:
            pass  # document_register tabela ne postoji u toj instanci

        conn.commit()

    logger.info(f'search_index rebuilt: {counts}')
    return counts


def search(query: str, limit: int = 20, entity_types: List[str] = None) -> List[Dict]:
    """Pretraži sve entitete. Podržava:
        "aspidus"       — match token (sa prefix match)
        "aspi"          — prefix match (aspi:* → aspidus, aspire, ...)
        "term1 term2"   — implicit AND
    Vraća listu {entity_type, entity_id, title, snippet, rank}."""
    _ensure_schema()
    query = (query or '').strip()
    if not query:
        return []

    # Sanitizuj — ukloni specijalne karaktere koji bi slomili to_tsquery
    safe = query.replace('"', ' ').replace("'", ' ').replace('\\', ' ').strip()
    tokens = [t for t in safe.split() if t]
    if not tokens:
        return []

    # Pravi to_tsquery string: "token1:* & token2:*" (prefix match na svakom tokenu)
    tsquery_str = ' & '.join(t + ':*' for t in tokens)

    sql = """
        SELECT entity_type, entity_id, title,
               ts_headline('simple', body, to_tsquery('simple', ?),
                           'StartSel=[ StopSel=] MaxWords=12 MinWords=1 ShortWord=1') AS snip,
               ts_rank(tsv, to_tsquery('simple', ?)) AS rank
        FROM search_index
        WHERE tsv @@ to_tsquery('simple', ?)
    """
    params = [tsquery_str, tsquery_str, tsquery_str]
    if entity_types:
        placeholders = ','.join(['?'] * len(entity_types))
        sql += f' AND entity_type IN ({placeholders})'
        params.extend(entity_types)
    sql += ' ORDER BY rank DESC LIMIT ?'
    params.append(int(limit))

    try:
        with _get_conn() as conn:
            rows = conn.execute(sql, params).fetchall()
    except db.OperationalError as e:
        logger.warning(f'search tsvector error: {e}')
        # Fallback: pokušaj sa plainto_tsquery (bez prefix match-a)
        try:
            fallback_query = ' & '.join(tokens)
            fallback_sql = sql.replace('to_tsquery', 'plainto_tsquery')
            fallback_params = [fallback_query, fallback_query, fallback_query] + params[3:]
            with _get_conn() as conn:
                rows = conn.execute(fallback_sql, fallback_params).fetchall()
        except Exception as e2:
            logger.warning(f'search fallback error: {e2}')
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
        return {'by_type': {r[0]: r[1] for r in rows}, 'total': total}
    except Exception as e:
        return {'error': str(e), 'total': 0}
