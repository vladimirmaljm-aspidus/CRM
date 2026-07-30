// static/js/core/api.js

async function handleApiError(res) {
    const _notify = (msg, type) => {
        if (typeof window.showToast === 'function') window.showToast(msg, type || 'error', 5000);
        else alert(msg);
    };
    if (res.status === 401) {
        // SESSION_INVALIDATED (nakon promene lozinke) je specijalan slučaj — ista logika:
        // klijent mora ponovo da se prijavi.
        try {
            const j = await res.clone().json();
            if (j && j.error === 'SESSION_INVALIDATED') {
                _notify('Session ended (password changed or admin logout). Please log in again.', 'warn');
            } else {
                _notify(Utils.t('misc.sessionExpired') || 'Session expired. Please login again.', 'warn');
            }
        } catch(e) {
            _notify(Utils.t('misc.sessionExpired') || 'Session expired. Please login again.', 'warn');
        }
        localStorage.clear();
        setTimeout(() => window.location.reload(), 500);
        throw new Error('Unauthorized');
    }
    if (res.status === 403) {
        _notify(Utils.t('users.accessDeniedEdit') || 'Access denied.', 'error');
        throw new Error('Forbidden');
    }
    if (res.status === 429) {
        _notify(Utils.t('api.rateLimited') || 'Too many requests. Please wait.', 'warn');
        throw new Error('Rate Limited');
    }
    if (res.status >= 500) {
        let errMsg = Utils.t('api.serverError') || 'Internal server error.';
        try {
            const errObj = await res.json();
            if(errObj.error) errMsg = Utils.t(errObj.error) || errObj.error;
        } catch(e){}
        _notify(errMsg, 'error');
        throw new Error(errMsg);
    }
    if (!res.ok) {
        let errMsg = `HTTP error! status: ${res.status}`;
        try {
            const errObj = await res.json();
            if(errObj.error) errMsg = Utils.t(errObj.error) || errObj.error;
        } catch(e){}
        throw new Error(errMsg);
    }
}

// CSRF token cache — server generiše token po sesiji; ovde ga držimo u
// memoriji i dodajemo na svaki mutating (POST/PUT/DELETE/PATCH) zahtev.
// Globalni monkey-patch nad window.fetch garantuje da svaka POST/PUT/DELETE ruta
// (uključujući raw fetch pozive u ui.js/utils.js) dobije CSRF header, bez ručnog
// dodavanja u desetinama call-site-ova.
let __CSRF_TOKEN = null;

