"""
Deterministic test seed: kreira svežu testnu bazu, ubacuje
- 1 admin korisnika (login: e2eadmin / E2eAdmin!12345)
- 1 partnera sa portal pristupom (email: e2e-partner@test.local, portalToken: E2E_TEST_TOKEN_0123456789ABCDEF)
- 1 proizvod
Baza se piše u DATA_DIR koji je test runner postavio (tmpdir).

Pokreće se kao skripta ili kao pomoćnik iz test suite-a.
"""
import os
import sys
import json
import uuid
import sqlite3
from werkzeug.security import generate_password_hash

# Osiguraj da je DATA_DIR postavljen pre imports app-a
if not os.getenv('DATA_DIR'):
    os.environ['DATA_DIR'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '_e2e_data')
os.makedirs(os.environ['DATA_DIR'], exist_ok=True)
os.environ['SESSION_COOKIE_SECURE'] = 'false'
os.environ['TEST_MODE'] = '1'

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import DB_FILE, PORTAL_DB_FILE
from database import init_db

E2E_ADMIN_USER = 'e2eadmin'
E2E_ADMIN_PASS = 'E2eAdmin!12345'
E2E_PARTNER_EMAIL = 'e2e-partner@test.local'
E2E_PARTNER_TOKEN = 'E2E_TEST_TOKEN_0123456789ABCDEF'
E2E_PARTNER_ID = 'e2e-partner-id-fixed-uuid-000001'
E2E_PRODUCT_ID = 'e2e-product-id-fixed-uuid-00001'


def seed():
    init_db()
    conn = sqlite3.connect(DB_FILE, timeout=30)
    c = conn.cursor()

    # Admin
    c.execute('DELETE FROM users WHERE username=?', (E2E_ADMIN_USER,))
    c.execute('INSERT INTO users (id, username, password, role, permissions, token_version) VALUES (?, ?, ?, ?, ?, 1)',
              (str(uuid.uuid4()), E2E_ADMIN_USER,
               generate_password_hash(E2E_ADMIN_PASS, method='scrypt:32768:8:1'),
               'admin', '{}'))

    # Partner sa portal token-om
    partner = {
        'id': E2E_PARTNER_ID,
        'name': 'E2E Test Partner Co',
        'companyName': 'E2E Test Partner Co',
        'entityType': 'company',
        'type': 'buyer',
        'address': 'Test Street 1',
        'city': 'Belgrade',
        'country': 'RS',
        'contact': {'email': E2E_PARTNER_EMAIL, 'phone': '+381110000000'},
        'email': E2E_PARTNER_EMAIL,
        'portalToken': E2E_PARTNER_TOKEN,
        'isPortalActive': True,
        'permissions': {
            'catalog_view': True, 'rfq_submit': True,
            'kyc_submit': True, 'profile_update': True,
            'products_submit': True, 'offers_view': True
        },
        'portalVisibleProducts': [E2E_PRODUCT_ID],
        'portalPermissions': ['shipments', 'offers', 'kyc', 'goods', 'profile', 'rfq', 'documents', 'catalog'],
    }
    c.execute('DELETE FROM partners WHERE id=?', (E2E_PARTNER_ID,))
    c.execute('INSERT INTO partners (id, data) VALUES (?, ?)',
              (E2E_PARTNER_ID, json.dumps(partner)))

    # Proizvod (za catalog i za offer)
    product = {
        'id': E2E_PRODUCT_ID,
        'name': 'E2E Test Coffee',
        'unit': 'MT',
        'hsCode': '090111',
        'sellingPrice': 5000,
        'sellingCurrency': 'USD',
        'purchasePrice': 3800,
        'productSpec': 'Arabica washed grade 1',
        'origin': 'BR',
        'showInPortal': True,
        'portalPublic': True,
    }
    c.execute('DELETE FROM products WHERE id=?', (E2E_PRODUCT_ID,))
    c.execute('INSERT INTO products (id, data) VALUES (?, ?)',
              (E2E_PRODUCT_ID, json.dumps(product)))

    # Company info
    company = {
        'name': 'Aspidus Test Co', 'address': 'Aspidus HQ 1', 'city': 'Rotterdam', 'country': 'NL',
        'taxId': '111222333', 'email': 'ops@aspidus.test',
        'bankAccounts': [{'bankName': 'Test Bank', 'accountNumber': 'IBAN0000', 'swiftCode': 'TESTBBBB', 'currency': 'EUR'}]
    }
    c.execute('DELETE FROM settings WHERE key=?', ('company',))
    c.execute('INSERT INTO settings (key, value) VALUES (?, ?)',
              ('company', json.dumps(company)))

    conn.commit()
    conn.close()
    print(f'[seed] admin={E2E_ADMIN_USER}/{E2E_ADMIN_PASS}')
    print(f'[seed] partner_id={E2E_PARTNER_ID} token={E2E_PARTNER_TOKEN}')
    print(f'[seed] product_id={E2E_PRODUCT_ID}')
    print(f'[seed] DB_FILE={DB_FILE}')


if __name__ == '__main__':
    seed()
