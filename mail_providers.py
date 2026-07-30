"""Pluggable transactional email providers for OTP + magic-link delivery.

Rationale: sending OTP from the operator's own mailbox (Gmail/Outlook) risks
being flagged as spam because the mailbox has no dedicated sending reputation
and providers rate-limit high-frequency notification traffic. Transactional
providers (Resend, SendGrid, Postmark, Mailgun) maintain warm IP pools and
provide DKIM/SPF/DMARC alignment out-of-the-box.

Config lives in settings.otpMailProvider (encrypted JSON blob):
    {
        "provider": "resend" | "sendgrid" | "postmark" | "smtp",
        "api_key":  "re_...",         (for resend/sendgrid/postmark)
        "from_email": "otp@aspidus.io",
        "from_name":  "Aspidus B2B Portal",
        "magic_link_enabled": true,
        "magic_link_ttl_min": 15
    }

When provider == 'smtp' (default), we fall back to the existing utils_email
flow so nothing breaks for legacy configs.
"""
import db
import json
import logging
import urllib.request

from config import DB_FILE
from utils import decrypt_data

logger = logging.getLogger(__name__)

# Cache — reloaded on demand
_CFG_CACHE = {'ts': 0, 'data': None}
_CFG_TTL_S = 30


def _load_config():
    import time
    now = time.time()
    if _CFG_CACHE['data'] is not None and (now - _CFG_CACHE['ts']) < _CFG_TTL_S:
        return _CFG_CACHE['data']
    cfg = {'provider': 'smtp', 'magic_link_enabled': False, 'magic_link_ttl_min': 15}
    try:
        with db.connect_raw(DB_FILE) as conn:
            row = conn.execute("SELECT value FROM settings WHERE key='otpMailProvider'").fetchone()
        if row and row[0]:
            try:
                loaded = decrypt_data(row[0]) or {}
            except Exception:
                try: loaded = json.loads(row[0])
                except Exception: loaded = {}
            if isinstance(loaded, dict):
                cfg.update(loaded)
    except Exception as e:
        logger.warning('otpMailProvider load failed: %s', e)
    _CFG_CACHE['data'] = cfg
    _CFG_CACHE['ts'] = now
    return cfg


def clear_config_cache():
    _CFG_CACHE['data'] = None
    _CFG_CACHE['ts'] = 0


# ---------- Provider adapters ----------

def _send_via_resend(cfg, to_email, subject, html_body, plain_body):
    """Resend API — https://resend.com/docs/api-reference/emails/send-email
    Free tier: 100 emails/day, 3000/month. Excellent deliverability, EU DPA.
    """
    api_key = str(cfg.get('api_key', '')).strip()
    if not api_key.startswith('re_'):
        return (False, 'Resend api_key missing or invalid (must start with re_)')
    body = json.dumps({
        'from': _from_header(cfg),
        'to': [to_email],
        'subject': subject,
        'html': html_body,
        'text': plain_body,
    }).encode('utf-8')
    req = urllib.request.Request(
        'https://api.resend.com/emails',
        data=body,
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
            'User-Agent': 'AspidusCRM/1.0',
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            resp = r.read().decode('utf-8', 'ignore')
        return (True, resp[:200])
    except Exception as e:
        return (False, f'resend: {e}')


def _send_via_sendgrid(cfg, to_email, subject, html_body, plain_body):
    """SendGrid v3 API — https://docs.sendgrid.com/api-reference/mail-send/mail-send
    Free tier: 100 emails/day forever.
    """
    api_key = str(cfg.get('api_key', '')).strip()
    if not api_key.startswith('SG.'):
        return (False, 'SendGrid api_key missing or invalid (must start with SG.)')
    body = json.dumps({
        'personalizations': [{'to': [{'email': to_email}]}],
        'from': {'email': str(cfg.get('from_email', 'no-reply@example.com')),
                 'name': str(cfg.get('from_name', 'Aspidus'))},
        'subject': subject,
        'content': [
            {'type': 'text/plain', 'value': plain_body},
            {'type': 'text/html', 'value': html_body},
        ],
    }).encode('utf-8')
    req = urllib.request.Request(
        'https://api.sendgrid.com/v3/mail/send',
        data=body,
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
            'User-Agent': 'AspidusCRM/1.0',
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return (True, f'sendgrid ok status={r.status}')
    except Exception as e:
        return (False, f'sendgrid: {e}')


def _send_via_postmark(cfg, to_email, subject, html_body, plain_body):
    """Postmark API — https://postmarkapp.com/developer/api/email-api
    Free tier: 100 emails/month. Highest inbox rates of the three (99%+).
    """
    server_token = str(cfg.get('api_key', '')).strip()
    if not server_token:
        return (False, 'Postmark server_token missing')
    body = json.dumps({
        'From': _from_header(cfg),
        'To': to_email,
        'Subject': subject,
        'HtmlBody': html_body,
        'TextBody': plain_body,
        'MessageStream': str(cfg.get('message_stream', 'outbound')),
    }).encode('utf-8')
    req = urllib.request.Request(
        'https://api.postmarkapp.com/email',
        data=body,
        headers={
            'X-Postmark-Server-Token': server_token,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'AspidusCRM/1.0',
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return (True, f'postmark ok status={r.status}')
    except Exception as e:
        return (False, f'postmark: {e}')


def _from_header(cfg):
    email = str(cfg.get('from_email', 'no-reply@example.com'))
    name = str(cfg.get('from_name', 'Aspidus')).strip()
    if name:
        return f'{name} <{email}>'
    return email


# ---------- Dispatch ----------

def send_transactional(to_email, subject, html_body, plain_body):
    """Send via the configured provider. Returns (ok, info)."""
    if not to_email:
        return (False, 'no recipient')
    cfg = _load_config()
    provider = str(cfg.get('provider', 'smtp')).lower()
    if provider == 'resend':
        return _send_via_resend(cfg, to_email, subject, html_body, plain_body)
    if provider == 'sendgrid':
        return _send_via_sendgrid(cfg, to_email, subject, html_body, plain_body)
    if provider == 'postmark':
        return _send_via_postmark(cfg, to_email, subject, html_body, plain_body)
    # Fallback → legacy SMTP path from utils_email
    from utils_email import _send
    return _send(to_email, subject, html_body, plain_body, attachments=None)


def magic_link_config():
    """Vraća {enabled, ttl_min} — koristi portal auth da odluči da li da
    ponudi magic-link opciju uz standardni OTP."""
    cfg = _load_config()
    return {
        'enabled': bool(cfg.get('magic_link_enabled', False)),
        'ttl_min': int(cfg.get('magic_link_ttl_min', 15) or 15),
    }


def config_summary():
    """Redigovana verzija config-a — API key se ne otkriva na frontend, vraća se maska."""
    cfg = _load_config()
    ak = str(cfg.get('api_key', '') or '')
    masked = ''
    if ak:
        masked = (ak[:4] + '…' + ak[-4:]) if len(ak) > 8 else ('•' * len(ak))
    return {
        'provider': cfg.get('provider', 'smtp'),
        'from_email': cfg.get('from_email', ''),
        'from_name': cfg.get('from_name', ''),
        'magic_link_enabled': bool(cfg.get('magic_link_enabled', False)),
        'magic_link_ttl_min': int(cfg.get('magic_link_ttl_min', 15) or 15),
        'has_api_key': bool(ak),
        'api_key_masked': masked,
    }
