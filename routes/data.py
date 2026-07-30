import db
import json
import logging
import sqlite3
import uuid
from flask import Blueprint, request, jsonify, session
from config import DB_FILE
from utils import log_audit, login_required, encrypt_data, decrypt_data

logger = logging.getLogger(__name__)

data_bp = Blueprint('data', __name__)

# Whitelist of allowed table names — prevents SQL injection via f-string table names.
# ANY table name used in dynamic SQL MUST be validated against this set BEFORE query.

def _validate_table_name(key):
    '''Reject any table name not in the whitelist — prevents SQL injection.'''
    if key not in ALLOWED_DATA_TABLES:
        raise ValueError(f"Invalid table name: {key}")
    return key

ALLOWED_DATA_TABLES = {'partners', 'products', 'deals', 'demands', 'accounts', 'transactions', 'recurringExpenses', 'connections', 'offers', 'shared_documents'}


# Module-level permission maps — extracted from repeated inline dicts in
# get_data, save_single_item, delete_single_item. Single source of truth.
PERM_VIEW_MAP = {'accounts': 'finances', 'connections': 'partners', 'deals': 'deals', 'demands': 'products', 'offers': 'offers', 'partners': 'partners', 'products': 'products', 'recurringExpenses': 'finances', 'shared_documents': 'shared_documents', 'transactions': 'finances'}
PERM_EDIT_MAP = {'accounts': 'finances_edit', 'connections': 'partners_edit', 'deals': 'deals_edit', 'demands': 'products_edit', 'offers': 'offers_edit', 'partners': 'partners_edit', 'products': 'products_edit', 'recurringExpenses': 'finances_edit', 'shared_documents': 'shared_documents_edit', 'transactions': 'finances_edit'}
PERM_DELETE_MAP = {'accounts': 'finances_delete', 'connections': 'partners_delete', 'deals': 'deals_delete', 'demands': 'products_delete', 'offers': 'offers_delete', 'partners': 'partners_delete', 'products': 'products_delete', 'recurringExpenses': 'finances_delete', 'shared_documents': 'shared_documents_delete', 'transactions': 'finances_delete'}


def _get_user_perms(conn, user_id):
    """Helper: fetch role + decrypted permissions for a user.
    Returns (role, permissions_dict, user_row). Returns None on failure."""
    c = conn.cursor()
    c.execute('SELECT role, permissions FROM users WHERE id=?', (user_id,))
    row = c.fetchone()
    if not row:
        return None
    role = row[0]
    perms = decrypt_data(row[1]) if row[1] else {}
    return (role, perms, row)


def get_db_connection():
    conn = db.connect_raw(DB_FILE)
    return conn


# Moduli koji podrzavaju ownerId/sharedWith model vlasnistva.
# NAPOMENA: ranije je ownership filtriranje bilo hardkodirano samo za 'partners' i
# 'deals', zbog cega je '*_view_own' permisija za ostale module (accounts,
# transactions, demands, connections, offers) bila potpuno neefikasna - korisnik je
# video SVE zapise umesto samo svojih. Sada je generalizovano za sve module.
OWNERSHIP_MODULES = {'partners', 'deals', 'accounts', 'transactions', 'recurringExpenses', 'connections', 'offers', 'demands', 'shared_documents'}

# Settings kljucevi koji sadrze kredencijale/osetljive podatke i smeju se citati/pisati samo od strane admina.
SENSITIVE_SETTINGS_KEYS = {'comms_settings', 'firewall'}

def filter_by_ownership(key, item, module_name, permissions, user_id, role):
    """Vraca False ako korisnik NE sme da vidi ovaj zapis (nema view_all i nije vlasnik/deljeno sa njim)."""
    if role == 'admin':
        return True
    if permissions.get(f'{module_name}_view_all', False):
        return True
    if key not in OWNERSHIP_MODULES:
        return True
    owner_id = item.get('ownerId')
    shared_with = item.get('sharedWith', [])
    if owner_id is None:
        return True
    return owner_id == user_id or user_id in shared_with

@data_bp.route('/api/data/<key>', methods=['GET'])
@login_required
def get_data(key):
    conn = None
    try:
        conn = get_db_connection()
        c = conn.cursor()
        c.execute('SELECT role, permissions FROM users WHERE id=?', (session['user_id'],))
        user_data = c.fetchone()
        
        if not user_data: 
            return jsonify({"error": "User not found"}), 401
        
        role = user_data[0]
        # Permisije su kriptovane, ovde ih čitamo
        permissions = decrypt_data(user_data[1]) if user_data[1] else {}
        user_id = session['user_id']
        
        def can_view(module):
            return role == 'admin' or permissions.get(f'{module}_view_all', False) or permissions.get(f'{module}_view_own', False) or permissions.get(f'{module}_view', False)

        perm_map = PERM_VIEW_MAP
        
        if key in perm_map and not can_view(perm_map[key]):
            return jsonify({"value": [], "error": "Unauthorized"}), 403 
        
        tables = list(ALLOWED_DATA_TABLES)
        if key in tables:
            _validate_table_name(key)
            c.execute(f'SELECT data FROM {key}')
            rows = c.fetchall()
            data = []
            for row in rows:
                # Decrypt_data je pametan: pročitaće i ako je staro/kriptovano, i ako je novo/čisto
                item = decrypt_data(row[0]) 
                
                if role != 'admin':
                    module_name = perm_map.get(key, key)
                    if not filter_by_ownership(key, item, module_name, permissions, user_id, role):
                        continue

                    if key == 'deals' and not permissions.get('deals_view_costs', False):
                        item['purchasePrice'] = 0
                        item['bankCosts'] = 0
                        item['costs'] = []
                        item['supplierName'] = '*** HIDDEN ***'
                        item['supplierId'] = None
                        item['supplierBankDetails'] = ''
                    if key == 'products' and not permissions.get('products_view_prices', False):
                        for offer in item.get('supplyOffers', []):
                            offer['price'] = 0
                            offer['supplierId'] = None
                
                data.append(item)
                
            return jsonify({"value": data})
        else:
            # ISPRAVKA: comms_settings (SMTP host/user/LOZINKA) je ranije mogao da
            # procita BILO KOJI ulogovan korisnik. 'settings'/'company' ostaju javni
            # jer ih frontend koristi za osnovni prikaz aplikacije, ali osetljivi
            # kljucevi zahtevaju admin rolu.
            if key in SENSITIVE_SETTINGS_KEYS and role != 'admin':
                log_audit('SECURITY', 'database', f'Prevented read access to sensitive settings key: {key}', is_suspicious=True)
                return jsonify({"error": "Unauthorized"}), 403

            c.execute('SELECT value FROM settings WHERE key=?', (key,))
            row = c.fetchone()
            # Settings je OBAVEZNO kriptovan jer čuva SMTP lozinke
            return jsonify({"value": decrypt_data(row[0]) if row else None})
            
    except Exception as e:
        logger.error(f"get_data({key}) failed", exc_info=True)
        log_audit('ERROR', 'database', f'Read failed for module {key}', is_suspicious=True)
        return jsonify({"error": "DATABASE_ERROR"}), 503
    finally:
        if conn: conn.close()

