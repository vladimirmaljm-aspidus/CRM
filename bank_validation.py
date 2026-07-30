"""Server-side bank identifier validation — IBAN (ISO 13616) + BIC (ISO 9362).

Mirrors static/js/vendor/iban.js so any client-side bypass gets caught
on the server. If IBAN looks like an IBAN (2-letter prefix), it MUST
pass mod-97; otherwise treated as local account number (allowed with
warning). BIC always validated when provided.
"""
import re


# Per-country IBAN length + BBAN structure (SWIFT Registry rel. 96, 2024).
# Subset — 76 countries. Matches the JS-side spec.
_IBAN_SPEC = {
    'AD': (24, r'^\d{8}[A-Z0-9]{12}$'),  'AE': (23, r'^\d{3}\d{16}$'),
    'AL': (28, r'^\d{8}[A-Z0-9]{16}$'),  'AT': (20, r'^\d{5}\d{11}$'),
    'AZ': (28, r'^[A-Z]{4}[A-Z0-9]{20}$'), 'BA': (20, r'^\d{6}\d{10}$'),
    'BE': (16, r'^\d{3}\d{7}\d{2}$'),    'BG': (22, r'^[A-Z]{4}\d{4}\d{2}[A-Z0-9]{8}$'),
    'BH': (22, r'^[A-Z]{4}[A-Z0-9]{14}$'), 'BR': (29, r'^\d{8}\d{5}\d{10}[A-Z]{1}[A-Z0-9]{1}$'),
    'BY': (28, r'^[A-Z0-9]{4}\d{4}[A-Z0-9]{16}$'), 'CH': (21, r'^\d{5}[A-Z0-9]{12}$'),
    'CR': (22, r'^\d{4}\d{14}$'),        'CY': (28, r'^\d{3}\d{5}[A-Z0-9]{16}$'),
    'CZ': (24, r'^\d{4}\d{6}\d{10}$'),   'DE': (22, r'^\d{8}\d{10}$'),
    'DK': (18, r'^\d{4}\d{9}\d{1}$'),    'DO': (28, r'^[A-Z0-9]{4}\d{20}$'),
    'EE': (20, r'^\d{2}\d{2}\d{11}\d{1}$'), 'EG': (29, r'^\d{4}\d{4}\d{17}$'),
    'ES': (24, r'^\d{4}\d{4}\d{1}\d{1}\d{10}$'), 'FI': (18, r'^\d{6}\d{7}\d{1}$'),
    'FO': (18, r'^\d{4}\d{9}\d{1}$'),    'FR': (27, r'^\d{5}\d{5}[A-Z0-9]{11}\d{2}$'),
    'GB': (22, r'^[A-Z]{4}\d{6}\d{8}$'), 'GE': (22, r'^[A-Z]{2}\d{16}$'),
    'GI': (23, r'^[A-Z]{4}[A-Z0-9]{15}$'), 'GL': (18, r'^\d{4}\d{9}\d{1}$'),
    'GR': (27, r'^\d{3}\d{4}[A-Z0-9]{16}$'), 'GT': (28, r'^[A-Z0-9]{4}[A-Z0-9]{20}$'),
    'HR': (21, r'^\d{7}\d{10}$'),        'HU': (28, r'^\d{3}\d{4}\d{1}\d{15}\d{1}$'),
    'IE': (22, r'^[A-Z]{4}\d{6}\d{8}$'), 'IL': (23, r'^\d{3}\d{3}\d{13}$'),
    'IQ': (23, r'^[A-Z]{4}\d{3}\d{12}$'), 'IS': (26, r'^\d{4}\d{2}\d{6}\d{10}$'),
    'IT': (27, r'^[A-Z]{1}\d{5}\d{5}[A-Z0-9]{12}$'), 'JO': (30, r'^[A-Z]{4}\d{4}[A-Z0-9]{18}$'),
    'KW': (30, r'^[A-Z]{4}[A-Z0-9]{22}$'), 'KZ': (20, r'^\d{3}[A-Z0-9]{13}$'),
    'LB': (28, r'^\d{4}[A-Z0-9]{20}$'),  'LC': (32, r'^[A-Z]{4}[A-Z0-9]{24}$'),
    'LI': (21, r'^\d{5}[A-Z0-9]{12}$'),  'LT': (20, r'^\d{5}\d{11}$'),
    'LU': (20, r'^\d{3}[A-Z0-9]{13}$'),  'LV': (21, r'^[A-Z]{4}[A-Z0-9]{13}$'),
    'MC': (27, r'^\d{5}\d{5}[A-Z0-9]{11}\d{2}$'), 'MD': (24, r'^[A-Z0-9]{2}[A-Z0-9]{18}$'),
    'ME': (22, r'^\d{3}\d{13}\d{2}$'),   'MK': (19, r'^\d{3}[A-Z0-9]{10}\d{2}$'),
    'MR': (27, r'^\d{5}\d{5}\d{11}\d{2}$'), 'MT': (31, r'^[A-Z]{4}\d{5}[A-Z0-9]{18}$'),
    'MU': (30, r'^[A-Z]{4}\d{2}\d{2}\d{12}\d{3}[A-Z]{3}$'), 'NL': (18, r'^[A-Z]{4}\d{10}$'),
    'NO': (15, r'^\d{4}\d{6}\d{1}$'),    'PK': (24, r'^[A-Z]{4}[A-Z0-9]{16}$'),
    'PL': (28, r'^\d{8}\d{16}$'),        'PS': (29, r'^[A-Z]{4}[A-Z0-9]{21}$'),
    'PT': (25, r'^\d{4}\d{4}\d{11}\d{2}$'), 'QA': (29, r'^[A-Z]{4}[A-Z0-9]{21}$'),
    'RO': (24, r'^[A-Z]{4}[A-Z0-9]{16}$'), 'RS': (22, r'^\d{3}\d{13}\d{2}$'),
    'SA': (24, r'^\d{2}[A-Z0-9]{18}$'),  'SC': (31, r'^[A-Z]{4}\d{2}\d{2}\d{16}[A-Z]{3}$'),
    'SE': (24, r'^\d{3}\d{16}\d{1}$'),   'SI': (19, r'^\d{5}\d{8}\d{2}$'),
    'SK': (24, r'^\d{4}\d{6}\d{10}$'),   'SM': (27, r'^[A-Z]{1}\d{5}\d{5}[A-Z0-9]{12}$'),
    'ST': (25, r'^\d{8}\d{11}\d{2}$'),   'SV': (28, r'^[A-Z]{4}\d{20}$'),
    'TL': (23, r'^\d{3}\d{14}\d{2}$'),   'TN': (24, r'^\d{2}\d{3}\d{13}\d{2}$'),
    'TR': (26, r'^\d{5}[A-Z0-9]{1}[A-Z0-9]{16}$'), 'UA': (29, r'^\d{6}[A-Z0-9]{19}$'),
    'VA': (22, r'^\d{3}\d{15}$'),        'VG': (24, r'^[A-Z]{4}\d{16}$'),
    'XK': (20, r'^\d{4}\d{10}\d{2}$'),
}


