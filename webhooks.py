"""Outbound chat notifications — Slack + Teams + Telegram + ntfy.sh + WhatsApp.

Every platform accepts a simple JSON POST. This module dispatches
identical event messages to all configured channels so operator gets a
notification wherever they read chat (Slack for team, Telegram for
mobile push, ntfy for on-call, WhatsApp Cloud for external partners).

Never blocks the main flow — every send is best-effort in a background
thread; failures are logged but do not surface to caller.

Config source is settings.chatWebhooks (encrypted):
    {
        "slack":   "https://hooks.slack.com/services/T00/B00/xxxx",
        "teams":   "https://outlook.office.com/webhook/...",
        "telegram_bot_token": "1234567:AAxxxx",
        "telegram_chat_id":   "-1001234567890",
        "ntfy_url":           "https://ntfy.sh/aspidus-alerts-<secret>",
        "whatsapp_phone_id":  "1234567890",   (Meta Business Cloud API)
        "whatsapp_token":     "EAAxxxx...",
        "whatsapp_to":        "+38160xxxxxxx",
        "events": ["offer_accepted","kyc_submitted","document_signed",
                   "sanctions_flag","deal_created","offer_declined"]
    }
Only events listed in `events` array are delivered — admin can pick a
subset (e.g. only sanctions_flag → Telegram for immediate personal push)
via the Settings UI.
"""
import db
import json
import logging
import threading
import urllib.request

from config import DB_FILE
from utils import decrypt_data

logger = logging.getLogger(__name__)

# Per-process cache of settings — reloaded on first miss or after 60s.
_CFG_CACHE = {'ts': 0, 'data': None}
_CFG_TTL_S = 60


def _load_config():
    """Čita chatWebhooks blob iz settings tabele. Dekriptuje ako je enkriptovan."""
    import time
    now = time.time()
    if _CFG_CACHE['data'] is not None and (now - _CFG_CACHE['ts']) < _CFG_TTL_S:
        return _CFG_CACHE['data']
    cfg = {}
    try:
        with db.connect_raw(DB_FILE) as conn:
            c = conn.cursor()
            c.execute("SELECT value FROM settings WHERE key='chatWebhooks'")
            row = c.fetchone()
            if row and row[0]:
                try:
                    cfg = decrypt_data(row[0]) or {}
                except Exception:
                    try: cfg = json.loads(row[0])
                    except Exception: cfg = {}
                if not isinstance(cfg, dict): cfg = {}
    except Exception:
        pass
    _CFG_CACHE['data'] = cfg
    _CFG_CACHE['ts'] = now
    return cfg


def clear_cache():
    """Poziva se posle Settings save — invalidira cache pa sledeći send učita svežu konfig."""
    _CFG_CACHE['data'] = None
    _CFG_CACHE['ts'] = 0


def _post(url, payload, timeout=5):
    """POST JSON. Vraća (ok, http_status). Tihi na failure."""
    try:
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers={
            'Content-Type': 'application/json',
            'User-Agent': 'AspidusCRM/1.0 webhooks',
        })
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return (200 <= r.status < 300, r.status)
    except Exception as e:
        logger.warning('webhook POST failed for %s: %s', url[:60], e)
        return (False, 0)


def _format_slack(event, ctx):
    """Slack Block Kit format — profesionalan izgled, ne obični tekst."""
    title, color, emoji = _event_style(event)
    fields = []
    for k, v in (ctx or {}).items():
        if v in (None, ''): continue
        fields.append({'title': str(k), 'value': str(v)[:300], 'short': len(str(v)) < 40})
    return {
        'attachments': [{
            'color': color,
            'title': f'{emoji} {title}',
            'fields': fields,
            'footer': 'Aspidus CRM',
            'ts': int(__import__('time').time()),
        }]
    }


def _format_teams(event, ctx):
    """MS Teams MessageCard (legacy connector) format — support-uje sve tenante
    bez novog Adaptive Card upgrade path-a."""
    title, color_hex, emoji = _event_style(event)
    facts = [{'name': str(k), 'value': str(v)[:300]}
             for k, v in (ctx or {}).items() if v not in (None, '')]
    return {
        '@type': 'MessageCard',
        '@context': 'https://schema.org/extensions',
        'themeColor': color_hex.replace('#', ''),
        'title': f'{emoji} {title}',
        'sections': [{'facts': facts, 'markdown': True}],
    }


def _event_style(event):
    """Boja + naslov + emoji po tipu događaja."""
    styles = {
        'offer_accepted':  ('Offer accepted by client',  '#059669', '✅'),
        'offer_declined':  ('Offer declined by client',  '#dc2626', '❌'),
        'kyc_submitted':   ('KYC submission received',   '#0284c7', '📋'),
        'document_signed': ('Document e-signed by client', '#7c3aed', '🖋'),
        'sanctions_flag':  ('SANCTIONS MATCH — admin review required', '#dc2626', '🚨'),
        'deal_created':    ('New deal created',          '#0284c7', '🤝'),
        'partner_created': ('New partner added',         '#0284c7', '👥'),
    }
    return styles.get(event, (event.replace('_', ' ').title(), '#6b7280', '📌'))


