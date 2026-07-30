import os
import secrets
import logging
from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)

VERSION = "22.04.05"
APP_BASE_URL = os.getenv("APP_BASE_URL", "").rstrip("/")

# Apsolutna putanja do glavnog direktorijuma projekta
BASE_DIR = os.path.abspath(os.path.dirname(__file__))

# ==========================================================
# DATA_DIR — gde se čuvaju uploadovani fajlovi (uploads, portal_uploads)
# ==========================================================
# NAPOMENA: Od V22.04.05+ aplikacija koristi isključivo PostgreSQL (Supabase) za
# sve podatke. DATA_DIR se koristi SAMO za lokalne upload fajlove koje Render
# čuva na ephemeral disku (ili na persistent disku ako je plaćen plan).
# Baza i ključevi se NE ČUVAJU ovde više — idu iz env varijabli.
DATA_DIR = os.getenv("DATA_DIR", BASE_DIR)
os.makedirs(DATA_DIR, exist_ok=True)

# ==========================================================
# DATABASE — PostgreSQL (Supabase). NEMA SQLite-a nigde.
# ==========================================================
# DATABASE_URL je OBAVEZAN. Izgleda otpriliko:
#   postgresql://postgres.xxxxx:TVOJA-LOZINKA@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()

# DB_FILE / AUDIT_DB_FILE / PORTAL_DB_FILE — ZADRŽANI SAMO kao labele (log tag-ovi)
# za db.py modul. db.py ih PRIMA ali ih ignoriše — SVI podaci idu na istu Supabase
# PostgreSQL bazu preko DATABASE_URL. Ovo postoji samo da svi postojeći `import`
# izjava u route fajlovima nastave da rade bez izmena.
DB_FILE = os.getenv("DATABASE_URL", "supabase://crm")         # labela, NE fajl
PORTAL_DB_FILE = os.getenv("DATABASE_URL", "supabase://portal")  # labela, NE fajl
AUDIT_DB_FILE = os.getenv("DATABASE_URL", "supabase://audit")  # labela, NE fajl

# ==========================================================
# SECRET KEY (potpisivanje sesijskih kolačića)
# ==========================================================
# OBAVEZNO iz env varijable za stabilne sesije (Render ephemeral disk).
SECRET_KEY = os.getenv("SECRET_KEY") or secrets.token_urlsafe(64)
SECRET_KEY_IS_GENERATED = not bool(os.getenv("SECRET_KEY"))
if SECRET_KEY_IS_GENERATED:
    logger.warning("SECRET_KEY nije postavljen iz env var — koristim privremeni "
                   "(sesije NEĆE opstati nakon restarta). OBAVEZNO postaviti SECRET_KEY.")

# ==========================================================
# ENCRYPTION KEY (FERNET) — šifruje osetljive podatke (SMTP lozinke, KYC, permisije)
# ==========================================================
# OBAVEZNO iz env varijable. Bez nje, pri svakom deploy-u bi se generisao novi
# ključ i postojeći šifrovani podaci ne bi mogli da se dešifruju.
_env_enc = os.getenv("ENCRYPTION_KEY")
if _env_enc:
    ENCRYPTION_KEY = _env_enc.encode() if isinstance(_env_enc, str) else _env_enc
else:
    # Fallback za lokalni dev — generiše se privremeni ključ (sa upozorenjem).
    _tmp = Fernet.generate_key()
    logger.warning("ENCRYPTION_KEY nije postavljen iz env var — koristim privremeni "
                   "(šifrovani podaci NEĆE opstati nakon restarta). OBAVEZNO postaviti ENCRYPTION_KEY.")
    ENCRYPTION_KEY = _tmp

# ==========================================================
# ADMIN KORISNIK — kreira se pri prvom startu ako baza nema nijednog user-a
# ==========================================================
ADMIN_USERNAME = (os.getenv("ADMIN_USERNAME") or "admin").strip()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD") or ""

# ==========================================================
# STORAGE — lokalni upload folderi (Render ephemeral/persistent disk)
# ==========================================================
UPLOAD_FOLDER = os.path.join(DATA_DIR, "uploads")
PORTAL_UPLOAD_FOLDER = os.path.join(DATA_DIR, "portal_uploads")

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(PORTAL_UPLOAD_FOLDER, exist_ok=True)

# ==========================================================
# UPLOAD LIMITS
# ==========================================================
MAX_CONTENT_LENGTH = int(os.getenv("MAX_CONTENT_LENGTH", "100")) * 1024 * 1024

ALLOWED_EXTENSIONS = {
    "pdf",
    "png",
    "jpg",
    "jpeg",
    "webp",
    "csv",
    "json",
    "txt",
    "doc",
    "docx",
    "xls",
    "xlsx",
}


def validate_config():
    """Validate required environment variables for production deployment."""
    warnings = []

    if SECRET_KEY_IS_GENERATED:
        warnings.append("SECRET_KEY is auto-generated (not from env). Set SECRET_KEY env var for stable sessions.")

    if not os.getenv("ENCRYPTION_KEY"):
        warnings.append("ENCRYPTION_KEY is auto-generated. Set ENCRYPTION_KEY env var or encrypted data will be lost on redeploy.")

    if not os.getenv("DATABASE_URL"):
        warnings.append("DATABASE_URL is NOT set. The app CANNOT connect to the database without it.")

    if not os.getenv("ADMIN_PASSWORD"):
        warnings.append("ADMIN_PASSWORD is not set. A random admin password will be generated on each start.")

    if os.getenv("USE_SUPABASE_AUTH", "").lower() in ("true", "1", "yes"):
        for var in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_JWT_SECRET"):
            if not os.getenv(var):
                warnings.append(f"USE_SUPABASE_AUTH is enabled but {var} is not set.")

    if os.getenv("USE_SUPABASE_STORAGE", "").lower() in ("true", "1", "yes"):
        for var in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
            if not os.getenv(var):
                warnings.append(f"USE_SUPABASE_STORAGE is enabled but {var} is not set.")

    for w in warnings:
        logger.warning(f"CONFIG WARNING: {w}")

    return warnings
