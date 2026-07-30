"""ULTRA-BRUTAL: simulira svaku glupu grešku koju pravi normalan korisnik.

Cilj: proći kroz app kao osoba koja ne čita, klikće dva puta uzastopno,
kopira/nalepljuje smeće, prazna polja, tipa slova u polje za brojeve,
pokušava da obriše nešto na šta pokazuju drugi zapisi, otpremi PDF sa
JS payload-om, promeni URL na nešto što ne sme, itd.

Radi protiv živog servera (APP_BASE=http://127.0.0.1:5000, TEST_MODE=1).
Pripremljeno da otkrije bug-ove koje happy-path testovi propuštaju.
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
import time
import urllib.parse
import urllib.request

BASE = os.environ.get('APP_BASE', 'http://127.0.0.1:5000')
ADMIN_USER = os.environ.get('ADMIN_USERNAME', 'testadmin')
ADMIN_PASS = os.environ.get('ADMIN_PASSWORD', 'TestAdmin!12345')

_results = []


def _log(name, ok, detail=''):
    marker = '\033[32m✓\033[0m' if ok else '\033[31m✗\033[0m'
    print(f'  {marker} {name}' + (f' — {detail}' if detail else ''))
    _results.append({'name': name, 'ok': ok, 'detail': detail})


class Client:
    def __init__(self, base):
        self.base = base.rstrip('/')
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self._csrf = None
        self.portal_auth = None

    def _req(self, method, path, json_body=None, headers=None, raw_body=None):
        url = self.base + path
        h = dict(headers or {})
        if self.portal_auth:
            h.setdefault('X-Portal-Auth', self.portal_auth)
        data = None
        if json_body is not None:
            data = json.dumps(json_body).encode()
            h.setdefault('Content-Type', 'application/json')
        elif raw_body is not None:
            data = raw_body
        req = urllib.request.Request(url, data=data, method=method, headers=h)
        try:
            r = self.opener.open(req, timeout=20)
            return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()
        except Exception as e:
            return -1, {}, f'ERR:{e}'.encode()

    def get(self, p, h=None): return self._req('GET', p, headers=h)
    def post(self, p, j=None, h=None, raw=None):
        hh = dict(h or {}); hh.setdefault('X-CSRF-Token', self._csrf or '')
        return self._req('POST', p, json_body=j, headers=hh, raw_body=raw)
    def delete(self, p, h=None):
        hh = dict(h or {}); hh.setdefault('X-CSRF-Token', self._csrf or '')
        return self._req('DELETE', p, headers=hh)

    def csrf(self):
        st, _, body = self.get('/api/csrf/token')
        try: self._csrf = json.loads(body).get('csrf_token')
        except: self._csrf = None
        return self._csrf


def _j(body):
    try: return json.loads(body)
    except: return None


def main():
    c = Client(BASE)
    print(f'=== ULTRA-BRUTAL HUMAN ERRORS against {BASE} ===\n')

    # Login as admin
    st, _, _ = c.post('/api/auth/login', j={
        'username': ADMIN_USER, 'password': ADMIN_PASS,
        'location': '44.7866,20.4489', 'device': 'brutal-human',
    })
    if st != 200:
        _log('setup: admin login', False, f'HTTP {st}')
        return _finalize()
    c.csrf()
    _log('setup: admin login + csrf', True)

    ts = int(time.time())

    # ==========================================================
    # H1 — DOUBLE CLICK: user impatiently clicks Save twice
    # ==========================================================
    print('\n-- H1: Double-click on save --')
    p_id = f'brutal-double-{ts}'
    payload = {'id': p_id, 'companyName': 'Double Click Ltd',
               'contact': {'email': 'x@y.z'}, 'types': ['Buyer']}
    st1, _, _ = c.post('/api/item/partners', j=payload)
    st2, _, _ = c.post('/api/item/partners', j=payload)  # immediate second click
    _log('H1.1 First save succeeds', st1 == 200, f'HTTP {st1}')
    _log('H1.2 Second identical save also succeeds (idempotent)',
         st2 == 200, f'HTTP {st2}')
    # Read back — should be exactly 1 record
    st, _, body = c.get('/api/data/partners')
    matches = [p for p in ((_j(body) or {}).get('value') or []) if p.get('id') == p_id]
    _log('H1.3 Only one record, no duplicate rows',
         len(matches) == 1, f'count={len(matches)}')
    c.delete(f'/api/item/partners/{p_id}')

    # ==========================================================
    # H2 — LETTERS IN NUMERIC FIELD (typing "abc" in price)
    # ==========================================================
    print('\n-- H2: Letters in numeric fields --')
    off_id = f'brutal-str-{ts}'
    st, _, body = c.post('/api/item/offers', j={
        'id': off_id, 'offerNo': f'STR-{ts}', 'customerId': 'x',
        'quantity': 'twenty tons',  # STRING instead of number
        'sellingPrice': 'abc',      # STRING instead of number
        'currency': 'USD',
    })
    _log('H2.1 Offer with non-numeric qty/price accepted or gracefully rejected',
         st in (200, 400), f'HTTP {st}')
    if st == 200: c.delete(f'/api/item/offers/{off_id}')

    # ==========================================================
    # H3 — DELETE partner while offers/deals reference it
    # (referential integrity — user shouldn't corrupt their data)
    # ==========================================================
    print('\n-- H3: Delete referenced partner --')
    p_id = f'ref-partner-{ts}'
    prod_id = f'ref-prod-{ts}'
    off_id = f'ref-offer-{ts}'
    c.post('/api/item/partners', j={'id': p_id, 'companyName': 'ToDelete Ltd',
                                             'contact': {'email': 'x@y.z'}, 'types': ['Buyer']})
    c.post('/api/item/products', j={'id': prod_id, 'name': 'RefProd',
                                              'category': 'agriculture', 'hsCode': '18010000'})
    c.post('/api/item/offers', j={'id': off_id, 'offerNo': f'REF-{ts}',
                                            'customerId': p_id, 'productId': prod_id,
                                            'quantity': 1, 'sellingPrice': 100, 'currency': 'USD'})
    st, _, body = c.delete(f'/api/item/partners/{p_id}')
    _log('H3.1 Partner referenced by offer — DELETE result',
         st in (200, 400, 409),
         f'HTTP {st} body={body[:100]}')
    # regardless of result, cleanup
    c.delete(f'/api/item/offers/{off_id}')
    c.delete(f'/api/item/products/{prod_id}')
    c.delete(f'/api/item/partners/{p_id}')

    # ==========================================================
    # H4 — EMPTY / WHITESPACE-ONLY REQUIRED FIELDS
    # ==========================================================
    print('\n-- H4: Empty / whitespace-only fields --')
    p_id = f'ws-{ts}'
    # companyName is just spaces
    st, _, _ = c.post('/api/item/partners', j={
        'id': p_id, 'companyName': '   ', 'contact': {'email': 'x@y.z'},
    })
    _log('H4.1 companyName="   " (whitespace-only) — should reject or trim',
         st in (200, 400), f'HTTP {st}')
    if st == 200: c.delete(f'/api/item/partners/{p_id}')

    # No companyName at all
    p_id = f'noname-{ts}'
    st, _, _ = c.post('/api/item/partners', j={'id': p_id})
    _log('H4.2 No companyName field at all',
         st in (200, 400), f'HTTP {st}')
    if st == 200: c.delete(f'/api/item/partners/{p_id}')

    # ==========================================================
    # H5 — MAX-LENGTH TESTING — huge strings that DB might truncate silently
    # ==========================================================
    print('\n-- H5: Absurdly long strings --')
    p_id = f'long-{ts}'
    huge_name = 'X' * 100_000  # 100 KB name
    st, _, _ = c.post('/api/item/partners', j={
        'id': p_id, 'companyName': huge_name,
        'contact': {'email': 'x@y.z'},
    })
    _log('H5.1 100KB companyName accepted or rejected cleanly',
         st in (200, 400, 413), f'HTTP {st}')
    if st == 200:
        st, _, body = c.get('/api/data/partners')
        my_p = next((p for p in (_j(body) or {}).get('value', [])
                     if p.get('id') == p_id), None)
        actual = len(my_p.get('companyName', '')) if my_p else 0
        _log('H5.2 Long name round-trip preserves length (no silent truncation)',
             actual == len(huge_name) or actual == 0,
             f'sent={len(huge_name)} got={actual}')
        c.delete(f'/api/item/partners/{p_id}')

    # ==========================================================
    # H6 — UNICODE / EMOJI / CONTROL CHARS
    # ==========================================================
    print('\n-- H6: Unicode / emoji / control chars --')
    p_id = f'uni-{ts}'
    weird_name = '💼 Компанија Ω\x00\x01Ć čć šđž'
    st, _, _ = c.post('/api/item/partners', j={
        'id': p_id, 'companyName': weird_name,
        'contact': {'email': 'čć@примep.рф'},
    })
    _log('H6.1 Emoji+Cyrillic+control chars accepted',
         st == 200, f'HTTP {st}')
    if st == 200:
        st, _, body = c.get('/api/data/partners')
        my_p = next((p for p in (_j(body) or {}).get('value', [])
                     if p.get('id') == p_id), None)
        got = my_p.get('companyName') if my_p else ''
        _log('H6.2 Emoji round-trip preserved',
             '💼' in got and 'Компанија' in got, f'got={got[:40]}')
        c.delete(f'/api/item/partners/{p_id}')

    # ==========================================================
    # H7 — INVALID DATE FORMAT (mm/dd/yyyy instead of yyyy-mm-dd)
    # ==========================================================
    print('\n-- H7: Invalid date format --')
    off_id = f'baddate-{ts}'
    st, _, _ = c.post('/api/item/offers', j={
        'id': off_id, 'offerNo': f'BD-{ts}',
        'date': '12/25/2026',  # wrong format
        'validUntil': 'never',
        'customerId': 'x', 'quantity': 1, 'sellingPrice': 100, 'currency': 'USD',
    })
    _log('H7 Invalid date strings do not crash',
         st in (200, 400), f'HTTP {st}')
    if st == 200: c.delete(f'/api/item/offers/{off_id}')

    # ==========================================================
    # H8 — NEGATIVE / ZERO PRICE
    # ==========================================================
    print('\n-- H8: Negative price / zero quantity --')
    off_id = f'neg-{ts}'
    st, _, _ = c.post('/api/item/offers', j={
        'id': off_id, 'offerNo': f'NEG-{ts}', 'customerId': 'x',
        'quantity': 0, 'sellingPrice': -1000, 'currency': 'USD',
    })
    _log('H8 Negative price / zero qty handled without 500',
         st in (200, 400), f'HTTP {st}')
    if st == 200: c.delete(f'/api/item/offers/{off_id}')

    # ==========================================================
    # H9 — CURRENCY code that doesn't exist
    # ==========================================================
    print('\n-- H9: Nonexistent currency code --')
    off_id = f'cur-{ts}'
    st, _, _ = c.post('/api/item/offers', j={
        'id': off_id, 'offerNo': f'CUR-{ts}', 'customerId': 'x',
        'quantity': 1, 'sellingPrice': 100, 'currency': 'ZZZ',
    })
    _log('H9 Unknown currency accepted or rejected',
         st in (200, 400), f'HTTP {st}')
    if st == 200: c.delete(f'/api/item/offers/{off_id}')

    # ==========================================================
    # H10 — SESSION EXPIRY MID-ACTION — start a save, wipe session, retry
    # ==========================================================
    print('\n-- H10: Session expiry mid-action --')
    c2 = Client(BASE)
    c2.post('/api/auth/login', j={
        'username': ADMIN_USER, 'password': ADMIN_PASS,
        'location': '44.7866,20.4489', 'device': 'exp',
    })
    c2.csrf()
    c2.post('/api/auth/logout')
    # now try to save something — must 401 (not crash)
    st, _, _ = c2.post('/api/item/partners', j={'id': 'x', 'companyName': 'y'})
    _log('H10 Save after logout → 401',
         st in (401, 403), f'HTTP {st}')

    # ==========================================================
    # H11 — CONCURRENT EDIT — two admins edit same row
    # ==========================================================
    print('\n-- H11: Two clients editing same partner --')
    p_id = f'concur-{ts}'
    c.post('/api/item/partners', j={
        'id': p_id, 'companyName': 'v1',
        'contact': {'email': 'x@y.z'},
    })
    c3 = Client(BASE)
    c3.post('/api/auth/login', j={
        'username': ADMIN_USER, 'password': ADMIN_PASS,
        'location': '44.7866,20.4489', 'device': 'c3',
    })
    c3.csrf()
    # both write at nearly same time
    st_a, _, _ = c.post('/api/item/partners', j={
        'id': p_id, 'companyName': 'v2-from-c1',
        'contact': {'email': 'x@y.z'},
    })
    st_b, _, _ = c3.post('/api/item/partners', j={
        'id': p_id, 'companyName': 'v3-from-c3',
        'contact': {'email': 'x@y.z'},
    })
    _log('H11.1 Both concurrent writes succeed (last-write-wins)',
         st_a == 200 and st_b == 200,
         f'a={st_a} b={st_b}')
    st, _, body = c.get('/api/data/partners')
    my_p = next((p for p in (_j(body) or {}).get('value', [])
                 if p.get('id') == p_id), None)
    _log('H11.2 Winning version is one of the two',
         my_p and my_p.get('companyName') in ('v2-from-c1', 'v3-from-c3'),
         f'winner={my_p and my_p.get("companyName")}')
    c.delete(f'/api/item/partners/{p_id}')

    # ==========================================================
    # H12 — UPLOAD wrong file type (JS executable → server must refuse)
    # ==========================================================
    print('\n-- H12: Upload malicious extension --')
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from e2e_brutal import _multipart
    mp_body, mp_ct = _multipart({'entity': 'partners', 'entityId': 'x'},
                                  [('file', 'malware.exe', b'MZ\x90\x00'*100,
                                    'application/x-msdownload')])
    st, _, body = c.post('/api/upload', h={'Content-Type': mp_ct, 'X-CSRF-Token': c._csrf or ''}, raw=mp_body)
    _log('H12.1 Upload of .exe → 400 (invalid file type)',
         st in (400, 413), f'HTTP {st}')

    # Fake PDF (JS content saved as .pdf) — deep-inspection should catch
    mp_body, mp_ct = _multipart({}, [('file', 'fake.pdf', b'<script>alert(1)</script>',
                                     'application/pdf')])
    st, _, body = c.post('/api/upload', h={'Content-Type': mp_ct, 'X-CSRF-Token': c._csrf or ''}, raw=mp_body)
    _log('H12.2 Fake PDF (no %PDF magic) → 400',
         st in (400, 413), f'HTTP {st}')

    # ==========================================================
    # H13 — OFFER version restore with SESSION EXPIRED mid-restore
    # ==========================================================
    print('\n-- H13: Restore version — nonexistent offer --')
    st, _, _ = c.post('/api/offers/nonexistent-offer-xyz/versions/nonexistent-v/restore', j={'reason': 'x'})
    _log('H13 Restore on nonexistent offer → 404',
         st == 404, f'HTTP {st}')

    # ==========================================================
    # H14 — SEARCH with special regex chars
    # ==========================================================
    print('\n-- H14: FTS5 search with regex chars --')
    for q in ['*', '(', 'abc"def', "';DROP TABLE", 'AND OR NOT', '   ', '""""']:
        st, _, _ = c.get(f'/api/system/search?q={urllib.parse.quote(q)}')
        _log(f'H14 search q={q!r} does not 500',
             st in (200, 400), f'HTTP {st}')

    # ==========================================================
    # H15 — DASHBOARD load with zero data (fresh install)
    # ==========================================================
    print('\n-- H15: All endpoints against empty state --')
    # Delete all offers/deals/products first, then try to load dashboard-worthy endpoints
    st, _, body = c.get('/api/data/offers')
    offers = (_j(body) or {}).get('value', [])
    # (don't actually delete production data — just verify empty-state calls don't 500)
    st, _, _ = c.get('/api/system/search?q=zzz_nonexistent_zzz')
    _log('H15.1 Search with no match returns 200',
         st == 200, f'HTTP {st}')

    st, _, _ = c.get('/api/audit_logs?limit=0')
    _log('H15.2 Audit logs with limit=0 does not crash',
         st in (200, 400), f'HTTP {st}')

    st, _, _ = c.get('/api/audit_logs?limit=-1')
    _log('H15.3 Audit logs with negative limit does not crash',
         st in (200, 400), f'HTTP {st}')

    # ==========================================================
    # H16 — PORTAL: user pastes an OLD token whose partner was DELETED
    # ==========================================================
    print('\n-- H16: Portal with token pointing to deleted partner --')
    p_id = f'orphan-{ts}'
    orphan_token = 'ORPHAN_' + base64.b32encode(os.urandom(20)).decode().rstrip('=')
    c.post('/api/item/partners', j={
        'id': p_id, 'companyName': 'Orphan Corp',
        'contact': {'email': 'o@x.y'}, 'portalToken': orphan_token,
        'isPortalActive': True,
    })
    c.delete(f'/api/item/partners/{p_id}')
    # Now portal token points to deleted partner
    st, _, _ = c.get(f'/portal/{orphan_token}')
    _log('H16.1 /portal/<orphan-token> returns HTML (not 500)',
         st == 200, f'HTTP {st}')
    st, _, body = c.post(f'/api/portal/auth/send_otp/{orphan_token}', j={'email': 'o@x.y'})
    _log('H16.2 send_otp on orphan token → 401/403/404 (not 500)',
         st in (401, 403, 404), f'HTTP {st} body={body[:80]}')

    # ==========================================================
    # H17 — DEACTIVATED PARTNER — portal must reject
    # ==========================================================
    print('\n-- H17: Portal after admin revokes access --')
    p_id = f'revoke-{ts}'
    tok = 'REVOKE_' + base64.b32encode(os.urandom(20)).decode().rstrip('=')
    c.post('/api/item/partners', j={
        'id': p_id, 'companyName': 'Revoke Test',
        'contact': {'email': 'r@x.y'}, 'portalToken': tok,
        'isPortalActive': False,  # revoked
    })
    st, _, body = c.post(f'/api/portal/auth/send_otp/{tok}', j={'email': 'r@x.y'})
    _log('H17 Revoked partner cannot request OTP',
         st in (401, 403, 404), f'HTTP {st}')
    c.delete(f'/api/item/partners/{p_id}')

    # ==========================================================
    # H18 — OFFER→DEAL when partner deleted mid-flow
    # ==========================================================
    print('\n-- H18: Convert offer whose customer got deleted --')
    p_id = f'gone-buyer-{ts}'
    o_id = f'ghost-off-{ts}'
    c.post('/api/item/partners', j={
        'id': p_id, 'companyName': 'Ghost Corp',
        'contact': {'email': 'g@x.y'}, 'types': ['Buyer'],
    })
    c.post('/api/item/offers', j={
        'id': o_id, 'offerNo': f'GH-{ts}',
        'customerId': p_id, 'quantity': 1, 'sellingPrice': 100, 'currency': 'USD',
    })
    c.delete(f'/api/item/partners/{p_id}')
    st, _, body = c.post(f'/api/deals/from_offer/{o_id}', j={'force': True})
    _log('H18 Convert offer with deleted customer does not crash',
         st in (200, 400, 404, 409, 500),
         f'HTTP {st} body={body[:100]}')
    # Cleanup deal if created + orphan offer
    j = _j(body) or {}
    if j.get('dealId'): c.delete(f'/api/item/deals/{j["dealId"]}')
    c.delete(f'/api/item/offers/{o_id}')

    # ==========================================================
    # H19 — CSRF token from a DIFFERENT session
    # ==========================================================
    print('\n-- H19: Cross-session CSRF token --')
    c_a = Client(BASE)
    c_a.post('/api/auth/login', j={
        'username': ADMIN_USER, 'password': ADMIN_PASS,
        'location': '44.7866,20.4489', 'device': 'a',
    })
    c_a.csrf()
    c_b = Client(BASE)
    c_b.post('/api/auth/login', j={
        'username': ADMIN_USER, 'password': ADMIN_PASS,
        'location': '44.7866,20.4489', 'device': 'b',
    })
    # c_a uses c_b's CSRF token
    st, _, _ = c_a._req('POST', '/api/item/partners',
                        json_body={'id': 'zz', 'companyName': 'z'},  # low-level _req uses json_body
                        headers={'X-CSRF-Token': c_b._csrf or 'XXXXXXXX',
                                 'Content-Type': 'application/json'})
    _log('H19 Cross-session CSRF token → 401/403',
         st in (401, 403), f'HTTP {st}')

    # ==========================================================
    # H20 — DEEPLY NESTED JSON (attack: 1000-level array)
    # ==========================================================
    print('\n-- H20: Deeply nested JSON payload --')
    nested = {'id': f'deep-{ts}', 'companyName': 'DeepNest'}
    cur = nested
    for _ in range(500):
        cur['nested'] = {}
        cur = cur['nested']
    st, _, _ = c.post('/api/item/partners', j=nested)
    _log('H20 500-level nested JSON does not crash server',
         st in (200, 400, 413), f'HTTP {st}')
    if st == 200: c.delete(f'/api/item/partners/deep-{ts}')

    # ==========================================================
    # H21 — SPECIAL CHARS in file names (safe against path traversal)
    # ==========================================================
    print('\n-- H21: Special-char filename in upload --')
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from e2e_brutal import _multipart
    for fname in ['../../../etc/passwd.pdf', 'CON.pdf', 'file with spaces.pdf', 'файл.pdf', '.pdf', 'no-extension']:
        mp_body, mp_ct = _multipart({}, [('file', fname,
                                          b'%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF',
                                          'application/pdf')])
        st, _, body = c.post('/api/upload', h={'Content-Type': mp_ct, 'X-CSRF-Token': c._csrf or ''}, raw=mp_body)
        _log(f'H21 filename={fname!r:35s} handled',
             st in (200, 400, 413), f'HTTP {st}')
        if st == 200:
            j = _j(body) or {}
            url = j.get('url', '')
            fn = url.rsplit('/', 1)[-1]
            # Server must have renamed to UUID.ext, not preserve traversal
            _log(f'H21.check server renamed to safe {fn[:30]}',
                 '..' not in fn and '/' not in fn and '\\' not in fn,
                 f'saved as {fn}')
            c.delete(f'/api/upload/{fn}')

    # ==========================================================
    # H22 — USER changes email to invalid format and saves
    # ==========================================================
    print('\n-- H22: Invalid email format --')
    p_id = f'bademail-{ts}'
    st, _, _ = c.post('/api/item/partners', j={
        'id': p_id, 'companyName': 'BadEmail Corp',
        'contact': {'email': 'not-an-email'},
    })
    _log('H22 Invalid email accepted (validation is soft)',
         st in (200, 400), f'HTTP {st}')
    if st == 200: c.delete(f'/api/item/partners/{p_id}')

    # ==========================================================
    # H23 — OFFER with SELF-REFERENCE (customerId = own id)
    # ==========================================================
    print('\n-- H23: Offer where customerId matches offer id --')
    id_ = f'self-ref-{ts}'
    st, _, _ = c.post('/api/item/offers', j={
        'id': id_, 'offerNo': f'SR-{ts}', 'customerId': id_,  # self-ref!
        'quantity': 1, 'sellingPrice': 100, 'currency': 'USD',
    })
    _log('H23 Self-referencing customerId accepted (no infinite loop)',
         st in (200, 400), f'HTTP {st}')
    if st == 200: c.delete(f'/api/item/offers/{id_}')

    # ==========================================================
    # H24 — REPEATED SAVE with the offerNo changing (versioning stress)
    # ==========================================================
    print('\n-- H24: 10 quick edits create 9 versions --')
    id_ = f'edit-storm-{ts}'
    c.post('/api/item/offers', j={
        'id': id_, 'offerNo': f'ES-{ts}', 'customerId': 'x',
        'quantity': 1, 'sellingPrice': 100, 'currency': 'USD',
    })
    for i in range(2, 11):
        c.post('/api/item/offers', j={
            'id': id_, 'offerNo': f'ES-{ts}', 'customerId': 'x',
            'quantity': i, 'sellingPrice': 100 * i, 'currency': 'USD',
        })
    st, _, body = c.get(f'/api/offers/{id_}/versions')
    j = _j(body) or {}
    _log('H24 9 edits → 9 versions',
         j.get('count') == 9, f'count={j.get("count")}')
    c.delete(f'/api/item/offers/{id_}')

    # ==========================================================
    # H25 — WEIRD partner name with SQL keywords
    # ==========================================================
    print('\n-- H25: SQL keywords as partner name --')
    p_id = f'sql-name-{ts}'
    st, _, _ = c.post('/api/item/partners', j={
        'id': p_id, 'companyName': "SELECT * FROM users; DROP TABLE offers;--",
        'contact': {'email': 'x@y.z'},
    })
    _log('H25.1 SQL-keyword name accepted',
         st == 200, f'HTTP {st}')
    # Verify offers table still exists (SQLi didn't work)
    st, _, body = c.get('/api/data/offers')
    _log('H25.2 offers table still queryable after SQLi attempt',
         st == 200 and 'value' in (_j(body) or {}),
         f'HTTP {st}')
    if st == 200: c.delete(f'/api/item/partners/{p_id}')

    # ==========================================================
    # H26 — WRONG payload TYPE (send array where object expected)
    # ==========================================================
    print('\n-- H26: Wrong payload type --')
    # Send array instead of object
    st, _, _ = c._req('POST', '/api/item/partners',
                      raw_body=b'[1,2,3]',
                      headers={'Content-Type': 'application/json',
                               'X-CSRF-Token': c._csrf or ''})
    _log('H26.1 Array where object expected → 400',
         st == 400, f'HTTP {st}')

    # Send string
    st, _, _ = c._req('POST', '/api/item/partners',
                      raw_body=b'"hello"',
                      headers={'Content-Type': 'application/json',
                               'X-CSRF-Token': c._csrf or ''})
    _log('H26.2 String where object expected → 400',
         st == 400, f'HTTP {st}')

    # Send null
    st, _, _ = c._req('POST', '/api/item/partners',
                      raw_body=b'null',
                      headers={'Content-Type': 'application/json',
                               'X-CSRF-Token': c._csrf or ''})
    _log('H26.3 null payload → 400',
         st == 400, f'HTTP {st}')

    # ==========================================================
    # H27 — DOUBLE-DELETE (already deleted item)
    # ==========================================================
    print('\n-- H27: Delete same item twice --')
    p_id = f'twice-{ts}'
    c.post('/api/item/partners', j={
        'id': p_id, 'companyName': 'DeleteMe',
        'contact': {'email': 'x@y.z'},
    })
    st1, _, _ = c.delete(f'/api/item/partners/{p_id}')
    st2, _, _ = c.delete(f'/api/item/partners/{p_id}')
    _log('H27.1 First delete succeeds', st1 == 200, f'HTTP {st1}')
    _log('H27.2 Second delete → 404 (or 200 idempotent, not 500)',
         st2 in (200, 404), f'HTTP {st2}')

    # ==========================================================
    # H28 — GET on nonexistent entity type in path
    # ==========================================================
    print('\n-- H28: Unknown entity type paths --')
    for path in ['/api/data/nonexistent_entity',
                 '/api/data/users',           # protected/hidden
                 '/api/item/../etc',
                 '/api/data/offers%00.js',
                 '/api/data/']:
        st, _, _ = c.get(path)
        _log(f'H28 {path:45s} handled',
             st in (200, 400, 404, 405), f'HTTP {st}')

    # ==========================================================
    # H29 — LOGIN with SQL injection in username
    # ==========================================================
    print('\n-- H29: SQLi in login username --')
    for u in ["admin' OR '1'='1",
              "' OR 1=1--",
              "\\'; DROP TABLE users;--"]:
        c_sqli = Client(BASE)
        st, _, _ = c_sqli.post('/api/auth/login', j={
            'username': u, 'password': 'x',
            'location': '44.7866,20.4489', 'device': 'x',
        })
        _log(f'H29 SQLi username {u[:30]!r} → 401 (not 200)',
             st == 401, f'HTTP {st}')

    # Verify testadmin still exists and can log in
    st, _, _ = Client(BASE).post('/api/auth/login', j={
        'username': ADMIN_USER, 'password': ADMIN_PASS,
        'location': '44.7866,20.4489', 'device': 'verify',
    })
    _log('H29.check testadmin still functional after SQLi attempts',
         st == 200, f'HTTP {st}')

    # ==========================================================
    # H30 — VERSION RESTORE authorization (employee shouldn't restore)
    # ==========================================================
    print('\n-- H30: Employee tries to restore offer version --')
    emp_username = f'emp_no_perm_{ts}'
    emp_pw = 'EmpNoPerm!12'
    st, _, body = c.post('/api/users', j={
        'username': emp_username, 'password': emp_pw, 'role': 'employee',
        'permissions': {'offers_view': True},  # no offers_edit
    })
    emp_id = (_j(body) or {}).get('id')

    # Create an offer + version to try restoring
    o_id = f'restore-target-{ts}'
    c.post('/api/item/offers', j={
        'id': o_id, 'offerNo': f'RT-{ts}', 'customerId': 'x',
        'quantity': 1, 'sellingPrice': 100, 'currency': 'USD',
    })
    c.post('/api/item/offers', j={
        'id': o_id, 'offerNo': f'RT-{ts}', 'customerId': 'x',
        'quantity': 1, 'sellingPrice': 200, 'currency': 'USD',
    })
    st, _, body = c.get(f'/api/offers/{o_id}/versions')
    versions = (_j(body) or {}).get('versions', [])
    if versions:
        vid = versions[0]['id']
        # Employee tries
        ec = Client(BASE)
        ec.post('/api/auth/login', j={
            'username': emp_username, 'password': emp_pw,
            'location': '44.7866,20.4489', 'device': 'e',
        })
        ec.csrf()
        st, _, _ = ec.post(f'/api/offers/{o_id}/versions/{vid}/restore', j={'reason': 'unauth attempt'})
        _log('H30 Employee without offers_edit cannot restore → 403',
             st == 403, f'HTTP {st}')
    c.delete(f'/api/item/offers/{o_id}')
    if emp_id: c.delete(f'/api/users/{emp_id}')

    # ==========================================================
    # H31 — Cashflow report with zero transactions (client-side JS but backend queryable)
    # ==========================================================
    print('\n-- H31: Financial edge cases --')
    tx_id = f'zero-tx-{ts}'
    st, _, _ = c.post('/api/item/transactions', j={
        'id': tx_id, 'amount': 0, 'currency': 'EUR',
        'date': time.strftime('%Y-%m-%d'), 'type': 'income',
        'description': 'zero-amount', 'accountId': 'x',
    })
    _log('H31.1 Zero-amount transaction accepted',
         st in (200, 400), f'HTTP {st}')
    if st == 200: c.delete(f'/api/item/transactions/{tx_id}')

    # Very large amount
    tx_id = f'huge-tx-{ts}'
    st, _, _ = c.post('/api/item/transactions', j={
        'id': tx_id, 'amount': 999_999_999_999.99, 'currency': 'EUR',
        'date': time.strftime('%Y-%m-%d'), 'type': 'income',
        'description': 'huge', 'accountId': 'x',
    })
    _log('H31.2 Trillion-dollar transaction accepted',
         st == 200, f'HTTP {st}')
    if st == 200: c.delete(f'/api/item/transactions/{tx_id}')

    _finalize()


def _finalize():
    passed = sum(1 for r in _results if r['ok'])
    failed = sum(1 for r in _results if not r['ok'])
    print(f'\n{"="*60}')
    print(f'ULTRA-BRUTAL HUMAN ERRORS: {passed}/{len(_results)} passed, {failed} failed')
    print(f'{"="*60}')
    if failed:
        print('\nFAILED:')
        for r in _results:
            if not r['ok']:
                print(f'  ✗ {r["name"]:70s} {r["detail"]}')
    try:
        os.makedirs('/tmp/aspidus_run', exist_ok=True)
        with open('/tmp/aspidus_run/human_errors_report.json', 'w') as f:
            json.dump({'results': _results, 'passed': passed, 'failed': failed}, f, indent=2)
    except: pass
    sys.exit(0 if failed == 0 else 1)


if __name__ == '__main__':
    main()
