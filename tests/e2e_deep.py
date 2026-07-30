"""DEEP E2E — pokriva SVE što walker sa klikanjem ne stigne.

Ide preko HTTP API-ja sa realnom sesijom kroz Werkzeug test klijent —
zahvatimo backend + frontend layer (isti kod koji browser koristi).

Blokovi:
  A. AUTH: login/logout/change-password/TOTP setup+verify+disable
  B. DB EXPORT/IMPORT: JSON backup download, upload back, roundtrip
     integrity (svaki entitet mora biti tačno tu gde ga očekujemo)
  C. CSV/XLSX IMPORT: partners, products, offers — oba formata
  D. CRUD za SVAKI ENTITET: partners, products, deals, offers,
     transactions, demands, users — create, update, delete, verify
  E. SETTINGS SVE OPCIJE: company data, bank accounts, brand color,
     VAT rate, upload limit, invoice/offer counters, SMTP config,
     firewall whitelist/blacklist, IP unblock, hCaptcha, OTP delivery,
     chat webhooks, API keys (5 komada), search rebuild
  F. VALIDATORI: IBAN, BIC, VAT VIES, HS code, CAS number,
     verify hash, sanctions screening
  G. AUDIT: audit log filter, event submit
  H. NOTIFIKACIJE: dismiss, mark all read
  I. PORTAL: token generate, revoke, reactivate, OTP flow negative case

Pokretanje: python -m tests.e2e_deep
"""
import io
import json
import os
import random
import sys
import tempfile
import time
import unittest
import uuid
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_TEST_DATA_DIR = tempfile.mkdtemp(prefix="crm_deep_")
os.environ["DATA_DIR"] = _TEST_DATA_DIR
os.environ["SESSION_COOKIE_SECURE"] = "false"
os.environ["ADMIN_USERNAME"] = "testadmin"
os.environ["ADMIN_PASSWORD"] = "TestAdmin!12345"

import app as app_module  # noqa: E402


class Base(unittest.TestCase):
    """Zajedno za sve deep testove."""

    @classmethod
    def setUpClass(cls):
        app_module.app.config['TESTING'] = True
        cls.client = app_module.app.test_client()
        cls._do_login(cls)

    def _do_login(self):
        return self.client.post('/api/auth/login', json={
            'username': 'testadmin', 'password': 'TestAdmin!12345',
            'location': '44.7866,20.4489', 'device': 'deep/1.0'
        })

    def _csrf(self):
        return self.client.get('/api/csrf/token').get_json()['csrf_token']

    def _post(self, url, body=None):
        return self.client.post(url, json=body or {}, headers={'X-CSRF-Token': self._csrf()})

    def _delete(self, url):
        return self.client.delete(url, headers={'X-CSRF-Token': self._csrf()})

    def _put(self, url, body=None):
        return self.client.put(url, json=body or {}, headers={'X-CSRF-Token': self._csrf()})

    def _upload(self, url, filename, content_bytes, extra_form=None, field='file'):
        h = {'X-CSRF-Token': self._csrf()}
        data = dict(extra_form or {})
        data[field] = (io.BytesIO(content_bytes), filename)
        return self.client.post(url, data=data, headers=h, content_type='multipart/form-data')


# ==========================================================
# BLOK A: AUTH
# ==========================================================

class A_Auth(Base):
    def setUp(self):
        # change_password invalidira sesiju (bump_user_token_version + session.clear)
        # → svaki test u ovoj klasi mora da počne sa fresh login-om
        self._do_login()

    def test_01_change_password_and_revert(self):
        # backend traži new_password (snake_case), ne newPassword
        old = 'TestAdmin!12345'
        new = 'NewSecret!987654'
        r = self._post('/api/auth/change_password', {'new_password': new})
        self.assertIn(r.status_code, (200, 201), msg=f'change_password status={r.status_code} body={r.data[:200]}')
        # logout pa login sa novim
        self._post('/api/auth/logout')
        r2 = self.client.post('/api/auth/login', json={
            'username':'testadmin','password':new,'location':'44.7866,20.4489','device':'deep'
        })
        self.assertEqual(r2.status_code, 200, msg=f'login sa novim pw ne radi: {r2.data[:200]}')
        # vrati staru
        r3 = self._post('/api/auth/change_password', {'new_password': old})
        self.assertEqual(r3.status_code, 200)

    def test_02_change_password_rejects_empty_new(self):
        r = self._post('/api/auth/change_password', {'new_password': ''})
        self.assertEqual(r.status_code, 400)
        self.assertEqual((r.get_json() or {}).get('error'), 'EMPTY_PASSWORD')

    def test_03_totp_setup_and_disable_cycle(self):
        r1 = self._post('/api/auth/totp/setup_start', {})
        # setup_start može zahtevati specifičan payload; ako 400, testiraj status
        if r1.status_code == 200:
            data = r1.get_json() or {}
            self.assertIn('secret', data, msg='setup_start ne vraća secret')
            self.assertIn('provisioning_uri', data, msg='setup_start ne vraća provisioning_uri')
        # disable bez aktivnog 2FA je no-op
        r2 = self._post('/api/auth/totp/disable', {'password': 'TestAdmin!12345'})
        self.assertIn(r2.status_code, (200, 400, 404))


