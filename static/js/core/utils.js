// Osnovne globalne funkcije
function generateId() { return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

// ==========================================================
//  TOAST NOTIFIKACIJE — profesionalna zamena za native alert()
// ==========================================================
// Poziv: showToast('poruka', 'success' | 'error' | 'info' | 'warn', trajanje_ms)
// Kada je pozvano bez tipa, tretira se kao 'info'. Toast se sam uklanja nakon
// zadatog vremena (default 4.5s), sa slide-in/out animacijom. Pristupačan je
// (role="status", aria-live="polite") pa screen readeri čitaju.
function showToast(message, type = 'info', duration = 4500) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'fixed top-4 right-4 z-[300] flex flex-col gap-2 max-w-sm w-[calc(100%-2rem)] sm:w-96 pointer-events-none';
        document.body.appendChild(container);
    }
    const palette = {
        success: { bg: 'bg-emerald-600', icon: '✅' },
        error:   { bg: 'bg-red-600',     icon: '⛔' },
        warn:    { bg: 'bg-amber-500',   icon: '⚠️' },
        info:    { bg: 'bg-slate-800',   icon: 'ℹ️' }
    };
    const cfg = palette[type] || palette.info;
    const el = document.createElement('div');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.className = `pointer-events-auto ${cfg.bg} text-white px-4 py-3 rounded-xl shadow-2xl flex items-start gap-3 text-sm font-medium transition-all duration-300 translate-x-full opacity-0`;
    el.innerHTML = `
      <span class="text-lg leading-none">${cfg.icon}</span>
      <div class="flex-1 leading-snug">${String(message).replace(/</g,'&lt;')}</div>
      <button class="ml-2 opacity-70 hover:opacity-100 text-lg leading-none" aria-label="Close">×</button>`;
    container.appendChild(el);
    // slide in
    requestAnimationFrame(() => { el.classList.remove('translate-x-full', 'opacity-0'); });
    const remove = () => {
        el.classList.add('translate-x-full', 'opacity-0');
        setTimeout(() => el.remove(), 300);
    };
    el.querySelector('button').addEventListener('click', remove);
    setTimeout(remove, duration);
    return remove;
}
window.showToast = showToast;
window.toastSuccess = (m,d) => showToast(m, 'success', d);
window.toastError   = (m,d) => showToast(m, 'error', d);
window.toastInfo    = (m,d) => showToast(m, 'info', d);
window.toastWarn    = (m,d) => showToast(m, 'warn', d);

