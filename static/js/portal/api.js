// Aspidus B2B Portal — API calls and top-level flow

async function saveProductItem() {
    const nameEl = document.getElementById('form-product-name');
    const priceEl = document.getElementById('form-product-price');
    if (!nameEl.value || !priceEl.value) return showToast(t('err_product_required'), 'error');

    const fl = document.getElementById('full-loading'); if (fl) { fl.classList.remove('hidden'); fl.classList.add('flex'); }

    // Certificate uploads
    const fileEl = document.getElementById('form-product-certs');
    if (fileEl && fileEl.files.length > 0) {
        const fd = new FormData();
        for (let i = 0; i < fileEl.files.length; i++) fd.append('file', fileEl.files[i]);
        try {
            const uploadRes = await fetch(`/api/portal/upload/${TOKEN}`, { method: 'POST', headers: { 'X-Portal-Auth': authKey }, body: fd });
            const uploadData = await uploadRes.json();
            if (uploadRes.ok && uploadData.urls) uploadedCertUrls = uploadedCertUrls.concat(uploadData.urls);
        } catch (err) { /* silently */ }
    }

    const val = id => (document.getElementById(id)?.value || '').trim();
    const num = id => { const v = parseFloat(document.getElementById(id)?.value); return isNaN(v) ? null : v; };

    // Ownership: 'own' ili 'third_party'. Ako je third_party, obavezno source
    // company polja (server odbija SOURCE_COMPANY_REQUIRED bez name+taxId).
    const ownership = (document.querySelector('input[name="form-product-ownership"]:checked') || {}).value || 'own';
    let sourceCompany = null;
    if (ownership === 'third_party') {
        const sName = val('src-company-name');
        const sTax = val('src-company-taxid');
        if (!sName || !sTax) {
            if (fl) { fl.classList.add('hidden'); fl.classList.remove('flex'); }
            return showToast('Source company name and Tax ID are required for third-party goods.', 'error');
        }
        sourceCompany = {
            name: sName, taxId: sTax,
            relationship: val('src-company-relationship'),
            country: val('src-company-country'),
            city: val('src-company-city'),
            address: val('src-company-address'),
            website: val('src-company-website'),
            email: val('src-company-email'),
            phone: val('src-company-phone'),
            notes: val('src-company-notes')
        };
    }

    const payload = {
        id: document.getElementById('form-product-id').value || null,
        name: nameEl.value,
        category: val('form-product-category'),
        hsCode: val('form-product-hscode'),
        sku: val('form-product-sku'),
        brand: val('form-product-brand'),
        shortDescription: val('form-product-shortdesc'),
        detailedSpec: val('form-product-spec'),
        packaging: val('form-product-packaging'),
        packageWeight: num('form-product-package-weight'),
        unitsPerPallet: num('form-product-per-pallet'),
        availableStock: num('form-product-stock'),
        warehouseLocation: val('form-product-warehouse'),
        leadTime: val('form-product-leadtime'),
        logistics: {
            cap20: num('form-product-cap20'),
            cap40: num('form-product-cap40')
        },
        coaParams: activeCOAParams,
        ownership: ownership,
        sourceCompany: sourceCompany,
        supplyOffers: [{
            price: parseFloat(priceEl.value),
            currency: val('form-product-currency'),
            unit: val('form-product-unit'),
            moq: num('form-product-moq'),
            incoterm: val('form-product-incoterm'),
            country: val('form-product-origin'),
            validUntil: val('form-product-valid'),
            paymentTerms: val('form-product-payterms'),
            certificates: uploadedCertUrls.join(', ')
        }]
    };

    try {
        const res = await fetch(`/api/portal/products/submit/${TOKEN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Portal-Auth': authKey },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            showToast(t('msg_product_saved'), 'success');
            closeProductModal();
            loadPortalData();
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.error || t('err_generic'), 'error');
        }
    } catch (err) { showToast(t('err_network'), 'error'); }
    if (fl) { fl.classList.add('hidden'); fl.classList.remove('flex'); }
}

async function submitRFQ() {
    const prod = document.getElementById('rfq-product').value.trim();
    const qty = document.getElementById('rfq-qty').value;
    if (!prod || !qty) return showToast(t('err_rfq_required'), 'error');

    const payload = {
        productName: prod,
        quantity: qty,
        targetPrice: document.getElementById('rfq-price').value || null,
        notes: document.getElementById('rfq-notes').value || ""
    };

    const fl = document.getElementById('full-loading'); if (fl) { fl.classList.remove('hidden'); fl.classList.add('flex'); }
    try {
        const res = await fetch(`/api/portal/rfq/submit/${TOKEN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Portal-Auth': authKey },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            showToast(t('msg_rfq_sent'), 'success');
            closeRFQModal();
            loadPortalData();
        } else { showToast(t('err_generic'), 'error'); }
    } catch (e) { showToast(t('err_network'), 'error'); }
    if (fl) { fl.classList.add('hidden'); fl.classList.remove('flex'); }
}

// Profile change request (šalje adminu na odobrenje)
async function submitProfileChangeRequest() {
    const val = id => (document.getElementById(id)?.value || '').trim();
    const payload = {
        email: val('profile-email'),
        phone: val('profile-phone'),
        contactPerson: val('profile-person'),
        street: val('profile-street'),
        city: val('profile-city'),
        country: val('profile-country'),
        note: val('profile-note')
    };
    // Šalji samo polja koja klijent stvarno želi da promeni? — server će odbiti prazno
    const fl = document.getElementById('full-loading'); if (fl) { fl.classList.remove('hidden'); fl.classList.add('flex'); }
    try {
        const res = await fetch(`/api/portal/profile/update/${TOKEN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Portal-Auth': authKey },
            body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
            showToast(t('msg_profile_sent'), 'success');
            loadPortalData();
        } else {
            const map = {
                'INVALID_EMAIL_FORMAT': t('err_invalid_email'),
                'NO_CHANGES_PROVIDED': t('err_no_changes')
            };
            showToast(map[data.error] || data.error || t('err_generic'), 'error');
        }
    } catch (err) { showToast(t('err_network'), 'error'); }
    if (fl) { fl.classList.add('hidden'); fl.classList.remove('flex'); }
}

// Otvaranje dokumenta u portalu.
//
// Ranije: klik = trenutni download fajla. Sada: klik otvara preview modal sa
// PDF-om u iframe-u; korisnik može da PROČITA dokument pa tek onda odluči da
// li skida "hard copy" (Download dugme) ili štampa (Print). Preview endpoint
// koristi ?inline=1 pa server šalje Content-Disposition: inline umesto
// attachment, i (za ponude) regeneriše PDF u memoriji iz aktuelnih podataka
// bez pisanja na disk.
//
// Blob se drži u memoriji dok je modal otvoren i oslobađa se pri zatvaranju,
// tako da Print/Download koriste istu kopiju bez novog HTTP poziva.
let _previewBlobUrl = null;
let _previewFileName = null;
let _previewDocId = null;

async function downloadPortalDocument(docId) {
    if (!docId) return;
    try {
        const res = await fetch(`/api/portal/document/${TOKEN}/${encodeURIComponent(docId)}?inline=1`, {
            headers: { 'X-Portal-Auth': authKey }
        });
        if (!res.ok) {
            if (res.status === 404 || res.status === 410) return showToast(t('err_doc_not_found'), 'error');
            if (res.status === 403) return showToast(t('err_doc_forbidden'), 'error');
            return showToast(t('err_generic'), 'error');
        }
        const blob = await res.blob();
        const cd = res.headers.get('Content-Disposition') || '';
        const m = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
        _previewFileName = m ? decodeURIComponent(m[1].replace(/"$/, '')) : `document_${docId}.pdf`;
        _previewDocId = docId;
        if (_previewBlobUrl) { URL.revokeObjectURL(_previewBlobUrl); }
        _previewBlobUrl = URL.createObjectURL(blob);

        const iframe = document.getElementById('pdf-preview-frame');
        const title = document.getElementById('pdf-preview-title');
        if (title) title.textContent = _previewFileName;
        if (iframe) iframe.src = _previewBlobUrl;
        const modal = document.getElementById('pdf-preview-modal');
        modal.classList.remove('hidden'); modal.classList.add('flex');
    } catch (e) { showToast(t('err_network'), 'error'); }
}

window.closePdfPreview = function() {
    const modal = document.getElementById('pdf-preview-modal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
    const iframe = document.getElementById('pdf-preview-frame');
    if (iframe) iframe.src = 'about:blank';
    if (_previewBlobUrl) { URL.revokeObjectURL(_previewBlobUrl); _previewBlobUrl = null; }
    _previewFileName = null; _previewDocId = null;
};

// Print: reuse blob URL, ask iframe to trigger native print dialog.
// This works in all major browsers where the built-in PDF viewer is loaded
// into the iframe; if the browser is locked down it falls back to
// window.open() so the user can print via browser controls.
window.printPdfPreview = function() {
    const iframe = document.getElementById('pdf-preview-frame');
    if (!iframe || !iframe.contentWindow) return;
    try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
    } catch (e) {
        if (_previewBlobUrl) window.open(_previewBlobUrl, '_blank');
    }
};

// Download: trigger a new attachment fetch (proper Content-Disposition:
// attachment) so the browser Save dialog appears with the right filename.
// We do NOT reuse the inline blob because programmatic <a download="…">
// on some Safari builds ignores the download attribute for cross-origin
// blob URLs — a fresh attachment request is more portable.
window.downloadPdfPreview = async function() {
    if (!_previewDocId) return;
    try {
        const res = await fetch(`/api/portal/document/${TOKEN}/${encodeURIComponent(_previewDocId)}`, {
            headers: { 'X-Portal-Auth': authKey }
        });
        if (!res.ok) return showToast(t('err_generic'), 'error');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = _previewFileName || 'document.pdf';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        showToast(t('msg_download_logged'), 'success');
    } catch (e) { showToast(t('err_network'), 'error'); }
};

async function requestOTP() {
    const msg = document.getElementById('otp-status-msg');
    if (msg) { msg.textContent = t('requesting'); msg.classList.remove('hidden'); }
    try {
        const res = await fetch(`/api/portal/auth/send_otp/${TOKEN}`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            if (msg) msg.textContent = data.message || t('otp_sent');
            const oia = document.getElementById('otp-input-area'); if (oia) oia.classList.remove('hidden');
        } else {
            if (msg) msg.textContent = data.error || t('err_generic');
        }
    } catch (e) { if (msg) msg.textContent = t('err_network'); }
}

// Sinkronizuj 6-pojedinačnih polja u hidden #otp-code (portal.html direct login)
(function _wireOtpBoxes() {
    const boxes = () => Array.from(document.querySelectorAll('.otp-code-box'));
    document.addEventListener('input', (e) => {
        if (!e.target.classList.contains('otp-code-box')) return;
        const bs = boxes(); if (bs.length !== 6) return;
        const idx = parseInt(e.target.dataset.idx, 10);
        const v = e.target.value.replace(/\D/g, '');
        if (v.length > 1) {
            for (let i = 0; i < 6; i++) bs[i].value = v[i] || '';
            document.getElementById('otp-code').value = bs.map(b => b.value).join('');
            bs[Math.min(v.length, 5)].focus();
            if (v.length === 6) setTimeout(verifyOTP, 100);
            return;
        }
        e.target.value = v.slice(0, 1);
        document.getElementById('otp-code').value = bs.map(b => b.value).join('');
        if (v && idx < 5) bs[idx + 1].focus();
        if (idx === 5 && v && bs.every(b => b.value)) setTimeout(verifyOTP, 100);
    });
    document.addEventListener('keydown', (e) => {
        if (!e.target.classList.contains('otp-code-box')) return;
        const bs = boxes(); const idx = parseInt(e.target.dataset.idx, 10);
        if (e.key === 'Backspace' && !e.target.value && idx > 0) {
            bs[idx - 1].focus(); bs[idx - 1].value = '';
            document.getElementById('otp-code').value = bs.map(b => b.value).join('');
        }
        if (e.key === 'ArrowLeft' && idx > 0) bs[idx - 1].focus();
        if (e.key === 'ArrowRight' && idx < 5) bs[idx + 1].focus();
    });
    document.addEventListener('paste', (e) => {
        if (!e.target.classList.contains('otp-code-box')) return;
        e.preventDefault();
        const bs = boxes();
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
        for (let i = 0; i < 6; i++) bs[i].value = pasted[i] || '';
        document.getElementById('otp-code').value = bs.map(b => b.value).join('');
        bs[Math.min(pasted.length, 5)].focus();
        if (pasted.length === 6) setTimeout(verifyOTP, 100);
    });
})();

async function verifyOTP() {
    const code = document.getElementById('otp-code')?.value;
    if (!code || code.length !== 6) return showToast(t('enter_code'), 'error');
    // GPS je obavezan za standardne klijente. Za PREMIUM klijente, backend
    // dozvoljava prazan location — puštamo backend da odluči. Ne blokiramo
    // klijenta na strani browsera ako odbije lokaciju.
    let locData = '';
    try {
        locData = await new Promise((resolve, reject) => {
            if (!navigator.geolocation) return reject('nogeo');
            navigator.geolocation.getCurrentPosition(
                (pos) => resolve(`${pos.coords.latitude},${pos.coords.longitude}`),
                (err) => reject(err.code || 'err'),
                { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
            );
        });
    } catch (gpsErr) {
        // Nema GPS-a — probaj svejedno, backend će odbiti ako nije premium
        console.info('Portal verifyOTP: GPS denied, letting server decide (premium?)', gpsErr);
        locData = '';
    }
    try {
        const res = await fetch(`/api/portal/auth/verify_otp/${TOKEN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ otp: code, location: locData })
        });
        const data = await res.json();
        if (res.ok) {
            authKey = data.auth_key;
            sessionStorage.setItem(`portal_auth_${TOKEN}`, authKey);
            loadPortalData();
        } else if (data.error === 'LOCATION_REQUIRED') {
            showToast('Location access is required. Please allow precise location in your browser and try again.', 'error', 6000);
        } else {
            showToast(t('err_bad_otp'), 'error');
        }
    } catch (e) { showToast(t('err_network'), 'error'); }
}

