"""Admin document manager — nabrajanje, brisanje i bulk ZIP download svih
fajlova u uploads/ i portal_uploads/. Cilj: admin ima jedno mesto da oslobodi
prostor kada je stari materijal nepotreban, i da vidi šta je gde upisano.

Rute su svesno registrovane pod /api/admin/documents/... jer je ovo isključivo
admin funkcionalnost — nema portal ili worker pristupa.
"""
import db
import io
import json
import os
import re
import sqlite3
import zipfile
from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify, request, send_file, session
from werkzeug.utils import secure_filename

from config import DB_FILE, PORTAL_DB_FILE, UPLOAD_FOLDER, PORTAL_UPLOAD_FOLDER
from utils import login_required, log_audit, decrypt_data

documents_bp = Blueprint('documents', __name__, url_prefix='/api/admin/documents')


def _admin_only():
    """Vraća None ako je pristup dozvoljen, ili (response, code) tuple ako nije.
    Documents admin je striktno admin — nema fine-grained permisija za deo brisanja
    fajlova, to je operacija visokog rizika."""
    if 'user_id' not in session:
        return jsonify({"error": "UNAUTHORIZED"}), 401
    if session.get('role') != 'admin':
        log_audit('SECURITY', 'documents',
                  f"Non-admin attempt to access documents admin API by user_id {session.get('user_id')}",
                  is_suspicious=True)
        return jsonify({"error": "ADMIN_ONLY"}), 403
    return None


def _sanitize_folder_name(name):
    """Pretvara ime firme / dokumenta u bezbedan folder segment za ZIP:
    - zameni sve što nije alfanumerik/point/dash/space sa '_'
    - collapse ponovljenih razmaka
    - trim
    - fallback na 'Unknown' za praznu stringu"""
    if not name:
        return 'Unknown'
    safe = re.sub(r'[^A-Za-z0-9._\- ]+', '_', str(name))
    safe = re.sub(r'_+', '_', safe).strip('_ .')
    return safe[:120] or 'Unknown'


def _all_partners_map():
    """Vraća {partner_id: {companyName, contact_email}}."""
    out = {}
    try:
        with db.connect_raw(DB_FILE) as conn:
            c = conn.cursor()
            c.execute("SELECT id, data FROM partners")
            for row in c.fetchall():
                pd = decrypt_data(row[1])
                if isinstance(pd, dict):
                    out[row[0]] = {
                        'companyName': pd.get('companyName') or 'Unknown',
                        'email': (pd.get('contact') or {}).get('email') or pd.get('email') or ''
                    }
    except Exception:
        pass
    return out


def _find_partner_by_file_url(file_url, partners_map, kyc_url_index):
    """Za dati /portal_uploads/<name> ili /uploads/<name> URL, pronađi partnera
    kome fajl pripada. Traži kroz partner.kyc.files, partner.documents, i
    kyc_submissions.data.files kešu (kyc_url_index)."""
    if not file_url:
        return None
    # Check kyc_submissions index prvo (najčešće)
    if file_url in kyc_url_index:
        pid = kyc_url_index[file_url]
        info = partners_map.get(pid)
        if info:
            return pid, info
    # Prođi kroz partnere i vidi šta se nalazi u njihovom .kyc.files ili .documents
    try:
        with db.connect_raw(DB_FILE) as conn:
            c = conn.cursor()
            c.execute("SELECT id, data FROM partners")
            for row in c.fetchall():
                pd = decrypt_data(row[1])
                if not isinstance(pd, dict):
                    continue
                kyc = pd.get('kyc') or {}
                # Files direktno na kyc.files
                for key, val in (kyc.get('files') or {}).items():
                    if isinstance(val, list) and file_url in val:
                        return row[0], partners_map.get(row[0], {'companyName': 'Unknown', 'email': ''})
                    if isinstance(val, str) and val == file_url:
                        return row[0], partners_map.get(row[0], {'companyName': 'Unknown', 'email': ''})
                # Files na directors/ubos (po osobi)
                for person in (kyc.get('directors') or []) + (kyc.get('ubos') or []):
                    if isinstance(person, dict):
                        for f in (person.get('files') or []):
                            if f == file_url:
                                return row[0], partners_map.get(row[0], {'companyName': 'Unknown', 'email': ''})
                # documents niz
                for d in (pd.get('documents') or []):
                    if isinstance(d, dict) and d.get('fileUrl') == file_url:
                        return row[0], partners_map.get(row[0], {'companyName': 'Unknown', 'email': ''})
                    if isinstance(d, str) and d == file_url:
                        return row[0], partners_map.get(row[0], {'companyName': 'Unknown', 'email': ''})
    except Exception:
        pass
    return None