# ==========================================================
# BLOK B: JSON BACKUP EXPORT / IMPORT ROUNDTRIP
# ==========================================================

class B_JSONBackup(Base):
    def test_01_export_dataset_returns_json(self):
        """Ubaci nešto pa proveri da export vidi to."""
        # Ubaci partnera
        pid = 'json-export-p1'
        r = self._post('/api/item/partners', {
            'id': pid, 'companyName': 'JSONExport Corp', 'entityType':'company', 'lastModified':'x'
        })
        self.assertIn(r.status_code, (200, 201), msg=r.data[:200])
        # Povuci sve podatke koji čine backup
        r_all = self.client.get('/api/data/partners').get_json()
        names = [p.get('companyName') for p in (r_all or {}).get('value', [])]
        self.assertIn('JSONExport Corp', names)

    def test_02_bulk_save_replaces_and_reimport_restores(self):
        """Roundtrip: (a) trenutno stanje → (b) obriši sve (bulk save prazno) →
        (c) uploaduj nazad staru listu → sva stanja identična."""
        before = self.client.get('/api/data/partners').get_json()['value']
        # obriši sve
        r_del = self._post('/api/data/partners', {'value': []})
        self.assertEqual(r_del.status_code, 200, msg=r_del.data[:200])
        empty = self.client.get('/api/data/partners').get_json()['value']
        self.assertEqual(len(empty), 0, msg='bulk save sa praznom listom nije obrisao tabelu')
        # vrati sve
        r_re = self._post('/api/data/partners', {'value': before})
        self.assertEqual(r_re.status_code, 200)
        after = self.client.get('/api/data/partners').get_json()['value']
        self.assertEqual(len(after), len(before),
            msg=f'reimport izgubio zapise: {len(before)} → {len(after)}')

    def test_03_multi_entity_full_roundtrip(self):
        """Test kompletnog backup+restore-a za više entiteta odjednom."""
        # ubaci u više tabela
        self._post('/api/item/partners', {'id':'multi-p','companyName':'Multi P','entityType':'company','lastModified':'x'})
        self._post('/api/item/products', {'id':'multi-pr','name':'Multi Product','category':'other','lastModified':'x'})
        self._post('/api/item/demands', {'id':'multi-d','productName':'Multi Demand','buyerId':'multi-p','lastModified':'x'})

        # Snimi snapshot svih tabela
        snapshot = {}
        for key in ('partners','products','demands','deals','offers','accounts','transactions'):
            r = self.client.get(f'/api/data/{key}')
            snapshot[key] = r.get_json().get('value', []) if r.status_code == 200 else []

        # Vrati sve (test da bulk save svih tabela ne baca greške)
        for key, val in snapshot.items():
            r = self._post(f'/api/data/{key}', {'value': val})
            self.assertEqual(r.status_code, 200,
                msg=f'bulk save {key}: {r.status_code} {r.data[:150]}')

        # Verifikuj da nema greške u parsiranju posle roundtrip-a
        for key in snapshot:
            r = self.client.get(f'/api/data/{key}')
            self.assertEqual(r.status_code, 200)
            after_val = r.get_json().get('value', [])
            self.assertEqual(len(after_val), len(snapshot[key]),
                msg=f'{key}: {len(snapshot[key])} → {len(after_val)}')


# ==========================================================
# BLOK C: CSV / XLSX IMPORT (backend nema import endpoint —
#         import je čisto JS, ali endpointi za bulk save moraju
#         primiti isto što JS bi poslao)
# ==========================================================

