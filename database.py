import os
import uuid
import db
import sqlite3
import logging
from config import DB_FILE, PORTAL_DB_FILE, AUDIT_DB_FILE

# Postavljanje logera za bazu
logger = logging.getLogger(__name__)

def seed_admin_if_empty(cursor):
    """Ako u bazi NEMA nijednog korisnika (npr. sveža/prazna baza na produkciji
    gde .db fajlovi nisu deployovani), kreira početnog administratora kako korisnik
    ne bi ostao zaključan van sistema (uzrok 'auth_error' na praznoj bazi).

    Kredencijali se uzimaju iz env-a ADMIN_USERNAME / ADMIN_PASSWORD; ako nisu
    postavljeni, koristi se podrazumevani nalog uz glasno upozorenje da se odmah
    promeni lozinka. NE dira postojeće korisnike."""
    try:
        from werkzeug.security import generate_password_hash
        count = cursor.execute('SELECT COUNT(*) FROM users').fetchone()[0]
        if count and count > 0:
            return
        username = (os.getenv('ADMIN_USERNAME') or 'admin').strip()
        password = os.getenv('ADMIN_PASSWORD')
        if not password:
            import secrets as _secrets
            password = 'Admin-' + _secrets.token_urlsafe(12)
            logger.warning("=" * 70)
            logger.warning(f"SEED: baza je bila prazna — kreiran administrator '{username}' sa RANDOM lozinkom.")
            logger.warning(f"SEED: Lozinka: {password}")
            logger.warning("ODMAH se prijavite i promenite lozinku (Moj Profil), ili postavite env ADMIN_PASSWORD.")
            logger.warning("=" * 70)
        else:
            logger.warning(f"SEED: kreiran početni administrator '{username}' (lozinka iz ADMIN_PASSWORD env-a).")
        pw_hash = generate_password_hash(password, method='scrypt:32768:8:1')
        cursor.execute(
            'INSERT INTO users (id, username, password, role, permissions) VALUES (?, ?, ?, ?, ?)',
            (str(uuid.uuid4()), username, pw_hash, 'admin', '{}')
        )
    except Exception as e:
        logger.error(f"CRITICAL: seed_admin_if_empty nije uspeo - {e}")

