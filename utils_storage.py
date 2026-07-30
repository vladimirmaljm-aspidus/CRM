"""Supabase Storage helper — upload/download/signed URLs with circuit breaker + retry.

Buckets (see bootstrap_storage()):
  - partner-docs  → KYC dokumenti, ugovori, sertifikati (private)
  - offer-pdfs    → Server-generated PDF-ovi ponuda/faktura (private)
  - portal-uploads → Klijentski upload iz portala (private)

Sve rute idu preko signed URL-a (60s do 1h TTL) tako da bucket ostaje private.
Ako je USE_SUPABASE_STORAGE=false, funkcije padaju na lokalni disk (UPLOAD_FOLDER).

Pattern: circuit breaker (utils_reliability) + retry sa exponential backoff.
Slično EspoCRM StorageManager i Odoo ir.attachment sa custom backend-om.
"""
from __future__ import annotations

import mimetypes
import os
import time
import uuid
from typing import Optional

from utils_reliability import get_breaker, retry


BUCKET_PARTNER_DOCS = "partner-docs"
BUCKET_OFFER_PDFS = "offer-pdfs"
BUCKET_PORTAL_UPLOADS = "portal-uploads"
BUCKET_BACKUPS = "backups"

_KNOWN_BUCKETS = (BUCKET_PARTNER_DOCS, BUCKET_OFFER_PDFS, BUCKET_PORTAL_UPLOADS, BUCKET_BACKUPS)


def use_supabase_storage() -> bool:
    return (os.environ.get("USE_SUPABASE_STORAGE") or "false").strip().lower() in {"1", "true", "yes", "on"}


def _client():
    """Lazy import + lazy client — ne pada ako supabase-py nije instaliran."""
    from supabase import create_client
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        raise RuntimeError("SUPABASE_URL ili SUPABASE_SERVICE_ROLE_KEY nije postavljen")
    return create_client(url, key)


def _breaker():
    return get_breaker("supabase_storage", fail_threshold=3, reset_timeout=45)


# ==========================================================
#  BUCKET BOOTSTRAP
# ==========================================================

def bootstrap_storage() -> dict:
    """Idempotentno kreira sve poznate bucket-ove kao private.

    Poziva se ručno iz admin panela (dugme "Init Storage") — ne automatski,
    da ne bi prilikom deploya trošili API kvote.
    """
    if not use_supabase_storage():
        return {"ok": False, "detail": "USE_SUPABASE_STORAGE=false"}
    try:
        c = _client()
        existing = {b.get("name") if isinstance(b, dict) else getattr(b, "name", None)
                    for b in (c.storage.list_buckets() or [])}
        created, skipped = [], []
        for name in _KNOWN_BUCKETS:
            if name in existing:
                skipped.append(name)
                continue
            try:
                c.storage.create_bucket(name, options={"public": False})
                created.append(name)
            except Exception as e:
                # Ako je "already exists" javio nešto drugo — samo loguj
                if "exist" in str(e).lower():
                    skipped.append(name)
                else:
                    raise
        return {"ok": True, "created": created, "skipped": skipped}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)[:200]}"}


# ==========================================================
#  UPLOAD
# ==========================================================

@retry(attempts=3, initial_delay=0.5, backoff=2.0)
def _do_upload(bucket: str, path: str, content: bytes, content_type: str):
    c = _client()
    return c.storage.from_(bucket).upload(
        path=path,
        file=content,
        file_options={"content-type": content_type, "upsert": "true"},
    )


def upload_bytes(bucket: str, path: str, content: bytes,
                 content_type: Optional[str] = None) -> dict:
    """Upload sirovih bajtova u dati bucket/path.

    Ako je Supabase Storage disabled ili circuit open → pada na lokalni disk
    (DATA_DIR/uploads/<bucket>/<path>) i vraća `{"local": True, "path": ...}`.
    """
    if not content_type:
        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"

    if not use_supabase_storage():
        return _local_write(bucket, path, content)

    try:
        result = _breaker().call(
            lambda: _do_upload(bucket, path, content, content_type),
            fallback="__circuit_open__",
        )
        if result == "__circuit_open__":
            # Fallback na lokalno da ne izgubimo fajl
            return _local_write(bucket, path, content, note="circuit_open")
        return {"ok": True, "bucket": bucket, "path": path, "size": len(content), "content_type": content_type}
    except Exception as e:
        # Poslednji fallback — nikada ne gubi klijentski upload
        local = _local_write(bucket, path, content, note=f"error:{type(e).__name__}")
        local["error"] = str(e)[:200]
        return local


def upload_file(bucket: str, path: str, filepath: str,
                content_type: Optional[str] = None) -> dict:
    """Convenience: pročitaj lokalni fajl i uploaduj."""
    with open(filepath, "rb") as f:
        return upload_bytes(bucket, path, f.read(), content_type)