def _build_kyc_url_index():
    """Pre-scan kyc_submissions i vrati mapu url→partner_id kako bi lookup bio brz."""
    index = {}
    try:
        with db.connect_raw(PORTAL_DB_FILE) as conn:
            c = conn.cursor()
            c.execute("SELECT partner_id, data FROM kyc_submissions")
            for pid, data in c.fetchall():
                d = decrypt_data(data)
                if not isinstance(d, dict):
                    continue
                for key, val in (d.get('files') or {}).items():
                    if isinstance(val, list):
                        for u in val:
                            if isinstance(u, str):
                                index[u] = pid
                    elif isinstance(val, str):
                        index[val] = pid
                for person in (d.get('directors') or []) + (d.get('ubos') or []):
                    if isinstance(person, dict):
                        for f in (person.get('files') or []):
                            if isinstance(f, str):
                                index[f] = pid
    except Exception:
        pass
    return index


def _classify_kind(name):
    """Klasifikuje po nazivu fajla u kategoriju za ZIP folder strukturu.
    Nije 100% precizno (nazivi imaju uuid), pa se koristi kao heuristika za
    prefikse; ozbiljno pouzdano bi bila mapping tabela u DB. Za sada uglavnom
    razdvaja PDF (dokument) od slika (skenovi)."""
    n = name.lower()
    ext = n.rsplit('.', 1)[-1] if '.' in n else ''
    if ext in ('pdf',):
        return 'PDFs'
    if ext in ('png', 'jpg', 'jpeg'):
        return 'Scans'
    if ext in ('csv', 'xls', 'xlsx'):
        return 'Spreadsheets'
    return 'Other'


def _list_files_meta(folder, folder_label):
    """Lista sve fajlove u folderu sa metadatima."""
    out = []
    if not os.path.isdir(folder):
        return out
    try:
        for name in os.listdir(folder):
            path = os.path.join(folder, name)
            if not os.path.isfile(path):
                continue
            st = os.stat(path)
            out.append({
                'name': name,
                'folder': folder_label,
                'size_bytes': st.st_size,
                'size_kb': round(st.st_size / 1024, 1),
                'modified_at': datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat().replace('+00:00', 'Z'),
                'url': f'/{folder_label}/{name}',
            })
    except Exception:
        pass
    return out