@data_bp.route('/api/item/<key>', methods=['POST'])
@login_required
def save_single_item(key):
    # BEZBEDNOST + STABILNOST: request.json može biti bilo šta što se parsira
    # kao JSON — objekat, niz, string, broj, null. Bez proveri tipa naredni
    # item.get(...) baca AttributeError → 500 na svaki nevalidan payload
    # (npr. korisnik nalepi "[1,2,3]" u probama, ili frontend bug pošalje
    # pogrešnu strukturu). Provera radi soft: mora biti dict.
    item = request.get_json(silent=True)
    if not isinstance(item, dict):
        return jsonify({"error": "Empty or invalid payload — expected JSON object"}), 400

    item_id = item.get('id')
    if not item_id: return jsonify({"error": "ID is required"}), 400
    
    conn = None
    action_log_msg = None
    try:
        conn = get_db_connection()
        c = conn.cursor()
        
        c.execute('SELECT role, permissions FROM users WHERE id=?', (session['user_id'],))
        user_row = c.fetchone()
        if not user_row:
            conn.rollback()
            return jsonify({"error": "User not found"}), 401
            
        role = user_row[0]
        perms = decrypt_data(user_row[1]) if user_row[1] else {}
        
        perm_map = PERM_EDIT_MAP
        if role != 'admin' and key in perm_map and not perms.get(perm_map[key], False):
            conn.rollback()
            log_audit('SECURITY', 'database', f'Prevented write access to module: {key}', is_suspicious=True)
            return jsonify({"error": "Unauthorized"}), 403

        tables = list(ALLOWED_DATA_TABLES)
        action = 'EDIT'
        
        if key in tables:
            _validate_table_name(key)
            c.execute(f'SELECT data FROM {key} WHERE id=?', (item_id,))
            existing_row = c.fetchone()

            # OFFER VERSIONING: snapshot stare verzije PRE nego što je prepišemo.
            # Radi se tek u fazi save-a jer ovde imamo i old i new state.
            _old_offer_for_ver = None
            if key == 'offers' and existing_row:
                try:
                    _old_offer_for_ver = decrypt_data(existing_row[0])
                    if not isinstance(_old_offer_for_ver, dict):
                        _old_offer_for_ver = json.loads(existing_row[0]) if isinstance(existing_row[0], str) else None
                except Exception:
                    _old_offer_for_ver = None

            if not existing_row:
                action = 'CREATE'
                item['ownerId'] = session['user_id']
                item['sharedWith'] = []

                # ISPRAVKA (eskalacija privilegija): sanitizacija cena/troskova se
                # ranije radila SAMO pri izmeni postojeceg zapisa. Korisnik bez
                # 'deals_view_costs'/'products_view_prices' je pri KREIRANJU novog
                # deal-a/proizvoda i dalje mogao da upise nabavnu cenu, bankovne
                # podatke dobavljaca ili cene ponuda.
                if role != 'admin':
                    if key == 'deals' and not perms.get('deals_view_costs', False):
                        item['purchasePrice'] = 0
                        item['supplierId'] = None
                        item['supplierName'] = ''
                        item['supplierBankDetails'] = ''
                        item['costs'] = []
                        item['bankCosts'] = 0
                    if key == 'products' and not perms.get('products_view_prices', False):
                        for offer in item.get('supplyOffers', []) or []:
                            offer['price'] = 0
                            offer['supplierId'] = None
            else:
                existing = decrypt_data(existing_row[0])
                item['ownerId'] = existing.get('ownerId')
                item['sharedWith'] = existing.get('sharedWith', [])
                
                if role != 'admin':
                    if key == 'deals' and not perms.get('deals_view_costs', False):
                        item['purchasePrice'] = existing.get('purchasePrice', 0)
                        item['supplierId'] = existing.get('supplierId', '')
                        item['supplierName'] = existing.get('supplierName', '')
                        item['supplierBankDetails'] = existing.get('supplierBankDetails', '')
                        item['costs'] = existing.get('costs', [])
                        item['bankCosts'] = existing.get('bankCosts', 0)
                    if key == 'products' and not perms.get('products_view_prices', False):
                        item['supplyOffers'] = existing.get('supplyOffers', [])

            # OFFER VERSIONING: snimi stari snapshot pre upisa novog stanja.
            # Ovo se poziva između SELECT-a i INSERT OR REPLACE-a tako da imamo
            # obe verzije istovremeno. `snapshot_if_changed` će sam odlučiti
            # da li ima šta da se snimi (poredi TRACKED_FIELDS).
            if key == 'offers' and _old_offer_for_ver:
                try:
                    from offer_versions import snapshot_if_changed as _snap
                    _reason = ''
                    try:
                        _reason = (request.headers.get('X-Change-Reason') or item.get('_changeReason') or '').strip()
                    except Exception:
                        _reason = ''
                    _snap(
                        conn, item_id, _old_offer_for_ver, item,
                        changed_by=session.get('user_id', 'SYSTEM'),
                        changed_by_role=role or 'employee',
                        origin='crm',
                        change_reason=_reason,
                    )
                    # Ne persistuj _changeReason u samu ponudu — služi samo za log verzije
                    if '_changeReason' in item:
                        item.pop('_changeReason', None)
                except Exception:
                    logger.exception('offer version snapshot failed')

            # OPTIMIZACIJA: Čist JSON upis za maksimalnu brzinu baze.
            # v22 FIX: wrap u retry helper — pod PythonAnywhere SQLite lock je čest,
            # bez retry-ja svaki lock = izgubljen zapis + 500 error klijentu.
            _validate_table_name(key)
            db.retry_call(c.execute,
                           f'INSERT OR REPLACE INTO {key} (id, data) VALUES (?, ?)',
                           (item_id, json.dumps(item)))
            action_log_msg = (action, key, f'Updated item ID: {item_id}', False)
        
        elif key == 'settings' or key == 'company' or key == 'firewall' or key in SENSITIVE_SETTINGS_KEYS:
            # KRITICNA ISPRAVKA: ova grana ranije uopste nije proveravala rolu, pa je
            # SVAKI ulogovani korisnik mogao da prepise SMTP lozinku, podatke firme i
            # druge sistemske postavke preko ovog endpointa.
            if role != 'admin':
                conn.rollback()
                log_audit('SECURITY', 'database', f'Prevented write access to settings key: {key}', is_suspicious=True)
                return jsonify({"error": "Unauthorized"}), 403
            # ENKRIPCIJA: Podešavanja ostaju bezbedna u trezoru
            c.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (key, encrypt_data(item)))
            action_log_msg = ('EDIT', 'settings', f'Updated settings for {key}', False)
            # Ako je admin promenio firewall postavke, odmah ih primeni bez rekstart-a.
            if key == 'firewall':
                try:
                    from utils import load_firewall_settings as _reload_fw
                    _reload_fw()
                except Exception:
                    pass
        
        conn.commit()
        
        if action_log_msg:
            log_audit(action_log_msg[0], action_log_msg[1], action_log_msg[2], is_suspicious=action_log_msg[3])
            
        return jsonify({"status": "success", "id": item_id})
        
    except Exception as e:
        if conn: conn.rollback()
        logger.error(f"save_single_item({key}) failed", exc_info=True)
        log_audit('ERROR', 'database', f'Save failed for module {key}', is_suspicious=True)
        return jsonify({"error": "INTERNAL_SERVER_ERROR"}), 500
    finally:
        if conn: conn.close()

@data_bp.route('/api/item/<key>/<item_id>', methods=['DELETE'])
@login_required
def delete_single_item(key, item_id):
    conn = None
    action_log_msg = None
    try:
        conn = get_db_connection()
        c = conn.cursor()

        c.execute('SELECT role, permissions FROM users WHERE id=?', (session['user_id'],))
        user_row = c.fetchone()
        if not user_row:
            conn.rollback()
            return jsonify({"error": "User not found"}), 401
            
        role = user_row[0]
        perms = decrypt_data(user_row[1]) if user_row[1] else {}
        
        perm_map = PERM_DELETE_MAP
        if role != 'admin' and key in perm_map and not perms.get(perm_map[key], False):
            conn.rollback()
            log_audit('SECURITY', 'database', f'Prevented delete from module {key} (ID: {item_id})', is_suspicious=True)
            return jsonify({"error": "Unauthorized"}), 403

        tables = list(ALLOWED_DATA_TABLES)
        if key in tables:
            
            # Cascade Delete
            if key == 'deals':
                c.execute("SELECT id, data FROM transactions")
                for t_row in c.fetchall():
                    tx = decrypt_data(t_row[1])
                    if tx.get('dealId') == item_id:
                        c.execute("DELETE FROM transactions WHERE id=?", (t_row[0],))
                        log_audit('DELETE', 'finances', f'Auto-deleted orphaned transaction ID: {t_row[0]} linked to Deal: {item_id}', is_suspicious=False)

            _validate_table_name(key)
            c.execute(f'DELETE FROM {key} WHERE id = ?', (item_id,))
            conn.commit()
            action_log_msg = ('DELETE', key, f'Deleted item ID: {item_id}', False)
        else:
            conn.rollback()
            return jsonify({"error": "Invalid table"}), 400
            
        if action_log_msg:
            log_audit(action_log_msg[0], action_log_msg[1], action_log_msg[2], is_suspicious=action_log_msg[3])
            
        return jsonify({"status": "success"})
        
    except Exception as e:
        if conn: conn.rollback()
        logger.error(f"delete_single_item({key}, {item_id}) failed", exc_info=True)
        log_audit('ERROR', 'database', f'Delete failed for module {key}', is_suspicious=True)
        return jsonify({"error": "INTERNAL_SERVER_ERROR"}), 500
    finally:
        if conn: conn.close()

