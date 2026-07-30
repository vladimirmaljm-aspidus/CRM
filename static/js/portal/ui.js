// Aspidus B2B Portal — UI helpers, renderers, tab handling

// ==========================================================
//  ASK MODAL — profesionalna zamena za native prompt()/confirm() u PORTALU
// ==========================================================
// Portal ne učitava core/utils.js pa mora imati sopstvene helperi za modalne
// prompt-e. API je identičan sa CRM-om (Promise-based) tako da respondToOffer
// i drugi kod može transparentno da radi na oba mesta.
window.portalAskModal = function(opts) {
    return new Promise((resolve) => {
        opts = opts || {};
        const {
            title = 'Question', description = '',
            confirmText = 'OK', cancelText = 'Cancel',
            danger = false, initialValue = '', placeholder = '',
            multiline = false, required = true, validator = null,
            mode = 'input'   // 'input' | 'confirm'
        } = opts;

        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[500] bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');

        const btnClass = danger ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white';
        const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
        const inputHtml = mode === 'confirm' ? '' : (multiline
            ? `<textarea id="pk-modal-input" rows="4" placeholder="${esc(placeholder)}" class="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none">${esc(initialValue)}</textarea>`
            : `<input type="text" id="pk-modal-input" value="${esc(initialValue)}" placeholder="${esc(placeholder)}" class="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"/>`);

        const bodyHtml = mode === 'confirm'
            ? (description ? `<p class="text-slate-700 text-sm leading-relaxed">${esc(description)}</p>` : '')
            : `${description ? `<p class="text-slate-600 text-xs mb-3 leading-relaxed">${esc(description)}</p>` : ''}${inputHtml}<div id="pk-modal-error" class="hidden text-red-600 text-xs mt-2 font-semibold"></div>`;

        overlay.innerHTML = `
          <div class="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[95vh]">
            <div class="px-5 pt-5 pb-3"><h3 class="text-base font-bold text-slate-900">${esc(title)}</h3></div>
            <div class="px-5 pb-4 overflow-y-auto flex-1">${bodyHtml}</div>
            <div class="px-5 py-4 border-t border-slate-100 bg-slate-50 flex flex-col sm:flex-row-reverse gap-2 rounded-b-2xl">
              <button id="pk-modal-ok" class="${btnClass} font-bold px-5 py-2.5 rounded-xl text-sm shadow-sm min-h-[44px]">${esc(confirmText)}</button>
              <button id="pk-modal-cancel" class="bg-white border border-slate-300 text-slate-700 font-semibold px-5 py-2.5 rounded-xl text-sm hover:bg-slate-50 min-h-[44px]">${esc(cancelText)}</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);
        const input = overlay.querySelector('#pk-modal-input');
        const errorEl = overlay.querySelector('#pk-modal-error');
        setTimeout(() => (input || overlay.querySelector('#pk-modal-ok'))?.focus(), 40);

        const cleanup = (result) => {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            resolve(result);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') cleanup(mode === 'confirm' ? false : null);
            if (e.key === 'Enter' && !multiline && input && document.activeElement === input) {
                overlay.querySelector('#pk-modal-ok').click();
            }
        };
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(mode === 'confirm' ? false : null); });
        overlay.querySelector('#pk-modal-cancel').addEventListener('click', () => cleanup(mode === 'confirm' ? false : null));
        overlay.querySelector('#pk-modal-ok').addEventListener('click', () => {
            if (mode === 'confirm') return cleanup(true);
            const val = input ? input.value : '';
            if (required && !String(val).trim()) {
                errorEl.textContent = 'This field is required.'; errorEl.classList.remove('hidden');
                input.focus(); return;
            }
            if (validator) {
                const msg = validator(val);
                if (msg) { errorEl.textContent = msg; errorEl.classList.remove('hidden'); input.focus(); return; }
            }
            cleanup(val);
        });
    });
};

// Kompatibilni aliasi (isti API kao u CRM)
window.askConfirm = (title, description, opts) => portalAskModal(Object.assign({ title, description, mode: 'confirm' }, opts || {}));
window.askInput = (title, opts) => portalAskModal(Object.assign({ title }, opts || {}));

// Global loader — jednostavniji od CRM verzije (portal nema tolkiko sink flows).
let __portal_loader_el = null;
window.showLoader = function(msg) {
    if (!__portal_loader_el) {
        __portal_loader_el = document.createElement('div');
        __portal_loader_el.className = 'fixed inset-0 z-[600] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center';
        __portal_loader_el.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl px-8 py-6 flex flex-col items-center gap-3 min-w-[200px]"><svg width="40" height="40" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="20" stroke="#2563eb" stroke-width="3" opacity="0.2"/><path d="M44 24a20 20 0 0 1-20 20" stroke="#2563eb" stroke-width="3" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 24 24" to="360 24 24" dur="0.9s" repeatCount="indefinite"/></path></svg><div class="text-sm font-semibold text-slate-800" id="portal-loader-msg">Loading…</div></div>`;
        document.body.appendChild(__portal_loader_el);
    }
    const m = __portal_loader_el.querySelector('#portal-loader-msg');
    if (m) m.textContent = msg || 'Loading…';
    __portal_loader_el.style.display = 'flex';
};
window.hideLoader = function() { if (__portal_loader_el) __portal_loader_el.style.display = 'none'; };


const statusColors = {
    'pending': 'badge-warning',
    'approved': 'badge-success',
    'rejected': 'badge-danger',
    'active': 'badge-info',
    'signed': 'badge-info',
    'in_negotiation': 'badge-muted',
    'payment': 'badge-info',
    'completed': 'badge-success',
    'delivered': 'badge-success',
    'sourced': 'badge-success',
    'closed': 'badge-muted',
    'open': 'badge-info',
    'update_requested': 'badge-warning',
    'expired': 'badge-danger',
    'default': 'badge-muted'
};

function safeText(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[<>&"']/g, ch => ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[ch]));
}

function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('#portal-content > div.flex.gap-1 .tab-btn').forEach(el => el.classList.remove('active'));
    const tc = document.getElementById('tab-' + tabId); if (tc) { tc.classList.remove('hidden'); tc.classList.add('fade-in'); setTimeout(() => tc.classList.remove('fade-in'), 300); }
    const tb = document.getElementById('tab-btn-' + tabId); if (tb) tb.classList.add('active');
    // Perzistiraj — F5 vraća korisnika na isti tab.
    try { sessionStorage.setItem(`portal_last_tab_${typeof TOKEN !== 'undefined' ? TOKEN : ''}`, tabId); } catch(e) {}
    // Lazy-load katalog kad klijent prvi put klikne (bez cena, samo vidljivi proizvodi)
    if (tabId === 'catalog' && typeof loadCatalog === 'function') loadCatalog();
    // TASK #41: pri otvaranju KYC-a, prefill iz CRM-a ako nije vec ucitano
    if (tabId === 'kyc' && !window._kycPrefilled && typeof loadKycPrefill === 'function') {
        loadKycPrefill();
    }
}

// TASK #41: uvuci trenutna partner polja iz CRM-a i popuni KYC formu.
// Radi samo jednom po session-u (window._kycPrefilled flag) da ne prepisuje
// klijentove izmene ako on prebacuje tab-ove.
window.loadKycPrefill = async function() {
    if (window._kycPrefilled) return;
    window._kycPrefilled = true;
    try {
        const token = (typeof TOKEN !== 'undefined') ? TOKEN : '';
        const key = sessionStorage.getItem('portal_auth_' + token) || '';
        if (!token || !key) return;
        const r = await fetch(`/api/portal/kyc/prefill/${encodeURIComponent(token)}`, {
            headers: { 'X-Portal-Auth': key }, credentials: 'same-origin'
        });
        if (!r.ok) return;
        const j = await r.json();
        const p = j.prefill || {};
        // Mapiranje: prefill polje → element id (samo ako je element prazan da ne pregazimo klijentov unos)
        const map = {
            'kyc-comp-name': 'companyName', 'kyc-reg-no': 'regNo',
            'kyc-tax-id': 'taxId', 'kyc-website': 'website',
            'kyc-industry': 'industry', 'kyc-contact-phone': 'contactPhone',
            'kyc-reg-addr': 'address', 'kyc-city': 'city', 'kyc-country': 'country',
            'kyc-bank-name': 'bankName', 'kyc-bank-iban': 'bankIban',
            'kyc-bank-swift': 'bankSwift',
        };
        for (const [eid, key] of Object.entries(map)) {
            const el = document.getElementById(eid);
            if (el && !el.value && p[key]) el.value = p[key];
        }
        // Entity type radio
        if (p.entityType) {
            const rEl = document.querySelector(`input[name="kyc-entity-type"][value="${p.entityType}"]`);
            if (rEl) rEl.checked = true;
        }
        // Ako je KYC vec approved, pokazi jasnu poruku i disable submit
        if (j.readonly_kyc_status) {
            const banner = document.createElement('div');
            banner.className = 'mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800';
            banner.innerHTML = '✓ <b>Your KYC has been approved</b> by our compliance team. Any changes you make will create an update request that admin will review.';
            const form = document.getElementById('kyc-form');
            if (form) form.parentNode.insertBefore(banner, form);
        } else {
            // Vidljivi info banner koji objasnjava sta je pre-fill
            const banner = document.createElement('div');
            banner.className = 'mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800';
            banner.innerHTML = `ℹ ${j.hint || 'Fields pre-filled from your CRM record.'}`;
            const form = document.getElementById('kyc-form');
            if (form) form.parentNode.insertBefore(banner, form);
        }
        if (typeof showToast === 'function') showToast('KYC form pre-filled from CRM.', 'info', 3000);
    } catch(_) { /* fail silent — user moze rucno da unosi */ }
};

// Vrati tab koji je klijent poslednje gledao — koristi se posle loadPortalData().
window.restorePortalTab = function() {
    try {
        const last = sessionStorage.getItem(`portal_last_tab_${typeof TOKEN !== 'undefined' ? TOKEN : ''}`);
        if (last) {
            const btn = document.getElementById('tab-btn-' + last);
            if (btn && !btn.classList.contains('hidden')) switchTab(last);
        }
    } catch(e) {}
};

// Refresh portal podatke — čuva aktivni tab. Poziva se iz refresh dugmeta.
window.refreshPortal = async function() {
    if (typeof showLoader === 'function') showLoader('Refreshing…');
    else { const fl = document.getElementById('full-loading'); if (fl) { fl.classList.remove('hidden'); fl.classList.add('flex'); } }
    const activeTab = document.querySelector('.tab-btn.active');
    const activeId = activeTab ? activeTab.id.replace('tab-btn-', '') : null;
    try {
        if (typeof loadPortalData === 'function') await loadPortalData();
        // Rebuild-uj katalog ako je aktivan
        if (activeId === 'catalog' && typeof loadCatalog === 'function') await loadCatalog();
        if (activeId) {
            const btn = document.getElementById('tab-btn-' + activeId);
            if (btn) switchTab(activeId);
        }
        if (typeof showToast === 'function') showToast('Data refreshed.', 'success', 2000);
    } catch (e) {
        if (typeof showToast === 'function') showToast('Refresh failed.', 'error');
    } finally {
        if (typeof hideLoader === 'function') hideLoader();
        else { const fl = document.getElementById('full-loading'); if (fl) { fl.classList.add('hidden'); fl.classList.remove('flex'); } }
    }
};

// ==========================================================
//  CATALOG (klijent vidi listu proizvoda bez cena, može da traži ponudu)
// ==========================================================
let __catalog_cache = null;

async function loadCatalog() {
    const grid = document.getElementById('catalog-grid');
    const emptyEl = document.getElementById('catalog-empty');
    if (!grid) return;
    grid.innerHTML = '<div class="col-span-full text-center text-slate-500 py-8">Loading catalog…</div>';
    try {
        const res = await fetch(`/api/portal/catalog/${TOKEN}`, { headers: { 'X-Portal-Auth': authKey } });
        if (!res.ok) throw new Error('http ' + res.status);
        const data = await res.json();
        __catalog_cache = data.products || [];
        renderCatalog(__catalog_cache);
    } catch (e) {
        grid.innerHTML = `<div class="col-span-full text-center text-red-500 py-8">Failed to load catalog.</div>`;
    }

    const searchEl = document.getElementById('catalog-search');
    if (searchEl && !searchEl.__wired) {
        searchEl.__wired = true;
        searchEl.addEventListener('input', () => {
            const q = searchEl.value.toLowerCase().trim();
            if (!__catalog_cache) return;
            const filtered = q ? __catalog_cache.filter(p =>
                (p.name || '').toLowerCase().includes(q) ||
                (p.category || '').toLowerCase().includes(q) ||
                (p.hsCode || '').toLowerCase().includes(q) ||
                (p.brand || '').toLowerCase().includes(q) ||
                (p.origins || []).some(o => o.toLowerCase().includes(q))
            ) : __catalog_cache;
            renderCatalog(filtered);
        });
    }
}

function renderCatalog(products) {
    const grid = document.getElementById('catalog-grid');
    const emptyEl = document.getElementById('catalog-empty');
    if (!grid) return;
    if (!products || products.length === 0) {
        grid.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    grid.innerHTML = products.map(p => {
        const originsHtml = (p.origins || []).map(o => `<span class="text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200 rounded px-1.5 py-0.5">${escapeHtml(o)}</span>`).join('');
        const certsHtml = (p.certificates || []).slice(0, 3).map(c => `<span class="text-[10px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 rounded px-1.5 py-0.5">${escapeHtml(c)}</span>`).join('');
        return `
        <div class="border border-slate-200 rounded-xl p-4 bg-white shadow-sm hover:shadow-md transition-shadow flex flex-col">
            <div class="flex items-start justify-between mb-2 gap-2">
                <div>
                    <h3 class="font-semibold text-slate-900 text-sm leading-tight">${escapeHtml(p.name)}</h3>
                    <div class="text-[11px] text-slate-500 mt-0.5">${escapeHtml(p.category || 'General')}${p.brand ? ' · ' + escapeHtml(p.brand) : ''}</div>
                </div>
                ${p.hsCode ? `<span class="text-[10px] font-mono bg-blue-50 text-blue-800 border border-blue-200 rounded px-1.5 py-0.5 whitespace-nowrap">HS ${escapeHtml(p.hsCode)}</span>` : ''}
            </div>
            <p class="text-xs text-slate-600 mb-3 line-clamp-3 flex-1">${escapeHtml(p.shortDescription || '')}</p>
            ${originsHtml ? `<div class="flex flex-wrap gap-1 mb-2"><span class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1">Origins:</span>${originsHtml}</div>` : ''}
            ${certsHtml ? `<div class="flex flex-wrap gap-1 mb-3">${certsHtml}</div>` : ''}
            ${p.packaging ? `<div class="text-[11px] text-slate-500 mb-3"><strong>Packaging:</strong> ${escapeHtml(p.packaging)}</div>` : ''}
            <button class="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2 rounded-md uppercase tracking-wider transition-colors mt-auto"
                    onclick="openQuoteRequest('${escapeHtml(p.id)}', '${escapeHtml((p.name || '').replace(/'/g, "\\'"))}', '${escapeHtml(p.unit || '')}')">
              Request quote
            </button>
        </div>`;
    }).join('');
}

// ==========================================================
//  QUOTE REQUEST MODAL — profesionalna zamena za prompt()
// ==========================================================
// Otvara modal sa svim relevantnim poljima (Incoterm, banka, plaćanje,
// logistika, treće lice). Sadrži automation hints koji se menjaju u realnom
// vremenu prema izboru Incotermsa i porekla robe:
//   EXW/FCA/FAS  → klijent preuzima; obavezan freight forwarder + upozorenje
//   CIF/CFR/CIP/CPT → obavezna luka/mesto dostave + upozorenje "extra time"
//   DAP/DPU/DDP  → obavezna tačna adresa dostave
//   ako klijent traži CIF a supplier nudi EXW → hint "conversion needs lead time"

const INCOTERM_META = {
    EXW: { needsAgent: true,  destLabel: 'Pickup location (warehouse address)',  destHint: 'Address where your carrier will collect the goods.',              category: 'buyer_arranges' },
    FCA: { needsAgent: true,  destLabel: 'Named place / carrier hand-over',      destHint: 'Where the seller hands goods to your nominated carrier.',        category: 'buyer_arranges' },
    FAS: { needsAgent: true,  destLabel: 'Port of loading (alongside vessel)',   destHint: 'Named port where goods will be placed alongside the vessel.',    category: 'buyer_arranges' },
    FOB: { needsAgent: true,  destLabel: 'Port of loading',                      destHint: 'Named port where goods will be loaded on board the vessel.',     category: 'buyer_arranges' },
    CPT: { needsAgent: false, destLabel: 'Named destination',                    destHint: 'Named place (city/terminal) where seller pays carriage to.',     category: 'seller_arranges' },
    CIP: { needsAgent: false, destLabel: 'Named destination',                    destHint: 'Named place where seller pays carriage + insurance.',            category: 'seller_arranges' },
    CFR: { needsAgent: false, destLabel: 'Port of destination',                  destHint: 'Named port to which seller pays sea freight (no insurance).',    category: 'seller_arranges' },
    CIF: { needsAgent: false, destLabel: 'Port of destination',                  destHint: 'Named port to which seller pays sea freight AND insurance.',     category: 'seller_arranges' },
    DAP: { needsAgent: false, destLabel: 'Delivery address',                     destHint: 'Full address where goods are delivered (unloaded by buyer).',    category: 'seller_delivers' },
    DPU: { needsAgent: false, destLabel: 'Delivery address (unloaded)',          destHint: 'Full address where goods are delivered AND unloaded by seller.', category: 'seller_delivers' },
    DDP: { needsAgent: false, destLabel: 'Delivery address (duty paid)',         destHint: 'Full address where goods are delivered with all duties paid.',   category: 'seller_delivers' }
};

let __currentQuoteProduct = null;   // za pristup supplyOffers.origin/incoterm iz kataloga

function openQuoteRequest(productId, productName, unit) {
    __currentQuoteProduct = (__catalog_cache || []).find(p => p.id === productId) || { id: productId, name: productName, unit: unit };
    document.getElementById('quote-product-id').value = productId;
    document.getElementById('quote-product-name').value = productName || '';
    document.getElementById('quote-product-unit').value = unit || '';
    document.getElementById('quote-unit-label').textContent = unit || 'unit';
    document.getElementById('quote-modal-subtitle').innerHTML = `<strong>${escapeHtml(productName || '')}</strong> · Fill in the details below for an accurate quote.`;
    // Reset polja
    const f = document.getElementById('quote-form');
    if (f) f.reset();
    // Presetuj radio na 'self' (reset ga ne diram jer je već checked, ali osiguraj)
    const selfRadio = document.querySelector('input[name="quote-requestor"][value="self"]');
    if (selfRadio) selfRadio.checked = true;
    document.getElementById('third-party-buyer-block').classList.add('hidden');
    document.getElementById('quote-logistics-block').classList.add('hidden');
    document.getElementById('quote-hints').classList.add('hidden');
    document.getElementById('quote-hints').innerHTML = '';
    // Otvori
    const modal = document.getElementById('quote-modal');
    if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
    // Fokusiraj količinu
    setTimeout(() => document.getElementById('quote-qty')?.focus(), 100);
    // Prvi rerender hint-ova
    refreshQuoteHints();
}

function closeQuoteModal() {
    const modal = document.getElementById('quote-modal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
    __currentQuoteProduct = null;
}

// Kad se Incoterm promeni: prilagodi labelu polja destinacije + obaveznost, i
// prikaži/ukloni logistics blok. Sve automation hint-ove ponovo iscrtava.
document.addEventListener('change', (ev) => {
    if (!ev.target) return;
    if (ev.target.name === 'quote-requestor') {
        const block = document.getElementById('third-party-buyer-block');
        const bankLabel = document.getElementById('quote-bank-label');
        if (block) block.classList.toggle('hidden', ev.target.value !== 'third_party');
        if (bankLabel) bankLabel.textContent = ev.target.value === 'third_party' ? 'End-buyer bank' : 'Buyer bank';
        refreshQuoteHints();
    }
    if (ev.target.id === 'quote-incoterm') {
        const meta = INCOTERM_META[ev.target.value];
        const destInput = document.getElementById('quote-destination');
        const destLabel = document.getElementById('quote-loc-label');
        const destHint = document.getElementById('quote-loc-hint');
        const logBlock = document.getElementById('quote-logistics-block');
        if (meta) {
            destInput.placeholder = meta.destLabel;
            destLabel.textContent = meta.destLabel + ' *';
            destHint.textContent = meta.destHint;
            logBlock.classList.toggle('hidden', !meta.needsAgent);
        } else {
            destInput.placeholder = 'Please select an Incoterm first';
            destLabel.textContent = 'Delivery location *';
            destHint.textContent = '';
            logBlock.classList.add('hidden');
        }
        refreshQuoteHints();
    }
    if (['quote-payment', 'quote-destination', 'quote-agent'].includes(ev.target.id)) {
        refreshQuoteHints();
    }
});
document.addEventListener('input', (ev) => {
    if (['quote-destination', 'quote-agent', 'quote-qty'].includes(ev.target.id)) refreshQuoteHints();
});

function refreshQuoteHints() {
    const hintBox = document.getElementById('quote-hints');
    if (!hintBox) return;
    const hints = [];
    const push = (icon, cls, text) => hints.push(`<div class="flex items-start gap-2 border ${cls} rounded-lg px-3 py-2 text-xs"><span class="text-base leading-none">${icon}</span><span class="flex-1">${text}</span></div>`);

    const inc = document.getElementById('quote-incoterm')?.value;
    const meta = INCOTERM_META[inc];
    const prod = __currentQuoteProduct;
    // 1. Incoterm mismatch između supplierovog i traženog
    const supplierIncoterms = new Set();
    const supplierOrigins = new Set();
    if (prod && Array.isArray(prod.origins)) prod.origins.forEach(o => supplierOrigins.add(o));
    // (katalog vraća samo origins listu, ne incoterms — pa nudimo generalna upozorenja)

    // 2. CIF/CFR: obavesti da će konverzija iz EXW/FOB dodati vreme
    if (inc === 'CIF' || inc === 'CFR' || inc === 'CIP' || inc === 'CPT') {
        push('⏱', 'border-amber-200 bg-amber-50 text-amber-900',
             `<strong>${inc}</strong> quotes typically require <strong>3–7 additional working days</strong> because our team needs to price freight${inc === 'CIF' || inc === 'CIP' ? ' and marine insurance' : ''} for the requested route.`);
    }
    // 3. EXW/FCA/FAS/FOB: klijent mora da navede agenta
    if (inc && meta && meta.needsAgent) {
        const agent = document.getElementById('quote-agent')?.value?.trim();
        if (!agent) {
            push('🚚', 'border-blue-200 bg-blue-50 text-blue-900',
                 `Under <strong>${inc}</strong>, pickup is arranged by <strong>your side</strong>. Please fill in your freight forwarder / agent above so we can coordinate loading.`);
        }
    }
    // 4. DAP/DPU/DDP: obavezna tačna adresa
    if (['DAP', 'DPU', 'DDP'].includes(inc)) {
        const dest = document.getElementById('quote-destination')?.value?.trim();
        if (dest && !/\d/.test(dest)) {
            push('📍', 'border-amber-200 bg-amber-50 text-amber-900',
                 `<strong>${inc}</strong> requires a full delivery address (street + number). Please make sure the destination field has a specific address, not just a city.`);
        }
    }
    // 5. DDP: dodatna napomena o carini
    if (inc === 'DDP') {
        push('🛃', 'border-orange-200 bg-orange-50 text-orange-900',
             '<strong>DDP</strong> means the seller pays <strong>all import duties, VAT and customs charges</strong> in the destination country. This may add significant cost — CIP or DAP are often preferred alternatives.');
    }
    // 6. L/C plaćanje — dodatno vreme
    const pay = document.getElementById('quote-payment')?.value;
    if (pay && pay.startsWith('LC_')) {
        push('🏦', 'border-slate-200 bg-slate-50 text-slate-800',
             'Payment by <strong>Letter of Credit</strong> requires our bank to review the L/C draft before shipment. Please plan an extra <strong>5–10 days</strong> for L/C document workflow.');
    }
    // 7. Third-party buyer
    const requestor = document.querySelector('input[name="quote-requestor"]:checked')?.value;
    if (requestor === 'third_party') {
        push('👥', 'border-indigo-200 bg-indigo-50 text-indigo-900',
             'You are requesting <strong>on behalf of an end-buyer</strong>. Please provide the end-buyer\'s company details above — the quote will reference your intermediary role.');
    }
    // 8. Origin awareness — ako je poznato poreklo
    if (supplierOrigins.size > 0 && inc && meta && meta.category === 'seller_arranges') {
        push('🌍', 'border-slate-200 bg-slate-50 text-slate-700',
             `This product is currently sourced from: <strong>${[...supplierOrigins].map(escapeHtml).join(', ')}</strong>. Your requested Incoterm (${inc}) means we will arrange transport from origin to your named destination.`);
    }

    hintBox.innerHTML = hints.join('');
    hintBox.classList.toggle('hidden', hints.length === 0);
}

async function submitQuoteRequest() {
    const requestor = document.querySelector('input[name="quote-requestor"]:checked')?.value || 'self';
    const inc = document.getElementById('quote-incoterm').value;
    const meta = INCOTERM_META[inc];
    const qty = parseFloat(document.getElementById('quote-qty').value);
    const dest = document.getElementById('quote-destination').value.trim();
    const pay = document.getElementById('quote-payment').value;
    const agent = document.getElementById('quote-agent').value.trim();

    // Client-side validacije (server je i dalje autoritativan)
    if (!qty || qty <= 0) return showToast('Please enter a valid quantity.', 'error');
    if (!inc) return showToast('Please select an Incoterm.', 'error');
    if (!dest) return showToast('Please provide a delivery location.', 'error');
    if (!pay) return showToast('Please select payment terms.', 'error');
    if (meta && meta.needsAgent && !agent) return showToast('This Incoterm requires a freight forwarder / agent.', 'error');

    const val = id => (document.getElementById(id)?.value || '').trim();
    const payload = {
        productId: document.getElementById('quote-product-id').value,
        quantity: qty,
        targetPrice: parseFloat(val('quote-target-price')) || 0,
        currency: val('quote-currency'),
        neededBy: val('quote-deadline'),
        incoterm: inc,
        destination: dest,
        paymentTerms: pay,
        buyerBank: val('quote-bank'),
        logisticsAgent: agent,
        logisticsAgentContact: val('quote-agent-contact'),
        notes: val('quote-notes'),
        requestor: requestor,
        endBuyer: requestor === 'third_party' ? {
            companyName: val('qb-company'),
            taxId: val('qb-taxid'),
            country: val('qb-country'),
            email: val('qb-email'),
            phone: val('qb-phone')
        } : null
    };

    if (requestor === 'third_party' && !payload.endBuyer.companyName) {
        return showToast('Please provide the end-buyer company name.', 'error');
    }

    const btn = document.getElementById('btn-submit-quote');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
        const res = await fetch(`/api/portal/quote_request/${TOKEN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Portal-Auth': authKey },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            showToast('Quote request submitted. Our team will respond shortly.', 'success');
            closeQuoteModal();
        } else {
            const err = await res.json().catch(() => ({}));
            showToast(err.message || err.error || 'Failed to submit quote request.', 'error');
        }
    } catch (e) {
        showToast('Network error. Please try again.', 'error');
    }
    btn.disabled = false; btn.textContent = 'Send Quote Request';
}
window.openQuoteRequest = openQuoteRequest;
window.closeQuoteModal = closeQuoteModal;
window.submitQuoteRequest = submitQuoteRequest;

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// Ownership radio toggler — prikazuje/sakriva third-party panel
document.addEventListener('change', (ev) => {
    if (ev.target && ev.target.name === 'form-product-ownership') {
        const panel = document.getElementById('third-party-panel');
        if (panel) {
            if (ev.target.value === 'third_party') panel.classList.remove('hidden');
            else panel.classList.add('hidden');
        }
    }
    // KYC entity toggle — Company vs Individual. Prikazuje/sakriva proof-of-address
    // sekciju i menja labelu "Company Details" u "Personal Details" za individualce.
    // Takođe kompletno sakriva/otključava company-only elemente (Directors, UBOs,
    // Trade License, Incorporation, Correspondent Bank, Annual Turnover, opAddr)
    // pa individualcima ne treba da popunjavaju polja koja im ne odgovaraju.
    if (ev.target && ev.target.name === 'kyc-entity-type') {
        const isCompany = ev.target.value === 'company';
        const proofSec = document.getElementById('kyc-sec-proof-address');
        const proofInput = document.getElementById('kyc-proof-address');
        if (proofSec) proofSec.classList.toggle('hidden', isCompany);
        if (proofInput) proofInput.required = !isCompany;

        // Sakrij/otključaj sve elemente sa klasom entity-company-only
        document.querySelectorAll('.entity-company-only').forEach(el => {
            el.classList.toggle('hidden', !isCompany);
            // Ukloni required atribute za sakrivena polja da forma može submitovati.
            el.querySelectorAll('input, select, textarea').forEach(field => {
                if (!isCompany) {
                    if (field.hasAttribute('required')) field.dataset.wasRequired = '1';
                    field.required = false;
                } else if (field.dataset.wasRequired === '1') {
                    field.required = true;
                }
            });
        });

        // Rewordiranje glavne sekcije + labela + hint-ova
        const sec1Label = document.getElementById('lbl-kyc-sec1');
        if (sec1Label) sec1Label.textContent = isCompany ? '1. Company Details' : '1. Personal Details';
        const nameLabel = document.getElementById('lbl-reg-name');
        if (nameLabel) nameLabel.innerHTML = isCompany ? 'Registered Company Name' : 'Full legal name';
        const regNoLabel = document.getElementById('lbl-reg-no');
        if (regNoLabel) regNoLabel.innerHTML = isCompany ? 'Registration No.' : 'National ID / Passport No.';
        const industryLabel = document.getElementById('lbl-industry');
        if (industryLabel) industryLabel.innerHTML = isCompany ? 'Industry / Activity' : 'Profession / Occupation';
        const regAddrLabel = document.getElementById('lbl-reg-addr');
        if (regAddrLabel) regAddrLabel.innerHTML = isCompany ? 'Registered Address' : 'Home Address';
        const phoneLabel = document.getElementById('lbl-kyc-phone');
        if (phoneLabel) phoneLabel.innerHTML = isCompany ? 'Contact Phone' : 'Personal Phone';
        const taxLabel = document.getElementById('lbl-tax-id');
        if (taxLabel) taxLabel.innerHTML = isCompany ? 'Tax ID / VAT' : 'Personal Tax ID / TIN';
        const websiteLabel = document.getElementById('lbl-website');
        if (websiteLabel) websiteLabel.innerHTML = isCompany ? 'Website' : 'Website / LinkedIn (optional)';
        const bankIbanLabel = document.getElementById('lbl-bank-iban');
        if (bankIbanLabel) bankIbanLabel.innerHTML = isCompany ? 'IBAN / Account No.' : 'Personal IBAN / Account No.';
        const bankAddrLabel = document.getElementById('lbl-bank-addr');
        if (bankAddrLabel) bankAddrLabel.innerHTML = isCompany ? 'Bank Branch Address' : 'Bank Branch Address (optional)';
    }
});

function logoutPortal() {
    sessionStorage.removeItem(`portal_auth_${TOKEN}`);
    window.location.href = '/portal/login';
}

function showToast(message, type, opts) {
    type = type || 'info';
    // Backwards-compat: 3. argument je ranije bio broj = durationMs.
    let duration = 3800;
    let requestId = null;
    if (typeof opts === 'number') {
        duration = opts;
    } else if (opts && typeof opts === 'object') {
        if (opts.duration) duration = opts.duration;
        if (opts.requestId) requestId = String(opts.requestId);
    }

    const div = document.createElement('div');
    div.className = `toast toast-${type} fade-in`;
    div.style.maxWidth = '360px';

    const msgSpan = document.createElement('div');
    msgSpan.textContent = message;
    msgSpan.style.lineHeight = '1.4';
    div.appendChild(msgSpan);

    if (requestId) {
        // Klijent vidi kratak "ticket" ID koji admin lako pronađe u /admin/errors.
        const foot = document.createElement('div');
        foot.style.cssText = 'margin-top:6px;display:flex;align-items:center;gap:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,.15);font-size:11px;opacity:.88;';
        const label = document.createElement('span');
        label.textContent = 'Ref:';
        label.style.opacity = '.7';
        const code = document.createElement('code');
        code.textContent = requestId;
        code.style.cssText = 'font-family:ui-monospace,monospace;font-size:11px;background:rgba(255,255,255,.12);padding:1px 6px;border-radius:4px;letter-spacing:.02em;';
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.textContent = 'Copy';
        copyBtn.style.cssText = 'margin-left:auto;background:rgba(255,255,255,.18);border:none;color:inherit;padding:2px 8px;border-radius:4px;font-size:11px;cursor:pointer;';
        copyBtn.onclick = (ev) => {
            ev.stopPropagation();
            try {
                navigator.clipboard.writeText(requestId);
                copyBtn.textContent = 'Copied';
                setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
            } catch (_) {}
        };
        foot.appendChild(label);
        foot.appendChild(code);
        foot.appendChild(copyBtn);
        div.appendChild(foot);
        // Duže vreme jer korisnik mora da kopira ID
        duration = Math.max(duration, 8000);
    }

    document.getElementById('toast-container').appendChild(div);
    setTimeout(() => { div.style.opacity = '0'; div.style.transition = 'opacity .3s'; }, duration);
    setTimeout(() => div.remove(), duration + 400);
}

/**
 * Prikazi grešku iz fetch response-a — ako je 5xx i backend vratio JSON
 * sa `request_id`, pokaži i taj ID uz "Copy" dugme. Za 4xx pokušaj da
 * izvučeš `error`/`message` polje.
 *
 * Usage:
 *   const r = await fetch(url, ...);
 *   if (!r.ok) return apiError(r, 'Operacija nije uspela');
 */
async function apiError(response, defaultMsg) {
    let body = null;
    try { body = await response.json(); } catch (_) {}
    const msg = (body && (body.message || body.error || body.detail)) || defaultMsg || 'Došlo je do greške.';
    const reqId = body && (body.request_id || body.requestId);
    if (response.status >= 500 && reqId) {
        showToast(msg, 'error', { requestId: reqId });
    } else if (response.status >= 500) {
        showToast(`${msg} (HTTP ${response.status})`, 'error');
    } else {
        showToast(msg, 'error');
    }
    return null;
}

function getPersonHtml() {
    // Svaki director/UBO sada ima sopstveni skup polja i uz to per-osoba file upload
    // (pasoš, dokument identifikacije). Podaci se čitaju u kycForm submit handler-u
    // i šalju u payload kao struktuirani objekat: { name, passport, nationality, files: [urls...] }
    return `
    <div class="bg-slate-50 p-3 rounded-lg border border-slate-200 person-entry space-y-2">
        <div class="grid grid-cols-1 md:grid-cols-7 gap-3">
            <div class="md:col-span-3"><input type="text" placeholder="${t('dir_name') || 'Full name'}" class="input text-sm p-name" required></div>
            <div class="md:col-span-2"><input type="text" placeholder="${t('dir_pass') || 'Passport / ID no.'}" class="input text-sm font-mono p-pass" required></div>
            <div class="md:col-span-2 flex gap-2">
                <input type="text" placeholder="${t('dir_nat') || 'Nationality'}" class="input text-sm p-nat" required>
                <button type="button" onclick="this.closest('.person-entry').remove()" class="btn btn-danger small" title="Remove this person">✕</button>
            </div>
        </div>
        <div class="flex items-center gap-3 pt-1 border-t border-slate-200">
            <label class="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex-shrink-0">Passport / ID files</label>
            <input type="file" class="text-xs w-full p-files" accept=".pdf,.jpg,.jpeg,.png" multiple>
        </div>
        <p class="text-[10px] text-slate-500 leading-tight">Upload passport, national ID, or address proof scans for this person. Multiple files allowed.</p>
    </div>`;
}
function addDirector() { const dc = document.getElementById('directors-container'); if (dc) dc.insertAdjacentHTML('beforeend', getPersonHtml()); }
function addUBO() { const uc = document.getElementById('ubos-container'); if (uc) uc.insertAdjacentHTML('beforeend', getPersonHtml()); }

// ==========================================================
//  DASHBOARD
// ==========================================================
// Money is deliberately displayed as "1,234.56 USD" without a currency
// symbol — offers/deals can be in any of USD/EUR/AED/RSD and mixing them
// under a single symbol would misinform the client.
function fmtMoney(v, currency) {
    const n = Number(v || 0);
    return `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}`.trim();
}

function renderDashboard() {
    const deals = portalData?.deals || [];
    const offers = portalData?.offers || [];
    const rfqs = portalData?.my_demands || [];
    const documents = portalData?.documents || [];
    const isActive = d => { const s = (d.status || '').toLowerCase(); return s !== 'completed' && s !== 'closed'; };
    const isOfferOpen = o => {
        if (o.clientStatus === 'declined') return false;
        if (!o.validUntil) return true;
        try { return new Date(o.validUntil) >= new Date(); } catch(e) { return true; }
    };
    const activeDeals = deals.filter(isActive).length;
    const activeOffers = offers.filter(isOfferOpen).length;
    const pendingRfqs = rfqs.filter(r => (r.status || 'pending') === 'pending').length;
    const kycStatus = portalData?.partner?.kycStatus || 'pending';

    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    setTxt('stat-shipments', activeDeals);
    setTxt('stat-offers', activeOffers);
    setTxt('stat-rfqs', pendingRfqs);
    const kycEl = document.getElementById('stat-kyc');
    if (kycEl) {
        kycEl.textContent = t(`kyc_status_${kycStatus}`) !== `kyc_status_${kycStatus}` ? t(`kyc_status_${kycStatus}`) : kycStatus;
    }

    // Financial summary — group by currency because mixing currencies would
    // give a nonsense total. If only one currency is used we show it flat,
    // otherwise a comma-separated per-currency breakdown.
    const sumByCurrency = (rows, priceKey = 'price') => {
        const acc = {};
        rows.forEach(r => {
            const cur = r.currency || 'USD';
            const qty = Number(r.quantity || 1);
            const val = Number(r[priceKey] || 0) * qty;
            acc[cur] = (acc[cur] || 0) + val;
        });
        return acc;
    };
    const renderSum = (acc) => {
        const entries = Object.entries(acc).filter(([_, v]) => v > 0);
        if (entries.length === 0) return '—';
        return entries.map(([c, v]) => fmtMoney(v, c)).join(' + ');
    };
    setTxt('fin-total-spend', renderSum(sumByCurrency(deals.filter(d => (d.status || '').toLowerCase() === 'completed'), 'saleValue')));
    setTxt('fin-open-offers', renderSum(sumByCurrency(offers.filter(isOfferOpen))));
    setTxt('fin-completed-deals', String(deals.filter(d => (d.status || '').toLowerCase() === 'completed').length));
    setTxt('fin-doc-count', String(documents.length));

    // Active-shipment timeline (top open deal — the one the client is
    // most likely to want tracking on right now)
    renderActiveShipmentTimeline(deals);

    // Tab counters
    const setCount = (id, n) => {
        const el = document.getElementById(id); if (!el) return;
        el.textContent = n;
        el.classList.toggle('hidden', !n || n === 0);
    };
    setCount('count-offers', activeOffers);
    setCount('count-docs', (portalData?.documents || []).length);

    // Recent offers on dashboard (top 5)
    const dashOffers = document.getElementById('dash-offers');
    if (dashOffers) {
        if (offers.length === 0) {
            dashOffers.innerHTML = `<p class="text-slate-400 text-sm">${t('no_offers')}</p>`;
        } else {
            dashOffers.innerHTML = offers.slice(0, 5).map(o => `
                <div class="flex justify-between items-center py-2 border-b border-slate-50 last:border-0">
                    <div>
                        <p class="font-semibold text-slate-800">${safeText(o.productName)}</p>
                        <p class="text-xs text-slate-400">${safeText(o.offerNo || '')} · ${o.date ? new Date(o.date).toLocaleDateString() : ''}</p>
                    </div>
                    <p class="text-sm font-semibold text-emerald-600">${o.price || 0} ${safeText(o.currency || '')}</p>
                </div>
            `).join('');
        }
    }
    // Recent documents (top 5)
    const dashDocs = document.getElementById('dash-docs');
    if (dashDocs) {
        const docs = portalData?.documents || [];
        if (docs.length === 0) {
            dashDocs.innerHTML = `<p class="text-slate-400 text-sm">${t('no_docs')}</p>`;
        } else {
            dashDocs.innerHTML = docs.slice(0, 5).map(d => `
                <div class="flex justify-between items-center py-2 border-b border-slate-50 last:border-0">
                    <div>
                        <p class="font-semibold text-slate-800">${safeText(d.fileName || 'Document.pdf')}</p>
                        <p class="text-xs text-slate-400">${safeText(d.docType || 'Document')} · ${d.createdAt ? new Date(d.createdAt).toLocaleDateString() : ''}</p>
                    </div>
                    <button class="btn btn-ghost small text-xs" onclick="downloadPortalDocument('${safeText(d.id)}')">${t('btn_download')}</button>
                </div>
            `).join('');
        }
    }
}

// ==========================================================
//  SHIPMENTS
// ==========================================================
function renderDeals() {
    const container = document.getElementById('deals-container'); if (!container) return;
    const deals = portalData?.deals || [];
    if (deals.length === 0) {
        container.innerHTML = `<div class="panel p-10 text-center"><p class="text-slate-500 text-sm">${t('no_deals')}</p></div>`;
        return;
    }
    container.innerHTML = deals.map(d => {
        const stCls = statusColors[d?.status] || statusColors['default'];
        return `
        <div class="panel overflow-hidden">
            <div class="px-6 py-4 border-b border-slate-100 bg-slate-50/60 flex justify-between items-center">
                <div>
                    <p class="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">${t('contract')}: ${safeText(d?.contractId || 'N/A')}</p>
                    <h3 class="text-base font-semibold text-slate-900">${safeText(d?.productName || 'Product')}</h3>
                    <p class="text-sm text-blue-600 font-medium">${d?.quantity || 0} ${safeText(d?.unit || '')}</p>
                </div>
                <span class="badge ${stCls}">${safeText((d?.status || '').replace('_', ' '))}</span>
            </div>
            <div class="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-6">
                <div><p class="label">${t('vessel')}</p><p class="text-sm font-medium text-slate-800">${safeText(d?.logistics?.vessel || 'TBA')}</p></div>
                <div><p class="label">${t('bl')}</p><p class="text-sm font-medium text-slate-800 font-mono">${safeText(d?.logistics?.blNumber || 'TBA')}</p></div>
                <div><p class="label">${t('pol')}</p><p class="text-sm font-medium text-slate-800">${safeText(d?.logistics?.pol || 'TBA')}</p></div>
                <div><p class="label">${t('pod')}</p><p class="text-sm font-medium text-slate-800">${safeText(d?.logistics?.pod || 'TBA')}</p></div>
            </div>
        </div>`;
    }).join('');
}

// ==========================================================
//  ACTIVE SHIPMENT TIMELINE (dashboard widget)
// ==========================================================
// Timeline stages map to deal status. Anything before/at current status is
// "done", the current status is "active", later stages are pending. If the
// dealStatus does not match the pipeline (e.g. legacy status names) we fall
// back to marking only the first stage as active so nothing lies to the user.
const TIMELINE_STAGES = [
    { key: 'in_negotiation', label: 'In Negotiation' },
    { key: 'signed',          label: 'Contract Signed' },
    { key: 'payment',         label: 'Payment' },
    { key: 'shipped',         label: 'Shipped' },
    { key: 'completed',       label: 'Delivered' }
];
function renderActiveShipmentTimeline(deals) {
    const wrap = document.getElementById('dash-timeline'); if (!wrap) return;
    // Pick the most recent non-completed deal; if none, most recent overall.
    const openDeals = deals.filter(d => (d.status || '').toLowerCase() !== 'completed' && (d.status || '').toLowerCase() !== 'closed');
    const target = openDeals[0] || deals[0];
    if (!target) { wrap.innerHTML = '<p class="text-slate-400 text-sm">No active shipments to track yet.</p>'; return; }

    const status = (target.status || '').toLowerCase();
    const currentIdx = TIMELINE_STAGES.findIndex(s => s.key === status);
    const html = `
        <div class="mb-3 text-xs text-slate-500">
            <span class="font-semibold text-slate-700">${safeText(target.contractId || 'Deal')}</span>
            ${target.productName ? '· ' + safeText(target.productName) : ''}
        </div>
        <div class="flex items-start">
            ${TIMELINE_STAGES.map((s, i) => {
                const cls = currentIdx < 0 ? (i === 0 ? 'active' : '') : (i < currentIdx ? 'done' : (i === currentIdx ? 'active' : ''));
                return `<div class="timeline-stage ${cls}"><div class="dot"></div><div class="timeline-bar"></div><div class="lbl">${s.label}</div></div>`;
            }).join('')}
        </div>`;
    wrap.innerHTML = html;
}

// ==========================================================
//  OFFERS FILTERS
// ==========================================================
let _offersFilter = 'all';
function setOffersFilter(el, val) {
    _offersFilter = val;
    document.querySelectorAll('[data-filter]').forEach(c => c.classList.remove('active'));
    if (el) el.classList.add('active');
    renderOffers();
}

// ==========================================================
//  OFFERS
// ==========================================================
function renderOffers() {
    const container = document.getElementById('offers-container'); if (!container) return;
    let offers = portalData?.offers || [];
    const q = (document.getElementById('offers-search')?.value || '').toLowerCase().trim();
    if (q) offers = offers.filter(o => (`${o.productName || ''} ${o.offerNo || ''} ${o.hsCode || ''}`).toLowerCase().includes(q));
    if (_offersFilter === 'pending') offers = offers.filter(o => !o.clientStatus);
    else if (_offersFilter === 'accepted') offers = offers.filter(o => o.clientStatus === 'accepted');
    else if (_offersFilter === 'declined') offers = offers.filter(o => o.clientStatus === 'declined');
    if (offers.length === 0) {
        container.innerHTML = `<div class="panel p-10 text-center"><p class="text-slate-500 text-sm">${q || _offersFilter !== 'all' ? 'No offers match your filter.' : t('no_offers')}</p></div>`;
        return;
    }
    container.innerHTML = offers.map(o => {
        const statusMap = {
            'accepted': `<span class="badge badge-success">✓ ${t('offer_accepted') || 'Accepted'}</span>`,
            'declined': `<span class="badge badge-danger">✕ ${t('offer_declined') || 'Declined'}</span>`
        };
        const clientStatusBadge = statusMap[o?.clientStatus] || '';
        const canAct = !o?.clientStatus;
        return `
        <div class="panel overflow-hidden">
            <div class="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                <div>
                    <h3 class="text-base font-semibold text-slate-900">${safeText(o?.productName || 'Product')}</h3>
                    <p class="text-[10px] text-slate-400 font-semibold tracking-widest uppercase mt-1">${t('offer_no')}: ${safeText(o?.offerNo || 'N/A')}${o?.date ? ' · ' + new Date(o.date).toLocaleDateString() : ''}</p>
                </div>
                <div class="text-right">
                    <p class="text-xl font-bold text-emerald-600">${o?.price || 0} ${safeText(o?.currency || '')}</p>
                    <p class="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">/ ${safeText(o?.unit || '')}</p>
                    ${clientStatusBadge ? `<div class="mt-2">${clientStatusBadge}</div>` : ''}
                </div>
            </div>
            <div class="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50/50">
                <div><p class="label">${t('qty')}</p><p class="text-sm font-medium text-slate-800">${o?.quantity || 0} ${safeText(o?.unit || '')}</p></div>
                <div><p class="label">${t('incoterm')}</p><p class="text-sm font-medium text-slate-800">${safeText(o?.incoterm || 'N/A')}</p></div>
                <div><p class="label">${t('valid')}</p><p class="text-sm font-medium text-red-600">${o?.validUntil ? new Date(o.validUntil).toLocaleDateString() : 'N/A'}</p></div>
                <div><p class="label">${t('hs_code') || 'HS Code'}</p><p class="text-sm font-mono font-medium text-slate-800">${safeText(o?.hsCode || o?.productHsCode || 'N/A')}</p></div>
                ${o?.packaging ? `<div class="col-span-2"><p class="label">${t('packaging') || 'Packaging'}</p><p class="text-sm font-medium text-slate-800">${safeText(o.packaging)}</p></div>` : ''}
                ${o?.paymentTerms ? `<div class="col-span-2"><p class="label">${t('payment_terms') || 'Payment Terms'}</p><p class="text-sm font-medium text-slate-800">${safeText(o.paymentTerms)}</p></div>` : ''}
                ${o?.pol || o?.pod ? `<div class="col-span-2"><p class="label">${t('shipping') || 'Shipping'}</p><p class="text-sm font-medium text-slate-800">${safeText(o?.pol || 'TBA')} → ${safeText(o?.pod || 'TBA')}</p></div>` : ''}
                ${o?.detailedSpec || o?.productSpec ? `<div class="col-span-4"><p class="label">${t('specification') || 'Specification'}</p><p class="text-sm text-slate-700 whitespace-pre-wrap">${safeText(o?.detailedSpec || o?.productSpec)}</p></div>` : ''}
            </div>
            <div class="px-6 py-3 border-t border-slate-100 flex justify-between items-center gap-2">
                <div class="flex gap-2">
                    ${o?.documentId ? `<button class="btn btn-ghost small text-xs" onclick="downloadPortalDocument('${safeText(o.documentId)}')">${t('btn_download_pdf') || 'Download PDF'}</button>` : ''}
                    <button class="btn btn-ghost small text-xs" onclick="showOfferDetail('${safeText(o.id)}')">${t('view_details') || 'View Details'}</button>
                    <button class="btn btn-ghost small text-xs" onclick="openPortalLogistics('${safeText(o.id)}')" title="Multimodal shipping planner">🌍 ${t('logistics_planner') || 'Route Planner'}</button>
                </div>
                <div class="flex gap-2">
                    ${canAct ? `
                        <button class="btn btn-danger small text-xs" onclick="respondToOffer('${safeText(o.id)}', 'decline')">${t('offer_decline') || 'Decline'}</button>
                        <button class="btn btn-primary small text-xs" onclick="respondToOffer('${safeText(o.id)}', 'accept')">${t('offer_accept') || 'Accept Offer'}</button>
                    ` : ''}
                </div>
            </div>
        </div>`;
    }).join('');
}

// Accept/decline — koristimo profesionalan modal umesto native confirm/prompt.
// Za decline TRAŽIMO razlog (obavezno), jer admin taj podatak inače nema kako
// da vidi zašto je klijent odbio ponudu.
async function respondToOffer(offerId, action) {
    // Guard #1: da li imamo aktivnu sesiju uopšte?
    if (!authKey || !TOKEN) {
        showToast('Your session has expired. Please refresh the page and sign in again.', 'error', 6000);
        return;
    }
    // Guard #2: da li je askConfirm / askInput uopšte učitan?
    if (typeof askConfirm !== 'function' || typeof askInput !== 'function') {
        console.error('respondToOffer: askConfirm/askInput missing — portal ui.js failed to load properly');
        // Fallback na native da barem nešto radi
        if (action === 'accept') {
            if (!confirm('Accept this offer? Your account manager will contact you to finalize.')) return;
        } else {
            const r = prompt('Please provide a reason for declining this offer:');
            if (!r || r.trim().length < 3) return;
            var declineNote = r.trim();
        }
    }

    let note = '';
    let signature = null;
    if (action === 'accept') {
        // E-signature capture — replace old plain confirm with signed acceptance.
        // Falls back to askConfirm if SignaturePad module didn't load (offline
        // fallback za slucaj da signature_pad.js nije stigao do klijenta).
        if (typeof SignaturePad !== 'undefined') {
            const partnerName = (portalData?.partner?.contactPerson || portalData?.partner?.companyName || '').trim();
            const sig = await SignaturePad.open({
                title: 'Sign to accept offer',
                signerName: partnerName,
                description: 'By signing below you accept the terms of this offer. Your signature will be embedded into the acceptance record, together with a timestamp and audit trail.',
                confirmText: 'Sign & Accept offer',
            });
            if (!sig || !sig.signed) return;
            signature = {
                dataUrl: sig.dataUrl,
                signerName: sig.signerName,
                signedAt: sig.signedAt,
                userAgent: sig.userAgent,
            };
        } else if (typeof askConfirm === 'function') {
            const yes = await askConfirm(
                'Accept this offer',
                'By accepting, your account manager will contact you shortly to finalize the deal. Continue?',
                { confirmText: 'Yes, accept', cancelText: 'Cancel' }
            );
            if (!yes) return;
        }
    } else {
        if (typeof askInput === 'function') {
            const answer = await askInput('Decline this offer', {
                description: 'Please tell us why. Your feedback goes directly to our team and helps us respond better.',
                inputType: 'textarea', multiline: true, required: true,
                placeholder: 'e.g. Price is too high, timing does not fit, alternative supplier chosen…',
                confirmText: 'Decline offer',
                cancelText: 'Cancel',
                danger: true,
                validator: v => (v && v.trim().length >= 3) ? null : 'Please provide at least a few words.'
            });
            if (answer === null || answer === undefined) return;   // korisnik otkazao
            note = String(answer).trim();
        } else if (typeof declineNote !== 'undefined') {
            note = declineNote;
        } else {
            return;
        }
    }

    // Loader pruža vizuelnu potvrdu da se nešto događa
    if (typeof showLoader === 'function') showLoader(action === 'accept' ? 'Recording your acceptance…' : 'Recording your decline…');

    try {
        const res = await fetch(`/api/portal/offers/accept/${TOKEN}/${offerId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Portal-Auth': authKey },
            body: JSON.stringify({ action, note, signature })
        });
        if (typeof hideLoader === 'function') hideLoader();
        if (res.ok) {
            showToast(action === 'accept' ? 'Offer accepted. Thank you — our team will contact you shortly.' : 'Offer declined. Our team will follow up.', 'success', 4500);
            // Sačekaj tren da toast bude vidljiv, pa osveži
            setTimeout(() => { if (typeof loadPortalData === 'function') loadPortalData(); }, 400);
            return;
        }
        // Neuspeh — čitaj konkretnu server poruku pa je jasno pokažemo user-u
        let errText = 'Something went wrong. Please try again.';
        try {
            const j = await res.json();
            if (j && (j.message || j.error)) errText = j.message || j.error;
            if (j && j.error === 'UNAUTHORIZED') errText = 'Your session has expired. Please refresh and sign in again.';
            if (j && j.error === 'DECLINE_REASON_REQUIRED') errText = 'Please provide a short reason for declining.';
        } catch (_) { /* not JSON */ }
        showToast(`Failed to ${action} offer: ${errText}`, 'error', 6000);
    } catch (netErr) {
        if (typeof hideLoader === 'function') hideLoader();
        console.error('respondToOffer network error:', netErr);
        showToast('Network error — please check your connection and try again.', 'error', 6000);
    }
}

// Detaljan prikaz ponude (modal) — sa firm-branded letterheadom identičnim kao na PDF-u
function showOfferDetail(offerId) {
    const o = (portalData?.offers || []).find(x => x.id === offerId);
    if (!o) return;
    const co = portalData?.company || {};
    const brand = co.brandColor || '#2563eb';
    const compName = co.name || 'Aspidus';
    const logoHtml = co.logoUrl
        ? `<img src="${safeText(co.logoUrl)}" alt="${safeText(compName)}" style="height:44px;max-width:180px;object-fit:contain;background:#ffffff;padding:4px 8px;border-radius:6px;"/>`
        : `<div style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-0.02em;">${safeText(compName)}</div>`;

    let modal = document.getElementById('offer-detail-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'offer-detail-modal';
        modal.className = 'fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 hidden items-center justify-center p-4';
        document.body.appendChild(modal);
    }
    modal.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-3xl w-full max-h-[92vh] overflow-hidden flex flex-col">
      <!-- LETTERHEAD — identično kao na PDF verziji ponude (logo levo, meta desno, brand-color) -->
      <div style="background:${brand};padding:18px 24px;display:flex;justify-content:space-between;align-items:center;">
        <div>${logoHtml}</div>
        <div style="text-align:right;color:#ffffff;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;opacity:0.85;">Commercial Offer</div>
          <div style="font-family:'Courier New',monospace;font-size:14px;font-weight:700;margin-top:2px;">${safeText(o.offerNo || 'N/A')}</div>
        </div>
      </div>
      <div style="background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:10px 24px;display:flex;justify-content:space-between;font-size:11px;color:#475569;">
        <span>${safeText(compName)}${co.address ? ' · ' + safeText(String(co.address).replace(/\n/g,', ')) : ''}${co.taxId ? ' · Tax ID: ' + safeText(co.taxId) : ''}</span>
        <span>${o.date ? new Date(o.date).toLocaleDateString() : ''}</span>
      </div>

      <div class="flex justify-between items-center border-b border-slate-100 px-6 py-4">
        <div>
          <h3 class="text-lg font-semibold text-slate-900">${safeText(o.productName)}</h3>
          <p class="text-xs text-slate-400 mt-0.5">${t('offer_no')}: ${safeText(o.offerNo)} · ${o.date ? new Date(o.date).toLocaleDateString() : ''}</p>
        </div>
        <button class="icon-btn" onclick="closeOfferDetail()">✕</button>
      </div>
      <div class="p-6 overflow-y-auto flex-1 space-y-5">
        <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div><p class="label">${t('price')}</p><p class="text-lg font-bold text-emerald-600">${o.price || 0} ${safeText(o.currency || '')} / ${safeText(o.unit || '')}</p></div>
          <div><p class="label">${t('qty')}</p><p class="text-sm font-medium">${safeText(o.quantity || '')} ${safeText(o.unit || '')}</p></div>
          <div><p class="label">${t('incoterm')}</p><p class="text-sm font-medium">${safeText(o.incoterm || 'N/A')}</p></div>
          <div><p class="label">${t('valid')}</p><p class="text-sm font-medium">${o.validUntil ? new Date(o.validUntil).toLocaleDateString() : 'N/A'}</p></div>
          <div><p class="label">${t('hs_code') || 'HS Code'}</p><p class="text-sm font-mono">${safeText(o.hsCode || o.productHsCode || 'N/A')}</p></div>
          <div><p class="label">${t('origin') || 'Origin'}</p><p class="text-sm">${safeText(o.origin || o.productOrigin || 'N/A')}</p></div>
        </div>
        ${o.packaging ? `<div><p class="label">${t('packaging') || 'Packaging'}</p><p class="text-sm">${safeText(o.packaging)}</p></div>` : ''}
        ${o.paymentTerms ? `<div><p class="label">${t('payment_terms') || 'Payment Terms'}</p><p class="text-sm">${safeText(o.paymentTerms)}</p></div>` : ''}
        ${o.leadTime ? `<div><p class="label">${t('lead_time') || 'Lead Time'}</p><p class="text-sm">${safeText(o.leadTime)}</p></div>` : ''}
        ${(o.pol || o.pod) ? `<div><p class="label">${t('shipping') || 'Shipping'}</p><p class="text-sm">${safeText(o.pol || 'TBA')} → ${safeText(o.pod || 'TBA')}${o.vessel ? ' · ' + safeText(o.vessel) : ''}</p></div>` : ''}
        ${o.detailedSpec || o.productSpec ? `<div><p class="label">${t('specification') || 'Specification'}</p><pre class="text-sm text-slate-700 whitespace-pre-wrap font-sans bg-slate-50 border border-slate-200 rounded-lg p-3">${safeText(o.detailedSpec || o.productSpec)}</pre></div>` : ''}
        ${o.notes ? `<div><p class="label">${t('notes') || 'Notes'}</p><p class="text-sm italic">${safeText(o.notes)}</p></div>` : ''}
      </div>
      <!-- Confidentiality footer — isti kao na PDF-u i mejlovima -->
      <div style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:10px 24px;font-size:10px;color:#64748b;line-height:1.5;">
        <strong style="color:#334155;">CONFIDENTIALITY NOTICE</strong> — This offer and any attached documents are strictly confidential and intended solely for the named recipient. Prices and terms are valid until the "Valid Until" date shown above.
      </div>

      <div class="p-4 border-t border-slate-200 bg-slate-50 flex justify-between items-center gap-2">
        <button class="btn btn-ghost text-xs" style="color:#dc2626;" onclick="hidePortalItem('offer','${safeText(o.id)}','${safeText(o.offerNo || 'this offer')}')" title="Ukloni sa mog view-a (admin i dalje vidi u CRM-u)">🗑️ ${t('hide_from_view') || 'Hide from my view'}</button>
        <div class="flex gap-2">
          ${o.documentId ? `<button class="btn btn-ghost" onclick="downloadPortalDocument('${safeText(o.documentId)}'); closeOfferDetail();">${t('btn_download_pdf') || 'Download PDF'}</button>` : ''}
          <button class="btn btn-ghost" onclick="closeOfferDetail()">${t('close') || 'Close'}</button>
        </div>
      </div>
    </div>`;
    modal.classList.remove('hidden'); modal.classList.add('flex');
}


// ==========================================================
//  HIDE FROM VIEW — client soft-delete (admin i dalje vidi u CRM-u)
// ==========================================================
async function hidePortalItem(entityType, entityId, humanLabel) {
    if (!authKey || !TOKEN) {
        showToast('Session expired. Please refresh and sign in again.', 'error');
        return;
    }
    const label = humanLabel || entityId;
    const ok = await askConfirm(
        (t('hide_confirm_title') || 'Hide from my view?'),
        (t('hide_confirm_body') || 'This will remove {label} from your portal view. Your account manager will still see it in the system. You can restore it later from "View hidden items".').replace('{label}', label),
        { danger: true, confirmText: (t('hide') || 'Hide') }
    );
    if (!ok) return;

    try {
        const res = await fetch(`/api/portal/hide/${TOKEN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Portal-Auth': authKey },
            body: JSON.stringify({ entity_type: entityType, entity_id: entityId })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        showToast((t('hidden_ok') || 'Removed from your view.'), 'success');
        closeOfferDetail();
        if (typeof refreshPortalData === 'function') refreshPortalData();
        else location.reload();
    } catch (e) {
        showToast('Could not hide: ' + (e.message || e), 'error');
    }
}

async function showHiddenItems() {
    if (!authKey || !TOKEN) return;
    try {
        const res = await fetch(`/api/portal/hidden/${TOKEN}`, {
            headers: { 'X-Portal-Auth': authKey }
        });
        const data = await res.json();
        const items = data.hidden || [];
        if (items.length === 0) {
            showToast(t('no_hidden_items') || 'No hidden items — your portal view is complete.', 'info');
            return;
        }
        // Show a modal listing hidden items with "Restore" buttons
        let m = document.getElementById('hidden-items-modal');
        if (!m) {
            m = document.createElement('div');
            m.id = 'hidden-items-modal';
            m.className = 'fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 hidden items-center justify-center p-4';
            document.body.appendChild(m);
        }
        m.innerHTML = `
          <div class="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div class="flex justify-between items-center px-6 py-4 border-b border-slate-100">
              <h3 class="text-base font-semibold text-slate-900">🗄️ ${t('hidden_items_title') || 'Hidden Items'}</h3>
              <button class="icon-btn" onclick="document.getElementById('hidden-items-modal').classList.add('hidden')">✕</button>
            </div>
            <div class="p-4 overflow-y-auto flex-1 space-y-2">
              ${items.map(it => `
                <div class="flex justify-between items-center bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  <div>
                    <div class="text-xs font-semibold text-slate-700 uppercase tracking-widest">${safeText(it.entity_type)}</div>
                    <div class="text-sm text-slate-900 font-mono">${safeText(it.entity_id)}</div>
                    <div class="text-[10px] text-slate-400">Hidden ${new Date(it.hidden_at).toLocaleString()}</div>
                  </div>
                  <button class="btn btn-primary small text-xs" onclick="unhidePortalItem('${safeText(it.entity_type)}','${safeText(it.entity_id)}')">${t('restore') || 'Restore'}</button>
                </div>
              `).join('')}
            </div>
          </div>`;
        m.classList.remove('hidden'); m.classList.add('flex');
    } catch (e) {
        showToast('Could not load hidden items: ' + (e.message || e), 'error');
    }
}

async function unhidePortalItem(entityType, entityId) {
    try {
        const res = await fetch(`/api/portal/unhide/${TOKEN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Portal-Auth': authKey },
            body: JSON.stringify({ entity_type: entityType, entity_id: entityId })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        showToast((t('restored_ok') || 'Restored to your view.'), 'success');
        const m = document.getElementById('hidden-items-modal');
        if (m) m.classList.add('hidden');
        if (typeof refreshPortalData === 'function') refreshPortalData();
        else location.reload();
    } catch (e) {
        showToast('Restore failed: ' + (e.message || e), 'error');
    }
}
window.hidePortalItem = hidePortalItem;
window.showHiddenItems = showHiddenItems;
window.unhidePortalItem = unhidePortalItem;
function closeOfferDetail() { const m = document.getElementById('offer-detail-modal'); if (m) { m.classList.add('hidden'); m.classList.remove('flex'); } }

// ==========================================================
//  LOGISTICS PLANNER (portal)
// ==========================================================
// Klijent može, iz svoje ponude, da pogleda predloženu multimodalnu rutu
// (kopno → more/vazduh → kopno) sa procenom vremena, distance i CO2.
// Podaci se pune iz same ponude i profila klijenta (buyer address).
function openPortalLogistics(offerId) {
    const offer = (portalData?.offers || []).find(o => o.id === offerId);
    if (!offer) return;
    if (typeof window.openLogisticsPlanner !== 'function') {
        alert('Logistics planner module not loaded. Please refresh the page.');
        return;
    }
    // Polazište: adresa naše (prodavčeve) firme iz profila brenda ako je poslata
    const originAddr = (portalData?.company_profile && [
        portalData.company_profile.address,
        portalData.company_profile.city,
        portalData.company_profile.country
    ].filter(Boolean).join(', ')) || 'Rotterdam, Netherlands';
    // Odredište: adresa klijenta iz profila portala
    const p = portalData?.profile || {};
    const destAddr = [p.address, p.city, p.country].filter(Boolean).join(', ');

    // Teret
    const qty = parseFloat(offer.quantity) || 20;
    const unit = String(offer.unit || 'MT').toLowerCase();
    const cargoTons = unit === 'kg' ? qty / 1000 : qty;

    window.openLogisticsPlanner({
        origin: { address: originAddr },
        destination: destAddr ? { address: destAddr } : null,
        cargoTons,
        apiBase: '/api/portal/logistics',
        portalAuth: (typeof authKey !== 'undefined') ? authKey : null,
    });
}

// ==========================================================
//  RFQ
// ==========================================================
function openRFQModal() {
    ['rfq-product','rfq-qty','rfq-price','rfq-notes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const m = document.getElementById('rfq-modal'); m.classList.remove('hidden'); m.classList.add('flex');
}
function closeRFQModal() {
    const m = document.getElementById('rfq-modal'); m.classList.add('hidden'); m.classList.remove('flex');
}
function renderRFQs() {
    const container = document.getElementById('rfq-container'); if (!container) return;
    const rfqs = portalData?.my_demands || [];
    if (rfqs.length === 0) { container.innerHTML = `<div class="p-8 text-center text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">${t('no_rfq')}</div>`; return; }
    container.innerHTML = rfqs.map(d => `
        <div class="p-4 border border-slate-200 rounded-xl flex justify-between items-center bg-white hover:bg-slate-50 transition-colors">
            <div>
                <h4 class="text-sm font-semibold text-slate-900">${safeText(d?.productName || 'Product')}</h4>
                <p class="text-xs text-slate-500 mt-1">
                    ${d?.date ? new Date(d.date).toLocaleDateString() : ''} · Qty: ${d?.quantity || 0}${d?.targetPrice ? ` · Target: $${d.targetPrice}` : ''}
                </p>
            </div>
            <span class="badge ${statusColors[d?.status] || statusColors['default']}">${safeText(d?.status || 'pending')}</span>
        </div>
    `).join('');
}

// ==========================================================
//  DOCUMENTS FILTERS & EXPORT
// ==========================================================
let _docsFilter = 'all';
function setDocsFilter(el, val) {
    _docsFilter = val;
    document.querySelectorAll('[data-doc-filter]').forEach(c => c.classList.remove('active'));
    if (el) el.classList.add('active');
    renderDocuments();
}

// CSV export of the download history helps the client keep an audit trail
// on their side (procurement/compliance often want a record).
function exportDocumentsHistory() {
    const docs = portalData?.documents || [];
    if (docs.length === 0) { showToast('No documents to export.', 'info'); return; }
    const rows = [
        ['Date', 'Type', 'File name', 'Document ID'],
        ...docs.map(d => [
            d.createdAt ? new Date(d.createdAt).toISOString() : '',
            d.docType || 'Document',
            d.fileName || '',
            d.id || ''
        ])
    ];
    const csv = rows.map(r => r.map(f => {
        const s = String(f == null ? '' : f);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `document-history-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    showToast('Document history exported.', 'success');
}

// ==========================================================
//  DOCUMENTS
// ==========================================================
function renderDocuments() {
    const body = document.getElementById('documents-table-body'); if (!body) return;
    let docs = portalData?.documents || [];
    const q = (document.getElementById('docs-search')?.value || '').toLowerCase().trim();
    if (q) docs = docs.filter(d => (`${d.fileName || ''} ${d.docType || ''}`).toLowerCase().includes(q));
    if (_docsFilter !== 'all') docs = docs.filter(d => (d.docType || '').toUpperCase() === _docsFilter);
    if (docs.length === 0) {
        body.innerHTML = `<tr><td colspan="4" class="py-8 px-3 text-center text-slate-400 text-sm">${q || _docsFilter !== 'all' ? 'No documents match your filter.' : t('no_docs')}</td></tr>`;
        return;
    }
    body.innerHTML = docs.map(d => `
        <tr class="row-hover">
            <td class="py-3 px-3 text-xs text-slate-500 whitespace-nowrap">${d.createdAt ? new Date(d.createdAt).toLocaleDateString() : ''}</td>
            <td class="py-3 px-3"><span class="badge badge-muted">${safeText(d.docType || 'Document')}</span></td>
            <td class="py-3 px-3 text-sm font-medium text-slate-900">${safeText(d.fileName || 'Document.pdf')}</td>
            <td class="py-3 px-3 text-right">
                <div class="inline-flex gap-1">
                    <button class="btn btn-ghost small text-xs" onclick="downloadPortalDocument('${safeText(d.id)}')" title="${t('btn_download') || 'Download'}">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5"><path d="M12 3v14m-5-5l5 5 5-5M5 21h14"/></svg>
                        ${t('btn_download') || 'Download'}
                    </button>
                    <button class="btn btn-ghost small text-xs" style="color:#dc2626;"
                            onclick="hidePortalItem('document','${safeText(d.id)}','${safeText(d.fileName || d.docType || 'this document')}')"
                            title="Ukloni sa mog view-a (admin i dalje vidi)">🗑️</button>
                </div>
            </td>
        </tr>
    `).join('');
}

// ==========================================================
//  PRODUCTS (my_products) — same table, cleaner style
// ==========================================================
function renderGoodsTable() {
    const body = document.getElementById('goods-table-body'); if (!body) return;
    const items = portalData?.my_products || [];
    if (items.length === 0) {
        body.innerHTML = `<tr><td colspan="5" class="py-8 px-3 text-center text-slate-400 text-sm">${t('no_products')}</td></tr>`;
        return;
    }
    body.innerHTML = items.map(p => {
        const off = p.data.supplyOffers && p.data.supplyOffers.length > 0 ? p.data.supplyOffers[0] : {};
        return `
        <tr class="row-hover">
            <td class="py-3 px-3">
                <div class="font-semibold text-slate-900">${safeText(p.data.name)}</div>
                <div class="text-xs text-slate-400 font-mono">${safeText(p.data.sku || '')}</div>
            </td>
            <td class="py-3 px-3 font-mono font-semibold text-emerald-600">${off.price || 0} ${safeText(off.currency || 'USD')} <span class="text-xs text-slate-400">/ ${safeText(off.unit || 'MT')}</span></td>
            <td class="py-3 px-3 text-xs text-slate-600 max-w-xs truncate">${safeText(p.data.detailedSpec || p.data.shortDescription || 'N/A')}</td>
            <td class="py-3 px-3"><span class="badge ${statusColors[p.status] || statusColors['default']}">${safeText(p.status)}</span></td>
            <td class="py-3 px-3 text-right">
                <button class="btn btn-ghost small text-xs" onclick="editProductItem('${safeText(p.id)}')">${t('btn_edit')}</button>
            </td>
        </tr>`;
    }).join('');
}

function renderPortalCOA() {
    const list = document.getElementById('portal-coa-list'); if (!list) return;
    list.innerHTML = activeCOAParams.map((c, i) => `
        <div class="flex items-center justify-between bg-slate-50 border border-slate-200 rounded p-2 text-xs">
            <span><span class="text-slate-400 uppercase text-[9px] mr-2">${safeText(c.name)}:</span> ${safeText(c.value)}</span>
            <button type="button" class="text-red-500 hover:bg-red-50 px-2 py-0.5 rounded" onclick="removePortalCOA(${i})">✕</button>
        </div>
    `).join('');
}
function addPortalCOA() {
    const n = document.getElementById('p-coa-name').value.trim();
    const v = document.getElementById('p-coa-value').value.trim();
    if (n && v) { activeCOAParams.push({ name: n, value: v }); document.getElementById('p-coa-name').value=''; document.getElementById('p-coa-value').value=''; renderPortalCOA(); }
}
window.removePortalCOA = function(i) { activeCOAParams.splice(i, 1); renderPortalCOA(); };

function openProductModal() {
    document.getElementById('product-form').reset();
    document.getElementById('form-product-id').value = '';
    document.getElementById('form-existing-certs').innerHTML = '';
    uploadedCertUrls = []; activeCOAParams = []; renderPortalCOA();
    const m = document.getElementById('product-modal'); m.classList.remove('hidden'); m.classList.add('flex');
}
function closeProductModal() {
    const m = document.getElementById('product-modal'); m.classList.add('hidden'); m.classList.remove('flex');
}
function editProductItem(id) {
    const prod = (portalData?.my_products || []).find(p => p.id === id); if (!prod) return;
    const set = (elId, v) => { const el = document.getElementById(elId); if (el) el.value = v || ''; };
    set('form-product-id', prod.id);
    set('form-product-name', prod.data.name);
    set('form-product-category', prod.data.category);
    set('form-product-hscode', prod.data.hsCode);
    set('form-product-sku', prod.data.sku);
    set('form-product-brand', prod.data.brand);
    set('form-product-shortdesc', prod.data.shortDescription);
    set('form-product-cap20', prod.data.logistics?.cap20);
    set('form-product-cap40', prod.data.logistics?.cap40);
    set('form-product-spec', prod.data.detailedSpec);
    set('form-product-packaging', prod.data.packaging);
    set('form-product-package-weight', prod.data.packageWeight);
    set('form-product-per-pallet', prod.data.unitsPerPallet);
    set('form-product-stock', prod.data.availableStock);
    set('form-product-warehouse', prod.data.warehouseLocation);
    set('form-product-leadtime', prod.data.leadTime);

    const off = prod.data.supplyOffers && prod.data.supplyOffers.length > 0 ? prod.data.supplyOffers[0] : {};
    set('form-product-price', off.price);
    set('form-product-currency', off.currency || 'USD');
    set('form-product-unit', off.unit || 'MT');
    set('form-product-moq', off.moq);
    set('form-product-incoterm', off.incoterm || 'FOB');
    set('form-product-origin', off.country);
    set('form-product-valid', off.validUntil);
    set('form-product-payterms', off.paymentTerms);

    activeCOAParams = prod.data.coaParams || []; renderPortalCOA();
    uploadedCertUrls = off.certificates ? off.certificates.split(', ').filter(Boolean) : [];
    document.getElementById('form-existing-certs').innerHTML = uploadedCertUrls.map((c, i) => `<a href="${safeText(c)}" target="_blank" class="block">✓ Certificate #${i+1}</a>`).join('');
    const m = document.getElementById('product-modal'); m.classList.remove('hidden'); m.classList.add('flex');
}

// Product modal tabs
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.ptab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.ptab-btn').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            document.querySelectorAll('.ptab-pane').forEach(p => p.classList.add('hidden'));
            const targetEl = document.getElementById(e.currentTarget.dataset.target);
            if (targetEl) targetEl.classList.remove('hidden');
        });
    });

    // IBAN live validation on KYC bank field.
    // Ako korisnik unese IBAN-format string (starts sa 2 slova), radimo full
    // ISO 13616 provera; ako nije IBAN (npr. lokalni broj računa), ne blokiramo.
    const ibanInp = document.getElementById('kyc-bank-iban');
    const ibanStatus = document.getElementById('kyc-bank-iban-status');
    if (ibanInp && ibanStatus && typeof IBAN !== 'undefined') {
        const check = () => {
            const raw = (ibanInp.value || '').trim();
            if (!raw) { ibanStatus.textContent = ''; ibanStatus.style.color = ''; return; }
            // Heuristic: format izgleda kao IBAN samo ako počinje sa 2 slova
            if (!/^[A-Za-z]{2}/.test(raw)) {
                ibanStatus.textContent = 'ℹ Local account number (not IBAN format) — SWIFT wire may not work internationally';
                ibanStatus.style.color = '#a16207';
                return;
            }
            const res = IBAN.validate(raw);
            if (res.valid) {
                ibanInp.value = res.formatted;  // reformat u grupe od 4
                ibanStatus.textContent = `✓ Valid IBAN — ${res.country} (${res.length} chars)`;
                ibanStatus.style.color = '#059669';
            } else {
                ibanStatus.textContent = `✗ ${res.message}`;
                ibanStatus.style.color = '#dc2626';
            }
        };
        ibanInp.addEventListener('blur', check);
        ibanInp.addEventListener('input', () => {
            // Silent while typing — only show when full-length hit
            const raw = (ibanInp.value || '').replace(/\s/g, '');
            if (raw.length >= 15) check();
            else if (ibanStatus.textContent && !ibanStatus.textContent.startsWith('✓')) {
                ibanStatus.textContent = '';
            }
        });
    }

    // BIC/SWIFT live validation on KYC bank field.
    // Cross-check protiv IBAN country code kad je IBAN validan — potrebno je da
    // BIC country prefix odgovara IBAN prefix-u da nema greške u wire transfer-u.
    const swiftInp = document.getElementById('kyc-bank-swift');
    const swiftStatus = document.getElementById('kyc-bank-swift-status');
    if (swiftInp && swiftStatus && typeof BIC !== 'undefined') {
        const checkBic = () => {
            const raw = (swiftInp.value || '').trim();
            if (!raw) { swiftStatus.textContent = ''; return; }
            // Ako je IBAN validan, izvuci country za cross-check
            let expected = null;
            const ibanRaw = (document.getElementById('kyc-bank-iban')?.value || '').replace(/\s/g, '');
            if (ibanRaw.length >= 4 && /^[A-Z]{2}/.test(ibanRaw)) expected = ibanRaw.slice(0, 2);
            const r = BIC.validate(raw, expected);
            if (r.valid) {
                swiftInp.value = r.formatted;
                swiftStatus.textContent = `✓ Valid BIC — ${r.country_code} bank ${r.bank_code}${r.is_hq ? ' (HQ)' : ` branch ${r.branch_code}`}${r.is_test ? ' [TEST]' : ''}`;
                swiftStatus.style.color = '#059669';
            } else {
                swiftStatus.textContent = `✗ ${r.message}`;
                swiftStatus.style.color = '#dc2626';
            }
        };
        swiftInp.addEventListener('blur', checkBic);
        swiftInp.addEventListener('input', () => {
            const raw = (swiftInp.value || '').replace(/\s/g, '');
            if (raw.length === 8 || raw.length === 11) checkBic();
            else if (swiftStatus.textContent && !swiftStatus.textContent.startsWith('✓')) {
                swiftStatus.textContent = '';
            }
        });
    }

    // Auto-fill dial code when country changes on KYC.
    // Uses bundled ISO_COUNTRIES for instant offline; then hits REST Countries
    // proxy for confirmation (updates flag/capital hint if UI has them).
    const kycCountry = document.getElementById('kyc-country');
    const kycPhone = document.getElementById('kyc-phone');
    if (kycCountry) {
        kycCountry.addEventListener('change', async () => {
            const name = (kycCountry.value || '').trim();
            if (!name || typeof ISO_COUNTRIES === 'undefined') return;
            const c = ISO_COUNTRIES.byName(name);
            if (!c) return;
            // Predloži dial code samo ako telefon nije već popunjen
            if (kycPhone && !kycPhone.value && c.dial) {
                kycPhone.placeholder = `${c.dial} 123 456 789`;
                kycPhone.value = c.dial + ' ';
                kycPhone.focus();
                kycPhone.setSelectionRange(kycPhone.value.length, kycPhone.value.length);
            }
            // Best-effort REST Countries confirmation (network); ne blokira UX
            try {
                const res = await fetch(`/api/geo/portal/country/${c.alpha2}`);
                if (res.ok) {
                    const rc = await res.json();
                    // Ako ISO_COUNTRIES nema currency ili dial, dopuni iz live-a
                    if (rc && rc.dial_code && kycPhone && !kycPhone.value.trim().replace(/\+/g,'').match(/\d/)) {
                        kycPhone.value = rc.dial_code + ' ';
                    }
                }
            } catch(_) { /* offline OK */ }
        });
    }
});

