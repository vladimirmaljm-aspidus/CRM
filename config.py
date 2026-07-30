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
# DATA_DIR — gde se čuvaju baze, ključevi i otpremljeni fajlovi
# ==========================================================
# VAŽNO ZA PRODUKCIJU (Render/Heroku i sl. sa efemernim diskom):
# Postavite env DATA_DIR na putanju TRAJNOG (persistent) diska, npr. /var/data,
# kako baze, ključevi i uploadovani fajlovi ne bi nestajali pri svakom re-deployu.
# Lokalno (bez env-a) podrazumevano je BASE_DIR, pa se ponašanje ne menja.
DATA_DIR = os.getenv("DATA_DIR", BASE_DIR)
os.makedirs(DATA_DIR, exist_ok=True)

# ==========================================================
# SECRET KEY (potpisivanje sesijskih kolačića)
# ==========================================================

INSTANCE_DIR = os.path.join(DATA_DIR, "instance")
os.makedirs(INSTANCE_DIR, exist_ok=True)

SECRET_KEY_FILE = os.path.join(INSTANCE_DIR, "secret.key")

# Prioritet: 1) env SECRET_KEY  2) sačuvani fajl  3) automatski generisan
if os.getenv("SECRET_KEY"):
    SECRET_KEY = os.getenv("SECRET_KEY")
elif os.path.exists(SECRET_KEY_FILE):
    with open(SECRET_KEY_FILE, "r", encoding="utf-8") as f:
        SECRET_KEY = f.read().strip()
else:
    SECRET_KEY = secrets.token_urlsafe(64)
    try:
        with open(SECRET_KEY_FILE, "w", encoding="utf-8") as f:
            f.write(SECRET_KEY)
        os.chmod(SECRET_KEY_FILE, 0o600)
    except Exception:
        # Na read-only/efemernom disku fajl možda ne može da se upiše; nastavi sa in-memory ključem.
        logger.warning("SECRET_KEY se ne može trajno sačuvati. Postavite env SECRET_KEY za stabilne sesije u produkciji.")

SECRET_KEY_IS_GENERATED = not bool(os.getenv("SECRET_KEY"))

# ==========================================================
# ENCRYPTION KEY (FERNET) — šifruje osetljive podatke (SMTP lozinke, KYC, permisije)
# ==========================================================
# Prioritet: 1) env ENCRYPTION_KEY  2) sačuvani fajl  3) automatski generisan.
# U produkciji BEZ trajnog diska OBAVEZNO postaviti env ENCRYPTION_KEY (base64 Fernet
# ključ), inače bi se pri svakom deployu generisao novi ključ i postojeći šifrovani
# podaci više ne bi mogli da se dešifruju.
KEY_FILE = os.path.join(DATA_DIR, "vault.key")

_env_enc = os.getenv("ENCRYPTION_KEY")
if _env_enc:
    ENCRYPTION_KEY = _env_enc.encode() if isinstance(_env_enc, str) else _env_enc
else:
    if not os.path.exists(KEY_FILE):
        _new_key = Fernet.generate_key()
        try:
            with open(KEY_FILE, "wb") as f:
                f.write(_new_key)
            os.chmod(KEY_FILE, 0o600)
        except Exception:
            logger.warning("ENCRYPTION_KEY se ne može trajno sačuvati. Postavite env ENCRYPTION_KEY u produkciji.")
        ENCRYPTION_KEY = _new_key
    else:
        with open(KEY_FILE, "rb") as f:
            ENCRYPTION_KEY = f.read()

# ==========================================================
# DATABASES
# ==========================================================

DB_FILE = os.path.join(DATA_DIR, "aspidus_crm.db")
PORTAL_DB_FILE = os.path.join(DATA_DIR, "aspidus_portal.db")
AUDIT_DB_FILE = os.path.join(DATA_DIR, "aspidus_audit.db")

# ==========================================================
# STORAGE
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
    import sys
    warnings = []
    
    if SECRET_KEY_IS_GENERATED:
        warnings.append("SECRET_KEY is auto-generated (not from env). Set SECRET_KEY env var for stable sessions.")
    
    if not os.getenv("ENCRYPTION_KEY"):
        warnings.append("ENCRYPTION_KEY is auto-generated. Set ENCRYPTION_KEY env var or encrypted data will be lost on redeploy.")
    
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
