"""Sanctions screening — OpenSanctions integration.

Uses api.opensanctions.org/search/default (free tier, no key) to check
a submitted company or individual name against OFAC / UN / EU consolidated
sanctions lists. Cached per name for 6h to avoid rate limiting.

Called from KYC submit path and partner CRUD to flag matches for admin
review before approval. Never blocks — always returns a match list; the
admin decides.
"""
import json
import time
import urllib.request
import urllib.parse
from flask import Blueprint, jsonify, request, session

from utils import login_required, log_audit

sanctions_bp = Blueprint('sanctions', __name__, url_prefix='/api/sanctions')

_CACHE = {}          # {norm_name: (expiry_ts, payload)}
_TTL_S = 6 * 3600    # 6h cache
_HTTP_TIMEOUT_S = 8


def _norm(name):
    return ' '.join((name or '').lower().strip().split())


def _fetch_opensanctions(name):
    """POST-less search against OpenSanctions. Returns list of matches
    (limited to top 10) with {caption, schema, topics, datasets, score,
    countries}. Returns None on any error — caller falls back to 'no
    match found'."""
    if not name:
        return []
    try:
        # Search endpoint is free-tier, no auth, returns FollowTheMoney-shaped
        # results ranked by relevance. topN=10 keeps payload small.
        params = urllib.parse.urlencode({'q': name, 'limit': 10})
        url = f'https://api.opensanctions.org/search/default?{params}'
        req = urllib.request.Request(url, headers={
            'User-Agent': 'AspidusCRM/1.0 sanctions-screening',
            'Accept': 'application/json',
        })
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT_S) as r:
            data = json.loads(r.read().decode('utf-8'))
        out = []
        for hit in (data.get('results') or []):
            props = hit.get('properties') or {}
            out.append({
                'id': hit.get('id'),
                'caption': hit.get('caption'),
                'schema': hit.get('schema'),
                'score': hit.get('score'),
                'topics': props.get('topics') or [],
                'datasets': hit.get('datasets') or [],
                'countries': props.get('country') or props.get('nationality') or [],
                'notes': props.get('notes') or [],
                'birthDate': (props.get('birthDate') or [None])[0],
                'first_seen': hit.get('first_seen'),
                'last_seen': hit.get('last_seen'),
                'opensanctions_url': f'https://www.opensanctions.org/entities/{hit.get("id")}/',
            })
        return out
    except Exception:
        return None


def _screen_cached(name):
    """Vraća {matches: [...], source: 'opensanctions', queried_at: iso}
    ili {matches: [], source: 'offline', queried_at: iso} ako API padne."""
    key = _norm(name)
    if not key:
        return {'matches': [], 'source': 'none', 'queried_at': None}
    now = time.time()
    entry = _CACHE.get(key)
    if entry and entry[0] > now:
        return entry[1]
    hits = _fetch_opensanctions(name)
    payload = {
        'query': name,
        'matches': hits or [],
        'source': 'opensanctions' if hits is not None else 'offline',
        'queried_at': int(now),
    }
    if hits is not None:
        _CACHE[key] = (now + _TTL_S, payload)
    return payload


def screen_name(name):
    """Public helper for use in KYC / partner-save paths.
    Returns full payload dict with matches list."""
    return _screen_cached(name)


def screen_batch(names):
    """Iteriramo kroz nekoliko imena (companyName + directors + UBOs).
    Vraća listu {name, matches[]}. Ograničeno na 20 poziva po zahtevu
    da ne zloupotrebimo API."""
    out = []
    seen = set()
    for n in (names or [])[:20]:
        key = _norm(n)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append({'name': n, **_screen_cached(n)})
    return out


@sanctions_bp.route('/screen', methods=['POST'])
@login_required
def screen():
    """POST {name: str} ili {names: [str,...]} → screening rezultat.
    Admin/user pokreće ručno iz CRM UI-a za bilo koje ime."""
    payload = request.get_json(silent=True) or {}
    if 'names' in payload:
        result = screen_batch(payload['names'])
    else:
        result = screen_name(str(payload.get('name', '')).strip())
    log_audit('INFO', 'sanctions', f"Screening query from {session.get('username','?')}")
    return jsonify(result)