// KYC form submit
const kycForm = document.getElementById('kyc-form');
if (kycForm) {
    kycForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fl = document.getElementById('full-loading'); if (fl) { fl.classList.remove('hidden'); fl.classList.add('flex'); }
        try {
            // Ekstrakcija ljudi (directors/UBOs). Za svakog uploaduje pripadajuće
            // fajlove (pasoš/ID skenove) preko portal upload endpointa i dodaje
            // vraćene URL-ove u person.files da bi admin video ko je koga uploadovao.
            const extractPersons = async (containerId) => {
                const arr = []; const cont = document.getElementById(containerId);
                if (!cont) return arr;
                const rows = cont.querySelectorAll('.person-entry');
                for (const row of rows) {
                    const n = row.querySelector('.p-name')?.value;
                    const p = row.querySelector('.p-pass')?.value;
                    const nt = row.querySelector('.p-nat')?.value;
                    if (!n || !p) continue;
                    const person = { name: n, passport: p, nationality: nt, files: [] };
                    const fileEl = row.querySelector('.p-files');
                    if (fileEl && fileEl.files && fileEl.files.length > 0) {
                        const fd = new FormData();
                        for (let i = 0; i < fileEl.files.length; i++) fd.append('file', fileEl.files[i]);
                        try {
                            const r = await fetch(`/api/portal/upload/${TOKEN}`, {
                                method: 'POST', headers: { 'X-Portal-Auth': authKey }, body: fd
                            });
                            if (r.ok) {
                                const d = await r.json();
                                if (d.urls && d.urls.length > 0) person.files = d.urls;
                            }
                        } catch (err) { console.error('per-person upload failed', err); }
                    }
                    arr.push(person);
                }
                return arr;
            };

            // Entity type: 'company' (default) ili 'individual'.
            // Individual mora imati priloženi utility bill (proof of address).
            const entityType = document.querySelector('input[name="kyc-entity-type"]:checked')?.value || 'company';
            if (entityType === 'individual') {
                const proof = document.getElementById('kyc-proof-address');
                if (!proof || proof.files.length === 0) {
                    if (fl) { fl.classList.add('hidden'); fl.classList.remove('flex'); }
                    return showToast('Please upload proof of home address (utility bill / bank statement).', 'error');
                }
            }

            // HARD BLOCK: IBAN + BIC — nikad ne dozvoli submit sa pogrešnim
            // bankarskim podacima. Bez ovoga bi klijentove KYC prijave dolazile
            // sa netačnim IBAN/SWIFT-om koji forenzičar (admin firme) mora ručno da traži.
            const _highlight = (id) => {
                const el = document.getElementById(id);
                if (el) {
                    el.scrollIntoView({behavior: 'smooth', block: 'center'});
                    el.style.borderColor = '#dc2626';
                    el.style.boxShadow = '0 0 0 3px rgba(220,38,38,.15)';
                    setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = ''; }, 3500);
                    el.focus();
                }
            };
            const ibanRaw = (document.getElementById('kyc-bank-iban')?.value || '').trim();
            const swiftRaw = (document.getElementById('kyc-bank-swift')?.value || '').trim();

            // PREMIUM izuzetak — sva polja su opciona i sve validacije se preskaču.
            // Klijent može čak i prazan KYC form da submit-uje. Admin obraduje offline.
            const _isPremium = !!portalData?.partner?.isPremium;
            if (_isPremium) {
                console.info('Portal KYC submit u PREMIUM modu — preskačem IBAN/BIC validaciju');
            }

            // Ako izgleda kao IBAN (počinje sa 2 slova), MORA da prođe mod-97 proveru.
            // Lokalni brojevi računa (npr. domaći) se propuštaju uz upozorenje na server
            // strani; SWIFT/BIC MORA da bude validan uvek jer se koristi za wire.
            if (!_isPremium && /^[A-Za-z]{2}/.test(ibanRaw) && typeof IBAN !== 'undefined') {
                const rIban = IBAN.validate(ibanRaw);
                if (!rIban.valid) {
                    if (fl) { fl.classList.add('hidden'); fl.classList.remove('flex'); }
                    _highlight('kyc-bank-iban');
                    return showToast(`✗ IBAN: ${rIban.message}. Fix and submit again.`, 'error', 7000);
                }
            } else if (ibanRaw && !/^[A-Za-z]{2}/.test(ibanRaw)) {
                // Lokalni broj računa — dozvolimo, ali obeležimo u polju status
                const s = document.getElementById('kyc-bank-iban-status');
                if (s) { s.textContent = '⚠ Local account (not IBAN) — SEPA/SWIFT wires may not work'; s.style.color = '#a16207'; }
            }

            if (!_isPremium) {
                if (swiftRaw) {
                    if (typeof BIC === 'undefined') {
                        // Ne bi trebalo da se desi ako je vendor/iban.js učitan, ali fallback
                        // struktura provera da ne šalje očigledno pogrešan BIC.
                        if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(swiftRaw.toUpperCase().replace(/\s/g,''))) {
                            if (fl) { fl.classList.add('hidden'); fl.classList.remove('flex'); }
                            _highlight('kyc-bank-swift');
                            return showToast('✗ SWIFT/BIC format is invalid.', 'error', 6000);
                        }
                    } else {
                        // Cross-check protiv IBAN country code (ako IBAN validan)
                        const expected = /^[A-Z]{2}/.test(ibanRaw.replace(/\s/g,'')) ? ibanRaw.replace(/\s/g,'').slice(0,2).toUpperCase() : null;
                        const rBic = BIC.validate(swiftRaw, expected);
                        if (!rBic.valid) {
                            if (fl) { fl.classList.add('hidden'); fl.classList.remove('flex'); }
                            _highlight('kyc-bank-swift');
                            return showToast(`✗ SWIFT/BIC: ${rBic.message}. Fix and submit again.`, 'error', 7000);
                        }
                    }
                } else {
                    if (fl) { fl.classList.add('hidden'); fl.classList.remove('flex'); }
                    _highlight('kyc-bank-swift');
                    return showToast('✗ SWIFT/BIC is required.', 'error', 5000);
                }
            }

            const uploadedFiles = {};
            const fileInputs = [
                { id: 'file-passport', key: 'passport' },
                { id: 'file-license', key: 'license' },
                { id: 'file-inc', key: 'incorporation' },
                { id: 'kyc-proof-address', key: 'proofOfAddress' }
            ];
            for (const input of fileInputs) {
                const el = document.getElementById(input.id);
                if (el && el.files.length > 0) {
                    const fd = new FormData();
                    for (let i = 0; i < el.files.length; i++) fd.append('file', el.files[i]);
                    try {
                        const r = await fetch(`/api/portal/upload/${TOKEN}`, { method: 'POST', headers: { 'X-Portal-Auth': authKey }, body: fd });
                        if (r.ok) {
                            const d = await r.json();
                            if (d.urls && d.urls.length > 0) uploadedFiles[input.key] = d.urls;
                        }
                    } catch (err) { console.error(err); }
                }
            }

            const g = id => document.getElementById(id)?.value || '';
            const c = id => !!document.getElementById(id)?.checked;
            const payload = {
                partner_id: portalData?.partner?.id,
                entityType: entityType,
                companyName: g('kyc-comp-name'), regNo: g('kyc-reg-no'), taxId: g('kyc-tax-id'),
                website: g('kyc-website'), industry: g('kyc-industry'),
                contactPhone: g('kyc-contact-phone'),
                regAddr: g('kyc-reg-addr'), opAddr: g('kyc-op-addr'),
                city: g('kyc-city'), country: g('kyc-country'), zip: g('kyc-zip'),
                bankName: g('kyc-bank-name'), bankIban: g('kyc-bank-iban'), bankSwift: g('kyc-bank-swift'),
                bankAddr: g('kyc-bank-addr'), corrBank: g('kyc-corr-bank'),
                turnover: g('kyc-turnover'), sourceOfFunds: g('kyc-sof'),
                directors: await extractPersons('directors-container'),
                ubos: await extractPersons('ubos-container'),
                aml: { isPEP: c('kyc-pep'), isSanctioned: c('kyc-sanctions'), litigation: c('kyc-litigation'), dualUse: c('kyc-dualuse') },
                submitterName: g('kyc-sub-name'), submitterTitle: g('kyc-sub-title'),
                consent: c('kyc-consent'),
                files: uploadedFiles
            };
            const res = await fetch(`/api/portal/kyc/submit/${TOKEN}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Portal-Auth': authKey },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                showToast(t('msg_kyc_saved'), 'success');
                loadPortalData();
            } else {
                const d = await res.json().catch(() => ({}));
                // Server-side hard-block errors — highlight the offending field
                if (d.error === 'IBAN_INVALID' || d.error === 'BIC_INVALID' || d.error === 'BIC_REQUIRED') {
                    const targetId = d.error.startsWith('IBAN') ? 'kyc-bank-iban' : 'kyc-bank-swift';
                    const el = document.getElementById(targetId);
                    if (el) {
                        el.scrollIntoView({behavior: 'smooth', block: 'center'});
                        el.style.borderColor = '#dc2626';
                        el.style.boxShadow = '0 0 0 3px rgba(220,38,38,.15)';
                        setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = ''; }, 4000);
                        el.focus();
                    }
                    showToast(`✗ ${d.message || d.error}`, 'error', 8000);
                } else {
                    showToast(d.message || d.error || t('err_generic'), 'error');
                }
            }
        } catch (e) { showToast(t('err_network'), 'error'); }
        if (fl) { fl.classList.add('hidden'); fl.classList.remove('flex'); }
    });
}

// KYC banner (update requested/expired) + prikaz razloga koji je admin uneo.
// Klijent mora jasno videti šta se traži, ne samo "action required".
function renderUpdateRequestBanner() {
    const b = document.getElementById('update-request-banner'); if (!b) return;
    const status = portalData?.partner?.kycStatus;
    if (status !== 'update_requested' && status !== 'expired') { b.classList.add('hidden'); return; }
    b.classList.remove('hidden');
    const note = portalData?.partner?.kycReviewNote;
    const descEl = document.getElementById('lbl-update-req-desc');
    if (descEl) {
        descEl.textContent = note ? (t('update_req_note_prefix') + note) : t('update_req_desc');
    }
}

async function loadPortalData() {
    if (!authKey) {
        document.getElementById('loading-state').classList.add('hidden');
        document.getElementById('otp-screen').classList.remove('hidden');
        if (!otpRequested) { otpRequested = true; requestOTP(); }
        return;
    }
    document.getElementById('otp-screen').classList.add('hidden');
    document.getElementById('loading-state').classList.remove('hidden');
    try {
        const res = await fetch(`/api/portal/data/${TOKEN}`, { headers: { 'X-Portal-Auth': authKey } });
        if (res.status === 401) {
            authKey = null; sessionStorage.removeItem(`portal_auth_${TOKEN}`);
            loadPortalData(); return;
        }
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            const errMsg = errData.error || t('err_access_denied');
            document.getElementById('loading-state').innerHTML = `<div class="text-center"><p class="text-red-600 font-semibold">${errMsg}</p><p class="text-xs text-slate-500 mt-2">${res.status === 403 ? 'Your portal access may have been revoked. Please contact your account manager.' : 'HTTP ' + res.status}</p></div>`;
            return;
        }
        portalData = await res.json();

        // Header
        document.getElementById('comp-name').textContent = portalData?.company?.name || 'Aspidus';
        if (portalData?.company?.logoUrl) {
            const l = document.getElementById('comp-logo'); if (l) { l.src = portalData.company.logoUrl; l.classList.remove('hidden'); }
        }
        document.getElementById('partner-name').textContent = portalData?.partner?.companyName || '—';

        // Prilagodljiv brending: firma podešava svoju primarnu boju u company.brandColor.
        // Primenjuje se na CSS varijablu koju koriste dugmad i tab-ovi.
        if (portalData?.company?.brandColor) {
            const bc = portalData.company.brandColor;
            const root = document.documentElement;
            root.style.setProperty('--p-accent', bc);
            root.style.setProperty('--p-accent-hover', bc);
            try { document.title = `${portalData.company.name || 'Aspidus'} — B2B Portal`; } catch(e) {}
        }

        // ==========================================================
        //  PREMIUM MODE — poseban vizuelni tretman za VIP klijente
        // ==========================================================
        // Backend šalje isPremium=true u portal.partner objektu (postavlja admin
        // u CRM Partner formi). Kada je true, primenjujemo:
        //   • Zlatnu paletu (--p-accent postaje amber-gold umesto brand color)
        //   • "PREMIUM" badge u header-u pored imena kompanije
        //   • Gradient background na body-ju za osećaj luksuza
        //   • Ambient CSS klasu 'premium-mode' na <body> koju koriste stilovi
        //     u portal.html za bogatije pozadine, senke i tipografiju
        //   • Skriva KYC alert banner (klijent je već "approved" iz backend-a)
        if (portalData?.partner?.isPremium) {
            document.body.classList.add('premium-mode');
            const root = document.documentElement;
            root.style.setProperty('--p-accent', '#b8892e');       // amber-gold
            root.style.setProperty('--p-accent-hover', '#9c721e');
            root.style.setProperty('--p-accent-soft', '#fdf6e3');
            // Dodaj badge pored imena kompanije partnera
            setTimeout(() => {
                const nameEl = document.getElementById('partner-name');
                if (nameEl && !document.getElementById('premium-badge')) {
                    const badge = document.createElement('span');
                    badge.id = 'premium-badge';
                    badge.textContent = '★ PREMIUM';
                    badge.style.cssText = 'display:inline-block;margin-left:10px;padding:2px 10px;background:linear-gradient(135deg,#f4d03f,#b8892e);color:#3d2f00;font-size:10px;font-weight:800;letter-spacing:0.12em;border-radius:20px;box-shadow:0 2px 6px rgba(184,137,46,0.35);vertical-align:middle;';
                    nameEl.appendChild(badge);
                }
                // Skini KYC gate alert ako postoji (premium klijent ne treba to)
                const kycAlert = document.querySelector('.kyc-required-alert, #kyc-alert-banner');
                if (kycAlert) kycAlert.style.display = 'none';
            }, 50);
            console.info('Portal running in PREMIUM mode for', portalData.partner.companyName);
        } else {
            document.body.classList.remove('premium-mode');
        }

        // KYC form pre-fill from latest submission
        if (portalData?.latest_kyc) {
            const lk = portalData.latest_kyc;
            const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
            set('kyc-comp-name', lk.companyName); set('kyc-reg-no', lk.regNo); set('kyc-tax-id', lk.taxId);
            set('kyc-website', lk.website); set('kyc-industry', lk.industry);
            set('kyc-contact-phone', lk.contactPhone);
            set('kyc-reg-addr', lk.regAddr); set('kyc-op-addr', lk.opAddr);
            set('kyc-city', lk.city); set('kyc-country', lk.country); set('kyc-zip', lk.zip);
            set('kyc-bank-name', lk.bankName); set('kyc-bank-iban', lk.bankIban); set('kyc-bank-swift', lk.bankSwift);
            set('kyc-bank-addr', lk.bankAddr); set('kyc-corr-bank', lk.corrBank);
            set('kyc-turnover', lk.turnover); set('kyc-sof', lk.sourceOfFunds);
            set('kyc-sub-name', lk.submitterName); set('kyc-sub-title', lk.submitterTitle);
            if (lk.aml) {
                const chk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
                chk('kyc-pep', lk.aml.isPEP); chk('kyc-sanctions', lk.aml.isSanctioned);
                chk('kyc-litigation', lk.aml.litigation); chk('kyc-dualuse', lk.aml.dualUse);
            }
        } else {
            const el = document.getElementById('kyc-comp-name'); if (el && !el.value) el.value = portalData?.partner?.companyName || '';
        }

        // Directors/UBOs — ensure at least one row exists
        const dc = document.getElementById('directors-container'); if (dc && dc.children.length === 0) addDirector();
        const uc = document.getElementById('ubos-container'); if (uc && uc.children.length === 0) addUBO();

        // Show content
        document.getElementById('loading-state').classList.add('hidden');
        document.getElementById('portal-content').classList.remove('hidden');

        updateStaticText();
        renderKycStatusLine();
        renderUpdateRequestBanner();
        renderDashboard();
        renderDeals();
        renderOffers();
        renderRFQs();
        renderGoodsTable();
        renderDocuments();
        fillProfile();
        renderNotifications();

        if (typeof applyPermissions === 'function') applyPermissions(portalData?.partner?.permissions || []);
        // KYC gating — ako KYC nije odobren, zaključavaju se offers/deals/catalog tabovi.
        if (typeof applyKycGate === 'function') applyKycGate();
        // Posle prve učitavanja podataka — vrati klijenta na tab koji je zadnji gledao
        // (persistiran u sessionStorage kroz switchTab). Ovo znači da F5 nikada ne
        // baca korisnika na 'dashboard' ako je bio u sredini Catalog/Offers.
        if (typeof restorePortalTab === 'function') restorePortalTab();
    } catch (e) {
        console.error(e);
        document.getElementById('loading-state').innerHTML = `<div class="text-center"><p class="text-red-600 font-semibold">${t('err_access_denied')}</p></div>`;
    }
}

// ==========================================================
//  SESSION INACTIVITY TIMER (15 min)
// ==========================================================
const SESSION_TIMEOUT_MS = 15 * 60 * 1000;
const SESSION_WARNING_MS = 13 * 60 * 1000;
let _inactivityTimer = null;
let _warningTimer = null;

function resetInactivityTimer() {
    if (_warningTimer) clearTimeout(_warningTimer);
    if (_inactivityTimer) clearTimeout(_inactivityTimer);
    const warningEl = document.getElementById('session-warning');
    if (warningEl) warningEl.classList.add('hidden');

    _warningTimer = setTimeout(() => {
        const w = document.getElementById('session-warning');
        if (w) { w.classList.remove('hidden'); }
    }, SESSION_WARNING_MS);

    _inactivityTimer = setTimeout(() => {
        authKey = null;
        sessionStorage.removeItem('portal_auth_' + TOKEN);
        window.location.href = '/portal/login';
    }, SESSION_TIMEOUT_MS);
}

if (typeof TOKEN !== 'undefined') {
    ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach(evt =>
        document.addEventListener(evt, resetInactivityTimer, { passive: true })
    );
    resetInactivityTimer();
}

// Logout button
window.portalLogout = function() {
    authKey = null;
    sessionStorage.removeItem('portal_auth_' + TOKEN);
    window.location.href = '/portal/login';
};

// Boot
updateStaticText();

// Magic-link auto-consume: ako URL ima ?ml=<payload>, pokušaj instant sign-in
// pre standardnog OTP flow-a. Uspeh → auth_key upisan, loadPortalData ide odmah.
// Neuspeh → pada natrag na standardni OTP prompt bez korisničke intervencije.
(async function tryMagicLink() {
    const params = new URLSearchParams(window.location.search);
    const ml = params.get('ml');
    if (!ml || typeof TOKEN === 'undefined') { loadPortalData(); return; }
    // GPS pokušamo — backend odlučuje da li je premium klijent i propušta bez lokacije
    let loc = '';
    try {
        loc = await new Promise((resolve, reject) => {
            if (!navigator.geolocation) return reject('no-geo');
            navigator.geolocation.getCurrentPosition(
                p => resolve(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`),
                err => reject(err.code === err.PERMISSION_DENIED ? 'perm-denied' : 'geo-err'),
                {enableHighAccuracy: true, timeout: 12000, maximumAge: 0}
            );
        });
    } catch (e) {
        // GPS odbijen — probaj svejedno; standardni klijent će dobiti 403, premium prolazi.
        loc = '';
    }
    try {
        const r = await fetch(`/api/portal/auth/consume_magic/${TOKEN}`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ml, location: loc}),
        });
        const j = await r.json();
        if (r.ok && j.auth_key) {
            authKey = j.auth_key;
            sessionStorage.setItem(`portal_auth_${TOKEN}`, authKey);
            // Očisti ?ml iz URL-a da se ne pojavi u share/screenshot-ovima
            window.history.replaceState({}, '', window.location.pathname);
            if (typeof showToast === 'function') showToast('✓ Signed in via secure link', 'success', 3000);
        } else {
            if (typeof showToast === 'function') showToast(j.message || 'Link cannot be used — please use the OTP code from your email.', 'warning', 6000);
        }
    } catch (_) {
        // Silent fallback — user će videti OTP screen
    }
    loadPortalData();
})();