def _format_plain(event, ctx):
    """Plain-text format za Telegram/ntfy/WhatsApp — jedan blok, novi red po polju."""
    title, _c, emoji = _event_style(event)
    lines = [f'{emoji} {title}', '']
    for k, v in (ctx or {}).items():
        if v in (None, ''): continue
        lines.append(f'{k}: {v}')
    return '\n'.join(lines)


def _post_telegram(cfg, event, context):
    """Telegram Bot API — potpuno besplatno, bez limita za personalne botove.
    Bot se pravi kod @BotFather, chat_id se dobija tako što se pošalje /start
    botu pa GET https://api.telegram.org/bot<token>/getUpdates ."""
    token = str(cfg.get('telegram_bot_token', '')).strip()
    chat_id = str(cfg.get('telegram_chat_id', '')).strip()
    if not token or not chat_id:
        return
    text = _format_plain(event, context)
    _post(f'https://api.telegram.org/bot{token}/sendMessage', {
        'chat_id': chat_id, 'text': text, 'parse_mode': 'Markdown',
        'disable_web_page_preview': True,
    })


def _post_ntfy(cfg, event, context):
    """ntfy.sh — jednostavan push notifikacijski servis. Besplatna javna
    instanca ntfy.sh; može i self-host. Aplikacija na telefonu (Android/iOS)
    subscribe-uje topic i dobija push."""
    url = str(cfg.get('ntfy_url', '')).strip()
    if not url or not url.startswith('http'):
        return
    title, color_hex, emoji = _event_style(event)
    # ntfy koristi headere za title/priority/tags — telo je body poruke
    body = _format_plain(event, context).encode('utf-8')
    # 'sanctions_flag' i 'kyc_submitted' su prioritetni — telefon će zvoniti čak i u DND
    priority = '5' if event in ('sanctions_flag',) else '4' if event in ('kyc_submitted','offer_accepted') else '3'
    try:
        req = urllib.request.Request(url, data=body, headers={
            'Title': title[:180],
            'Priority': priority,
            'Tags': emoji,
            'User-Agent': 'AspidusCRM/1.0 ntfy',
        })
        with urllib.request.urlopen(req, timeout=5) as _r:
            pass
    except Exception as e:
        logger.warning('ntfy POST failed: %s', e)


def _post_whatsapp_impl(cfg, event, context):
    """Full impl sa Bearer autorizacijom (mora custom header)."""
    phone_id = str(cfg.get('whatsapp_phone_id', '')).strip()
    token = str(cfg.get('whatsapp_token', '')).strip()
    to = str(cfg.get('whatsapp_to', '')).strip().replace('+', '')
    if not (phone_id and token and to):
        return
    text = _format_plain(event, context)
    body = json.dumps({
        'messaging_product': 'whatsapp',
        'to': to,
        'type': 'text',
        'text': {'body': text[:4000]},
    }).encode('utf-8')
    try:
        req = urllib.request.Request(
            f'https://graph.facebook.com/v18.0/{phone_id}/messages',
            data=body,
            headers={
                'Authorization': f'Bearer {token}',
                'Content-Type': 'application/json',
                'User-Agent': 'AspidusCRM/1.0 whatsapp',
            },
        )
        with urllib.request.urlopen(req, timeout=6):
            pass
    except Exception as e:
        logger.warning('whatsapp POST failed: %s', e)


def notify(event, context=None):
    """Public API — pošalji obaveštenje o događaju na sve konfigurisane kanale.
    Nikad ne diže — greške samo idu u log. Slanje se dešava u background thread-u
    da bi glavni HTTP odgovor bio brz."""
    def _worker():
        cfg = _load_config()
        allowed = cfg.get('events') or []
        # Prazna lista == sve default-uključeno; podskup ako je admin izabrao
        if allowed and event not in allowed:
            return
        slack_url = (cfg.get('slack') or '').strip()
        teams_url = (cfg.get('teams') or '').strip()
        if slack_url.startswith('https://hooks.slack.com/'):
            _post(slack_url, _format_slack(event, context))
        if teams_url.startswith('http'):
            _post(teams_url, _format_teams(event, context))
        # Novi kanali
        try: _post_telegram(cfg, event, context)
        except Exception as e: logger.warning('telegram push failed: %s', e)
        try: _post_ntfy(cfg, event, context)
        except Exception as e: logger.warning('ntfy push failed: %s', e)
        try: _post_whatsapp_impl(cfg, event, context)
        except Exception as e: logger.warning('whatsapp push failed: %s', e)

    try:
        threading.Thread(target=_worker, daemon=True).start()
    except Exception as e:
        logger.warning('webhook thread start failed: %s', e)
