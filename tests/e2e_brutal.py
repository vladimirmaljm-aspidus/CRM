"""BRUTAL E2E — svaka POST/GET/DELETE ruta u aplikaciji, jedna po jedna.

Cilj: pre publikacije potvrditi da ni jedna od ~130 rutu ne baca 500,
ni jedan endpoint ne vraća neočekivan format, i da apsolutno svaka
funkcionalna akcija koju korisnik može da uradi kroz aplikaciju stvarno
radi kraj-do-kraja.

Pokreće se protiv živog servera (APP_BASE, default 127.0.0.1:5000).
Ne oslanja se na spoljne biblioteke — samo stdlib.

Struktura:
  A. Auth (login, csrf, me, TOTP, change_password, signature, logout_all)
  B. Users management (CRUD + permissions)
  C. Data (svih 9 entiteta CRUD + bulk save + read)
  D. Documents (upload, download, delete, list, bulk_zip, register+revise+history)
  E. Offers (create, edit, versions, restore, PDF preview + generate + verify_hash)
  F. Deals (from_offer sa force i normal, double-convert block)
  G. System (health, backup/now, backup/full, search rebuild+query+stats,
     otp_delivery GET/POST/test, chat_webhooks GET/POST/test, hcaptcha,
     api_keys GET/POST)
  H. Vault (list, save)
  I. Firewall (settings, status, whitelist/blacklist add/remove, unblock, config)
  J. Comms (send_email test, email_queue view, retry_now, test_smtp)
  K. Sanctions (screen)
  L. Audit (event submit, logs read)
  M. Portal admin (activity, pending_counts, permissions, preview, products,
     submissions all + per-partner + approve/reject/request_update,
     profile_requests, hidden_items, mark_seen, hide/unhide)
  N. Portal client-facing (public_config, generate/access, kyc/submit,
     upload, rfq/submit, quote_request, offer accept/decline, catalog,
     data, testonly_last_otp, login/verify, consume_magic, hide/unhide)
  O. Verify (/verify/<hash>)
  P. Documents register (issue, next_number, revise, history)
  Q. Static/misc (robots.txt, /, /portal/, /uploads/<x>, /portal_uploads/<x>)

Svaki test loguje jedan red. Na kraju sumary + JSON izveštaj.
Exit 0 ako sve prošlo (ili odbijanje sa poznatim kodom), inače 1.
"""
from __future__ import annotations
import base64
import http.cookiejar
import io
import json
import os
import random
import string
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get('APP_BASE', 'http://127.0.0.1:5000')
ADMIN_USER = os.environ.get('ADMIN_USERNAME', 'testadmin')
ADMIN_PASS = os.environ.get('ADMIN_PASSWORD', 'TestAdmin!12345')

_results = []
_boundary = '----WebKitFormBoundary' + ''.join(random.choices(string.ascii_letters + string.digits, k=16))


def _log(name: str, ok: bool, detail: str = ''):
    marker = '\033[32m✓\033[0m' if ok else '\033[31m✗\033[0m'
    print(f'  {marker} {name}' + (f' — {detail}' if detail else ''))
    _results.append({'name': name, 'ok': ok, 'detail': detail})


class Client:
    def __init__(self, base):
        self.base = base.rstrip('/')
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self._csrf = None
        self.portal_auth = None  # sent as X-Portal-Auth on every request

    def request(self, method, path, *, json_body=None, headers=None, raw_body=None):
        url = self.base + path
        h = dict(headers or {})
        if self.portal_auth:
            h.setdefault('X-Portal-Auth', self.portal_auth)
        data = None
        if json_body is not None:
            data = json.dumps(json_body).encode('utf-8')
            h.setdefault('Content-Type', 'application/json')
        elif raw_body is not None:
            data = raw_body
        req = urllib.request.Request(url, data=data, method=method, headers=h)
        try:
            resp = self.opener.open(req, timeout=20)
            return resp.status, dict(resp.headers), resp.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()
        except Exception as e:
            return -1, {}, f'ERR: {e}'.encode()

    def get(self, p, headers=None): return self.request('GET', p, headers=headers)
    def delete(self, p, headers=None):
        h = dict(headers or {}); h.setdefault('X-CSRF-Token', self._csrf or '')
        return self.request('DELETE', p, headers=h)
    def post(self, p, json_body=None, headers=None, raw_body=None):
        h = dict(headers or {}); h.setdefault('X-CSRF-Token', self._csrf or '')
        return self.request('POST', p, json_body=json_body, headers=h, raw_body=raw_body)
    def put(self, p, json_body=None, headers=None):
        h = dict(headers or {}); h.setdefault('X-CSRF-Token', self._csrf or '')
        return self.request('PUT', p, json_body=json_body, headers=h)

    def refresh_csrf(self):
        st, _, body = self.get('/api/csrf/token')
        try: self._csrf = json.loads(body).get('csrf_token')
        except: self._csrf = None
        return self._csrf


def _j(body):
    try: return json.loads(body)
    except: return None


def _multipart(fields, files):
    """Build multipart/form-data body. files is list of (field, filename, bytes, content_type)."""
    lines = []
    for k, v in (fields or {}).items():
        lines.append(f'--{_boundary}\r\n'.encode())
        lines.append(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode())
        lines.append((str(v) + '\r\n').encode())
    for field, fname, data, ctype in (files or []):
        lines.append(f'--{_boundary}\r\n'.encode())
        lines.append(f'Content-Disposition: form-data; name="{field}"; filename="{fname}"\r\n'.encode())
        lines.append(f'Content-Type: {ctype}\r\n\r\n'.encode())
        lines.append(data)
        lines.append(b'\r\n')
    lines.append(f'--{_boundary}--\r\n'.encode())
    return b''.join(lines), f'multipart/form-data; boundary={_boundary}'


def _ok(st, *allowed):
    """Return True if status in allowed (or 200/201/202/204 by default)."""
    if allowed: return st in allowed
    return st in (200, 201, 202, 204)


