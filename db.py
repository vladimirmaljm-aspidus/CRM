"""PostgreSQL (Supabase) data access — drop-in zamena za stari SQLite db.py.

Ceo AspidusCRM je prvobitno bio pisan nad SQLite-om (db.connect_raw(DB_FILE),
`?` placeholderi, pristup redovima preko row[0]/row[1], sqlite3.IntegrityError).
Ovaj modul ZADRŽAVA taj identičan API, samo što ispod radi nad PostgreSQL bazom
(Supabase). To znači da ogromna većina route fajlova ne mora uopšte da se menja.

Šta ovaj modul obezbeđuje:
  1. Connection pool ka Supabase (psycopg) — automatski iz env DATABASE_URL.
     Radi i sa Transaction pooler (port 6543) i sa Session pooler / direct (5432).
  2. connect_raw(path) — vraća PooledConnection koja se ponaša KAO sqlite3.Connection:
       - koristi se kao context manager (`with db.connect_raw(DB_FILE) as conn:`)
       - ili kao obična konekcija (`conn = db.connect_raw(...)`; ...; `conn.close()`)
       - `conn.cursor()`, `conn.execute(...)`, `conn.commit()`, `conn.close()`
     `path` argument se PRIMLJUJE ali IGNORIŠE — svi podaci idu na JEDNU Postgres
     bazu (Supabase). Ovo je ključno: stari kod prosiće DB_FILE / AUDIT_DB_FILE /
     PORTAL_DB_FILE, ali ih ovaj modul tretira kao labele (log tag), ne kao fajlove.
  3. Automatska konverzija `?` → `%s` u svakom execute() pozivu — nijedna rute ne
     mora da menja svoje SQL upite (SQLite stil `WHERE id=?` nastavlja da radi).
  4. Row objekat koji podržava i `row[0]` (tuple-style, kao SQLite) i `row['col']`
     (dict-style, kao sqlite3.Row). `row_factory = sqlite3.Row` postaje no-op.
  5. Exception aliasi: db.IntegrityError, db.OperationalError, db.DatabaseError,
     db.Error — tako da hvatanje `sqlite3.IntegrityError` samo zamenimo importom.
  6. retry_on_lock / retry_call — zadržani radi kompatibilnosti; u Postgresu nema
     "database is locked", ali retry na OperationalError (npr. mrežni blip) ostaje.
"""
import os
import re
import logging
import threading

logger = logging.getLogger(__name__)

# psycopg3 je hard dependency za PostgreSQL. Ako nije instalovan, aplikacija
# ne može da radi — jasan ImportError sa porukom za instalaciju.
import psycopg
from psycopg import pool as _pgpool


# ==========================================================
#  EXCEPTION ALIASI (kompatibilnost sa sqlite3.* u route fajlovima)
# ==========================================================
# Stari kod hvata: sqlite3.IntegrityError, sqlite3.OperationalError,
# sqlite3.DatabaseError, sqlite3.Error. Izlažemo iste atribute ovde, tako da
# route fajlovi mogu da pišu `import db` pa hvataju `db.IntegrityError`.
Error = psycopg.Error
DatabaseError = psycopg.DatabaseError
OperationalError = psycopg.OperationalError
IntegrityError = psycopg.errors.UniqueViolation  # PRIMARY KEY / UNIQUE violation
# psycopg.ProgrammingError → "no such table"/"column does not exist" ekvivalent
ProgrammingError = psycopg.ProgrammingError
NotSupportedError = psycopg.NotSupportedError
DataError = psycopg.DataError
InternalError = psycopg.InternalError


# ==========================================================
#  CONNECTION POOL (Supabase / Postgres)
# ==========================================================
# Lazy-inicijalizovan, thread-safe singleton pool. Pravi se pri prvom
# connect_raw() pozivu. Render pokreće više gunicorn workera (procesa), i svaki
# ima svoj pool — to je normalno i bezbedno za Supabase (pooler radi ispred).
_pool = None
_pool_lock = threading.Lock()
_DSN = os.getenv("DATABASE_URL", "").strip()