// ==========================================================
//  PROFILE
// ==========================================================
function fillProfile() {
    const p = portalData?.partner || {};
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    set('profile-email', p.email || '');
    set('profile-phone', p.phone || '');
    set('profile-person', p.contactPerson || '');
    set('profile-city', p.address?.city || '');
    set('profile-street', p.address?.street || '');
    set('profile-country', p.address?.country || '');
    set('profile-note', '');

    const list = document.getElementById('profile-requests-body');
    const reqs = portalData?.my_profile_requests || [];
    if (!list) return;
    if (reqs.length === 0) {
        list.innerHTML = `<p class="text-slate-400 text-sm">${t('no_profile_requests')}</p>`;
        return;
    }
    list.innerHTML = reqs.map(r => {
        const changesText = Object.entries(r.changes || {}).filter(([k]) => k !== 'note').map(([k, v]) => `<span class="text-slate-500 text-xs mr-3"><strong>${safeText(k)}:</strong> ${safeText(v)}</span>`).join(' ');
        return `
        <div class="p-3 rounded-lg border border-slate-200 flex justify-between items-center bg-slate-50/60">
            <div>
                <div class="text-xs text-slate-400">${r.submitted_at ? new Date(r.submitted_at).toLocaleString() : ''}</div>
                <div class="mt-1">${changesText}</div>
                ${r.changes?.note ? `<div class="text-xs text-slate-500 italic mt-1">"${safeText(r.changes.note)}"</div>` : ''}
            </div>
            <span class="badge ${statusColors[r.status] || statusColors['default']}">${safeText(r.status)}</span>
        </div>`;
    }).join('');
}

