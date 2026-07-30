"""
utils_ocr.py — tekst ekstrakcija iz PDF/slika (uploadovanih KYC fajlova).

Best-effort ekstrakcija tekstualnog sadrzaja iz:
  * PDF          → pdfminer.six (pure Python, uvek dostupan) → fallback pdftotext CLI
  * PNG / JPEG   → pytesseract (ako je tesseract instaliran) → prazno string
  * DOCX         → python-docx (opcion) → prazno

Cilj: admin moze da pretrazuje sadrzaj KYC uploada — ne pravimo image OCR
za produkciju obavezno, samo tekst tamo gde je izvucen.

Rezultat se cesuje u audit_log 'OCR' event-u i moze se pokazati u
document manageru kao "text preview".

Sve funkcije su bezbedne za pozvati bez instaliranih opcionih biblioteka
— vracaju prazan string umesto exception-a.
"""
from __future__ import annotations

import logging
import os
import re
import subprocess
from typing import Optional

logger = logging.getLogger(__name__)


def _pdf_text_pdfminer(path: str) -> str:
    """Pokusaj pdfminer.six — pure Python, requirements.txt-safe."""
    try:
        from pdfminer.high_level import extract_text
        text = extract_text(path) or ''
        return text.strip()
    except ImportError:
        return ''
    except Exception as e:
        logger.debug(f'pdfminer failed for {path}: {e}')
        return ''


def _pdf_text_cli(path: str) -> str:
    """Fallback: pokusaj pdftotext CLI (poppler-utils). Radi na Linux serveru."""
    try:
        r = subprocess.run(
            ['pdftotext', '-layout', '-nopgbrk', path, '-'],
            capture_output=True, timeout=15, check=False
        )
        if r.returncode == 0:
            return (r.stdout or b'').decode('utf-8', errors='replace').strip()
    except FileNotFoundError:
        # pdftotext nije instaliran — nije greska
        return ''
    except subprocess.TimeoutExpired:
        logger.debug(f'pdftotext timeout for {path}')
        return ''
    except Exception as e:
        logger.debug(f'pdftotext failed for {path}: {e}')
    return ''


def _image_text_tesseract(path: str) -> str:
    """OCR slika preko tesseract (ako je instaliran)."""
    try:
        import pytesseract
        from PIL import Image
        return pytesseract.image_to_string(Image.open(path)) or ''
    except ImportError:
        return ''
    except Exception as e:
        logger.debug(f'tesseract failed for {path}: {e}')
        return ''


def _docx_text(path: str) -> str:
    try:
        import docx
        d = docx.Document(path)
        return '\n'.join(p.text for p in d.paragraphs if p.text).strip()
    except ImportError:
        return ''
    except Exception as e:
        logger.debug(f'docx read failed for {path}: {e}')
        return ''


def extract_text(path: str, max_chars: int = 20000) -> str:
    """Vrati ekstrahovani tekst iz fajla. Za nepodrzane tipove — prazan string.
    Uvek radi bezbedno, nikad ne baca izuzetak. Rezultat je isecen na max_chars."""
    if not path or not os.path.exists(path):
        return ''
    ext = os.path.splitext(path)[1].lower().lstrip('.')

    text = ''
    if ext == 'pdf':
        text = _pdf_text_pdfminer(path) or _pdf_text_cli(path)
    elif ext in ('png', 'jpg', 'jpeg', 'webp', 'tiff', 'bmp'):
        text = _image_text_tesseract(path)
    elif ext in ('docx',):
        text = _docx_text(path)
    elif ext in ('txt', 'md', 'csv'):
        try:
            with open(path, 'r', encoding='utf-8', errors='replace') as f:
                text = f.read()
        except Exception:
            text = ''

    if not text:
        return ''
    # Normalizuj whitespace da bude korisno za search
    text = re.sub(r'\s+', ' ', text).strip()
    return text[:max_chars]


def summarize_text(text: str, max_len: int = 500) -> str:
    """Kratki 'preview' — prvih N znakova, oseca na granici reci."""
    if not text:
        return ''
    if len(text) <= max_len:
        return text
    trunc = text[:max_len].rsplit(' ', 1)[0]
    return trunc + '…'


def has_ocr_available() -> dict:
    """Diagnostikuj koji OCR back-endovi su dostupni na ovom serveru.
    Koristi ga admin health page da bi user znao sta radi."""
    result = {'pdfminer': False, 'pdftotext': False, 'tesseract': False, 'docx': False}
    try:
        import pdfminer  # noqa: F401
        result['pdfminer'] = True
    except ImportError:
        pass
    try:
        r = subprocess.run(['pdftotext', '-v'], capture_output=True, timeout=3, check=False)
        result['pdftotext'] = (r.returncode == 0) or (b'pdftotext' in (r.stderr or b''))
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    try:
        import pytesseract  # noqa: F401
        r = subprocess.run(['tesseract', '--version'], capture_output=True, timeout=3, check=False)
        result['tesseract'] = (r.returncode == 0) or (b'tesseract' in (r.stderr or b''))
    except (ImportError, FileNotFoundError, subprocess.TimeoutExpired):
        pass
    try:
        import docx  # noqa: F401
        result['docx'] = True
    except ImportError:
        pass
    return result
