"""Profesionalno slanje mejlova sa HTML šablonima i confidentiality footer-om.

Centralizovano zbog konzistentnog brendinga i pravnih napomena. Svaki mejl
poslat iz sistema koristi ISTU strukturu: header sa firmom → poruka → footer
sa confidentiality disclaimerom. Ako SMTP nije podešen ili poziv padne,
funkcija se blago vraća bez izuzetka i loguje razlog u audit."""

import db
import base64
import json
import logging
import smtplib
import sqlite3
import threading
import urllib.request
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from config import DB_FILE
from utils import decrypt_data, log_audit

logger = logging.getLogger(__name__)


def _get_smtp_settings():
    """Učitava SMTP kredencijale iz baze (comms_settings) i podatke firme."""
    try:
        with db.connect_raw(DB_FILE) as conn:
            c = conn.cursor()
            c.execute("SELECT value FROM settings WHERE key='comms_settings'")
            smtp_row = c.fetchone()
            c.execute("SELECT value FROM settings WHERE key='company'")
            comp_row = c.fetchone()
    except Exception:
        return None, None
    smtp = decrypt_data(smtp_row[0]) if smtp_row and smtp_row[0] else None
    company = decrypt_data(comp_row[0]) if comp_row and comp_row[0] else None
    return (smtp if isinstance(smtp, dict) else None), (company if isinstance(company, dict) else None)


def _brand_pieces(company):
    """Vraća (naziv, adresa, taxId, sender_name, sender_email_hint) — sve
    kao string podesan za HTML."""
    company = company or {}
    return {
        "name": company.get("name") or "Aspidus",
        "address": (company.get("address") or "").replace("\n", ", "),
        "taxId": company.get("taxId") or "",
        "logoUrl": company.get("logoUrl") or "",
        "brandColor": company.get("brandColor") or "#2563eb",
    }


