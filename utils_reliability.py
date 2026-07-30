"""Reliability utilities — circuit breaker, retry, health checks.

Pattern-i iz Odoo (res.retry), ERPNext (bench doctor), EspoCRM (Service::retry).
Cilj: aplikacija ne pada kad se spoljni servis nakratko pokvari, već graceful
degradira i loguje šta se desilo.
"""
from __future__ import annotations

import functools
import threading
import time
from typing import Callable, Any


# ==========================================================
#  CIRCUIT BREAKER
# ==========================================================
# Ako neki servis pukne N puta zaredom, "otvaramo" circuit i N sekundi
# ne pokušavamo ništa (vraćamo fallback). Posle timeout-a probamo jednom
# (half-open state) — ako uspe, zatvaramo, ako ne uspe, čekamo ponovo.


class CircuitBreaker:
    """Thread-safe circuit breaker.

    States:
      CLOSED     — normalno, propušta pozive
      OPEN       — servis je "pukao", ne pokušavamo N sekundi
      HALF_OPEN  — probamo jedan poziv da vidimo je li servis nazad
    """
    STATE_CLOSED = "closed"
    STATE_OPEN = "open"
    STATE_HALF = "half-open"

    def __init__(self, name: str, fail_threshold: int = 5, reset_timeout: float = 60.0):
        self.name = name
        self.fail_threshold = fail_threshold
        self.reset_timeout = reset_timeout
        self._state = self.STATE_CLOSED
        self._failures = 0
        self._last_failure_ts = 0.0
        self._lock = threading.Lock()

    @property
    def state(self) -> str:
        with self._lock:
            if self._state == self.STATE_OPEN:
                if time.time() - self._last_failure_ts > self.reset_timeout:
                    self._state = self.STATE_HALF
            return self._state

    def record_success(self):
        with self._lock:
            self._failures = 0
            self._state = self.STATE_CLOSED

    def record_failure(self):
        with self._lock:
            self._failures += 1
            self._last_failure_ts = time.time()
            if self._failures >= self.fail_threshold:
                self._state = self.STATE_OPEN

    def call(self, func: Callable, *args, fallback=None, **kwargs):
        """Poziva func — ako je circuit OPEN, odmah vraća fallback bez pokušaja."""
        state = self.state
        if state == self.STATE_OPEN:
            return fallback
        try:
            result = func(*args, **kwargs)
            self.record_success()
            return result
        except Exception:
            self.record_failure()
            if state == self.STATE_HALF:
                # Probao smo, opet ne radi, ostaje OPEN
                pass
            raise

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "name": self.name,
                "state": self._state,
                "failures": self._failures,
                "last_failure_ago": time.time() - self._last_failure_ts if self._last_failure_ts else None,
                "will_retry_in": max(0, self.reset_timeout - (time.time() - self._last_failure_ts)) if self._state == self.STATE_OPEN else 0,
            }


# Globalni circuit breakers po servisu
_breakers: dict[str, CircuitBreaker] = {}
_breakers_lock = threading.Lock()


def get_breaker(service: str, **kwargs) -> CircuitBreaker:
    """Vrati (ili napravi) circuit breaker za dati servis."""
    with _breakers_lock:
        if service not in _breakers:
            _breakers[service] = CircuitBreaker(service, **kwargs)
        return _breakers[service]


def all_breakers_snapshot() -> list[dict]:
    with _breakers_lock:
        return [b.snapshot() for b in _breakers.values()]


# ==========================================================
#  RETRY sa EXPONENTIAL BACKOFF
# ==========================================================


def retry(attempts: int = 3, initial_delay: float = 0.5, backoff: float = 2.0,
          exceptions: tuple = (Exception,), on_retry: Callable | None = None):
    """Decorator: pokušava funkciju do N puta sa eksponencijalnim backoff-om.

    Primer:
        @retry(attempts=3, exceptions=(httpx.HTTPError, TimeoutError))
        def fetch_something(): ...
    """
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            delay = initial_delay
            last_exc = None
            for attempt in range(1, attempts + 1):
                try:
                    return fn(*args, **kwargs)
                except exceptions as e:
                    last_exc = e
                    if attempt == attempts:
                        raise
                    if on_retry:
                        try:
                            on_retry(attempt, e)
                        except Exception:
                            pass
                    time.sleep(delay)
                    delay *= backoff
            if last_exc:
                raise last_exc
        return wrapper
    return deco


# ==========================================================
#  HEALTH CHECKS
# ==========================================================


