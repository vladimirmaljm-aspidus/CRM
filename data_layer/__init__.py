"""ASPIDUS data-layer facade — pluggable Supabase backend.

Zašto postoji ovo?
==================
Portal domain se seli sa lokalnog SQLite-a na Supabase Postgres. Ali
Supabase se može doseći dvojako:

    1) HTTP (PostgREST) preko supabase-py klijenta — port 443 (HTTPS).
       Radi na SVAKOM hostingu koji dozvoljava HTTPS (npr. PythonAnywhere
       Free plan preko njihovog proxy-ja). Nema arbitrary outbound TCP.

    2) Direktan Postgres (psycopg) — port 5432 (Direct) ili 6543 (Pooler).
       Brže, cleaner SQL. Ali traži hosting koji dozvoljava proizvoljni
       outbound TCP (PythonAnywhere Hacker+, Render, Fly.io, VPS…).

Da ne pišemo kod dva puta, sav portal DB pristup ide kroz ovaj facade.
Backend se bira env varijablom `DB_BACKEND`:

    DB_BACKEND=rest       → HTTPS preko supabase-py (default, radi svuda)
    DB_BACKEND=postgres   → direktan psycopg (traži TCP outbound)

Prebacivanje je jedan reload web app-a — nula izmena koda.

Interfejs
=========
Facade otkriva minimalan skup funkcija koje SVE portal rute koriste:

    db.select(table, filters=None, columns='*', order=None, limit=None)
    db.select_one(table, filters, columns='*')
    db.insert(table, row) → dict returning inserted row
    db.update(table, filters, patch) → list of updated rows
    db.upsert(table, row, on_conflict='id') → dict returning row
    db.delete(table, filters) → int count deleted
    db.count(table, filters=None) → int
    db.rpc(name, args=None) → whatever the RPC returns

`filters` je uvek dict `{column: value}` sa jednakost-ekvivalencijom, ili
uz operatore preko tuple-a `{"col": ("in", [1,2,3])}`, `{"col": ("gte", 5)}` itd.
Ovako se isto ponaša oba backend-a.

Za slučajeve gde REST ne može (multi-tabelarni JOIN, kompleksni CTE),
napišimo Postgres RPC funkciju (schemas/rpc_functions.sql) i pozovimo je
preko `db.rpc('fn_name', {...})`. Time obe backend implementacije rade.
"""
from __future__ import annotations
import os
import threading

# ==========================================================================
# Backend selection
# ==========================================================================

_DEFAULT_BACKEND = "rest"


def _pick_backend() -> str:
    b = (os.environ.get("DB_BACKEND") or _DEFAULT_BACKEND).strip().lower()
    if b in ("rest", "postgres", "pg"):
        return "postgres" if b == "pg" else b
    raise RuntimeError(
        f"Nepoznat DB_BACKEND='{b}'. Dozvoljeno: 'rest' ili 'postgres'."
    )


_backend_instance = None
_backend_lock = threading.Lock()


def get_backend():
    """Lazy singleton — inicijalizuje backend pri prvom pozivu."""
    global _backend_instance
    if _backend_instance is not None:
        return _backend_instance
    with _backend_lock:
        if _backend_instance is not None:
            return _backend_instance
        name = _pick_backend()
        if name == "rest":
            from ._rest import RestBackend
            _backend_instance = RestBackend()
        else:
            raise RuntimeError("pg backend uklonjen u V22.04.05 - koristi DB_BACKEND=rest")
        return _backend_instance


# ==========================================================================
# Public API — svi ovi delegiraju backend-u
# ==========================================================================

def select(table, filters=None, columns="*", order=None, limit=None):
    """SELECT sa filterom. Vraća listu dictova.

    filters: dict {col: value} za eq, ili {col: (op, value)} za druge.
             Podržani op-ovi: 'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
             'like', 'ilike', 'in', 'is'.
    order:   string 'col' za ASC, '-col' za DESC, ili lista tih stringova.
    limit:   int max broj redova.
    """
    return get_backend().select(table, filters, columns, order, limit)


def select_one(table, filters, columns="*"):
    """Vraća prvi red koji zadovoljava filter, ili None."""
    return get_backend().select_one(table, filters, columns)


def insert(table, row):
    """INSERT — vraća upisani red (sa id-om ako je auto-generisan)."""
    return get_backend().insert(table, row)


def update(table, filters, patch):
    """UPDATE — vraća listu ažuriranih redova."""
    return get_backend().update(table, filters, patch)


def upsert(table, row, on_conflict="id"):
    """UPSERT — INSERT ili UPDATE zavisno od on_conflict kolone."""
    return get_backend().upsert(table, row, on_conflict)


def delete(table, filters):
    """DELETE — vraća broj obrisanih redova."""
    return get_backend().delete(table, filters)


def count(table, filters=None):
    """SELECT COUNT(*) sa filterom."""
    return get_backend().count(table, filters)


def rpc(name, args=None):
    """Zovi Postgres RPC funkciju (definisanu u schemas/rpc_functions.sql)."""
    return get_backend().rpc(name, args or {})


def health() -> dict:
    """Health check — koristi se u /api/system/health endpoint-u."""
    b = get_backend()
    try:
        # svaki backend dobija priliku da uradi svoj sanity check
        info = b.health()
        info["backend"] = b.name
        info["ok"] = True
        return info
    except Exception as e:
        return {"backend": getattr(b, "name", "?"), "ok": False, "error": str(e)}


def backend_name() -> str:
    """Vraća ime aktivnog backend-a ('rest' ili 'postgres')."""
    return get_backend().name


def reset():
    """Reset backend singleton — koristi se u testovima ili posle
    dinamičke promene DB_BACKEND flag-a (retko u praksi)."""
    global _backend_instance
    with _backend_lock:
        _backend_instance = None


def get_supabase_client():
    """V23.1 — vraca sirov supabase-py klijent za skripte koje trebaju direktan
    pristup (import_local_db_to_supabase.py, migrate_data_to_supabase.py).
    Radi samo ako je REST backend aktivan."""
    b = get_backend()
    if hasattr(b, 'client'):
        return b.client
    if hasattr(b, '_client'):
        return b._client
    raise RuntimeError('get_supabase_client dostupan samo sa REST backend-om — postavi DB_BACKEND=rest')
