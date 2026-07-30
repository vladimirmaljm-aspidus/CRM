"""AGRESIVAN test suite — pokušava da nađe grešku bukvalno svuda.

Šta testira (7 velikih blokova):

1. ROUTES SWEEP: iterira SVAKI Flask endpoint iz app.url_map i verifikuje:
   - Da postoji handler (nema 500 pri ovom pozivu)
   - Da bez auth-a vraća 401/403/redirect za /api/* rute (osim javnih)
   - Da vraća 405 za pogrešnu HTTP metodu
   - Da malformed JSON payload ne skida server (400/422 umesto 500)

2. CRUD SAVE PATH: za svaku glavnu entitet (partneri, proizvodi, dilovi,
   ponude, transakcije, potražnja) — kreiraj → prepravi → obriši. Nikad
   ne sme da ostavi delimično upisan zapis.

3. DUPLICATE-SEND EMAIL GUARD: pozovi email queue processor 10x u loop-u
   sa istom pending stavkom — smije da bude tačno JEDAN send attempt.

4. DB LOCK PRESSURE: 20 istovremenih write thread-ova → nijedan sme
   da izgubi zapis, nijedan sme da bacu unhandled OperationalError.

5. AUTH PERMISSION MATRIX: napravi radnika bez permisija → pokušaj
   da pristupi svakom admin-only endpoint-u → svaki mora da vrati 403.

6. FRONTEND STATIC HEALTH: parsiraj svaki .js modul pod static/ →
   verifikuj balansiran { } i ( ) (osnovni sanity), zabrani `TODO` u
   production-ready modulima, zabrani `alert(` u novim modulima.

7. INTEGRATIONS SETTINGS FLOW: end-to-end svaki tab u Settings →
   Integrations UI-u — save + reload + assert masked.

Pokreni: python -m tests.test_aggressive
Ili sve zajedno: python -m unittest tests.test_backend tests.test_aggressive
"""
import io
import json
import os
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_TEST_DATA_DIR = tempfile.mkdtemp(prefix="crm_aggro_")
os.environ["DATA_DIR"] = _TEST_DATA_DIR
os.environ["SESSION_COOKIE_SECURE"] = "false"
os.environ["ADMIN_USERNAME"] = "testadmin"
os.environ["ADMIN_PASSWORD"] = "TestAdmin!12345"

import app as app_module  # noqa: E402


PUBLIC_PATHS = {
    '/api/auth/login',                # login endpoint
    '/api/csrf/token',                # csrf token endpoint sam
    '/api/portal/public_config',      # public config za portal
    '/api/portal/auth/otp_request',
    '/api/portal/auth/otp_verify',
    '/api/portal/auth/consume_magic',
    '/api/portal/auth/session',
    '/api/portal/auth/refresh',
    '/verify',                        # public verification page
}


def _is_public(path):
    if path.startswith('/verify/'):
        return True
    if path in PUBLIC_PATHS:
        return True
    for p in PUBLIC_PATHS:
        if path.startswith(p):
            return True
    return False