// ==========================================================
//  ASK MODAL — profesionalna zamena za prompt() / confirm() / alert()
// ==========================================================
// Svi CRM tokovi koji ranije koristili native prompt() sada zovu askInput/
// askConfirm/askChoice — dobijaju stilizovan modal sa fokus zamkom, ESC
// otkazivanjem, i mobile-friendly bottom-sheet ponašanjem (dolazi iz media
// query-ja u index.html). Vraća Promise.
window.askModal = function(opts) {
    return new Promise((resolve) => {
        opts = opts || {};
        const {
            title = 'Question',
            description = '',
            html = '',                      // ako je prosleđen, koristi se umesto default input-a
            confirmText = 'OK',
            cancelText = 'Cancel',
            confirmClass = 'bg-blue-600 hover:bg-blue-700 text-white',
            danger = false,
            initialValue = '',
            placeholder = '',
            inputType = 'text',             // text, number, textarea, select
            options = null,                 // array of {value, label} za select ili choice
            multiline = false,
            required = true,
            validator = null,               // (value) => null | 'error message'
        } = opts;

        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[400] bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');

        const btnClass = danger ? 'bg-red-600 hover:bg-red-700 text-white' : confirmClass;
        const inputHtml = html || (
            options ?
              `<select id="ask-modal-input" class="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none">
                ${options.map(o => `<option value="${String(o.value || o).replace(/"/g,'&quot;')}">${String(o.label || o).replace(/</g,'&lt;')}</option>`).join('')}
              </select>` :
            multiline || inputType === 'textarea' ?
              `<textarea id="ask-modal-input" rows="4" placeholder="${placeholder.replace(/"/g,'&quot;')}" class="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none">${initialValue.replace(/</g,'&lt;')}</textarea>` :
              `<input type="${inputType}" id="ask-modal-input" value="${String(initialValue).replace(/"/g,'&quot;')}" placeholder="${placeholder.replace(/"/g,'&quot;')}" class="w-full px-4 py-3 border border-slate-300 dark:border-slate-600 rounded-xl text-sm bg-white dark:bg-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"/>`
        );

        const isConfirmOnly = opts.mode === 'confirm';  // konfirm bez input polja
        const bodyHtml = isConfirmOnly ? (description ? `<p class="text-slate-700 dark:text-slate-200 text-sm leading-relaxed">${description}</p>` : '')
                       : `${description ? `<p class="text-slate-600 dark:text-slate-300 text-xs mb-3 leading-relaxed">${description}</p>` : ''}${inputHtml}<div id="ask-modal-error" class="hidden text-red-600 text-xs mt-2 font-semibold"></div>`;

        overlay.innerHTML = `
          <div class="bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md p-0 flex flex-col max-h-[95vh]">
            <div class="px-5 pt-5 pb-3">
              <h3 class="text-base font-bold text-slate-900 dark:text-white">${title}</h3>
            </div>
            <div class="px-5 pb-4 overflow-y-auto flex-1">${bodyHtml}</div>
            <div class="px-5 py-4 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex flex-col sm:flex-row-reverse gap-2 rounded-b-2xl">
              <button id="ask-modal-ok" class="${btnClass} font-bold px-5 py-2.5 rounded-xl text-sm shadow-sm min-h-[44px]">${confirmText}</button>
              <button id="ask-modal-cancel" class="bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-semibold px-5 py-2.5 rounded-xl text-sm hover:bg-slate-50 min-h-[44px]">${cancelText}</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);
        const input = overlay.querySelector('#ask-modal-input');
        const errorEl = overlay.querySelector('#ask-modal-error');
        setTimeout(() => (input || overlay.querySelector('#ask-modal-ok'))?.focus(), 40);

        const cleanup = (result) => {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            resolve(result);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') cleanup(null);
            if (e.key === 'Enter' && !multiline && input && document.activeElement === input) {
                overlay.querySelector('#ask-modal-ok').click();
            }
        };
        document.addEventListener('keydown', onKey);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(null); });
        overlay.querySelector('#ask-modal-cancel').addEventListener('click', () => cleanup(null));
        overlay.querySelector('#ask-modal-ok').addEventListener('click', () => {
            if (isConfirmOnly) return cleanup(true);
            const val = input ? input.value : '';
            if (required && !String(val).trim()) {
                errorEl.textContent = 'This field is required.'; errorEl.classList.remove('hidden');
                input.focus();
                return;
            }
            if (validator) {
                const msg = validator(val);
                if (msg) { errorEl.textContent = msg; errorEl.classList.remove('hidden'); input.focus(); return; }
            }
            cleanup(val);
        });
    });
};

// Kratki wrapperi
window.askInput = (title, opts) => askModal(Object.assign({ title }, opts || {}));
window.askConfirm = (title, description, opts) => askModal(Object.assign({ title, description, mode: 'confirm' }, opts || {}));
window.askChoice = (title, options, opts) => askModal(Object.assign({ title, options, required: true }, opts || {}));

// ==========================================================
//  NATIVE alert() / confirm() / prompt() SHIM
// ==========================================================
// Prepiši native browser dijaloge — svi legacy alert()/confirm()/prompt()
// pozivi (103 u kodu) sada automatski koriste stilizovani modalni prozor.
// Očuvamo reference u __native* za slučaj da neki tok mora natrag.
window.__nativeAlert = window.alert.bind(window);
window.__nativeConfirm = window.confirm.bind(window);
window.__nativePrompt = window.prompt.bind(window);

// Detekcija: da li se poruka odnosi na grešku, upozorenje ili info?
// Bazira se na ključnim rečima u tekstu — koristi se za automatsko biranje
// naslova i boje.
function _detectMessageKind(msg) {
    const s = String(msg || '').toLowerCase();
    if (/(greška|error|failed|fail|denied|neuspešn|nije uspe|invalid|blocked|refused|forbidden|zabranj)/i.test(s)) return 'error';
    if (/(upozorenj|warning|pažnj|paznj|attention|manjak|caution)/i.test(s)) return 'warning';
    if (/(uspešn|success|ok|sačuvano|saved|obrisano|deleted|created)/i.test(s)) return 'success';
    return 'info';
}

// Sinhroni alert je nemoguć u browseru, ali je nekritičan pošto native
// alert() je već blokirajući. Simuliramo modal — poziv će vratiti odmah,
// ali korisnik će videti stilizovan overlay dok ne klikne OK.
window.alert = function styledAlert(msg) {
    const kind = _detectMessageKind(msg);
    const title = kind === 'error' ? '⚠️ Greška'
               : kind === 'warning' ? '⚠️ Upozorenje'
               : kind === 'success' ? '✅ Uspešno'
               : 'ℹ️ Informacija';
    // Poziv askModal je async — ne čekamo, ali korisnik vidi overlay dok
    // ne klikne OK. Za flow-ove koji se oslanjaju na blokirajući alert
    // (retko), fallback na native je zadržan kroz window.__nativeAlert.
    if (typeof window.askModal === 'function') {
        askModal({
            title,
            description: String(msg || ''),
            mode: 'confirm',
            confirmText: 'OK',
        }).catch(() => {});
    } else {
        window.__nativeAlert(msg);
    }
};

// NAPOMENA: `window.confirm` i `window.prompt` NE prepisujemo globalno jer
// JavaScript nema pravi sinhroni modal (browser API ograničenje) —
// `if (confirm(...))` sintaksa bi break-ovala ako bismo vratili Promise.
// Umesto toga, sve nove pozive treba pisati kao `await askConfirm(...)`
// ili `await askInput(...)` koji vraćaju stilizovan modal. Legacy
// `confirm()`/`prompt()` pozivi se konvertuju eksplicitno kroz kod.

// ==========================================================
//  PROFESIONALNI LOADER — full-screen overlay + inline spinner
// ==========================================================
// Cilj: korisnik uvek zna da aplikacija radi u pozadini.
// Dva režima:
//   1) showLoader('poruka')   → full-screen overlay sa animiranim krugom
//      i porukom. Koristi se za: login, initial data load, bulk save,
//      refresh, delete. Više paralelnih poziva se broji (counter);
//      hideLoader se poziva onoliko puta koliko je showLoader — overlay
//      se skida tek kad brojač padne na 0.
//   2) inlineSpinner(el, on) → dodaje/uklanja mali spinner na konkretno
//      dugme (npr. Save/Delete u modalima) sa disable + wait cursor.
//
// Loader je pristupačan (role="status", aria-live="polite") i respektuje
// prefers-reduced-motion (ne rotira animaciju za korisnike osetljive na
// pokret).

let __loader_counter = 0;
let __loader_el = null;

function _createLoaderElement() {
    const el = document.createElement('div');
    el.id = 'global-loader-overlay';
    el.className = 'fixed inset-0 z-[500] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center transition-opacity duration-200';
    el.style.opacity = '0';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = `
      <div class="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl px-8 py-6 flex flex-col items-center gap-4 min-w-[200px] max-w-sm mx-4">
        <!-- SVG spinner sa dual-ring, respektuje reduced-motion preko CSS -->
        <div class="loader-spinner" aria-hidden="true">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="3" opacity="0.2" class="text-blue-500"/>
            <path d="M44 24a20 20 0 0 1-20 20" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="text-blue-600">
              <animateTransform attributeName="transform" type="rotate" from="0 24 24" to="360 24 24" dur="0.9s" repeatCount="indefinite"/>
            </path>
          </svg>
        </div>
        <div class="text-sm font-semibold text-slate-800 dark:text-slate-100 text-center leading-snug" id="global-loader-message">Loading…</div>
      </div>`;
    document.body.appendChild(el);
    return el;
}

window.showLoader = function(message) {
    __loader_counter++;
    if (!__loader_el) __loader_el = _createLoaderElement();
    const msgEl = document.getElementById('global-loader-message');
    if (msgEl) msgEl.textContent = message || (typeof t === 'function' ? (t('loader.default') || 'Loading…') : 'Loading…');
    __loader_el.style.display = 'flex';
    // trigger opacity animation
    requestAnimationFrame(() => { if (__loader_el) __loader_el.style.opacity = '1'; });
    return __loader_counter;
};

window.hideLoader = function() {
    __loader_counter = Math.max(0, __loader_counter - 1);
    if (__loader_counter === 0 && __loader_el) {
        __loader_el.style.opacity = '0';
        setTimeout(() => {
            if (__loader_counter === 0 && __loader_el) __loader_el.style.display = 'none';
        }, 220);
    }
};

// Force reset (koristi se kada se pokvari counter — npr. exception u handler-u)
window.resetLoader = function() {
    __loader_counter = 0;
    if (__loader_el) { __loader_el.style.opacity = '0'; __loader_el.style.display = 'none'; }
};

// Inline spinner na dugme — čuva originalni sadržaj i vraća ga posle
window.inlineSpinner = function(el, on) {
    if (!el) return;
    if (on) {
        if (el.dataset.originalHtml === undefined) el.dataset.originalHtml = el.innerHTML;
        el.disabled = true;
        el.style.cursor = 'wait';
        el.innerHTML = `<svg class="inline w-4 h-4 mr-1.5 -ml-0.5 align-middle" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25"/>
              <path d="M21 12a9 9 0 0 1-9 9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>
              </path>
            </svg><span class="align-middle">${(typeof t === 'function' ? (t('loader.working') || 'Working…') : 'Working…')}</span>`;
    } else {
        if (el.dataset.originalHtml !== undefined) {
            el.innerHTML = el.dataset.originalHtml;
            delete el.dataset.originalHtml;
        }
        el.disabled = false;
        el.style.cursor = '';
    }
};

// Convenience: prati Promise i drži loader-om, sa auto-hide bez obzira na ishod
window.withLoader = async function(message, promiseFn) {
    showLoader(message);
    try {
        return await (typeof promiseFn === 'function' ? promiseFn() : promiseFn);
    } finally {
        hideLoader();
    }
};

function applyTheme() {
  const body = document.body; const toggle = document.getElementById('theme-toggle');
  if (state.theme === 'light') { body.classList.add('light-theme'); body.classList.remove('dark-theme'); if(toggle) toggle.checked = false; }
  else { body.classList.add('dark-theme'); body.classList.remove('light-theme'); if(toggle) toggle.checked = true; }
}

function hasPerm(module, action) {
    if (!state.user) return false;
    if (state.user.role === 'admin') return true; 
    const perms = state.user.permissions || {};
    if (action === 'view') {
        return perms[`${module}_view_all`] || perms[`${module}_view_own`] || perms[`${module}_view`];
    }
    return !!perms[`${module}_${action}`];
}

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  saveToStorage('theme'); applyTheme();
}

function resetFilters() {
  state.activeFilters = { 
      partners:{ type:'', city:'', country:'' }, 
      deals:{ status:'', buyerId:'', supplierId:'' }, 
      finances: { range: 'thisMonth', startDate: '', endDate: '' }, 
      cashflow: { range: 'thisMonth', accountId: 'all', category: 'all', startDate: '', endDate: '' } 
  }; 
}

function handleFilterChange(view, name, value) {
    // Defensive: ako view još nema svoj filter bucket (novi view, prazan state),
    // inicijalizuj pre pisanja. Bez ovoga TypeError obara render pipeline i sva
    // dugmad na stranici prestaju da odgovaraju.
    if (!state.activeFilters) state.activeFilters = {};
    if (!state.activeFilters[view]) state.activeFilters[view] = {};
    state.activeFilters[view][name] = value;
    render();
}

function createViewHeader(title, buttonText, onButtonClick) {
  const header = document.createElement('div');
  header.className = 'flex items-center justify-between gap-4 mb-7 pb-5 border-b border-[var(--border)]';
  header.innerHTML = `<h2 class="page-title">${title}</h2>${buttonText ? `<div class="flex items-center gap-3"><button class="btn btn-primary" id="view-add-btn">${buttonText}</button></div>` : ''}`;
  if (onButtonClick) header.querySelector('#view-add-btn').addEventListener('click', onButtonClick);
  return header;
}

function applyFiltersFor(view) { 
  let data = [...(state.data[view] || [])]; const f = state.activeFilters[view]; if(!f) return data; 
  if(view==='partners'){ 
      if(f.type) data = data.filter(p => (p.types||[]).includes(f.type)); 
      if(f.city) data = data.filter(p => (p.address?.city||'').toLowerCase().includes(f.city.toLowerCase())); 
      if(f.country) data = data.filter(p => (p.address?.country||'').toLowerCase().includes(f.country.toLowerCase())); 
  } 
  if(view==='deals'){ 
      if(f.status) data = data.filter(d => d.status === f.status); 
      if(f.buyerId) data = data.filter(d => d.buyerId === f.buyerId); 
      if(f.supplierId) data = data.filter(d => d.supplierId === f.supplierId); 
  } 
  return data; 
}

function openModal(title, innerHtml, onSubmit) { 
  const viewName = state.currentView;
  const isDetailsModal = title.includes(typeof t === 'function' ? t('actions.details') : 'Details');
  // Lični profil (izmena svoje lozinke/potpisa) mora biti dostupan svakom korisniku,
  // nezavisno od edit-permisija na trenutnom modulu.
  const isProfileModal = typeof t === 'function' && title === t('misc.myProfile');

  if (viewName !== 'settings' && viewName !== 'users' && !isDetailsModal && !isProfileModal && !hasPerm(viewName, 'edit')) {
      alert(typeof t === 'function' ? t('users.accessDeniedEdit') : 'Access Denied');
      return;
  }

  const md = document.getElementById('modal-backdrop'); const mb = document.getElementById('modal-body'); const mt = document.getElementById('modal-title'); 
  if(!md || !mb || !mt) return; // Sigurnosni check
  
  mt.innerText = title; mb.innerHTML = innerHtml; md.classList.remove('hidden'); md.classList.add('flex'); 
  const form = mb.querySelector('form'); 
  if(form && onSubmit){ 
      // Kloniranje forme sprečava dupliranje Event Listenera ako se modal brzo otvori/zatvori
      const newForm = form.cloneNode(true); form.parentNode.replaceChild(newForm, form); 
      newForm.addEventListener('submit', (e)=>{ 
          e.preventDefault(); 
          const btn = newForm.querySelector('button[type="submit"]');
          if(btn) { btn.disabled = true; btn.innerHTML = '⏳ ...'; }
          try {
              onSubmit(new FormData(newForm)); 
          } catch(err) {
              console.error(err);
              if(btn) { btn.disabled = false; btn.innerHTML = 'Greška! Pokušajte ponovo.'; }
          }
      }); 
  } 
}

function closeModal() { 
  const md = document.getElementById('modal-backdrop');
  if(md) {
      md.classList.add('hidden'); 
      md.classList.remove('flex');
  }
  const mb = document.getElementById('modal-body');
  if(mb) mb.innerHTML=''; 
  state.editingItem = null; 
  
  const mdContent = document.querySelector('#modal-backdrop > div');
  if(mdContent) mdContent.id = 'modal-content';
}

async function handleDelete(key, id) {
    // 1) Integritet — sprečava brisanje entiteta koji su vezani za deal/offer/transaction.
    if (key === 'partners') {
        const hasDeals = state.data.deals.some(d => d.buyerId === id || d.supplierId === id || (d.associates && d.associates.some(a => a.partnerId === id)));
        const hasOffers = state.data.offers && state.data.offers.some(o => o.customerId === id);
        if (hasDeals || hasOffers) { alert(typeof t === 'function' ? t('misc.rejectPartnerDelete') : 'Cannot delete partner.'); return; }
    }
    if (key === 'products') {
        const hasDeals = state.data.deals.some(d => d.productId === id);
        const hasOffers = state.data.offers && state.data.offers.some(o => o.productId === id);
        if (hasDeals || hasOffers) { alert(typeof t === 'function' ? t('misc.rejectProductDelete') : 'Cannot delete product.'); return; }
    }
    if (key === 'accounts') {
        const hasTxs = state.data.transactions.some(tx => tx.accountId === id || tx.fromAccountId === id || tx.toAccountId === id);
        if (hasTxs) { alert(typeof t === 'function' ? t('misc.rejectAccountDelete') : 'Cannot delete account.'); return; }
    }

    // 2) Potvrda korisnika — obavezan zaštitni sloj. Ranije se brisanje transakcije
    //    dešavalo BEZ potvrde na klik "Obriši" u finansijskoj tabeli, što je
    //    često dovodilo do slučajnog gubitka podataka. Sada koristimo askConfirm
    //    modal (ili native confirm kao fallback).
    const srLang = (typeof getLang === 'function' ? getLang() : 'sr') === 'sr';
    const title = srLang ? 'Trajno obrisati?' : 'Delete permanently?';
    const msg = srLang
        ? 'Ova akcija se NE MOŽE poništiti. Zapis se briše iz baze.'
        : 'This action CANNOT be undone. Record will be removed from the database.';
    let yes;
    if (typeof window.askConfirm === 'function') {
        try {
            yes = await window.askConfirm(title, msg, {
                danger: true,
                confirmText: srLang ? 'Obriši' : 'Delete'
            });
        } catch (_) { yes = window.confirm(msg); }
    } else {
        yes = window.confirm(msg);
    }
    if (!yes) return;

    try {
        await deleteItemFromServer(key, id);
        state.data[key] = state.data[key].filter(it => it.id !== id);
        render();
        if (typeof showToast === 'function') {
            showToast(srLang ? 'Zapis obrisan.' : 'Record deleted.', 'success');
        }
    } catch(e) {
        console.error("Delete failed", e);
        if (typeof showToast === 'function') {
            showToast(srLang ? 'Greška pri brisanju.' : 'Delete failed.', 'error');
        }
    }
}

function getPartnerNameById(id) { 
    if(!id || !state.data || !state.data.partners) return 'N/A';
    return state.data.partners.find(p=>p.id===id)?.companyName || 'N/A'; 
}
function getProductNameById(id) { 
    if(!id || !state.data || !state.data.products) return 'N/A';
    return state.data.products.find(p=>p.id===id)?.name || 'N/A'; 
}

function formatCurrency(v, currencyCode = state.settings?.currency || 'USD') { 
  const cCode = currencyCode || 'USD'; 
  const numberFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: cCode, minimumFractionDigits: 2, maximumFractionDigits: 2 }); 
  if(isNaN(v) || v === null || v === undefined) return numberFormat.format(0); 
  return numberFormat.format(v); 
}

// Anti-XSS zaštita sa null check-om
function escapeHtml(s) { 
    if(s === null || s === undefined) return ''; 
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); 
}
function escapeFilename(n) { return (n||'file').replaceAll(/[^a-zA-Z0-9.\-_]/g,'_'); }

let LIVE_RATES = { ...GLOBAL_RATES }; 
async function fetchLiveExchangeRates() {
    try {
        const res = await fetch('https://open.er-api.com/v6/latest/USD');
        const data = await res.json();
        if(data && data.rates) {
            Object.assign(LIVE_RATES, data.rates);
            localStorage.setItem('cached_rates', JSON.stringify(LIVE_RATES));
        }
    } catch(e) { 
        const cached = localStorage.getItem('cached_rates');
        if(cached) Object.assign(LIVE_RATES, JSON.parse(cached));
    }
}

function convertCurrency(amount, fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) return amount;
    const rateFrom = LIVE_RATES[fromCurrency] || 1;
    const rateTo = LIVE_RATES[toCurrency] || 1;
    return (amount / rateFrom) * rateTo; 
}

// Normalizuje unos jedinice (npr. "kg - Kilogram" ili "MT" ili "t") na kratki kod.
function normalizeUnit(unit) {
    if (!unit) return '';
    const code = String(unit).split('-')[0].trim().toLowerCase();
    if (code === 't' || code === 'mt' || code === 'ton' || code === 'tons' || code === 'tonne') return 'mt';
    return code;
}

// Faktori konverzije tezinskih jedinica u kilograme. Samo prave tezinske
// jedinice se mogu konvertovati - pcs/L/CBM/box/ctr itd. nemaju fiksan odnos
// prema kilogramu pa se za njih konverzija ne radi (vraca se null).
// Osnovni set za brzu lookup; puni set je u UNIT_CANONICAL (constants.js).
const WEIGHT_UNITS_TO_KG = { 'kg': 1, 'mt': 1000, 't': 1000, 'g': 0.001, 'mg': 0.000001,
    'lb': 0.45359237, 'lbs': 0.45359237, 'oz': 0.028349523125,
    'st': 6.35029318, 'stone': 6.35029318,
    'cwt': 45.359237, 'cwt_us': 45.359237, 'cwt_uk': 50.80234544,
    'short_ton': 907.18474, 'sh_tn': 907.18474,
    'long_ton': 1016.0469088, 'l_tn': 1016.0469088,
    'grain': 0.00006479891,
};

// Generički konverter — koristi UNIT_CANONICAL kao source of truth za sve
// vrste jedinica (mass/volume/area/length/count). Vraća null ako jedinice
// nisu istog kind-a (npr. mass ↔ volume bez density-ja).
function convertAny(qty, fromUnit, toUnit) {
    if (qty === null || qty === undefined) return null;
    const q = parseFloat(qty);
    if (isNaN(q)) return null;
    if (typeof UNIT_CANONICAL === 'undefined') return null;
    const from = normalizeUnit(fromUnit);
    const to = normalizeUnit(toUnit);
    if (from === to) return q;
    const fSpec = UNIT_CANONICAL[from];
    const tSpec = UNIT_CANONICAL[to];
    if (!fSpec || !tSpec) return null;
    if (fSpec.kind !== tSpec.kind) return null;
    // Pivot ključ zavisi od kind-a
    if (fSpec.kind === 'mass'   && fSpec.toKg   && tSpec.toKg)   return q * fSpec.toKg   / tSpec.toKg;
    if (fSpec.kind === 'volume' && fSpec.toL    && tSpec.toL)    return q * fSpec.toL    / tSpec.toL;
    if (fSpec.kind === 'area'   && fSpec.toSqm  && tSpec.toSqm)  return q * fSpec.toSqm  / tSpec.toSqm;
    if (fSpec.kind === 'length' && fSpec.toM    && tSpec.toM)    return q * fSpec.toM    / tSpec.toM;
    return null;  // count → count = ne konvertuje se numerički
}

function isWeightUnit(unit) {
    return Object.prototype.hasOwnProperty.call(WEIGHT_UNITS_TO_KG, normalizeUnit(unit));
}

// Konvertuje kolicinu iz jedne tezinske jedinice u drugu.
// ISPRAVKA: ranije se na vise mesta (deals_calculations.js) koristila logika
// "ako jedinica nije 't'/'MT', pretpostavi da je 'kg'" - sto je davalo pogresne
// obracune provizije za bilo koju drugu jedinicu (g, lb, oz, pcs, CBM...).
// Vraca null ako konverzija nije moguca (npr. iz 'pcs' u 'kg').
function convertWeight(qty, fromUnit, toUnit) {
    const from = normalizeUnit(fromUnit);
    const to = normalizeUnit(toUnit);
    if (!WEIGHT_UNITS_TO_KG[from] || !WEIGHT_UNITS_TO_KG[to]) return null;
    if (from === to) return qty;
    const kg = qty * WEIGHT_UNITS_TO_KG[from];
    return kg / WEIGHT_UNITS_TO_KG[to];
}

// Vraca kolicinu izrazenu u tonama, ili null ako jedinica nije tezinska.
function toMetricTons(qty, unit) { return convertWeight(qty, unit, 'mt'); }
// Vraca kolicinu izrazenu u kilogramima, ili null ako jedinica nije tezinska.
function toKilograms(qty, unit) { return convertWeight(qty, unit, 'kg'); }

// ==========================================================
//  UNIT-AWARE PRICE MATH
// ==========================================================
// convertPricePerUnit(price, fromUnit, toUnit) — pretvara cenu izraženu
// PO fromUnit u cenu PO toUnit. Kritično za PDF-ove i izveštaje: ako
// ponuda kaže "1.5 USD po kg" a analitika radi po toni, mora se pomnožiti
// sa 1000. Vraća null ako jedinice nisu istovrsne (npr. price/kg → price/pcs).
function convertPricePerUnit(price, fromUnit, toUnit) {
    if (price === null || price === undefined || price === '') return null;
    const p = parseFloat(price);
    if (isNaN(p)) return null;
    const from = normalizeUnit(fromUnit);
    const to = normalizeUnit(toUnit);
    if (from === to) return p;
    // Ako oba tipa mase → koristimo relaciju kg-a
    if (WEIGHT_UNITS_TO_KG[from] && WEIGHT_UNITS_TO_KG[to]) {
        // 1 unit(from) = WEIGHT_UNITS_TO_KG[from] kg. Ako cena je P/from,
        // onda P/from = P / WEIGHT_UNITS_TO_KG[from] po kg. Pa u toUnit:
        // po toUnit = po kg * WEIGHT_UNITS_TO_KG[to].
        return p / WEIGHT_UNITS_TO_KG[from] * WEIGHT_UNITS_TO_KG[to];
    }
    // Ako se ne poklapaju (npr. price/kg → price/pcs) — ne možemo bez težine paketa.
    return null;
}

// Ukupna cena robe: quantity * price, sve u istoj jedinici.
// Vraća { total, canonicalUnit, wasConverted }.
function totalPriceQty(quantity, priceUnit, quantityUnit, pricePerUnit) {
    const qty = parseFloat(quantity) || 0;
    const price = parseFloat(pricePerUnit) || 0;
    // Ako su jedinice iste — trivial.
    const pu = normalizeUnit(priceUnit);
    const qu = normalizeUnit(quantityUnit);
    if (pu === qu) return { total: qty * price, unit: pu, wasConverted: false };
    // Pokušaj konverziju
    const priceInQu = convertPricePerUnit(price, priceUnit, quantityUnit);
    if (priceInQu !== null) {
        return { total: qty * priceInQu, unit: qu, wasConverted: true };
    }
    // Ne može se konvertovati — vrati raw multiply sa warning
    return { total: qty * price, unit: qu, wasConverted: false, warning: 'unit_mismatch' };
}

async function uploadFileToServer(file) {
    const formData = new FormData();
    formData.append('file', file);
    try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.url) return data.url;
        throw new Error(data.error || 'Upload failed');
    } catch (err) {
        return null;
    }
}

function formatBytes(bytes) { if(!bytes || isNaN(bytes)) return ''; const sizes = ['B','KB','MB','GB']; const i = Math.floor(Math.log(bytes)/Math.log(1024)); return (bytes/Math.pow(1024,i)).toFixed(2)+' '+sizes[i]; }

function initAutocomplete(inp, getArrayCallback) {
  let currentFocus;
  inp.addEventListener("input", function(e) {
      let arr = typeof getArrayCallback === 'function' ? getArrayCallback() : getArrayCallback;
      let a, b, i, val = this.value; closeAllLists(); if (!val) { return false;}
      currentFocus = -1; a = document.createElement("DIV"); a.setAttribute("id", this.id + "autocomplete-list"); a.setAttribute("class", "autocomplete-items"); this.parentNode.appendChild(a);
      for (i = 0; i < arr.length; i++) {
          if (arr[i].toLowerCase().includes(val.toLowerCase())) {
              b = document.createElement("DIV"); let matchIndex = arr[i].toLowerCase().indexOf(val.toLowerCase());
              b.innerHTML = arr[i].substr(0, matchIndex); b.innerHTML += "<strong>" + arr[i].substr(matchIndex, val.length) + "</strong>"; b.innerHTML += arr[i].substr(matchIndex + val.length);
              b.innerHTML += "<input type='hidden' value='" + escapeHtml(arr[i]) + "'>";
              b.addEventListener("click", function(e) { inp.value = this.getElementsByTagName("input")[0].value; closeAllLists(); });
              a.appendChild(b);
          }
      }
  });
  
  inp.addEventListener("focus", function(e) {
      if(!this.value) {
          let arr = typeof getArrayCallback === 'function' ? getArrayCallback() : getArrayCallback;
          if(arr.length > 0 && arr.length <= 15) {
             let a, b, i; closeAllLists(); currentFocus = -1; 
             a = document.createElement("DIV"); a.setAttribute("id", this.id + "autocomplete-list"); a.setAttribute("class", "autocomplete-items"); this.parentNode.appendChild(a);
             for (i = 0; i < arr.length; i++) {
                 b = document.createElement("DIV"); b.innerHTML = arr[i]; b.innerHTML += "<input type='hidden' value='" + escapeHtml(arr[i]) + "'>";
                 b.addEventListener("click", function(e) { inp.value = this.getElementsByTagName("input")[0].value; closeAllLists(); });
                 a.appendChild(b);
             }
          }
      }
  });

  inp.addEventListener("keydown", function(e) {
      let x = document.getElementById(this.id + "autocomplete-list"); if (x) x = x.getElementsByTagName("div");
      if (e.keyCode == 40) { currentFocus++; addActive(x); } else if (e.keyCode == 38) { currentFocus--; addActive(x);
      } else if (e.keyCode == 13) { e.preventDefault(); if (currentFocus > -1) { if (x) x[currentFocus].click(); }
      } else if (e.key === "Escape") { closeAllLists(); }
  });
  function addActive(x) { if (!x) return false; removeActive(x); if (currentFocus >= x.length) currentFocus = 0; if (currentFocus < 0) currentFocus = (x.length - 1); x[currentFocus].classList.add("autocomplete-active"); }
  function removeActive(x) { for (let i = 0; i < x.length; i++) { x[i].classList.remove("autocomplete-active"); } }
  function closeAllLists(elmnt) { const x = document.getElementsByClassName("autocomplete-items"); for (let i = 0; i < x.length; i++) { if (elmnt != x[i] && elmnt != inp) { x[i].parentNode.removeChild(x[i]); } } }
  document.addEventListener("click", function (e) { closeAllLists(e.target); });
}

window.Utils = {
    generateId,
    applyTheme,
    hasPerm,
    toggleTheme,
    resetFilters,
    handleFilterChange,
    createViewHeader,
    applyFiltersFor,
    openModal,
    closeModal,
    handleDelete,
    getPartnerNameById,
    getProductNameById,
    formatCurrency,
    escapeHtml,
    escapeFilename,
    fetchLiveExchangeRates,
    convertCurrency,
    normalizeUnit,
    isWeightUnit,
    convertWeight,
    toMetricTons,
    toKilograms,
    convertAny,
    convertPricePerUnit,
    totalPriceQty,
    uploadFileToServer,
    formatBytes,
    initAutocomplete,
    t: (typeof t === 'function') ? t : function(str) { return str; },
    getLang: function() { return (typeof state !== 'undefined' && state.lang) ? state.lang : 'en'; }
};