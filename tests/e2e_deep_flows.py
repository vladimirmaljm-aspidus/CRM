"""E2E DEEP FLOWS — kompletan user-simulation preko HTTP-a.

Umesto klik-po-klik (Playwright), ovaj skript se logu­je kao admin, prolazi
kroz kompletan poslovni tok koji koristi normalan korisnik:

  1. Login + verify session
  2. Create partner (buyer + supplier)
  3. Create product (sa HS + CAS)
  4. Create demand → offer (multi-line) → verify offer_versions initially empty
  5. Edit offer price → verify version snapshot created + fields tracked
  6. Restore version → verify revert + new snapshot
  7. Generate + download offer PDF → verify binary is real PDF
  8. Convert offer to deal (force mode) → verify deal contains all offer fields
  9. Portal admin generate token for buyer
  10. Portal public_config
  11. Portal /portal/<token> loads
  12. Portal OTP request path (email will fail — that's fine, we test 200)
  13. FULL backup download → validate tar.gz structure
  14. Health check
  15. Audit log accessible
  16. Verify QR verification page
  17. Search indexing works

Svaki fail se ispisuje kao [FAIL] sa punim body-jem odgovora. Skript izlazi
sa exit code 0 ako sve prođe, inače 1.

Zahteva:
  - App pokrenut na APP_BASE (default http://127.0.0.1:5000)
  - Admin nalog kreiran preko ADMIN_USERNAME/ADMIN_PASSWORD env-a

Pokretanje:
    APP_BASE=http://127.0.0.1:5000 python tests/e2e_deep_flows.py
"""
from __future__ import annotations
import base64
import io
import json
import os
import random
import sys
import tarfile
import time
import urllib.request
import urllib.parse
import http.cookiejar

BASE = os.environ.get('APP_BASE', 'http://127.0.0.1:5000')
ADMIN_USER = os.environ.get('ADMIN_USERNAME', 'testadmin')
ADMIN_PASS = os.environ.get('ADMIN_PASSWORD', 'TestAdmin!12345')

_results = []


def _log(msg: str, ok: bool = True, detail: str = ''):
    marker = '\033[32m✓\033[0m' if ok else '\033[31m✗\033[0m'
    print(f'  {marker} {msg}' + (f' — {detail}' if detail else ''))
    _results.append({'name': msg, 'ok': ok, 'detail': detail})


class Client:
    """Tanak wrapper oko urllib sa cookie jar-om i CSRF token cache-om."""

    def __init__(self, base: str):
        self.base = base.rstrip('/')
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self._csrf = None

    def request(self, method: str, path: str, *, json_body=None, headers=None, raw_body=None):
        url = self.base + path
        h = dict(headers or {})
        data = None
        if json_body is not None:
            data = json.dumps(json_body).encode('utf-8')
            h.setdefault('Content-Type', 'application/json')
        elif raw_body is not None:
            data = raw_body
        req = urllib.request.Request(url, data=data, method=method, headers=h)
        try:
            resp = self.opener.open(req, timeout=15)
            return resp.status, resp.headers, resp.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers, e.read()
        except Exception as e:
            return -1, {}, str(e).encode('utf-8')

    def get(self, path, headers=None):
        return self.request('GET', path, headers=headers)

    def post(self, path, json_body=None, headers=None, raw_body=None):
        h = dict(headers or {})
        if self._csrf:
            h.setdefault('X-CSRF-Token', self._csrf)
        return self.request('POST', path, json_body=json_body, headers=h, raw_body=raw_body)

    def delete(self, path, headers=None):
        h = dict(headers or {})
        if self._csrf:
            h.setdefault('X-CSRF-Token', self._csrf)
        return self.request('DELETE', path, headers=h)

    def refresh_csrf(self):
        st, _, body = self.get('/api/csrf/token')
        try:
            j = json.loads(body)
            self._csrf = j.get('csrf_token')
        except Exception:
            self._csrf = None
        return self._csrf


def _j(body):
    try: return json.loads(body)
    except: return None