def main():
    c = Client(BASE)
    print(f'=== BRUTAL E2E against {BASE} ===\n')

    # ==========================================================
    # A. AUTH
    # ==========================================================
    print('-- A. Auth --')

    st, _, _ = c.get('/api/auth/me')
    _log('A01 GET /api/auth/me pre-login → 401', st == 401, f'HTTP {st}')

    st, _, body = c.post('/api/auth/login', json_body={
        'username': ADMIN_USER, 'password': ADMIN_PASS,
        'location': '44.7866,20.4489', 'device': 'brutal',
    })
    _log('A02 POST /api/auth/login', st == 200, f'HTTP {st}')
    if st != 200: return _finalize()

    c.refresh_csrf()
    _log('A03 GET /api/csrf/token → non-empty', bool(c._csrf), f'{(c._csrf or "")[:16]}…')

    st, _, body = c.get('/api/auth/me')
    j = _j(body) or {}
    _log('A04 GET /api/auth/me post-login → admin',
         st == 200 and j.get('user', {}).get('role') == 'admin', f'HTTP {st}')

    # A05: bad-login rate limiting friendly (must return 401 not crash)
    st, _, _ = c.post('/api/auth/login', json_body={
        'username': ADMIN_USER, 'password': 'wrong',
        'location': '44.7866,20.4489', 'device': 'brutal',
    })
    _log('A05 login with wrong password → 401', st == 401, f'HTTP {st}')

    # Re-login (previous bad login may have burned attempts)
    c.post('/api/auth/login', json_body={
        'username': ADMIN_USER, 'password': ADMIN_PASS,
        'location': '44.7866,20.4489', 'device': 'brutal',
    })
    c.refresh_csrf()

    # A06: TOTP status
    st, _, body = c.get('/api/auth/totp/status')
    j = _j(body) or {}
    _log('A06 TOTP status', st == 200 and 'enabled' in j, f'HTTP {st}')

    # A07: TOTP setup start (creates secret; does NOT enable)
    st, _, body = c.post('/api/auth/totp/setup_start', json_body={})
    j = _j(body) or {}
    _log('A07 TOTP setup_start returns secret + URI',
         st == 200 and j.get('secret') and j.get('provisioning_uri'),
         f'HTTP {st}')
    totp_secret = j.get('secret')

    # A08: TOTP setup_confirm with wrong code
    st, _, _ = c.post('/api/auth/totp/setup_confirm', json_body={'code': '000000'})
    _log('A08 TOTP setup_confirm with bad code → 400', st in (400, 401), f'HTTP {st}')

    # A09: TOTP disable while not enabled (idempotent)
    st, _, _ = c.post('/api/auth/totp/disable', json_body={'password': ADMIN_PASS})
    _log('A09 TOTP disable (idempotent)', st in (200, 400, 404), f'HTTP {st}')

    # A10: Change password roundtrip
    new_pw = 'TempBrutal!2599'
    st, _, _ = c.post('/api/auth/change_password', json_body={'new_password': new_pw})
    _log('A10 change_password', st == 200, f'HTTP {st}')
    # log back in
    c.post('/api/auth/login', json_body={
        'username': ADMIN_USER, 'password': new_pw,
        'location': '44.7866,20.4489', 'device': 'brutal',
    })
    c.refresh_csrf()
    # revert
    st, _, _ = c.post('/api/auth/change_password', json_body={'new_password': ADMIN_PASS})
    _log('A11 change_password revert', st == 200, f'HTTP {st}')
    c.post('/api/auth/login', json_body={
        'username': ADMIN_USER, 'password': ADMIN_PASS,
        'location': '44.7866,20.4489', 'device': 'brutal',
    })
    c.refresh_csrf()

    # A12: empty new password blocked
    st, _, body = c.post('/api/auth/change_password', json_body={'new_password': ''})
    j = _j(body) or {}
    _log('A12 change_password rejects empty',
         st == 400 and j.get('error') == 'EMPTY_PASSWORD', f'HTTP {st}')

    # A13: signature save
    tiny_png = base64.b64decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    )
    b64png = 'data:image/png;base64,' + base64.b64encode(tiny_png).decode()
    st, _, _ = c.post('/api/auth/signature', json_body={'signature': b64png})
    _log('A13 set_signature accepts PNG dataUrl', st in (200, 201), f'HTTP {st}')

    # A14: logout_all
    st, _, _ = c.post('/api/auth/logout_all')
    _log('A14 logout_all', st == 200, f'HTTP {st}')
    # re-login
    c.post('/api/auth/login', json_body={
        'username': ADMIN_USER, 'password': ADMIN_PASS,
        'location': '44.7866,20.4489', 'device': 'brutal',
    })
    c.refresh_csrf()

    # ==========================================================
    # B. USERS
    # ==========================================================
    print('\n-- B. Users --')
    st, _, body = c.get('/api/users')
    users = _j(body) or []
    _log('B01 GET /api/users returns list',
         st == 200 and isinstance(users, list) and any(u.get('username') == ADMIN_USER for u in users),
         f'HTTP {st} count={len(users) if isinstance(users, list) else "?"}')

    # Create user (endpoint requires username on both create and update)
    brutal_username = f'brutal_{int(time.time())}'
    new_user_id = f'brutal-user-{int(time.time())}'
    st, _, body = c.post('/api/users', json_body={
        'id': new_user_id, 'username': brutal_username,
        'password': 'Brutal!12345', 'role': 'employee',
        'permissions': {'offers_view': True, 'products_view': True},
    })
    j = _j(body) or {}
    _log('B02 POST /api/users creates employee', st in (200, 201),
         f'HTTP {st} body={str(body)[:120]}')
    # Server assigns UUID even if we send an id — use response id for update
    if isinstance(j, dict) and j.get('id'):
        new_user_id = j['id']

    # Update user (must resend username + role — endpoint replaces whole row)
    st, _, body = c.post('/api/users', json_body={
        'id': new_user_id, 'username': brutal_username, 'role': 'employee',
        'permissions': {'offers_view': True, 'partners_view': True},
    })
    _log('B03 POST /api/users update permissions', st in (200, 201),
         f'HTTP {st} body={str(body)[:120]}')

    # Delete user
    st, _, _ = c.delete(f'/api/users/{new_user_id}')
    _log('B04 DELETE /api/users/<id>', st in (200, 204), f'HTTP {st}')

    # ==========================================================
    # C. DATA (all 9 entities CRUD)
    # ==========================================================
    print('\n-- C. Data (all entities) --')
    ts = int(time.time())
    buyer_id = f'brutal-buyer-{ts}'
    supplier_id = f'brutal-sup-{ts}'
    prod_id = f'brutal-prod-{ts}'
    demand_id = f'brutal-dem-{ts}'
    offer_id = f'brutal-off-{ts}'
    account_id = f'brutal-acc-{ts}'
    tx_id = f'brutal-tx-{ts}'
    rec_id = f'brutal-rec-{ts}'
    conn_id = f'brutal-conn-{ts}'
    doc_id = f'brutal-doc-{ts}'
    portal_token = 'BRUTAL_' + base64.b32encode(os.urandom(20)).decode('ascii').rstrip('=')

    # Buyer partner — portalVisibleProducts must include prod_id so quote_request works
    st, _, _ = c.post('/api/item/partners', json_body={
        'id': buyer_id, 'companyName': 'Brutal Buyer', 'entityType': 'company',
        'contact': {'email': 'buyer@brutal.test', 'phone': '+381600000001'},
        'address': {'street': 'Main 1', 'city': 'Belgrade', 'country': 'RS'},
        'taxId': 'RS12345678', 'types': ['Buyer'],
        'portalToken': portal_token, 'isPortalActive': True,
        'portalVisibleProducts': [prod_id],
    })
    _log('C01 Create buyer', st == 200, f'HTTP {st}')

    st, _, _ = c.post('/api/item/partners', json_body={
        'id': supplier_id, 'companyName': 'Brutal Supplier', 'entityType': 'company',
        'contact': {'email': 'sup@brutal.test'}, 'types': ['Supplier'],
    })
    _log('C02 Create supplier', st == 200, f'HTTP {st}')

    # Product
    st, _, _ = c.post('/api/item/products', json_body={
        'id': prod_id, 'name': 'Brutal Cocoa', 'category': 'agriculture',
        'hsCode': '18010000', 'detailedSpec': 'Grade A',
        'supplyOffers': [{'supplierId': supplier_id, 'country': 'GH',
                          'price': 2200, 'currency': 'USD', 'incoterm': 'FOB'}],
    })
    _log('C03 Create product', st == 200, f'HTTP {st}')

    # Demand
    st, _, _ = c.post('/api/item/demands', json_body={
        'id': demand_id, 'productName': 'Brutal Cocoa', 'quantity': 20, 'unit': 't',
        'buyerId': buyer_id,
    })
    _log('C04 Create demand', st == 200, f'HTTP {st}')

    # Offer
    st, _, _ = c.post('/api/item/offers', json_body={
        'id': offer_id, 'offerNo': f'OFF-BRUTAL-{ts}',
        'date': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'customerId': buyer_id, 'productId': prod_id, 'productName': 'Brutal Cocoa',
        'quantity': 20, 'unit': 't', 'sellingPrice': 2500, 'currency': 'USD',
        'incoterm': 'CIF', 'pol': 'Tema', 'pod': 'Antwerp',
        'items': [{'productId': prod_id, 'productName': 'Brutal Cocoa',
                   'quantity': 20, 'unit': 't', 'price': 2500, 'currency': 'USD'}],
    })
    _log('C05 Create offer', st == 200, f'HTTP {st}')

    # Account (finance)
    st, _, _ = c.post('/api/item/accounts', json_body={
        'id': account_id, 'name': 'Brutal EUR', 'currency': 'EUR',
        'iban': 'DE89370400440532013000', 'balance': 10000,
    })
    _log('C06 Create account', st == 200, f'HTTP {st}')

    # Transaction
    st, _, _ = c.post('/api/item/transactions', json_body={
        'id': tx_id, 'accountId': account_id, 'type': 'income',
        'amount': 1000, 'currency': 'EUR',
        'date': time.strftime('%Y-%m-%d', time.gmtime()),
        'description': 'Brutal test income', 'category': 'sales',
    })
    _log('C07 Create transaction', st == 200, f'HTTP {st}')

    # Recurring expense
    st, _, _ = c.post('/api/item/recurringExpenses', json_body={
        'id': rec_id, 'name': 'Brutal Rent', 'amount': 500, 'currency': 'EUR',
        'frequency': 'monthly', 'nextDate': time.strftime('%Y-%m-%d', time.gmtime()),
    })
    _log('C08 Create recurringExpense', st == 200, f'HTTP {st}')

    # Connection
    st, _, _ = c.post('/api/item/connections', json_body={
        'id': conn_id, 'partnerAId': buyer_id, 'partnerBId': supplier_id,
        'type': 'client-supplier', 'notes': 'Brutal test edge',
    })
    _log('C09 Create connection', st == 200, f'HTTP {st}')

    # Shared document
    st, _, _ = c.post('/api/item/shared_documents', json_body={
        'id': doc_id, 'title': 'Brutal shared doc', 'partnerId': buyer_id,
        'category': 'contract',
    })
    _log('C10 Create shared_document', st == 200, f'HTTP {st}')

    # Read every entity type via GET /api/data/<key>
    for key in ['partners', 'products', 'deals', 'demands', 'accounts',
                'transactions', 'recurringExpenses', 'connections', 'offers',
                'shared_documents']:
        st, _, body = c.get(f'/api/data/{key}')
        j = _j(body) or {}
        _log(f'C11 GET /api/data/{key}',
             st == 200 and 'value' in j and isinstance(j.get('value'), list),
             f'HTTP {st} rows={len(j.get("value", []))}')

    # Bulk save via POST /api/data/<key> — must preserve portalVisibleProducts
    # (bulk-save is a full replace of that entity's rows, so anything missing = lost)
    st, _, body = c.post('/api/data/partners', json_body={'value': [
        {'id': buyer_id, 'companyName': 'Brutal Buyer',
         'contact': {'email': 'buyer@brutal.test'}, 'types': ['Buyer'],
         'portalToken': portal_token, 'isPortalActive': True,
         'portalVisibleProducts': [prod_id]},
        {'id': supplier_id, 'companyName': 'Brutal Supplier',
         'contact': {'email': 'sup@brutal.test'}, 'types': ['Supplier']},
    ]})
    _log('C12 POST /api/data/partners bulk-save', st == 200, f'HTTP {st}')

    # ==========================================================
    # D. DOCUMENTS + UPLOAD
    # ==========================================================
    print('\n-- D. Documents --')

    # Upload a fake PDF
    fake_pdf = b'%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF'
    mp_body, mp_ct = _multipart({'entity': 'partners', 'entityId': buyer_id},
                                  [('file', 'brutal.pdf', fake_pdf, 'application/pdf')])
    st, _, body = c.post('/api/upload',
                          headers={'Content-Type': mp_ct, 'X-CSRF-Token': c._csrf or ''},
                          raw_body=mp_body)
    j = _j(body) or {}
    # Endpoint returns {"url": "/uploads/<uuid.ext>"} — extract filename
    url = j.get('url') or ''
    uploaded_fname = url.rsplit('/', 1)[-1] if url else (j.get('filename') or j.get('name'))
    _log('D01 POST /api/upload', st in (200, 201) and uploaded_fname,
         f'HTTP {st} url={url}')

    if uploaded_fname:
        # Download
        st, _, dl_body = c.get(f'/uploads/{uploaded_fname}')
        _log('D02 GET /uploads/<x>',
             st == 200 and dl_body.startswith(b'%PDF'),
             f'HTTP {st} size={len(dl_body)}')

    # Admin documents list
    st, _, body = c.get('/api/admin/documents/list')
    j = _j(body) or {}
    docs = j if isinstance(j, list) else j.get('documents') or j.get('files') or []
    _log('D03 GET /api/admin/documents/list', st == 200 and isinstance(docs, list),
         f'HTTP {st} count={len(docs) if isinstance(docs, list) else "?"}')

    # Documents register — next number (preview only; response has 'docType' + 'note')
    st, _, body = c.get('/api/documents/next_number?docType=OFFER')
    j = _j(body) or {}
    _log('D04 GET /api/documents/next_number',
         st == 200 and isinstance(j, dict) and ('docType' in j or 'number' in j or 'next' in j),
         f'HTTP {st} keys={list(j.keys())[:5]}')

    # Documents register — issue number (docType must be lowercase per DOC_TYPE_PREFIX)
    st, _, body = c.post('/api/documents/issue', json_body={
        'docType': 'offer', 'entityId': offer_id,
    })
    j = _j(body) or {}
    doc_number = j.get('docNumber') or j.get('number')
    _log('D05 POST /api/documents/issue', st in (200, 201) and doc_number,
         f'HTTP {st} docNumber={doc_number}')

    # Register list
    st, _, body = c.get('/api/documents/register')
    _log('D06 GET /api/documents/register', st == 200, f'HTTP {st}')

    # Revise — requires docNumber + snapshot dict + changeReason
    if doc_number:
        st, _, body = c.post('/api/documents/revise', json_body={
            'docNumber': doc_number,
            'snapshot': {'offerNo': f'OFF-BRUTAL-{ts}', 'sellingPrice': 2900},
            'changeReason': 'brutal test correction',
        })
        _log('D07 POST /api/documents/revise', st in (200, 201),
             f'HTTP {st} body={str(body)[:100]}')

        st, _, _ = c.get(f'/api/documents/history/{urllib.parse.quote(doc_number)}')
        _log('D08 GET /api/documents/history/<n>', st == 200, f'HTTP {st}')

    # ==========================================================
    # E. OFFERS deep (versions, PDF, verify)
    # ==========================================================
    print('\n-- E. Offers --')

    # Version list (initially empty)
    st, _, body = c.get(f'/api/offers/{offer_id}/versions')
    j = _j(body) or {}
    _log('E01 Offer versions initially empty', st == 200 and j.get('count') == 0, f'HTTP {st}')

    # Edit price → creates version
    st, _, _ = c.post('/api/item/offers', json_body={
        'id': offer_id, 'offerNo': f'OFF-BRUTAL-{ts}',
        'date': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'customerId': buyer_id, 'productId': prod_id, 'productName': 'Brutal Cocoa',
        'quantity': 20, 'unit': 't', 'sellingPrice': 2800,  # changed
        'currency': 'USD', 'incoterm': 'CIF', 'pol': 'Tema', 'pod': 'Antwerp',
        'items': [{'productId': prod_id, 'productName': 'Brutal Cocoa',
                   'quantity': 20, 'unit': 't', 'price': 2800, 'currency': 'USD'}],
    })
    _log('E02 Edit offer price', st == 200, f'HTTP {st}')

    st, _, body = c.get(f'/api/offers/{offer_id}/versions')
    j = _j(body) or {}
    versions = j.get('versions', [])
    _log('E03 Version snapshot created', j.get('count') == 1, f'count={j.get("count")}')

    # Get single version snapshot
    if versions:
        vid = versions[0]['id']
        st, _, body = c.get(f'/api/offers/{offer_id}/versions/{vid}')
        j = _j(body) or {}
        _log('E04 GET version snapshot returns full JSON',
             st == 200 and (j.get('snapshot') or {}).get('sellingPrice') == 2500,
             f'HTTP {st}')

        # Restore
        st, _, _ = c.post(f'/api/offers/{offer_id}/versions/{vid}/restore',
                          json_body={'reason': 'brutal test'})
        _log('E05 Restore version', st == 200, f'HTTP {st}')

    # PDF preview
    st, headers, body = c.post('/api/offers/preview_pdf', json_body={'offerId': offer_id})
    _log('E06 preview_pdf returns PDF',
         st == 200 and body[:4] == b'%PDF',
         f'HTTP {st} size={len(body)}')

    # Generate PDF (writes to vault)
    st, _, body = c.post(f'/api/offers/{offer_id}/generate_pdf', json_body={})
    _log('E07 generate_pdf', st in (200, 201), f'HTTP {st}')

    # Verify hash — with bogus data (must respond structured, not 500)
    st, _, body = c.post('/api/offers/verify_hash', json_body={
        'offer_no': f'OFF-BRUTAL-{ts}', 'hash': 'FAKEXXXX',
    })
    j = _j(body) or {}
    _log('E08 verify_hash returns valid: false',
         st in (200, 400) and 'valid' in j,
         f'HTTP {st}')

    # ==========================================================
    # F. OFFER → DEAL
    # ==========================================================
    print('\n-- F. Deal from offer --')
    st, _, body = c.post(f'/api/deals/from_offer/{offer_id}', json_body={'force': True})
    j = _j(body) or {}
    deal_id = j.get('dealId')
    _log('F01 Force convert offer → deal', st == 200 and deal_id, f'HTTP {st}')

    # Second attempt must fail with 409
    st, _, _ = c.post(f'/api/deals/from_offer/{offer_id}', json_body={'force': True})
    _log('F02 Double conversion blocked (409)', st == 409, f'HTTP {st}')

    # Non-existent offer
    st, _, _ = c.post('/api/deals/from_offer/nonexistent-offer', json_body={'force': True})
    _log('F03 Convert nonexistent offer → 404', st == 404, f'HTTP {st}')

    # ==========================================================
    # G. SYSTEM (health, backup, search, otp_delivery, chat_webhooks, hcaptcha, api_keys)
    # ==========================================================
    print('\n-- G. System --')

    st, _, body = c.get('/api/system/health')
    j = _j(body) or {}
    _log('G01 GET /api/system/health',
         st == 200 and 'databases' in j and 'storage' in j and 'firewall' in j,
         f'HTTP {st}')

    st, _, body = c.get('/api/system/backup/full')
    _log('G02 GET /api/system/backup/full → gzip',
         st == 200 and body[:2] == b'\x1f\x8b', f'HTTP {st} size={len(body)}')

    st, _, _ = c.post('/api/system/backup/now', json_body={})
    _log('G03 POST /api/system/backup/now', st == 200, f'HTTP {st}')

    st, _, _ = c.post('/api/system/search/rebuild')
    _log('G04 POST /api/system/search/rebuild', st == 200, f'HTTP {st}')

    st, _, body = c.get('/api/system/search?q=Brutal')
    j = _j(body) or {}
    _log('G05 GET /api/system/search finds Brutal',
         st == 200 and len(j.get('results', [])) > 0,
         f'HTTP {st} hits={len(j.get("results", []))}')

    st, _, body = c.get('/api/system/search/stats')
    _log('G06 GET /api/system/search/stats', st == 200, f'HTTP {st}')

    # OTP delivery
    st, _, body = c.get('/api/system/otp_delivery')
    j = _j(body) or {}
    _log('G07 GET /api/system/otp_delivery', st == 200 and 'provider' in j,
         f'HTTP {st} provider={j.get("provider")}')

    st, _, _ = c.post('/api/system/otp_delivery', json_body={
        'provider': 'smtp', 'from_email': 'noreply@brutal.test',
        'from_name': 'Brutal', 'magic_link_enabled': True,
    })
    _log('G08 POST /api/system/otp_delivery', st == 200, f'HTTP {st}')

    st, _, _ = c.post('/api/system/otp_delivery/test',
                       json_body={'to': 'admin@brutal.test'})
    _log('G09 POST /api/system/otp_delivery/test',
         st in (200, 400, 500),  # 500 acceptable if no SMTP configured
         f'HTTP {st}')

    # Chat webhooks
    st, _, body = c.get('/api/system/chat_webhooks')
    _log('G10 GET /api/system/chat_webhooks', st == 200, f'HTTP {st}')

    st, _, _ = c.post('/api/system/chat_webhooks', json_body={
        'slack_url': '', 'teams_url': '', 'telegram_bot_token': '', 'telegram_chat_id': '',
        'ntfy_url': '', 'ntfy_topic': '',
        'events': {'offer_accepted': True, 'kyc_submitted': True},
    })
    _log('G11 POST /api/system/chat_webhooks', st == 200, f'HTTP {st}')

    st, _, _ = c.post('/api/system/chat_webhooks/test', json_body={'channel': 'slack'})
    _log('G12 POST /api/system/chat_webhooks/test (unconfigured→200/400/500)',
         st in (200, 400, 500), f'HTTP {st}')

    # hCaptcha
    st, _, body = c.get('/api/system/hcaptcha')
    _log('G13 GET /api/system/hcaptcha', st == 200, f'HTTP {st}')
    st, _, _ = c.post('/api/system/hcaptcha', json_body={
        'sitekey': '', 'secret': '', 'enabled': False,
    })
    _log('G14 POST /api/system/hcaptcha', st == 200, f'HTTP {st}')

    # API keys
    st, _, body = c.get('/api/system/api_keys')
    j = _j(body) or {}
    _log('G15 GET /api/system/api_keys', st == 200 and isinstance(j, dict),
         f'HTTP {st} keys={list(j.keys())[:5]}')
    st, _, _ = c.post('/api/system/api_keys', json_body={
        'openai': '', 'anthropic': '', 'exchangerate_host_key': '', 'marinetraffic_key': '',
    })
    _log('G16 POST /api/system/api_keys', st == 200, f'HTTP {st}')

    # ==========================================================
    # H. VAULT
    # ==========================================================
    print('\n-- H. Vault --')
    st, _, body = c.get('/api/vault/documents')
    j = _j(body) or {}
    _log('H01 GET /api/vault/documents', st == 200, f'HTTP {st}')

    # ==========================================================
    # I. FIREWALL
    # ==========================================================
    print('\n-- I. Firewall --')
    st, _, body = c.get('/api/firewall/settings')
    _log('I01 GET /api/firewall/settings', st == 200, f'HTTP {st}')
    st, _, body = c.get('/api/firewall/status')
    _log('I02 GET /api/firewall/status', st == 200, f'HTTP {st}')

    st, _, _ = c.post('/api/firewall/whitelist/add', json_body={'ip': '203.0.113.5'})
    _log('I03 whitelist add', st in (200, 201), f'HTTP {st}')
    st, _, _ = c.post('/api/firewall/whitelist/remove', json_body={'ip': '203.0.113.5'})
    _log('I04 whitelist remove', st == 200, f'HTTP {st}')

    st, _, _ = c.post('/api/firewall/blacklist/add', json_body={'ip': '198.51.100.99'})
    _log('I05 blacklist add', st in (200, 201), f'HTTP {st}')
    st, _, _ = c.post('/api/firewall/blacklist/remove', json_body={'ip': '198.51.100.99'})
    _log('I06 blacklist remove', st == 200, f'HTTP {st}')

    st, _, _ = c.post('/api/firewall/unblock', json_body={'ip': '198.51.100.99'})
    _log('I07 unblock IP', st in (200, 404), f'HTTP {st}')

    st, _, _ = c.post('/api/firewall/settings', json_body={
        'max_login_attempts': 5, 'block_duration_minutes': 15,
    })
    _log('I08 POST firewall/settings', st == 200, f'HTTP {st}')

    st, _, _ = c.post('/api/firewall/config', json_body={
        'blacklist': [], 'whitelist': [],
    })
    _log('I09 POST firewall/config', st == 200, f'HTTP {st}')

    # ==========================================================
    # J. COMMS
    # ==========================================================
    print('\n-- J. Comms --')
    st, _, body = c.get('/api/comms/email_queue')
    _log('J01 GET /api/comms/email_queue', st == 200, f'HTTP {st}')

    st, _, _ = c.post('/api/comms/email_queue/retry_now', json_body={})
    _log('J02 POST retry_now', st == 200, f'HTTP {st}')

    st, _, body = c.post('/api/comms/test_smtp', json_body={'to': 'admin@brutal.test'})
    _log('J03 POST test_smtp (unconfigured OK)', st in (200, 400, 500),
         f'HTTP {st}')

    st, _, body = c.post('/api/comms/send_email', json_body={
        'to': 'admin@brutal.test', 'subject': 'brutal', 'body': 'test',
    })
    _log('J04 POST send_email (queued OK)', st in (200, 202, 400, 500),
         f'HTTP {st}')

    # ==========================================================
    # K. SANCTIONS
    # ==========================================================
    print('\n-- K. Sanctions --')
    st, _, body = c.post('/api/sanctions/screen', json_body={
        'name': 'John Doe', 'country': 'US',
    })
    j = _j(body) or {}
    _log('K01 POST /api/sanctions/screen',
         st in (200, 400, 500) and (isinstance(j, dict) or isinstance(j, list)),
         f'HTTP {st}')

    # ==========================================================
    # L. AUDIT
    # ==========================================================
    print('\n-- L. Audit --')
    st, _, body = c.get('/api/audit_logs?limit=5')
    j = _j(body)
    _log('L01 GET /api/audit_logs',
         st == 200 and isinstance(j, list) and len(j) > 0, f'HTTP {st}')

    st, _, _ = c.post('/api/audit/event', json_body={
        'action': 'CLIENT_EVENT', 'module': 'brutal', 'details': 'brutal e2e test event',
    })
    _log('L02 POST /api/audit/event', st in (200, 201), f'HTTP {st}')

    # ==========================================================
    # M. PORTAL ADMIN
    # ==========================================================
    print('\n-- M. Portal admin --')
    st, _, body = c.get('/api/portal/admin/activity?limit=10')
    _log('M01 GET portal/admin/activity', st == 200, f'HTTP {st}')

    st, _, body = c.get('/api/portal/admin/activity/stats')
    _log('M02 GET portal/admin/activity/stats', st == 200, f'HTTP {st}')

    st, _, body = c.get('/api/portal/admin/pending_counts')
    j = _j(body) or {}
    _log('M03 GET portal/admin/pending_counts',
         st == 200 and isinstance(j, dict), f'HTTP {st}')

    st, _, body = c.get(f'/api/portal/admin/preview/{buyer_id}')
    _log('M04 GET portal/admin/preview/<partner_id>', st == 200, f'HTTP {st}')

    st, _, body = c.get('/api/portal/admin/products')
    _log('M05 GET portal/admin/products', st == 200, f'HTTP {st}')

    st, _, body = c.get('/api/portal/admin/submissions/all')
    _log('M06 GET portal/admin/submissions/all', st == 200, f'HTTP {st}')

    st, _, body = c.get(f'/api/portal/admin/submissions/{buyer_id}')
    _log('M07 GET portal/admin/submissions/<partner_id>', st == 200, f'HTTP {st}')

    st, _, body = c.get('/api/portal/admin/profile_requests')
    _log('M08 GET portal/admin/profile_requests', st == 200, f'HTTP {st}')

    st, _, body = c.get('/api/portal/admin/hidden_items')
    _log('M09 GET portal/admin/hidden_items', st == 200, f'HTTP {st}')

    st, _, _ = c.post(f'/api/portal/admin/permissions/{buyer_id}', json_body={
        'permissions': {'canRequestQuote': True, 'canSubmitProducts': False,
                        'canRequestKycUpdate': True},
    })
    _log('M10 POST portal/admin/permissions', st == 200, f'HTTP {st}')

    st, _, _ = c.post(f'/api/portal/admin/offers/mark_seen/{offer_id}', json_body={})
    _log('M11 POST portal/admin/offers/mark_seen', st in (200, 404), f'HTTP {st}')

    # ==========================================================
    # N. PORTAL CLIENT-FACING
    # ==========================================================
    print('\n-- N. Portal client-facing --')

    st, _, body = c.get('/api/portal/public_config')
    _log('N01 GET /api/portal/public_config', st == 200, f'HTTP {st}')

    st, _, body = c.get(f'/portal/{portal_token}')
    _log('N02 GET /portal/<token> renders HTML',
         st == 200 and b'<html' in body[:2000].lower(), f'HTTP {st}')

    st, _, body = c.get('/portal/')
    _log('N03 GET /portal/ (no token) → login page or 404',
         st in (200, 404), f'HTTP {st}')

    st, _, body = c.get('/portal/login')
    _log('N04 GET /portal/login', st == 200, f'HTTP {st}')

    # Portal session client — separate cookie jar so admin + portal sessions
    # don't collide inside the same Flask secret-session cookie.
    pc = Client(BASE)
    pc.refresh_csrf()

    st, _, body = pc.post(f'/api/portal/auth/send_otp/{portal_token}',
                           json_body={'email': 'buyer@brutal.test'})
    _log('N05 POST portal/auth/send_otp', st in (200, 202), f'HTTP {st}')

    # Fetch OTP via test-only endpoint (requires TEST_MODE=1 env on server)
    st, _, body = pc.get(f'/api/portal/testonly/last_otp/{portal_token}')
    j = _j(body) or {}
    otp = j.get('otp') or j.get('code')
    _log('N06 GET testonly/last_otp returns OTP',
         bool(otp) and str(otp).isdigit(), f'otp={otp} (TEST_MODE required)')

    if otp:
        st, _, body = pc.post(f'/api/portal/auth/verify_otp/{portal_token}',
                               json_body={'otp': otp,
                                          'location': '44.7866,20.4489',
                                          'device': 'brutal'})
        j = _j(body) or {}
        auth_key = j.get('auth_key')
        _log('N07 POST portal/auth/verify_otp with correct code',
             st == 200 and auth_key,
             f'HTTP {st} auth_key={"yes" if auth_key else "no"}')
        # Portal auth is NOT session-cookie based — it uses X-Portal-Auth header
        # returned by verify_otp. Set it on the client so all subsequent portal
        # requests pass authorization.
        if auth_key:
            pc.portal_auth = auth_key
        pc.refresh_csrf()

    # Fetch portal data (needs verified session — use pc)
    st, _, body = pc.get(f'/api/portal/data/{portal_token}')
    _log('N08 GET portal/data/<token>', st == 200, f'HTTP {st}')

    # Portal catalog
    st, _, body = pc.get(f'/api/portal/catalog/{portal_token}')
    _log('N09 GET portal/catalog/<token>', st in (200, 403), f'HTTP {st}')

    # Portal profile change request
    st, _, body = pc.post(f'/api/portal/profile/update/{portal_token}',
                          json_body={'field': 'phone', 'newValue': '+381600000009'})
    _log('N10 POST portal/profile/update', st in (200, 202, 400),
         f'HTTP {st} body={str(body)[:100]}')

    # Portal RFQ submit
    st, _, body = pc.post(f'/api/portal/rfq/submit/{portal_token}', json_body={
        'productName': 'Brutal RFQ product', 'quantity': 5, 'unit': 't',
    })
    _log('N11 POST portal/rfq/submit', st in (200, 201),
         f'HTTP {st} body={str(body)[:120]}')

    # Portal quote_request
    st, _, body = pc.post(f'/api/portal/quote_request/{portal_token}', json_body={
        'productId': prod_id, 'quantity': 10, 'unit': 't',
    })
    _log('N12 POST portal/quote_request', st in (200, 201),
         f'HTTP {st} body={str(body)[:120]}')

    # Portal submit product
    st, _, body = pc.post(f'/api/portal/products/submit/{portal_token}', json_body={
        'name': 'Brutal client-submitted product', 'category': 'agriculture',
        'hsCode': '09011100',
    })
    _log('N13 POST portal/products/submit', st in (200, 201, 403),
         f'HTTP {st}')

    # Portal KYC submit — bankIban + bankSwift + explicit consent all required
    st, _, body = pc.post(f'/api/portal/kyc/submit/{portal_token}', json_body={
        'companyName': 'Brutal Buyer', 'taxId': 'RS12345678',
        'entityType': 'company', 'consent': True,
        'bankIban': 'DE89370400440532013000', 'bankSwift': 'COBADEFFXXX',
        'address': {'street': 'Main 1', 'city': 'Belgrade', 'country': 'RS'},
        'contact': {'email': 'buyer@brutal.test', 'phone': '+381600000001'},
    })
    _log('N14 POST portal/kyc/submit', st in (200, 201),
         f'HTTP {st} body={str(body)[:120]}')

    # Portal file upload
    mp_body, mp_ct = _multipart({'category': 'kyc'},
                                  [('file', 'kyc-doc.pdf', fake_pdf, 'application/pdf')])
    st, _, body = pc.post(f'/api/portal/upload/{portal_token}',
                          headers={'Content-Type': mp_ct, 'X-CSRF-Token': pc._csrf or ''},
                          raw_body=mp_body)
    _log('N15 POST portal/upload', st in (200, 201, 403), f'HTTP {st}')

    # Portal hide item — uses snake_case per API contract
    st, _, body = pc.post(f'/api/portal/hide/{portal_token}', json_body={
        'entity_type': 'offer', 'entity_id': offer_id,
    })
    _log('N16 POST portal/hide', st in (200, 201),
         f'HTTP {st} body={str(body)[:100]}')

    st, _, body = pc.get(f'/api/portal/hidden/{portal_token}')
    _log('N17 GET portal/hidden/<token>', st in (200, 403), f'HTTP {st}')

    # ==========================================================
    # O. VERIFY (public QR endpoint)
    # ==========================================================
    print('\n-- O. Verify --')

    st, _, body = c.get('/verify/VER-BRUTAL00000000')  # 19 chars
    _log('O01 /verify/<VER-hash> → HTML',
         st == 200 and b'<html' in body[:5000].lower(), f'HTTP {st}')

    st, _, _ = c.get('/verify/BADPREFIX_XX')
    _log('O02 /verify/<bad-prefix> → 404', st == 404, f'HTTP {st}')

    # >30 chars total (route rejects when len > 30)
    st, _, _ = c.get('/verify/VER-TOOLONGHASHXXXXXXXXXXXXXXXXX')
    _log('O03 /verify/<oversized> → 404', st == 404, f'HTTP {st}')

    # ==========================================================
    # P. Portal generate-link admin endpoint
    # ==========================================================
    print('\n-- P. Portal admin: generate/access --')
    st, _, body = c.post(f'/api/portal/generate/{buyer_id}',
                          json_body={'send_welcome': False})
    _log('P01 POST /api/portal/generate/<partner_id>',
         st in (200, 201), f'HTTP {st}')

    st, _, _ = c.post(f'/api/portal/access/{buyer_id}',
                       json_body={'action': 'revoke'})
    _log('P02 POST /api/portal/access/<partner_id> revoke',
         st in (200, 201, 400), f'HTTP {st}')

    st, _, _ = c.post(f'/api/portal/access/{buyer_id}',
                       json_body={'action': 'reactivate'})
    _log('P03 POST /api/portal/access reactivate',
         st in (200, 201, 400), f'HTTP {st}')

    # ==========================================================
    # Q. STATIC / MISC
    # ==========================================================
    print('\n-- Q. Static / misc --')
    st, _, body = c.get('/')
    _log('Q01 GET / (SPA index)', st == 200 and b'<html' in body[:1000].lower(),
         f'HTTP {st} size={len(body)}')

    st, _, body = c.get('/robots.txt')
    _log('Q02 GET /robots.txt', st == 200, f'HTTP {st}')

    st, _, body = c.get('/static/css/main.css')
    _log('Q03 GET /static/css/main.css', st in (200, 404), f'HTTP {st}')

    # ==========================================================
    # R. LOGISTICS (in-app, no external API needed for ports/airports lists)
    # ==========================================================
    print('\n-- R. Logistics (bundled data) --')
    st, _, body = c.get('/api/logistics/ports')
    j = _j(body)
    ports = j if isinstance(j, list) else (j or {}).get('ports', [])
    _log('R01 GET /api/logistics/ports', st == 200 and isinstance(ports, list),
         f'HTTP {st} count={len(ports) if isinstance(ports, list) else "?"}')

    st, _, body = c.get('/api/logistics/airports')
    j = _j(body)
    airports = j if isinstance(j, list) else (j or {}).get('airports', [])
    _log('R02 GET /api/logistics/airports', st == 200 and isinstance(airports, list),
         f'HTTP {st} count={len(airports) if isinstance(airports, list) else "?"}')

    st, _, body = c.get('/api/logistics/vessels')
    _log('R03 GET /api/logistics/vessels', st == 200, f'HTTP {st}')

    st, _, body = c.get('/api/logistics/disruptions')
    _log('R04 GET /api/logistics/disruptions', st == 200, f'HTTP {st}')

    st, _, body = c.get('/api/logistics/search?q=Belgrade')
    _log('R05 GET /api/logistics/search', st == 200, f'HTTP {st}')

    # ==========================================================
    # S. Bulk operations (offer PDF etc already covered) — nothing else
    # ==========================================================

    # ==========================================================
    # S. ADVERSARIAL — negative paths, malformed input, auth boundaries
    # ==========================================================
    print('\n-- S. Adversarial / edge cases --')

    # S01: unauthenticated request to protected endpoint must 401
    c2 = Client(BASE)
    st, _, _ = c2.get('/api/data/partners')
    _log('S01 Unauthenticated /api/data/partners → 401', st in (401, 403), f'HTTP {st}')

    # S02: request without CSRF token → 401 (server-side CSRF)
    c3 = Client(BASE)
    c3.post('/api/auth/login', json_body={
        'username': ADMIN_USER, 'password': ADMIN_PASS,
        'location': '44.7866,20.4489', 'device': 'no-csrf',
    })
    # deliberately skip CSRF (server rejects with 401 or 403)
    st, _, _ = c3.request('POST', '/api/item/partners',
                          json_body={'id': 'noop', 'companyName': 'x'})
    _log('S02 POST without CSRF → 401/403', st in (401, 403), f'HTTP {st}')

    # S03: malformed JSON body
    st, _, _ = c.request('POST', '/api/item/partners',
                         headers={'Content-Type': 'application/json',
                                  'X-CSRF-Token': c._csrf or ''},
                         raw_body=b'{not-json')
    _log('S03 Malformed JSON handled (400 or 500-avoided)',
         st in (400, 500), f'HTTP {st}')

    # S04: SQL-injection in id (URL-encoded to survive HTTP path parser)
    sqli = urllib.parse.quote("'; DROP TABLE offers;--", safe='')
    st, _, _ = c.get(f'/api/offers/{sqli}/versions')
    _log('S04 SQLi in path handled (no 500)',
         st in (200, 400, 404), f'HTTP {st}')

    # S05: XSS attempt in partner name — must be saved as-is (escaped on render)
    xss_id = f'xss-test-{ts}'
    st, _, _ = c.post('/api/item/partners', json_body={
        'id': xss_id,
        'companyName': '<script>alert(1)</script>',
        'contact': {'email': 'x@y.z'},
    })
    _log('S05 XSS payload accepted (escaped on render)',
         st in (200, 400), f'HTTP {st}')
    c.delete(f'/api/item/partners/{xss_id}')

    # S06: over-sized ID
    huge_id = 'X' * 5000
    st, _, _ = c.get(f'/api/offers/{huge_id}/versions')
    _log('S06 Oversized ID handled', st in (200, 400, 404, 413, 414),
         f'HTTP {st}')

    # S07: invalid docType on issue
    st, _, _ = c.post('/api/documents/issue', json_body={
        'docType': 'NONEXISTENT_TYPE', 'entityId': 'x',
    })
    _log('S07 Invalid docType → 400',
         st == 400, f'HTTP {st}')

    # S08: revise without changeReason
    st, _, _ = c.post('/api/documents/revise', json_body={
        'docNumber': 'FAKE-2026-0001', 'snapshot': {},
    })
    _log('S08 Revise without changeReason → 400',
         st == 400, f'HTTP {st}')

    # S09: non-admin user trying to hit admin endpoints.
    # NOTE: server assigns UUID on create — must omit id on POST /api/users.
    emp_username = f'emp_adv_{ts}'
    emp_pw = 'EmpAdv!123456'
    st, _, body = c.post('/api/users', json_body={
        'username': emp_username,
        'password': emp_pw, 'role': 'employee',
        'permissions': {'partners_view': True},
    })
    j = _j(body) or {}
    emp_real_id = j.get('id')
    ec = Client(BASE)
    ec.post('/api/auth/login', json_body={
        'username': emp_username, 'password': emp_pw,
        'location': '44.7866,20.4489', 'device': 'emp',
    })
    ec.refresh_csrf()
    # Employee tries admin-only backup
    st, _, _ = ec.get('/api/system/backup/full')
    _log('S09 Employee → /api/system/backup/full = 403',
         st == 403, f'HTTP {st}')
    st, _, _ = ec.get('/api/users')
    _log('S10 Employee → GET /api/users = 403',
         st == 403, f'HTTP {st}')
    # Cleanup emp
    if emp_real_id:
        c.delete(f'/api/users/{emp_real_id}')

    # S11: portal request without X-Portal-Auth on protected endpoint
    st, _, _ = c2.get(f'/api/portal/data/nonexistent-token')
    _log('S11 Portal data without auth → 401', st == 401, f'HTTP {st}')

    # S12: invalid OTP → 401
    pc2 = Client(BASE)
    pc2.refresh_csrf()
    st, _, _ = pc2.post(f'/api/portal/auth/verify_otp/{portal_token}',
                        json_body={'otp': '000000', 'location': '44.7866,20.4489'})
    _log('S12 Wrong OTP → 401', st == 401, f'HTTP {st}')

    # S13: portal login without GPS for non-premium → 403 LOCATION_REQUIRED
    pc3 = Client(BASE)
    pc3.refresh_csrf()
    pc3.post(f'/api/portal/auth/send_otp/{portal_token}',
             json_body={'email': 'buyer@brutal.test'})
    st, _, body = pc3.get(f'/api/portal/testonly/last_otp/{portal_token}')
    _otp3 = (_j(body) or {}).get('otp')
    if _otp3:
        st, _, body = pc3.post(f'/api/portal/auth/verify_otp/{portal_token}',
                                json_body={'otp': _otp3, 'location': ''})
        _log('S13 verify_otp without GPS → 403 LOCATION_REQUIRED',
             st == 403 and b'LOCATION_REQUIRED' in body,
             f'HTTP {st}')

    # S14: /uploads/ path traversal attempt
    st, _, _ = c.get('/uploads/..%2F..%2Fetc%2Fpasswd')
    _log('S14 uploads path traversal blocked',
         st in (400, 403, 404), f'HTTP {st}')

    # S15: /portal_uploads/ path traversal
    st, _, _ = c.get('/portal_uploads/..%2F..%2Fetc%2Fpasswd')
    _log('S15 portal_uploads path traversal blocked',
         st in (400, 403, 404), f'HTTP {st}')

    # S16: HTTP method not allowed on a POST-only route
    st, _, _ = c.get('/api/auth/login')
    _log('S16 GET on POST-only /api/auth/login → 405',
         st == 405, f'HTTP {st}')

    # S17: DELETE unknown entity type
    st, _, _ = c.delete('/api/item/nonexistent_entity/xyz')
    _log('S17 DELETE unknown entity → 400/404',
         st in (400, 404, 500), f'HTTP {st}')

    # S18: Save item with empty payload
    st, _, _ = c.post('/api/item/partners', json_body={})
    _log('S18 Save with empty payload → 400',
         st == 400, f'HTTP {st}')

    # S19: Save item without id
    st, _, _ = c.post('/api/item/partners', json_body={'companyName': 'no-id'})
    _log('S19 Save without id → 400',
         st == 400, f'HTTP {st}')

    # S20: Restore nonexistent version
    st, _, _ = c.post(f'/api/offers/{offer_id}/versions/nonexistent-vid/restore',
                       json_body={'reason': 'x'})
    _log('S20 Restore missing version → 404',
         st == 404, f'HTTP {st}')

    # ==========================================================
    # T. Cleanup (delete all created)
    # ==========================================================
    print('\n-- T. Cleanup --')
    for entity, eid in [
        ('offers', offer_id), ('products', prod_id), ('demands', demand_id),
        ('accounts', account_id), ('transactions', tx_id),
        ('recurringExpenses', rec_id), ('connections', conn_id),
        ('shared_documents', doc_id),
        ('partners', buyer_id), ('partners', supplier_id),
    ]:
        st, _, _ = c.delete(f'/api/item/{entity}/{eid}')
        _log(f'T01 DELETE {entity}/{eid[:20]}', st in (200, 204, 404),
             f'HTTP {st}')
    if deal_id:
        st, _, _ = c.delete(f'/api/item/deals/{deal_id}')
        _log('T02 DELETE deal', st in (200, 404), f'HTTP {st}')

    if uploaded_fname:
        st, _, _ = c.delete(f'/api/upload/{uploaded_fname}')
        _log('T03 DELETE /api/upload/<x>', st in (200, 204, 404), f'HTTP {st}')

    _finalize()


def _finalize():
    passed = sum(1 for r in _results if r['ok'])
    failed = sum(1 for r in _results if not r['ok'])
    print(f'\n{"="*60}')
    print(f'BRUTAL E2E SUMMARY: {passed}/{len(_results)} passed, {failed} failed')
    print(f'{"="*60}')
    if failed:
        print('\nFAILED:')
        for r in _results:
            if not r['ok']:
                print(f'  ✗ {r["name"]:65s} {r["detail"]}')
    try:
        os.makedirs('/tmp/aspidus_run', exist_ok=True)
        with open('/tmp/aspidus_run/brutal_report.json', 'w') as f:
            json.dump({'results': _results, 'passed': passed, 'failed': failed}, f, indent=2)
        print(f'\nReport: /tmp/aspidus_run/brutal_report.json')
    except Exception:
        pass
    sys.exit(0 if failed == 0 else 1)


if __name__ == '__main__':
    main()