@documents_bp.route('/list', methods=['GET'])
@login_required
def list_documents():
    """Vraća sve fajlove iz uploads/ i portal_uploads/ sa metadatima:
    partner ID/name (ako se može utvrditi), veličina, poslednja izmena.
    Podržava query filtere:
      folder=uploads|portal_uploads|all
      partner_id=<id>
      search=<substring> (name)
    Response shape: { files: [...], stats: { total_bytes, total_count, ... } }
    """
    denied = _admin_only()
    if denied: return denied

    folder_filter = (request.args.get('folder') or 'all').lower()
    partner_filter = request.args.get('partner_id')
    search = (request.args.get('search') or '').lower().strip()

    files = []
    if folder_filter in ('all', 'uploads'):
        files.extend(_list_files_meta(UPLOAD_FOLDER, 'uploads'))
    if folder_filter in ('all', 'portal_uploads'):
        files.extend(_list_files_meta(PORTAL_UPLOAD_FOLDER, 'portal_uploads'))

    partners_map = _all_partners_map()
    kyc_url_index = _build_kyc_url_index()

    for f in files:
        owner = _find_partner_by_file_url(f['url'], partners_map, kyc_url_index)
        if owner:
            pid, pinfo = owner
            f['partner_id'] = pid
            f['partner_name'] = pinfo.get('companyName')
            f['partner_email'] = pinfo.get('email', '')
        else:
            f['partner_id'] = None
            f['partner_name'] = None
            f['partner_email'] = ''
        f['kind'] = _classify_kind(f['name'])

    # Filteri
    if partner_filter:
        files = [f for f in files if f.get('partner_id') == partner_filter]
    if search:
        files = [f for f in files if search in f['name'].lower()
                 or (f.get('partner_name') and search in f['partner_name'].lower())]

    # Statistika
    total_bytes = sum(f['size_bytes'] for f in files)
    total_count = len(files)
    by_partner = {}
    for f in files:
        key = f.get('partner_name') or 'Unassigned'
        by_partner.setdefault(key, {'count': 0, 'bytes': 0})
        by_partner[key]['count'] += 1
        by_partner[key]['bytes'] += f['size_bytes']

    # Sortiraj: najnoviji prvi
    files.sort(key=lambda x: x['modified_at'], reverse=True)

    return jsonify({
        'files': files,
        'stats': {
            'total_count': total_count,
            'total_bytes': total_bytes,
            'total_mb': round(total_bytes / 1024 / 1024, 2),
            'by_partner': [{'partner': k, **v} for k, v in
                           sorted(by_partner.items(), key=lambda x: -x[1]['bytes'])[:20]],
        }
    })


@documents_bp.route('/delete', methods=['POST'])
@login_required
def delete_documents():
    """Brisanje jednog ili više fajlova. Payload:
      { files: [ { folder: 'uploads'|'portal_uploads', name: 'doc_xyz.pdf' }, ... ] }
    Vraća broj obrisanih. Log-uje se svaki uspešan delete."""
    denied = _admin_only()
    if denied: return denied

    payload = request.get_json(silent=True) or {}
    items = payload.get('files') or []
    if not isinstance(items, list):
        return jsonify({"error": "INVALID_PAYLOAD"}), 400

    deleted = 0
    errors = []
    for item in items[:200]:   # gornja granica — anti-DoS
        if not isinstance(item, dict):
            continue
        folder = item.get('folder')
        name = secure_filename(item.get('name') or '')
        if not name:
            errors.append(f"skip empty name")
            continue
        if folder == 'uploads':
            base = UPLOAD_FOLDER
        elif folder == 'portal_uploads':
            base = PORTAL_UPLOAD_FOLDER
        else:
            errors.append(f"unknown folder for {name}")
            continue
        path = os.path.join(base, name)
        # Sanity: put mora ostati unutar base foldera (path traversal guard)
        if not os.path.abspath(path).startswith(os.path.abspath(base)):
            errors.append(f"path escape blocked: {name}")
            log_audit('SECURITY', 'documents',
                      f"Blocked path traversal in delete: {folder}/{name}", is_suspicious=True)
            continue
        try:
            if os.path.isfile(path):
                os.remove(path)
                deleted += 1
                log_audit('DELETE', 'documents',
                          f"Admin deleted {folder}/{name} ({session.get('username', 'admin')})",
                          is_suspicious=False)
            else:
                errors.append(f"not found: {name}")
        except Exception as e:
            errors.append(f"{name}: {e}")

    return jsonify({
        'status': 'success',
        'deleted_count': deleted,
        'errors': errors,
    })


