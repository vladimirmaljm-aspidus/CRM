// static/js/modules/users/document_manager.js
// Admin alat za pregled i upravljanje SVIM fajlovima uploadovanim u sistem
// (uploads/ + portal_uploads/). Omogućava:
//  - listing sa filterima (folder, partner, search)
//  - statistiku (koliko prostora zauzima svaka firma)
//  - brisanje pojedinačnih ili više fajlova odjednom
//  - ZIP export SVE (ili filtrirano) sortirano u foldere po partneru + tipu
//
// Endpoint-i: /api/admin/documents/{list,delete,bulk_zip}

function renderDocumentManagerView() {
    const main = document.getElementById('main-content');
    if (!main) return;
    main.innerHTML = '';

    const isAdmin = state.user && state.user.role === 'admin';
    if (!isAdmin) {
        main.innerHTML = `<div class="p-10 text-center"><h2 class="text-3xl text-red-500 font-bold mb-4">${Utils.t('users.accessDenied') || 'Access Denied'}</h2></div>`;
        return;
    }

    const title = Utils.t('documents.title') || 'Document Manager';
    const desc = Utils.t('documents.desc') || 'View, delete, or download every file uploaded through CRM & portal, organized by client.';

    main.innerHTML = `
      <div class="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 class="text-2xl md:text-3xl font-extrabold text-main">${escapeHtml(title)}</h2>
          <p class="text-sm text-[var(--muted)] mt-1">${escapeHtml(desc)}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button id="dm-verify" class="btn bg-emerald-600 hover:bg-emerald-700 text-white text-sm" title="Kriptografski verifikuj vraćen/potpisan PDF">🔐 Verify PDF integrity</button>
          <button id="dm-refresh" class="btn bg-[var(--panel)] border border-[var(--border)] text-main text-sm">🔄 Refresh</button>
          <button id="dm-bulk-zip" class="btn bg-indigo-600 text-white text-sm">📦 Download all (ZIP)</button>
          <button id="dm-delete-selected" class="btn bg-red-600 text-white text-sm hidden">🗑 Delete selected</button>
        </div>
      </div>

      <input type="file" id="dm-verify-file" accept="application/pdf" style="display:none;">
      <div id="dm-verify-result" class="hidden mb-6 rounded-2xl p-5 border shadow-sm"></div>

      <!-- Filters -->
      <div class="mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <input type="text" id="dm-search" placeholder="Search filename or client…" class="form-input bg-[var(--card)] border-[var(--border)] text-sm"/>
        <select id="dm-folder-filter" class="form-input bg-[var(--card)] border-[var(--border)] text-sm">
          <option value="all">All folders</option>
          <option value="uploads">CRM uploads/</option>
          <option value="portal_uploads">Portal uploads/</option>
        </select>
        <select id="dm-partner-filter" class="form-input bg-[var(--card)] border-[var(--border)] text-sm"><option value="">All clients</option></select>
        <select id="dm-kind-filter" class="form-input bg-[var(--card)] border-[var(--border)] text-sm">
          <option value="">All kinds</option>
          <option value="PDFs">PDFs</option>
          <option value="Scans">Scans (image)</option>
          <option value="Spreadsheets">Spreadsheets</option>
          <option value="Other">Other</option>
        </select>
      </div>

      <!-- KPI summary -->
      <div id="dm-summary" class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4"></div>

      <!-- Table + mobile cards -->
      <div id="dm-container" class="bg-[var(--card)] rounded-2xl shadow-xl border border-[var(--border)] overflow-x-auto">
        <div class="p-8 text-center text-[var(--muted)]">Loading documents…</div>
      </div>
    `;

    let allFiles = [];
    let allStats = null;
    const currentLang = Utils.getLang() === 'sr' ? 'sr-RS' : 'en-US';

    const kindBadge = (kind) => {
        const map = {
            'PDFs': 'bg-red-50 text-red-800 border-red-200',
            'Scans': 'bg-sky-50 text-sky-800 border-sky-200',
            'Spreadsheets': 'bg-emerald-50 text-emerald-800 border-emerald-200',
            'Other': 'bg-slate-50 text-slate-700 border-slate-200'
        };
        const cls = map[kind] || map['Other'];
        return `<span class="inline-block text-[10px] font-bold uppercase tracking-wider border ${cls} rounded px-1.5 py-0.5">${escapeHtml(kind)}</span>`;
    };

    const fmtBytes = (n) => {
        if (n == null) return '—';
        if (n < 1024) return n + ' B';
        if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB';
        return (n/1024/1024).toFixed(2) + ' MB';
    };

    const buildQuery = () => {
        const p = new URLSearchParams();
        const f = document.getElementById('dm-folder-filter').value;
        const pid = document.getElementById('dm-partner-filter').value;
        const s = document.getElementById('dm-search').value.trim();
        if (f) p.set('folder', f);
        if (pid) p.set('partner_id', pid);
        if (s) p.set('search', s);
        return p.toString();
    };

    const renderSummary = () => {
        const el = document.getElementById('dm-summary');
        if (!el || !allStats) { if (el) el.innerHTML = ''; return; }
        const card = (label, value, sub) => `
          <div class="bg-[var(--panel)] border border-[var(--border)] rounded-xl p-3 shadow-sm">
            <div class="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">${escapeHtml(label)}</div>
            <div class="text-xl md:text-2xl font-black text-main mt-1">${value}</div>
            ${sub ? `<div class="text-[10px] text-[var(--muted)] mt-0.5">${escapeHtml(sub)}</div>` : ''}
          </div>`;
        const topClients = (allStats.by_partner || []).slice(0, 3)
            .map(x => `${x.partner}: ${(x.bytes/1024/1024).toFixed(1)} MB`).join(' · ');
        el.innerHTML =
            card('Total files', allStats.total_count) +
            card('Total size', allStats.total_mb + ' MB') +
            card('Clients tracked', (allStats.by_partner || []).length) +
            card('Top 3 by size', topClients || '—');
    };

    const renderTable = () => {
        const box = document.getElementById('dm-container');
        const kindFilter = document.getElementById('dm-kind-filter').value;
        const rows = allFiles.filter(f => !kindFilter || f.kind === kindFilter);
        if (!rows.length) {
            box.innerHTML = `<div class="p-8 text-center text-[var(--muted)] text-sm">No files match the current filters.</div>`;
            return;
        }
        // Desktop tabela + mobile kartice
        const tRows = rows.map(f => `
          <tr class="border-b border-[var(--border)] hover:bg-[var(--hover-bg)]">
            <td class="p-2 text-center"><input type="checkbox" class="dm-select w-4 h-4" data-folder="${escapeHtml(f.folder)}" data-name="${escapeHtml(f.name)}"/></td>
            <td class="p-2">
              <div class="font-mono text-xs text-main break-all">${escapeHtml(f.name)}</div>
              <div class="text-[10px] text-[var(--muted)]">${escapeHtml(f.folder)}/</div>
            </td>
            <td class="p-2 text-sm">
              ${f.partner_name ? `<div class="font-bold text-main">${escapeHtml(f.partner_name)}</div><div class="text-[11px] text-[var(--muted)]">${escapeHtml(f.partner_email || '')}</div>` :
                                 `<span class="text-[var(--muted)] italic text-xs">Unassigned</span>`}
            </td>
            <td class="p-2">${kindBadge(f.kind)}</td>
            <td class="p-2 text-xs whitespace-nowrap font-mono">${fmtBytes(f.size_bytes)}</td>
            <td class="p-2 text-xs whitespace-nowrap text-[var(--muted)]">${new Date(f.modified_at).toLocaleString(currentLang)}</td>
            <td class="p-2 text-right whitespace-nowrap">
              <a href="${escapeHtml(f.url)}" target="_blank" rel="noopener" class="text-blue-600 hover:underline text-xs font-bold mr-2">Open</a>
              <button data-del="1" data-folder="${escapeHtml(f.folder)}" data-name="${escapeHtml(f.name)}" class="text-red-600 hover:underline text-xs font-bold dm-del-single">Delete</button>
            </td>
          </tr>`).join('');

        const mobileCards = rows.map(f => `
          <div class="border border-[var(--border)] rounded-xl bg-[var(--card)] p-3 shadow-sm">
            <div class="flex items-start justify-between gap-2 mb-2">
              <div class="min-w-0 flex-1">
                <div class="font-mono text-xs text-main break-all">${escapeHtml(f.name)}</div>
                <div class="text-[10px] text-[var(--muted)]">${escapeHtml(f.folder)}/</div>
              </div>
              <input type="checkbox" class="dm-select w-4 h-4 flex-shrink-0" data-folder="${escapeHtml(f.folder)}" data-name="${escapeHtml(f.name)}"/>
            </div>
            <div class="text-sm ${f.partner_name ? 'text-main font-semibold' : 'text-[var(--muted)] italic'}">${f.partner_name ? escapeHtml(f.partner_name) : 'Unassigned'}</div>
            <div class="flex items-center justify-between mt-2">
              ${kindBadge(f.kind)}
              <span class="text-xs font-mono text-[var(--muted)]">${fmtBytes(f.size_bytes)}</span>
            </div>
            <div class="mt-2 flex items-center justify-between">
              <a href="${escapeHtml(f.url)}" target="_blank" rel="noopener" class="text-blue-600 hover:underline text-xs font-bold">Open</a>
              <button data-del="1" data-folder="${escapeHtml(f.folder)}" data-name="${escapeHtml(f.name)}" class="text-red-600 hover:underline text-xs font-bold dm-del-single">Delete</button>
            </div>
          </div>`).join('');

        box.innerHTML = `
          <table class="hidden md:table w-full text-left">
            <thead class="bg-[var(--hover-bg)] border-b border-[var(--border)]">
              <tr class="text-[var(--muted)] text-xs uppercase tracking-wider">
                <th class="p-2 w-8 text-center"><input type="checkbox" id="dm-select-all" class="w-4 h-4"/></th>
                <th class="p-2">File</th>
                <th class="p-2">Client</th>
                <th class="p-2">Kind</th>
                <th class="p-2">Size</th>
                <th class="p-2">Modified</th>
                <th class="p-2"></th>
              </tr>
            </thead>
            <tbody>${tRows}</tbody>
          </table>
          <div class="md:hidden flex flex-col gap-3 p-3">${mobileCards}</div>`;

        // Wire up delete-single
        box.querySelectorAll('.dm-del-single').forEach(btn => {
            btn.addEventListener('click', async () => {
                const folder = btn.dataset.folder, name = btn.dataset.name;
                if (typeof askConfirm === 'function') {
                    const yes = await askConfirm('Delete file?',
                        `Permanently delete <strong>${escapeHtml(name)}</strong>? This cannot be undone.`,
                        { danger: true, confirmText: 'Delete' });
                    if (!yes) return;
                } else if (!confirm('Delete ' + name + '?')) return;
                await doDelete([{ folder, name }]);
            });
        });
        // Wire up select-all
        const selectAll = box.querySelector('#dm-select-all');
        if (selectAll) selectAll.addEventListener('change', (e) => {
            box.querySelectorAll('.dm-select').forEach(cb => cb.checked = e.target.checked);
            updateBulkDeleteVisibility();
        });
        box.querySelectorAll('.dm-select').forEach(cb =>
            cb.addEventListener('change', updateBulkDeleteVisibility));
    };

    const updateBulkDeleteVisibility = () => {
        const anyChecked = document.querySelectorAll('.dm-select:checked').length > 0;
        const btn = document.getElementById('dm-delete-selected');
        if (btn) btn.classList.toggle('hidden', !anyChecked);
    };

    const doDelete = async (items) => {
        if (typeof showLoader === 'function') showLoader('Deleting…');
        try {
            const res = await fetch('/api/admin/documents/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ files: items })
            });
            const j = await res.json();
            if (res.ok) {
                if (typeof showToast === 'function') showToast(`Deleted ${j.deleted_count} file(s).`, 'success');
                await loadData();
            } else {
                if (typeof showToast === 'function') showToast('Delete failed.', 'error');
            }
        } catch (e) {
            if (typeof showToast === 'function') showToast('Network error.', 'error');
        } finally {
            if (typeof hideLoader === 'function') hideLoader();
        }
    };

    const loadData = async () => {
        const box = document.getElementById('dm-container');
        box.innerHTML = `<div class="p-8 text-center text-[var(--muted)] text-sm">Loading documents…</div>`;
        try {
            const q = buildQuery();
            const res = await fetch('/api/admin/documents/list' + (q ? '?' + q : ''));
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const data = await res.json();
            allFiles = data.files || [];
            allStats = data.stats || null;

            // Populate partner dropdown (jednom)
            const partnerSel = document.getElementById('dm-partner-filter');
            const prevPid = partnerSel.value;
            const partnerSet = new Map();
            allFiles.forEach(f => { if (f.partner_id) partnerSet.set(f.partner_id, f.partner_name); });
            partnerSel.innerHTML = `<option value="">All clients</option>` +
                [...partnerSet.entries()].sort((a,b) => a[1].localeCompare(b[1]))
                    .map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join('');
            if (prevPid) partnerSel.value = prevPid;

            renderSummary();
            renderTable();
        } catch (e) {
            box.innerHTML = `<div class="p-8 text-center text-red-600 text-sm">${escapeHtml('Failed to load: ' + e.message)}</div>`;
        }
    };

    // Event wiring
    document.getElementById('dm-refresh').addEventListener('click', loadData);
    document.getElementById('dm-search').addEventListener('input', loadData);
    document.getElementById('dm-folder-filter').addEventListener('change', loadData);
    document.getElementById('dm-partner-filter').addEventListener('change', loadData);
    document.getElementById('dm-kind-filter').addEventListener('change', renderTable);

    document.getElementById('dm-bulk-zip').addEventListener('click', () => {
        const q = buildQuery();
        // Direct-download link — browser triggers save-as
        window.location.href = '/api/admin/documents/bulk_zip' + (q ? '?' + q : '');
    });

    // ---------- PDF INTEGRITY VERIFICATION ----------
    const verifyBtn = document.getElementById('dm-verify');
    const verifyInp = document.getElementById('dm-verify-file');
    const verifyRes = document.getElementById('dm-verify-result');
    if (verifyBtn && verifyInp && verifyRes) {
        verifyBtn.addEventListener('click', () => verifyInp.click());
        verifyInp.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const originalBtn = verifyBtn.innerHTML;
            verifyBtn.disabled = true;
            verifyBtn.innerHTML = '⏳ Analyzing…';
            verifyRes.classList.add('hidden');
            try {
                const fd = new FormData();
                fd.append('file', file);
                const r = await fetch('/api/documents/verify_upload', { method: 'POST', body: fd });
                const d = await r.json();
                const status = d.status || 'UNKNOWN';
                const bg = status === 'AUTHENTIC' ? 'bg-emerald-50 border-emerald-200' :
                          status === 'MODIFIED' ? 'bg-red-50 border-red-200' :
                          'bg-amber-50 border-amber-200';
                const iconChar = status === 'AUTHENTIC' ? '✅' : status === 'MODIFIED' ? '⚠️' : '❓';
                const titleCol = status === 'AUTHENTIC' ? 'text-emerald-800' :
                                status === 'MODIFIED' ? 'text-red-800' : 'text-amber-800';
                const bindingRow = d.document && d.document.bindingHash
                    ? `<div class="text-xs font-mono text-slate-500 mt-1"><b>Binding hash:</b> ${d.document.bindingHash.slice(0,32)}…</div>` : '';
                const shortVerRow = d.document && d.document.shortVerification
                    ? `<div class="text-xs font-mono text-slate-500 mt-1"><b>Short verification:</b> ${d.document.shortVerification}</div>` : '';
                const offerSnap = d.offer_snapshot ? `
                    <div class="mt-3 pt-3 border-t border-slate-200">
                        <div class="text-xs font-bold text-slate-600 uppercase tracking-wider mb-1">Ponuda u našoj bazi (trenutno stanje)</div>
                        <div class="text-sm text-slate-700">
                            Offer <b>${escapeHtml(d.offer_snapshot.offerNo || '')}</b> ·
                            ${d.offer_snapshot.sellingPrice || '-'} ${escapeHtml(d.offer_snapshot.currency || '')} ·
                            qty ${d.offer_snapshot.quantity || '-'}
                        </div>
                    </div>` : '';
                verifyRes.className = `mb-6 rounded-2xl p-5 border shadow-sm ${bg}`;
                verifyRes.classList.remove('hidden');
                verifyRes.innerHTML = `
                    <div class="flex items-start gap-4">
                        <div class="text-4xl">${iconChar}</div>
                        <div class="flex-1">
                            <div class="text-lg font-black ${titleCol} mb-1">${status}</div>
                            <div class="text-sm text-slate-700">${escapeHtml(d.message || '')}</div>
                            <div class="text-xs font-mono text-slate-500 mt-3 break-all"><b>File SHA-256:</b> ${d.computed_hash || ''}</div>
                            ${d.expected_hash ? `<div class="text-xs font-mono text-red-700 mt-1 break-all"><b>Očekivani hash:</b> ${d.expected_hash}</div>` : ''}
                            ${d.document ? `<div class="text-xs text-slate-600 mt-2"><b>Fajl u bazi:</b> ${escapeHtml(d.document.fileName || '')} · <b>Kreiran:</b> ${escapeHtml(d.document.createdAt || '')}</div>` : ''}
                            ${bindingRow}
                            ${shortVerRow}
                            ${offerSnap}
                        </div>
                    </div>`;
            } catch (err) {
                verifyRes.classList.remove('hidden');
                verifyRes.className = 'mb-6 rounded-2xl p-5 border shadow-sm bg-red-50 border-red-200';
                verifyRes.innerHTML = `<div class="text-red-800 font-bold">Verification error: ${escapeHtml(err.message || err)}</div>`;
            } finally {
                verifyBtn.disabled = false;
                verifyBtn.innerHTML = originalBtn;
                verifyInp.value = '';
            }
        });
    }

    document.getElementById('dm-delete-selected').addEventListener('click', async () => {
        const items = [...document.querySelectorAll('.dm-select:checked')]
            .map(cb => ({ folder: cb.dataset.folder, name: cb.dataset.name }));
        if (!items.length) return;
        if (typeof askConfirm === 'function') {
            const yes = await askConfirm('Delete selected files?',
                `Permanently delete <strong>${items.length}</strong> file(s)? This cannot be undone.`,
                { danger: true, confirmText: 'Delete ' + items.length });
            if (!yes) return;
        } else if (!confirm(`Delete ${items.length} file(s)?`)) return;
        await doDelete(items);
    });

    loadData();
}

window.renderDocumentManagerView = renderDocumentManagerView;