def init_db():
    # 1. GLAVNA CRM BAZA
    try:
        # Korišćenje 'with' osigurava da se konekcija uvek bezbedno zatvori i izbegne "database is locked"
        with db.connect_raw(DB_FILE, timeout=30.0) as conn:
            c = conn.cursor()
            
            c.execute('''CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE, password TEXT, role TEXT, permissions TEXT)''')
            c.execute('''CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)''')

            # MIGRACIJA: lični potpis po korisniku (svako koristi samo svoj potpis na dokumentima).
            cols = [r[1] for r in c.execute("PRAGMA table_info(users)").fetchall()]
            if 'signature' not in cols:
                c.execute('ALTER TABLE users ADD COLUMN signature TEXT')
            # MIGRACIJA: token_version — broj koji se povećava pri izmeni lozinke ili
            # ručnom odjavi svih sesija; svaki request u login_required proverava da
            # sesija (session.token_version) odgovara aktuelnoj vrednosti korisnika.
            # Ovim promena lozinke odmah izbacuje SVE ranije otvorene sesije.
            if 'token_version' not in cols:
                c.execute("ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 1")
            # MIGRACIJA: last_password_change_at + last_login_country — telemetrija za
            # anomaly detekciju (npr. iznenadna prijava iz druge zemlje).
            if 'last_password_change_at' not in cols:
                c.execute("ALTER TABLE users ADD COLUMN last_password_change_at TEXT")
            if 'last_login_country' not in cols:
                c.execute("ALTER TABLE users ADD COLUMN last_login_country TEXT")
            # MIGRACIJA v21: 2FA/TOTP polja. totp_secret je base32 encoded shared
            # secret za HOTP/TOTP RFC 6238 (kompatibilno sa Google Authenticator,
            # Authy, 1Password). totp_enabled je bool zastavica koja bira da li
            # login flow traži drugu proveru. totp_recovery je JSON lista
            # hasovanih recovery kodova za slučaj gubitka telefona.
            if 'totp_secret' not in cols:
                c.execute("ALTER TABLE users ADD COLUMN totp_secret TEXT")
            if 'totp_enabled' not in cols:
                c.execute("ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0")
            if 'totp_recovery' not in cols:
                c.execute("ALTER TABLE users ADD COLUMN totp_recovery TEXT")
            # MIGRACIJA v22: profile fields za CRM user-e (koristi ih Preferences panel).
            # full_name / email / phone su prosti string-ovi; notif_prefs je JSON
            # objekat koji koristi ui.js checkAllNotifications da odluci sta prikazati.
            if 'full_name' not in cols:
                c.execute("ALTER TABLE users ADD COLUMN full_name TEXT")
            if 'email' not in cols:
                c.execute("ALTER TABLE users ADD COLUMN email TEXT")
            if 'phone' not in cols:
                c.execute("ALTER TABLE users ADD COLUMN phone TEXT")
            if 'notif_prefs' not in cols:
                c.execute("ALTER TABLE users ADD COLUMN notif_prefs TEXT")
            # v23 Round F — SECURITY UPGRADES: force password change, lockout, password age policy.
            # must_change_password: admin postavi na 1 → sledeci uspesan login redirectuje user-a
            #   na /profile/security#password i blokira sve druge rute dok se lozinka ne promeni.
            # locked_until: ISO timestamp — self-lockout posle N neuspelih pokusaja; nakon isteka
            #   se automatski otkljucava. Portal magic-link i admin unlock su alternativa.
            # password_expires_at: kada je poslednja lozinka postavljena + policy period. Login
            #   ne blokira po isteku (soft warning), samo pokazuje "please change".
            if 'must_change_password' not in cols:
                c.execute("ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0")
            if 'locked_until' not in cols:
                c.execute("ALTER TABLE users ADD COLUMN locked_until TEXT")
            if 'password_expires_at' not in cols:
                c.execute("ALTER TABLE users ADD COLUMN password_expires_at TEXT")

            # v23 Round F: user_sessions — per-session tracking sa individual revoke.
            # Ranije smo imali samo token_version (globalno "kill all sesija"). Sada svaki
            # login pravi row ovde sa jedinstvenim session_id-jem (uuid), i user u
            # /profile/security vidi listu svih aktivnih sesija sa "Terminate"
            # dugmetom po redu. login_required proverava (session_id, revoked=0).
            c.execute('''CREATE TABLE IF NOT EXISTS user_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL,
                ip TEXT,
                country TEXT,
                user_agent TEXT,
                ua_family TEXT,
                device_label TEXT,
                revoked INTEGER DEFAULT 0,
                revoked_at TEXT,
                revoked_reason TEXT
            )''')
            c.execute('CREATE INDEX IF NOT EXISTS idx_usersess_user ON user_sessions(user_id)')
            c.execute('CREATE INDEX IF NOT EXISTS idx_usersess_active ON user_sessions(user_id, revoked)')

            # v23 Round F: trusted_devices — 30-dnevni cookie koji preskace 2FA re-prompt na
            # istom uredjaju. device_token je SHA-256 od (uuid + user_id + secret). NIKAD ne
            # cuvamo raw token — samo hash, ista logika kao za passwords.
            c.execute('''CREATE TABLE IF NOT EXISTS trusted_devices (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                token_hash TEXT NOT NULL UNIQUE,
                label TEXT,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                last_seen_at TEXT,
                last_ip TEXT,
                revoked INTEGER DEFAULT 0
            )''')
            c.execute('CREATE INDEX IF NOT EXISTS idx_trusteddev_user ON trusted_devices(user_id, revoked)')

            # v23 Round F: password_history — sprecava reuse poslednjih 5 lozinki.
            # Cuva samo werkzeug scrypt hash, ne raw password. Cist za GDPR.
            c.execute('''CREATE TABLE IF NOT EXISTS password_history (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                changed_at TEXT NOT NULL
            )''')
            c.execute('CREATE INDEX IF NOT EXISTS idx_pwhistory_user ON password_history(user_id, changed_at)')

            # v23 Round F: known_ips — svaki uspesan login upisuje IP-ove koje user redovno koristi.
            # Nova IP = email notifikacija ("New login from Belgrade, Serbia — was this you?").
            c.execute('''CREATE TABLE IF NOT EXISTS known_ips (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                ip TEXT NOT NULL,
                country TEXT,
                city TEXT,
                first_seen TEXT NOT NULL,
                last_seen TEXT NOT NULL,
                login_count INTEGER DEFAULT 1,
                UNIQUE(user_id, ip)
            )''')
            c.execute('CREATE INDEX IF NOT EXISTS idx_knownips_user ON known_ips(user_id)')

            # v23 Round F: magic_login_tokens — passwordless login link za CRM (email-based).
            # Alternativa za password reset flow. Jedan-put, TTL 15min, IP-bound.
            c.execute('''CREATE TABLE IF NOT EXISTS magic_login_tokens (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                purpose TEXT NOT NULL,          -- 'login' | 'unlock' | 'reset' | 'break_glass'
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                used_at TEXT,
                request_ip TEXT
            )''')
            c.execute('CREATE INDEX IF NOT EXISTS idx_magictok_user ON magic_login_tokens(user_id)')

            # v23 Round G: user_tasks — todo list per user (personal or assigned).
            c.execute('''CREATE TABLE IF NOT EXISTS user_tasks (
                id TEXT PRIMARY KEY,
                owner_user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                due_at TEXT,
                priority INTEGER DEFAULT 2,     -- 1=high 2=normal 3=low
                status TEXT DEFAULT 'open',     -- open | done | canceled
                linked_entity_type TEXT,
                linked_entity_id TEXT,
                created_at TEXT NOT NULL,
                completed_at TEXT
            )''')
            c.execute('CREATE INDEX IF NOT EXISTS idx_usertasks_owner ON user_tasks(owner_user_id, status)')
            c.execute('CREATE INDEX IF NOT EXISTS idx_usertasks_due ON user_tasks(due_at)')

            # v23 Round G: saved_filters — user cuva svoje "views" (partneri po zemlji, deals u pipeline itd).
            c.execute('''CREATE TABLE IF NOT EXISTS saved_filters (
                id TEXT PRIMARY KEY,
                owner_user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                filter_json TEXT NOT NULL,
                is_shared INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )''')
            c.execute('CREATE INDEX IF NOT EXISTS idx_savedfilters_owner ON saved_filters(owner_user_id, entity_type)')

            # v23.1 EXTRAS
            # -------------
            # custom_field_defs — admin definise dodatne kolone po entitetu (npr.
            # "SAP kod" na partneru, "Ovlasteni prodavac" chekbox na proizvodu).
            # Frontend proizvoljno renderuje polje na osnovu ovog kataloga.
            c.execute('''CREATE TABLE IF NOT EXISTS custom_field_defs (
                id TEXT PRIMARY KEY,
                entity_type TEXT NOT NULL,      -- partner | product | deal | offer | invoice | proforma
                field_key TEXT NOT NULL,        -- snake_case identifikator
                field_label TEXT NOT NULL,
                field_type TEXT NOT NULL,       -- text | number | date | bool | select | url | email
                options_json TEXT,              -- za select-e: ["A","B","C"]
                required INTEGER DEFAULT 0,
                display_order INTEGER DEFAULT 100,
                is_active INTEGER DEFAULT 1,
                created_at TEXT NOT NULL,
                UNIQUE(entity_type, field_key)
            )''')
            c.execute('CREATE INDEX IF NOT EXISTS idx_cfd_entity ON custom_field_defs(entity_type, is_active)')

            # api_keys — spoljni sistemi (Zapier, custom bots) mogu da pristupe /api/v1/*
            # koriscenjem Bearer <key>. Cuvamo samo hash (SHA-256).
            c.execute('''CREATE TABLE IF NOT EXISTS api_keys (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                key_hash TEXT NOT NULL UNIQUE,
                key_prefix TEXT NOT NULL,       -- prvih 8 char, prikazano u UI za identifikaciju
                owner_user_id TEXT NOT NULL,
                scope TEXT DEFAULT 'read',      -- read | write | admin
                rate_limit_per_min INTEGER DEFAULT 60,
                created_at TEXT NOT NULL,
                last_used_at TEXT,
                revoked INTEGER DEFAULT 0,
                revoked_at TEXT
            )''')
            c.execute('CREATE INDEX IF NOT EXISTS idx_apikey_owner ON api_keys(owner_user_id, revoked)')

            # outbound_webhooks — admin registruje URL + event mask ("deal.created,offer.sent")
            # server salje POST kada se event desi, sa HMAC potpisom.
            c.execute('''CREATE TABLE IF NOT EXISTS outbound_webhooks (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                target_url TEXT NOT NULL,
                events TEXT NOT NULL,           -- CSV: deal.created,invoice.paid,offer.accepted
                secret TEXT NOT NULL,           -- za HMAC verifikaciju
                is_active INTEGER DEFAULT 1,
                created_at TEXT NOT NULL,
                created_by TEXT,
                last_fired_at TEXT,
                last_status TEXT,               -- 'ok' | '4xx' | '5xx' | 'timeout'
                fail_count INTEGER DEFAULT 0
            )''')
            c.execute('CREATE INDEX IF NOT EXISTS idx_webhook_active ON outbound_webhooks(is_active)')

            # webhook_deliveries — audit log outbound webhook slanja
            c.execute('''CREATE TABLE IF NOT EXISTS webhook_deliveries (
                id TEXT PRIMARY KEY,
                webhook_id TEXT NOT NULL,
                event TEXT NOT NULL,
                payload_hash TEXT,
                status_code INTEGER,
                response_snippet TEXT,
                delivered_at TEXT NOT NULL,
                duration_ms INTEGER
            )''')
            c.execute('CREATE INDEX IF NOT EXISTS idx_delivery_webhook ON webhook_deliveries(webhook_id, delivered_at)')

            # v22: file_text — OCR/text extract cache za KYC uploads.
            # Kada admin trazi "svi partneri koji imaju rec X u dokumentima",
            # ova tabela je full-text search index. Popunjava se u background
            # thread-u odmah posle uspesnog uploada.
            c.execute('''CREATE TABLE IF NOT EXISTS file_text (
                id TEXT PRIMARY KEY,
                file_url TEXT NOT NULL UNIQUE,
                partner_id TEXT,
                filename TEXT,
                content_type TEXT,
                text_preview TEXT,
                full_text TEXT,
                char_count INTEGER,
                extracted_at TEXT
            )''')
            c.execute('CREATE INDEX IF NOT EXISTS idx_filetext_partner ON file_text(partner_id)')
            c.execute('CREATE INDEX IF NOT EXISTS idx_filetext_url ON file_text(file_url)')

            # v22 Round A: entity_notes — nested notes per entity (partner/deal/offer/product)
            c.execute('''CREATE TABLE IF NOT EXISTS entity_notes (
                id TEXT PRIMARY KEY,
                entity_type TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                body TEXT NOT NULL,
                created_by TEXT,
                created_at TEXT NOT NULL,
                pinned INTEGER DEFAULT 0
            )''')
            c.execute('CREATE INDEX IF NOT EXISTS idx_entnotes_entity ON entity_notes(entity_type, entity_id)')
            c.execute('CREATE INDEX IF NOT EXISTS idx_entnotes_created_at ON entity_notes(created_at)')

            # v22 Round A: deal_documents — arbitrary file attachments per deal
            c.execute('''CREATE TABLE IF NOT EXISTS deal_documents (
                id TEXT PRIMARY KEY,
                deal_id TEXT NOT NULL,
                file_url TEXT NOT NULL,
                filename TEXT NOT NULL,
                doc_kind TEXT,
                size_bytes INTEGER,
                uploaded_by TEXT,
                uploaded_at TEXT NOT NULL,
                note TEXT
            )''')
            c.execute('CREATE INDEX IF NOT EXISTS idx_dealdocs_deal ON deal_documents(deal_id)')

            # v22 Round B: custom_reports — admin-defined saved SELECT queries
            c.execute('''CREATE TABLE IF NOT EXISTS custom_reports (
                id TEXT PRIMARY KEY,
                owner_user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT,
                sql_query TEXT NOT NULL,
                chart_type TEXT,        -- 'kpi' | 'bar' | 'line' | 'pie' | 'table'
                is_shared INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )''')
            c.execute('CREATE INDEX IF NOT EXISTS idx_customreports_owner ON custom_reports(owner_user_id)')
            
            # Kreiranje tabela za sve entitete
            tables = ['partners', 'products', 'deals', 'demands', 'accounts', 'transactions', 'recurringExpenses', 'connections', 'offers', 'shared_documents']
            for table in tables:
                c.execute(f'''CREATE TABLE IF NOT EXISTS {table} (id TEXT PRIMARY KEY, data TEXT)''')

            # DOCUMENT REGISTER — trajni zapis SVIH izdatih dokumentacionih brojeva
            # sa strogim UNIQUE constraint-om koji sprečava dupliranje. Broj se
            # rezerviše atomično čim admin klikne "Pošalji". Nikad se ne briše.
            c.execute('''CREATE TABLE IF NOT EXISTS document_register (
                docType TEXT NOT NULL,
                year INTEGER NOT NULL,
                seq INTEGER NOT NULL,
                docNumber TEXT NOT NULL,
                entityId TEXT,
                revision INTEGER DEFAULT 0,
                status TEXT DEFAULT 'active',
                issuedAt TEXT NOT NULL,
                issuedBy TEXT,
                PRIMARY KEY (docType, year, seq, revision)
            )''')
            c.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_docreg_number ON document_register(docNumber)')
            c.execute('CREATE INDEX IF NOT EXISTS idx_docreg_entity ON document_register(entityId)')

            # DOCUMENT REVISIONS — svaka izmena izdatog dokumenta se snima kao
            # potpun snapshot podataka + hash + reason. Ovim se za bilo koji broj
            # dokumenta u istoriji može rekonstruisati SVAKA verzija.
            c.execute('''CREATE TABLE IF NOT EXISTS document_revisions (
                id TEXT PRIMARY KEY,
                docNumber TEXT NOT NULL,
                revision INTEGER NOT NULL,
                entityId TEXT,
                snapshot TEXT NOT NULL,
                contentHash TEXT,
                bindingHash TEXT,
                changeReason TEXT,
                changedBy TEXT,
                changedAt TEXT NOT NULL
            )''')
            c.execute('CREATE INDEX IF NOT EXISTS idx_docrev_number ON document_revisions(docNumber)')

            # OFFER VERSIONS — svaki put kada se ponuda menja (cena, količina,
            # incoterm, stavke…) prethodna verzija se snima ovde. Ovo daje admin-u
            # potpunu istoriju "šta je bilo, šta je klijent video pre pregovora,
            # ko je i kada šta izmenio i zašto". Snapshot je pun JSON stare
            # ponude — tako se svaka verzija može ponovo generisati kao PDF.
            c.execute('''CREATE TABLE IF NOT EXISTS offer_versions (
                id TEXT PRIMARY KEY,
                offerId TEXT NOT NULL,
                version INTEGER NOT NULL,
                snapshot TEXT NOT NULL,
                changedFields TEXT,
                changeReason TEXT,
                changedBy TEXT,
                changedByRole TEXT,
                changedAt TEXT NOT NULL,
                origin TEXT
            )''')
            c.execute('CREATE INDEX IF NOT EXISTS idx_offerver_offer ON offer_versions(offerId)')
            c.execute('CREATE INDEX IF NOT EXISTS idx_offerver_at ON offer_versions(changedAt)')

            # ==========================================================
            # FAZA 5: PER-PARTNER INVENTORY
            # ==========================================================
            # partner_inventory drzi TRENUTNO stanje po (partner_id, product_id).
            # inventory_movements je append-only istorija svake IN/OUT/ADJUST/
            # RESERVE/RELEASE operacije, sa opcionim dealId za traceability.
            # UNIQUE (partner_id, product_id) obezbedjuje jednu row po parceli.
            c.execute('''CREATE TABLE IF NOT EXISTS partner_inventory (
                id TEXT PRIMARY KEY,
                partner_id TEXT NOT NULL,
                product_id TEXT NOT NULL,
                qty_on_hand REAL NOT NULL DEFAULT 0,
                qty_reserved REAL NOT NULL DEFAULT 0,
                unit TEXT,
                last_movement_at TEXT,
                UNIQUE(partner_id, product_id)
            )''')
            c.execute('CREATE INDEX IF NOT EXISTS idx_partinv_partner ON partner_inventory(partner_id)')
            c.execute('CREATE INDEX IF NOT EXISTS idx_partinv_product ON partner_inventory(product_id)')

            c.execute('''CREATE TABLE IF NOT EXISTS inventory_movements (
                id TEXT PRIMARY KEY,
                partner_id TEXT NOT NULL,
                product_id TEXT NOT NULL,
                kind TEXT NOT NULL,        -- IN | OUT | ADJUST | RESERVE | RELEASE
                qty REAL NOT NULL,
                unit TEXT,
                deal_id TEXT,
                note TEXT,
                created_at TEXT NOT NULL,
                created_by TEXT
            )''')
            c.execute('CREATE INDEX IF NOT EXISTS idx_invmov_partner ON inventory_movements(partner_id)')
            c.execute('CREATE INDEX IF NOT EXISTS idx_invmov_deal ON inventory_movements(deal_id)')
            c.execute('CREATE INDEX IF NOT EXISTS idx_invmov_at ON inventory_movements(created_at)')