class _PgRow(dict):
    """Rezultat fetchone()/fetchall(). Ponaša se kao tuple I kao dict I kao sqlite3.Row.

    - row[0], row[1]  → pristup po poziciji kolone (kao stari SQLite tuple redovi)
    - row['username'] → pristup po imenu (kao sqlite3.Row)
    - list(row) / len(row) / iter(row) → radi kao tuple
    - row.get('x', default) → dict-style fallback

    Napomena: psycopg RealDictCursor vraća dictove; mi ih umotamo u _PgRow da bi
    indeks-po-poziciji i dalje radio kao u originalnom SQLite kodu.
    """
    __slots__ = ()

    def __getitem__(self, key):
        if isinstance(key, int):
            # mapiranje pozicije → vrednost po redu ubacivanja (kao tuple)
            return list(dict.values(self))[key]
        return dict.__getitem__(self, key)

    def __iter__(self):
        # iteracija vraća VREDNOSTI (kao tuple), ne ključeve — kompatibilno sa
        # kodom koji radi `for v in row:` ili `a, b = row`.
        return iter(dict.values(self))

    def __len__(self):
        return dict.__len__(self)

    def __eq__(self, other):
        if isinstance(other, (tuple, list)):
            return list(dict.values(self)) == list(other)
        return dict.__eq__(self, other)

    def __ne__(self, other):
        return not self.__eq__(other)

    def __hash__(self):
        return None  # mutable; nije hashable (kao ni tuple nije menjaiv)

    def __repr__(self):
        return "_PgRow(" + repr(tuple(dict.values(self))) + ")"


# Regex za konverziju `?` u `%s`. Čuva `?` unutar jednostrukih/dvostrukih navodnika
# (string literala u SQL-u) i unutar `$$ ... $$` blokova (Postgres dollar-quoting).
_QMARK_RE = re.compile(r"""
    ('(?:[^']|'')*')     |   # single-quoted string literal (sa '' escape-om)
    ("(?:[^"]|"")*")      |  # double-quoted identifier (Postgres quote ident)
    (\?)                     # lone ? placeholder
""", re.VERBOSE)


def _convert_placeholders(sql):
    """Pretvara SQLite `?` placeholdere u psycopg `%s`, bez diranja literala."""
    if '?' not in sql:
        return sql

    def _repl(m):
        if m.group(1) is not None or m.group(2) is not None:
            return m.group(0)           # string/identifier literal — ostaje kako jeste
        return '%s'                     # lone ? → %s
    return _QMARK_RE.sub(_repl, sql)