def health_supabase_auth() -> dict:
    """Da li je Supabase Auth API dostupan."""
    try:
        from auth_supabase import admin_client, use_supabase_auth
        if not use_supabase_auth():
            return {"ok": True, "status": "disabled", "detail": "USE_SUPABASE_AUTH=false"}
        breaker = get_breaker("supabase_auth", fail_threshold=3, reset_timeout=30)
        result = breaker.call(
            lambda: admin_client().auth.admin.list_users(page=1, per_page=1),
            fallback="circuit_open"
        )
        if result == "circuit_open":
            return {"ok": False, "status": "circuit_open", "detail": "Too many failures — waiting to retry"}
        return {"ok": True, "status": "reachable"}
    except Exception as e:
        return {"ok": False, "status": "error", "detail": f"{type(e).__name__}: {str(e)[:200]}"}


def health_supabase_db() -> dict:
    try:
        from data_layer import count as db_count
        breaker = get_breaker("supabase_db", fail_threshold=3, reset_timeout=30)
        result = breaker.call(lambda: db_count("partners"), fallback=-1)
        if result == -1:
            return {"ok": False, "status": "circuit_open", "detail": "Too many failures"}
        return {"ok": True, "status": "reachable", "detail": f"partners count: {result}"}
    except Exception as e:
        return {"ok": False, "status": "error", "detail": f"{type(e).__name__}: {str(e)[:200]}"}


def health_supabase_storage() -> dict:
    try:
        import os
        from supabase import create_client
        url = os.environ.get("SUPABASE_URL", "").strip()
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        if not url or not key:
            return {"ok": False, "status": "misconfigured", "detail": "URL or SERVICE_ROLE_KEY missing"}
        breaker = get_breaker("supabase_storage", fail_threshold=3, reset_timeout=30)
        def _check():
            client = create_client(url, key)
            buckets = client.storage.list_buckets()
            return len(buckets) if buckets else 0
        n = breaker.call(_check, fallback=-1)
        if n == -1:
            return {"ok": False, "status": "circuit_open"}
        return {"ok": True, "status": "reachable", "detail": f"{n} bucket(s)"}
    except Exception as e:
        return {"ok": False, "status": "error", "detail": f"{type(e).__name__}: {str(e)[:200]}"}


def health_smtp() -> dict:
    """SMTP server dostupan?"""
    try:
        import os
        import smtplib
        host = os.environ.get("SMTP_HOST", "").strip()
        port = int(os.environ.get("SMTP_PORT", "587") or 587)
        if not host:
            return {"ok": False, "status": "not_configured", "detail": "SMTP_HOST empty"}
        breaker = get_breaker("smtp", fail_threshold=3, reset_timeout=60)
        def _check():
            with smtplib.SMTP(host, port, timeout=8) as s:
                s.noop()
            return True
        ok = breaker.call(_check, fallback=False)
        return {"ok": bool(ok), "status": "reachable" if ok else "circuit_open"}
    except Exception as e:
        return {"ok": False, "status": "error", "detail": f"{type(e).__name__}: {str(e)[:200]}"}


def health_sqlite() -> dict:
    """Lokalne SQLite baze — može li da otvori, integrity_check."""
    try:
        import os
        import sqlite3
        from config import DB_FILE, PORTAL_DB_FILE, AUDIT_DB_FILE
        checks = {}
        for label, path in (("crm", DB_FILE), ("portal", PORTAL_DB_FILE), ("audit", AUDIT_DB_FILE)):
            if not os.path.exists(path):
                checks[label] = {"exists": False}
                continue
            try:
                conn = db.connect_raw(path, timeout=3.0)
                integ = conn.execute("PRAGMA integrity_check").fetchone()
                conn.close()
                checks[label] = {"exists": True, "integrity": integ[0] if integ else "?"}
            except Exception as e:
                checks[label] = {"exists": True, "error": str(e)[:100]}
        ok = all(v.get("integrity") == "ok" for v in checks.values() if v.get("exists"))
        return {"ok": ok, "status": "checked", "detail": checks}
    except Exception as e:
        return {"ok": False, "status": "error", "detail": f"{type(e).__name__}: {str(e)[:200]}"}


def health_backup() -> dict:
    """Da li imamo skoriji Fernet backup?"""
    try:
        import os
        import time as _t
        from config import DATA_DIR
        bdir = os.path.join(DATA_DIR, "backups")
        if not os.path.isdir(bdir):
            return {"ok": False, "status": "no_backup_dir"}
        newest = 0
        for f in os.listdir(bdir):
            if f.endswith(".fernet"):
                m = os.path.getmtime(os.path.join(bdir, f))
                if m > newest:
                    newest = m
        if newest == 0:
            return {"ok": False, "status": "no_backups"}
        age_h = (_t.time() - newest) / 3600
        return {
            "ok": age_h < 26,
            "status": "recent" if age_h < 26 else "stale",
            "detail": f"newest backup {age_h:.1f}h old"
        }
    except Exception as e:
        return {"ok": False, "status": "error", "detail": str(e)[:200]}