def _local_write(bucket: str, path: str, content: bytes, note: str = "") -> dict:
    """Fallback storage — čuva u DATA_DIR/uploads/<bucket>/<path>."""
    from config import DATA_DIR
    root = os.path.join(DATA_DIR, "uploads", bucket)
    full = os.path.join(root, path.lstrip("/"))
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "wb") as f:
        f.write(content)
    return {"ok": True, "local": True, "bucket": bucket, "path": path,
            "abs_path": full, "size": len(content), "note": note}


# ==========================================================
#  DOWNLOAD / SIGNED URL
# ==========================================================

@retry(attempts=3, initial_delay=0.4, backoff=2.0)
def _do_download(bucket: str, path: str) -> bytes:
    c = _client()
    return c.storage.from_(bucket).download(path)


def download_bytes(bucket: str, path: str) -> Optional[bytes]:
    """Preuzmi sadržaj fajla. Vraća None ako ne postoji ili je circuit open."""
    if not use_supabase_storage():
        return _local_read(bucket, path)

    try:
        result = _breaker().call(
            lambda: _do_download(bucket, path),
            fallback=None,
        )
        if result is None:
            # Circuit open → probaj lokalno (možda smo tamo pisali kao fallback)
            return _local_read(bucket, path)
        return result
    except Exception:
        return _local_read(bucket, path)


def _local_read(bucket: str, path: str) -> Optional[bytes]:
    from config import DATA_DIR
    full = os.path.join(DATA_DIR, "uploads", bucket, path.lstrip("/"))
    if not os.path.exists(full):
        return None
    with open(full, "rb") as f:
        return f.read()


@retry(attempts=3, initial_delay=0.4, backoff=2.0)
def _do_signed(bucket: str, path: str, expires_in: int) -> Optional[str]:
    c = _client()
    resp = c.storage.from_(bucket).create_signed_url(path, expires_in)
    if isinstance(resp, dict):
        return resp.get("signedURL") or resp.get("signed_url") or resp.get("url")
    return getattr(resp, "signed_url", None)


def signed_url(bucket: str, path: str, expires_in: int = 300) -> Optional[str]:
    """Vraća privremeni URL za download (default 5 min).

    Ako je Storage disabled / circuit open → vrati None (caller neka streamuje
    lokalno preko svog endpointa).
    """
    if not use_supabase_storage():
        return None
    try:
        return _breaker().call(
            lambda: _do_signed(bucket, path, expires_in),
            fallback=None,
        )
    except Exception:
        return None


# ==========================================================
#  DELETE
# ==========================================================

@retry(attempts=3, initial_delay=0.4, backoff=2.0)
def _do_delete(bucket: str, paths: list[str]):
    c = _client()
    return c.storage.from_(bucket).remove(paths)


def delete(bucket: str, path: str | list[str]) -> dict:
    paths = [path] if isinstance(path, str) else list(path)
    if not use_supabase_storage():
        return _local_delete(bucket, paths)
    try:
        _breaker().call(lambda: _do_delete(bucket, paths), fallback=None)
        # I lokalno očisti ako smo tamo napisali fallback kopiju
        _local_delete(bucket, paths)
        return {"ok": True, "deleted": paths}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)[:200]}"}


def _local_delete(bucket: str, paths: list[str]) -> dict:
    from config import DATA_DIR
    root = os.path.join(DATA_DIR, "uploads", bucket)
    removed = []
    for p in paths:
        full = os.path.join(root, p.lstrip("/"))
        if os.path.exists(full):
            try:
                os.remove(full)
                removed.append(p)
            except Exception:
                pass
    return {"ok": True, "deleted": removed, "local": True}


# ==========================================================
#  HELPERS — putanje po logičkom entitetu
# ==========================================================

def path_for_partner_doc(partner_id: str, filename: str, subdir: str = "kyc") -> str:
    """`partner-docs` bucket: partners/<id>/<subdir>/<uuid>-<safe_name>"""
    safe = _safe_filename(filename)
    return f"partners/{partner_id}/{subdir}/{uuid.uuid4().hex[:8]}-{safe}"


def path_for_offer_pdf(offer_id: str, version: int = 1) -> str:
    ts = time.strftime("%Y%m%d")
    return f"offers/{offer_id}/v{version}-{ts}.pdf"


def path_for_portal_upload(partner_id: str, filename: str) -> str:
    safe = _safe_filename(filename)
    return f"partners/{partner_id}/uploads/{uuid.uuid4().hex[:8]}-{safe}"


def _safe_filename(name: str) -> str:
    """Ukloni / \\ i whitespace koji lome S3 key-eve."""
    import re
    base = os.path.basename(name).strip()
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", base)
    return base[:120] or "file"