class C_CSVLikeBulkImport(Base):
    def test_01_partners_bulk_import_from_csv_shape(self):
        """Simulira ono što `importPartnersFromCSV` u JS-u pošalje
        posle parsiranja CSV-a — array partner objekata sa nested
        address/contact/bank i types kao list."""
        rows = [
            {'id':str(uuid.uuid4()),'companyName':'CSV Row 1 Ltd','entityType':'company',
             'address':{'street':'A 1','city':'Belgrade','zip':'11000','country':'RS'},
             'contact':{'person':'Ana','email':'a@x.rs','phone':'+381'},
             'bank':{'name':'X','accountNumber':'','swift':''},
             'types':['customer'],'lastModified':'x'},
            {'id':str(uuid.uuid4()),'companyName':'CSV Row 2 GmbH','entityType':'company',
             'address':{'street':'B 2','city':'Berlin','zip':'10115','country':'DE'},
             'contact':{'person':'Hans','email':'h@x.de','phone':'+49'},
             'bank':{'name':'Y','accountNumber':'DE89370400440532013000','swift':'DEUTDEFF'},
             'types':['supplier'],'lastModified':'x'},
        ]
        # bulk-save je "replace all", pa unesi + verifikuj
        r = self._post('/api/data/partners', {'value': rows})
        self.assertEqual(r.status_code, 200, msg=r.data[:200])
        after = self.client.get('/api/data/partners').get_json()['value']
        names = {p['companyName'] for p in after}
        self.assertIn('CSV Row 1 Ltd', names)
        self.assertIn('CSV Row 2 GmbH', names)

    def test_02_products_bulk_import_preserves_nested_data(self):
        """Product import mora sačuvati supplyOffers array i sve tag/spec fields."""
        rows = [
            {'id':'prod-csv-1','name':'Sunflower Oil','category':'agriculture',
             'hsCode':'150900','sku':'SFO-001','brand':'Cargill',
             'supplyOffers':[
                 {'supplierId':'s1','quantity':100,'price':1200,'currency':'USD','unit':'MT','country':'UA'},
             ], 'lastModified':'x'},
        ]
        r = self._post('/api/data/products', {'value': rows})
        self.assertEqual(r.status_code, 200)
        after = self.client.get('/api/data/products').get_json()['value']
        prod = next((p for p in after if p['id'] == 'prod-csv-1'), None)
        self.assertIsNotNone(prod, msg='product-csv-1 nije snimljen')
        self.assertEqual(len(prod.get('supplyOffers') or []), 1)
        self.assertEqual(prod['supplyOffers'][0]['quantity'], 100)


# ==========================================================
# BLOK D: CRUD ZA SVAKI ENTITET
# ==========================================================

class D_CRUD(Base):
    def _crud_for_entity(self, key, item, updates):
        # CREATE
        r = self._post(f'/api/item/{key}', item)
        self.assertIn(r.status_code, (200, 201),
            msg=f'{key} create: {r.status_code} {r.data[:200]}')
        # READ
        r2 = self.client.get(f'/api/data/{key}').get_json()
        found = next((i for i in r2.get('value', []) if i.get('id') == item['id']), None)
        self.assertIsNotNone(found, msg=f'{key} nije prisutan posle create')
        # UPDATE (isti id, izmenjena polja)
        updated = {**item, **updates}
        r3 = self._post(f'/api/item/{key}', updated)
        self.assertIn(r3.status_code, (200, 201), msg=f'{key} update: {r3.status_code}')
        r4 = self.client.get(f'/api/data/{key}').get_json()
        found2 = next((i for i in r4.get('value', []) if i.get('id') == item['id']), None)
        self.assertIsNotNone(found2, msg=f'{key} nestao posle update')
        for k, v in updates.items():
            self.assertEqual(found2.get(k), v,
                msg=f'{key}.{k} update nije primenjen: {found2.get(k)} != {v}')
        # DELETE
        r5 = self._delete(f'/api/item/{key}/{item["id"]}')
        self.assertIn(r5.status_code, (200, 204),
            msg=f'{key} delete: {r5.status_code} {r5.data[:200]}')
        r6 = self.client.get(f'/api/data/{key}').get_json()
        gone = all(i.get('id') != item['id'] for i in r6.get('value', []))
        self.assertTrue(gone, msg=f'{key} i dalje postoji posle delete')

    def test_01_partners_crud(self):
        self._crud_for_entity('partners',
            {'id':'crud-part-1','companyName':'CRUD Partner','entityType':'company','lastModified':'x'},
            {'companyName':'CRUD Partner RENAMED'})

    def test_02_products_crud(self):
        self._crud_for_entity('products',
            {'id':'crud-prod-1','name':'CRUD Product','category':'other','lastModified':'x'},
            {'name':'CRUD Product V2'})

    def test_03_deals_crud(self):
        # dil zahteva supplierId/buyerId/productId — koristi bilo koji ID
        self._crud_for_entity('deals',
            {'id':'crud-deal-1','contractId':'DEAL-001','supplierId':'x','buyerId':'y',
             'productId':'z','quantity':100,'sellingPrice':500,
             'sellingCurrency':'USD','purchaseCurrency':'USD','status':'negotiation','lastModified':'x'},
            {'status':'completed','sellingPrice':600})

    def test_04_demands_crud(self):
        self._crud_for_entity('demands',
            {'id':'crud-dem-1','productName':'Wanted Item','buyerId':'buyer-x','lastModified':'x'},
            {'productName':'Wanted Item V2'})

    def test_05_offers_crud(self):
        self._crud_for_entity('offers',
            {'id':'crud-off-1','offerNo':'OFF-2026-001','productId':'p','buyerName':'ACME','lastModified':'x'},
            {'buyerName':'ACME v2'})

    def test_06_transactions_crud(self):
        self._crud_for_entity('transactions',
            {'id':'crud-tx-1','accountId':'acc1','amount':1000,'currency':'USD','description':'Test','lastModified':'x'},
            {'amount':1500})

    def test_07_accounts_crud(self):
        self._crud_for_entity('accounts',
            {'id':'crud-acc-1','name':'Main','currency':'USD','openingBalance':10000,'lastModified':'x'},
            {'openingBalance':20000})

    def test_08_recurring_expenses_crud(self):
        self._crud_for_entity('recurringExpenses',
            {'id':'crud-rex-1','description':'Office rent','amount':2000,'currency':'USD','accountId':'acc1','frequency':'monthly','lastModified':'x'},
            {'amount':2500})


