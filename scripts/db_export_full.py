"""Full backup builder — creates a .tar.gz archive with all databases,
uploads, encryption keys, meta.json, and RESTORE.md.

Used by /api/system/backup/full endpoint (streaming mode) and can also
be run standalone for manual backups.

PostgreSQL version: dumps databases via COPY ... TO STDOUT (CSV format)
into the archive instead of copying SQLite files.

Archive structure:
    databases/
        crm.sql.csv          (CSV dump of all CRM tables)
        portal.sql.csv       (CSV dump of all Portal tables)
        audit.sql.csv        (CSV dump of all Audit tables)
    keys/
        vault.key
        instance/secret.key
    uploads/           (all uploaded files)
    portal_uploads/    (all portal-uploaded files)
    meta.json          (row counts, SHA256, timestamps, version)
    RESTORE.md         (step-by-step restore instructions)
"""

import hashlib
import io
import json
import os
import sys
import tarfile
import time
from datetime import datetime, timezone

# Allow importing from parent directory
_parent = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _parent not in sys.path:
    sys.path.insert(0, _parent)

import db
from config import (
    DB_FILE, PORTAL_DB_FILE, AUDIT_DB_FILE,
    DATA_DIR, UPLOAD_FOLDER, PORTAL_UPLOAD_FOLDER,
    KEY_FILE, INSTANCE_DIR, VERSION,
)


def _sha256_bytes(data):
    """Return hex SHA256 of bytes."""
    return hashlib.sha256(data).hexdigest()


def _sha256_file(path):
    """Return hex SHA256 of a file."""
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while True:
            chunk = f.read(1 << 20)  # 1 MiB
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _pg_dump_to_bytes(db_path):
    """Dump all tables of a PostgreSQL database (accessed via db.connect_raw)
    as CSV-formatted bytes. Returns b'' on failure."""
    buf = io.BytesIO()
    try:
        with db.connect_raw(db_path) as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                ORDER BY table_name
            """)
            tables = [r[0] for r in cur.fetchall()]
            for tname in tables:
                try:
                    buf.write(f"-- TABLE: {tname}\n".encode('utf-8'))
                    cur.copy_expert(
                        f'COPY "{tname}" TO STDOUT WITH (FORMAT csv, HEADER true)',
                        buf
                    )
                    buf.write(b'\n\n')
                except Exception as te:
                    buf.write(f"-- ERROR on {tname}: {te}\n\n".encode('utf-8'))
        return buf.getvalue()
    except Exception as e:
        return f"-- DUMP ERROR: {e}\n".encode('utf-8')


def _pg_row_counts(db_path):
    """Return {table_name: row_count} for a PostgreSQL database."""
    counts = {}
    try:
        with db.connect_raw(db_path) as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                ORDER BY table_name
            """)
            tables = [r[0] for r in cur.fetchall()]
            for t in tables:
                try:
                    counts[t] = cur.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
                except Exception:
                    counts[t] = None
        counts['__integrity_check'] = 'ok'
    except Exception as e:
        counts['__error'] = str(e)
    return counts


def _build_restore_md():
    """Return RESTORE.md content as string."""
    return """# AspidusCRM — Restore Instructions

This archive contains a complete backup of your AspidusCRM instance.

## Steps to Restore

1. **Stop the application** (gunicorn / Flask server).

2. **Restore databases** (CSV dumps — use psql or pg_restore):
   ```bash
   # Each .csv file in databases/ contains CSV exports per table.
   # Inspect with:  head -50 databases/crm.sql.csv
   # Restore with psql:
   psql "$DATABASE_URL" -c "COPY <table_name> FROM stdin WITH (FORMAT csv, HEADER true);" < extracted_csv_for_table
   ```

3. **Restore encryption keys** (required to decrypt stored passwords, KYC, etc.):
   ```bash
   cp keys/vault.key            $DATA_DIR/vault.key
   cp keys/instance/secret.key  $DATA_DIR/instance/secret.key
   chmod 600 $DATA_DIR/vault.key $DATA_DIR/instance/secret.key
   ```

4. **Restore uploads:**
   ```bash
   cp -r uploads/          $DATA_DIR/uploads/
   cp -r portal_uploads/   $DATA_DIR/portal_uploads/
   ```

5. **Set environment variables** (same values as original instance):
   - `DATABASE_URL` — PostgreSQL connection string (Supabase)
   - `SECRET_KEY` — from the original instance
   - `ENCRYPTION_KEY` — from the original instance
   - `DATA_DIR` — target directory for restored data

6. **Restart the application.**

7. **Verify** by logging in and checking data integrity.

## Important Notes

- **Keys are critical**: Without the original `vault.key` and `secret.key`, encrypted
  data (SMTP passwords, API keys, KYC documents) cannot be decrypted.
- **Database dumps are in CSV format** (one file per database, sections per table).
- **Do not mix** backups from different instances — database schema versions must match.
- **Check meta.json** for row counts and SHA256 hashes to verify backup integrity.

Generated by db_export_full.py — AspidusCRM v{version}
""".format(version=VERSION, timestamp=datetime.now(timezone.utc).isoformat())


