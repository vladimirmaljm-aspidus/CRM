"""REST backend — HTTPS preko supabase-py klijenta (radi na PA Free plan).

Sve DB operacije idu preko PostgREST-a na `https://<project>.supabase.co/rest/v1/`.
Jedini network zahtev je HTTPS/443 koji svaki hosting dozvoljava.

Ograničenja PostgREST-a (i kako ih zaobilazimo):

  * Nema RAW SQL. → za kompleksne upite koristimo RPC funkcije definisane
    u Postgres-u (schemas/rpc_functions.sql) i pozivamo `client.rpc(...)`.
  * Nema multi-tabelarne transakcije preko REST-a. → sve što traži ACID
    preko više tabela ide kao RPC funkcija (koja je unutar Postgres-a
    automatski transakciona).
  * Rate limit 50k/mesec na Supabase Free planu. → za portal saobraćaj
    dovoljno; ako počne da baca 429, ovde ćemo dodati retry-with-backoff.
"""
from __future__ import annotations
import os
from typing import Any


class RestBackend:
    name = "rest"

    def __init__(self):
        try:
            from supabase import create_client
        except ImportError as e:
            raise RuntimeError(
                "supabase paket nije instaliran. "
                "Pokreni: pip install 'supabase>=2.0.0'"
            ) from e

        url = os.environ.get("SUPABASE_URL", "").strip()
        # Za server-side upisivanje/čitanje koristimo service_role ključ
        # (bypass RLS, punopravan pristup). NIKAD nemoj koristiti anon
        # ključ ovde — imao bi RLS problem na svakom pozivu.
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        if not url or not key:
            raise RuntimeError(
                "SUPABASE_URL i SUPABASE_SERVICE_ROLE_KEY moraju biti "
                "postavljeni u .env za REST backend."
            )
        self._client = create_client(url, key)

    # ---- helpers ---------------------------------------------------------

    def _table(self, name: str):
        return self._client.table(name)

    def _apply_filters(self, query, filters: dict | None):
        if not filters:
            return query
        for col, val in filters.items():
            if isinstance(val, tuple) and len(val) == 2 and isinstance(val[0], str):
                op, v = val
                op = op.lower()
                if op == "eq":       query = query.eq(col, v)
                elif op == "neq":    query = query.neq(col, v)
                elif op == "gt":     query = query.gt(col, v)
                elif op == "gte":    query = query.gte(col, v)
                elif op == "lt":     query = query.lt(col, v)
                elif op == "lte":    query = query.lte(col, v)
                elif op == "like":   query = query.like(col, v)
                elif op == "ilike":  query = query.ilike(col, v)
                elif op == "in":     query = query.in_(col, list(v))
                elif op == "is":     query = query.is_(col, v)
                else:
                    raise ValueError(f"Nepoznat operator '{op}' u filteru")
            else:
                query = query.eq(col, val)
        return query

    def _apply_order(self, query, order):
        if not order:
            return query
        items = [order] if isinstance(order, str) else list(order)
        for it in items:
            if not it: continue
            if it.startswith("-"):
                query = query.order(it[1:], desc=True)
            else:
                query = query.order(it, desc=False)
        return query

    # ---- CRUD -----------------------------------------------------------

    def select(self, table, filters=None, columns="*", order=None, limit=None):
        q = self._table(table).select(columns)
        q = self._apply_filters(q, filters)
        q = self._apply_order(q, order)
        if limit is not None:
            q = q.limit(int(limit))
        resp = q.execute()
        return resp.data or []

    def select_one(self, table, filters, columns="*"):
        q = self._table(table).select(columns)
        q = self._apply_filters(q, filters)
        q = q.limit(1)
        resp = q.execute()
        data = resp.data or []
        return data[0] if data else None

    def insert(self, table, row):
        resp = self._table(table).insert(row).execute()
        data = resp.data or []
        return data[0] if data else row

    def update(self, table, filters, patch):
        q = self._table(table).update(patch)
        q = self._apply_filters(q, filters)
        resp = q.execute()
        return resp.data or []

    def upsert(self, table, row, on_conflict="id"):
        # supabase-py: on_conflict as kwarg
        try:
            resp = self._table(table).upsert(row, on_conflict=on_conflict).execute()
            data = resp.data or []
            return data[0] if data else row
        except Exception as e:
            if '409' in str(e) or 'Conflict' in str(e):
                try:
                    pk_val = row.get(on_conflict)
                    if pk_val:
                        resp = self._table(table).update(row).eq(on_conflict, pk_val).execute()
                        data = resp.data or []
                        return data[0] if data else row
                except Exception:
                    return row
            raise

    def delete(self, table, filters):
        q = self._table(table).delete()
        q = self._apply_filters(q, filters)
        resp = q.execute()
        return len(resp.data or [])

    def count(self, table, filters=None):
        q = self._table(table).select("*", count="exact", head=True)
        q = self._apply_filters(q, filters)
        resp = q.execute()
        return int(resp.count or 0)

    def rpc(self, name, args=None):
        resp = self._client.rpc(name, args or {}).execute()
        return resp.data

    # ---- health ---------------------------------------------------------

    def health(self) -> dict:
        # Trivijalan probe: broj partnera. Ako radi, konekcija je OK.
        cnt = self.count("partners")
        return {"partners_count": cnt}
