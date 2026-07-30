// static/js/modules/deals/deal_timeline.js
// FAZA 6 — Documentation Timeline per Deal
//
// Otvara modal sa vertikalnom hronologijom svega vezanog za jedan deal:
// deal creation/update, transakcije, izdati dokumenti (offer/invoice/proforma/contract),
// revizije, audit zapisi. Sortirano hronoloski, sa toggle-om "najnovije prvo".

async function viewDealTimeline(dealId) {
    if (!dealId) return;
    const srLang = Utils.getLang() === 'sr';

    if (typeof openModal !== 'function') return;
    openModal(srLang ? '📜 Vremenska linija posla' : '📜 Deal Timeline',
        `<div class="p-8 text-center text-slate-400 text-sm">
            <div class="inline-block w-8 h-8 border-2 border-slate-200 border-t-indigo-500 rounded-full animate-spin mb-2"></div>
            <div>${srLang ? 'Učitavanje događaja…' : 'Loading events…'}</div>
         </div>`);

    let data;
    try {
        const r = await fetch(`/api/deals/${encodeURIComponent(dealId)}/timeline`);
        if (r.status === 404) {
            _tlSetBody(`<div class="p-6 text-center text-red-600">${srLang ? 'Deal nije pronađen.' : 'Deal not found.'}</div>`);
            return;
        }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        data = await r.json();
    } catch (e) {
        _tlSetBody(`<div class="p-6 text-center text-red-600">${srLang ? 'Greška u učitavanju.' : 'Load failed.'}: ${(e.message || 'unknown')}</div>`);
        return;
    }

    _tlRender(data, srLang, dealId);
}

function _tlSetBody(html) {
    const b = document.getElementById('modal-body');
    if (b) b.innerHTML = html;
}

function _tlRender(data, srLang, dealId) {
    const events = data.events || [];
    const contract = data.contractId || dealId;

    const kindColor = {
        'deal':        { bg: 'bg-indigo-100', text: 'text-indigo-700', dot: 'bg-indigo-500', border: 'border-indigo-200' },
        'transaction': { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500', border: 'border-emerald-200' },
        'document':    { bg: 'bg-blue-100', text: 'text-blue-700', dot: 'bg-blue-500', border: 'border-blue-200' },
        'revision':    { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500', border: 'border-amber-200' },
        'audit':       { bg: 'bg-slate-100', text: 'text-slate-700', dot: 'bg-slate-500', border: 'border-slate-200' },
    };
    const kindLabel = {
        'deal': srLang ? 'Deal' : 'Deal',
        'transaction': srLang ? 'Transakcija' : 'Transaction',
        'document': srLang ? 'Dokument' : 'Document',
        'revision': srLang ? 'Revizija' : 'Revision',
        'audit': srLang ? 'Audit' : 'Audit',
    };

    // Filter kontrole — svako kind ima svoj toggle
    const kinds = ['deal', 'transaction', 'document', 'revision', 'audit'];
    const counts = kinds.reduce((acc, k) => { acc[k] = events.filter(e => e.kind === k).length; return acc; }, {});
    const chips = kinds.map(k => {
        const c = kindColor[k];
        return `<button data-tl-kind="${k}" class="tl-chip inline-flex items-center gap-1.5 px-3 py-1 rounded-full ${c.bg} ${c.text} text-xs font-semibold border ${c.border} hover:brightness-95 transition">
                    <span class="w-1.5 h-1.5 rounded-full ${c.dot}"></span>${kindLabel[k]}
                    <span class="text-[10px] opacity-70">${counts[k]}</span>
                </button>`;
    }).join('');

    const timelineItems = events.length === 0
        ? `<div class="p-8 text-center text-slate-400 text-sm">${srLang ? 'Nema zabeleženih događaja za ovaj deal.' : 'No events recorded for this deal.'}</div>`
        : events.map((e, i) => {
            const c = kindColor[e.kind] || kindColor.audit;
            const isLast = i === events.length - 1;
            const dt = e.timestamp ? new Date(e.timestamp) : null;
            const dateStr = dt && !isNaN(dt) ? dt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : (e.timestamp || '—');
            return `
                <div class="tl-item flex gap-3 group" data-kind="${e.kind}">
                    <div class="relative flex flex-col items-center flex-shrink-0" style="width:32px;">
                        <div class="w-8 h-8 rounded-full ${c.bg} border-2 ${c.border} flex items-center justify-center text-base shrink-0 z-10">
                            <span>${e.icon || '•'}</span>
                        </div>
                        ${isLast ? '' : `<div class="absolute top-8 bottom-0 left-1/2 -translate-x-1/2 w-px bg-slate-200" style="height:calc(100% + 12px);"></div>`}
                    </div>
                    <div class="flex-1 pb-5 min-w-0">
                        <div class="flex items-start justify-between gap-2 mb-0.5">
                            <div class="min-w-0 flex-1">
                                <div class="text-sm font-semibold text-slate-900 break-words">${_escHtml(e.title)}</div>
                                ${e.subtitle ? `<div class="text-xs text-slate-500 mt-0.5 break-words">${_escHtml(e.subtitle)}</div>` : ''}
                            </div>
                            <div class="text-[10px] text-slate-400 whitespace-nowrap flex-shrink-0">${_escHtml(dateStr)}</div>
                        </div>
                        <div class="text-[10px] font-bold uppercase tracking-wide ${c.text}">${kindLabel[e.kind] || e.kind}</div>
                    </div>
                </div>`;
        }).join('');

    const html = `
        <div class="p-4">
            <div class="rounded-xl bg-gradient-to-r from-indigo-50 to-slate-50 border border-slate-200 p-3 mb-4">
                <div class="flex items-center justify-between gap-3">
                    <div>
                        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500">${srLang ? 'Deal' : 'Deal'}</div>
                        <div class="text-lg font-bold text-slate-900">${_escHtml(contract)}</div>
                    </div>
                    <div class="text-right">
                        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500">${srLang ? 'Događaja' : 'Events'}</div>
                        <div class="text-lg font-bold text-slate-900">${events.length}</div>
                    </div>
                </div>
            </div>

            <div class="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <div class="flex items-center gap-2 flex-wrap">${chips}</div>
                <button id="tl-toggle-order" class="btn btn-ghost small text-xs">${srLang ? '↕ Obrni redosled' : '↕ Reverse order'}</button>
            </div>

            <div id="tl-list" class="mt-2 pl-1">${timelineItems}</div>
        </div>
    `;
    _tlSetBody(html);

    // Toggle order
    const btn = document.getElementById('tl-toggle-order');
    let currentDesc = false;
    if (btn) btn.addEventListener('click', async () => {
        currentDesc = !currentDesc;
        btn.disabled = true;
        try {
            const r = await fetch(`/api/deals/${encodeURIComponent(dealId)}/timeline?desc=${currentDesc ? 1 : 0}`);
            const d = await r.json();
            _tlRender(d, srLang, dealId);
        } catch (_) {
        } finally {
            btn.disabled = false;
        }
    });

    // Filter chips — click toggles visibility of that kind
    const disabledKinds = new Set();
    document.querySelectorAll('.tl-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const k = chip.dataset.tlKind;
            if (disabledKinds.has(k)) { disabledKinds.delete(k); chip.style.opacity = '1'; }
            else                       { disabledKinds.add(k);    chip.style.opacity = '0.35'; }
            document.querySelectorAll(`.tl-item[data-kind="${k}"]`).forEach(el => {
                el.style.display = disabledKinds.has(k) ? 'none' : '';
            });
        });
    });
}

function _escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// Public API
window.viewDealTimeline = viewDealTimeline;