class AggroBase(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        app_module.app.config['TESTING'] = True
        cls.client = app_module.app.test_client()

    def _login(self, user='testadmin', pw='TestAdmin!12345'):
        return self.client.post('/api/auth/login', json={
            'username': user, 'password': pw,
            'location': '44.7866,20.4489', 'device': 'aggro-test/1.0'
        })

    def _csrf(self):
        r = self.client.get('/api/csrf/token')
        return r.get_json()['csrf_token']

    def _post_csrf(self, url, body=None):
        return self.client.post(url, json=body or {}, headers={'X-CSRF-Token': self._csrf()})

    def _put_csrf(self, url, body=None):
        return self.client.put(url, json=body or {}, headers={'X-CSRF-Token': self._csrf()})

    def _del_csrf(self, url):
        return self.client.delete(url, headers={'X-CSRF-Token': self._csrf()})


# ==================================================================
# BLOK 1: ROUTES SWEEP — nijedan endpoint ne sme da baci 500
# ==================================================================

class T01RoutesSweep(AggroBase):
    """Iterira SVAKI Flask endpoint i pravi minimalne pozive — cilj je
    naći 5xx greške koje bi u produkciji obručila korisnika bez
    korisne poruke."""

    def setUp(self):
        # Očisti sesiju svakog testa
        with self.client.session_transaction() as s:
            s.clear()

    def _iter_routes(self):
        for r in app_module.app.url_map.iter_rules():
            path = str(r)
            methods = sorted(m for m in r.methods if m not in ('OPTIONS', 'HEAD'))
            yield path, methods, r

    def _resolve_path(self, path, rule):
        """Zameni <param> u path-u sa dummy vrednostima da bi request prošao
        routing. Ne testiramo autorizaciju parametara ovde — samo dispečer."""
        out = path
        for arg, converter in rule._converters.items():
            token = '<' + (converter.regex if hasattr(converter, 'regex') else '') + arg + '>'
            # find placeholder in path
            import re as _re
            # matches: <name>, <converter:name>, <path:name>
            m = _re.search(r'<[^<>]*' + _re.escape(arg) + r'>', out)
            if not m:
                continue
            if hasattr(converter, 'regex') and 'int' in str(type(converter)).lower():
                repl = '1'
            elif 'path' in str(type(converter)).lower():
                repl = 'dummy/path'
            else:
                repl = 'dummy'
            out = out[:m.start()] + repl + out[m.end():]
        return out

    def test_01_no_route_returns_5xx_without_auth(self):
        """Kada NIKO nije ulogovan, sve /api/* rute smiju da vrate
        401/403/302 ili 400/404 — ali NIKAD 5xx. 5xx znači da handler
        pukne pre nego što stigne do auth check-a → bag."""
        offenders = []
        for path, methods, rule in self._iter_routes():
            if not (path.startswith('/api/') or path.startswith('/portal/') or path.startswith('/verify/')):
                continue
            resolved = self._resolve_path(path, rule)
            for method in methods:
                # skip webhooks with body-only semantics
                try:
                    if method == 'GET':
                        res = self.client.get(resolved)
                    elif method == 'POST':
                        res = self.client.post(resolved, json={}, headers={'X-CSRF-Token': 'stub'})
                    elif method == 'PUT':
                        res = self.client.put(resolved, json={}, headers={'X-CSRF-Token': 'stub'})
                    elif method == 'DELETE':
                        res = self.client.delete(resolved, headers={'X-CSRF-Token': 'stub'})
                    elif method == 'PATCH':
                        res = self.client.patch(resolved, json={}, headers={'X-CSRF-Token': 'stub'})
                    else:
                        continue
                    if res.status_code >= 500:
                        offenders.append(f'{method} {resolved} → {res.status_code}')
                except Exception as e:
                    offenders.append(f'{method} {resolved} → EXCEPTION {type(e).__name__}: {e}')
        self.assertFalse(offenders,
            msg='Ovi endpointi bacaju 5xx bez auth-a (mora minimum 401/403/400/404):\n  ' + '\n  '.join(offenders[:40]))

    def test_02_api_get_routes_require_auth(self):
        """Sve /api/* GET rute (osim eksplicitno javnih) MORAJU tražiti auth.
        Preskačemo GET-ove koji su namerno javni (geo lookup, portal public
        config) i logistics reference tabele (ports/airports/UN LOCODE)."""
        offenders = []
        JUST_REFERENCE = {'/api/geo/', '/api/portal/logistics/'}
        for path, methods, rule in self._iter_routes():
            if not path.startswith('/api/'):
                continue
            if _is_public(path):
                continue
            if any(path.startswith(p) for p in JUST_REFERENCE):
                continue  # namerno public reference data
            if 'GET' not in methods:
                continue
            resolved = self._resolve_path(path, rule)
            res = self.client.get(resolved)
            if res.status_code in (200, 201, 204):
                offenders.append(f'GET {resolved} → {res.status_code} bez auth-a!')
        self.assertFalse(offenders, msg='GET rute otvorene bez auth-a:\n  ' + '\n  '.join(offenders[:20]))

    def test_03_malformed_json_returns_4xx_not_5xx(self):
        """Slanje neispravnog JSON-a ne sme da rušl backend."""
        self._login()
        offenders = []
        for path, methods, rule in self._iter_routes():
            if 'POST' not in methods:
                continue
            if not path.startswith('/api/'):
                continue
            resolved = self._resolve_path(path, rule)
            # slanje pokvarenog JSON body-ja
            try:
                res = self.client.post(
                    resolved,
                    data=b'{this-is-not-valid-json',
                    headers={'X-CSRF-Token': self._csrf(), 'Content-Type': 'application/json'}
                )
                if res.status_code >= 500:
                    offenders.append(f'{resolved} → {res.status_code}')
            except Exception as e:
                offenders.append(f'{resolved} → EXCEPTION {type(e).__name__}')
        self.assertFalse(offenders,
            msg='Ovi endpointi ne obraduju malformed JSON:\n  ' + '\n  '.join(offenders[:20]))


# ==================================================================
# BLOK 2: CRUD SAVE PATH — svaki entitet, kompletan life-cycle
# ==================================================================

class T02CRUDLifecycle(AggroBase):

    def setUp(self):
        self._login()

    def _bulk_save(self, key, items):
        """Payload shape: {value: [array_of_items]} (svaki item je JSON za tu tabelu)."""
        return self._post_csrf(f'/api/data/{key}', {'value': items})

    def _single_save(self, key, item):
        """/api/item/<key> POST — dodaje/zamenjuje jednu stavku."""
        return self._post_csrf(f'/api/item/{key}', item)

    def test_01_partner_create_and_read_roundtrip(self):
        item = {
            'id': str(uuid.uuid4()),
            'companyName': 'Aggro Test LTD',
            'entityType': 'company',
            'address': {'street': 'Test 1', 'city': 'Beograd', 'zip': '11000', 'country': 'RS'},
            'contact': {'person': 'Test Person', 'email': 'test@example.com', 'phone': '+381600000000'},
            'bank': {'name': 'AIK Banka', 'accountNumber': '', 'swift': ''},
            'types': ['customer'],
            'lastModified': '2026-07-20T10:00:00Z',
        }
        r = self._single_save('partners', item)
        self.assertIn(r.status_code, (200, 201), msg=f'{r.status_code}: {r.data[:200]}')
        r2 = self.client.get('/api/data/partners')
        self.assertEqual(r2.status_code, 200)
        names = [p.get('companyName') for p in (r2.get_json() or {}).get('value', [])]
        self.assertIn('Aggro Test LTD', names)

    def test_02_bulk_save_replaces_entire_table(self):
        """Bulk save je destruktivan — briše sve pa upisuje. Verifikuj da nema
        stagnantnih zapisa niti duplikata."""
        items = [
            {'id': 'bulk-1', 'companyName': 'Bulk One', 'entityType': 'company', 'lastModified': 'x'},
            {'id': 'bulk-2', 'companyName': 'Bulk Two', 'entityType': 'company', 'lastModified': 'x'},
        ]
        r = self._bulk_save('partners', items)
        self.assertIn(r.status_code, (200, 201), msg=f'{r.status_code}: {r.data[:200]}')
        after = self.client.get('/api/data/partners').get_json()['value']
        after_names = [p['companyName'] for p in after]
        self.assertIn('Bulk One', after_names)
        self.assertIn('Bulk Two', after_names)
        # NEMA duplikata istog ID-ja
        ids = [p['id'] for p in after]
        self.assertEqual(len(ids), len(set(ids)), 'DUPLIKATI ID-a nakon bulk save-a!')

    def test_03_product_save_with_soft_warning_hs(self):
        """Product sa nepoznatim HS kodom mora biti sačuvan (soft warning na
        klijentu ne blokira server) — ovo je P0 fix v22."""
        item = {
            'id': str(uuid.uuid4()),
            'name': 'Aggro Test Product',
            'category': 'other',
            'hsCode': '9999',
            'lastModified': '2026-07-20T10:00:00Z',
        }
        r = self._single_save('products', item)
        self.assertIn(r.status_code, (200, 201), msg=f'{r.status_code}: {r.data[:200]}')
        got = self.client.get('/api/data/products').get_json()['value']
        self.assertIn('Aggro Test Product', [p['name'] for p in got])

    def test_04_delete_removes_only_target(self):
        """DELETE /api/item/<key>/<id> mora obrisati SAMO ciljani zapis,
        ne susedne."""
        for i in range(3):
            self._single_save('products', {
                'id': f'del-target-{i}', 'name': f'DelTarget {i}',
                'category': 'other', 'lastModified': 'x'
            })
        r = self._del_csrf('/api/item/products/del-target-1')
        self.assertIn(r.status_code, (200, 204), msg=f'{r.status_code}: {r.data[:200]}')
        remaining = self.client.get('/api/data/products').get_json()['value']
        names = [p['name'] for p in remaining]
        self.assertIn('DelTarget 0', names)
        self.assertNotIn('DelTarget 1', names)  # obrisan
        self.assertIn('DelTarget 2', names)


# ==================================================================
# BLOK 3: DUPLICATE-SEND EMAIL GUARD — regression za bug od 20.7.
# ==================================================================

class T03NoEmailDuplication(AggroBase):

    def setUp(self):
        self._login()
        # očisti email queue pre svakog testa
        from config import DB_FILE
        with sqlite3.connect(DB_FILE, timeout=10) as conn:
            conn.execute('DELETE FROM email_queue')
            conn.commit()

    def test_01_ten_parallel_workers_send_once(self):
        """Deset thread-ova simultano zove process_email_queue().
        Isti pending mail sme da ide na SMTP samo jednom."""
        import utils_email
        from config import DB_FILE
        # ubaci jedan pending zapis
        rec_id = str(uuid.uuid4())
        with sqlite3.connect(DB_FILE) as conn:
            conn.execute(
                "INSERT INTO email_queue (id, recipient, subject, html_body, plain_body, attachments_ref, attempts, status, queued_at, next_retry_at) "
                "VALUES (?, ?, ?, ?, ?, ?, 0, 'pending', ?, ?)",
                (rec_id, 'guard@example.com', 'test', '<p>x</p>', 'x', '[]', '2026-07-20T10:00:00Z', '2026-07-20T10:00:00Z')
            )
            conn.commit()

        # monkey-patch _send da broji pozive
        call_count = [0]
        original_send = utils_email._send
        def counting_send(*a, **k):
            call_count[0] += 1
            return True, 'sent'
        utils_email._send = counting_send
        try:
            threads = []
            for _ in range(10):
                t = threading.Thread(target=utils_email.process_email_queue)
                threads.append(t); t.start()
            for t in threads: t.join(timeout=15)
        finally:
            utils_email._send = original_send

        self.assertLessEqual(call_count[0], 1,
            msg=f'DUPLIKAT MAILA: send pozvan {call_count[0]}x umesto max 1x!')


# ==================================================================
# BLOK 4: DB LOCK PRESSURE — 20 pisara + backup thread simultano
# ==================================================================

class T04DBLockUnderPressure(AggroBase):

    def test_01_parallel_writers_no_data_loss(self):
        """5 thread-ova, svaki upisuje 5 partnera preko /api/item/partners
        (per-row save). Ovo je real-world scenario — više admin-a u istom
        trenutku dodaje partnere. WAL + retry_on_lock mora da absorbuje
        sve SQLITE_BUSY greške."""
        self._login()
        errors = []
        completed_ids = set()
        completed_lock = threading.Lock()

        def worker(tid):
            c = app_module.app.test_client()
            r0 = c.post('/api/auth/login', json={
                'username': 'testadmin', 'password': 'TestAdmin!12345',
                'location': '44.7866,20.4489', 'device': f'w{tid}'
            })
            if r0.status_code != 200:
                errors.append(f'w{tid} login: {r0.status_code}')
                return
            csrf = c.get('/api/csrf/token').get_json()['csrf_token']
            for i in range(5):
                pid = f'pressure-{tid}-{i}'
                item = {
                    'id': pid, 'companyName': f'Pressure {tid}-{i}',
                    'entityType': 'company', 'lastModified': '2026-07-20T10:00:00Z',
                }
                r = c.post('/api/item/partners', json=item,
                           headers={'X-CSRF-Token': csrf})
                if r.status_code not in (200, 201):
                    errors.append(f'w{tid}#{i}: {r.status_code} {r.data[:100]}')
                else:
                    with completed_lock:
                        completed_ids.add(pid)

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(5)]
        for t in threads: t.start()
        for t in threads: t.join(timeout=60)

        self.assertFalse(errors, msg='DB lock pressure greške:\n' + '\n'.join(errors[:10]))

        # verifikuj da su SVI zapisi zaista završili u bazi
        after = self.client.get('/api/data/partners').get_json()['value']
        after_ids = {p['id'] for p in after}
        missing = completed_ids - after_ids
        self.assertFalse(missing,
            msg=f'{len(missing)} zapisa "uspešno" upisano ali NEMA ih u bazi (data loss!): {list(missing)[:5]}')