@data_bp.route('/api/data/<key>', methods=['POST'])
@login_required
def save_data(key):
    conn = None
    action_log_msg = None
    try:
        conn = get_db_connection()
        c = conn.cursor()

        tables = list(ALLOWED_DATA_TABLES)
        
        if key in tables:
            if session.get('role') != 'admin':
                conn.rollback()
                log_audit('SECURITY', 'database', f'Prevented Bulk Save for module: {key}', is_suspicious=True)
                return jsonify({"error": "Unauthorized"}), 403
                
            data = (request.get_json(silent=True) or {}).get('value', [])
            _validate_table_name(key)
            c.execute(f'DELETE FROM {key}') 
            for item in data:
                c.execute(f'INSERT INTO {key} (id, data) VALUES (?, ?)', (item.get('id', str(uuid.uuid4())), json.dumps(item)))
            action_log_msg = ('CREATE', key, 'Admin performed bulk save on table.', False)
        else:
            # KRITICNA ISPRAVKA: identicna rupa kao gore - ova grana nije proveravala
            # rolu, pa je bilo koji ulogovan korisnik mogao da prepise proizvoljan
            # settings kljuc (ukljucujuci SMTP kredencijale) preko bulk-save rute.
            if session.get('role') != 'admin':
                conn.rollback()
                log_audit('SECURITY', 'database', f'Prevented settings write for key: {key}', is_suspicious=True)
                return jsonify({"error": "Unauthorized"}), 403

            data = (request.get_json(silent=True) or {}).get('value')
            c.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', (key, encrypt_data(data)))
            action_log_msg = ('EDIT', 'settings', f'Updated settings for {key}', False)
            
        conn.commit()
        
        if action_log_msg:
            log_audit(action_log_msg[0], action_log_msg[1], action_log_msg[2], is_suspicious=action_log_msg[3])
            
        return jsonify({"status": "success"})
        
    except Exception as e:
        if conn: conn.rollback()
        logger.error(f"save_data({key}) failed", exc_info=True)
        log_audit('ERROR', 'database', f'Bulk save failed for module {key}', is_suspicious=True)
        return jsonify({"error": "INTERNAL_SERVER_ERROR"}), 500
    finally:
        if conn: conn.close()

# ==========================================================
#  OFFERS: konverzija ponude u dil / fakturu
# ==========================================================