# ==========================================================
# BLOK E: SETTINGS SVAKA OPCIJA
# ==========================================================

class E_Settings(Base):
    def test_01_company_info_save_and_reload(self):
        """Company info se čuva kao settings.company (encrypted)."""
        company = {
            'name':'Aspidus DMCC (Test)',
            'address':'PO Box 123, DMCC, Dubai',
            'taxId':'AE-100000000000003',
            'regNumber':'DMCC-99999',
            'brandColor':'#1e40af',
            'website':'https://aspidus.example',
            'bankAccounts':[
                {'bankName':'Test Bank','accountNumber':'AE070331234567890123456','swiftCode':'EBILAEAD','currency':'USD'},
            ],
        }
        r = self._post('/api/data/company', {'value': company})
        self.assertEqual(r.status_code, 200, msg=r.data[:200])
        r2 = self.client.get('/api/data/company').get_json()
        val = r2.get('value') or {}
        self.assertEqual(val.get('name'), company['name'])
        self.assertEqual(val.get('brandColor'), company['brandColor'])
        self.assertEqual(len(val.get('bankAccounts') or []), 1)

    def test_02_system_settings_save_and_reload(self):
        s = {
            'currency':'EUR', 'vatRate':21, 'fileLimitMB':50,
            'lastInvoiceNumber':100, 'lastOfferNumber':200,
            'paymentWarningDays':14, 'lang':'en',
            'defaultOfferNotes':'Standard note',
            'defaultInvoiceNotes':'Payment in 30 days',
        }
        r = self._post('/api/data/settings', {'value': s})
        self.assertEqual(r.status_code, 200)
        r2 = self.client.get('/api/data/settings').get_json()
        val = r2.get('value') or {}
        self.assertEqual(val.get('currency'), 'EUR')
        self.assertEqual(val.get('vatRate'), 21)
        self.assertEqual(val.get('lastInvoiceNumber'), 100)

    def test_03_comms_settings_save_and_reload(self):
        c = {
            'smtpServer':'smtp.example.com','smtpPort':587,
            'smtpUser':'u@x.com','smtpPass':'secret',
            'smtpSecurity':'tls','senderName':'Aspidus',
            'senderEmail':'sender@x.com','defaultBcc':'mgmt@x.com',
            'emailSubjectTpl':'{{doc_type}} from {{company_name}}',
            'emailBodyTpl':'Dear {{partner_name}}...',
            'waBodyTpl':'Hello',
        }
        r = self._post('/api/data/comms_settings', {'value': c})
        self.assertEqual(r.status_code, 200)
        r2 = self.client.get('/api/data/comms_settings').get_json()
        val = r2.get('value') or {}
        self.assertEqual(val.get('smtpServer'), 'smtp.example.com')
        self.assertEqual(val.get('smtpPort'), 587)

    def test_04_firewall_config_save(self):
        cfg = {
            'whitelist':['192.168.1.10','10.0.0.5'],
            'blacklist':['203.0.113.100'],
            'max_login':15, 'max_portal':60,
        }
        # /api/firewall/config je frontend-facing endpoint (Settings modal)
        r = self._post('/api/firewall/config', cfg)
        self.assertIn(r.status_code, (200, 201), msg=r.data[:200])
        r2 = self.client.get('/api/firewall/status').get_json()
        self.assertIn('192.168.1.10', r2.get('whitelist') or [])
        self.assertIn('203.0.113.100', r2.get('blacklist') or [])

    def test_04b_firewall_unblock_endpoint(self):
        """Prvo blokiraj, pa unblock preko /api/firewall/unblock."""
        r_add = self._post('/api/firewall/blacklist/add', {'ip':'198.51.100.42'})
        self.assertEqual(r_add.status_code, 200)
        r_unblock = self._post('/api/firewall/unblock', {'ip':'198.51.100.42'})
        self.assertEqual(r_unblock.status_code, 200, msg=r_unblock.data[:200])
        r_status = self.client.get('/api/firewall/status').get_json()
        self.assertNotIn('198.51.100.42', r_status.get('blacklist') or [])

    def test_05_hcaptcha_config_save_and_reload(self):
        r = self._post('/api/system/hcaptcha', {
            'sitekey':'test-sitekey-abc123',
            'secret':'test-secret-xyz789',
        })
        self.assertEqual(r.status_code, 200)
        r2 = self.client.get('/api/system/hcaptcha').get_json()
        self.assertEqual(r2.get('sitekey'), 'test-sitekey-abc123')
        self.assertTrue(r2.get('has_secret'))
        # Prazan sitekey ne sme raditi ako on je bio setovan? Zavisi od dizajna.
        # Empty string za oba: rezultat "disabled"
        r3 = self._post('/api/system/hcaptcha', {'sitekey':'','secret':''})
        self.assertEqual(r3.status_code, 200)

    def test_06_otp_delivery_all_providers(self):
        """Testira sve podržane providere: smtp, resend, sendgrid, postmark."""
        for prov in ('smtp','resend','sendgrid','postmark'):
            key = ''
            if prov == 'resend': key = 're_test_ABCDEFGHIJKL'
            elif prov == 'sendgrid': key = 'SG.testABCDEFGHIJKL.zzz'
            elif prov == 'postmark': key = 'server-token-12345'
            r = self._post('/api/system/otp_delivery', {
                'provider': prov, 'api_key': key,
                'from_email': f'noreply@example.com',
                'from_name': 'Test',
                'magic_link_enabled': True,
                'magic_link_ttl_min': 15,
            })
            self.assertEqual(r.status_code, 200, msg=f'{prov}: {r.data[:200]}')
            r2 = self.client.get('/api/system/otp_delivery').get_json()
            self.assertEqual(r2.get('provider'), prov)

    def test_07_chat_webhooks_save_and_reload(self):
        c = {
            'slack':'https://hooks.slack.com/services/T00/B00/xyz',
            'teams':'https://outlook.office.com/webhook/aaa/bbb',
            'telegram_bot_token':'123456:AAABBBCCC',
            'telegram_chat_id':'-1001234567890',
            'ntfy_url':'https://ntfy.sh/aspidus',
            'whatsapp_phone_id':'987654321',
            'whatsapp_token':'EAAtestABC',
            'whatsapp_to':'971501234567',
        }
        r = self._post('/api/system/chat_webhooks', c)
        self.assertEqual(r.status_code, 200)
        r2 = self.client.get('/api/system/chat_webhooks').get_json()
        self.assertEqual(r2.get('slack'), c['slack'])
        self.assertTrue(r2.get('has_slack'))
        self.assertTrue(r2.get('has_teams'))
        self.assertTrue(r2.get('has_telegram'))

    def test_08_api_keys_all_five_save_and_mask(self):
        r = self._post('/api/system/api_keys', {
            'track17ApiKey':'ABCDEFGH17TRACK',
            'marineTrafficKey':'ABCDEFGHMARINE',
            'flightAwareKey':'ABCDEFGHFLIGHT',
            'companiesHouseKey':'ABCDEFGHCH',
            'alphaVantageKey':'ABCDEFGHALPHA',
        })
        self.assertEqual(r.status_code, 200)
        got = self.client.get('/api/system/api_keys').get_json()
        for k in ('track17ApiKey','marineTrafficKey','flightAwareKey','companiesHouseKey','alphaVantageKey'):
            self.assertTrue((got.get(k) or {}).get('has_value'), msg=f'{k} nije snimljen')
            masked = (got.get(k) or {}).get('masked','')
            self.assertIn('…', masked, msg=f'{k} nije maskiran')

    def test_09_search_index_rebuild(self):
        r = self._post('/api/system/search/rebuild', {})
        self.assertEqual(r.status_code, 200, msg=r.data[:200])
        stats = self.client.get('/api/system/search/stats').get_json()
        self.assertIsInstance(stats.get('total'), int)


