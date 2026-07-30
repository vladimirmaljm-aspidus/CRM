"""Bulletproof SQLite pristup — jedan modul, jedno mesto za sve konekcije.

Zašto: SQLite je jednostavan ali neoprezan pristup dovodi do "database is
locked" grešaka. Ovaj modul obezbeđuje:

  1. WAL journal mode + normal synchronous — writer ne blokira readers
  2. busy_timeout 60s — kernel čeka umesto da odmah baci OperationalError
  3. Foreign keys ON — konzistentnost
  4. Retry-on-lock dekorator (6 pokušaja, exponential backoff 100ms → 3.2s)
  5. write_lock() kontekst — serijalizacija upisa u istom procesu (drugi
     Python worker-i preko WAL-a takođe pišu bezbedno, jer je writer_lock
     samo *hint* — SQLite sam garantuje single-writer semantiku)
  6. connect() context manager sa automatskim rollback-om
  7. Optimizacija: mmap 128 MB, cache 8 MB, page_size 4096

Sve rute i moduli TREBA da koriste db.connect() umesto sqlite3.connect(),
ali stariji kod koji direktno zove sqlite3.connect() radi normalno jer
je WAL mode persistan (setuje se na fajl).
"""
import logging
import sqlite3
import threading
import time
from contextlib import contextmanager
from functools import wraps

logger = logging.getLogger(__name__)


# Application-level writer lock — dodatna zaštita u istom procesu
# kada više thread-ova simultano pokušava upis u isti DB fajl.
# SQLite garantuje single-writer semantiku i bez ovoga preko WAL-a,
# ali ovaj lock smanjuje broj SQLITE_BUSY grešaka pod visokom
# konkurencijom (npr. batch import + admin klik + backup thread).
_WRITE_LOCKS = {}  # {db_path: threading.RLock}
_WRITE_LOCKS_GUARD = threading.Lock()


def _get_write_lock(db_path):
    with _WRITE_LOCKS_GUARD:
        lock = _WRITE_LOCKS.get(db_path)
        if lock is None:
            lock = threading.RLock()
            _WRITE_LOCKS[db_path] = lock
        return lock


_PRAGMAS_APPLIED = set()


def _apply_pragmas(conn, db_path):
    """Applies PRAGMA settings once per DB file (WAL is persistent on-disk)."""
    conn.execute('PRAGMA busy_timeout=60000')       # 60s — 6x više od default 10s
    conn.execute('PRAGMA foreign_keys=ON')
    if db_path in _PRAGMAS_APPLIED:
        return
    try:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA synchronous=NORMAL')    # WAL + NORMAL je siguran za većinu use case-ova
        conn.execute('PRAGMA wal_autocheckpoint=1000')  # checkpoint na 1000 stranica (~4MB)
        conn.execute('PRAGMA mmap_size=134217728')   # 128 MB memory-mapped I/O
        conn.execute('PRAGMA cache_size=-8000')      # 8 MB page cache (negativno = KB)
        conn.execute('PRAGMA temp_store=MEMORY')
        _PRAGMAS_APPLIED.add(db_path)
    except sqlite3.Error as e:
        logger.warning(f'PRAGMA setup for {db_path}: {e}')


@contextmanager
def connect(db_path, *, write=False, timeout=60.0):
    """Bezbedan konekcijski context manager.

    Primer:
        with db.connect('/data/aspidus_crm.db') as conn:
            row = conn.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()

        with db.connect('/data/aspidus_crm.db', write=True) as conn:
            conn.execute('UPDATE users SET x=? WHERE id=?', (v, uid))
            # auto-commit na uspešnom izlazu, rollback na grešci

    write=True zaključava process-level writer lock — dopunska zaštita od
    lock races kada u istom procesu ima više writer thread-ova.
    """
    lock = _get_write_lock(db_path) if write else None
    if lock:
        lock.acquire()
    conn = sqlite3.connect(db_path, timeout=timeout, isolation_level='DEFERRED')
    try:
        _apply_pragmas(conn, db_path)
        yield conn
        if write:
            conn.commit()
    except Exception:
        try: conn.rollback()
        except Exception: pass
        raise
    finally:
        try: conn.close()
        except Exception: pass
        if lock:
            lock.release()