(function _installCsrfInterceptor(){
    if (window.__csrfFetchPatched) return;
    window.__csrfFetchPatched = true;
    const __origFetch = window.fetch.bind(window);

    async function _getToken() {
        if (__CSRF_TOKEN) return __CSRF_TOKEN;
        try {
            const r = await __origFetch('/api/csrf/token', { credentials: 'same-origin' });
            if (r.ok) {
                const j = await r.json();
                __CSRF_TOKEN = j.csrf_token || null;
            }
        } catch (e) {}
        return __CSRF_TOKEN;
    }

    function _needs(method, url) {
        const m = (method || 'GET').toUpperCase();
        if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
        const u = (typeof url === 'string') ? url : (url && url.url) || '';
        if (u.startsWith('/api/portal/')) return false;
        if (u.startsWith('http://') || u.startsWith('https://')) return false;  // cross-origin
        return true;
    }

    window.fetch = async function(input, init) {
        init = init || {};
        if (_needs(init.method, input)) {
            const tok = await _getToken();
            if (tok) {
                const headers = new Headers(init.headers || {});
                if (!headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', tok);
                init.headers = headers;
            }
        }
        let res = await __origFetch(input, init);
        // Ako je CSRF pao (401/403 sa CSRF_TOKEN_INVALID), povuci nov token i pokušaj još jednom.
        if (res.status === 403 && _needs(init.method, input)) {
            try {
                const j = await res.clone().json();
                if (j && j.error === 'CSRF_TOKEN_INVALID') {
                    __CSRF_TOKEN = null;
                    const tok = await _getToken();
                    if (tok) {
                        const headers = new Headers(init.headers || {});
                        headers.set('X-CSRF-Token', tok);
                        init.headers = headers;
                        res = await __origFetch(input, init);
                    }
                }
            } catch (e) {}
        }
        return res;
    };
})();

async function ensureCsrfToken() {
    if (__CSRF_TOKEN) return __CSRF_TOKEN;
    try {
        const r = await fetch('/api/csrf/token', { credentials: 'same-origin' });
        if (r.ok) {
            const j = await r.json();
            __CSRF_TOKEN = j.csrf_token || null;
        }
    } catch (e) { /* biće ponovo pokušano na sledeći zahtev */ }
    return __CSRF_TOKEN;
}

function _needsCsrf(method, url) {
    const m = (method || 'GET').toUpperCase();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
    if (typeof url === 'string' && url.startsWith('/api/portal/')) return false;  // portal koristi X-Portal-Auth
    return true;
}

async function fetchWithRetry(url, options = {}, retries = 2, delay = 1000) {
    // Ubaci CSRF header za mutating zahteve (idempotentno; ne menja postojeće).
    if (_needsCsrf(options.method, url)) {
        const tok = await ensureCsrfToken();
        if (tok) {
            options.headers = Object.assign({}, options.headers || {}, { 'X-CSRF-Token': tok });
        }
    }
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await fetch(url, options);
            // Ako je CSRF token zastareo (npr. sesija resetovana), povuci nov i pokušaj ponovo jednom.
            if (res.status === 403 && _needsCsrf(options.method, url) && i === 0) {
                try {
                    const errJson = await res.clone().json();
                    if (errJson && errJson.error === 'CSRF_TOKEN_INVALID') {
                        __CSRF_TOKEN = null;
                        const tok = await ensureCsrfToken();
                        if (tok) {
                            options.headers = Object.assign({}, options.headers || {}, { 'X-CSRF-Token': tok });
                            continue;
                        }
                    }
                } catch (e) { /* nije JSON, propagiraj */ }
            }
            if (res.status === 503 && i < retries) {
                await new Promise(r => setTimeout(r, delay * (i + 1)));
                continue;
            }
            return res;
        } catch (error) {
            if (i === retries) throw error;
            console.warn(`Network hiccup. Retrying API call to ${url} (Attempt ${i + 1} of ${retries})...`);
            await new Promise(r => setTimeout(r, delay * (i + 1)));
        }
    }
}

async function loadFromStorage() {
  try {
      for (const key of DATA_KEYS) {
          const res = await fetchWithRetry(`/api/data/${key}?t=${Date.now()}`, {}, 2, 500);
          if(!res.ok && res.status === 403) continue; 
          await handleApiError(res);
          
          let json;
          try {
              json = await res.json();
          } catch(parseError) {
              console.error(`Oštećen JSON sa servera za modul: ${key}`, parseError);
              continue; 
          }
          
          const loadedData = json.value;
          if (loadedData !== null && loadedData !== undefined) {
              if (['partners', 'products', 'deals', 'demands', 'accounts', 'transactions', 'recurringExpenses', 'connections', 'offers'].includes(key)) {
                  state.data[key] = loadedData;
              } else if (key === 'settings') {
                  state.settings = { ...state.settings, ...loadedData };
              } else {
                  state[key] = loadedData;
              }
          }
      }
      if(state.settings.lang) state.lang = state.settings.lang;
      if(state.settings.fileLimitMB) FILE_LIMIT_MB = state.settings.fileLimitMB;
  } catch(e) { 
      console.error(Utils.t('api.dbLoadError'), e); 
      if (!navigator.onLine) {
          if(typeof UI !== 'undefined' && UI.showNotification) {
              UI.showNotification(Utils.t('api.offline') || 'Offline mode. Cached data shown.', 'error');
          }
      }
  }
}