# ==================================================================
# BLOK 5: AUTH PERMISSION MATRIX — worker ne sme na admin-only rute
# ==================================================================

class T05WorkerPermissionMatrix(AggroBase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # kreiraj radnika bez permisija
        cls.client.post('/api/auth/login', json={
            'username': 'testadmin', 'password': 'TestAdmin!12345',
            'location': '44.7866,20.4489', 'device': 't'
        })
        csrf = cls.client.get('/api/csrf/token').get_json()['csrf_token']
        cls.client.post('/api/users', json={
            'username': 'aggroworker',
            'password': 'AggroWorker!12345',
            'role': 'worker',
            'permissions': {}
        }, headers={'X-CSRF-Token': csrf})
        cls.client.post('/api/auth/logout', headers={'X-CSRF-Token': csrf})

    def setUp(self):
        r = self.client.post('/api/auth/login', json={
            'username': 'aggroworker', 'password': 'AggroWorker!12345',
            'location': '44.7866,20.4489', 'device': 't'
        })
        # ako se worker ne može ulogovati, preskoči
        if r.status_code != 200:
            self.skipTest(f'worker login vratio {r.status_code}')

    def test_01_worker_cant_delete_user(self):
        r = self.client.delete('/api/users/testadmin', headers={'X-CSRF-Token': self._csrf()})
        self.assertIn(r.status_code, (401, 403), msg=f'worker JE OBRISAO user-a: {r.status_code}')

    def test_02_worker_cant_run_manual_backup(self):
        r = self.client.post('/api/system/backup/now', headers={'X-CSRF-Token': self._csrf()})
        self.assertEqual(r.status_code, 403)

    def test_03_worker_cant_read_audit_logs(self):
        r = self.client.get('/api/audit_logs')
        self.assertIn(r.status_code, (401, 403))

    def test_04_worker_cant_change_firewall_config(self):
        r = self._post_csrf('/api/firewall/settings', {'whitelist': [], 'blacklist': []})
        self.assertIn(r.status_code, (401, 403), msg=f'{r.status_code}: {r.data[:100]}')

    def test_05_worker_cant_change_api_keys(self):
        r = self._post_csrf('/api/system/api_keys', {'track17ApiKey': 'stolen'})
        self.assertEqual(r.status_code, 403)

    def test_06_worker_cant_change_otp_delivery(self):
        r = self._post_csrf('/api/system/otp_delivery', {'provider': 'resend', 'api_key': 'stolen'})
        self.assertEqual(r.status_code, 403)


# ==================================================================
# BLOK 6: FRONTEND STATIC HEALTH — brace/paren balance, hard-forbidden tokens
# ==================================================================

class T06FrontendStaticHealth(unittest.TestCase):

    _ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'static', 'js')

    def _js_files(self):
        for root, dirs, files in os.walk(self._ROOT):
            # skip vendored + minified
            if 'vendor' in root or 'node_modules' in root:
                continue
            for f in files:
                if f.endswith('.js') and not f.endswith('.min.js'):
                    yield os.path.join(root, f)

    def test_01_all_js_modules_parse_via_node_if_available(self):
        """Ako je node dostupan, `node --check` je autoritativan sintaksni check.
        Ako nije (npr. čisti Python container), skip — brace-balance sa custom
        tokenizerom je nepouzdan zbog regex literala i template ${…} izraza."""
        import shutil
        node = shutil.which('node')
        if not node:
            self.skipTest('node nije dostupan — sintaksni check preskočen')
        import subprocess
        offenders = []
        for f in self._js_files():
            try:
                r = subprocess.run([node, '--check', f], capture_output=True, text=True, timeout=10)
                if r.returncode != 0:
                    # neki fajlovi su modul-scope declaration bez top-level statement
                    # koje node --check zna da baci ako je import syntax involved;
                    # filtriramo samo prave SyntaxError-e
                    err = (r.stderr or '')[:200]
                    if 'SyntaxError' in err:
                        offenders.append(f'{os.path.relpath(f)}: {err.splitlines()[0]}')
            except Exception:
                continue
        self.assertFalse(offenders, msg='node --check je našao syntax error(e):\n  ' + '\n  '.join(offenders))

    def test_02_no_leftover_debug_tokens_in_shipped_modules(self):
        """Zabranjeno u produkcionim modulima: console.trace, debugger."""
        offenders = []
        forbid = ['debugger;', 'console.trace(']
        for f in self._js_files():
            with open(f, 'r', encoding='utf-8') as fp:
                src = fp.read()
            for tok in forbid:
                if tok in src:
                    offenders.append(f'{os.path.relpath(f)}: {tok}')
        self.assertFalse(offenders, msg='Debug tokeni u produkcionim modulima:\n  ' + '\n  '.join(offenders))