// ==========================================================
//  KYC STATUS BADGE
// ==========================================================
function renderKycStatusLine() {
    const line = document.getElementById('kyc-status-line'); if (!line) return;
    const status = portalData?.partner?.kycStatus;
    if (!status) { line.classList.add('hidden'); return; }
    const label = t(`kyc_status_${status}`) !== `kyc_status_${status}` ? t(`kyc_status_${status}`) : status;
    line.classList.remove('hidden');
    line.innerHTML = `<span class="badge ${statusColors[status] || statusColors['default']}">${t('kyc_current_status')}: ${safeText(label)}</span>`;
}

// ==========================================================
//  Permisije (za portalPermissions iz partner zapisa)
// ==========================================================
// ==========================================================
//  NOTIFICATIONS
// ==========================================================
// Client-side derived notifications feed. Derived (not stored) events give
// the client a live at-a-glance view of things that need attention right
// now — new offers, KYC status changes, upcoming validity expiry — without
// any backend changes required.
// Read-state is tracked per (token, event-id) in localStorage so refreshes
// don't wipe out "already seen" markers.
function _notifStorageKey() { return `portal_notif_seen_${typeof TOKEN !== 'undefined' ? TOKEN : ''}`; }
function _getSeenNotifs() {
    try { return JSON.parse(localStorage.getItem(_notifStorageKey()) || '[]'); } catch(e) { return []; }
}
function _saveSeenNotifs(ids) {
    try { localStorage.setItem(_notifStorageKey(), JSON.stringify(ids.slice(-200))); } catch(e) {}
}