def _html_wrap(subject_line, body_html, company, cta_url=None, cta_label=None):
    """Vraća HTML sa headerom firme, sadržajem i confidentiality footer-om."""
    b = _brand_pieces(company)
    cta_block = ""
    if cta_url and cta_label:
        cta_block = (
            f"<div style='text-align:center;padding:24px 0;'>"
            f"<a href='{cta_url}' style='display:inline-block;background:{b['brandColor']};color:#ffffff;"
            f"padding:14px 30px;border-radius:8px;text-decoration:none;font-weight:600;"
            f"font-family:Arial,sans-serif;font-size:14px;letter-spacing:0.02em;'>"
            f"{cta_label}"
            f"</a></div>"
        )

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{subject_line}</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;color:#101828;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f9;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background:#ffffff;border:1px solid #e7eaef;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(16,24,40,0.04);">
        <tr>
          <td style="background:{b['brandColor']};padding:24px 32px;text-align:left;">
            <div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.02em;">{b['name']}</div>
            <div style="color:rgba(255,255,255,0.7);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.15em;margin-top:4px;">Corporate Communication</div>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            {body_html}
            {cta_block}
          </td>
        </tr>
        <tr>
          <td style="background:#f4f6f9;padding:20px 32px;border-top:1px solid #e7eaef;font-size:11px;color:#667085;line-height:1.6;">
            <p style="margin:0 0 8px 0;font-weight:600;color:#101828;">CONFIDENTIALITY NOTICE</p>
            <p style="margin:0 0 8px 0;">This message and any documents attached are strictly confidential and are intended solely for the addressee named. If you are not the intended recipient, any disclosure, copying, distribution or use of this message is strictly prohibited. Please notify the sender immediately and delete this message.</p>
            <p style="margin:0;font-size:10px;color:#98a2b3;">{b['name']}{(' &middot; ' + b['address']) if b['address'] else ''}{(' &middot; Tax ID: ' + b['taxId']) if b['taxId'] else ''}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>"""



# Circuit breaker: broji SMTP failure-e u sliding window. Ako je bilo N failova
# u zadnjih M sekundi, sledeći SMTP send preskačemo (odmah park ili odbij).
# Bez ovoga: PythonAnywhere free tier blokira outbound SMTP → svaki send radi
# 4× retry sa exponential backoff (1+2+4+8 = 15s) → ako klijent klikne "Send"
# 5 puta, gubimo 75s CPU i punimo email_queue duplikatima.
_SMTP_FAILURES = []  # list of unix timestamps of recent failures
_SMTP_CB_THRESHOLD = 3       # failure count to trip
_SMTP_CB_WINDOW_S = 300      # 5 min sliding window
_SMTP_CB_OPEN_UNTIL = [0]    # unix ts; while now < this → circuit open, skip SMTP


def _smtp_circuit_open():
    """Vraća True ako smo trenutno u 'open' stanju (skip SMTP)."""
    import time as _t
    now = _t.time()
    if now < _SMTP_CB_OPEN_UNTIL[0]:
        return True
    return False


def _smtp_record_failure():
    """Beleži failure i eventualno otvara circuit breaker."""
    import time as _t
    now = _t.time()
    _SMTP_FAILURES.append(now)
    cutoff = now - _SMTP_CB_WINDOW_S
    while _SMTP_FAILURES and _SMTP_FAILURES[0] < cutoff:
        _SMTP_FAILURES.pop(0)
    if len(_SMTP_FAILURES) >= _SMTP_CB_THRESHOLD:
        # Trip: block SMTP for full window from last failure
        _SMTP_CB_OPEN_UNTIL[0] = now + _SMTP_CB_WINDOW_S
        _SMTP_FAILURES.clear()
        logger.error(f'SMTP circuit breaker TRIPPED — blocking SMTP for {_SMTP_CB_WINDOW_S}s. '
                     f'Configure Resend/SendGrid/Postmark in Settings > OTP Delivery to bypass.')


def _smtp_record_success():
    """Uspešan send resetuje failure counter."""
    _SMTP_FAILURES.clear()
    _SMTP_CB_OPEN_UNTIL[0] = 0


def _send(recipient, subject, html_body, plain_body, attachments=None):
    """Šalje mejl. Vraća (ok, error_msg).

    attachments: opciona lista dict-ova [{'filename': str, 'data': bytes}].
    Podržava PDF-ove i druge binarne fajlove — koristi se iz admin-ovog
    'Send Email' modala za slanje ponuda/faktura klijentu.

    v22 FIX: pre bilo kakvog SMTP pokušaja pokušava:
      1. Resend/SendGrid/Postmark preko mail_providers (ako je konfigurisan)
      2. Ako je SMTP circuit breaker otvoren (previše skorih fail-ova) → park odmah
      3. Inače: SMTP sa 4× retry (kao ranije)
    """
    # STEP 1 — pluggable transactional provider (Resend/SendGrid/Postmark)
    # Ovi API-ji rade nezavisno od SMTP-a; PythonAnywhere ih ne blokira jer
    # koriste HTTPS na standardne portove. Deliverability je uvek veći nego
    # SMTP sa personalnog naloga.
    try:
        from mail_providers import _load_config as _mp_cfg
        _cfg = _mp_cfg()
        _provider = str(_cfg.get('provider', 'smtp')).lower()
        if _provider in ('resend', 'sendgrid', 'postmark'):
            from mail_providers import send_transactional
            ok, info = send_transactional(recipient, subject, html_body, plain_body or '')
            if ok:
                logger.info(f'{_provider} send OK to {recipient}')
                _smtp_record_success()
                return True, None
            # Provider fail — proceed to SMTP fallback (ne park odmah — SMTP može uspeti)
            logger.warning(f'{_provider} send failed for {recipient}: {info}; trying SMTP fallback')
    except Exception as e:
        logger.debug(f'mail_providers not available: {e}')

    # STEP 2 — circuit breaker: ako je SMTP nedavno uzastopno padao (npr.
    # network unreachable na PythonAnywhere free tier), NE pokušavaj ponovo —
    # park direktno u queue i return. Bez ovoga svaki OTP send košta 15s CPU.
    if _smtp_circuit_open():
        try:
            _park_in_queue(recipient, subject, plain_body, html_body, attachments,
                           'SMTP circuit breaker open — skipped direct attempt')
        except Exception: pass
        return False, "SMTP_CIRCUIT_OPEN"

    smtp, company = _get_smtp_settings()
    if not smtp:
        return False, "SMTP_NOT_CONFIGURED"

    server_host = smtp.get("smtpServer")
    server_port = int(smtp.get("smtpPort") or 587)
    user = smtp.get("smtpUser")
    pw = smtp.get("smtpPass")
    security = smtp.get("smtpSecurity", "tls")
    sender_name = smtp.get("senderName") or (company or {}).get("name") or "Aspidus"
    sender_email = smtp.get("senderEmail") or user

    if not (server_host and user and pw and recipient):
        return False, "SMTP_INCOMPLETE_OR_NO_RECIPIENT"

    # ==========================================================
    # POSTMARK HTTP TUNNEL — zaobilaženje SMTP firewall-a (PA free/starter)
    # ==========================================================
    # Ako je admin konfigurisao Postmark SMTP (smtp.postmarkapp.com) i platforma
    # blokira SMTP odlazni saobraćaj (25/465/587), i dalje možemo da šaljemo
    # preko standardnog HTTPS-a (443) direktno na Postmark API. Isti server token
    # (smtpPass) služi kao X-Postmark-Server-Token. Podržava attachments preko
    # base64 enkodiranja. Ovo je "zlatna" opcija za PythonAnywhere free tier
    # jer HTTP outbound uvek radi.
    if "postmarkapp" in str(server_host).lower():
        payload = {
            "From": f"{sender_name} <{sender_email}>",
            "To": recipient,
            "Subject": subject,
            "HtmlBody": html_body,
            "TextBody": plain_body or subject,
            "MessageStream": "outbound",
        }
        if attachments:
            postmark_atts = []
            for att in attachments:
                data = att.get("data")
                filename = att.get("filename", "document.pdf")
                if data:
                    postmark_atts.append({
                        "Name": filename,
                        "Content": base64.b64encode(data).decode('utf-8'),
                        "ContentType": "application/octet-stream",
                    })
            if postmark_atts:
                payload["Attachments"] = postmark_atts

        req = urllib.request.Request(
            "https://api.postmarkapp.com/email",
            data=json.dumps(payload).encode('utf-8'),
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "X-Postmark-Server-Token": pw.strip(),
            }
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                logger.info(f"Postmark HTTP TUNNEL send OK to {recipient}")
                _smtp_record_success()
                return True, None
        except Exception as e:
            err_msg = str(e)
            if hasattr(e, 'read'):
                try:
                    err_msg += " " + e.read().decode('utf-8', 'ignore')
                except Exception:
                    pass
            logger.error(f"Postmark HTTP TUNNEL error: {err_msg}")
            _smtp_record_failure()
            try:
                _park_in_queue(recipient, subject, plain_body, html_body, attachments, err_msg)
            except Exception:
                pass
            return False, err_msg

    # Ako ima priloga → koristimo "mixed" outer + "alternative" za text/html.
    # Ovo je RFC-preporučen redosled za HTML mejl sa attachmentima.
    if attachments:
        msg = MIMEMultipart("mixed")
        msg["Subject"] = subject
        msg["From"] = f"{sender_name} <{sender_email}>"
        msg["To"] = recipient
        alt = MIMEMultipart("alternative")
        alt.attach(MIMEText(plain_body or subject, "plain", "utf-8"))
        alt.attach(MIMEText(html_body, "html", "utf-8"))
        msg.attach(alt)
        for att in attachments:
            data = att.get("data"); filename = att.get("filename", "document.pdf")
            if not data:
                continue
            part = MIMEApplication(data, Name=filename)
            part["Content-Disposition"] = f'attachment; filename="{filename}"'
            msg.attach(part)
    else:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{sender_name} <{sender_email}>"
        msg["To"] = recipient
        msg.attach(MIMEText(plain_body or subject, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))

    # Retry logika sa exponential backoff. Gmail/PythonAnywhere SMTP zna da
    # baci prolazne TLS/handshake greške (SMTPServerDisconnected, socket.timeout,
    # SMTPResponseException 421/451). Bez retry-ja, ti korisnički mejlovi
    # jednostavno nestanu. Pokušavamo 4 puta sa 2s → 4s → 8s pauzama; ako
    # nakon toga i dalje pada, upisujemo u email_queue tabelu koju cron
    # kasnije retry-uje. Cilj: mejl NIKAD ne izgubljen tiho.
    import time as _time
    last_err = None
    for attempt in range(4):
        server = None
        try:
            if security == "ssl" or server_port == 465:
                server = smtplib.SMTP_SSL(server_host, server_port, timeout=20)
            else:
                server = smtplib.SMTP(server_host, server_port, timeout=20)
                server.ehlo()
                if security != "none":
                    server.starttls()
                    server.ehlo()
            server.login(user, pw)
            server.send_message(msg)
            server.quit()
            logger.info(f"SMTP send OK to {recipient} (attempt {attempt+1})")
            _smtp_record_success()
            return True, None
        except (smtplib.SMTPServerDisconnected, smtplib.SMTPConnectError,
                smtplib.SMTPResponseException, TimeoutError, OSError) as e:
            last_err = str(e)
            logger.warning(f"SMTP transient error to {recipient} attempt {attempt+1}: {e}")
            try:
                if server: server.close()
            except Exception: pass
            if attempt < 3:
                _time.sleep(2 ** attempt)  # 1, 2, 4 s
                continue
            # Poslednji pokušaj propao — parkiraj u queue umesto da nestane
            _smtp_record_failure()  # dokumentuje failure — circuit breaker može trip-nuti
            try: _park_in_queue(recipient, subject, plain_body, html_body,
                                attachments, last_err)
            except Exception as qerr:
                logger.error(f'email queue write failed: {qerr}')
            return False, f"TRANSIENT_AFTER_RETRIES: {last_err}"
        except smtplib.SMTPAuthenticationError as e:
            logger.error(f"SMTP AUTH failed: {e} — check smtpUser/smtpPass in Settings.")
            return False, "SMTP_AUTH_FAILED"
        except smtplib.SMTPRecipientsRefused as e:
            logger.error(f"SMTP recipient refused: {e}")
            return False, f"RECIPIENT_REFUSED: {recipient}"
        except Exception as e:
            last_err = str(e)
            logger.error(f"SMTP send permanent error to {recipient}: {e}")
            try: _park_in_queue(recipient, subject, plain_body, html_body,
                                attachments, last_err)
            except Exception: pass
            return False, str(e)
    return False, last_err


# Process-level lock — sprečava da paralelni pozivi process_email_queue
# (npr. background thread + manual /api/comms/retry_now klik) pokupe iste
# redove istovremeno. Kritično: bez ovoga smo videli 50 dupliranih mejlova
# u 10 min kad je baza bila kratkotrajno zaključana pa je background thread
# retry-jao dok manual retry već slao.
_QUEUE_WORKER_LOCK = threading.Lock()

# Stuck 'sending' rowovi stariji od ovog thresh-a se automatski vraćaju na
# 'pending' pri sledećem prolazu — insurance za slučaj da process crashne
# usred slanja pa red ostane zaključan.
_STUCK_SENDING_THRESHOLD_S = 300   # 5 min

# Hard cap: posle ovoga red ide u 'dead' i cron ga više ne dira. Admin mora
# ručno da reši šta se dešava.
_MAX_ATTEMPTS = 8


def _ensure_queue_schema(conn):
    """Kreira tabelu ako ne postoji + dodaje kolone iz kasnijih migracija.
    Idempotent — bezbedno je zvati svaki put."""
    conn.execute('''CREATE TABLE IF NOT EXISTS email_queue (
        id TEXT PRIMARY KEY,
        recipient TEXT NOT NULL,
        subject TEXT,
        plain_body TEXT,
        html_body TEXT,
        attachments_ref TEXT,
        attempts INTEGER DEFAULT 0,
        last_error TEXT,
        queued_at TEXT NOT NULL,
        next_retry_at TEXT,
        status TEXT DEFAULT 'pending'
    )''')
    # v22 migration — dodajemo lock kolone za row-level exclusion i idempotency
    cols = {r[1] for r in conn.execute("PRAGMA table_info(email_queue)").fetchall()}
    if 'sending_started_at' not in cols:
        conn.execute("ALTER TABLE email_queue ADD COLUMN sending_started_at TEXT")
    if 'worker_id' not in cols:
        conn.execute("ALTER TABLE email_queue ADD COLUMN worker_id TEXT")
    if 'sent_at' not in cols:
        conn.execute("ALTER TABLE email_queue ADD COLUMN sent_at TEXT")


def _park_in_queue(recipient, subject, plain_body, html_body, attachments, error):
    """Snima neuspeli mejl u email_queue tabelu tako da ga cron worker
    kasnije može retry-ovati. Cron radi svakih 60s dok queue ne bude prazna."""
    import uuid
    from datetime import datetime, timezone
    from config import DB_FILE
    try:
        conn = db.connect_raw(DB_FILE)
        _ensure_queue_schema(conn)
        now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        # Attachmente ne pakujemo (mogu biti veliki) — zapisujemo samo metadata;
        # sistem tehnički ne pokušava re-send attachmenata iz queue-a, jer je klijent
        # PRVI put dobio failure. Admin dobija reminder.
        atts_meta = json.dumps([{'filename': a.get('filename'),
                                  'size': len(a.get('data') or b'')}
                                for a in (attachments or [])])
        # attempts kreće od 3 jer je _send_email već potrošio 3 pokušaja pre park-a.
        # needs_admin status se ne obrađuje automatski — traži intervenciju.
        conn.execute(
            'INSERT INTO email_queue (id, recipient, subject, plain_body, '
            'html_body, attachments_ref, attempts, last_error, queued_at, '
            'next_retry_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            (str(uuid.uuid4()), recipient, subject, plain_body, html_body,
             atts_meta, 3, error, now, now, 'pending' if not attachments else 'needs_admin')
        )
        conn.commit()
        conn.close()
        logger.info(f'Parked mail to {recipient} in queue for retry')
    except Exception as e:
        logger.error(f'_park_in_queue failed: {e}')


def _recover_stuck_sending(conn, worker_id):
    """Vraća 'sending' redove starije od threshold-a nazad u 'pending'.
    Ovo se zove na početku svake process_email_queue iteracije da se ne
    desi da crash mid-send zauvek zaključa red."""
    from datetime import datetime, timezone, timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=_STUCK_SENDING_THRESHOLD_S))
    cutoff_iso = cutoff.isoformat().replace('+00:00', 'Z')
    res = conn.execute(
        "UPDATE email_queue SET status='pending', sending_started_at=NULL, worker_id=NULL "
        "WHERE status='sending' AND sending_started_at < ?",
        (cutoff_iso,)
    )
    if res.rowcount:
        logger.warning(f'[{worker_id}] recovered {res.rowcount} stuck sending row(s) → pending')


def _claim_next(conn, worker_id, now_iso):
    """Atomično uzima sledeći pending red i markira ga sa status='sending'.

    Race-safe pattern: UPDATE ... WHERE status='pending' AND next_retry_at <= now
    LIMIT 1 RETURNING *. Ovim se garantuje da čak i ako dva worker-a paralelno
    zovu queue processor u istom trenutku, samo jedan pobedi na svakom redu
    (SQLite serialize-uje UPDATE-e). Bez ovog pattern-a select+update sekvenca
    imala je window za double-pickup pod concurrency-jem.

    Vraća sqlite3.Row ili None.
    """
    # SQLite < 3.35 nema RETURNING; pouzdano radimo dvokorak pod istom transakcijom.
    # Isolation level je 'DEFERRED' default što znači BEGIN se otvara pri prvom
    # write-u; forsiramo IMMEDIATE da bi lock-ovali write pre selecta.
    conn.execute('BEGIN IMMEDIATE')
    row = conn.execute(
        "SELECT id, recipient, subject, plain_body, html_body, attempts "
        "FROM email_queue "
        "WHERE status='pending' AND (next_retry_at IS NULL OR next_retry_at <= ?) "
        "ORDER BY queued_at ASC LIMIT 1",
        (now_iso,)
    ).fetchone()
    if not row:
        conn.commit()
        return None
    conn.execute(
        "UPDATE email_queue SET status='sending', sending_started_at=?, worker_id=? "
        "WHERE id=? AND status='pending'",
        (now_iso, worker_id, row['id'])
    )
    conn.commit()  # persist claim odmah — nikad ne držimo lock preko network I/O
    return row


def process_email_queue(max_batch=10):
    """Cron worker — pokušava retry svih pending mejlova.

    KLJUČNI INVARIANTI protiv duplikata:
      1. Samo jedan worker u procesu istovremeno (threading.Lock).
      2. Svaki red se claim-uje kao 'sending' PRE mrežnog send-a (commit odmah).
      3. Uspešan send → status='sent' + commit ODMAH (per-row, ne batch).
      4. Neuspešan send → status vraćen na 'pending' sa uvećanim attempts.
         Ako attempts >= MAX → 'dead'.
      5. Ako claim commit uspe ali send/status commit padne (npr. DB zaključana),
         stuck 'sending' red se pri sledećem prolazu automatski recover-uje na
         'pending' posle 5 min timeout-a. NE šalje se ponovo pre nego što se
         recover-uje — što daje SMTP-u vreme da procesuira prethodni send.
    """
    import uuid
    from datetime import datetime, timezone, timedelta
    from config import DB_FILE

    stats = {'processed': 0, 'ok': 0, 'failed': 0, 'skipped': 0, 'recovered': 0, 'dead': 0}

    # Guard: dva paralelna poziva se ne mogu preklopiti u istom procesu.
    # non-blocking → drugi poziv jednostavno vrati 0 processed umesto da čeka.
    if not _QUEUE_WORKER_LOCK.acquire(blocking=False):
        logger.info('email queue worker already running — skipping this tick')
        return stats

    worker_id = f'w-{uuid.uuid4().hex[:8]}'
    try:
        # 1) startup / crash recovery
        try:
            conn = db.connect_raw(DB_FILE)
            conn.row_factory = sqlite3.Row
            _ensure_queue_schema(conn)
            _recover_stuck_sending(conn, worker_id)
            conn.commit()
            conn.close()
        except sqlite3.DatabaseError as db_err:
            # "database disk image is malformed" — ne spamuj log svakih 30s.
            # Loguj JEDNOM po worker-ID-u pa ućuti; admin mora ručno pokrenuti
            # scripts/db_recover.py da vrati bazu.
            msg = str(db_err).lower()
            if 'malformed' in msg or 'corrupt' in msg:
                if not getattr(process_email_queue, '_reported_corruption', False):
                    logger.critical(
                        f'[{worker_id}] DATABASE CORRUPTION detected: {db_err}. '
                        f'Email queue disabled until admin runs scripts/db_recover.py. '
                        f'Ovaj log neće se ponavljati dok se aplikacija ne restartuje.'
                    )
                    process_email_queue._reported_corruption = True
            else:
                logger.error(f'[{worker_id}] recovery pass failed: {db_err}')
            return stats
        except Exception as e:
            logger.error(f'[{worker_id}] recovery pass failed: {e}')
            return stats

        # 2) obradi do max_batch redova, jedan po jedan, sa commit-ima između
        for _ in range(max_batch):
            try:
                conn = db.connect_raw(DB_FILE)
                conn.row_factory = sqlite3.Row
                now = datetime.now(timezone.utc)
                now_iso = now.isoformat().replace('+00:00', 'Z')
                row = _claim_next(conn, worker_id, now_iso)
                if row is None:
                    conn.close()
                    break   # nema više pending redova

                stats['processed'] += 1
                attempts = row['attempts']

                # Cap check
                if attempts >= _MAX_ATTEMPTS:
                    conn.execute(
                        "UPDATE email_queue SET status='dead', worker_id=NULL, "
                        "sending_started_at=NULL WHERE id=?",
                        (row['id'],)
                    )
                    conn.commit()
                    conn.close()
                    stats['dead'] += 1
                    logger.error(f'[{worker_id}] mail {row["id"]} DEAD (>={_MAX_ATTEMPTS} attempts)')
                    continue

                # Zatvaramo konekciju za vreme mrežnog send-a — SMTP može trajati.
                # Row je već upisan kao 'sending' pa se drugi worker neće mešati.
                conn.close()
            except Exception as e:
                logger.error(f'[{worker_id}] claim phase failed: {e}')
                break

            # 3) STVARNI SEND — bez otvorene DB konekcije. Ako proces crashne
            # ovde, red ostaje 'sending' i recover-uje se za 5 min.
            try:
                # _send signature: (recipient, subject, html_body, plain_body, attachments)
                ok, err = _send(
                    row['recipient'], row['subject'],
                    row['html_body'], row['plain_body'],
                    attachments=None
                )
            except Exception as send_e:
                ok, err = False, f'exception: {send_e}'

            # 4) TERMINALNI STATUS — commit odmah, per-row, sa aggressive retry
            # ako je baza kratko zaključana. Bez ovoga smo pre imali problem:
            # send je uspeo, ali update na 'sent' je pao pod zaključanom bazom,
            # pa je red vraćen na 'pending' i sledeći tick opet slao.
            terminal_ok = False
            for attempt_no in range(5):
                try:
                    conn = db.connect_raw(DB_FILE)
                    if ok:
                        conn.execute(
                            "UPDATE email_queue SET status='sent', sent_at=?, "
                            "worker_id=NULL, sending_started_at=NULL WHERE id=?",
                            (datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'), row['id'])
                        )
                    else:
                        # backoff: 2, 4, 8, 16, 32, 64, 64, 64 minuta
                        wait = 2 ** min(attempts + 1, 6)
                        next_r = (datetime.now(timezone.utc) + timedelta(minutes=wait))
                        conn.execute(
                            "UPDATE email_queue SET status='pending', attempts=?, "
                            "last_error=?, next_retry_at=?, worker_id=NULL, "
                            "sending_started_at=NULL WHERE id=?",
                            (attempts + 1, str(err)[:1000],
                             next_r.isoformat().replace('+00:00', 'Z'), row['id'])
                        )
                    conn.commit()
                    conn.close()
                    terminal_ok = True
                    break
                except sqlite3.OperationalError as db_e:
                    logger.warning(f'[{worker_id}] terminal commit attempt {attempt_no+1} '
                                   f'for {row["id"]} failed ({db_e}) — retrying in 0.5s')
                    import time as _t
                    _t.sleep(0.5)
                except Exception as db_e:
                    logger.error(f'[{worker_id}] terminal commit fatal for {row["id"]}: {db_e}')
                    break

            if not terminal_ok:
                # Nismo uspeli da upišemo status. Ne šaljemo ništa više za ovaj red
                # jer je i dalje 'sending' — recover-uje se za 5 min i pokušava kroz
                # nov worker. KRITIČNO: ne diramo status ovde jer bi race sa background
                # thread-om mogao ponovo da izazove duplo slanje.
                logger.error(f'[{worker_id}] mail {row["id"]} sent={ok} but DB status NOT persisted; '
                             f'row will be recovered after {_STUCK_SENDING_THRESHOLD_S}s timeout')
                stats['failed'] += 1
                continue

            if ok:
                stats['ok'] += 1
            else:
                stats['failed'] += 1
    finally:
        _QUEUE_WORKER_LOCK.release()

    return stats


# ==========================================================
#  Public helper — koristi se iz admin comms rute
# ==========================================================
def send_branded_admin_message(recipient, subject, message_text, attachments=None):
    """Šalje admin-inicirani mejl (npr. ponuda kupcu iz 'Send Email' modala)
    ISTIM brendovanim šablonom kao portal notifikacije. Ovo je bilo tačka
    inkonzistentnosti — ranije su portal notifikacije bile profesionalne HTML,
    a admin-ovi mejlovi običan tekst bez branding-a.

    message_text: slobodan tekst koji je admin uneo (u modalu). Automatski se
    escape-uje i pretvara u paragrafe (svaka linija = novi paragraf).
    """
    _smtp, company = _get_smtp_settings()

    def _escape(s):
        return (str(s or "").replace("&", "&amp;").replace("<", "&lt;")
                .replace(">", "&gt;"))

    paragraphs = [
        f'<p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#344054;">{_escape(line)}</p>'
        for line in (message_text or "").split("\n") if line.strip()
    ] or [
        '<p style="margin:0;font-size:14px;color:#344054;">(No message provided)</p>'
    ]
    body_html = "".join(paragraphs)

    html = _html_wrap(subject, body_html, company)
    return _send(recipient, subject, html, message_text or subject, attachments=attachments)


# ==========================================================
#  Round F helper — direktan send (koristi ga security_center za magic-link,
#  new-IP alerts, break-glass recovery). Prihvata vec-formatiran HTML fragment
#  koji se ubacuje u standardni brand-wrapper.
# ==========================================================
def send_email_now(recipient, subject, body_html, body_type='html', attachments=None):
    """Public wrapper — salje mejl odmah (bez queue), sa brand headerom/footerom.
    body_type: 'html' (podrazumevano) ili 'text'. Vraca (ok, error).
    Ako send padne, parkira u queue automatski (kao svaki drugi mejl kroz _send).
    """
    _smtp, company = _get_smtp_settings()
    if body_type == 'text':
        # Konvertuj plain lines u <p>-ove
        def _esc(s):
            return (str(s or "").replace("&", "&amp;").replace("<", "&lt;")
                    .replace(">", "&gt;"))
        paragraphs = [f'<p style="margin:0 0 12px 0;">{_esc(l)}</p>'
                      for l in (body_html or "").split("\n") if l.strip()]
        body_html = "".join(paragraphs) or f'<p>{_esc(subject)}</p>'
    html = _html_wrap(subject, body_html, company)
    plain = subject  # minimal plaintext fallback
    return _send(recipient, subject, html, plain, attachments=attachments)


# ==========================================================
#  Konkretni šabloni
# ==========================================================

def send_portal_otp(recipient, company_name_for_client, otp, portal_url,
                    magic_url=None, magic_ttl_min=0):
    """Šalje profesionalan OTP mejl klijentu.

    Ako je magic_url prosleđen (admin uključio u Settings), mejl sadrži i
    dugme "Sign in instantly" — jedan klik i sesija je otvorena. Standardni
    OTP kod ostaje kao fallback za ljude koji ne mogu da kliknu link.

    Provider: koristi Resend/SendGrid/Postmark ako je admin konfigurisao
    (Settings > OTP Delivery), inače legacy SMTP. Ovim mejl ne ide sa
    korisnikovog naloga → dedicated sender reputation → 99%+ inbox rate.
    """
    _smtp, company = _get_smtp_settings()
    subject = f"[{_brand_pieces(company)['name']}] Your Secure Portal Access Code"

    magic_block = ''
    if magic_url:
        magic_block = f"""
      <div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:10px;padding:20px;text-align:center;margin:0 0 20px 0;">
        <div style="font-size:11px;color:#1e40af;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:8px;">🔗 One-Click Sign In</div>
        <a href="{magic_url}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 26px;border-radius:8px;font-size:14px;font-weight:700;margin-top:6px;">Sign in instantly</a>
        <div style="font-size:11px;color:#1e3a8a;margin-top:12px;">Fastest way — single click. Link valid for {magic_ttl_min} minutes.</div>
      </div>"""

    body = f"""
      <p style="margin:0 0 12px 0;font-size:16px;color:#101828;">Dear {company_name_for_client or 'Client'},</p>
      <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#344054;">
        You have requested access to the secure B2B client portal. Use either method below to sign in.
      </p>
      {magic_block}
      <div style="background:#f4f6f9;border:1px solid #e7eaef;border-radius:10px;padding:24px;text-align:center;margin:20px 0;">
        <div style="font-size:11px;color:#667085;font-weight:600;text-transform:uppercase;letter-spacing:0.15em;margin-bottom:12px;">{'Or — One-Time Access Code' if magic_url else 'One-Time Access Code'}</div>
        <div style="font-family:'Courier New',Consolas,monospace;font-size:38px;font-weight:700;color:#101828;user-select:all;-webkit-user-select:all;">
          <code style="background:#ffffff;border:2px dashed #2563eb;border-radius:8px;padding:8px 16px;display:inline-block;letter-spacing:0.35em;">{otp}</code>
        </div>
        <div style="font-size:12px;color:#475569;margin-top:14px;">Tap or long-press the code to copy it — then paste it into the login screen.</div>
        <div style="font-size:11px;color:#98a2b3;margin-top:8px;">Valid for 5 minutes.</div>
      </div>
      <p style="margin:0 0 8px 0;font-size:13px;color:#344054;">If you did not request this, please ignore this message. Your account remains secure.</p>
      <p style="margin:0;font-size:13px;color:#344054;">For any questions, please contact your account manager.</p>
    """

    html = _html_wrap(subject, body, company, cta_url=portal_url, cta_label="Return to Portal")
    plain_lines = [
        f"Your one-time access code is: {otp}",
        "Valid for 5 minutes.",
    ]
    if magic_url:
        plain_lines.extend(["", f"Or click this link to sign in instantly (valid {magic_ttl_min} min):",
                            magic_url])
    plain_lines.append("\nIf you did not request this code, please ignore this message.")
    plain = "\n".join(plain_lines)

    # Pluggable transactional provider (Resend/SendGrid/Postmark) → dedicated
    # sending reputation, ne ide sa operator-ovog mailbox-a → izbegava spam risk.
    # Ako provider nije konfigurisan, fallback je legacy _send (SMTP).
    from mail_providers import send_transactional
    return send_transactional(recipient, subject, html, plain)


def send_kyc_approved(recipient, company_name_for_client, portal_url):
    _smtp, company = _get_smtp_settings()
    subject = f"[{_brand_pieces(company)['name']}] KYC Approved"
    body = f"""
      <p style="margin:0 0 12px 0;font-size:16px;color:#101828;">Dear {company_name_for_client or 'Client'},</p>
      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#344054;">
        We are pleased to inform you that your KYC / compliance submission has been reviewed and <strong style="color:#059669;">approved</strong>.
      </p>
      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#344054;">
        You now have full access to offers, contracts and document exchange via your B2B portal.
      </p>
    """
    return _send(recipient, subject, _html_wrap(subject, body, company, cta_url=portal_url, cta_label="Open Portal"), f"Your KYC has been approved. Portal: {portal_url}")


def send_kyc_update_requested(recipient, company_name_for_client, portal_url, note=""):
    _smtp, company = _get_smtp_settings()
    subject = f"[{_brand_pieces(company)['name']}] Additional KYC Information Required"
    note_block = ""
    if note:
        note_block = f"<div style='background:#fef3c7;border-left:4px solid #d97706;padding:14px 18px;margin:16px 0;font-size:13px;color:#78350f;'><strong>Reviewer note:</strong><br>{note}</div>"
    body = f"""
      <p style="margin:0 0 12px 0;font-size:16px;color:#101828;">Dear {company_name_for_client or 'Client'},</p>
      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#344054;">
        We have reviewed your KYC submission and require additional information or updated documents to proceed. Please log in to the portal and complete the requested items.
      </p>
      {note_block}
    """
    return _send(recipient, subject, _html_wrap(subject, body, company, cta_url=portal_url, cta_label="Complete KYC"), "Additional KYC information required.")


def send_new_offer(recipient, company_name_for_client, offer_no, portal_url):
    _smtp, company = _get_smtp_settings()
    subject = f"[{_brand_pieces(company)['name']}] New Offer #{offer_no}"
    body = f"""
      <p style="margin:0 0 12px 0;font-size:16px;color:#101828;">Dear {company_name_for_client or 'Client'},</p>
      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#344054;">
        A new commercial offer <strong>#{offer_no}</strong> has been prepared for you and is available in your secure B2B portal.
      </p>
      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#344054;">
        You may review the terms, download the offer PDF, and confirm acceptance directly through the portal.
      </p>
    """
    return _send(recipient, subject, _html_wrap(subject, body, company, cta_url=portal_url, cta_label="View Offer"), f"New offer #{offer_no} available.")


def send_new_document(recipient, company_name_for_client, doc_type, file_name, portal_url):
    _smtp, company = _get_smtp_settings()
    subject = f"[{_brand_pieces(company)['name']}] New Document: {doc_type}"
    body = f"""
      <p style="margin:0 0 12px 0;font-size:16px;color:#101828;">Dear {company_name_for_client or 'Client'},</p>
      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#344054;">
        A new document is available in your portal document vault:
      </p>
      <div style="background:#f4f6f9;border:1px solid #e7eaef;border-radius:10px;padding:16px;margin:14px 0;">
        <div style="font-size:11px;color:#667085;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;">{doc_type}</div>
        <div style="font-size:15px;color:#101828;margin-top:4px;font-weight:600;">{file_name}</div>
      </div>
      <p style="margin:0;font-size:13px;color:#667085;">Every document download is logged for compliance and audit purposes.</p>
    """
    return _send(recipient, subject, _html_wrap(subject, body, company, cta_url=portal_url, cta_label="Access Document"), f"New document available: {file_name}")


def send_portal_welcome(recipient, company_name_for_client, portal_url):
    _smtp, company = _get_smtp_settings()
    brand = _brand_pieces(company)
    subject = f"[{brand['name']}] Welcome to Your B2B Client Portal"
    body = f"""
      <p style="margin:0 0 12px 0;font-size:16px;color:#101828;">Dear {company_name_for_client or 'Client'},</p>
      <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#344054;">
        We are pleased to welcome you to our secure B2B client portal. This portal provides you with direct access to manage your business relationship with {brand['name']}.
      </p>

      <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:20px;margin:16px 0;">
        <div style="font-size:12px;color:#0369a1;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px;">Getting Started</div>
        <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 12px;font-size:13px;color:#344054;line-height:1.5;border-bottom:1px solid #e0f2fe;">
              <strong style="color:#0369a1;">Step 1.</strong> Click the button below to access your portal. A one-time verification code will be sent to this email.
            </td>
          </tr>
          <tr>
            <td style="padding:8px 12px;font-size:13px;color:#344054;line-height:1.5;border-bottom:1px solid #e0f2fe;">
              <strong style="color:#0369a1;">Step 2.</strong> Complete your <strong>KYC (Know Your Customer)</strong> form under the Compliance tab. This is required before we can proceed with offers and contracts.
            </td>
          </tr>
          <tr>
            <td style="padding:8px 12px;font-size:13px;color:#344054;line-height:1.5;border-bottom:1px solid #e0f2fe;">
              <strong style="color:#0369a1;">Step 3.</strong> Upload the required corporate documents: trade license, passports of directors/UBOs, and certificate of incorporation.
            </td>
          </tr>
          <tr>
            <td style="padding:8px 12px;font-size:13px;color:#344054;line-height:1.5;">
              <strong style="color:#0369a1;">Step 4.</strong> Once your KYC is approved, you will have full access to offers, shipment tracking, and document exchange.
            </td>
          </tr>
        </table>
      </div>

      <div style="background:#f4f6f9;border:1px solid #e7eaef;border-radius:10px;padding:16px;margin:16px 0;">
        <div style="font-size:12px;color:#667085;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">Portal Features</div>
        <ul style="margin:0;padding:0 0 0 18px;font-size:13px;color:#344054;line-height:1.8;">
          <li>View and accept commercial offers</li>
          <li>Track shipments and contracts in real time</li>
          <li>Access and download official documents (offers, invoices, contracts)</li>
          <li>Submit requests for quotation (RFQ)</li>
          <li>Manage your product catalog</li>
          <li>Update your company profile securely</li>
        </ul>
      </div>

      <p style="margin:0 0 8px 0;font-size:13px;color:#344054;">
        All data submitted through the portal is encrypted and stored securely. Document downloads are logged for compliance and audit purposes.
      </p>
      <p style="margin:0;font-size:13px;color:#667085;">
        If you have any questions, please contact your account manager.
      </p>
    """
    html = _html_wrap(subject, body, company, cta_url=portal_url, cta_label="Access Your Portal")
    plain = (
        f"Welcome to {brand['name']} B2B Portal.\n\n"
        f"Your portal link: {portal_url}\n\n"
        "Steps:\n1. Open the link and enter the verification code sent to your email.\n"
        "2. Complete the KYC form under the Compliance tab.\n"
        "3. Upload corporate documents (trade license, passports, incorporation cert).\n"
        "4. Once approved, you'll have full access to offers, tracking, and documents.\n\n"
        "For questions, contact your account manager."
    )
    return _send(recipient, subject, html, plain)


def send_profile_change_approved(recipient, company_name_for_client, changes_summary, portal_url):
    _smtp, company = _get_smtp_settings()
    subject = f"[{_brand_pieces(company)['name']}] Profile Update Confirmed"
    body = f"""
      <p style="margin:0 0 12px 0;font-size:16px;color:#101828;">Dear {company_name_for_client or 'Client'},</p>
      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#344054;">
        Your recent profile change request has been reviewed and applied to your account.
      </p>
      <div style="background:#f4f6f9;border:1px solid #e7eaef;border-radius:10px;padding:14px 18px;margin:14px 0;font-size:13px;color:#344054;">
        {changes_summary}
      </div>
    """
    return _send(recipient, subject, _html_wrap(subject, body, company, cta_url=portal_url, cta_label="Open Portal"), "Profile update confirmed.")