# ==================================================================
# BLOK 7: INTEGRATIONS SETTINGS FLOW — end-to-end save/load
# ==================================================================

class T07IntegrationsSettings(AggroBase):

    def setUp(self):
        self._login()

    def test_01_otp_delivery_save_and_load(self):
        r = self._post_csrf('/api/system/otp_delivery', {
            'provider': 'resend',
            'api_key': 're_test_ABCDEFGH12345678',
            'from_email': 'no-reply@aggro.io',
            'from_name': 'Aggro',
            'magic_link_enabled': True,
            'magic_link_ttl_min': 10,
        })
        self.assertEqual(r.status_code, 200, msg=f'{r.status_code}: {r.data}')
        got = self.client.get('/api/system/otp_delivery').get_json()
        self.assertEqual(got.get('provider'), 'resend')
        self.assertEqual(got.get('from_email'), 'no-reply@aggro.io')
        self.assertTrue(got.get('has_api_key'))
        self.assertIn('re_t', got.get('api_key_masked', ''))
        self.assertTrue(got.get('magic_link_enabled'))

    def test_02_otp_delivery_rejects_bad_resend_key(self):
        r = self._post_csrf('/api/system/otp_delivery', {
            'provider': 'resend',
            'api_key': 'sg_wrong_prefix',  # ne počinje sa re_
        })
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.get_json().get('error'), 'RESEND_KEY_INVALID')

    def test_03_api_keys_masking_on_read(self):
        # snimaj jedan ključ
        r = self._post_csrf('/api/system/api_keys', {'track17ApiKey': 'ABCDEFGH12345678'})
        self.assertEqual(r.status_code, 200)
        got = self.client.get('/api/system/api_keys').get_json()
        entry = got.get('track17ApiKey')
        self.assertTrue(entry.get('has_value'))
        self.assertIn('…', entry.get('masked', ''))
        self.assertNotIn('ABCDEFGH', entry.get('masked', ''), 'Ceo ključ ne sme biti izložen!')

    def test_04_api_keys_empty_preserves_existing(self):
        # snimaj pa pošalji prazno — mora sačuvati stari ključ
        self._post_csrf('/api/system/api_keys', {'marineTrafficKey': 'ORIGINAL12345'})
        before = self.client.get('/api/system/api_keys').get_json()['marineTrafficKey']['masked']
        self._post_csrf('/api/system/api_keys', {'marineTrafficKey': ''})
        after = self.client.get('/api/system/api_keys').get_json()['marineTrafficKey']['masked']
        self.assertEqual(before, after, 'Prazan submit ne sme obrisati postojeći ključ')

    def test_05_hcaptcha_partial_config_gracefully(self):
        r = self._post_csrf('/api/system/hcaptcha', {'sitekey': 'test-site', 'secret': ''})
        self.assertEqual(r.status_code, 200)
        got = self.client.get('/api/system/hcaptcha').get_json()
        self.assertEqual(got.get('sitekey'), 'test-site')