@documents_bp.route('/bulk_zip', methods=['GET'])
@login_required
def bulk_zip():
    """Kreira ZIP arhivu sa svim (ili filtriranim) fajlovima organizovanim po
    strukturi: <Partner Name>/<kind>/<original_name>. Fajlovi koji nisu vezani
    ni za jednog partnera idu u 'Unassigned/'.

    Query filteri:
      folder, partner_id, search (isti kao /list)

    Streamuje ZIP u memoriji (BytesIO). Za instance sa puno GB, admin može da
    filtrira po partner_id kako ne bi eksplodirala RAM."""
    denied = _admin_only()
    if denied: return denied

    folder_filter = (request.args.get('folder') or 'all').lower()
    partner_filter = request.args.get('partner_id')
    search = (request.args.get('search') or '').lower().strip()

    files = []
    if folder_filter in ('all', 'uploads'):
        files.extend([(UPLOAD_FOLDER, f) for f in _list_files_meta(UPLOAD_FOLDER, 'uploads')])
    if folder_filter in ('all', 'portal_uploads'):
        files.extend([(PORTAL_UPLOAD_FOLDER, f) for f in _list_files_meta(PORTAL_UPLOAD_FOLDER, 'portal_uploads')])

    partners_map = _all_partners_map()
    kyc_url_index = _build_kyc_url_index()

    buf = io.BytesIO()
    added = 0
    with zipfile.ZipFile(buf, mode='w', compression=zipfile.ZIP_DEFLATED) as zf:
        for base_folder, meta in files:
            owner = _find_partner_by_file_url(meta['url'], partners_map, kyc_url_index)
            if partner_filter:
                if not owner or owner[0] != partner_filter:
                    continue
            if search and search not in meta['name'].lower() and (
                not owner or search not in owner[1]['companyName'].lower()):
                continue

            partner_folder = _sanitize_folder_name(owner[1]['companyName']) if owner else 'Unassigned'
            kind_folder = _classify_kind(meta['name'])
            arc_name = f"{partner_folder}/{kind_folder}/{meta['name']}"

            src_path = os.path.join(base_folder, meta['name'])
            if not os.path.isfile(src_path):
                continue
            try:
                zf.write(src_path, arcname=arc_name)
                added += 1
            except Exception:
                pass

    buf.seek(0)
    log_audit('DOWNLOAD', 'documents',
              f"Admin bulk ZIP download: {added} files "
              f"(filters: folder={folder_filter}, partner={partner_filter or 'all'})",
              is_suspicious=False)
    ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    return send_file(
        buf, mimetype='application/zip',
        as_attachment=True,
        download_name=f'aspidus-documents-{ts}.zip'
    )


# ==========================================================
#  OCR / TEXT PREVIEW (v22.4)
# ==========================================================

@documents_bp.route('/api/documents/text-preview', methods=['GET'])
@login_required
def document_text_preview():
    """Vrati text_preview za dati file_url (query param `url`)."""
    file_url = (request.args.get('url') or '').strip()
    if not file_url:
        return jsonify({'error': 'url_required'}), 400
    from config import DB_FILE
    try:
        with db.connect_raw(DB_FILE) as conn:
            row = conn.execute(
                "SELECT text_preview, char_count, extracted_at, partner_id "
                "FROM file_text WHERE file_url=?",
                (file_url,)
            ).fetchone()
    except sqlite3.OperationalError as e:
        return jsonify({'error': str(e)[:200]}), 500
    if not row:
        return jsonify({'preview': None, 'available': False,
                        'hint': 'OCR nije jos izvrsen ili tip fajla nije podrzan.'})
    return jsonify({
        'preview': row[0], 'char_count': row[1] or 0,
        'extracted_at': row[2], 'partner_id': row[3],
        'available': True
    })


@documents_bp.route('/api/documents/search', methods=['GET'])
@login_required
def document_search():
    """Full-text pretraga kroz OCR-ovane dokumente.
    Query param `q` — string za pretragu (case-insensitive).
    Vraca do 50 fajlova sa matchujuci partner_id + preview."""
    q = (request.args.get('q') or '').strip()
    if len(q) < 3:
        return jsonify({'error': 'query_too_short',
                        'hint': 'Minimalna duzina: 3 karaktera.'}), 400
    from config import DB_FILE
    try:
        with db.connect_raw(DB_FILE) as conn:
            rows = conn.execute(
                "SELECT file_url, partner_id, filename, text_preview, extracted_at "
                "FROM file_text WHERE full_text LIKE ? COLLATE NOCASE "
                "ORDER BY extracted_at DESC LIMIT 50",
                (f'%{q}%',)
            ).fetchall()
    except sqlite3.OperationalError as e:
        return jsonify({'error': str(e)[:200]}), 500
    return jsonify({
        'query': q, 'total': len(rows),
        'results': [{
            'file_url': r[0], 'partner_id': r[1], 'filename': r[2],
            'preview': r[3], 'extracted_at': r[4]
        } for r in rows]
    })