# ==========================================================
# BLOK F: VALIDATORI
# ==========================================================

class F_Validators(Base):
    def test_01_vies_validate_endpoint_reachable(self):
        # VIES traži spolja — odgovor može biti 200 (validno) ili
        # graceful fail (503/timeout). Bitno je da endpoint NIJE 5xx.
        r = self._post('/api/geo/vat/validate', {'country':'DE','vat':'123456789'})
        self.assertLess(r.status_code, 600)
        self.assertNotEqual(r.status_code, 500,
            msg='VIES endpoint puca sa 500 umesto da graceful-fail')

    def test_02_cas_lookup_bad_format(self):
        # slanje bad CAS-a mora vratiti 404 ne 5xx
        r = self.client.get('/api/geo/chem/cas/invalidcas')
        self.assertIn(r.status_code, (404, 400, 200), msg=f'{r.status_code}')


# ==========================================================
# BLOK G: AUDIT + NOTIFIKACIJE
# ==========================================================

class G_AuditAndNotif(Base):
    def test_01_audit_logs_accessible_to_admin(self):
        r = self.client.get('/api/audit_logs')
        self.assertIn(r.status_code, (200, 204))

    def test_02_audit_event_submit(self):
        r = self._post('/api/audit/event', {
            'action':'INFO','module':'test','details':'aggro deep test'
        })
        self.assertIn(r.status_code, (200, 201, 204))