def _clean(iban):
    return re.sub(r'[\s-]', '', str(iban or '')).upper()


def _letters_to_digits(s):
    out = []
    for ch in s:
        c = ord(ch)
        if 65 <= c <= 90:
            out.append(str(c - 55))
        else:
            out.append(ch)
    return ''.join(out)


def _mod97(num_str):
    rem = 0
    for i in range(0, len(num_str), 7):
        rem = int(str(rem) + num_str[i:i+7]) % 97
    return rem


def validate_iban(iban):
    """Vraća {valid: bool, reason?, message?, country?}. Ne baca izuzetak."""
    s = _clean(iban)
    if not s:
        return {'valid': False, 'reason': 'empty', 'message': 'IBAN is empty'}
    if len(s) < 15:
        return {'valid': False, 'reason': 'too_short', 'message': f'IBAN too short ({len(s)})'}
    cc = s[:2]
    spec = _IBAN_SPEC.get(cc)
    if not spec:
        # Nepoznata zemlja u registru — vraćamo failure; poziv mesto zna da to
        # znači "nije IBAN format" (npr. lokalni broj računa).
        return {'valid': False, 'reason': 'unknown_country',
                'message': f'Country {cc} not in IBAN registry', 'country': cc}
    length, pattern = spec
    if len(s) != length:
        return {'valid': False, 'reason': 'wrong_length', 'country': cc,
                'message': f'{cc} IBAN must be {length} chars (got {len(s)})'}
    bban = s[4:]
    if not re.match(pattern, bban):
        return {'valid': False, 'reason': 'bad_format', 'country': cc,
                'message': f'{cc} IBAN body format invalid'}
    rearranged = bban + s[:4]
    if _mod97(_letters_to_digits(rearranged)) != 1:
        return {'valid': False, 'reason': 'checksum', 'country': cc,
                'message': 'IBAN checksum failed (mod-97)'}
    return {'valid': True, 'country': cc, 'formatted': ' '.join([s[i:i+4] for i in range(0, len(s), 4)])}