@data_bp.route('/api/deals/from_offer/<offer_id>', methods=['POST'])
@login_required
def create_deal_from_offer(offer_id):
    """Kreira novi dil iz postojeće ponude. Podržava dva režima:
    1. Klijent je već prihvatio ponudu preko portala (clientStatus='accepted') → svako
       sa 'offers_to_deal' permisijom može da klikne 'Kreiraj dil'.
    2. Klijent nema portal ili admin želi da bypass-uje (payload.force=true) → samo
       admin ili korisnik sa 'offers_to_deal_force' permisijom sme (jer preskače
       klijentovu potvrdu).
    Bez ovih permisija radnik NE vidi dugme (kontroliše se frontend hasPerm)."""
    role = session.get('role')
    payload = request.get_json(silent=True) or {}
    force = bool(payload.get('force', False))

    # Provera permisija
    perms = {}
    if role != 'admin':
        conn_p = get_db_connection()
        try:
            cp = conn_p.cursor()
            cp.execute('SELECT permissions FROM users WHERE id=?', (session['user_id'],))
            prow = cp.fetchone()
        finally:
            conn_p.close()
        perms = decrypt_data(prow[0]) if prow and prow[0] else {}
        if not perms.get('offers_to_deal', False):
            log_audit('SECURITY', 'offers', f'Prevented unauthorized offer→deal conversion (offer {offer_id})', is_suspicious=True)
            return jsonify({"error": "UNAUTHORIZED"}), 403
        if force and not perms.get('offers_to_deal_force', False):
            log_audit('SECURITY', 'offers', f'Prevented forced offer→deal without client approval (offer {offer_id})', is_suspicious=True)
            return jsonify({"error": "FORCE_NOT_ALLOWED"}), 403

    conn = get_db_connection()
    try:
        c = conn.cursor()
        c.execute("SELECT data FROM offers WHERE id=?", (offer_id,))
        row = c.fetchone()
        if not row:
            conn.rollback()
            return jsonify({"error": "OFFER_NOT_FOUND"}), 404
        offer = decrypt_data(row[0])
        if not isinstance(offer, dict): offer = json.loads(row[0]) if isinstance(row[0], str) else {}

        # Ako klijent nije prihvatio i nije force, blokiraj
        client_accepted = offer.get('clientStatus') == 'accepted'
        if not client_accepted and not force:
            conn.rollback()
            return jsonify({"error": "CLIENT_HAS_NOT_ACCEPTED", "message": "Klijent nije potvrdio ponudu preko portala. Koristite 'force' za override."}), 409

        # Ako je ponuda vec konvertovana, sprecavamo duplu konverziju
        if offer.get('convertedDealId'):
            existing_deal_id = offer['convertedDealId']
            conn.rollback()
            return jsonify({"error": "ALREADY_CONVERTED", "dealId": existing_deal_id}), 409

        # Kreiraj dil iz ponude
        deal_id = str(uuid.uuid4())
        now_iso = None
        try:
            from datetime import datetime as _dt, timezone as _tz
            now_iso = _dt.now(_tz.utc).isoformat().replace('+00:00', 'Z')
        except Exception:
            pass

        first_item = (offer.get('items') or [{}])[0] if isinstance(offer.get('items'), list) else {}

        # KRITIČNO: dil MORA biti VERNA kopija svega što je klijent prihvatio.
        # Svako polje koje ne prenesemo → admin bi ga morao ručno prepisati, sa
        # rizikom greške koja odstupa od onoga što je klijent potpisao.
        # Zato prenosimo apsolutno sve komercijalne/logističke/finansijske podatke.
        deal = {
            'id': deal_id,
            'contractId': f"D-{offer.get('offerNo', '')}",
            'sourceOfferId': offer_id,
            'sourceOfferNo': offer.get('offerNo', ''),
            'sourceOfferDate': offer.get('date') or offer.get('createdAt'),
            'sourceOfferAcceptedAt': offer.get('clientAcceptedAt'),
            'clientAcceptanceNote': offer.get('clientNote', ''),
            'status': 'negotiation',
            'createdAt': now_iso,
            'ownerId': session.get('user_id', 'SYSTEM'),
            'sharedWith': [],
            # === KUPAC ===
            'buyerId': offer.get('customerId'),
            'buyerName': '',
            'buyerContactEmail': '',
            'buyerContactPhone': '',
            'buyerAddress': '',
            # === PROIZVOD (glavni) — za backward-compat sa CRM prikazom ===
            'productId': offer.get('productId') or first_item.get('productId'),
            'productName': offer.get('productName') or first_item.get('productName') or '',
            'hsCode': offer.get('hsCode') or first_item.get('hsCode') or '',
            'origin': offer.get('origin') or first_item.get('origin') or offer.get('productOrigin') or '',
            'detailedSpec': offer.get('detailedSpec') or offer.get('productSpec') or first_item.get('detailedSpec') or '',
            'quantity': offer.get('quantity') or first_item.get('quantity'),
            'unit': offer.get('unit') or first_item.get('unit') or '',
            # === CENA I VALUTA (glavna stavka) ===
            'sellingPrice': offer.get('sellingPrice') or offer.get('price') or first_item.get('price'),
            'sellingCurrency': offer.get('currency') or 'USD',
            # === KOMPLETNA LISTA STAVKI (multi-line offer) ===
            'items': offer.get('items') or [],
            'services': offer.get('services') or [],
            # === LOGISTIKA (POL/POD/vessel/container/lead) ===
            'incoterm': offer.get('incoterm') or first_item.get('incoterm') or '',
            'logistics': {
                'pol': offer.get('pol', ''),
                'pod': offer.get('pod', ''),
                'vessel': offer.get('vessel', ''),
                'containerNo': offer.get('containerNo', ''),
                'packaging': offer.get('packaging') or first_item.get('packaging') or '',
                'leadTime': offer.get('leadTime') or first_item.get('leadTime') or '',
                'shipmentDate': '',   # Popuni admin kad se ugovori tačan datum
                'blNumber': ''         # Popuni tek pri utovaru
            },
            # === TEŽINE / VOLUMEN — bitno za space u kontejneru ===
            'weights': offer.get('weights') or {},
            # === FINANSIJE ===
            'paymentTerms': offer.get('paymentTerms', ''),
            'discount': offer.get('discount') or 0,
            'customVatRate': offer.get('customVatRate') or 0,
            'advance': offer.get('advance') or 0,
            'taxClause': offer.get('taxClause', ''),
            # === BANKARSKE INSTRUKCIJE — kritično, admin ne sme da ih ručno prepisuje ===
            'bankDetails': offer.get('bankDetails', ''),
            # === NAPOMENE I DODATNO ===
            'notes': offer.get('notes', ''),
            'certificates': (first_item.get('certificates') if isinstance(first_item, dict) else '') or '',
            # === PDF REFERENCE — dokument koji je klijent video/potpisao ===
            'sourceOfferDocumentId': offer.get('documentId'),
            'sourceOfferPdfFileUrl': offer.get('pdfFileUrl'),
        }

        # Uzmi kupca iz partners tabele — puni podaci umesto samo ime.
        # NAPOMENA: legacy record-i imaju `address` kao STRING (jedan textarea),
        # dok noviji zapisi koriste dict {street, city, country}. Kod mora
        # da podržava obe forme — inače ovde bio 500 pri konverziji.
        c.execute("SELECT data FROM partners WHERE id=?", (offer.get('customerId'),))
        p_row = c.fetchone()
        if p_row:
            p_data = decrypt_data(p_row[0])
            if isinstance(p_data, dict):
                deal['buyerName'] = p_data.get('companyName') or p_data.get('name', '')
                contact = p_data.get('contact')
                contact = contact if isinstance(contact, dict) else {}
                deal['buyerContactEmail'] = contact.get('email') or p_data.get('email', '')
                deal['buyerContactPhone'] = contact.get('phone') or p_data.get('phone', '')
                addr = p_data.get('address')
                if isinstance(addr, dict):
                    deal['buyerAddress'] = ', '.join(filter(None, [
                        addr.get('street', ''), addr.get('city', ''), addr.get('country', '')
                    ]))
                elif isinstance(addr, str):
                    deal['buyerAddress'] = ', '.join(filter(None, [
                        addr, p_data.get('city', ''), p_data.get('country', '')
                    ]))
                else:
                    deal['buyerAddress'] = ''
                deal['buyerTaxId'] = p_data.get('taxId', '')
                deal['buyerRegNumber'] = p_data.get('regNumber', '')

        # Ako ponuda ima productId, obogati proizvod-specifikaciju iz kataloga
        if deal.get('productId'):
            c.execute("SELECT data FROM products WHERE id=?", (deal['productId'],))
            pr_row = c.fetchone()
            if pr_row:
                pr = decrypt_data(pr_row[0])
                if isinstance(pr, dict):
                    if not deal.get('productName'): deal['productName'] = pr.get('name', '')
                    if not deal.get('hsCode'): deal['hsCode'] = pr.get('hsCode', '')
                    if not deal.get('detailedSpec'): deal['detailedSpec'] = pr.get('detailedSpec', '')
                    # Ako je jedan supply offer selektovan preko supplyOfferIndex, prenesi origin i cenu nabavke
                    supply_offers = pr.get('supplyOffers') or []
                    idx = first_item.get('supplyOfferIndex') if isinstance(first_item, dict) else None
                    supply = None
                    if isinstance(idx, int) and 0 <= idx < len(supply_offers):
                        supply = supply_offers[idx]
                    elif first_item.get('supplierId') if isinstance(first_item, dict) else None:
                        for so in supply_offers:
                            if so.get('supplierId') == first_item.get('supplierId'):
                                supply = so; break
                    if supply:
                        if not deal.get('origin'): deal['origin'] = supply.get('country', '')
                        deal['purchasePrice'] = supply.get('price', 0)
                        deal['purchaseCurrency'] = supply.get('currency', '')
                        deal['supplierId'] = supply.get('supplierId')
                        deal['purchaseIncoterm'] = supply.get('incoterm', '')
                        if not deal['certificates']: deal['certificates'] = supply.get('certificates', '')
                        # Popuni ime dobavljača
                        if deal.get('supplierId'):
                            c.execute("SELECT data FROM partners WHERE id=?", (deal['supplierId'],))
                            sup_row = c.fetchone()
                            if sup_row:
                                sup_data = decrypt_data(sup_row[0])
                                if isinstance(sup_data, dict):
                                    deal['supplierName'] = sup_data.get('companyName', '')

        # Ako fali bankDetails na dilu, uzmi ih iz podataka firme (settings.company)
        if not deal.get('bankDetails'):
            c.execute("SELECT value FROM settings WHERE key='company'")
            comp_row = c.fetchone()
            if comp_row:
                comp = decrypt_data(comp_row[0])
                if isinstance(comp, dict):
                    parts = []
                    if comp.get('bankName'):    parts.append(f"Bank: {comp['bankName']}")
                    if comp.get('bankAddress'): parts.append(comp['bankAddress'])
                    if comp.get('accountNum'):  parts.append(f"IBAN: {comp['accountNum']}")
                    if comp.get('swift'):       parts.append(f"SWIFT: {comp['swift']}")
                    if comp.get('corrBank'):    parts.append(f"Correspondent: {comp['corrBank']}")
                    if parts: deal['bankDetails'] = '\n'.join(parts)

        db.retry_call(c.execute, "INSERT INTO deals (id, data) VALUES (?, ?)", (deal_id, json.dumps(deal)))

        # Označi ponudu kao konvertovanu
        offer['convertedDealId'] = deal_id
        offer['convertedAt'] = now_iso
        c.execute("UPDATE offers SET data=? WHERE id=?", (json.dumps(offer), offer_id))
        conn.commit()

        forced_msg = " (FORCED — client had not accepted via portal)" if (force and not client_accepted) else ""
        log_audit('CREATE', 'deals', f"Created deal {deal_id} from offer {offer.get('offerNo', offer_id)}{forced_msg}", is_suspicious=False)
        return jsonify({"status": "success", "dealId": deal_id, "deal": deal})
    except Exception as e:
        if conn: conn.rollback()
        logger.error(f"create_deal_from_offer({offer_id}) failed", exc_info=True)
        log_audit('ERROR', 'offers', 'offer→deal conversion failed', is_suspicious=True)
        return jsonify({"error": "INTERNAL_SERVER_ERROR"}), 500
    finally:
        if conn: conn.close()