def retry_on_lock(max_attempts=6, base_delay=0.1):
    """Dekorator za funkcije koje pišu u SQLite — retry na SQLITE_BUSY.

    Backoff je exponential: 100ms, 200ms, 400ms, 800ms, 1.6s, 3.2s (ukupno ~6.3s).
    Ako se posle 6 pokušaja i dalje javlja lock, greška se propušta.
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            for attempt in range(max_attempts):
                try:
                    return fn(*args, **kwargs)
                except sqlite3.OperationalError as e:
                    msg = str(e).lower()
                    if 'database is locked' not in msg and 'database is busy' not in msg:
                        raise
                    if attempt == max_attempts - 1:
                        logger.error(f'{fn.__name__}: DB lock persisted after {max_attempts} retries — giving up: {e}')
                        raise
                    wait = base_delay * (2 ** attempt)
                    logger.warning(f'{fn.__name__}: DB locked (attempt {attempt+1}/{max_attempts}) — retrying in {wait:.2f}s')
                    time.sleep(wait)
        return wrapper
    return decorator


def retry_call(fn, *args, max_attempts=6, base_delay=0.1, **kwargs):
    """Wrapper funkcija (ne dekorator) za retry na SQLITE_BUSY.

    Koristi se kada treba retry-ovati jedan poziv bez definisanja posebne
    funkcije. Primer:
        db.retry_call(c.execute, 'INSERT INTO ...', (params,))
    """
    for attempt in range(max_attempts):
        try:
            return fn(*args, **kwargs)
        except sqlite3.OperationalError as e:
            msg = str(e).lower()
            if 'database is locked' not in msg and 'database is busy' not in msg:
                raise
            if attempt == max_attempts - 1:
                logger.error(f'db.retry_call: DB lock persisted after {max_attempts} retries — giving up: {e}')
                raise
            wait = base_delay * (2 ** attempt)
            logger.warning(f'db.retry_call: DB locked (attempt {attempt+1}/{max_attempts}) — retrying in {wait:.2f}s')
            time.sleep(wait)


def connect_raw(db_path, timeout=60.0):
    """Drop-in replacement za sqlite3.connect() — vraća raw konekciju sa svim
    PRAGMA optimizacijama (WAL, mmap, cache, busy_timeout). Koristi se za
    migraciju postojećeg koda koji ne može da koristi context manager:
    
        conn = db.connect_raw(DB_FILE)  # umesto sqlite3.connect(DB_FILE, ...)
        try:
            ...
        finally:
            conn.close()
    
    Sve PRAGMA-e se automatski primenjuju — nema potrebe za ručnim
    conn.execute('PRAGMA busy_timeout=...') u svakom fajlu.
    """
    conn = sqlite3.connect(db_path, timeout=timeout, isolation_level='DEFERRED')
    _apply_pragmas(conn, db_path)
    return conn


def health_check(db_path):
    """Vraća dictionary sa health metrikama za dati DB fajl.
    Koristi se u /api/system/health endpoint-u."""
    out = {'path': db_path, 'ok': False}
    try:
        with connect(db_path) as conn:
            out['journal_mode'] = conn.execute('PRAGMA journal_mode').fetchone()[0]
            out['synchronous'] = conn.execute('PRAGMA synchronous').fetchone()[0]
            out['busy_timeout_ms'] = conn.execute('PRAGMA busy_timeout').fetchone()[0]
            out['page_size'] = conn.execute('PRAGMA page_size').fetchone()[0]
            out['page_count'] = conn.execute('PRAGMA page_count').fetchone()[0]
            out['size_bytes'] = out['page_size'] * out['page_count']
            out['integrity'] = conn.execute('PRAGMA integrity_check').fetchone()[0]
            out['ok'] = out['integrity'] == 'ok'
    except Exception as e:
        out['error'] = str(e)
    return out


def checkpoint(db_path, mode='TRUNCATE'):
    """Ručno pokreni WAL checkpoint. Preporuka: nakon bulk import-a ili pre backup-a.
    mode: PASSIVE | FULL | RESTART | TRUNCATE (TRUNCATE svede WAL fajl na 0)."""
    try:
        with connect(db_path, write=True) as conn:
            r = conn.execute(f'PRAGMA wal_checkpoint({mode})').fetchone()
            return {'busy': r[0], 'log_pages': r[1], 'checkpointed': r[2]}
    except Exception as e:
        logger.warning(f'checkpoint({db_path}): {e}')
        return {'error': str(e)}