function buildNotifications() {
    const list = [];
    const offers = portalData?.offers || [];
    const partner = portalData?.partner || {};
    const now = new Date();

    // Active offers awaiting client response (highest signal for the client)
    offers.filter(o => !o.clientStatus).forEach(o => {
        list.push({
            id: `offer_pending_${o.id}`,
            when: o.date || new Date().toISOString(),
            title: `New offer awaits your response`,
            body: `${o.productName || 'Product'} · ${o.offerNo || ''}`,
            action: () => { switchTab('offers'); toggleNotificationsPanel(true); }
        });
    });
    // Offers expiring within 3 days
    offers.filter(o => !o.clientStatus && o.validUntil).forEach(o => {
        try {
            const d = new Date(o.validUntil);
            const diffDays = Math.ceil((d - now) / (1000*60*60*24));
            if (diffDays >= 0 && diffDays <= 3) {
                list.push({
                    id: `offer_expiring_${o.id}_${diffDays}`,
                    when: new Date().toISOString(),
                    title: `Offer ${o.offerNo || ''} expires in ${diffDays} day${diffDays === 1 ? '' : 's'}`,
                    body: `${o.productName || ''}`,
                    action: () => { switchTab('offers'); toggleNotificationsPanel(true); }
                });
            }
        } catch(e) {}
    });
    // KYC update required
    if (partner.kycStatus === 'update_requested' || partner.kycStatus === 'expired') {
        list.push({
            id: `kyc_${partner.kycStatus}`,
            when: new Date().toISOString(),
            title: partner.kycStatus === 'expired' ? 'KYC documentation has expired' : 'KYC update required',
            body: partner.kycReviewNote || 'Please open the KYC tab to complete the requested items.',
            action: () => { switchTab('kyc'); toggleNotificationsPanel(true); }
        });
    }
    // Sort newest first
    list.sort((a, b) => new Date(b.when) - new Date(a.when));
    return list;
}