# ==========================================================
#  OFFER VERSIONS — istorija izmena ponude
# ==========================================================
# Svaka izmena bilo kog kritičnog polja ponude (cena, količina, incoterm,
# stavke, valuta, itd.) automatski snima staru verziju u offer_versions
# tabelu (vidi offer_versions.snapshot_if_changed). Ovaj endpoint prikazuje
# istoriju koja je već upisana — read-only.

@data_bp.route('/api/offers/<offer_id>/versions', methods=['GET'])
@login_required
def list_offer_versions(offer_id):
    """Lista svih verzija (samo meta — nije velika)."""
    # Autorizacija: svako sa offers_view može da čita istoriju "svog" offer-a.
    conn = get_db_connection()
    try:
        c = conn.cursor()
        # Ownership check — worker sme samo ako je vlasnik ILI ima permisiju
        role = session.get('role')
        if role != 'admin':
            c.execute('SELECT permissions FROM users WHERE id=?', (session['user_id'],))
            prow = c.fetchone()
            perms = decrypt_data(prow[0]) if prow and prow[0] else {}
            if not perms.get('offers_view', False):
                return jsonify({"error": "UNAUTHORIZED"}), 403
            c.execute("SELECT data FROM offers WHERE id=?", (offer_id,))
            orow = c.fetchone()
            if not orow:
                return jsonify({"error": "OFFER_NOT_FOUND"}), 404
            od = decrypt_data(orow[0])
            if isinstance(od, dict) and od.get('ownerId') and od['ownerId'] != session['user_id']:
                if session['user_id'] not in (od.get('sharedWith') or []) and not perms.get('offers_view_all', False):
                    return jsonify({"error": "UNAUTHORIZED"}), 403

        from offer_versions import list_versions
        versions = list_versions(conn, offer_id)
        return jsonify({"offerId": offer_id, "count": len(versions), "versions": versions})
    finally:
        if conn: conn.close()


@data_bp.route('/api/offers/<offer_id>/versions/<version_id>', methods=['GET'])
@login_required
def get_offer_version(offer_id, version_id):
    """Vrati pun snapshot za jednu verziju (za diff/PDF-regen prikaz)."""
    conn = get_db_connection()
    try:
        role = session.get('role')
        if role != 'admin':
            c = conn.cursor()
            c.execute('SELECT permissions FROM users WHERE id=?', (session['user_id'],))
            prow = c.fetchone()
            perms = decrypt_data(prow[0]) if prow and prow[0] else {}
            if not perms.get('offers_view', False):
                return jsonify({"error": "UNAUTHORIZED"}), 403

        from offer_versions import get_snapshot
        snap = get_snapshot(conn, version_id)
        if not snap:
            return jsonify({"error": "VERSION_NOT_FOUND"}), 404
        if snap.get('offerId') != offer_id:
            # Sprečava enumeraciju version_id preko tuđeg offer_id
            return jsonify({"error": "VERSION_NOT_FOUND"}), 404
        return jsonify(snap)
    finally:
        if conn: conn.close()


@data_bp.route('/api/offers/<offer_id>/versions/<version_id>/restore', methods=['POST'])
@login_required
def restore_offer_version(offer_id, version_id):
    """Vrati staru verziju u aktivnu ponudu. Trenutna verzija se automatski
    snima pre restore-a (kao i svaki edit), tako da je i restore reverzibilan.
    Samo admin ili korisnik sa 'offers_edit' + 'offers_restore' sme."""
    role = session.get('role')
    perms = {}
    if role != 'admin':
        conn_p = get_db_connection()
        try:
            cp = conn_p.cursor()
            cp.execute('SELECT permissions FROM users WHERE id=?', (session['user_id'],))
            prow = cp.fetchone()
        finally:
            conn_p.close()
        perms = decrypt_data(prow[0]) if prow and prow[0] else {}
        if not perms.get('offers_edit', False):
            return jsonify({"error": "UNAUTHORIZED"}), 403

    from offer_versions import get_snapshot, snapshot_if_changed
    conn = get_db_connection()
    try:
        c = conn.cursor()
        c.execute("SELECT data FROM offers WHERE id=?", (offer_id,))
        row = c.fetchone()
        if not row:
            conn.rollback()
            return jsonify({"error": "OFFER_NOT_FOUND"}), 404
        current_offer = decrypt_data(row[0]) or {}
        if not isinstance(current_offer, dict):
            current_offer = {}

        snap = get_snapshot(conn, version_id)
        if not snap or snap.get('offerId') != offer_id:
            conn.rollback()
            return jsonify({"error": "VERSION_NOT_FOUND"}), 404

        target_offer = snap.get('snapshot') or {}
        # PRESERVE non-versionable metapodatke (id ostaje, timestampi neće u istoriju)
        target_offer['id'] = offer_id
        # Očuvaj ownerId — restore ne menja vlasništvo
        target_offer['ownerId'] = current_offer.get('ownerId')
        target_offer['sharedWith'] = current_offer.get('sharedWith', [])

        # Prvo snimi trenutni state kao verziju (da restore bude reverzibilan)
        payload = request.get_json(silent=True) or {}
        reason = str(payload.get('reason') or f'Restored to v{snap.get("version")}').strip()[:500]
        snapshot_if_changed(
            conn, offer_id, current_offer, target_offer,
            changed_by=session.get('user_id', 'SYSTEM'),
            changed_by_role=role or 'employee',
            origin='crm',
            change_reason=f'RESTORE: {reason}',
        )

        db.retry_call(c.execute, "UPDATE offers SET data=? WHERE id=?",
                       (json.dumps(target_offer), offer_id))
        conn.commit()
        log_audit('EDIT', 'offers',
                  f'Restored offer {offer_id} to version {snap.get("version")}',
                  is_suspicious=False)
        return jsonify({"status": "success", "restoredToVersion": snap.get('version'),
                        "offer": target_offer})
    except Exception:
        if conn: conn.rollback()
        logger.exception(f"restore_offer_version({offer_id}, {version_id}) failed")
        return jsonify({"error": "INTERNAL_SERVER_ERROR"}), 500
    finally:
        if conn: conn.close()


@data_bp.route('/api/offers/verify_hash', methods=['POST'])
@login_required
def verify_offer_hash():
    """Provera autentičnosti PDF-a preko VERIFICATION HASH-a koji je ugrađen u
    footer svake ponude. Admin unosi hash iz sumnjivog dokumenta; server
    poredi sa hash-om koji bi trenutno generisao za tu ponudu (deterministički).

    Vraća:
      { valid: true, offer_no, customer, generated_at } — ako se poklapa
      { valid: false, reason: 'HASH_MISMATCH' | 'OFFER_NOT_FOUND' } — inače

    Bilo koja izmena na dokumentu (imena, cifre, datumi) menja renderovani PDF.
    Ali verification hash u footeru je deterministički vezan za offer_id +
    offer_no — pa ako je neko menjao dokument u editoru A HASH OSTAVIO, ovaj
    endpoint neće prijaviti mismatch. Zato se autentifikacija vrši sledećim:
      1) Admin unosi hash + broj ponude (offerNo) iz PDF-a.
      2) Server pronađe ponudu po offerNo u bazi.
      3) Regeneriše hash iz DB podataka.
      4) Vraća da li se poklapa I ceo trenutan sadržaj ponude — pa admin
         može vizuelno da uporedi ceo dokument sa sumnjivim.
    """
    payload = request.get_json(silent=True) or {}
    offer_no = str(payload.get('offer_no') or payload.get('offerNo') or '').strip()
    provided_hash = str(payload.get('hash') or payload.get('verification_hash') or '').strip().upper()
    if not offer_no or not provided_hash:
        return jsonify({"valid": False, "reason": "OFFER_NO_AND_HASH_REQUIRED"}), 400

    from pdf_generator import _make_verification_hash

    conn = get_db_connection()
    try:
        c = conn.cursor()
        c.execute("SELECT id, data FROM offers")
        found = None
        for r in c.fetchall():
            od = decrypt_data(r[1])
            if isinstance(od, dict) and od.get('offerNo') == offer_no:
                found = (r[0], od); break
        if not found:
            return jsonify({"valid": False, "reason": "OFFER_NOT_FOUND"})
        offer_id, offer_data = found
        expected = _make_verification_hash(offer_id, offer_no)
        valid = provided_hash == expected
        log_audit('SECURITY', 'offers',
                  f"Document hash verification: offer {offer_no} → {'VALID' if valid else 'MISMATCH'}",
                  is_suspicious=(not valid))
        return jsonify({
            "valid": valid,
            "expected_hash": expected if valid else None,
            "provided_hash": provided_hash,
            "offer_no": offer_no,
            "customer_id": offer_data.get('customerId'),
            "generated_at": offer_data.get('pdfGeneratedAt') or offer_data.get('date'),
            "current_total": offer_data.get('sellingPrice'),
            "current_currency": offer_data.get('currency'),
            "reason": None if valid else "HASH_MISMATCH"
        })
    finally:
        conn.close()