async function saveToStorage(key) {
  try {
      let dataToSave = (key in state.data) ? state.data[key] : state[key];
      const res = await fetchWithRetry(`/api/data/${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: dataToSave }) });
      await handleApiError(res);
  } catch(e) { 
      console.error(Utils.t('api.bulkSaveError'), e); 
      throw e; 
  }
}

async function saveSingleItem(key, item) {
    if (typeof showLoader === 'function') showLoader((typeof Utils !== 'undefined' && Utils.t('loader.saving')) || 'Saving…');
    try {
        const res = await fetchWithRetry(`/api/item/${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item)
        });
        await handleApiError(res);
        return true;
    } catch(e) {
        console.error(Utils.t('api.singleSaveError'), e);
        throw e;
    } finally {
        if (typeof hideLoader === 'function') hideLoader();
    }
}

async function deleteItemFromServer(key, id) {
    if (typeof showLoader === 'function') showLoader((typeof Utils !== 'undefined' && Utils.t('loader.deleting')) || 'Deleting…');
    try {
        const res = await fetchWithRetry(`/api/item/${key}/${id}`, { method: 'DELETE' });
        await handleApiError(res);
    } catch(e) {
        console.error(Utils.t('api.deleteError'), e); throw e;
    } finally {
        if (typeof hideLoader === 'function') hideLoader();
    }
}

async function deleteFileFromServer(fileUrl) {
    if (!fileUrl) return;
    try {
        const filename = fileUrl.split('/').pop();
        const res = await fetchWithRetry(`/api/upload/${filename}`, { method: 'DELETE' });
        await handleApiError(res);
    } catch(e) { console.error(Utils.t('api.fileDeleteError'), e); }
}