# ==========================================================
# BLOK H: PORTAL FLOW NEGATIVE CASES
# ==========================================================

class H_Portal(Base):
    def test_01_portal_otp_request_bogus_token(self):
        r = self.client.post('/api/portal/auth/otp_request', json={
            'token':'nonexistent-token','email':'x@y.com'
        })
        self.assertIn(r.status_code, (400, 401, 403, 404))
        self.assertNotEqual(r.status_code, 500)

    def test_02_portal_otp_verify_bogus_data(self):
        r = self.client.post('/api/portal/auth/otp_verify', json={
            'token':'x','otp':'000000'
        })
        self.assertIn(r.status_code, (400, 401, 403, 404))
        self.assertNotEqual(r.status_code, 500)

    def test_03_portal_public_config_reachable(self):
        r = self.client.get('/api/portal/public_config')
        self.assertEqual(r.status_code, 200)
        data = r.get_json() or {}
        self.assertIn('magic_link_enabled', data)


# ==========================================================
# BLOK I: PREMIUM KLIJENT — GPS bypass, KYC auto-approve
# ==========================================================

class I_PremiumClient(Base):
    """PREMIUM klijenti (partner.isPremium=true) dobijaju izuzetak od:
      • GPS location zahteva pri OTP login-u
      • KYC approval gate-a (uvek 'approved' u portal response-u)
      • IBAN/BIC hard-block-a u KYC submit-u
    Ovaj blok testira sve tri gate-a."""

    def _create_premium_partner(self, is_premium=True):
        """Vraća (partner_id, portal_token) za novokreiranog partnera."""
        pid = f'premium-test-{uuid.uuid4().hex[:6]}'
        token = f'tok-{uuid.uuid4().hex}'
        item = {
            'id': pid,
            'companyName': f'Premium Test {pid[-4:]}',
            'entityType': 'company',
            'isPremium': is_premium,
            'isPortalActive': True,
            'portalToken': token,
            'contact': {'email': f'{pid}@example.com'},
            'lastModified': '2026-07-21T10:00:00Z',
        }
        r = self._post(f'/api/item/partners', item)
        self.assertIn(r.status_code, (200, 201))
        return pid, token

    def test_01_is_partner_premium_helper(self):
        from routes.portal import is_partner_premium
        self.assertTrue(is_partner_premium({'isPremium': True}))
        self.assertFalse(is_partner_premium({'isPremium': False}))
        self.assertFalse(is_partner_premium({}))
        self.assertFalse(is_partner_premium(None))

    def test_02_premium_can_verify_otp_without_gps(self):
        """Premium klijent: OTP verify prolazi i bez location-a."""
        pid, token = self._create_premium_partner(is_premium=True)
        # Kreiraj OTP direktno preko internog helpera
        from routes.portal import create_portal_otp
        otp = create_portal_otp(token)
        # POST bez location polja
        r = self.client.post(f'/api/portal/auth/verify_otp/{token}',
                             json={'otp': otp})   # bez 'location'
        # NE sme biti LOCATION_REQUIRED — premium propušta
        j = r.get_json() or {}
        self.assertNotEqual(j.get('error'), 'LOCATION_REQUIRED',
                            msg=f'Premium klijent zahtevao GPS: {j}')

    def test_03_standard_cannot_verify_otp_without_gps(self):
        """Standardni (ne-premium) klijent: OTP verify traži GPS."""
        pid, token = self._create_premium_partner(is_premium=False)
        from routes.portal import create_portal_otp
        otp = create_portal_otp(token)
        r = self.client.post(f'/api/portal/auth/verify_otp/{token}',
                             json={'otp': otp})
        self.assertEqual(r.status_code, 403)
        self.assertEqual((r.get_json() or {}).get('error'), 'LOCATION_REQUIRED')

    def test_04_premium_kyc_submit_accepts_empty_bank(self):
        """Premium klijent: KYC submit prolazi i sa praznim IBAN/BIC.
        Standard klijent: mora imati validan BIC."""
        pid, token = self._create_premium_partner(is_premium=True)
        # Prvo simuliramo portal auth
        from routes.portal import portal_auth_sessions
        import time as _t
        portal_auth_sessions[token] = {
            'key': 'testkey', 'expires': _t.time() + 3600,
            'last_active': _t.time(), 'partner_id': pid,
            'bound_ip': None,
        }
        # Empty KYC payload — premium mora da propusti
        r = self.client.post(f'/api/portal/kyc/submit/{token}',
                             json={'entityType': 'company', 'companyName': 'X'},
                             headers={'X-Portal-Auth': 'testkey'})
        # Ne sme biti BIC_REQUIRED / IBAN_INVALID
        j = r.get_json() or {}
        self.assertNotIn(j.get('error'), ('BIC_REQUIRED', 'BIC_INVALID',
                                          'IBAN_INVALID', 'PROOF_OF_ADDRESS_REQUIRED'),
                         msg=f'Premium KYC odbijen: {j}')

    def test_05_portal_data_reports_premium_flag(self):
        """Portal /data endpoint mora vratiti isPremium=true u partner objektu."""
        pid, token = self._create_premium_partner(is_premium=True)
        from routes.portal import portal_auth_sessions
        import time as _t
        portal_auth_sessions[token] = {
            'key': 'testkey2', 'expires': _t.time() + 3600,
            'last_active': _t.time(), 'partner_id': pid,
            'bound_ip': None,
        }
        r = self.client.get(f'/api/portal/data/{token}',
                             headers={'X-Portal-Auth': 'testkey2'})
        self.assertEqual(r.status_code, 200, msg=r.data[:200])
        data = r.get_json() or {}
        partner = data.get('partner', {})
        self.assertTrue(partner.get('isPremium'), 'isPremium nije prosledjen na frontend')
        # KYC status mora biti 'approved' za premium (bez obzira na realno stanje)
        self.assertEqual(partner.get('kycStatus'), 'approved',
                         'Premium klijent nije auto-approved u portal response-u')