let _lastNotifList = [];
function renderNotifications() {
    _lastNotifList = buildNotifications();
    const seen = new Set(_getSeenNotifs());
    const body = document.getElementById('notif-body');
    const badge = document.getElementById('notif-count');
    const unreadCount = _lastNotifList.filter(n => !seen.has(n.id)).length;
    if (badge) {
        if (unreadCount > 0) { badge.textContent = String(unreadCount); badge.classList.remove('hidden'); }
        else { badge.classList.add('hidden'); }
    }
    if (!body) return;
    if (_lastNotifList.length === 0) {
        body.innerHTML = `<div class="p-6 text-center text-slate-400 text-sm">${t('notif_empty')}</div>`;
        return;
    }
    body.innerHTML = _lastNotifList.map((n, i) => `
        <div class="notif-item ${seen.has(n.id) ? '' : 'unread'}" onclick="handleNotifClick(${i})">
            <div class="text-sm font-semibold text-slate-900">${safeText(n.title)}</div>
            ${n.body ? `<div class="text-xs text-slate-500 mt-1">${safeText(n.body)}</div>` : ''}
            <div class="text-[10px] text-slate-400 mt-1">${n.when ? new Date(n.when).toLocaleString() : ''}</div>
        </div>
    `).join('');
}
window.handleNotifClick = function(idx) {
    const n = _lastNotifList[idx]; if (!n) return;
    const seen = new Set(_getSeenNotifs()); seen.add(n.id); _saveSeenNotifs([...seen]);
    if (typeof n.action === 'function') n.action();
    renderNotifications();
};
window.toggleNotificationsPanel = function(forceClose) {
    const panel = document.getElementById('notif-panel'); if (!panel) return;
    if (forceClose === true) { panel.classList.add('hidden'); return; }
    panel.classList.toggle('hidden');
};
window.markAllNotificationsRead = function() {
    _saveSeenNotifs(_lastNotifList.map(n => n.id));
    renderNotifications();
};
// Dismiss the panel on outside click for standard UX.
document.addEventListener('click', (e) => {
    const panel = document.getElementById('notif-panel');
    const btn = document.getElementById('btn-notifications');
    if (!panel || panel.classList.contains('hidden')) return;
    if (panel.contains(e.target) || (btn && btn.contains(e.target))) return;
    panel.classList.add('hidden');
});

