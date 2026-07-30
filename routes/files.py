import os
import uuid
from flask import Blueprint, request, jsonify, send_from_directory, current_app
from werkzeug.utils import secure_filename
from utils import allowed_file, log_audit, login_required, is_safe_file_content

files_bp = Blueprint('files', __name__)

# TVRDA ZAŠTITA SERVERA: Apsolutni limit od 50MB po fajlu
MAX_FILE_SIZE = 50 * 1024 * 1024 

@files_bp.route('/api/upload', methods=['POST'])
@login_required
def upload_file():
    if request.content_length and request.content_length > MAX_FILE_SIZE:
        log_audit('SECURITY', 'files', 'Sprečen napad/upload ogromnog fajla.', is_suspicious=True)
        return jsonify({"error": "api.fileTooLarge"}), 413

    file = request.files.get('file')
    if not file or not allowed_file(file.filename):
        # Čistimo originalno ime čak i pri odbijanju kako bismo sprečili prljanje logova
        safe_original_name = secure_filename(file.filename) if file else "N/A"
        log_audit('SECURITY', 'files', f'Zabranjena ekstenzija fajla: {safe_original_name}', is_suspicious=True)
        return jsonify({"error": "api.invalidFileType"}), 400
        
    # DUBINSKA INSPEKCIJA
    if not is_safe_file_content(file, file.filename):
        safe_original_name = secure_filename(file.filename)
        log_audit('SECURITY', 'files', f'Blokiran skriveni malware u fajlu: {safe_original_name}', is_suspicious=True)
        return jsonify({"error": "api.invalidFileType"}), 400
        
    try:
        # Sigurno izvlačenje ekstenzije
        ext = secure_filename(file.filename).rsplit('.', 1)[-1].lower() if '.' in secure_filename(file.filename) else 'bin'
        unique_name = f"{uuid.uuid4().hex}.{ext}"
        save_path = os.path.join(current_app.config['UPLOAD_FOLDER'], unique_name)
        
        file.save(save_path)
        
        # Očišćeno originalno ime fajla za bezbedan upis u bazu logova
        safe_original_name = secure_filename(file.filename)
        log_audit('CREATE', 'files', f'Uploaded file: {unique_name} (Original: {safe_original_name})')
        
        return jsonify({"url": f"/uploads/{unique_name}"})
        
    except Exception as e:
        log_audit('ERROR', 'files', f'Greška pri upisu fajla: {str(e)}', is_suspicious=True)
        return jsonify({"error": "api.serverError"}), 500

@files_bp.route('/api/upload/<filename>', methods=['DELETE'])
@login_required
def delete_file(filename):
    safe_filename = secure_filename(filename)
    file_path = os.path.join(current_app.config['UPLOAD_FOLDER'], safe_filename)
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
            log_audit('DELETE', 'files', f'Deleted file: {safe_filename}')
            return jsonify({"status": "success"})
        return jsonify({"error": "api.fileNotFound"}), 404
    except Exception as e:
        log_audit('ERROR', 'files', f'Error deleting file {safe_filename}: {str(e)}')
        return jsonify({"error": "api.fileDeleteError"}), 500

@files_bp.route('/uploads/<filename>')
@login_required
def uploaded_file(filename):
    safe_filename = secure_filename(filename)
    try:
        log_audit('DOWNLOAD', 'files', f'Downloaded file: {safe_filename}')
        return send_from_directory(current_app.config['UPLOAD_FOLDER'], safe_filename)
    except Exception:
        return jsonify({"error": "api.fileNotFound"}), 404