async function saveDocumentToVault(payload) {
    const res = await fetchWithRetry('/api/vault/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    await handleApiError(res);
    return res.json();
}

// exportDatabase() se definiše u core/export.js (učitava se posle ovog fajla i
// override-uje ovaj stub); zadržan je stub ovde radi backward-compat sa
// modulama koji ga zovu pre nego što export.js dođe na red.
async function exportDatabase() {
  if (typeof window._exportDatabaseImpl === 'function') return window._exportDatabaseImpl();
  console.warn('exportDatabase pozvano pre nego što je export.js učitan');
}

async function importDatabase(file) {
  if (!file) return; const reader = new FileReader();
  reader.onload = async (e) => {
      try {
          const importedData = JSON.parse(e.target.result);
          // import-btn-txt element ne mora postojati u svakoj tema-verziji navigacije;
          // ranije je throw-ovao NULL error i abort-ovao ceo import pre nego što
          // bi ijedan zapis stigao u bazu.
          const _btnTxt = document.getElementById('import-btn-txt');
          if (_btnTxt) _btnTxt.innerText = `⏳ ${Utils.t('misc.loadingStatus')}`;
          if (typeof showLoader === 'function') showLoader(Utils.t('misc.loadingStatus') || 'Importing…');
          
          for (const key of Object.keys(importedData)) {
              if (!DATA_KEYS.includes(key)) continue;
              const importedItems = importedData[key];
              
              if (typeof importedItems !== 'object' || !Array.isArray(importedItems)) {
                  if(key in state.data) state.data[key] = importedItems; else state[key] = importedItems; 
                  await saveToStorage(key); 
                  continue;
              }
              
              const currentItems = state.data[key] || []; 
              const currentItemsMap = new Map(currentItems.map(item => [item.id, item]));
              
              for (const importedItem of importedItems) {
                  if (importedItem.id && currentItemsMap.has(importedItem.id)) {
                      Object.assign(currentItemsMap.get(importedItem.id), importedItem);
                  } else if (importedItem.id && !currentItemsMap.has(importedItem.id)) {
                      currentItems.push(importedItem);
                  }
              }
              state.data[key] = currentItems;
              await saveToStorage(key);
          }
          
          const _btnTxt2 = document.getElementById('import-btn-txt');
          if (_btnTxt2) _btnTxt2.innerHTML = `📥 <span class="text-xs ml-1">${Utils.t('misc.importLabel')}</span>`;
          if (typeof hideLoader === 'function') hideLoader();
          if (typeof showToast === 'function') showToast(Utils.t('misc.importSuccess') || 'Import success', 'success');
          else alert(Utils.t('misc.importSuccess'));
          await loadFromStorage();
          if (typeof render === 'function') { render(); } else { window.location.reload(); }
      } catch (err) {
          if (typeof hideLoader === 'function') hideLoader();
          if (typeof showToast === 'function') showToast((Utils.t('misc.importError') || 'Import error') + ': ' + (err.message || err), 'error');
          else alert(Utils.t('misc.importError') || 'Import error or corrupted file.');
          console.error(err);
      }
  };
  reader.readAsText(file);
}

function parseCSVLine(line) {
    const result = []; let current = ''; let inQuotes = false;
    for(let i=0; i<line.length; i++){
        if(line[i] === '"') { inQuotes = !inQuotes; }
        else if(line[i] === ',' && !inQuotes) { result.push(current.trim().replace(/^"|"$/g, '')); current = ''; }
        else { current += line[i]; }
    }
    result.push(current.trim().replace(/^"|"$/g, ''));
    return result;
}

// Universal tabular loader — vraća Promise<Array<Object>> gde je svaki
// objekat jedan red iz fajla, ključevi su headers iz prvog reda.
// Podržava CSV, TSV, XLSX, XLS. XLSX/XLS koristi SheetJS koji se lazy-load-uje
// sa CDN-a samo kada zaista treba (izbegavamo bespotrebnih 400KB na page load).
async function loadTabularFile(file) {
    if (!file) return [];
    const name = String(file.name || '').toLowerCase();
    const ext = name.split('.').pop();

    if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') {
        // Lazy-load SheetJS iz CDN-a
        if (typeof XLSX === 'undefined') {
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.20.3/dist/xlsx.full.min.js';
                s.onload = () => resolve();
                s.onerror = () => reject(new Error('SheetJS CDN unreachable'));
                document.head.appendChild(s);
            });
        }
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const first = wb.SheetNames[0];
        if (!first) return [];
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[first], { defval: '', raw: false });
        return rows;
    }

    // CSV / TSV — čitamo kao tekst
    const text = await file.text();
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) return [];
    const sep = ext === 'tsv' ? '\t' : ',';
    const parseLine = (line) => {
        if (sep === '\t') return line.split('\t').map(s => s.trim());
        return parseCSVLine(line);
    };
    const headers = parseLine(lines[0]);
    const out = [];
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '') continue;
        const values = parseLine(lines[i]);
        const row = {};
        headers.forEach((h, idx) => { row[h] = values[idx] != null ? values[idx] : ''; });
        out.push(row);
    }
    return out;
}
window.loadTabularFile = loadTabularFile;

async function importPartnersFromCSV(file) {
  if (!file) return;
  try {
      const rows = await loadTabularFile(file);
      let addedCount = 0;
      for (const rowData of rows) {
          const newPartner = {
              id: Utils.generateId(), companyName: rowData.companyName || '', taxId: rowData.taxId || '', regNumber: rowData.regNumber || '',
              entityType: rowData.entityType || 'company', linkedCompanyId: null,
              address: { street: rowData.street || '', city: rowData.city || '', zip: rowData.zip || '', country: rowData.country || '' },
              contact: { person: rowData.contactPerson || '', email: rowData.contactEmail || '', phone: rowData.phone || '' },
              bank: { name: rowData.bankName || '', accountNumber: rowData.accountNumber || '', swift: rowData.swift || '' },
              types: rowData.types ? String(rowData.types).split(';').map(t => t.trim()) : [],
              notes: rowData.notes || '', documents: [], activities: [], lastModified: new Date().toISOString()
          };
          if (!newPartner.companyName) continue;
          state.data.partners.push(newPartner);
          addedCount++;
      }
      if (addedCount > 0) {
          await saveToStorage('partners');
          if (typeof showToast === 'function') showToast(`✓ Imported ${addedCount} partners.`, 'success');
          else alert(Utils.t('misc.partnersImported') || 'Partners successfully imported.');
          if (typeof render === 'function') { render(); } else { window.location.reload(); }
      } else {
          if (typeof showToast === 'function') showToast('No valid rows found — check that column headers include "companyName".', 'error');
      }
  } catch (err) {
      console.error(err);
      alert(Utils.t('misc.invalidCsv') || 'Invalid file format. Supported: CSV, TSV, XLSX, XLS.');
  }
}