########## --- NOVA LINIJA KODA ZA EMAIL RED ČEKANJA ---
            c.execute('''CREATE TABLE IF NOT EXISTS email_queue (
                id TEXT PRIMARY KEY, recipient TEXT NOT NULL, subject TEXT,
                plain_body TEXT, html_body TEXT, attachments_ref TEXT,
                attempts INTEGER DEFAULT 0, last_error TEXT,
                queued_at TEXT NOT NULL, next_retry_at TEXT, status TEXT DEFAULT 'pending'
            )''')

            # Ako je baza prazna (nema korisnika), kreiraj početnog admina da se izbegne
            # zaključavanje van sistema (npr. sveža baza na produkciji).
            seed_admin_if_empty(c)

            conn.commit()
    except Exception as e:
        logger.error(f"CRITICAL: Greška pri inicijalizaciji glavne baze - {e}")

    # 2. B2B PORTAL BAZA
    try:
        with db.connect_raw(PORTAL_DB_FILE, timeout=30.0) as conn2:
            conn2.execute('PRAGMA journal_mode=WAL;')
            conn2.execute('PRAGMA synchronous=NORMAL;')
            c2 = conn2.cursor()
            
            # Kreiranje tabela
            c2.execute('''CREATE TABLE IF NOT EXISTS kyc_submissions (id TEXT PRIMARY KEY, partner_id TEXT, token TEXT, data TEXT, submitted_at TEXT)''')
            c2.execute('''CREATE TABLE IF NOT EXISTS portal_products (id TEXT PRIMARY KEY, partner_id TEXT, data TEXT, status TEXT, created_at TEXT)''')
            # Zahtevi partnera za izmenu sopstvenih podataka (email, telefon, adresa...).
            # Ne primenjuju se direktno — admin ih odobrava, tek onda idu u partner profil.
            c2.execute('''CREATE TABLE IF NOT EXISTS profile_change_requests (id TEXT PRIMARY KEY, partner_id TEXT, data TEXT, status TEXT, submitted_at TEXT, reviewed_at TEXT, reviewed_by TEXT)''')
            
            # KREIRANJE INDEKSA (Ključno za optimizaciju i brzinu kada sistem ima mnogo upita)
            c2.execute('''CREATE INDEX IF NOT EXISTS idx_kyc_token ON kyc_submissions(token)''')
            c2.execute('''CREATE INDEX IF NOT EXISTS idx_kyc_partner ON kyc_submissions(partner_id)''')
            c2.execute('''CREATE INDEX IF NOT EXISTS idx_portal_products_partner ON portal_products(partner_id)''')
            
            conn2.commit()
    except Exception as e:
        logger.error(f"CRITICAL: Greška pri inicijalizaciji portal baze - {e}")

    # 3. VOJNA AUDIT BAZA
    # SAMO-ISCELJENJE: ako je audit baza malformed (npr. prekinut upis tokom
    # deploy-a), NE blokiramo ceo startup. Audit logovi su zamenljivi (istorija
    # pristupa, ne poslovni podaci), pa oštećenu bazu premeštamo u
    # .malformed.<ts> backup i pravimo novu. Ovo omogućava da se aplikacija
    # sama oporavi na sledeći Reload umesto da klijenti stoje blokirani.
    def _init_audit(recreate_on_corrupt=True):
        with db.connect_raw(AUDIT_DB_FILE, timeout=30.0) as conn3:
            conn3.execute('PRAGMA journal_mode=WAL;')
            conn3.execute('PRAGMA synchronous=NORMAL;')
            # integrity_check baca / vraća loše ako je fajl malformed
            integ = conn3.execute('PRAGMA integrity_check').fetchone()
            if integ and integ[0] != 'ok' and recreate_on_corrupt:
                raise sqlite3.DatabaseError(f'audit integrity: {integ[0]}')
            c3 = conn3.cursor()
            c3.execute('''CREATE TABLE IF NOT EXISTS audit_logs
                         (id TEXT PRIMARY KEY, user_id TEXT, username TEXT, action TEXT, module TEXT, details TEXT, ip_address TEXT, user_agent TEXT, timestamp TEXT, is_suspicious BOOLEAN, location TEXT)''')
            c3.execute('''CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp)''')
            c3.execute('''CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(username)''')
            c3.execute('''CREATE INDEX IF NOT EXISTS idx_audit_suspicious ON audit_logs(is_suspicious)''')
            conn3.commit()

    try:
        _init_audit()
    except Exception as e:
        # Malformed ili nedostupna audit baza — quarantine + fresh recreate
        import time as _t
        try:
            if os.path.exists(AUDIT_DB_FILE):
                quarantine = f'{AUDIT_DB_FILE}.malformed.{int(_t.time())}'
                os.rename(AUDIT_DB_FILE, quarantine)
                logger.error(f'AUDIT DB malformed ({e}) — premešten u {quarantine}, pravim novu praznu.')
            # Ukloni WAL/SHM ostatke da nova baza krene čista
            for suffix in ('-wal', '-shm'):
                p = AUDIT_DB_FILE + suffix
                if os.path.exists(p):
                    try: os.remove(p)
                    except Exception: pass
            _init_audit(recreate_on_corrupt=False)
            logger.warning('AUDIT DB uspešno rekreirana (prazna). Stara istorija je u .malformed backup fajlu.')
        except Exception as e2:
            logger.error(f"CRITICAL: Ne mogu ni da rekreiram audit bazu: {e2}")