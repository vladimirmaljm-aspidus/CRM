# AspidusCRM V22.04.05

A full-featured CRM (Customer Relationship Management) application built with Flask, SQLite, and vanilla JavaScript. Designed for international trade businesses with partner management, deal tracking, inventory, logistics, document generation, KYC compliance, and a B2B portal.

## Features

- **Partner Management** — Companies and contacts with KYC/compliance screening
- **Deal Pipeline** — Kanban-style deal tracking with offers, invoices, and versioning
- **Product Catalog** — Products, inventory, demands, and customer offers
- **Finance & Cashflow** — Cashflow tracking, financial overview
- **Logistics** — Shipment planning and tracking
- **Document Engine** — PDF generation (offers, invoices), document register with verification
- **B2B Portal** — Self-service portal for partners (OTP or Supabase auth)
- **Security** — CSRF protection, rate limiting, session hardening, 2FA/TOTP, firewall
- **Audit Trail** — Full audit logging of all actions
- **Supabase Integration** — Optional Supabase for auth, storage, and real-time sync
- **Webhooks** — Outgoing and incoming webhook support
- **Multi-language** — English and Serbian (Cyrillic/Latin) UI

## Quick Start (Local Development)

### Prerequisites

- Python 3.10+
- pip

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/YOUR-USERNAME/aspidus-crm.git
cd aspidus-crm

# 2. Create a virtual environment
python3 -m venv .venv
source .venv/bin/activate   # Linux/macOS
# .venv\Scripts\activate    # Windows

# 3. Install dependencies
pip install -r requirements.txt

# 4. Create your .env file
cp .env.example .env
# Edit .env and set at minimum:
#   SECRET_KEY=<generate one>
#   ENCRYPTION_KEY=<generate one>
#   ADMIN_PASSWORD=<choose a strong password>

# 5. Run the application
flask run
# or
python app.py
```

The app will be available at `http://localhost:5000`. Log in with the admin credentials you set in `.env`.

### Generating Keys

```bash
# SECRET_KEY
python3 -c "import secrets; print(secrets.token_urlsafe(64))"

# ENCRYPTION_KEY (Fernet)
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

## Deployment (Render)

### One-Click Deploy

The included `render.yaml` enables Render Blueprint deployment:

1. Push this repo to GitHub
2. Go to [Render Dashboard](https://dashboard.render.com) → New → Blueprint
3. Select your repository
4. Render will detect `render.yaml` and configure the service automatically

### Manual Setup

1. **Create a Web Service** on Render pointing to your GitHub repo
2. **Build Command:** `pip install -r requirements.txt`
3. **Start Command:** `gunicorn app:app --workers 2 --timeout 120 --bind 0.0.0.0:$PORT`
4. **Runtime:** Python 3.11
5. **Add a persistent disk** (1 GB minimum) mounted at `/opt/render/project/src/data`

### Required Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `SECRET_KEY` | **Yes** | Auto-generated | Flask session signing key. Must be stable across redeploys. |
| `ENCRYPTION_KEY` | **Yes** | Auto-generated | Fernet key for encrypting sensitive data. Must be stable. |
| `ADMIN_PASSWORD` | **Yes** | Random (logged) | Initial admin password. If unset, a random one is printed to the log. |
| `SESSION_COOKIE_SECURE` | **Yes** | `false` | Set to `true` when serving over HTTPS. |
| `APP_BASE_URL` | Recommended | — | Public URL of the app (for email links). No trailing slash. |
| `DATA_DIR` | No | Project root | Where databases and files are stored. Set to persistent disk path on Render. |
| `MAX_CONTENT_LENGTH` | No | `100` | Max upload size in MB. |
| `ADMIN_USERNAME` | No | `admin` | Admin username. |

### Optional Supabase Variables

| Variable | Default | Description |
|---|---|---|
| `USE_SUPABASE_AUTH` | `false` | Enable Supabase authentication for B2B portal. |
| `USE_SUPABASE_STORAGE` | `false` | Use Supabase Storage for file uploads. |
| `SUPABASE_URL` | — | Supabase project URL (e.g. `https://xxxxx.supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | — | Supabase service role key (admin access). |
| `SUPABASE_JWT_SECRET` | — | Supabase JWT secret for token verification. |
| `SUPABASE_ANON_KEY` | — | Supabase anonymous/public key. |
| `WEBHOOK_SECRET` | — | Secret for validating incoming webhook requests (min 32 chars). |

> **Note:** The free Render plan has no persistent disk — data is lost on redeploys. Use a paid plan or Supabase for production persistence.

## Testing

Tests are located in the `tests/` directory and require a running instance of the app.

```bash
# Start the app locally first
flask run

# Run the seed script to populate test data
python -m tests.e2e_seed

# Run end-to-end walkthrough tests
python -m tests.e2e_walkthrough

# Run aggressive/destructive tests
python -m tests.test_aggressive

# Run additional e2e suites
python -m tests.e2e_brutal
python -m tests.e2e_deep
python -m tests.e2e_deep_flows
python -m tests.e2e_human_errors
python -m tests.e2e_logic
python -m tests.e2e_massive
```