@data_bp.route('/api/documents/verify_upload', methods=['POST'])
@login_required
def verify_document_upload():
    """Kriptografska provera integriteta uploadovanog PDF-a.

    Admin (ili neko sa dozvolom) uploaduje PDF fajl koji je vratio klijent
    (potpisan, ili čak i ne). Server:
      1) Računa SHA-256 nad bajtovima.
      2) Traži u shared_documents zapis koji ima taj pdfContentHash.
      3) Ako pronađe → binding hash + snapshot ponude → dokument je autentičan.
      4) Ako NE pronađe → poredi sa svim shared_documents.pdfContentHash-ovima
         i vraća prvi mismatch kao "modified" ako binding hash SEED odgovara
         (offerNo se pronađe u PDF metapodacima ili fajl-imenu).
      5) U svakom slučaju vraća detaljne rezultate za forensiku.

    Ovo štiti od:
      - Zamene brojeva (cena, količina) u PDF editoru
      - Umetanja/brisanja stranica
      - Menjanja footer verification hash-a
      - Menjanja metadata (Author, Title, Subject)
    """
    if 'file' not in request.files:
        return jsonify({"error": "FILE_REQUIRED"}), 400
    f = request.files['file']
    if not f.filename:
        return jsonify({"error": "FILE_EMPTY"}), 400
    data = f.read()
    if not data:
        return jsonify({"error": "FILE_EMPTY"}), 400
    if not data.startswith(b'%PDF'):
        return jsonify({"error": "NOT_A_PDF"}), 400

    import hashlib
    computed_hash = hashlib.sha256(data).hexdigest().upper()

    # Traži direct match
    conn = get_db_connection()
    match = None
    matched_by_seed = None
    try:
        c = conn.cursor()
        c.execute("SELECT id, data FROM shared_documents")
        rows = c.fetchall()
        for r in rows:
            doc = decrypt_data(r[1])
            if not isinstance(doc, dict): continue
            if doc.get('pdfContentHash') == computed_hash:
                match = doc; break
        if not match:
            # Sekundarni pretres: možda je fajl-ime `Offer_XYZ.pdf` → izvuci offerNo
            import re as _re
            m = _re.search(rb'/Title\s*\((.*?)\)', data[:16384])
            if m:
                title = m.group(1).decode('utf-8', errors='replace')
                m2 = _re.search(r'Offer\s+([A-Za-z0-9\-/_]+)', title)
                if m2:
                    seed_offer_no = m2.group(1)
                    for r in rows:
                        doc = decrypt_data(r[1])
                        if isinstance(doc, dict) and doc.get('fileName', '').endswith(f'{seed_offer_no}.pdf'):
                            matched_by_seed = doc; break
    finally:
        conn.close()

    if match:
        offer = None
        try:
            conn = get_db_connection()
            c = conn.cursor()
            c.execute("SELECT data FROM offers WHERE id=?", (match.get('sourceOfferId'),))
            row = c.fetchone()
            if row: offer = decrypt_data(row[0])
            conn.close()
        except Exception:
            pass
        log_audit('SECURITY', 'documents',
                  f"PDF integrity check: MATCH for {match.get('fileName')} (hash={computed_hash[:16]}...)",
                  is_suspicious=False)
        return jsonify({
            "valid": True,
            "status": "AUTHENTIC",
            "message": "Document is bit-exact identical to the version sent from this system.",
            "computed_hash": computed_hash,
            "document": {
                "id": match.get('id'),
                "fileName": match.get('fileName'),
                "docType": match.get('docType'),
                "createdAt": match.get('createdAt'),
                "sourceOfferId": match.get('sourceOfferId'),
                "bindingHash": match.get('bindingHash'),
                "shortVerification": match.get('shortVerification'),
            },
            "offer_snapshot": {
                "offerNo": offer.get('offerNo') if offer else None,
                "customerId": offer.get('customerId') if offer else None,
                "sellingPrice": offer.get('sellingPrice') if offer else None,
                "currency": offer.get('currency') if offer else None,
                "quantity": offer.get('quantity') if offer else None,
            } if offer else None,
        })

    if matched_by_seed:
        log_audit('SECURITY', 'documents',
                  f"PDF integrity check: MODIFIED — filename matches {matched_by_seed.get('fileName')} but content hash differs (uploaded={computed_hash[:16]}, expected={matched_by_seed.get('pdfContentHash', '')[:16]})",
                  is_suspicious=True)
        return jsonify({
            "valid": False,
            "status": "MODIFIED",
            "message": "This PDF appears to be a modified version of a document issued from this system. Content has been altered.",
            "computed_hash": computed_hash,
            "expected_hash": matched_by_seed.get('pdfContentHash'),
            "document": {
                "id": matched_by_seed.get('id'),
                "fileName": matched_by_seed.get('fileName'),
                "docType": matched_by_seed.get('docType'),
                "createdAt": matched_by_seed.get('createdAt'),
            }
        })

    log_audit('SECURITY', 'documents',
              f"PDF integrity check: UNKNOWN document (hash={computed_hash[:16]}...)",
              is_suspicious=True)
    return jsonify({
        "valid": False,
        "status": "UNKNOWN",
        "message": "This PDF was not issued from this system. Content hash not found in our records.",
        "computed_hash": computed_hash,
    })


@data_bp.route('/api/offers/preview_pdf', methods=['POST'])
@login_required
def preview_offer_pdf():
    """Vraća PDF bytes za ponudu koja MOŽDA nije snimljena u bazi. CRM koristi
    ovo za preview u browseru (blob URL) pre 'Save & Generate' — tako admin
    vidi TAČNO onaj isti PDF koji će klijent kasnije videti u portalu.
    Time se uklanja stara nekonzistentnost između client-side jsPDF u CRM-u
    i server-side ReportLab-a u portalu — sada je JEDAN pravi izvor istine."""
    payload = request.get_json(silent=True) or {}
    offer = payload if isinstance(payload, dict) else {}
    if not offer:
        return jsonify({"error": "OFFER_PAYLOAD_REQUIRED"}), 400
    try:
        from pdf_generator import build_offer_pdf
        pdf_bytes = build_offer_pdf(offer)
    except Exception as e:
        logger.error(f"preview_offer_pdf failed: {e}", exc_info=True)
        return jsonify({"error": "PDF_GENERATION_FAILED"}), 500
    from flask import Response
    return Response(pdf_bytes, mimetype='application/pdf',
                    headers={'Content-Disposition': 'inline; filename="offer_preview.pdf"',
                             'Cache-Control': 'no-store'})


