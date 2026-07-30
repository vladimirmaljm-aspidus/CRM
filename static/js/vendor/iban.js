// static/js/vendor/iban.js
// Lightweight IBAN validator + formatter — no dependencies.
// Implements ISO 13616-1 mod-97 check with the official per-country length map
// covering all countries currently in SEPA + non-SEPA IBAN registry (2024).
// Based on IBAN Registry rel. 96 (SWIFT, Feb 2024).

(function () {
    'use strict';

    // Country → { length, structure regex (skipping the CC+CD prefix) }
    // Structure follows IBAN Registry BBAN pattern; we validate length + pattern
    // and finally mod-97 = 1. Total length column stated per registry.
    const IBAN_SPEC = {
        'AD': {len: 24, bban: /^\d{8}[A-Z0-9]{12}$/},
        'AE': {len: 23, bban: /^\d{3}\d{16}$/},
        'AL': {len: 28, bban: /^\d{8}[A-Z0-9]{16}$/},
        'AT': {len: 20, bban: /^\d{5}\d{11}$/},
        'AZ': {len: 28, bban: /^[A-Z]{4}[A-Z0-9]{20}$/},
        'BA': {len: 20, bban: /^\d{6}\d{10}$/},
        'BE': {len: 16, bban: /^\d{3}\d{7}\d{2}$/},
        'BG': {len: 22, bban: /^[A-Z]{4}\d{4}\d{2}[A-Z0-9]{8}$/},
        'BH': {len: 22, bban: /^[A-Z]{4}[A-Z0-9]{14}$/},
        'BR': {len: 29, bban: /^\d{8}\d{5}\d{10}[A-Z]{1}[A-Z0-9]{1}$/},
        'BY': {len: 28, bban: /^[A-Z0-9]{4}\d{4}[A-Z0-9]{16}$/},
        'CH': {len: 21, bban: /^\d{5}[A-Z0-9]{12}$/},
        'CR': {len: 22, bban: /^\d{4}\d{14}$/},
        'CY': {len: 28, bban: /^\d{3}\d{5}[A-Z0-9]{16}$/},
        'CZ': {len: 24, bban: /^\d{4}\d{6}\d{10}$/},
        'DE': {len: 22, bban: /^\d{8}\d{10}$/},
        'DK': {len: 18, bban: /^\d{4}\d{9}\d{1}$/},
        'DO': {len: 28, bban: /^[A-Z0-9]{4}\d{20}$/},
        'EE': {len: 20, bban: /^\d{2}\d{2}\d{11}\d{1}$/},
        'EG': {len: 29, bban: /^\d{4}\d{4}\d{17}$/},
        'ES': {len: 24, bban: /^\d{4}\d{4}\d{1}\d{1}\d{10}$/},
        'FI': {len: 18, bban: /^\d{6}\d{7}\d{1}$/},
        'FO': {len: 18, bban: /^\d{4}\d{9}\d{1}$/},
        'FR': {len: 27, bban: /^\d{5}\d{5}[A-Z0-9]{11}\d{2}$/},
        'GB': {len: 22, bban: /^[A-Z]{4}\d{6}\d{8}$/},
        'GE': {len: 22, bban: /^[A-Z]{2}\d{16}$/},
        'GI': {len: 23, bban: /^[A-Z]{4}[A-Z0-9]{15}$/},
        'GL': {len: 18, bban: /^\d{4}\d{9}\d{1}$/},
        'GR': {len: 27, bban: /^\d{3}\d{4}[A-Z0-9]{16}$/},
        'GT': {len: 28, bban: /^[A-Z0-9]{4}[A-Z0-9]{20}$/},
        'HR': {len: 21, bban: /^\d{7}\d{10}$/},
        'HU': {len: 28, bban: /^\d{3}\d{4}\d{1}\d{15}\d{1}$/},
        'IE': {len: 22, bban: /^[A-Z]{4}\d{6}\d{8}$/},
        'IL': {len: 23, bban: /^\d{3}\d{3}\d{13}$/},
        'IQ': {len: 23, bban: /^[A-Z]{4}\d{3}\d{12}$/},
        'IS': {len: 26, bban: /^\d{4}\d{2}\d{6}\d{10}$/},
        'IT': {len: 27, bban: /^[A-Z]{1}\d{5}\d{5}[A-Z0-9]{12}$/},
        'JO': {len: 30, bban: /^[A-Z]{4}\d{4}[A-Z0-9]{18}$/},
        'KW': {len: 30, bban: /^[A-Z]{4}[A-Z0-9]{22}$/},
        'KZ': {len: 20, bban: /^\d{3}[A-Z0-9]{13}$/},
        'LB': {len: 28, bban: /^\d{4}[A-Z0-9]{20}$/},
        'LC': {len: 32, bban: /^[A-Z]{4}[A-Z0-9]{24}$/},
        'LI': {len: 21, bban: /^\d{5}[A-Z0-9]{12}$/},
        'LT': {len: 20, bban: /^\d{5}\d{11}$/},
        'LU': {len: 20, bban: /^\d{3}[A-Z0-9]{13}$/},
        'LV': {len: 21, bban: /^[A-Z]{4}[A-Z0-9]{13}$/},
        'MC': {len: 27, bban: /^\d{5}\d{5}[A-Z0-9]{11}\d{2}$/},
        'MD': {len: 24, bban: /^[A-Z0-9]{2}[A-Z0-9]{18}$/},
        'ME': {len: 22, bban: /^\d{3}\d{13}\d{2}$/},
        'MK': {len: 19, bban: /^\d{3}[A-Z0-9]{10}\d{2}$/},
        'MR': {len: 27, bban: /^\d{5}\d{5}\d{11}\d{2}$/},
        'MT': {len: 31, bban: /^[A-Z]{4}\d{5}[A-Z0-9]{18}$/},
        'MU': {len: 30, bban: /^[A-Z]{4}\d{2}\d{2}\d{12}\d{3}[A-Z]{3}$/},
        'NL': {len: 18, bban: /^[A-Z]{4}\d{10}$/},
        'NO': {len: 15, bban: /^\d{4}\d{6}\d{1}$/},
        'PK': {len: 24, bban: /^[A-Z]{4}[A-Z0-9]{16}$/},
        'PL': {len: 28, bban: /^\d{8}\d{16}$/},
        'PS': {len: 29, bban: /^[A-Z]{4}[A-Z0-9]{21}$/},
        'PT': {len: 25, bban: /^\d{4}\d{4}\d{11}\d{2}$/},
        'QA': {len: 29, bban: /^[A-Z]{4}[A-Z0-9]{21}$/},
        'RO': {len: 24, bban: /^[A-Z]{4}[A-Z0-9]{16}$/},
        'RS': {len: 22, bban: /^\d{3}\d{13}\d{2}$/},
        'SA': {len: 24, bban: /^\d{2}[A-Z0-9]{18}$/},
        'SC': {len: 31, bban: /^[A-Z]{4}\d{2}\d{2}\d{16}[A-Z]{3}$/},
        'SE': {len: 24, bban: /^\d{3}\d{16}\d{1}$/},
        'SI': {len: 19, bban: /^\d{5}\d{8}\d{2}$/},
        'SK': {len: 24, bban: /^\d{4}\d{6}\d{10}$/},
        'SM': {len: 27, bban: /^[A-Z]{1}\d{5}\d{5}[A-Z0-9]{12}$/},
        'ST': {len: 25, bban: /^\d{8}\d{11}\d{2}$/},
        'SV': {len: 28, bban: /^[A-Z]{4}\d{20}$/},
        'TL': {len: 23, bban: /^\d{3}\d{14}\d{2}$/},
        'TN': {len: 24, bban: /^\d{2}\d{3}\d{13}\d{2}$/},
        'TR': {len: 26, bban: /^\d{5}[A-Z0-9]{1}[A-Z0-9]{16}$/},
        'UA': {len: 29, bban: /^\d{6}[A-Z0-9]{19}$/},
        'VA': {len: 22, bban: /^\d{3}\d{15}$/},
        'VG': {len: 24, bban: /^[A-Z]{4}\d{16}$/},
        'XK': {len: 20, bban: /^\d{4}\d{10}\d{2}$/},
    };

    // Prevode slova iz IBAN-a u brojeve za mod-97 (A=10, B=11, ..., Z=35)
    function _lettersToDigits(str) {
        let out = '';
        for (let i = 0; i < str.length; i++) {
            const ch = str.charAt(i);
            const code = ch.charCodeAt(0);
            if (code >= 65 && code <= 90) { // A-Z
                out += (code - 55).toString();
            } else {
                out += ch;
            }
        }
        return out;
    }

    // Big-int mod-97 na string-u (nema BigInt zavisnost — chunkovima od 9 cifara)
    function _mod97(numericStr) {
        let rem = 0;
        for (let i = 0; i < numericStr.length; i += 7) {
            const chunk = String(rem) + numericStr.substr(i, 7);
            rem = parseInt(chunk, 10) % 97;
        }
        return rem;
    }

    function _clean(iban) {
        return String(iban || '').replace(/[\s-]/g, '').toUpperCase();
    }

    function isValid(iban) {
        const s = _clean(iban);
        if (!s || s.length < 15) return false;
        const country = s.slice(0, 2);
        const spec = IBAN_SPEC[country];
        if (!spec) return false;
        if (s.length !== spec.len) return false;
        const check = s.slice(2, 4);
        if (!/^\d{2}$/.test(check)) return false;
        const bban = s.slice(4);
        if (!spec.bban.test(bban)) return false;
        // Move CC+CD to end, translate letters, mod-97 == 1
        const rearranged = bban + s.slice(0, 4);
        const numeric = _lettersToDigits(rearranged);
        return _mod97(numeric) === 1;
    }

    // Formatiraj u grupe od 4 karaktera (BE68 5390 0754 7034)
    function format(iban) {
        const s = _clean(iban);
        return s.replace(/(.{4})/g, '$1 ').trim();
    }

    // Vrati opis validacije za UI feedback
    function validate(iban) {
        const s = _clean(iban);
        if (!s) return {valid: false, reason: 'empty', message: 'IBAN is empty'};
        if (s.length < 15) return {valid: false, reason: 'too_short', message: 'IBAN too short (min 15 chars)'};
        const country = s.slice(0, 2);
        const spec = IBAN_SPEC[country];
        if (!spec) return {valid: false, reason: 'unknown_country', message: `Country code "${country}" not in IBAN registry`};
        if (s.length !== spec.len) return {valid: false, reason: 'wrong_length', message: `${country} IBAN must be ${spec.len} chars (got ${s.length})`};
        const bban = s.slice(4);
        if (!spec.bban.test(bban)) return {valid: false, reason: 'bad_format', message: `${country} IBAN body format does not match ISO 13616 spec`};
        const rearranged = bban + s.slice(0, 4);
        const numeric = _lettersToDigits(rearranged);
        if (_mod97(numeric) !== 1) return {valid: false, reason: 'checksum', message: 'IBAN checksum invalid (mod-97 failed)'};
        return {valid: true, country, formatted: format(s), length: s.length};
    }

    // Vraća listu podržanih zemalja (za UI hint)
    function supportedCountries() {
        return Object.keys(IBAN_SPEC).sort();
    }

    const IBAN = { isValid, validate, format, supportedCountries };

    // ==========================================================
    // BIC / SWIFT validator (ISO 9362)
    // ==========================================================
    // Structure: BBBBCCLL[XXX]
    //   BBBB — 4 letters, bank code
    //   CC   — 2 letters, ISO 3166-1 alpha-2 country code
    //   LL   — 2 alnum, location code (letter1: city; letter2: connection type)
    //   XXX  — optional 3 alnum branch code (HQ = XXX; primary branch omitted)
    // Second char of location must NOT be '0' or '1' for reserved codes.
    // Valid lengths: 8 (no branch) or 11 (with branch).
    const _BIC_RE = /^([A-Z]{4})([A-Z]{2})([A-Z0-9]{2})([A-Z0-9]{3})?$/;

    function bicClean(bic) {
        return String(bic || '').replace(/\s|-/g, '').toUpperCase();
    }

    function bicIsValid(bic) {
        const s = bicClean(bic);
        return _BIC_RE.test(s);
    }

    function bicValidate(bic, expectedCountry) {
        const s = bicClean(bic);
        if (!s) return {valid: false, reason: 'empty', message: 'BIC/SWIFT is empty'};
        const m = _BIC_RE.exec(s);
        if (!m) {
            const len = s.length;
            if (len !== 8 && len !== 11) return {valid: false, reason: 'wrong_length', message: `BIC must be 8 or 11 chars (got ${len})`};
            return {valid: false, reason: 'bad_format', message: 'BIC pattern is: 4 bank letters + 2 country + 2 location [+3 branch]'};
        }
        const [_, bank, country, loc, branch] = m;
        // Ako je pozvano sa expectedCountry (npr. IBAN CC), proveri poklapanje
        if (expectedCountry && country !== String(expectedCountry).toUpperCase()) {
            return {valid: false, reason: 'country_mismatch',
                    country, expected: String(expectedCountry).toUpperCase(),
                    message: `BIC country (${country}) does not match IBAN country (${expectedCountry})`};
        }
        // Rezervni location codes '00' i '01' su neispravni
        if (loc.startsWith('0')) {
            return {valid: false, reason: 'reserved_location',
                    message: 'Location code cannot start with 0 (reserved)'};
        }
        // Test-only kod: drugi char lokacije '0' označava test okruženje
        const isTest = loc[1] === '0';
        return {
            valid: true,
            bank_code: bank,
            country_code: country,
            location_code: loc,
            branch_code: branch || 'XXX',
            length: s.length,
            is_test: isTest,
            is_hq: !branch,
            formatted: s.length === 11 ? `${bank} ${country} ${loc} ${branch}` : `${bank} ${country} ${loc}`,
        };
    }

    const BIC = { isValid: bicIsValid, validate: bicValidate, clean: bicClean };

    if (typeof window !== 'undefined') {
        window.IBAN = IBAN;
        window.BIC = BIC;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {IBAN, BIC};
    }
})();