## Project Structure

```
aspiduscrmV22.04.05/
├── app.py                  # Flask application factory & route registration
├── config.py               # Configuration & environment variable loading
├── database.py             # SQLite schema initialization & migrations
├── db.py                   # Low-level database connection helpers
├── requirements.txt        # Python dependencies
├── Procfile                # Render/Heroku process definition
├── render.yaml             # Render Blueprint configuration
├── .env.example            # Environment variable template
├── .gitignore              # Git ignore rules
│
├── routes/                 # Flask Blueprints (API routes)
│   ├── auth.py             # Authentication (login, logout, 2FA)
│   ├── users.py            # User management
│   ├── data.py             # CRUD for partners, products, deals
│   ├── comms.py            # Communications log
│   ├── files.py            # File upload/download
│   ├── audit.py            # Audit log viewer
│   ├── documents.py        # Document management
│   ├── documents_register.py # Document register & verification
│   ├── reports.py          # Custom reports engine
│   ├── vault.py            # Encrypted vault for sensitive data
│   ├── logistics.py        # Logistics & shipment planning
│   ├── inventory.py        # Inventory management
│   ├── geo.py              # Geolocation & mapping
│   ├── sanctions.py        # Sanctions screening
│   ├── firewall.py         # IP firewall & rate limiting
│   ├── security_center.py  # Security dashboard
│   ├── system.py           # System health & diagnostics
│   ├── saved_filters.py    # Saved filter presets
│   ├── activity_feed.py    # Activity feed
│   ├── user_tasks.py       # Task management
│   ├── entities_extras.py  # Extended entity operations
│   ├── v23_admin.py        # V23 admin features
│   ├── v23_extras.py       # V23 extended features
│   ├── verify_public.py    # Public document verification
│   ├── supabase_admin.py   # Supabase configuration admin
│   ├── supabase_webhook.py # Supabase webhook handler
│   └── portal/             # B2B partner portal
│       ├── __init__.py     # Portal DB & session helpers
│       ├── auth.py         # Portal OTP authentication
│       ├── auth_supabase.py # Portal Supabase authentication
│       ├── actions.py      # Portal partner actions
│       └── data.py         # Portal data endpoints
│
├── templates/              # Jinja2 HTML templates
│   ├── index.html          # Main SPA shell
│   ├── portal.html         # B2B portal SPA
│   ├── portal_login.html   # Portal login page
│   ├── portal_error.html   # Portal error page
│   └── admin_*.html        # Admin panel templates
│
├── static/                 # Static assets
│   ├── css/
│   │   ├── style.css       # Main stylesheet
│   │   └── modern.css      # Modern UI overrides
│   ├── js/
│   │   ├── core/           # Core JS modules (API, utils, UI, export, etc.)
│   │   ├── modules/        # Feature modules (partners, deals, products, etc.)
│   │   ├── config/         # Translations, constants, country lists
│   │   ├── portal/         # Portal-specific JS
│   │   └── vendor/         # Third-party libs (signature_pad, ics, iban)
│   └── robots.txt
│
├── schemas/                # Database schemas
│   └── supabase_schema.sql # Supabase PostgreSQL schema
│
├── scripts/                # Utility scripts
│   └── db_export_full.py   # Full database export tool
│
├── data_layer/             # Data abstraction layer
│   ├── __init__.py         # Backend selection (SQLite/REST)
│   └── _rest.py            # Supabase REST backend
│
├── tests/                  # Test suite
│   ├── __init__.py
│   ├── e2e_seed.py         # Test data seeder
│   ├── e2e_walkthrough.py  # End-to-end walkthrough
│   ├── test_aggressive.py  # Aggressive/destructive tests
│   ├── e2e_brutal.py       # Brutal load tests
│   ├── e2e_deep.py         # Deep integration tests
│   ├── e2e_deep_flows.py   # Deep flow tests
│   ├── e2e_human_errors.py # Human error simulation
│   ├── e2e_logic.py        # Business logic tests
│   └── e2e_massive.py      # Massive data tests
│
├── uploads/                # User-uploaded files (.gitkeep)
├── portal_uploads/         # Portal-uploaded files (.gitkeep)
│
# Core modules
├── auth_supabase.py        # Supabase auth helpers
├── bank_validation.py      # Bank account validation
├── magic_link.py           # Magic link authentication
├── mail_providers.py       # Email provider abstraction
├── market_data.py          # FX & commodity market data
├── offer_versions.py       # Offer versioning system
├── pdf_generator.py        # PDF document generation
├── search_index.py         # Full-text search indexing
├── security_ext.py         # Extended security utilities
├── totp.py                 # TOTP 2FA implementation
├── tracking.py             # Shipment tracking
├── utils.py                # General utilities
├── utils_email.py          # Email utilities
├── utils_ocr.py            # OCR utilities
├── utils_reliability.py    # Circuit breakers & reliability
├── utils_storage.py        # Storage abstraction (local/Supabase)
└── webhooks.py             # Outgoing webhook delivery
```

## License

Proprietary — All rights reserved.