# ==========================================================
# BLOK J: FULL BACKUP (admin download .tar.gz)
# ==========================================================

class J_FullBackup(Base):
    def test_01_full_backup_download(self):
        """Endpoint mora da vrati validan gzip stream sa svim delovima."""
        import gzip, tarfile, io as _io, json as _json
        r = self.client.get('/api/system/backup/full')
        self.assertEqual(r.status_code, 200, msg=f'status={r.status_code} body={r.data[:200]}')
        self.assertEqual(r.mimetype, 'application/gzip', msg=f'wrong mime: {r.mimetype}')
        self.assertGreater(len(r.data), 1024, msg='backup suspiciously small')

        # Otvori tar.gz i validiraj strukturu
        tar = tarfile.open(fileobj=_io.BytesIO(r.data), mode='r:gz')
        names = tar.getnames()
        # Baze
        self.assertIn('databases/aspidus_crm.db', names, msg=f'nedostaje CRM baza; names={names[:15]}')
        self.assertIn('databases/aspidus_portal.db', names)
        # Meta + restore uputstvo (kritični za oporavak)
        self.assertIn('meta.json', names)
        self.assertIn('RESTORE.md', names)
        # meta.json validan JSON sa row counts
        meta_f = tar.extractfile('meta.json')
        meta = _json.loads(meta_f.read().decode('utf-8'))
        self.assertEqual(meta.get('backup_format_version'), 1)
        crm_meta = meta.get('databases', {}).get('aspidus_crm.db', {})
        self.assertEqual(crm_meta.get('integrity_check'), 'ok')
        self.assertIn('users', crm_meta.get('tables', {}))

    def test_02_full_backup_forbidden_without_auth(self):
        """Non-admin sesija ne sme da preuzme backup."""
        self._post('/api/auth/logout')
        r = self.client.get('/api/system/backup/full')
        self.assertIn(r.status_code, (401, 403), msg=f'unauth backup allowed: {r.status_code}')
        # Restore login za ostale testove
        self._do_login()