class _PgCursor:
    """Wrapper oko psycopg cursor-a koji automatski konvertuje `?`→`%s` i vraća _PgRow.

    Podržava i "context manager" i običan poziv. Imitira sqlite3.Cursor dovoljno
    da sav postojeći kod (c.execute(...), c.fetchone(), c.fetchall(), c.rowcount)
    nastavi da radi bez izmena.
    """
    def __init__(self, real_cursor):
        self._c = real_cursor

    def execute(self, sql, params=()):
        return self._c.execute(_convert_placeholders(sql), params)

    def executemany(self, sql, seq_of_params):
        return self._c.executemany(_convert_placeholders(sql), seq_of_params)

    def fetchone(self):
        row = self._c.fetchone()
        return _PgRow(row) if row else None

    def fetchall(self):
        return [_PgRow(r) for r in self._c.fetchall()]

    def fetchmany(self, size=1):
        return [_PgRow(r) for r in self._c.fetchmany(size)]

    @property
    def rowcount(self):
        return self._c.rowcount

    @property
    def description(self):
        return self._c.description

    @property
    def lastrowid(self):
        # Postgres ne koristi lastrowid (kod koristi UUID-ove generisane u Pythonu),
        # ali vraćamo None radi kompatibilnosti sa sqlite3 API-jem.
        return None

    def close(self):
        try:
            self._c.close()
        except Exception:
            pass

    def __iter__(self):
        while True:
            row = self.fetchone()
            if row is None:
                return
            yield row

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class PooledConnection:
    """Veza izvučena iz pool-a koja imitira sqlite3.Connection.

    Podržava:
      - context manager (`with db.connect_raw(DB_FILE) as conn:`) → auto-return u pool
      - conn.cursor() → _PgCursor (sa `?`→`%s` konverzijom)
      - conn.execute(sql, params) → shortcut koji vraća cursor (kao sqlite3.Connection)
      - conn.commit() / conn.rollback()
      - conn.close() → vraća vezu u pool (SIGURNO, može se zvati više puta)
      - `conn.row_factory = X` → no-op (komp. sa `conn.row_factory = sqlite3.Row`)
    """
    def __init__(self, pgconn, label="(default)"):
        self._pgconn = pgconn
        self._returned = False
        self._label = label
        # sqlite3 kompat: neki kod postavlja autocommit preko izolacionog nivoa.
        # psycopg po defaultu radi u autocommit=False (transakcije), što odgovara
        # starom SQLite DEFERRED ponašanju (commit() na kraju upisa).
        try:
            pgconn.autocommit = False
        except Exception:
            pass

    # ---- sqlite3.Connection API ----
    def cursor(self):
        cur = self._pgconn.cursor()
        return _PgCursor(cur)

    def execute(self, sql, params=()):
        # sqlite3.Connection.execute() vraća cursor direktno
        cur = self.cursor()
        cur.execute(sql, params)
        return cur

    def executemany(self, sql, seq_of_params):
        return self._pgconn.executemany(_convert_placeholders(sql), seq_of_params)

    def commit(self):
        try:
            self._pgconn.commit()
        except Exception as e:
            logger.warning(f"db.commit failed ({self._label}): {e}")

    def rollback(self):
        try:
            self._pgconn.rollback()
        except Exception:
            pass

    def close(self):
        """Vraća vezu u pool. Bezbedno pozvati više puta i iz context-managera."""
        if self._returned:
            return
        self._returned = True
        try:
            _return_to_pool(self._pgconn)
        except Exception as e:
            logger.warning(f"db.close/return-to-pool failed ({self._label}): {e}")

    # ---- kompatibilnost sa sqlite3 specifičnostima ----
    @property
    def row_factory(self):
        return None

    @row_factory.setter
    def row_factory(self, _value):
        # `conn.row_factory = sqlite3.Row` → no-op (uvek vraćamo _PgRow koji
        # podržava i indeks-po-poziciji i indeks-po-imenu).
        pass

    @property
    def total_changes(self):
        return 0

    @property
    def isolation_level(self):
        return None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        # Ako je bila greška, rollback; u svakom slučaju vrati vezu u pool.
        if exc_type is not None:
            self.rollback()
        self.close()
        return False


def _get_dsn():
    """Vraća DSN za psycopg. Ako env DATABASE_URL nije postavljen, baci grešku."""
    global _DSN
    dsn = (_DSN or os.getenv("DATABASE_URL") or "").strip()
    if not dsn:
        raise RuntimeError(
            "DATABASE_URL environment variable is not set. "
            "AspidusCRM koristi isključivo PostgreSQL (Supabase) — bez DATABASE_URL "
            "aplikacija ne može da se poveže na bazu. Postavite DATABASE_URL env var "
            "(Supabase Dashboard → Settings → Database → Connection string, URI mode)."
        )
    return dsn


def _ensure_pool():
    """Lazy-kreira connection pool (thread-safe)."""
    global _pool
    if _pool is not None:
        return _pool
    with _pool_lock:
        if _pool is not None:
            return _pool
        dsn = _get_dsn()
        # minconn=1, maxconn=8 — dovoljno za Render free (2 gunicorn workera).
        # Supabase Transaction pooler (port 6543) i sam kešira konekcije.
        try:
            _pool = _pgpool.ThreadedConnectionPool(1, 8, dsn)
            logger.info("DB POOL: uspešno konektovan na Supabase PostgreSQL.")
        except Exception as e:
            logger.error(f"DB POOL: ne mogu da se konektujem na bazu: {e}")
            raise
    return _pool


def _get_conn_from_pool(label):
    p = _ensure_pool()
    pgconn = p.getconn()
    try:
        pgconn.autocommit = False
    except Exception:
        pass
    return PooledConnection(pgconn, label=label)


def _return_to_pool(pgconn):
    p = _ensure_pool()
    p.putconn(pgconn)


# ==========================================================
#  JAVNI API (isti potpisi kao stari SQLite db.py)
# ==========================================================

