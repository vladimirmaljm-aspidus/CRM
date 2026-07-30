# 🚀 ASPIDUS CRM — Kompletan Vodič za Deploy na Render

## Sadržaj
1. [Pregled](#1-pregled)
2. [Priprema GitHub Repo-a](#2-priprema-github-repo-a)
3. [Podešavanje Supabase](#3-podešavanje-supabase)
4. [Deploy na Render](#4-deploy-na-render)
5. [Environment Varijable](#5-environment-varijable)
6. [Prva Prijava](#6-prva-prijava)
7. [Rešavanje Problema](#7-rešavanje-problema)

---

## 1. Pregled

### Šta je ispravljeno u ovoj verziji:
- ✅ Uklonjen hardcoded SECRET_KEY — koristi se env varijabla
- ✅ Admin lozinka više nije "Admin12345" — generiše se random
- ✅ SQL Injection zaštita dodata u v23_extras i v23_admin
- ✅ Popravljen prekinut magic link login na portalu
- ✅ Dodat xml.sax import u geo.py
- ✅ Uklonjene duplirane rute i mrtav kod
- ✅ Dodat `fields.premiumClient` u prevode
- ✅ Prevedeni neprevedeni SR stringovi
- ✅ Dodata `users` tabela u Supabase šemu
- ✅ Popravljena requirements.txt (dodatak Pillow, python-docx)
- ✅ Dodat render.yaml za Render deploy
- ✅ Dodat .env.example sa svim varijablama
- ✅ Dodat .gitignore

### Arhitektura:
- **Backend**: Flask (Python) + SQLite (baza) + Supabase (opciono)
- **Frontend**: Vanilla JS + Tailwind CSS
- **Deploy**: Render (besplatni plan)
- **Baza**: SQLite na Render disku (besplatni plan = efemerni disk!)
- **⚠️ VAŽNO**: Besplatni Render plan NEMA trajni disk — baza se briše pri svakom re-deployu!

---

## 2. Priprema GitHub Repo-a

### Korak 1: Kreiraj novi GitHub repo
1. Idi na https://github.com/new
2. Ime: `aspidus-crm` (ili bilo šta)
3. **PRIVATE** repo (kod je osetljiv!)
4. Ne dodaj README, .gitignore ni licencu
5. Klikni "Create repository"

### Korak 2: Uploaduj sve fajlove
1. Skini sve fajlove iz `aspiduscrmV22.04.05/` foldera
2. Otvori terminal na tvom kompjuteru:
```bash
cd aspiduscrmV22.04.05
git init
git add .
git commit -m "AspidusCRM V22.04.05 - production ready"
git branch -M main
git remote add origin https://github.com/TVOJ-USERNAME/aspidus-crm.git
git push -u origin main
```

**ILI** ako ne koristiš terminal:
1. Idi na GitHub repo stranicu
2. Klikni "uploading an existing file"
3. Prevuci sve fajlove i foldere
4. Klikni "Commit changes"

### Korak 3: Proveri da li su svi fajlovi tu
Proveri da sledeći fajlovi postoje:
- [ ] `app.py`
- [ ] `config.py`
- [ ] `database.py`
- [ ] `db.py`
- [ ] `requirements.txt`
- [ ] `render.yaml`
- [ ] `Procfile`
- [ ] `.env.example`
- [ ] `.gitignore`
- [ ] `schemas/supabase_schema.sql`
- [ ] `routes/` folder sa svim .py fajlovima
- [ ] `templates/` folder sa svim .html fajlovima
- [ ] `static/` folder sa svim JS/CSS fajlovima
- [ ] `data/` folder sa JSON fajlovima
- [ ] `portal_uploads/` folder sa .gitkeep
- [ ] `uploads/` folder sa .gitkeep

---

## 3. Podešavanje Supabase (OPCIONO — za B2B portal)

> **Ako ne koristiš B2B portal**, možeš da preskočiš ovaj korak. Portal će raditi sa legacy OTP loginom bez Supabase-a.

### Korak 1: Kreiraj Supabase projekat
1. Idi na https://supabase.com/dashboard
2. Klikni "New Project"
3. Ime: `aspidus-crm`
4. Postavi jaku lozinku za bazu
5. Region: izaberi najbliži (npr. Frankfurt)
6. Klikni "Create new project"

### Korak 2: Pokreni SQL šemu
1. U Supabase Dashboard → SQL Editor → New query
2. Kopiraj SADRŽAJ fajla `schemas/supabase_schema.sql`
3. Klikni "Run"
4. Proveri da li imaš 16+ tabela:
```sql
SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1;
```

### Korak 3: Zapiši ključeve
Iz Supabase Dashboard → Settings → API:
- **Project URL** → `SUPABASE_URL`
- **anon public** → `SUPABASE_ANON_KEY`
- **service_role** → `SUPABASE_SERVICE_ROLE_KEY` (⚠️ ČUVAJ OVO!)
- **JWT Secret** → `SUPABASE_JWT_SECRET` (Settings → API → JWT Settings)

### Korak 4: Kreiraj Storage bucket-e (ako koristiš Supabase Storage)
1. Storage → New bucket
2. Kreiraj: `offer-pdfs`, `partner-docs`, `portal-uploads`

---

## 4. Deploy na Render

### Korak 1: Kreiraj Render nalog
1. Idi na https://dashboard.render.com/register
2. Registruj se sa GitHub nalogom

### Korak 2: Kreiraj Web Service
1. Klikni "New +" → "Web Service"
2. Izaberi tvoj `aspidus-crm` GitHub repo
3. Ako Render pita za pristup, odobri ga
4. Podesi:
   - **Name**: `aspidus-crm`
   - **Runtime**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn app:app --workers 2 --timeout 120 --bind 0.0.0.0:$PORT`
   - **Instance Type**: `Free`
5. Ne klikni još "Create Web Service" — prvo dodaj env varijable!

### Korak 3: Dodaj Environment Varijable
Pre klik na "Create", dodaj SLEDEĆE environment varijable (klikni "Advanced" → "Add Environment Variable"):

#### OBAVEZNE:
| Key | Value | Kako napraviti |
|-----|-------|----------------|
| `SECRET_KEY` | (random string) | Pokreni: `python3 -c "import secrets; print(secrets.token_urlsafe(64))"` |
| `ENCRYPTION_KEY` | (Fernet key) | Pokreni: `python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `ADMIN_PASSWORD` | (tvoja lozinka) | Izaberi jaku lozinku za admin nalog! |
| `SESSION_COOKIE_SECURE` | `true` | Tačno ovako |
| `APP_BASE_URL` | `https://aspidus-crm.onrender.com` | Tvoj Render URL (posle deploy-a možeš da promeniš) |

#### SUPABASE (ako koristiš):
| Key | Value |
|-----|-------|
| `USE_SUPABASE_AUTH` | `true` |
| `USE_SUPABASE_STORAGE` | `true` |
| `SUPABASE_URL` | `https://xxxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | (tvoj ključ) |
| `SUPABASE_JWT_SECRET` | (tvoj ključ) |
| `SUPABASE_ANON_KEY` | (tvoj ključ) |

### Korak 4: Deploy!
1. Klikni "Create Web Service"
2. Render će početi da gradi aplikaciju (traje 2-5 min)
3. Prati log u realnom vremenu
4. Kada vidiš "Deploy successful", aplikacija je gotova!

### Korak 5: Proveri
1. Klikni na URL aplikacije (npr. `https://aspidus-crm.onrender.com`)
2. Treba da vidiš login stranicu
3. Prijavi se sa admin/admin (ili ADMIN_PASSWORD ako si ga postavio)

---

## 5. Environment Varijable — Kompletna Lista

| Varijabla | Obavezna | Default | Opis |
|-----------|---------|---------|------|
| `SECRET_KEY` | ✅ DA | Auto-gen | Flask sesijski ključ — MORA biti isti pri svakom deploy-u! |
| `ENCRYPTION_KEY` | ✅ DA | Auto-gen | Fernet ključ za šifrovanje — MORA biti isti! |
| `ADMIN_PASSWORD` | ✅ DA | Random | Lozinka za admin nalog |
| `SESSION_COOKIE_SECURE` | ✅ DA | false | Postavi na `true` za HTTPS |
| `APP_BASE_URL` | Preporučeno | - | URL aplikacije za email linkove |
| `DATA_DIR` | NE | /opt/render/... | Folder za bazu i fajlove |
| `USE_SUPABASE_AUTH` | NE | false | Koristi Supabase za portal auth |
| `USE_SUPABASE_STORAGE` | NE | false | Koristi Supabase za fajlove |
| `SUPABASE_URL` | Uslovno | - | Supabase URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Uslovno | - | Supabase service ključ |
| `SUPABASE_JWT_SECRET` | Uslovno | - | Supabase JWT secret |
| `SUPABASE_ANON_KEY` | Uslovno | - | Supabase javni ključ |
| `MAX_CONTENT_LENGTH` | NE | 100 | Maks upload MB |
| `ADMIN_USERNAME` | NE | admin | Korisničko ime admina |

---

## 6. Prva Prijava

### Ako si postavio ADMIN_PASSWORD:
1. Otvori tvoj Render URL
2. Korisničko ime: `admin`
3. Lozinka: (tvoja ADMIN_PASSWORD vrednost)

### Ako NISI postavio ADMIN_PASSWORD:
1. Otvori Render logove (Dashboard → tvoj servis → Logs)
2. Traži liniju: `SEED: Lozinka: Admin-xxxxxxxxxxxx`
3. Kopiraj tu lozinku
4. Prijavi se sa admin / (kopirana lozinka)
5. ODMAH promeni lozinku u Moj Profil!

---

## 7. Rešavanje Problema

### Problem: "Application Error" na Render-u
1. Proveri logove (Dashboard → Logs)
2. Najčešći uzrok: nedostaje env varijabla
3. Dodaj SECRET_KEY i ENCRYPTION_KEY

### Problem: Baza se briše pri svakom deploy-u
**Ovo je OGRANIČENJE besplatnog Render plana!**
- Besplatni plan NEMA trajni disk
- Baza i uploadi se briše pri svakom re-deploy-u
- **Rešenje**: Koristi Supabase za bazu i storage (zatim postavi `DB_BACKEND=rest`)

### Problem: Spabaš ne radi
1. Proveri da li je `USE_SUPABASE_AUTH=true`
2. Proveri da li su svi SUPABASE_* env varijable postavljene
3. Proveri da li je SQL šema pokrenuta u Supabase Dashboard

### Problem: Ne mogu da se prijavim na portal
1. Proveri SMTP podešavanja (portal šalje OTP email)
2. Bez SMTP-a, OTP se ne može poslati
3. Za testiranje: postavi `TEST_MODE=1` i koristi test endpoint

### Problem: Render se "uspavljuje" (Sleep)
- Besplatni plan uspavljuje aplikaciju nakon 15 min neaktivnosti
- Prvi zahtev posle spavanja traje ~30 sekundi
- **Rešenje**: Koristi besplatni cron servis (npr. cron-job.org) da pinguješ aplikaciju svakih 10 min

### Problem: "CSRF token invalid"
1. Očisti keš pregledača
2. Proveri da li je frontend ispravno dohvata CSRF token
3. Ako koristiš reverse proxy, proveri ProxyFix konfiguraciju

---

## ⚠️ VAŽNA NAPOMENA O BESPLATNOM RENDER PLANU

Besplatni Render plan ima sledeća ograničenja:
1. **Nema trajnog diska** — SQLite baza i uploadi se brišu pri re-deploy-u
2. **Aplikacija se uspavljuje** nakon 15 min neaktivnosti
3. **750 sati/mesečno** — dovoljno za jednu aplikaciju 24/7
4. **512 MB RAM** — dovoljno za CRM

### Preporuka za produkciju:
- **Starter plan ($7/mes)** — dobijaš trajni disk i nema uspavljivanja
- Ili koristi **Supabase** za bazu i storage (besplatno do 500MB)

---

## 📋 CHECKLIST PRE DEPLOY-A

- [ ] GitHub repo kreiran sa SVIM fajlovima
- [ ] `SECRET_KEY` generisan i zapisan
- [ ] `ENCRYPTION_KEY` generisan i zapisan
- [ ] `ADMIN_PASSWORD` postavljen
- [ ] `SESSION_COOKIE_SECURE=true` postavljeno
- [ ] `APP_BASE_URL` postavljen na Render URL
- [ ] Supabase SQL šema pokrenuta (ako koristiš Supabase)
- [ ] Supabase ključevi zapisani (ako koristiš Supabase)
- [ ] SMTP podešavanja spremna (ako koristiš portal email)
- [ ] Render servis kreiran sa svim env varijablama
- [ ] Aplikacija uspešno deploy-ovana
- [ ] Admin login funkcioniše
- [ ] B2B portal dostupan (ako koristiš)