_BIC_RE = re.compile(r'^([A-Z]{4})([A-Z]{2})([A-Z0-9]{2})([A-Z0-9]{3})?$')


def validate_bic(bic, expected_country=None):
    """ISO 9362 BIC/SWIFT. Vraća {valid, reason?, message?, country?}."""
    s = re.sub(r'[\s-]', '', str(bic or '')).upper()
    if not s:
        return {'valid': False, 'reason': 'empty', 'message': 'BIC is empty'}
    if len(s) not in (8, 11):
        return {'valid': False, 'reason': 'wrong_length',
                'message': f'BIC must be 8 or 11 chars (got {len(s)})'}
    m = _BIC_RE.match(s)
    if not m:
        return {'valid': False, 'reason': 'bad_format',
                'message': 'BIC pattern: 4 bank letters + 2 country + 2 location [+3 branch]'}
    bank, country, loc, branch = m.groups()
    if loc.startswith('0'):
        return {'valid': False, 'reason': 'reserved_location',
                'message': 'Location cannot start with 0 (reserved)'}
    if expected_country and country != str(expected_country).upper():
        return {'valid': False, 'reason': 'country_mismatch', 'country': country,
                'expected': str(expected_country).upper(),
                'message': f'BIC country {country} does not match IBAN country {expected_country}'}
    return {'valid': True, 'country': country, 'bank_code': bank,
            'location_code': loc, 'branch_code': branch or 'XXX'}


def validate_bank_pair(iban, bic):
    """Kombinovana provera IBAN + BIC + cross-check. Vraća prvi problem koji nađe.
    Prihvata lokalni broj računa (ne-IBAN prefix) — tada samo BIC provera radi."""
    iban_clean = _clean(iban)
    bic_clean = re.sub(r'[\s-]', '', str(bic or '')).upper()

    iban_ok = None
    if iban_clean and re.match(r'^[A-Z]{2}', iban_clean):
        r = validate_iban(iban_clean)
        if not r['valid']:
            return {'ok': False, 'field': 'iban', **r}
        iban_ok = r

    if bic_clean:
        expected = iban_clean[:2] if iban_ok else None
        r = validate_bic(bic_clean, expected)
        if not r['valid']:
            return {'ok': False, 'field': 'bic', **r}
    else:
        return {'ok': False, 'field': 'bic', 'reason': 'empty', 'message': 'BIC/SWIFT required'}

    return {'ok': True, 'iban': iban_ok, 'bic': validate_bic(bic_clean)}