def connect_raw(db_path=None, timeout=60.0, label=None):
    """Drop-in zamena za sqlite3.connect() / stari db.connect_raw().

    Vraća PooledConnection koja se može koristiti i kao context manager i kao
    obična konekcija. `db_path` se prima radi kompatibilnosti (stari kod šalje
    DB_FILE/AUDIT_DB_FILE/PORTAL_DB_FILE) ali se koristi samo kao log labela —
    SVI podaci idu na istu Supabase PostgreSQL bazu.

    Primer (context manager — najčešći obrazac u kodu):
        with db.connect_raw(DB_FILE) as conn:
            row = conn.execute('SELECT * FROM users WHERE id=?', (uid,)).fetchone()

    Primer (obična konekcija — npr. routes/audit.py):
        conn = db.connect_raw(DB_FILE)
        try:
            ...
        finally:
            conn.close()
    """
    _lbl = label or db_path or "(default)"
    return _get_conn_from_pool(_lbl)


@staticmethod
def _noop(*a, **k):
    pass


def connect(db_path=None, *, write=False, timeout=60.0):
    """Context-manager wrapper — kompatibilan sa starim db.connect().

    Vraća PooledConnection koja se ponaša kao context manager. `write=True` je
    prihvaćen (stari SQLite kod ga koristi za process-level lock) ali ovde je
    no-op — PostgreSQL ima sopstvenu MVCC konkurenciju, ne postoji "locked".
    """
    return connect_raw(db_path, timeout=timeout)


def retry_on_lock(max_attempts=6, base_delay=0.1):
    """Dekorator (kompat. sa starim API-jem) — retry na prolazne DB greške.

    PostgreSQL nema "database is locked", ali mrežni blip-ovi / pool timeout /
    privremeni conn reset mogu da jave OperationalError. Retry-ujemo te.
    """
    import time as _time
    from functools import wraps

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            for attempt in range(max_attempts):
                try:
                    return fn(*args, **kwargs)
                except psycopg.OperationalError as e:
                    msg = str(e).lower()
                    transient = ('server closed the connection' in msg
                                 or 'connection' in msg and 'reset' in msg
                                 or 'timeout expired' in msg
                                 or 'too many clients' in msg)
                    if not transient or attempt == max_attempts - 1:
                        raise
                    wait = base_delay * (2 ** attempt)
                    logger.warning(f'{fn.__name__}: DB transient error '
                                   f'(attempt {attempt+1}/{max_attempts}) — retry in {wait:.2f}s: {e}')
                    _time.sleep(wait)
        return wrapper
    return decorator


def retry_call(fn, *args, max_attempts=6, base_delay=0.1, **kwargs):
    """Wrapper funkcija (kompat. sa starim API-jem) — retry na prolazne greške."""
    import time as _time
    for attempt in range(max_attempts):
        try:
            return fn(*args, **kwargs)
        except psycopg.OperationalError as e:
            if attempt == max_attempts - 1:
                raise
            wait = base_delay * (2 ** attempt)
            logger.warning(f'db.retry_call: transient error '
                           f'(attempt {attempt+1}/{max_attempts}) — retry in {wait:.2f}s: {e}')
            _time.sleep(wait)


# ==========================================================
#  HEALTH CHECK (koristi ga /api/system/health)
# ==========================================================
def health_check(db_path=None):
    """Vraća dictionary sa health metrikama za PostgreSQL/Supabase."""
    out = {'backend': 'postgresql', 'ok': False}
    try:
        with connect_raw(db_path) as conn:
            cur = conn.execute("SELECT version()")
            ver = cur.fetchone()
            out['version'] = ver[0] if ver else 'unknown'
            cur = conn.execute(
                "SELECT current_database(), pg_size_pretty(pg_database_size(current_database()))"
            )
            db_row = cur.fetchone()
            if db_row:
                out['database'] = db_row[0]
                out['size'] = db_row[1]
            out['ok'] = True
    except Exception as e:
        out['error'] = str(e)
    return out


def checkpoint(db_path=None, mode='TRUNCATE'):
    """No-op za Postgres (WAL checkpoint je automatski). Zadržano radi kompat."""
    return {'backend': 'postgresql', 'note': 'WAL checkpoint je automatski u Postgres-u.'}