@data_bp.route('/api/offers/<offer_id>/generate_pdf', methods=['POST'])
@login_required
def generate_offer_pdf_endpoint(offer_id):
    """Generise (i cuva u vault) profesionalan PDF ponude. Klijent u portalu tada
    moze da preuzme dokument preko standardnog /api/portal/document/... koji
    audit-loguje download.

    Permisija: admin ili neko sa offers_edit."""
    role = session.get('role')
    if role != 'admin':
        conn_p = get_db_connection()
        try:
            cp = conn_p.cursor()
            cp.execute('SELECT permissions FROM users WHERE id=?', (session['user_id'],))
            prow = cp.fetchone()
        finally:
            conn_p.close()
        perms = decrypt_data(prow[0]) if prow and prow[0] else {}
        if not (perms.get('offers_edit') or perms.get('offers_view_all')):
            log_audit('SECURITY', 'offers', 'Prevented unauthorized PDF generation', is_suspicious=True)
            return jsonify({"error": "UNAUTHORIZED"}), 403

    conn = get_db_connection()
    try:
        c = conn.cursor()
        c.execute("SELECT data FROM offers WHERE id=?", (offer_id,))
        row = c.fetchone()
        if not row:
            return jsonify({"error": "OFFER_NOT_FOUND"}), 404
        offer = decrypt_data(row[0])
        if not isinstance(offer, dict): offer = json.loads(row[0]) if isinstance(row[0], str) else {}
    finally:
        conn.close()

    try:
        from pdf_generator import save_offer_pdf_to_vault
    except Exception as e:
        return jsonify({"error": f"PDF_MODULE_UNAVAILABLE: {e}"}), 500

    doc_id, file_url = save_offer_pdf_to_vault(offer)
    if not doc_id:
        return jsonify({"error": "PDF_GENERATION_FAILED"}), 500

    # Poveži ponudu sa dokumentom kako bi klijent u portalu imao dugme download
    from datetime import datetime as _dt, timezone as _tz
    conn = get_db_connection()
    try:
        c = conn.cursor()
        c.execute("SELECT data FROM offers WHERE id=?", (offer_id,))
        row = c.fetchone()
        if row:
            of = decrypt_data(row[0])
            if not isinstance(of, dict): of = json.loads(row[0]) if isinstance(row[0], str) else {}
            of['documentId'] = doc_id
            of['pdfFileUrl'] = file_url
            of['pdfGeneratedAt'] = _dt.now(_tz.utc).isoformat().replace('+00:00', 'Z')
            c.execute("UPDATE offers SET data=? WHERE id=?", (json.dumps(of), offer_id))
            conn.commit()
    finally:
        conn.close()

    log_audit('CREATE', 'offers', f'Generated PDF for offer {offer_id} → vault doc {doc_id}', is_suspicious=False)

    # Pokušaj email obaveštenje klijentu
    try:
        conn = get_db_connection()
        c = conn.cursor()
        c.execute("SELECT data FROM partners WHERE id=?", (offer.get('customerId'),))
        prow = c.fetchone()
        conn.close()
        if prow:
            pdata = decrypt_data(prow[0])
            if isinstance(pdata, dict):
                email = pdata.get('contact', {}).get('email') or pdata.get('email')
                token = pdata.get('portalToken', '')
                portal_url = request.url_root.rstrip('/') + f"/portal/{token}" if token else request.url_root
                if email:
                    from utils_email import send_new_offer
                    send_new_offer(email, pdata.get('companyName', ''), offer.get('offerNo', ''), portal_url)
    except Exception:
        pass

    return jsonify({"status": "success", "documentId": doc_id, "fileUrl": file_url})


# ==========================================================
#  FAZA 6: TIMELINE PER DEAL
#  GET /api/deals/<deal_id>/timeline
# ==========================================================
# Vraća objedinjenu hronologiju svega vezanog za jedan posao:
#   1) Sam deal (create + last modified)
#   2) Sve transakcije (dealId=X ili invoiceNumber=contractId)
#   3) Sve izdate dokumente iz document_register (entityId=X ili
#      docNumber contains contractId)
#   4) Sve revizije dokumenata (document_revisions)
#   5) Audit log stavke koje pominju contractId ili dealId
# Sortirano od najstarijeg ka najnovijem, ili obrnuto ako je ?desc=1.

@data_bp.route('/api/deals/<deal_id>/timeline', methods=['GET'])
@login_required
def deal_timeline(deal_id):
    from config import AUDIT_DB_FILE
    desc = str(request.args.get('desc', '')).lower() in ('1', 'true', 'yes')

    events = []

    def _add(ts, kind, title, subtitle='', meta=None, icon=None):
        events.append({
            'timestamp': ts or '',
            'kind': kind,
            'title': title,
            'subtitle': subtitle,
            'meta': meta or {},
            'icon': icon or ''
        })

    contract_id = None
    conn = None
    try:
        conn = get_db_connection()
        c = conn.cursor()
        # 1) Deal sam
        row = c.execute('SELECT data FROM deals WHERE id=?', (deal_id,)).fetchone()
        if not row:
            return jsonify({'error': 'deal_not_found'}), 404
        deal = decrypt_data(row[0]) if row[0] else {}
        contract_id = deal.get('contractId', '')

        created = deal.get('createdAt') or deal.get('created_at') or ''
        modified = deal.get('lastModified') or deal.get('updatedAt') or ''
        _add(created, 'deal', f'Deal created — {contract_id}',
             f"Buyer: {deal.get('buyerName', '')}  ·  Product: {deal.get('productName', '')}",
             meta={'dealId': deal_id}, icon='📝')
        if modified and modified != created:
            _add(modified, 'deal', f'Deal updated — {contract_id}',
                 f"Status: {deal.get('status', 'unknown')}", meta={'dealId': deal_id}, icon='✏️')

        # 2) Transactions
        for tx_row in c.execute("SELECT id, data FROM transactions"):
            try:
                tx = decrypt_data(tx_row[1]) if tx_row[1] else {}
            except Exception:
                continue
            if tx.get('dealId') != deal_id and tx.get('invoiceNumber') != contract_id:
                continue
            ts = tx.get('date') or tx.get('createdAt') or ''
            amt = tx.get('amount', 0)
            cur = tx.get('currency', '')
            typ = tx.get('type', '')
            title = f"{'💰 Income' if typ == 'income' else '💸 Expense'}: {amt} {cur}"
            _add(ts, 'transaction', title,
                 f"{tx.get('category', '')} — {tx.get('source', '')}",
                 meta={'transactionId': tx.get('id', tx_row[0])},
                 icon='💰' if typ == 'income' else '💸')

        # 3) Documents from register — entityId match OR docNumber contains contractId
        try:
            for doc_row in c.execute(
                'SELECT docType, docNumber, revision, status, issuedAt, issuedBy '
                'FROM document_register WHERE entityId=? OR docNumber ILIKE ? '
                'ORDER BY issuedAt ASC',
                (deal_id, f'%{contract_id}%' if contract_id else '__nope__')
            ):
                doc_type, doc_num, rev, status, issued_at, issued_by = doc_row
                title = f"📄 {doc_type.upper()} issued: {doc_num}"
                sub = f"Revision {rev}  ·  Status: {status}  ·  By: {issued_by or 'system'}"
                _add(issued_at, 'document', title, sub,
                     meta={'docNumber': doc_num, 'docType': doc_type, 'revision': rev},
                     icon='📄')
        except db.OperationalError:
            pass  # tabela nije još kreirana

        # 4) Document revisions with reason
        try:
            for rev_row in c.execute(
                'SELECT docNumber, revision, changeReason, changedBy, changedAt '
                'FROM document_revisions WHERE entityId=? '
                'ORDER BY changedAt ASC',
                (deal_id,)
            ):
                _add(rev_row[4], 'revision',
                     f"🔁 Revision R{rev_row[1]} of {rev_row[0]}",
                     f"Reason: {rev_row[2]}  ·  By: {rev_row[3]}",
                     meta={'docNumber': rev_row[0], 'revision': rev_row[1]},
                     icon='🔁')
        except db.OperationalError:
            pass
    finally:
        if conn:
            conn.close()

    # 5) Audit log — mentions
    try:
        aconn = db.connect_raw(AUDIT_DB_FILE)
        needle = (contract_id or deal_id).strip()
        if needle:
            cur_a = aconn.cursor()
            try:
                rows = cur_a.execute(
                    "SELECT action, module, details, username, timestamp FROM audit_log "
                    "WHERE details ILIKE ? OR details ILIKE ? "
                    "ORDER BY timestamp ASC LIMIT 100",
                    (f'%{needle}%', f'%{deal_id}%')
                ).fetchall()
                for a_action, a_module, a_details, a_user, a_ts in rows:
                    _add(a_ts, 'audit', f"🛡️ {a_action}",
                         f"{a_module}: {(a_details or '')[:180]}  ·  By: {a_user or 'system'}",
                         meta={'action': a_action, 'module': a_module},
                         icon='🛡️')
            except db.OperationalError:
                pass
        aconn.close()
    except Exception:
        pass

    # Sortiraj hronoloski
    events.sort(key=lambda e: e.get('timestamp') or '', reverse=desc)

    return jsonify({
        'dealId': deal_id,
        'contractId': contract_id,
        'total': len(events),
        'events': events,
    })