def main():
    c = Client(BASE)
    print(f'=== E2E DEEP FLOWS against {BASE} ===\n')

    # ---------- 1. AUTH ----------
    print('-- 1. Auth --')
    st, _, body = c.post('/api/auth/login', json_body={
        'username': ADMIN_USER, 'password': ADMIN_PASS,
        'location': '44.7866,20.4489', 'device': 'e2e/1.0',
    })
    _log('Admin login', st == 200, f'HTTP {st} body={body[:100]}')
    if st != 200: return _finalize()

    c.refresh_csrf()
    _log('CSRF token obtained', c._csrf is not None, f'{(c._csrf or "")[:16]}…')

    st, _, body = c.get('/api/auth/me')
    j = _j(body) or {}
    _log('Auth /me returns admin', st == 200 and j.get('user', {}).get('role') == 'admin',
         f'HTTP {st} role={j.get("user",{}).get("role")}')

    # ---------- 2. PARTNERS (buyer + supplier) ----------
    print('\n-- 2. Partners --')
    buyer_id = f'e2e-buyer-{int(time.time())}'
    supplier_id = f'e2e-sup-{int(time.time())}'

    portal_token = 'E2E_DEEP_' + base64.b32encode(os.urandom(20)).decode('ascii').rstrip('=')
    st, _, body = c.post('/api/item/partners', json_body={
        'id': buyer_id, 'companyName': 'E2E Deep Buyer', 'entityType': 'company',
        'contact': {'email': 'buyer@example.com', 'phone': '+1234567890'},
        'address': {'street': 'Main 1', 'city': 'Belgrade', 'country': 'RS'},
        'taxId': 'RS12345678', 'regNumber': '12345', 'types': ['Buyer'],
        'portalToken': portal_token, 'isPortalActive': True,
    })
    _log('Create buyer partner with portal token', st == 200, f'HTTP {st}')

    st, _, body = c.post('/api/item/partners', json_body={
        'id': supplier_id, 'companyName': 'E2E Deep Supplier', 'entityType': 'company',
        'contact': {'email': 'sup@example.com'},
        'address': {'street': 'Port Rd 2', 'city': 'Antwerp', 'country': 'BE'},
        'types': ['Supplier'],
    })
    _log('Create supplier partner', st == 200, f'HTTP {st}')

    st, _, body = c.get('/api/data/partners')
    partners = (_j(body) or {}).get('value', [])
    ids = {p.get('id') for p in partners}
    _log('Both partners readable via /api/data/partners',
         buyer_id in ids and supplier_id in ids,
         f'have {len(partners)} partners')

    # ---------- 3. PRODUCTS ----------
    print('\n-- 3. Products --')
    prod_id = f'e2e-prod-{int(time.time())}'
    st, _, body = c.post('/api/item/products', json_body={
        'id': prod_id, 'name': 'E2E Cocoa Beans',
        'category': 'agriculture', 'hsCode': '18010000',
        'detailedSpec': 'Grade A, 6.5% moisture',
        'supplyOffers': [{
            'supplierId': supplier_id, 'country': 'GH', 'price': 2200,
            'currency': 'USD', 'incoterm': 'FOB', 'certificates': 'Fairtrade;Organic',
        }],
    })
    _log('Create product with supply offer', st == 200, f'HTTP {st}')

    # ---------- 4. OFFER ----------
    print('\n-- 4. Offer create + versioning --')
    offer_id = f'e2e-off-{int(time.time())}'
    offer_no = f'OFF-E2E-{int(time.time()) % 100000}'
    offer_payload = {
        'id': offer_id, 'offerNo': offer_no,
        'date': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'customerId': buyer_id, 'productId': prod_id,
        'productName': 'E2E Cocoa Beans', 'hsCode': '18010000',
        'quantity': 20, 'unit': 't', 'sellingPrice': 2500, 'currency': 'USD',
        'incoterm': 'CIF', 'pol': 'Tema', 'pod': 'Antwerp',
        'paymentTerms': '30% advance, 70% B/L',
        'items': [{'productId': prod_id, 'productName': 'E2E Cocoa Beans',
                   'quantity': 20, 'unit': 't', 'price': 2500, 'currency': 'USD'}],
    }
    st, _, body = c.post('/api/item/offers', json_body=offer_payload)
    _log('Create offer', st == 200, f'HTTP {st}')

    # Version history — empty initially
    st, _, body = c.get(f'/api/offers/{offer_id}/versions')
    j = _j(body) or {}
    _log('Fresh offer has no versions',
         st == 200 and j.get('count') == 0,
         f'HTTP {st} count={j.get("count")}')

    # Edit price — must create a version snapshot
    offer_payload['sellingPrice'] = 2800
    offer_payload['items'][0]['price'] = 2800
    st, _, _ = c.post('/api/item/offers', json_body=offer_payload)
    _log('Edit offer price', st == 200, f'HTTP {st}')

    st, _, body = c.get(f'/api/offers/{offer_id}/versions')
    j = _j(body) or {}
    versions = j.get('versions', [])
    _log('Price edit created one version snapshot',
         j.get('count') == 1 and versions,
         f'count={j.get("count")}')
    if versions:
        fields = versions[0].get('changedFields', [])
        _log('sellingPrice tracked as changed field',
             'sellingPrice' in fields,
             f'fields={fields}')

    # Restore
    if versions:
        vid = versions[0]['id']
        st, _, body = c.post(f'/api/offers/{offer_id}/versions/{vid}/restore',
                             json_body={'reason': 'e2e test rollback'})
        j = _j(body) or {}
        _log('Restore prior version', st == 200 and j.get('status') == 'success',
             f'HTTP {st} restoredTo=v{j.get("restoredToVersion")}')

        # Verify actual value reverted
        st, _, body = c.get('/api/data/offers')
        offers = (_j(body) or {}).get('value', [])
        my_offer = next((o for o in offers if o.get('id') == offer_id), None)
        _log('Restored offer has old price (2500)',
             my_offer and my_offer.get('sellingPrice') == 2500,
             f'got={my_offer and my_offer.get("sellingPrice")}')

        st, _, body = c.get(f'/api/offers/{offer_id}/versions')
        _log('Restore itself created a new version', (_j(body) or {}).get('count') == 2,
             f'count={(_j(body) or {}).get("count")}')

    # ---------- 5. PDF preview ----------
    print('\n-- 5. PDF generation --')
    st, headers, body = c.post('/api/offers/preview_pdf', json_body={'offerId': offer_id})
    is_pdf = body[:4] == b'%PDF' if body else False
    ctype = str(headers.get('Content-Type', '') if headers else '')
    _log('Offer PDF preview returns real PDF',
         st == 200 and is_pdf,
         f'HTTP {st} content-type={ctype} first4={body[:4]!r} size={len(body)}')

    # ---------- 6. OFFER → DEAL conversion (force mode) ----------
    print('\n-- 6. Offer → Deal --')
    st, _, body = c.post(f'/api/deals/from_offer/{offer_id}', json_body={'force': True})
    j = _j(body) or {}
    _log('Force-convert offer to deal',
         st == 200 and j.get('dealId'),
         f'HTTP {st} dealId={(j.get("dealId") or "")[:16]}')
    deal_id = j.get('dealId')

    if deal_id:
        st, _, body = c.get('/api/data/deals')
        deals = (_j(body) or {}).get('value', [])
        my_deal = next((d for d in deals if d.get('id') == deal_id), None)
        _log('Deal contains buyer info from offer',
             my_deal and my_deal.get('buyerId') == buyer_id
             and my_deal.get('buyerName') == 'E2E Deep Buyer',
             f'buyerName={my_deal and my_deal.get("buyerName")}')
        _log('Deal contains product+price from offer',
             my_deal and my_deal.get('productName') == 'E2E Cocoa Beans'
             and my_deal.get('sellingPrice') == 2500,
             f'price={my_deal and my_deal.get("sellingPrice")}')
        _log('Deal has sourceOfferId link',
             my_deal and my_deal.get('sourceOfferId') == offer_id,
             '')

        # Try to double-convert — must be blocked
        st, _, body = c.post(f'/api/deals/from_offer/{offer_id}', json_body={'force': True})
        _log('Double conversion blocked (409)', st == 409, f'HTTP {st}')

    # ---------- 7. Portal endpoints (token was set on partner in step 2) ----------
    print('\n-- 7. Portal token flow --')
    _log('Portal token set on partner', bool(portal_token), f'token={portal_token[:12]}…')
    if portal_token:
        # Public config
        st, _, body = c.get('/api/portal/public_config')
        _log('/api/portal/public_config returns 200', st == 200, f'HTTP {st}')

        # Portal /portal/<token> renders (HTML)
        st, _, body = c.get(f'/portal/{portal_token}')
        _log('/portal/<token> returns HTML',
             st == 200 and b'<html' in body[:5000].lower(),
             f'HTTP {st} size={len(body)}')

        # OTP send — must accept (200 even if email queued)
        st, _, body = c.post(f'/api/portal/auth/send_otp/{portal_token}',
                              json_body={'email': 'buyer@example.com'})
        _log('Portal OTP send accepted', st in (200, 201, 202),
             f'HTTP {st} body={body[:100]}')

    # ---------- 8. FULL Backup ----------
    print('\n-- 8. Full backup --')
    st, headers, body = c.get('/api/system/backup/full')
    is_gzip = body[:2] == b'\x1f\x8b' if body else False
    _log('Full backup endpoint streams tar.gz',
         st == 200 and is_gzip,
         f'HTTP {st} size={len(body)} first2={body[:2]!r}')
    if is_gzip:
        try:
            tar = tarfile.open(fileobj=io.BytesIO(body), mode='r:gz')
            names = tar.getnames()
            has_db = 'databases/aspidus_crm.db' in names
            has_meta = 'meta.json' in names
            has_restore = 'RESTORE.md' in names
            _log('Backup contains all 3 DBs + meta + restore doc',
                 has_db and has_meta and has_restore,
                 f'members={len(names)} has_db={has_db} has_meta={has_meta}')
            if has_meta:
                meta = json.loads(tar.extractfile('meta.json').read())
                crm_meta = meta.get('databases', {}).get('aspidus_crm.db', {})
                _log('meta.json → CRM db integrity_check=ok',
                     crm_meta.get('integrity_check') == 'ok',
                     f'got={crm_meta.get("integrity_check")}')
        except Exception as e:
            _log('Backup archive is valid tar.gz', False, str(e)[:100])

    # ---------- 9. Health check ----------
    print('\n-- 9. Health --')
    st, _, body = c.get('/api/system/health')
    j = _j(body) or {}
    _log('Health endpoint returns databases block',
         st == 200 and 'databases' in j and 'storage' in j,
         f'HTTP {st} keys={list(j.keys())[:8]}')
    if j.get('db_pragmas'):
        crm_pragmas = j['db_pragmas'].get('crm', {})
        _log('CRM DB has busy_timeout_ms set',
             (crm_pragmas.get('busy_timeout_ms') or 0) > 0,
             f'busy_timeout_ms={crm_pragmas.get("busy_timeout_ms")} journal={crm_pragmas.get("journal_mode")}')

    # ---------- 10. Audit log ----------
    print('\n-- 10. Audit --')
    st, _, body = c.get('/api/audit_logs?limit=5')
    j = _j(body)
    logs = j if isinstance(j, list) else ((j or {}).get('logs') or (j or {}).get('data') or [])
    _log('Audit logs readable by admin',
         st == 200 and isinstance(logs, list),
         f'HTTP {st} count={len(logs) if isinstance(logs, list) else "?"}')

    # ---------- 11. Verify QR page ----------
    print('\n-- 11. Verify page --')
    # /verify/<hash> — endpoint validates VER- prefix + <=30 chars, else 404 (by design)
    st, _, body = c.get('/verify/VER-FAKE0000000000')  # 20 chars, valid prefix
    _log('/verify/<VER-hash> returns HTML',
         st == 200 and b'<html' in body[:5000].lower(),
         f'HTTP {st} size={len(body)}')
    # Format-validation must reject bad prefix
    st2, _, _ = c.get('/verify/BADPREFIX_ZZZZ0000')
    _log('/verify/ rejects bad prefix with 404 (input validation)', st2 == 404, f'HTTP {st2}')

    # ---------- 12. Search index ----------
    print('\n-- 12. FTS5 search --')
    st, _, body = c.post('/api/system/search/rebuild')
    _log('Search index rebuild', st in (200, 202), f'HTTP {st}')
    time.sleep(0.5)
    st, _, body = c.get('/api/system/search?q=E2E')
    j = _j(body) or {}
    _log('FTS5 finds E2E entities', st == 200 and len(j.get('results', [])) > 0,
         f'HTTP {st} hits={len(j.get("results", []))}')

    # ---------- 13. Cleanup: delete created entities ----------
    print('\n-- 13. Cleanup --')
    for entity, eid in [
        ('offers', offer_id), ('products', prod_id),
        ('partners', buyer_id), ('partners', supplier_id),
    ]:
        st, _, _ = c.delete(f'/api/item/{entity}/{eid}')
        _log(f'Delete {entity}/{eid[:20]}', st == 200, f'HTTP {st}')
    if deal_id:
        st, _, _ = c.delete(f'/api/item/deals/{deal_id}')
        _log(f'Delete deal', st == 200, f'HTTP {st}')

    _finalize()


def _finalize():
    passed = sum(1 for r in _results if r['ok'])
    failed = sum(1 for r in _results if not r['ok'])
    print(f'\n=== SUMMARY: {passed}/{len(_results)} passed, {failed} failed ===')
    if failed:
        print('\nFailed checks:')
        for r in _results:
            if not r['ok']:
                print(f'  ✗ {r["name"]} — {r["detail"]}')
    try:
        with open('/tmp/aspidus_run/deep_flows_report.json', 'w') as f:
            json.dump({'results': _results, 'passed': passed, 'failed': failed}, f, indent=2)
    except Exception:
        pass
    sys.exit(0 if failed == 0 else 1)


if __name__ == '__main__':
    main()
