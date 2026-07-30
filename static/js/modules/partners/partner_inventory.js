// static/js/modules/partners/partner_inventory.js
// FAZA 5 — Per-partner inventory tracking
//
// Otvara modal koji prikazuje trenutno stanje po (partner, product), i daje
// formu za dodavanje movementa (IN/OUT/ADJUST/RESERVE/RELEASE). Ispod je
// istorija poslednjih 50 movementa.

async function showPartnerInventoryModal(partnerId) {
    if (!partnerId) return;
    if (typeof openModal !== 'function') return;

    const partner = (state.data.partners || []).find(p => p.id === partnerId);
    const partnerName = partner ? partner.companyName : partnerId;

    openModal(`📦 Inventory — ${Utils.escapeHtml(partnerName)}`,
        `<div class="p-8 text-center text-slate-400 text-sm">
            <div class="inline-block w-8 h-8 border-2 border-slate-200 border-t-emerald-500 rounded-full animate-spin mb-2"></div>
            <div>Loading inventory…</div>
         </div>`);

    await _renderInventoryPanel(partnerId, partnerName);
}

async function _renderInventoryPanel(partnerId, partnerName) {
    const [invR, movR] = await Promise.all([
        fetch(`/api/partners/${encodeURIComponent(partnerId)}/inventory`),
        fetch(`/api/partners/${encodeURIComponent(partnerId)}/inventory/movements?limit=50`),
    ]);
    let inv = { items: [] }, movs = { movements: [] };
    try { if (invR.ok) inv = await invR.json(); } catch(_) {}
    try { if (movR.ok) movs = await movR.json(); } catch(_) {}

    const products = state.data.products || [];
    const productMap = new Map(products.map(p => [p.id, p]));
    const productOpts = products.map(p =>
        `<option value="${p.id}">${Utils.escapeHtml(p.name || '')} ${p.sku ? '(' + Utils.escapeHtml(p.sku) + ')' : ''}</option>`
    ).join('');

    // KIND boje/ikonice
    const KIND_META = {
        'IN':      { icon: '➕', color: 'text-emerald-700', bg: 'bg-emerald-100 border-emerald-200' },
        'OUT':     { icon: '➖', color: 'text-rose-700', bg: 'bg-rose-100 border-rose-200' },
        'ADJUST':  { icon: '⚖️', color: 'text-amber-700', bg: 'bg-amber-100 border-amber-200' },
        'RESERVE': { icon: '🔒', color: 'text-blue-700', bg: 'bg-blue-100 border-blue-200' },
        'RELEASE': { icon: '🔓', color: 'text-indigo-700', bg: 'bg-indigo-100 border-indigo-200' },
    };

    const items = inv.items || [];
    const stockCards = items.length === 0
        ? `<div class="p-6 text-center text-[var(--muted)] text-sm border-2 border-dashed rounded-xl">No stock recorded for this partner yet.</div>`
        : `<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
             ${items.map(it => {
                const prod = productMap.get(it.productId);
                const name = prod ? prod.name : it.productId.slice(0, 8);
                const free = (it.qtyOnHand - it.qtyReserved);
                const lowStock = free <= 0;
                return `
                    <div class="rounded-xl border ${lowStock ? 'border-rose-200 bg-rose-50/40' : 'border-slate-200 bg-slate-50/60'} p-3">
                        <div class="flex items-center justify-between mb-2">
                            <div class="min-w-0">
                                <div class="text-sm font-bold text-slate-900 truncate">${Utils.escapeHtml(name)}</div>
                                <div class="text-[10px] text-[var(--muted)]">${it.lastMovementAt ? new Date(it.lastMovementAt).toLocaleString() : '—'}</div>
                            </div>
                            ${lowStock ? '<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500 text-white uppercase">Out</span>' : ''}
                        </div>
                        <div class="grid grid-cols-3 gap-2 text-center">
                            <div><div class="text-[9px] uppercase text-[var(--muted)] font-bold tracking-wide">On hand</div><div class="text-lg font-bold text-slate-900">${it.qtyOnHand.toFixed(2)}</div></div>
                            <div><div class="text-[9px] uppercase text-[var(--muted)] font-bold tracking-wide">Reserved</div><div class="text-lg font-bold text-blue-700">${it.qtyReserved.toFixed(2)}</div></div>
                            <div><div class="text-[9px] uppercase text-[var(--muted)] font-bold tracking-wide">Free</div><div class="text-lg font-bold ${free > 0 ? 'text-emerald-700' : 'text-rose-700'}">${free.toFixed(2)}</div></div>
                        </div>
                        <div class="text-center text-[10px] text-[var(--muted)] mt-1">${Utils.escapeHtml(it.unit || '')}</div>
                    </div>`;
             }).join('')}
           </div>`;

    const history = movs.movements || [];
    const historyRows = history.length === 0
        ? `<tr><td colspan="6" class="p-4 text-center text-[var(--muted)] text-sm">No movements recorded.</td></tr>`
        : history.map(m => {
            const km = KIND_META[m.kind] || { icon: '•', color: 'text-slate-700', bg: 'bg-slate-100 border-slate-200' };
            const prod = productMap.get(m.productId);
            const name = prod ? prod.name : m.productId.slice(0, 8);
            const dt = m.createdAt ? new Date(m.createdAt) : null;
            const dtStr = dt && !isNaN(dt) ? dt.toLocaleString() : (m.createdAt || '—');
            return `<tr class="border-t border-slate-100">
                <td class="p-2 text-xs whitespace-nowrap">${Utils.escapeHtml(dtStr)}</td>
                <td class="p-2 text-xs"><span class="inline-flex items-center gap-1 px-2 py-0.5 rounded ${km.bg} ${km.color} font-bold text-[10px] border">${km.icon} ${m.kind}</span></td>
                <td class="p-2 text-xs font-mono">${m.qty.toFixed(2)} ${Utils.escapeHtml(m.unit || '')}</td>
                <td class="p-2 text-xs truncate max-w-[180px]">${Utils.escapeHtml(name)}</td>
                <td class="p-2 text-xs text-[var(--muted)] font-mono">${m.dealId ? Utils.escapeHtml(m.dealId.slice(0,8)) : '—'}</td>
                <td class="p-2 text-xs text-[var(--muted)]">${Utils.escapeHtml(m.note || '') || '—'}</td>
            </tr>`;
        }).join('');

    const html = `
        <div class="p-4 space-y-5">
            <!-- Current stock -->
            <div>
                <div class="flex items-center justify-between mb-3">
                    <h3 class="text-sm font-bold text-slate-900 uppercase tracking-wide">Current stock</h3>
                    <span class="text-xs text-[var(--muted)]">${items.length} product(s)</span>
                </div>
                ${stockCards}
            </div>

            <!-- New movement form -->
            <div class="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
                <div class="text-sm font-bold text-emerald-900 uppercase tracking-wide mb-3">➕ Record movement</div>
                <form id="inv-mov-form" class="grid grid-cols-1 md:grid-cols-6 gap-2">
                    <select name="product_id" required class="form-input col-span-2 text-sm"><option value="">Product…</option>${productOpts}</select>
                    <select name="kind" required class="form-input text-sm">
                        <option value="IN">➕ IN (add stock)</option>
                        <option value="OUT">➖ OUT (remove)</option>
                        <option value="ADJUST">⚖️ ADJUST (set absolute)</option>
                        <option value="RESERVE">🔒 RESERVE</option>
                        <option value="RELEASE">🔓 RELEASE</option>
                    </select>
                    <input name="qty" type="number" step="0.01" min="0" required class="form-input text-sm" placeholder="Qty" />
                    <input name="unit" type="text" class="form-input text-sm" placeholder="Unit (kg, MT…)" />
                    <button type="submit" class="btn btn-primary small">Post</button>
                    <input name="note" type="text" class="form-input col-span-6 text-sm" placeholder="Optional note (deal contract, PO number, reason…)" />
                </form>
            </div>

            <!-- History -->
            <div>
                <div class="text-sm font-bold text-slate-900 uppercase tracking-wide mb-2">Movement history <span class="text-[var(--muted)] font-normal text-xs">(last ${history.length})</span></div>
                <div class="overflow-x-auto rounded-xl border border-slate-200">
                    <table class="w-full">
                        <thead class="bg-slate-50 text-[10px] uppercase tracking-wider text-[var(--muted)]">
                            <tr>
                                <th class="p-2 text-left">Date</th>
                                <th class="p-2 text-left">Kind</th>
                                <th class="p-2 text-left">Qty</th>
                                <th class="p-2 text-left">Product</th>
                                <th class="p-2 text-left">Deal</th>
                                <th class="p-2 text-left">Note</th>
                            </tr>
                        </thead>
                        <tbody>${historyRows}</tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    const body = document.getElementById('modal-body');
    if (body) body.innerHTML = html;

    // Wire up the form
    const form = document.getElementById('inv-mov-form');
    if (form) form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
        const csrf = (document.cookie.match(/csrf_token=([^;]+)/) || [])[1] || '';
        try {
            const r = await fetch(`/api/partners/${encodeURIComponent(partnerId)}/inventory/movements`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
                body: JSON.stringify({
                    product_id: fd.get('product_id'),
                    kind: fd.get('kind'),
                    qty: parseFloat(fd.get('qty') || 0),
                    unit: fd.get('unit') || '',
                    note: fd.get('note') || '',
                }),
            });
            let body = {};
            try { body = await r.json(); } catch(_) {}
            if (r.ok) {
                if (typeof showToast === 'function') showToast(
                    `✓ ${body.kind} ${body.qty} ${body.unit || ''} · On hand: ${body.qtyOnHand} · Free: ${body.qtyFree}`,
                    'success', 5000);
                // Ponovo iscrtaj panel — svez state
                await _renderInventoryPanel(partnerId, partnerName);
            } else {
                if (typeof showToast === 'function') showToast(
                    'Movement failed: ' + (body.error || body.detail || `HTTP ${r.status}`),
                    'error', { requestId: body.request_id });
                else alert('Movement failed: ' + (body.error || 'unknown'));
                if (btn) { btn.disabled = false; btn.textContent = 'Post'; }
            }
        } catch (err) {
            if (typeof showToast === 'function') showToast('Network error: ' + err.message, 'error');
            if (btn) { btn.disabled = false; btn.textContent = 'Post'; }
        }
    });
}

window.showPartnerInventoryModal = showPartnerInventoryModal;