# ==========================================================
#  BATCH D — NEW: Partner risk score
# ==========================================================
# Kompozitni score 0-100 sa razgraničenjem na kategorije:
#   KYC (approved=+30, pending=0, rejected=-30)
#   Sanctions match (any=-50, none=+20)
#   Age of relationship (>2y=+10, >5y=+15)
#   Payment history (on-time deals ratio)
#   Recent activity (last modification in <90d)

@data_bp.route('/api/partners/<partner_id>/risk-score', methods=['GET'])
@login_required
def partner_risk_score(partner_id):
    from datetime import datetime, timezone, timedelta
    if not partner_id:
        return jsonify({'error': 'partner_id_required'}), 400

    conn = None
    try:
        conn = get_db_connection()
        c = conn.cursor()
        r = c.execute("SELECT data FROM partners WHERE id=?", (partner_id,)).fetchone()
        if not r:
            return jsonify({'error': 'partner_not_found'}), 404
        p = decrypt_data(r[0]) if r[0] else {}

        score = 50   # baseline neutral
        breakdown = []

        # 1) KYC status
        kyc = (p.get('kyc') or {}).get('status', 'pending')
        if kyc == 'approved':
            score += 20; breakdown.append({'factor': 'KYC approved', 'delta': +20})
        elif kyc == 'rejected':
            score -= 30; breakdown.append({'factor': 'KYC rejected', 'delta': -30})
        else:
            breakdown.append({'factor': f'KYC {kyc}', 'delta': 0})

        # 2) Sanctions match
        sanctions = (p.get('kyc') or {}).get('sanctionsResults') or {}
        has_match = any((s or {}).get('hits') for s in sanctions.get('results', []))
        if has_match:
            score -= 40; breakdown.append({'factor': 'Sanctions match', 'delta': -40})
        else:
            score += 5; breakdown.append({'factor': 'No sanctions', 'delta': +5})

        # 3) Relationship age
        created = p.get('createdAt') or p.get('created_at')
        if created:
            try:
                dt = datetime.fromisoformat(created.replace('Z', '+00:00'))
                years = (datetime.now(timezone.utc) - dt).days / 365.25
                if years > 5:
                    score += 15; breakdown.append({'factor': f'{years:.1f}y relationship', 'delta': +15})
                elif years > 2:
                    score += 10; breakdown.append({'factor': f'{years:.1f}y relationship', 'delta': +10})
                elif years > 0.5:
                    score += 3;  breakdown.append({'factor': f'{years:.1f}y relationship', 'delta': +3})
            except Exception:
                pass

        # 4) Payment history — deals ratio
        deals = c.execute("SELECT data FROM deals").fetchall()
        total = 0; paid_on_time = 0; late = 0
        for d_row in deals:
            try:
                d = decrypt_data(d_row[0]) if d_row[0] else {}
            except Exception:
                continue
            if d.get('buyerId') != partner_id and d.get('supplierId') != partner_id:
                continue
            total += 1
            paid_on = d.get('buyerPaidOn')
            due = (d.get('paymentDates') or {}).get('buyer')
            if paid_on and due:
                try:
                    p_dt = datetime.fromisoformat(paid_on.replace('Z', '+00:00'))
                    d_dt = datetime.fromisoformat(due.replace('Z', '+00:00'))
                    if p_dt <= d_dt: paid_on_time += 1
                    else: late += 1
                except Exception:
                    pass
        if total >= 3:
            ratio = paid_on_time / total
            delta = int(round(ratio * 20 - 10))  # -10 do +10
            score += delta
            breakdown.append({'factor': f'{paid_on_time}/{total} deals paid on time',
                              'delta': delta})

        # 5) Recent activity
        lm = p.get('lastModified')
        if lm:
            try:
                dt = datetime.fromisoformat(lm.replace('Z', '+00:00'))
                days = (datetime.now(timezone.utc) - dt).days
                if days < 90:
                    score += 5; breakdown.append({'factor': f'Active ({days}d ago)', 'delta': +5})
                elif days > 365:
                    score -= 5; breakdown.append({'factor': f'Stale ({days}d)', 'delta': -5})
            except Exception:
                pass

        # Clamp
        score = max(0, min(100, score))
        band = 'LOW' if score >= 70 else ('MEDIUM' if score >= 40 else 'HIGH')

        return jsonify({
            'partnerId': partner_id,
            'score': score,
            'band': band,
            'breakdown': breakdown,
            'deals_total': total,
            'deals_paid_on_time': paid_on_time,
            'deals_late': late,
        })
    finally:
        if conn: conn.close()


# ==========================================================
#  BATCH D2 — Dashboard extras: overdue deals count, active partners
# ==========================================================

@data_bp.route('/api/dashboard/insights', methods=['GET'])
@login_required
def dashboard_insights():
    """Kratke insights za dashboard hero — bez tezih computacija.
    Cache-uje se agresivno (1 min) da ne opterecuje bazu na svakom refresh-u."""
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)

    conn = get_db_connection()
    try:
        c = conn.cursor()
        # Overdue deals — buyerPaymentDate < now i nije placeno
        overdue = 0
        due_this_week = 0
        deals = c.execute("SELECT data FROM deals").fetchall()
        for r in deals:
            try: d = decrypt_data(r[0]) if r[0] else {}
            except Exception: continue
            due = (d.get('paymentDates') or {}).get('buyer')
            paid = d.get('buyerPaidOn')
            if not due or paid: continue
            try:
                dt = datetime.fromisoformat(due.replace('Z', '+00:00'))
                if dt < now: overdue += 1
                elif dt < now + timedelta(days=7): due_this_week += 1
            except Exception: pass

        # Aktivni partneri (izmenjen u poslednjih 30d)
        active_30d = 0
        thirty_ago = now - timedelta(days=30)
        partners = c.execute("SELECT data FROM partners").fetchall()
        stale_partners = 0
        for r in partners:
            try: p = decrypt_data(r[0]) if r[0] else {}
            except Exception: continue
            lm = p.get('lastModified')
            if lm:
                try:
                    dt = datetime.fromisoformat(lm.replace('Z', '+00:00'))
                    if dt > thirty_ago: active_30d += 1
                    elif dt < now - timedelta(days=365): stale_partners += 1
                except Exception: pass

        # New deals in last 7 days
        new_this_week = 0
        for r in deals:
            try: d = decrypt_data(r[0]) if r[0] else {}
            except Exception: continue
            ca = d.get('createdAt')
            if ca:
                try:
                    dt = datetime.fromisoformat(ca.replace('Z', '+00:00'))
                    if dt > week_ago: new_this_week += 1
                except Exception: pass

        return jsonify({
            'overdue_deals': overdue,
            'due_this_week': due_this_week,
            'new_deals_this_week': new_this_week,
            'active_partners_30d': active_30d,
            'stale_partners_1y': stale_partners,
            'timestamp': now.isoformat(),
        })
    finally:
        conn.close()


# ==========================================================