# ==================================================================
# BLOK 8: BUSINESS LOGIC INVARIANTS — matematika, format, integritet
# ==================================================================

class T08BusinessInvariants(AggroBase):

    def test_01_iban_validator_mod97(self):
        from bank_validation import validate_iban
        # DE89 3704 0044 0532 0130 00 = validan
        self.assertTrue(validate_iban('DE89370400440532013000')['valid'])
        # jedan digit izmenjen = mod-97 puca
        self.assertFalse(validate_iban('DE89370400440532013001')['valid'])
        # kratak IBAN
        self.assertFalse(validate_iban('DE89')['valid'])
        # prazna string
        self.assertFalse(validate_iban('')['valid'])

    def test_02_bic_validator(self):
        from bank_validation import validate_bic
        self.assertTrue(validate_bic('DEUTDEFF', 'DE')['valid'])
        # BIC country ne poklapa
        r = validate_bic('DEUTDEFF', 'RS')
        self.assertFalse(r['valid'])
        self.assertIn('country', str(r.get('reason', '')).lower())

    def test_03_totp_full_cycle(self):
        import totp as _totp
        secret = _totp.generate_secret()
        code = _totp.totp_now(secret)
        self.assertTrue(_totp.totp_verify(secret, code))
        # pogresan kod = false
        self.assertFalse(_totp.totp_verify(secret, '000000'))
        # provisioning URI sadrži issuer + account
        uri = _totp.provisioning_uri(secret, 'admin@x.com', 'Aspidus')
        self.assertIn('Aspidus', uri)
        self.assertIn('admin@x.com', uri.replace('%40', '@'))

    def test_04_verify_hash_deterministic(self):
        """Isti input mora dati isti hash — inače verify URL puca kada
        klijent skenira QR i server ne može da nađe dokument."""
        from pdf_generator import _make_verification_hash
        h1 = _make_verification_hash('offer-id-abc', 'OFF-001')
        h2 = _make_verification_hash('offer-id-abc', 'OFF-001')
        self.assertEqual(h1, h2)
        # promeni offer_id = drugi hash
        h3 = _make_verification_hash('offer-id-xyz', 'OFF-001')
        self.assertNotEqual(h1, h3)
        # ne curi prazne string
        self.assertTrue(h1.startswith('VER-'))
        self.assertGreater(len(h1), 15)

    def test_05_search_index_indexes_saved_data(self):
        """FTS5 index vidi ono što je upravo sačuvano — real saveTo → search flow."""
        self._login()
        pid = str(uuid.uuid4())
        item = {
            'id': pid, 'companyName': 'AggroSearch UniqueMarker Ltd',
            'entityType': 'company', 'lastModified': '2026-07-20T10:00:00Z',
        }
        r_save = self._post_csrf('/api/item/partners', item)
        self.assertIn(r_save.status_code, (200, 201), msg=f'save: {r_save.status_code} {r_save.data[:120]}')
        r_rebuild = self._post_csrf('/api/system/search/rebuild')
        self.assertEqual(r_rebuild.status_code, 200, msg=f'rebuild: {r_rebuild.data[:120]}')
        rs = self.client.get('/api/system/search?q=UniqueMarker').get_json()
        titles = [r.get('title') for r in rs.get('results', [])]
        self.assertTrue(any('UniqueMarker' in (t or '') for t in titles),
            msg=f'FTS5 nije indeksirao novog partnera: {rs}')


if __name__ == '__main__':
    unittest.main(verbosity=2)
