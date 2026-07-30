// static/js/modules/users/portal_activity.js
// Poseban admin view — beleži šta rade KLIJENTI portala (login-i, KYC, upload-i,
// pregled dokumenata, prihvatanje ponuda) sa lokacijama iz geo IP lookup-a.
// Razdvojeno od CRM audit loga jer su ovo eksterni korisnici (klijenti), a ne
// zaposleni firme.

function renderPortalActivityView() {
    const main = document.getElementById('main-content');
    main.innerHTML = '';

    const isAdmin = state.user && state.user.role === 'admin';
    const hasPortalActivityPerm = state.user && state.user.permissions && state.user.permissions.portal_activity_view;
    if (!isAdmin && !hasPortalActivityPerm) {
        main.innerHTML = `<div class="p-10 text-center"><h2 class="text-3xl text-red-500 font-bold mb-4">${Utils.t('users.accessDenied') || 'Access Denied'}</h2></div>`;
        return;
    }

    const title = Utils.t('portalActivity.title') || 'Portal Client Activity';
    const desc = Utils.t('portalActivity.desc') || 'Track logins, KYC submissions, uploads, and downloads by portal clients.';

    main.innerHTML = `
      <div class="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 class="text-2xl md:text-3xl font-extrabold text-main">${escapeHtml(title)}</h2>
          <p class="text-sm text-[var(--muted)] mt-1">${escapeHtml(desc)}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button id="pa-stats-btn" class="btn bg-indigo-600 text-white shadow-sm text-sm">${escapeHtml(Utils.t('portalActivity.stats30d') || 'Client Analytics (30d)')}</button>
          <button id="pa-refresh-btn" class="btn bg-[var(--panel)] border border-[var(--border)] text-main shadow-sm text-sm">${escapeHtml(Utils.t('audit.refresh') || 'Refresh')}</button>
        </div>
      </div>

      <div id="pa-filters" class="mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <input type="text" id="pa-search" class="form-input bg-[var(--card)] border-[var(--border)]" placeholder="${escapeHtml(Utils.t('portalActivity.searchPh') || 'Search company, IP, detail...')}"/>
        <select id="pa-partner-filter" class="form-input bg-[var(--card)] border-[var(--border)]"><option value="">${escapeHtml(Utils.t('portalActivity.allClients') || 'All clients')}</option></select>
        <select id="pa-action-filter" class="form-input bg-[var(--card)] border-[var(--border)]"><option value="">${escapeHtml(Utils.t('portalActivity.allActions') || 'All actions')}</option></select>
        <select id="pa-days-filter" class="form-input bg-[var(--card)] border-[var(--border)]">
          <option value="7">${escapeHtml(Utils.t('portalActivity.last7') || 'Last 7 days')}</option>
          <option value="30" selected>${escapeHtml(Utils.t('portalActivity.last30') || 'Last 30 days')}</option>
          <option value="90">${escapeHtml(Utils.t('portalActivity.last90') || 'Last 90 days')}</option>
          <option value="365">${escapeHtml(Utils.t('portalActivity.last365') || 'Last 12 months')}</option>
          <option value="all">${escapeHtml(Utils.t('portalActivity.allTime') || 'All time')}</option>
        </select>
      </div>

      <div id="pa-summary" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4"></div>

      <div id="pa-container" class="bg-[var(--card)] rounded-2xl shadow-xl border border-[var(--border)] overflow-x-auto">
        <div class="p-8 text-center text-[var(--muted)]">${escapeHtml(Utils.t('portalActivity.loading') || 'Loading portal activity…')}</div>
      </div>
    `;

    const currentLang = Utils.getLang() === 'sr' ? 'sr-RS' : 'en-US';
    let allRows = [];
    let distinctActions = [];
    let distinctPartners = new Map();

    const actionBadge = (act) => {
        const map = {
            'LOGIN_SUCCESS':   {bg:'bg-emerald-100 text-emerald-800 border-emerald-300', icon:'🔓'},
            'LOGIN_FAILED':    {bg:'bg-red-100 text-red-800 border-red-300', icon:'⛔'},
            'LOGIN_BLOCKED':   {bg:'bg-red-100 text-red-800 border-red-300', icon:'🚫'},
            'OTP_SENT':        {bg:'bg-blue-100 text-blue-800 border-blue-300', icon:'✉️'},
            'KYC_SUBMIT':      {bg:'bg-amber-100 text-amber-800 border-amber-300', icon:'📄'},
            'RFQ_SUBMIT':      {bg:'bg-indigo-100 text-indigo-800 border-indigo-300', icon:'📝'},
            'PRODUCT_SUBMIT':  {bg:'bg-purple-100 text-purple-800 border-purple-300', icon:'📦'},
            'DOCUMENT_DOWNLOAD':{bg:'bg-sky-100 text-sky-800 border-sky-300', icon:'⬇️'},
            'DOCUMENT_PREVIEW':{bg:'bg-sky-100 text-sky-800 border-sky-300', icon:'👁️'},
            'OFFER_ACCEPT':    {bg:'bg-emerald-100 text-emerald-800 border-emerald-300', icon:'✅'},
            'OFFER_DECLINE':   {bg:'bg-red-100 text-red-800 border-red-300', icon:'❌'},
            'SESSION_HIJACK_BLOCKED': {bg:'bg-red-200 text-red-900 border-red-500', icon:'🛡️'}
        };
        const cfg = map[act] || {bg:'bg-slate-100 text-slate-700 border-slate-300', icon:'•'};
        return `<span class="inline-flex items-center gap-1 border ${cfg.bg} px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wide">${cfg.icon} ${escapeHtml(act)}</span>`;
    };

    const locationCell = (loc) => {
        if (!loc || loc === 'N/A') return `<span class="text-[var(--muted)] text-xs">—</span>`;
        // Format: "City, Country (ISP: ...) | lat,lng"
        const parts = String(loc).split('|').map(s => s.trim());
        const place = parts[0] || '';
        const coords = parts[1] || '';
        const mapBtn = coords ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coords)}" target="_blank" rel="noopener" class="inline-block mt-1 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold px-2 py-0.5 rounded">${escapeHtml(Utils.t('audit.openMap') || 'Show map')}</a>` : '';
        return `<div class="text-xs leading-tight"><div class="text-main font-semibold">${escapeHtml(place)}</div>${mapBtn}</div>`;
    };

    const renderSummary = (rows) => {
        const box = document.getElementById('pa-summary');
        const totals = {logins: 0, kyc: 0, uploads: 0, downloads: 0, rfq: 0, offers: 0};
        rows.forEach(r => {
            if (r.action === 'LOGIN_SUCCESS') totals.logins++;
            else if (r.action === 'KYC_SUBMIT') totals.kyc++;
            else if (r.action === 'PRODUCT_SUBMIT') totals.uploads++;
            else if (r.action === 'DOCUMENT_DOWNLOAD' || r.action === 'DOCUMENT_PREVIEW') totals.downloads++;
            else if (r.action === 'RFQ_SUBMIT') totals.rfq++;
            else if (r.action === 'OFFER_ACCEPT' || r.action === 'OFFER_DECLINE') totals.offers++;
        });
        const card = (label, value, cls) => `
          <div class="bg-[var(--card)] border border-[var(--border)] rounded-xl p-3 shadow-sm">
            <div class="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">${escapeHtml(label)}</div>
            <div class="text-2xl font-black ${cls} mt-1">${value}</div>
          </div>`;
        box.innerHTML =
          card(Utils.t('portalActivity.kpiLogins') || 'Client logins', totals.logins, 'text-emerald-600') +
          card(Utils.t('portalActivity.kpiKyc') || 'KYC submissions', totals.kyc, 'text-amber-600') +
          card(Utils.t('portalActivity.kpiDocs') || 'Doc views/downloads', totals.downloads, 'text-sky-600') +
          card(Utils.t('portalActivity.kpiOffers') || 'Offer responses', totals.offers, 'text-indigo-600');
    };

    const renderTable = () => {
        const q = (document.getElementById('pa-search').value || '').toLowerCase();
        const pid = document.getElementById('pa-partner-filter').value;
        const act = document.getElementById('pa-action-filter').value;

        const filtered = allRows.filter(r => {
            if (pid && r.partner_id !== pid) return false;
            if (act && r.action !== act) return false;
            if (q) {
                const hay = `${r.partner_name} ${r.partner_email} ${r.action} ${r.details} ${r.ip_address} ${r.location}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });

        renderSummary(filtered);

        const box = document.getElementById('pa-container');
        if (filtered.length === 0) {
            box.innerHTML = `<div class="p-8 text-center text-[var(--muted)]">${escapeHtml(Utils.t('portalActivity.empty') || 'No matching portal events.')}</div>`;
            return;
        }

        // Desktop tabela + mobilne kartice (skrivamo tabelu na <md, kartice na >=md)
        const tRows = filtered.map(r => `
          <tr class="border-b border-[var(--border)] hover:bg-[var(--hover-bg)] align-top">
            <td class="p-3 text-xs whitespace-nowrap text-[var(--muted)]">${new Date(r.timestamp).toLocaleString(currentLang)}</td>
            <td class="p-3 text-sm font-semibold text-main"><div>${escapeHtml(r.partner_name)}</div><div class="text-[11px] text-[var(--muted)]">${escapeHtml(r.partner_email || '')}</div></td>
            <td class="p-3 whitespace-nowrap">${actionBadge(r.action)}</td>
            <td class="p-3 text-sm text-main"><div class="break-words">${escapeHtml(r.details || '')}</div></td>
            <td class="p-3 text-xs font-mono text-[var(--muted)] whitespace-nowrap">${escapeHtml(r.ip_address || '—')}</td>
            <td class="p-3">${locationCell(r.location)}</td>
          </tr>`).join('');

        const mobileCards = filtered.map(r => `
          <div class="border border-[var(--border)] rounded-xl bg-[var(--card)] p-3 shadow-sm">
            <div class="flex items-start justify-between gap-2 mb-2">
              <div class="text-xs text-[var(--muted)]">${new Date(r.timestamp).toLocaleString(currentLang)}</div>
              ${actionBadge(r.action)}
            </div>
            <div class="text-sm font-bold text-main">${escapeHtml(r.partner_name)}</div>
            <div class="text-[11px] text-[var(--muted)] mb-2">${escapeHtml(r.partner_email || '')}</div>
            <div class="text-sm text-main mb-2 break-words">${escapeHtml(r.details || '')}</div>
            <div class="flex items-start justify-between text-xs text-[var(--muted)] gap-3">
              <span class="font-mono">${escapeHtml(r.ip_address || '—')}</span>
              <div class="text-right">${locationCell(r.location)}</div>
            </div>
          </div>`).join('');

        box.innerHTML = `
          <table class="hidden md:table w-full text-left">
            <thead class="bg-[var(--hover-bg)] border-b border-[var(--border)]">
              <tr class="text-[var(--muted)] text-xs uppercase tracking-wider">
                <th class="p-3">${escapeHtml(Utils.t('audit.time') || 'Time')}</th>
                <th class="p-3">${escapeHtml(Utils.t('portalActivity.client') || 'Client')}</th>
                <th class="p-3">${escapeHtml(Utils.t('audit.action') || 'Action')}</th>
                <th class="p-3">${escapeHtml(Utils.t('audit.details') || 'Details')}</th>
                <th class="p-3">IP</th>
                <th class="p-3">${escapeHtml(Utils.t('portalActivity.location') || 'Location')}</th>
              </tr>
            </thead>
            <tbody>${tRows}</tbody>
          </table>
          <div class="md:hidden flex flex-col gap-3 p-3">${mobileCards}</div>`;
    };

    const loadData = async () => {
        const box = document.getElementById('pa-container');
        box.innerHTML = `<div class="p-8 text-center text-[var(--muted)]">${escapeHtml(Utils.t('portalActivity.loading') || 'Loading…')}</div>`;
        const days = document.getElementById('pa-days-filter').value;
        let url = '/api/portal/admin/activity?limit=1000';
        if (days && days !== 'all') {
            const cutoff = new Date(Date.now() - parseInt(days, 10) * 86400000).toISOString();
            url += `&start=${encodeURIComponent(cutoff)}`;
        }
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            allRows = data.rows || [];
            distinctActions = data.meta ? (data.meta.distinct_actions || []) : [];

            // Populate filter dropdowns (samo prvi put; kad se osveži, sačuvamo izbor)
            const partnerSel = document.getElementById('pa-partner-filter');
            const actionSel = document.getElementById('pa-action-filter');
            const partnersSet = new Map();
            allRows.forEach(r => { if (r.partner_id) partnersSet.set(r.partner_id, r.partner_name); });
            distinctPartners = partnersSet;
            const prevPartner = partnerSel.value; const prevAction = actionSel.value;
            partnerSel.innerHTML = `<option value="">${escapeHtml(Utils.t('portalActivity.allClients') || 'All clients')}</option>` +
                [...partnersSet.entries()].sort((a,b)=>a[1].localeCompare(b[1])).map(([id,name])=>`<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join('');
            actionSel.innerHTML = `<option value="">${escapeHtml(Utils.t('portalActivity.allActions') || 'All actions')}</option>` +
                distinctActions.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');
            if (prevPartner) partnerSel.value = prevPartner;
            if (prevAction) actionSel.value = prevAction;

            renderTable();
        } catch (e) {
            box.innerHTML = `<div class="p-8 text-center text-red-500 font-bold">${escapeHtml((Utils.t('portalActivity.loadError') || 'Failed to load portal activity.') + ' ' + e.message)}</div>`;
        }
    };

    document.getElementById('pa-refresh-btn').addEventListener('click', loadData);
    document.getElementById('pa-days-filter').addEventListener('change', loadData);
    document.getElementById('pa-search').addEventListener('input', renderTable);
    document.getElementById('pa-partner-filter').addEventListener('change', renderTable);
    document.getElementById('pa-action-filter').addEventListener('change', renderTable);

    document.getElementById('pa-stats-btn').addEventListener('click', async () => {
        try {
            const res = await fetch('/api/portal/admin/activity/stats');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const stats = await res.json();
            if (!stats.length) {
                openModal(Utils.t('portalActivity.stats30d') || 'Client Analytics (30d)',
                    `<div class="p-6 text-center text-[var(--muted)]">${escapeHtml(Utils.t('portalActivity.noStats') || 'No portal activity in the last 30 days.')}</div>`, null);
                return;
            }
            const html = `
              <div class="p-4 overflow-x-auto">
                <table class="w-full text-left text-sm min-w-[640px]">
                  <thead class="bg-[var(--hover-bg)] border-b border-[var(--border)]">
                    <tr class="text-xs uppercase text-[var(--muted)] tracking-wider">
                      <th class="p-2">${escapeHtml(Utils.t('portalActivity.client') || 'Client')}</th>
                      <th class="p-2 text-right">${escapeHtml(Utils.t('portalActivity.kpiLogins') || 'Logins')}</th>
                      <th class="p-2 text-right">KYC</th>
                      <th class="p-2 text-right">RFQ</th>
                      <th class="p-2 text-right">${escapeHtml(Utils.t('portalActivity.kpiDocs') || 'Docs')}</th>
                      <th class="p-2 text-right">${escapeHtml(Utils.t('portalActivity.kpiOffers') || 'Offer resp.')}</th>
                      <th class="p-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${stats.map(s => `
                      <tr class="border-b border-[var(--border)] hover:bg-[var(--hover-bg)]">
                        <td class="p-2 font-semibold text-main">${escapeHtml(s.partner_name)}</td>
                        <td class="p-2 text-right">${s.logins}</td>
                        <td class="p-2 text-right">${s.kyc}</td>
                        <td class="p-2 text-right">${s.rfq}</td>
                        <td class="p-2 text-right">${s.downloads}</td>
                        <td class="p-2 text-right">${s.offers_accepted}</td>
                        <td class="p-2 text-right font-bold text-accent">${s.total}</td>
                      </tr>`).join('')}
                  </tbody>
                </table>
              </div>`;
            openModal(Utils.t('portalActivity.stats30d') || 'Client Analytics (30d)', html, null);
        } catch (e) {
            const _m = 'Failed to load stats: ' + e.message;
            if (typeof showToast === 'function') showToast(_m, 'error'); else alert(_m);
        }
    });

    loadData();
}

window.renderPortalActivityView = renderPortalActivityView;