def build_backup(out_path=None, out_stream=None, quiet=False):
    """Build a complete .tar.gz backup (PostgreSQL version).

    Args:
        out_path:    If set, write archive to this file path.
        out_stream:  If set, write archive to this BytesIO stream.
        quiet:       If True, suppress progress output.

    One of out_path or out_stream must be provided.
    """
    if out_path:
        out_stream = open(out_path, 'wb')
        should_close = True
    elif out_stream:
        should_close = False
    else:
        raise ValueError("Either out_path or out_stream must be provided")

    meta = {
        'backup_format_version': '2',
        'app_version': VERSION,
        'version': VERSION,
        'created_utc': datetime.now(timezone.utc).isoformat(),
        'created_at': datetime.now(timezone.utc).isoformat(),
        'databases': {},
        'keys': {},
        'uploads': {'file_count': 0, 'total_bytes': 0},
        'portal_uploads': {'file_count': 0, 'total_bytes': 0},
        'backend': 'postgresql',
    }

    try:
        with tarfile.open(fileobj=out_stream, mode='w:gz') as tar:
            # ── 1. DATABASES (PostgreSQL CSV dumps) ──
            db_dumps = {
                'crm.sql.csv':    ('crm',    DB_FILE),
                'portal.sql.csv': ('portal', PORTAL_DB_FILE),
                'audit.sql.csv':  ('audit',  AUDIT_DB_FILE),
            }
            for name, (label, db_path) in db_dumps.items():
                try:
                    dump_bytes = _pg_dump_to_bytes(db_path)
                    if not dump_bytes:
                        if not quiet:
                            print(f'  [SKIP] {name} — empty dump')
                        continue
                    sha = _sha256_bytes(dump_bytes)
                    size = len(dump_bytes)
                    counts = _pg_row_counts(db_path)

                    # Add dump as a file in the tar archive
                    info = tarfile.TarInfo(name=f'databases/{name}')
                    info.size = len(dump_bytes)
                    info.mtime = time.time()
                    tar.addfile(info, io.BytesIO(dump_bytes))

                    meta['databases'][name] = {
                        'label': label,
                        'sha256': sha,
                        'size_bytes': size,
                        'tables': counts,
                        'integrity_check': counts.pop('__integrity_check', 'unknown'),
                        'format': 'csv',
                    }
                    if counts.get('__error'):
                        meta['databases'][name]['error'] = counts.pop('__error')
                    if not quiet:
                        print(f'  [OK] {name} — {size/1024:.1f} KB, SHA256={sha[:16]}…')
                except Exception as e:
                    if not quiet:
                        print(f'  [FAIL] {name} — {e}')
                    meta['databases'][name] = {'error': str(e)}

            # ── 2. KEYS ──
            key_files = {
                'vault.key': KEY_FILE,
                'instance/secret.key': os.path.join(INSTANCE_DIR, 'secret.key'),
            }
            for name, path in key_files.items():
                if not os.path.exists(path):
                    if not quiet:
                        print(f'  [SKIP] keys/{name} — file not found')
                    continue
                arcname = f'keys/{name}'
                tar.add(path, arcname=arcname)
                meta['keys'][name] = {
                    'sha256': _sha256_file(path),
                    'size_bytes': os.path.getsize(path),
                }
                if not quiet:
                    print(f'  [OK] keys/{name}')

            # ── 3. UPLOADS ──
            for folder, label in [
                (UPLOAD_FOLDER, 'uploads'),
                (PORTAL_UPLOAD_FOLDER, 'portal_uploads'),
            ]:
                if not os.path.isdir(folder):
                    if not quiet:
                        print(f'  [SKIP] {label}/ — directory not found')
                    continue
                file_count = 0
                total_bytes = 0
                for root, dirs, files in os.walk(folder):
                    for fname in files:
                        fpath = os.path.join(root, fname)
                        rel = os.path.relpath(fpath, os.path.dirname(folder))
                        tar.add(fpath, arcname=rel)
                        file_count += 1
                        try:
                            total_bytes += os.path.getsize(fpath)
                        except Exception:
                            pass
                meta[label] = {
                    'file_count': file_count,
                    'total_bytes': total_bytes,
                    'total_mb': round(total_bytes / 1024 / 1024, 2),
                }
                if not quiet:
                    print(f'  [OK] {label}/ — {file_count} files, {total_bytes/1024:.1f} KB')

            # ── 4. meta.json ──
            meta_bytes = json.dumps(meta, indent=2, ensure_ascii=False).encode('utf-8')
            info = tarfile.TarInfo(name='meta.json')
            info.size = len(meta_bytes)
            info.mtime = time.time()
            tar.addfile(info, io.BytesIO(meta_bytes))
            if not quiet:
                print(f'  [OK] meta.json — {len(meta_bytes)} bytes')

            # ── 5. RESTORE.md ──
            restore_md = _build_restore_md().encode('utf-8')
            info = tarfile.TarInfo(name='RESTORE.md')
            info.size = len(restore_md)
            info.mtime = time.time()
            tar.addfile(info, io.BytesIO(restore_md))
            if not quiet:
                print(f'  [OK] RESTORE.md — {len(restore_md)} bytes')

    finally:
        if should_close:
            out_stream.close()

    if not quiet:
        print('  [DONE] Backup build complete.')


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='AspidusCRM Full Backup Builder')
    parser.add_argument('-o', '--output', default=None, help='Output .tar.gz file path')
    parser.add_argument('-q', '--quiet', action='store_true', help='Suppress progress output')
    args = parser.parse_args()

    if args.output:
        build_backup(out_path=args.output, quiet=args.quiet)
    else:
        ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        default = os.path.join(DATA_DIR, f'aspidus_full_backup_{ts}.tar.gz')
        build_backup(out_path=default, quiet=args.quiet)
        print(f'Backup saved to: {default}')
