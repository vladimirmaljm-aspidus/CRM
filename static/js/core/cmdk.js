// static/js/core/cmdk.js
// Cmd/Ctrl+K global search & action palette — inspired by Linear/VS Code/Notion.
//
// Opens with:
//   * Cmd+K on macOS
//   * Ctrl+K on Windows/Linux
//   * '/' key when no input is focused (like Notion)
//
// Searches across partners, products, deals, offers, invoices, then bubbles
// up quick actions ("Create deal", "Create offer", "New partner", "Open
// settings", "Logout"). Enter opens the selected item / runs the action.
// Arrow keys navigate.

(function () {
    'use strict';

    // Ne registruj se dva puta (u slučaju hot-reload-a)
    if (window.__cmdkInstalled) return;
    window.__cmdkInstalled = true;

    // ---------- Styles ----------
    const style = document.createElement('style');
    style.textContent = `
        .cmdk-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.55);
            backdrop-filter: blur(4px); z-index: 99998; display: flex;
            align-items: flex-start; justify-content: center; padding-top: 12vh;
            animation: cmdk-fade .12s ease-out; font-family: Inter,system-ui,sans-serif; }
        @keyframes cmdk-fade { from { opacity: 0; } to { opacity: 1; } }
        .cmdk-panel { background: #fff; border-radius: 14px; width: 100%;
            max-width: 640px; box-shadow: 0 24px 60px rgba(0,0,0,.35),
            0 2px 8px rgba(0,0,0,.15); overflow: hidden;
            animation: cmdk-slide .16s ease-out; }
        @keyframes cmdk-slide { from { transform: translateY(-8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .cmdk-input { width: 100%; padding: 18px 22px; font-size: 16px; border: none;
            outline: none; border-bottom: 1px solid #e2e8f0; color: #0f172a;
            font-family: inherit; }
        .cmdk-input::placeholder { color: #94a3b8; }
        .cmdk-list { max-height: 52vh; overflow-y: auto; padding: 6px 0; }
        .cmdk-group { padding: 6px 20px; font-size: 10px; font-weight: 800;
            color: #94a3b8; text-transform: uppercase; letter-spacing: .08em; }
        .cmdk-item { display: flex; align-items: center; gap: 12px;
            padding: 9px 20px; cursor: pointer; color: #0f172a;
            transition: background .06s; }
        .cmdk-item:hover, .cmdk-item.active { background: #eff6ff; }
        .cmdk-icon { width: 32px; height: 32px; display: flex; align-items: center;
            justify-content: center; border-radius: 8px; flex-shrink: 0;
            background: #f1f5f9; font-size: 16px; }
        .cmdk-content { flex: 1; min-width: 0; }
        .cmdk-title { font-size: 14px; font-weight: 600; overflow: hidden;
            text-overflow: ellipsis; white-space: nowrap; }
        .cmdk-subtitle { font-size: 12px; color: #64748b; overflow: hidden;
            text-overflow: ellipsis; white-space: nowrap; }
        .cmdk-hint { font-size: 10px; color: #94a3b8; padding: 6px 20px;
            border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between;
            background: #f8fafc; }
        .cmdk-kbd { display: inline-block; padding: 1px 6px; background: #fff;
            border: 1px solid #cbd5e1; border-radius: 4px; font-family: monospace;
            font-size: 10px; }
        .cmdk-empty { padding: 30px 20px; text-align: center; color: #94a3b8;
            font-size: 13px; }
    `;
    document.head.appendChild(style);

    // ---------- Actions catalog (static) ----------
    // Actions bubble to top when query matches; otherwise appear at bottom.
    function _actions() {
        return [
            { id: 'a-new-deal',    icon: '🤝', title: 'Create new deal',    keywords: 'deal contract trade new create',    run: () => window.location.hash = '#deals' },
            { id: 'a-new-offer',   icon: '📄', title: 'Create new offer',   keywords: 'offer quote proposal new create',   run: () => window.location.hash = '#offers' },
            { id: 'a-new-partner', icon: '👥', title: 'Add new partner',    keywords: 'partner supplier buyer new create client', run: () => window.location.hash = '#partners' },
            { id: 'a-new-product', icon: '📦', title: 'Add new product',    keywords: 'product goods sku new create',      run: () => window.location.hash = '#products' },
            { id: 'a-new-invoice', icon: '💳', title: 'Create new invoice', keywords: 'invoice bill new create',           run: () => window.location.hash = '#invoices' },
            { id: 'a-logistics',   icon: '🚢', title: 'Open logistics planner', keywords: 'logistics route shipping planner', run: () => { if (typeof openLogisticsPlanner === 'function') openLogisticsPlanner({}); } },
            { id: 'a-audit',       icon: '📜', title: 'Open audit log',     keywords: 'audit log security history',        run: () => window.location.hash = '#audit' },
            { id: 'a-settings',    icon: '⚙️', title: 'Open settings',      keywords: 'settings preferences config',       run: () => window.location.hash = '#settings' },
            { id: 'a-profile',     icon: '👤', title: 'My profile / 2FA',   keywords: 'profile me account 2fa password',   run: () => { if (typeof showProfileMe === 'function') showProfileMe(); } },
            { id: 'a-logout',      icon: '🚪', title: 'Log out',            keywords: 'logout signout leave',              run: async () => { await fetch('/api/auth/logout', {method:'POST'}); window.location.reload(); } },
        ];
    }

    // ---------- Fuzzy scorer ----------
    // Rank by: (a) exact substring match, (b) all query tokens present in field
    function _score(q, haystack) {
        if (!q) return 0;
        q = q.toLowerCase();
        haystack = String(haystack || '').toLowerCase();
        if (!haystack) return 0;
        if (haystack === q) return 200;
        if (haystack.startsWith(q)) return 130;
        if (haystack.includes(q)) return 80;
        // Token overlap
        const tokens = q.split(/\s+/).filter(Boolean);
        if (!tokens.length) return 0;
        let hit = 0;
        for (const t of tokens) if (t.length >= 2 && haystack.includes(t)) hit++;
        if (hit === tokens.length) return 30 + hit * 5;
        return 0;
    }

    // ---------- Result assembly ----------
    function _search(query) {
        const q = String(query || '').trim();
        const results = [];
        if (!q) {
            // Empty query — show top actions + recent items placeholder
            _actions().forEach(a => {
                results.push({...a, group: 'Actions', score: 1});
            });
            return results;
        }
        const state = window.state || {};
        const D = state.data || {};

        // Partners
        (D.partners || []).forEach(p => {
            const s = Math.max(
                _score(q, p.companyName),
                _score(q, p.taxId),
                _score(q, p.email),
                _score(q, p.contactPerson),
            );
            if (s > 0) results.push({
                id: 'p-' + p.id, icon: '👥', group: 'Partners',
                title: p.companyName || p.contactPerson || 'Partner',
                subtitle: [(p.types || []).join('/'), p.address?.country, p.taxId].filter(Boolean).join(' · '),
                run: () => { state.detailViewId = p.id; window.location.hash = '#partners'; if (typeof renderMainView === 'function') renderMainView(); },
                score: s,
            });
        });
        // Products
        (D.products || []).forEach(p => {
            const s = Math.max(
                _score(q, p.name),
                _score(q, p.sku),
                _score(q, p.hsCode),
                _score(q, p.brand),
                _score(q, p.casNumber),
            );
            if (s > 0) results.push({
                id: 'pr-' + p.id, icon: '📦', group: 'Products',
                title: p.name,
                subtitle: [p.category, p.brand, p.hsCode && ('HS ' + p.hsCode), p.sku].filter(Boolean).join(' · '),
                run: () => { state.detailViewId = p.id; window.location.hash = '#products'; if (typeof renderMainView === 'function') renderMainView(); },
                score: s,
            });
        });
        // Deals
        (D.deals || []).forEach(d => {
            const partnerName = ((D.partners || []).find(p => p.id === d.buyerId) || {}).companyName || '';
            const productName = ((D.products || []).find(p => p.id === d.productId) || {}).name || '';
            const s = Math.max(
                _score(q, d.contractId),
                _score(q, partnerName),
                _score(q, productName),
            );
            if (s > 0) results.push({
                id: 'd-' + d.id, icon: '🤝', group: 'Deals',
                title: d.contractId || 'Deal',
                subtitle: [partnerName, productName, d.status].filter(Boolean).join(' · '),
                run: () => { state.detailViewId = d.id; window.location.hash = '#deals'; if (typeof renderMainView === 'function') renderMainView(); },
                score: s,
            });
        });
        // Offers
        (D.offers || []).forEach(o => {
            const buyerName = ((D.partners || []).find(p => p.id === o.customerId) || {}).companyName || '';
            const s = Math.max(
                _score(q, o.offerNo),
                _score(q, buyerName),
                _score(q, o.subject),
            );
            if (s > 0) results.push({
                id: 'o-' + o.id, icon: '📄', group: 'Offers',
                title: o.offerNo || 'Offer',
                subtitle: [buyerName, o.status, o.clientStatus].filter(Boolean).join(' · '),
                run: () => { state.detailViewId = o.id; window.location.hash = '#offers'; if (typeof renderMainView === 'function') renderMainView(); },
                score: s,
            });
        });
        // Actions (always available)
        _actions().forEach(a => {
            const s = Math.max(_score(q, a.title), _score(q, a.keywords));
            if (s > 0) results.push({...a, group: 'Actions', score: s});
        });

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, 30);
    }

    // ---------- Palette ----------
    let overlay = null;

    function _open() {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.className = 'cmdk-overlay';
        overlay.innerHTML = `
            <div class="cmdk-panel" role="dialog" aria-label="Command palette">
                <input class="cmdk-input" id="cmdk-input" placeholder="Search partners, products, deals, offers — or type an action…" autocomplete="off" spellcheck="false" />
                <div class="cmdk-list" id="cmdk-list"></div>
                <div class="cmdk-hint">
                    <span><span class="cmdk-kbd">↑↓</span> navigate · <span class="cmdk-kbd">↵</span> select · <span class="cmdk-kbd">Esc</span> close</span>
                    <span>Aspidus CRM · ⌘K</span>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const input = overlay.querySelector('#cmdk-input');
        const list = overlay.querySelector('#cmdk-list');
        let activeIdx = 0;
        let items = [];

        function render() {
            const q = input.value;
            items = _search(q);
            if (!items.length) {
                list.innerHTML = `<div class="cmdk-empty">${q ? 'No results for "' + escapeHtml(q) + '"' : 'Start typing to search…'}</div>`;
                return;
            }
            let html = '';
            let lastGroup = null;
            items.forEach((it, i) => {
                if (it.group !== lastGroup) {
                    html += `<div class="cmdk-group">${escapeHtml(it.group)}</div>`;
                    lastGroup = it.group;
                }
                html += `
                    <div class="cmdk-item ${i === activeIdx ? 'active' : ''}" data-i="${i}">
                        <div class="cmdk-icon">${it.icon || '·'}</div>
                        <div class="cmdk-content">
                            <div class="cmdk-title">${escapeHtml(it.title || '')}</div>
                            ${it.subtitle ? `<div class="cmdk-subtitle">${escapeHtml(it.subtitle)}</div>` : ''}
                        </div>
                    </div>`;
            });
            list.innerHTML = html;
            list.querySelectorAll('.cmdk-item').forEach(el => {
                el.addEventListener('mouseenter', () => {
                    activeIdx = parseInt(el.dataset.i, 10);
                    render();
                });
                el.addEventListener('click', () => run(parseInt(el.dataset.i, 10)));
            });
            // Scroll active into view
            const act = list.querySelector('.cmdk-item.active');
            if (act && act.scrollIntoView) act.scrollIntoView({block: 'nearest'});
        }

        function run(idx) {
            if (idx < 0 || idx >= items.length) return;
            const it = items[idx];
            close();
            try { it.run(); } catch (e) { console.error('cmdk action failed', e); }
        }

        function close() {
            if (overlay) { document.body.removeChild(overlay); overlay = null; }
        }

        // OCR search je async — koristimo debounce da ne spamujemo endpoint.
        let ocrHits = [];
        let ocrTimer = null;
        function scheduleOcrSearch(q) {
            if (ocrTimer) clearTimeout(ocrTimer);
            if (!q || q.length < 3) { ocrHits = []; return; }
            ocrTimer = setTimeout(async () => {
                try {
                    const r = await fetch('/api/documents/search?q=' + encodeURIComponent(q));
                    if (!r.ok) return;
                    const j = await r.json();
                    ocrHits = (j.results || []).slice(0, 5).map(h => ({
                        id: 'ocr-' + (h.file_url || ''),
                        icon: '📎',
                        group: 'Document contents (OCR)',
                        title: (h.filename || h.file_url || '').split('/').pop(),
                        subtitle: (h.preview || '').substring(0, 100),
                        run: () => { window.open(h.file_url, '_blank'); },
                        score: 0.6,  // niži od direct name match
                    }));
                    render();
                } catch(_) {}
            }, 300);
        }
        // Ubaci OCR hitove u result assembly (patch — najniže prioriteta)
        const _origRender = render;
        render = function() {
            _origRender();
            if (ocrHits.length && input.value.trim().length >= 3) {
                // append u listu ako nisu tu
                items.push(...ocrHits);
                // ponovo pozovi originalni render sa updated items — al' zapravo
                // items je vec renderovan; jednostavnije: re-invoke _origRender
                // sa novom listom. Da izbegnemo rekurziju, pritisnimo flag.
                if (!window._cmdkOcrRePainted) {
                    window._cmdkOcrRePainted = true;
                    _origRender();
                    window._cmdkOcrRePainted = false;
                }
            }
        };

        input.addEventListener('input', () => {
            activeIdx = 0;
            scheduleOcrSearch(input.value.trim());
            render();
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, items.length - 1); render(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); render(); }
            else if (e.key === 'Enter') { e.preventDefault(); run(activeIdx); }
            else if (e.key === 'Escape') { e.preventDefault(); close(); }
        });
        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) close();
        });
        input.focus();
        render();
    }

    // Global keybinding
    document.addEventListener('keydown', (e) => {
        // Cmd+K / Ctrl+K
        if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
            e.preventDefault();
            _open();
            return;
        }
        // '/' when no input focused (Notion-style)
        if (e.key === '/' && !overlay) {
            const tag = (document.activeElement && document.activeElement.tagName) || '';
            if (!/^(INPUT|TEXTAREA|SELECT)$/.test(tag) && !document.activeElement.isContentEditable) {
                e.preventDefault();
                _open();
            }
        }
    });

    // Public API — open programatski (npr. iz help menija)
    window.openCommandPalette = _open;
})();