async function importProductsFromCSV(file) {
  if (!file) return;
  try {
      const rows = await loadTabularFile(file);
      let addedCount = 0;
      for (const rowData of rows) {
          if (!rowData.name) continue;
          const prod = {
              id: Utils.generateId(),
              name: String(rowData.name).trim(),
              category: rowData.category || 'other',
              hsCode: rowData.hsCode || '',
              description: rowData.description || '',
              detailedSpec: '',
              supplyOffers: [],
              lastModified: new Date().toISOString()
          };
          state.data.products.push(prod);
          addedCount++;
      }
      if (addedCount > 0) {
          await saveToStorage('products');
          if (typeof showToast === 'function') showToast(`✓ Imported ${addedCount} products.`, 'success');
          else alert(Utils.t('misc.productsImported') || 'Products successfully imported.');
          if (typeof render === 'function') { render(); } else { window.location.reload(); }
      } else {
          if (typeof showToast === 'function') showToast('No valid rows — need at least a "name" column.', 'error');
      }
  } catch(err) {
      console.error(err);
      alert(Utils.t('misc.invalidCsv') || 'Invalid file format. Supported: CSV, TSV, XLSX, XLS.');
  }
}

async function importOffersFromCSV(file) {
  if (!file) return;
  try {
      const rows = await loadTabularFile(file);
      let changedProducts = false;
      let matched = 0, missed = 0;
      for (const rowData of rows) {
          const targetProduct = state.data.products.find(
              p => p.name.toLowerCase() === String(rowData.productName || '').toLowerCase().trim()
          );
          if (targetProduct) {
              targetProduct.supplyOffers = targetProduct.supplyOffers || [];
              targetProduct.supplyOffers.push({
                  supplierId: rowData.supplierId || '',
                  quantity: parseFloat(rowData.quantity) || 0,
                  price: parseFloat(rowData.price) || 0,
                  currency: rowData.currency || 'USD',
                  unit: rowData.unit || 'MT - Metric Ton',
                  country: rowData.country || '',
                  incoterm: rowData.incoterm || 'FOB',
                  certificates: rowData.certificates || '',
                  history: []
              });
              changedProducts = true;
              matched++;
          } else if (rowData.productName) {
              missed++;
          }
      }
      if (changedProducts) {
          await saveToStorage('products');
          const msg = missed > 0
            ? `✓ Imported ${matched} offers, ${missed} skipped (product name not found).`
            : `✓ Imported ${matched} offers.`;
          if (typeof showToast === 'function') showToast(msg, missed > 0 ? 'warning' : 'success');
          else alert(msg);
          if (typeof render === 'function') { render(); } else { window.location.reload(); }
      } else {
          if (typeof showToast === 'function') showToast('No matching products found — verify "productName" column matches existing products.', 'error');
      }
  } catch(err) {
      console.error(err);
      alert(Utils.t('misc.invalidCsv') || 'Invalid file format. Supported: CSV, TSV, XLSX, XLS.');
  }
}

async function fetchUsers() {
    try {
        const res = await fetchWithRetry('/api/users');
        await handleApiError(res);
        return await res.json();
    } catch(e) { console.error(Utils.t('api.usersLoadError'), e); return []; }
}

async function saveUser(userObj) {
    try {
        const res = await fetchWithRetry('/api/users', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(userObj) 
        });
        await handleApiError(res);
        return await res.json();
    } catch(e) { console.error(Utils.t('api.userSaveError'), e); throw e; }
}

async function deleteUser(id) {
    try {
        const res = await fetchWithRetry(`/api/users/${id}`, { method: 'DELETE' });
        await handleApiError(res);
        return await res.json();
    } catch(e) { console.error(Utils.t('api.userDeleteError'), e); throw e; }
}