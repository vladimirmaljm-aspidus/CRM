// static/js/modules/users/portal_preview.js
// Admin alat: bira partnera, vidi šta on trenutno vidi u portalu (tabovi,
// proizvodi u katalogu), i može da:
//   - uključi/isključi pojedine tabove za tog klijenta
//   - odabere KOJE proizvode klijent vidi u Catalog tabu
// Sve prolazi kroz jedan endpoint: POST /api/portal/admin/permissions/<partner_id>

function renderPortalPreviewView() {
    const main = document.getElementById('main-content');
    main.innerHTML = '';

    const isAdmin = state.user && state.user.role === 'admin';
    const hasPerm = state.user && state.user.permissions && state.user.permissions.portal_preview_manage;
    if (!isAdmin && !hasPerm) {
        main.innerHTML = `<div class="p-10 text-center"><h2 class="text-3xl text-red-500 font-bold mb-4">${Utils.t('users.accessDenied') || 'Access Denied'}</h2></div>`;
        return;
    }

    const partners = (state.data.partners || []).slice().sort((a,b) => (a.companyName||'').localeCompare(b.companyName||''));
    const products = (state.data.products || []).slice().sort((a,b) => (a.name||'').localeCompare(b.name||''));

    main.innerHTML = `
      <div class="mb-6">
        <h2 class="text-2xl md:text-3xl font-extrabold text-main">${Utils.t('portalPreview.title') || 'Portal Preview & Access Control'}</h2>
        <p class="text-sm text-[var(--muted)] mt-1">${Utils.t('portalPreview.desc') || 'See exactly what each client sees, and control their tab-level access and product catalog visibility.'}</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="lg:col-span-1 bg-[var(--card)] border border-[var(--border)] rounded-2xl p-4 shadow-sm">
          <label class="block text-xs font-bold uppercase tracking-widest text-[var(--muted)] mb-2">${Utils.t('portalPreview.selectClient') || 'Select client'}</label>
          <input id="pp-partner-search" placeholder="Search…" class="form-input bg-[var(--card)] border-[var(--border)] w-full mb-2 text-sm"/>
          <div id="pp-partner-list" class="max-h-[60vh] overflow-y-auto space-y-1 custom-scrollbar"></div>
        </div>
        <div class="lg:col-span-2" id="pp-detail-panel">
          <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-8 shadow-sm text-center text-[var(--muted)]">
            ${Utils.t('portalPreview.pickHint') || 'Choose a client on the left to view and edit their portal access.'}
          </div>
        </div>
      </div>
    `;

    const renderPartnerList = (q) => {
        const filtered = q
            ? partners.filter(p => (p.companyName||'').toLowerCase().includes(q.toLowerCase()))
            : partners;
        const box = document.getElementById('pp-partner-list');
        if (!filtered.length) {
            box.innerHTML = `<div class="text-[var(--muted)] text-sm p-4 text-center">${Utils.t('portalPreview.noPartners') || 'No partners.'}</div>`;
            return;
        }
        box.innerHTML = filtered.map(p => `
          <button data-id="${p.id}" class="pp-partner-btn w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--hover-bg)] border border-transparent hover:border-[var(--border)] transition-colors">
            <span class="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold flex-shrink-0">${escapeHtml((p.companyName||'?').charAt(0).toUpperCase())}</span>
            <span class="flex-1 min-w-0">
              <div class="text-sm font-semibold text-main truncate">${escapeHtml(p.companyName || '(unnamed)')}</div>
              <div class="text-[10px] text-[var(--muted)] truncate">${escapeHtml((p.contact&&p.contact.email) || p.email || '')}</div>
            </span>
            ${p.portalToken ? `<span class="text-[9px] font-bold uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1 py-0.5 flex-shrink-0">Portal</span>` : ''}
          </button>`).join('');
        box.querySelectorAll('.pp-partner-btn').forEach(btn => btn.addEventListener('click', () => loadPartnerPreview(btn.dataset.id)));
    };
    renderPartnerList('');
    document.getElementById('pp-partner-search').addEventListener('input', e => renderPartnerList(e.target.value));

    const loadPartnerPreview = async (partnerId) => {
        const panel = document.getElementById('pp-detail-panel');
        panel.innerHTML = `<div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-8 shadow-sm text-center text-[var(--muted)]">Loading…</div>`;
        try {
            const res = await fetch(`/api/portal/admin/preview/${partnerId}`);
            if (!res.ok) throw new Error('http ' + res.status);
            const info = await res.json();
            renderDetailPanel(info);
        } catch (e) {
            panel.innerHTML = `<div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-6 shadow-sm text-red-600">Failed to load: ${escapeHtml(e.message)}</div>`;
        }
    };

    const ALL_TABS = [
        { key: 'shipments', label: 'Shipments' },
        { key: 'offers', label: 'Offers' },
        { key: 'rfq', label: 'My RFQs' },
        { key: 'documents', label: 'Documents' },
        { key: 'catalog', label: 'Catalog' },
        { key: 'goods', label: 'My Products' },
        { key: 'kyc', label: 'KYC / Compliance' },
        { key: 'profile', label: 'Profile' }
    ];

    const renderDetailPanel = (info) => {
        const panel = document.getElementById('pp-detail-panel');
        const perms = new Set(info.permissions || []);
        const visible = new Set(info.visible_products || []);

        panel.innerHTML = `
          <div class="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5 shadow-sm">
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4 pb-4 border-b border-[var(--border)]">
              <div>
                <div class="text-xs font-bold uppercase tracking-widest text-[var(--muted)]">${Utils.t('portalPreview.previewingFor') || 'Previewing for'}</div>
                <h3 class="text-lg md:text-xl font-bold text-main">${escapeHtml(info.company_name || 'Unknown')}</h3>
                <div class="text-xs text-[var(--muted)]">${escapeHtml(info.email || '')} · ${info.isPortalActive ? '<span class="text-emerald-700 font-bold">Portal active</span>' : '<span class="text-red-600 font-bold">Portal revoked</span>'}</div>
              </div>
              <div class="flex flex-wrap gap-2">
                ${info.portalToken ? `<a href="/portal/${encodeURIComponent(info.portalToken)}" target="_blank" class="btn small bg-indigo-600 text-white text-xs">Open in new tab →</a>` : ''}
                <button id="pp-save-btn" class="btn small bg-emerald-600 text-white text-xs">Save changes</button>
              </div>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <div class="bg-[var(--panel)] border border-[var(--border)] rounded-xl p-3">
                <div class="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Offers</div>
                <div class="text-xl font-black text-main">${info.counts.offers}</div>
              </div>
              <div class="bg-[var(--panel)] border border-[var(--border)] rounded-xl p-3">
                <div class="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Deals</div>
                <div class="text-xl font-black text-main">${info.counts.deals}</div>
              </div>
              <div class="bg-[var(--panel)] border border-[var(--border)] rounded-xl p-3">
                <div class="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">RFQs</div>
                <div class="text-xl font-black text-main">${info.counts.demands}</div>
              </div>
              <div class="bg-[var(--panel)] border border-[var(--border)] rounded-xl p-3">
                <div class="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Documents</div>
                <div class="text-xl font-black text-main">${info.counts.documents}</div>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 class="text-sm font-bold text-main mb-2">${Utils.t('portalPreview.tabAccess') || 'Tab access'}</h4>
                <p class="text-xs text-[var(--muted)] mb-3">${Utils.t('portalPreview.tabAccessDesc') || 'Uncheck a tab to hide it from this client.'}</p>
                <div class="space-y-1">
                  ${ALL_TABS.map(t => `
                    <label class="flex items-center gap-2 p-2 rounded hover:bg-[var(--hover-bg)] cursor-pointer">
                      <input type="checkbox" class="pp-tab-cb w-4 h-4" data-key="${t.key}" ${perms.has(t.key) ? 'checked' : ''}/>
                      <span class="text-sm text-main">${escapeHtml(t.label)}</span>
                    </label>`).join('')}
                </div>
              </div>
              <div>
                <h4 class="text-sm font-bold text-main mb-2">${Utils.t('portalPreview.catalogAccess') || 'Catalog visibility'}</h4>
                <p class="text-xs text-[var(--muted)] mb-3">${(Utils.t('portalPreview.catalogAccessDesc') || 'Select which products this client sees. Empty list = client sees nothing in the catalog.')}</p>
                <input id="pp-prod-search" placeholder="Search products…" class="form-input bg-[var(--card)] border-[var(--border)] w-full text-sm mb-2"/>
                <div class="text-[10px] text-[var(--muted)] mb-2 flex items-center justify-between">
                  <span>Selected: <span id="pp-prod-count" class="font-bold">${visible.size}</span> / ${products.length}</span>
                  <span class="flex gap-2">
                    <button id="pp-prod-all" class="text-blue-600 hover:underline">Select all</button>
                    <button id="pp-prod-none" class="text-red-600 hover:underline">Clear</button>
                  </span>
                </div>
                <div id="pp-prod-list" class="max-h-72 overflow-y-auto border border-[var(--border)] rounded-lg p-2 space-y-1 custom-scrollbar bg-[var(--panel)]"></div>
              </div>
            </div>
          </div>`;

        // Render product list
        const renderProdList = (q) => {
            const box = document.getElementById('pp-prod-list');
            const filtered = q
                ? products.filter(p => (p.name||'').toLowerCase().includes(q.toLowerCase()) || (p.category||'').toLowerCase().includes(q.toLowerCase()))
                : products;
            if (!filtered.length) {
                box.innerHTML = `<div class="text-[var(--muted)] text-xs p-3 text-center">${Utils.t('portalPreview.noProducts') || 'No products.'}</div>`;
                return;
            }
            box.innerHTML = filtered.map(p => `
              <label class="flex items-center gap-2 text-xs p-1 hover:bg-[var(--hover-bg)] rounded cursor-pointer">
                <input type="checkbox" class="pp-prod-cb w-3.5 h-3.5" data-id="${p.id}" ${visible.has(p.id) ? 'checked' : ''}/>
                <span class="flex-1 truncate text-main">${escapeHtml(p.name || '(unnamed)')}</span>
                <span class="text-[10px] text-[var(--muted)] truncate">${escapeHtml(p.category || '')}</span>
              </label>`).join('');

            box.querySelectorAll('.pp-prod-cb').forEach(cb => cb.addEventListener('change', () => {
                if (cb.checked) visible.add(cb.dataset.id); else visible.delete(cb.dataset.id);
                document.getElementById('pp-prod-count').textContent = visible.size;
            }));
        };
        renderProdList('');
        document.getElementById('pp-prod-search').addEventListener('input', e => renderProdList(e.target.value));
        document.getElementById('pp-prod-all').addEventListener('click', (ev) => { ev.preventDefault(); products.forEach(p => visible.add(p.id)); renderProdList(document.getElementById('pp-prod-search').value); });
        document.getElementById('pp-prod-none').addEventListener('click', (ev) => { ev.preventDefault(); visible.clear(); renderProdList(document.getElementById('pp-prod-search').value); });

        document.getElementById('pp-save-btn').addEventListener('click', async () => {
            const newPerms = [...document.querySelectorAll('.pp-tab-cb:checked')].map(cb => cb.dataset.key);
            const newVisible = [...visible];
            try {
                const res = await fetch(`/api/portal/admin/permissions/${info.partner_id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ permissions: newPerms, visible_products: newVisible })
                });
                if (res.ok) {
                    if (typeof showToast === 'function') showToast('Portal access updated.', 'success');
                } else {
                    if (typeof showToast === 'function') showToast('Save failed.', 'error');
                }
            } catch (e) {
                if (typeof showToast === 'function') showToast('Network error: ' + e.message, 'error');
            }
        });
    };
}

window.renderPortalPreviewView = renderPortalPreviewView;