// ==========================================================
//  KYC GATE — zaključava naprednu funkcionalnost dok KYC nije odobren
// ==========================================================
// Klijent bez odobrenog KYC-a vidi jasan banner i zaključane tabove za
// Deals/Offers/Catalog. Uvek su dostupni: Dashboard, KYC, Profile.
// Kada admin odobri KYC, banner nestaje i zaključani tabovi se otvore.
window.applyKycGate = function() {
    const partner = portalData?.partner || {};
    const status = (partner.kycStatus || 'pending').toLowerCase();
    const isApproved = status === 'approved';

    // Ubrizgaj banner na vrh portal-content-a ako nije već tamo
    let banner = document.getElementById('kyc-gate-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'kyc-gate-banner';
        banner.className = 'mb-4';
        const host = document.getElementById('portal-content');
        if (host) host.insertBefore(banner, host.firstChild);
    }

    if (isApproved) {
        // KYC OK — sve otključano
        banner.innerHTML = '';
        banner.classList.add('hidden');
        document.querySelectorAll('.kyc-locked').forEach(el => {
            el.classList.remove('kyc-locked');
            el.disabled = false;
            el.style.opacity = '';
            el.style.pointerEvents = '';
        });
        return;
    }

    banner.classList.remove('hidden');
    const statusText = {
        pending: 'PENDING REVIEW', update_requested: 'ACTION REQUIRED', rejected: 'REJECTED', expired: 'EXPIRED'
    }[status] || 'PENDING REVIEW';
    const statusClass = {
        pending: 'bg-amber-50 border-amber-300 text-amber-900',
        update_requested: 'bg-orange-50 border-orange-300 text-orange-900',
        rejected: 'bg-red-50 border-red-300 text-red-900',
        expired: 'bg-red-50 border-red-300 text-red-900'
    }[status] || 'bg-amber-50 border-amber-300 text-amber-900';

    let msg;
    if (status === 'pending') msg = 'Your KYC submission is under review. Full portal features (offers, deals, catalog, RFQs) will be available once the account manager approves your compliance profile.';
    else if (status === 'update_requested') msg = 'Additional KYC information is required. Please open the KYC / Compliance tab, complete the requested fields, and re-submit.';
    else if (status === 'rejected') msg = 'Your KYC submission was rejected. Please contact your account manager to resolve the compliance issue.';
    else if (status === 'expired') msg = 'Your KYC compliance has expired. Please re-submit updated documents to restore full portal access.';
    else msg = 'Please complete the KYC / Compliance form so we can activate full portal features for you.';

    banner.innerHTML = `
      <div class="border ${statusClass} rounded-xl p-4 flex flex-col md:flex-row items-start gap-4">
        <div class="text-3xl leading-none flex-shrink-0">🛡️</div>
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-1">
            <h4 class="font-bold text-sm">Compliance verification required</h4>
            <span class="text-[10px] font-bold uppercase tracking-widest bg-white/60 px-2 py-0.5 rounded">${statusText}</span>
          </div>
          <p class="text-sm leading-relaxed">${msg}</p>
        </div>
        <button onclick="switchTab('kyc')" class="flex-shrink-0 bg-white border border-current font-bold px-4 py-2 rounded-lg text-xs uppercase tracking-wider hover:opacity-80">Open KYC tab</button>
      </div>`;

    // Zaključaj zabranjene tabove i njihov sadržaj — svaki klik odvodi na KYC tab.
    const LOCKED_TABS = ['shipments', 'offers', 'catalog', 'rfq', 'documents', 'goods'];
    LOCKED_TABS.forEach(tabId => {
        const btn = document.getElementById('tab-btn-' + tabId);
        if (btn) {
            btn.classList.add('kyc-locked');
            btn.title = 'Locked — complete KYC first';
            btn.style.opacity = '0.55';
        }
    });
    // Reagujemo na klik: umesto da pokažemo sadržaj, otvori KYC.
    if (!window.__kyc_gate_click) {
        window.__kyc_gate_click = true;
        document.addEventListener('click', (e) => {
            const currentStatus = (portalData?.partner?.kycStatus || 'pending').toLowerCase();
            if (currentStatus === 'approved') return;
            const btn = e.target.closest('.tab-btn.kyc-locked');
            if (btn) {
                e.preventDefault(); e.stopPropagation();
                if (typeof showToast === 'function') showToast('Please complete KYC before accessing this section.', 'warn');
                switchTab('kyc');
            }
        }, true);
    }
};

window.applyPermissions = function(permissions) {
    if (!permissions || permissions.length === 0) return;
    const perms = new Set(permissions);
    // dashboard, profile su UVEK vidljivi; ostali samo ako partner ima permisiju
    const map = {
        'tab-btn-shipments': 'shipments',
        'tab-btn-offers': 'offers',
        'tab-btn-rfq': 'rfq',
        'tab-btn-kyc': 'kyc',
        'tab-btn-goods': 'goods',
        'tab-btn-docs': 'documents',
        'tab-btn-catalog': 'catalog'
    };
    Object.entries(map).forEach(([id, permKey]) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', !perms.has(permKey));
    });
};