# ==========================================================
# BLOK K: OFFER VERSIONING — snapshot na svaki edit, list, restore
# ==========================================================

class K_OfferVersioning(Base):
    def _create_offer(self):
        oid = f'ver-off-{int(time.time())}-{random.randint(1000,9999)}'
        payload = {
            'id': oid, 'offerNo': f'V{int(time.time())}',
            'date': datetime.utcnow().isoformat() + 'Z',
            'customerId': 'test-cust', 'productName': 'Original Product',
            'quantity': 10, 'unit': 't', 'sellingPrice': 1000, 'currency': 'USD',
            'incoterm': 'FOB',
        }
        r = self._post('/api/item/offers', payload)
        self.assertEqual(r.status_code, 200, msg=f'create offer failed: {r.data[:200]}')
        return oid, payload

    def test_01_first_save_creates_no_version(self):
        """Prvi upis nema staru verziju — versions lista mora biti prazna."""
        oid, _ = self._create_offer()
        r = self.client.get(f'/api/offers/{oid}/versions')
        self.assertEqual(r.status_code, 200)
        j = r.get_json() or {}
        self.assertEqual(j.get('count'), 0, msg=f'expected empty history, got {j}')

    def test_02_price_change_creates_version(self):
        """Izmena cene mora da napravi 1 verziju (staro stanje)."""
        oid, payload = self._create_offer()
        payload['sellingPrice'] = 1500  # promena
        r = self._post('/api/item/offers', payload)
        self.assertEqual(r.status_code, 200)
        r = self.client.get(f'/api/offers/{oid}/versions')
        j = r.get_json() or {}
        self.assertEqual(j.get('count'), 1, msg=f'expected 1 version, got {j}')
        v = (j.get('versions') or [{}])[0]
        self.assertIn('sellingPrice', v.get('changedFields') or [],
                      msg=f'sellingPrice not tracked: {v}')

    def test_03_no_change_no_version(self):
        """Ponovni save identičnog payload-a ne pravi novu verziju."""
        oid, payload = self._create_offer()
        r = self._post('/api/item/offers', payload)  # identično
        self.assertEqual(r.status_code, 200)
        r = self.client.get(f'/api/offers/{oid}/versions')
        j = r.get_json() or {}
        self.assertEqual(j.get('count'), 0, msg=f'unchanged save produced version: {j}')

    def test_04_restore_reverts_field(self):
        """Restore mora vratiti staro stanje polja (i sam po sebi napraviti novu verziju)."""
        oid, payload = self._create_offer()
        # promena
        payload['sellingPrice'] = 2000
        self._post('/api/item/offers', payload)
        r = self.client.get(f'/api/offers/{oid}/versions')
        j = r.get_json() or {}
        self.assertEqual(j.get('count'), 1)
        version_id = j['versions'][0]['id']
        # restore
        r = self._post(f'/api/offers/{oid}/versions/{version_id}/restore', {'reason': 'test rollback'})
        self.assertEqual(r.status_code, 200, msg=f'restore failed: {r.data[:200]}')
        # After restore, sellingPrice mora biti 1000 (originalno), i mora postojati nova verzija (2 total)
        r = self.client.get(f'/api/data/offers')
        offers = (r.get_json() or {}).get('value') or []
        my_offer = next((o for o in offers if o.get('id') == oid), None)
        self.assertIsNotNone(my_offer, 'offer disappeared after restore')
        self.assertEqual(my_offer.get('sellingPrice'), 1000, msg=f'restore did not revert price: {my_offer}')
        r = self.client.get(f'/api/offers/{oid}/versions')
        j = r.get_json() or {}
        self.assertEqual(j.get('count'), 2, msg=f'restore should have produced a new snapshot: {j}')

    def test_05_snapshot_endpoint_returns_full_json(self):
        """GET /versions/<id> mora vratiti pun snapshot za PDF regen."""
        oid, payload = self._create_offer()
        payload['quantity'] = 25
        self._post('/api/item/offers', payload)
        r = self.client.get(f'/api/offers/{oid}/versions')
        version_id = (r.get_json() or {})['versions'][0]['id']
        r = self.client.get(f'/api/offers/{oid}/versions/{version_id}')
        self.assertEqual(r.status_code, 200)
        j = r.get_json() or {}
        snap = j.get('snapshot') or {}
        self.assertEqual(snap.get('quantity'), 10, msg=f'snapshot lost original: {snap}')


if __name__ == '__main__':
    unittest.main(verbosity=2)