def health_disk() -> dict:
    """Koliko slobodnog prostora na disku."""
    try:
        import shutil
        from config import DATA_DIR
        usage = shutil.disk_usage(DATA_DIR)
        free_mb = usage.free / (1024 * 1024)
        used_pct = 100 * (usage.used / usage.total) if usage.total else 0
        return {
            "ok": free_mb > 50,
            "status": "healthy" if free_mb > 50 else "low_space",
            "detail": f"{free_mb:.0f} MB free ({used_pct:.0f}% used)"
        }
    except Exception as e:
        return {"ok": False, "status": "error", "detail": str(e)[:200]}


def health_ocr() -> dict:
    """Koji OCR back-endovi su dostupni na ovom serveru."""
    try:
        from utils_ocr import has_ocr_available
        avail = has_ocr_available()
        n_ok = sum(1 for v in avail.values() if v)
        detail = ", ".join(f"{k}={'✓' if v else '✗'}" for k, v in avail.items())
        return {
            "ok": n_ok >= 1,  # bar jedan back-end
            "status": "checked",
            "detail": detail + f" ({n_ok}/{len(avail)} back-ends available)",
        }
    except Exception as e:
        return {"ok": False, "status": "error", "detail": str(e)[:200]}


def health_mail_queue() -> dict:
    """Trenutno stanje email queue-a — broj pending / failed / dead."""
    try:
        import sqlite3
        from config import DB_FILE
        with db.connect_raw(DB_FILE) as conn:
            counts = {}
            for st in ("pending", "sending", "sent", "failed", "dead"):
                row = conn.execute(
                    "SELECT COUNT(*) FROM email_queue WHERE status=?", (st,)
                ).fetchone()
                counts[st] = row[0] if row else 0
        failed = counts.get('failed', 0) + counts.get('dead', 0)
        return {
            "ok": failed == 0,
            "status": "healthy" if failed == 0 else "has_failures",
            "detail": (f"pending={counts.get('pending', 0)}, "
                       f"failed={counts.get('failed', 0)}, "
                       f"dead={counts.get('dead', 0)}, "
                       f"sent={counts.get('sent', 0)}")
        }
    except Exception as e:
        return {"ok": False, "status": "error", "detail": str(e)[:200]}


def health_data_layer() -> dict:
    """Aktivni data_layer backend + probe za sanity."""
    try:
        from data_layer import backend_name, health as _dl_health
        name = backend_name()
        try:
            info = _dl_health()
        except Exception as e:
            return {"ok": False, "status": "backend_error",
                    "detail": f"backend={name}, error={type(e).__name__}: {str(e)[:120]}"}
        if info.get("ok"):
            return {"ok": True, "status": "reachable",
                    "detail": f"backend={name}, partners={info.get('partners_count', '?')}"}
        return {"ok": False, "status": "backend_error",
                "detail": f"backend={name}, error={info.get('error', 'unknown')[:120]}"}
    except ImportError:
        return {"ok": True, "status": "not_active",
                "detail": "data_layer facade nije uvezen (SQLite-only mod)"}
    except Exception as e:
        return {"ok": False, "status": "error", "detail": str(e)[:200]}


def health_webhook() -> dict:
    """Da li je WEBHOOK_SECRET postavljen — bez toga webhook odbija sve."""
    try:
        import os as _os
        secret = _os.environ.get('WEBHOOK_SECRET', '').strip()
        if not secret:
            return {"ok": False, "status": "not_configured",
                    "detail": "WEBHOOK_SECRET nije postavljen u .env"}
        if len(secret) < 16:
            return {"ok": False, "status": "weak_secret",
                    "detail": f"secret prekratak ({len(secret)} chars, min 16)"}
        return {"ok": True, "status": "configured",
                "detail": f"secret length {len(secret)} chars"}
    except Exception as e:
        return {"ok": False, "status": "error", "detail": str(e)[:200]}


def full_health() -> dict:
    """Vraća sveobuhvatni health report — koristi ga /api/health endpoint."""
    checks = {
        "sqlite":            health_sqlite(),
        "supabase_auth":     health_supabase_auth(),
        "supabase_db":       health_supabase_db(),
        "supabase_storage":  health_supabase_storage(),
        "smtp":              health_smtp(),
        "backup":            health_backup(),
        "disk":              health_disk(),
        "ocr":               health_ocr(),
        "mail_queue":        health_mail_queue(),
        "webhook":           health_webhook(),
        "data_layer":        health_data_layer(),
    }
    overall_ok = all(c.get("ok") for c in checks.values() if c.get("status") not in ("disabled", "not_configured"))
    return {
        "ok": overall_ok,
        "checks": checks,
        "circuits": all_breakers_snapshot(),
        "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }
