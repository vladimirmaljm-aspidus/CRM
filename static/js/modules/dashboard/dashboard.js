// static/js/modules/dashboard/dashboard.js
//
// Home dashboard sa Chart.js KPI vizuelizacijama.
// Prikazuje:
//   * Mesečni prihod (line chart, poslednjih 12 meseci)
//   * Top 5 partnera po vrednosti (horizontal bar)
//   * Pipeline value po statusu (donut)
//   * Broj dilova po mesecu (bar)
//   * Live currency widget (ECB rates)
//   * Live commodity spot cene (ako je Alpha Vantage konfigurisan)
//
// Chart.js se učitava sa CDN-a. Ne bundlujemo u repo jer bi ~200KB
// bespotrebno opteretio svaki page load — dashboard nije critical path.

window.renderDashboardView = async function() {
    const main = document.getElementById('main-content');
    if (!main) return;

    // Header + KPI cards + grid za grafove
    main.innerHTML = `
        <div class="p-4 md:p-6">
            <div class="mb-6">
                <h1 class="text-2xl font-black text-slate-900">📊 Dashboard</h1>
                <p class="text-sm text-slate-500 mt-1">Live pregled poslovanja — svi podaci se izvode iz baze u realnom vremenu, deviza & robni indeksi sa spoljnih API-ja.</p>
            </div>

            <!-- KPI cards -->
            <div id="dash-kpis" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6"></div>

            <!-- Chart grid -->
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                    <div class="flex justify-between items-start mb-3">
                        <div>
                            <h3 class="text-sm font-black uppercase tracking-widest text-slate-700">Mesečni prihod (12M)</h3>
                            <p class="text-xs text-slate-500 mt-0.5">Suma sellingPrice × quantity iz dilova, po mesecu.</p>
                        </div>
                    </div>
                    <canvas id="chart-revenue" height="120"></canvas>
                </div>
                <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                    <div class="flex justify-between items-start mb-3">
                        <div>
                            <h3 class="text-sm font-black uppercase tracking-widest text-slate-700">Top 5 partnera</h3>
                            <p class="text-xs text-slate-500 mt-0.5">Po ukupnoj vrednosti dilova (svih vremena).</p>
                        </div>
                    </div>
                    <canvas id="chart-top-partners" height="120"></canvas>
                </div>
                <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                    <div class="flex justify-between items-start mb-3">
                        <div>
                            <h3 class="text-sm font-black uppercase tracking-widest text-slate-700">Pipeline po statusu</h3>
                            <p class="text-xs text-slate-500 mt-0.5">Vrednost aktivnih dilova grupisana po statusu.</p>
                        </div>
                    </div>
                    <canvas id="chart-pipeline" height="120"></canvas>
                </div>
                <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                    <div class="flex justify-between items-start mb-3">
                        <div>
                            <h3 class="text-sm font-black uppercase tracking-widest text-slate-700">Broj dilova po mesecu</h3>
                            <p class="text-xs text-slate-500 mt-0.5">Broj kreiranih dilova po mesecu.</p>
                        </div>
                    </div>
                    <canvas id="chart-deal-count" height="120"></canvas>
                </div>
            </div>

            <!-- Live market widgets -->
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                    <div class="flex justify-between items-start mb-3">
                        <div>
                            <h3 class="text-sm font-black uppercase tracking-widest text-slate-700">💱 Live kursevi (ECB)</h3>
                            <p class="text-xs text-slate-500 mt-0.5">Referentni ECB kursevi preko exchangerate.host, keš 4h. Ako se ne vide → ECB API dole.</p>
                        </div>
                    </div>
                    <div id="dash-fx-table" class="text-xs text-slate-500">⏳ Loading…</div>
                </div>
                <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                    <div class="flex justify-between items-start mb-3">
                        <div>
                            <h3 class="text-sm font-black uppercase tracking-widest text-slate-700">🛢 Robni indeksi</h3>
                            <p class="text-xs text-slate-500 mt-0.5">Spot cene preko Alpha Vantage (nafta, plemeniti metali, žitarice). Ako se ne vide → nema API ključa u Settings > Market Data.</p>
                        </div>
                    </div>
                    <div id="dash-commodity-table" class="text-xs text-slate-500">⏳ Loading…</div>
                </div>
            </div>
        </div>
    `;

    // KPI kartice se renderuju ODMAH — ne zavise od Chart.js i moraju biti
    // vidljive čak i ako je CDN blokiran (npr. korporativni firewall).
    renderKpiCards();

    // Admin-only System Health mini card (v22.5) — brzi uvid u probleme.
    if (state.user?.role === 'admin') {
        try { renderSystemHealthMini(); } catch(_) {}
    }

    // Chart.js se učitava sa CDN-a — ako padne, grafovi ostaju prazni ali
    // KPI kartice i live market widget-i i dalje rade.
    let chartsAvailable = typeof Chart !== 'undefined';
    if (!chartsAvailable) {
        try {
            await loadChartJs();
            chartsAvailable = true;
        } catch (e) {
            console.warn('Chart.js CDN nedostupan — grafovi neće biti prikazani:', e.message);
            // Ubaci vizuelan fallback u svaki canvas parent
            document.querySelectorAll('canvas[id^="chart-"]').forEach(c => {
                const p = c.parentElement;
                if (p) c.outerHTML = '<div class="text-center py-8 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg text-xs font-bold">⚠ Chart.js CDN blokiran<br><span class="font-normal opacity-80">Proverite mrežnu vezu ili konfigurišite offline bundle</span></div>';
            });
        }
    }

    if (chartsAvailable) {
        try { renderRevenueChart(); } catch (e) { console.error('revenue chart:', e); }
        try { renderTopPartnersChart(); } catch (e) { console.error('top partners chart:', e); }
        try { renderPipelineChart(); } catch (e) { console.error('pipeline chart:', e); }
        try { renderDealCountChart(); } catch (e) { console.error('deal count chart:', e); }
    }

    // Live market widget-i su nezavisni od Chart.js
    loadFxTable();
    loadCommodityTable();

    // Dashboard insights — overdue count, new deals, stale partners
    loadInsights();
};

async function loadInsights() {
    try {
        const r = await fetch('/api/dashboard/insights');
        if (!r.ok) return;
        const j = await r.json();
        const el = document.getElementById('dash-kpis');
        if (!el) return;
        // Ubaci 4 dodatne mini kartice iznad postojecih
        const html = `
            <div class="col-span-2 md:col-span-4 grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
                ${_insightTile('⏰', j.overdue_deals, 'Overdue payments', j.overdue_deals > 0 ? 'rose' : 'slate')}
                ${_insightTile('📅', j.due_this_week, 'Due this week', j.due_this_week > 5 ? 'amber' : 'slate')}
                ${_insightTile('✨', j.new_deals_this_week, 'New deals (7d)', 'indigo')}
                ${_insightTile('👥', j.active_partners_30d, 'Active partners (30d)', 'emerald')}
            </div>` + el.innerHTML;
        el.innerHTML = html;
    } catch(_) {}
}
function _insightTile(icon, val, label, color) {
    const colors = {
        rose: 'bg-rose-50 border-rose-200 text-rose-800',
        amber: 'bg-amber-50 border-amber-200 text-amber-800',
        indigo: 'bg-indigo-50 border-indigo-200 text-indigo-800',
        emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        slate: 'bg-slate-50 border-slate-200 text-slate-700',
    };
    return `<div class="rounded-xl border ${colors[color] || colors.slate} p-2 flex items-center gap-2">
        <span class="text-xl">${icon}</span>
        <div class="min-w-0">
            <div class="text-lg font-bold leading-none">${val}</div>
            <div class="text-[10px] opacity-70 truncate">${label}</div>
        </div>
    </div>`;
}


function loadChartJs() {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Chart.js CDN unreachable'));
        document.head.appendChild(s);
    });
}


function renderKpiCards() {
    const el = document.getElementById('dash-kpis'); if (!el) return;
    const deals = state.data.deals || [];
    const offers = state.data.offers || [];
    const partners = state.data.partners || [];
    const products = state.data.products || [];

    const totalDealsValue = deals.reduce((sum, d) => {
        const q = parseFloat(d.quantity) || 0;
        const p = parseFloat(d.sellingPrice) || 0;
        return sum + (q * p);
    }, 0);
    const activeDeals = deals.filter(d => !['completed','cancelled','paid'].includes((d.status||'').toLowerCase())).length;
    const openOffers = offers.filter(o => (o.clientStatus||'pending') === 'pending').length;

    const money = v => '$' + Number(v || 0).toLocaleString('en-US', {maximumFractionDigits: 0});
    el.innerHTML = `
        ${_kpiCard('💼', 'Ukupna vrednost dilova', money(totalDealsValue), 'bg-emerald-50 border-emerald-200 text-emerald-800')}
        ${_kpiCard('🔥', 'Aktivni dilovi', activeDeals, 'bg-blue-50 border-blue-200 text-blue-800')}
        ${_kpiCard('📄', 'Otvorene ponude', openOffers, 'bg-amber-50 border-amber-200 text-amber-800')}
        ${_kpiCard('👥', 'Partneri', partners.length + ' · ' + products.length + ' proizvoda', '', 'bg-slate-50 border-slate-200 text-slate-800')}
    `;
}


function _kpiCard(icon, label, value, colorClass) {
    return `<div class="${colorClass} border rounded-xl p-4 shadow-sm">
        <div class="text-xs font-bold uppercase tracking-wider opacity-70 mb-1">${icon} ${label}</div>
        <div class="text-2xl font-black">${value}</div>
    </div>`;
}


function _monthlyBuckets(months = 12) {
    // Vraća array od N meseci unazad kao [{key: 'YYYY-MM', label: 'MMM YY'}]
    const out = [];
    const now = new Date();
    for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        const label = d.toLocaleString('en-US', {month: 'short'}) + ' ' + String(d.getFullYear()).slice(2);
        out.push({key, label, ts: d.getTime()});
    }
    return out;
}


function renderRevenueChart() {
    const ctx = document.getElementById('chart-revenue'); if (!ctx || typeof Chart === 'undefined') return;
    const buckets = _monthlyBuckets(12);
    const byMonth = Object.fromEntries(buckets.map(b => [b.key, 0]));
    (state.data.deals || []).forEach(d => {
        const dt = d.dealStartDate || d.createdAt || '';
        if (!dt) return;
        const key = dt.slice(0, 7);
        if (byMonth[key] !== undefined) {
            byMonth[key] += (parseFloat(d.sellingPrice) || 0) * (parseFloat(d.quantity) || 0);
        }
    });
    new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: buckets.map(b => b.label),
            datasets: [{
                label: 'Prihod (USD)',
                data: buckets.map(b => byMonth[b.key]),
                borderColor: '#059669',
                backgroundColor: 'rgba(5,150,105,.12)',
                fill: true,
                tension: 0.3,
            }],
        },
        options: {
            responsive: true,
            plugins: { legend: {display: false} },
            scales: {
                y: { beginAtZero: true, ticks: { callback: v => '$' + v.toLocaleString() } },
            },
        },
    });
}


function renderTopPartnersChart() {
    const ctx = document.getElementById('chart-top-partners'); if (!ctx || typeof Chart === 'undefined') return;
    const totals = {};
    (state.data.deals || []).forEach(d => {
        const pid = d.buyerId || d.customerId || 'unknown';
        totals[pid] = (totals[pid] || 0) + (parseFloat(d.sellingPrice) || 0) * (parseFloat(d.quantity) || 0);
    });
    const rows = Object.entries(totals)
        .map(([pid, v]) => ({pid, v, name: (state.data.partners.find(p => p.id === pid) || {}).companyName || '?'}))
        .sort((a, b) => b.v - a.v).slice(0, 5);
    new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: rows.map(r => r.name),
            datasets: [{
                label: 'Vrednost dilova',
                data: rows.map(r => r.v),
                backgroundColor: ['#3b82f6','#0ea5e9','#06b6d4','#14b8a6','#22c55e'],
            }],
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: { legend: {display: false} },
            scales: { x: { ticks: { callback: v => '$' + Number(v).toLocaleString() } } },
        },
    });
}


function renderPipelineChart() {
    const ctx = document.getElementById('chart-pipeline'); if (!ctx || typeof Chart === 'undefined') return;
    const byStatus = {};
    (state.data.deals || []).forEach(d => {
        const st = d.status || 'draft';
        byStatus[st] = (byStatus[st] || 0) + (parseFloat(d.sellingPrice) || 0) * (parseFloat(d.quantity) || 0);
    });
    const labels = Object.keys(byStatus);
    new Chart(ctx.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: labels.map(l => byStatus[l]),
                backgroundColor: ['#2563eb','#059669','#f59e0b','#dc2626','#7c3aed','#0891b2','#65a30d'],
            }],
        },
        options: { responsive: true },
    });
}


function renderDealCountChart() {
    const ctx = document.getElementById('chart-deal-count'); if (!ctx || typeof Chart === 'undefined') return;
    const buckets = _monthlyBuckets(12);
    const byMonth = Object.fromEntries(buckets.map(b => [b.key, 0]));
    (state.data.deals || []).forEach(d => {
        const dt = d.dealStartDate || d.createdAt || '';
        if (!dt) return;
        const key = dt.slice(0, 7);
        if (byMonth[key] !== undefined) byMonth[key]++;
    });
    new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: buckets.map(b => b.label),
            datasets: [{
                label: 'Broj dilova',
                data: buckets.map(b => byMonth[b.key]),
                backgroundColor: '#3b82f6',
            }],
        },
        options: {
            responsive: true,
            plugins: {legend: {display: false}},
            scales: {y: {beginAtZero: true, ticks: {stepSize: 1}}},
        },
    });
}


async function loadFxTable() {
    const el = document.getElementById('dash-fx-table'); if (!el) return;
    try {
        const r = await fetch('/api/geo/fx/rates?base=USD');
        if (!r.ok) throw new Error();
        const j = await r.json();
        const wanted = ['EUR','GBP','CHF','AED','RSD','BAM','TRY','CNY','JPY'];
        const rows = wanted.filter(c => j.rates[c]).map(c => `
            <tr><td class="py-1 pr-3 font-mono font-bold text-slate-800">1 USD</td>
                <td class="py-1 px-3 text-slate-500">=</td>
                <td class="py-1 px-3 font-mono font-black text-emerald-700">${Number(j.rates[c]).toFixed(4)}</td>
                <td class="py-1 pl-3 text-slate-700">${c}</td></tr>`).join('');
        el.innerHTML = `<table class="w-full text-xs"><tbody>${rows}</tbody></table>
            <div class="mt-2 text-[10px] text-slate-400">Izvor: exchangerate.host · ECB reference rates</div>`;
    } catch (e) {
        el.innerHTML = '<div class="text-amber-600">⚠ ECB rate API trenutno nedostupan.</div>';
    }
}


async function loadCommodityTable() {
    const el = document.getElementById('dash-commodity-table'); if (!el) return;
    try {
        const r = await fetch('/api/geo/commodity');
        if (!r.ok) throw new Error();
        const j = await r.json();
        const items = j.items || [];
        // Za svaki simbol pokušaj lookup — mnogi će vratiti 502 ako Alpha Vantage
        // nije konfigurisan; pokazuje se placeholder.
        const rows = await Promise.all(items.slice(0, 6).map(async it => {
            try {
                const rr = await fetch('/api/geo/commodity/' + it.symbol);
                if (!rr.ok) throw new Error();
                const jj = await rr.json();
                return `<tr>
                    <td class="py-1 pr-3 font-bold text-slate-800">${it.label}</td>
                    <td class="py-1 px-3 font-mono font-black text-blue-700">${jj.price ? Number(jj.price).toLocaleString('en-US', {maximumFractionDigits: 2}) : '—'}</td>
                    <td class="py-1 px-3 text-slate-500 text-[10px]">${it.unit}</td>
                    <td class="py-1 pl-3 text-slate-400 text-[10px]">${jj.date || ''}</td>
                </tr>`;
            } catch (_) {
                return `<tr><td class="py-1 pr-3 text-slate-500">${it.label}</td><td colspan="3" class="py-1 px-3 text-[10px] text-slate-400">—</td></tr>`;
            }
        }));
        el.innerHTML = `<table class="w-full text-xs"><tbody>${rows.join('')}</tbody></table>
            <div class="mt-2 text-[10px] text-slate-400">Izvor: Alpha Vantage (dodaj API ključ u Settings za live cene)</div>`;
    } catch (e) {
        el.innerHTML = '<div class="text-amber-600">⚠ Commodity API nedostupan.</div>';
    }
}


// ==========================================================
//  BATCH D — System Health mini card (admin only)
// ==========================================================
async function renderSystemHealthMini() {
    const main = document.getElementById('main-content');
    if (!main) return;
    // Ubaci karticu ispod KPI-eva ako vec ne postoji
    let holder = document.getElementById('dash-sys-health');
    if (!holder) {
        holder = document.createElement('div');
        holder.id = 'dash-sys-health';
        holder.className = 'mb-6';
        const kpis = document.getElementById('dash-kpis');
        if (kpis && kpis.parentNode) kpis.parentNode.insertBefore(holder, kpis.nextSibling);
    }
    holder.innerHTML = `
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div class="flex items-center justify-between mb-3">
                <b class="text-slate-900 text-sm uppercase tracking-widest">💚 System Health <span class="text-[10px] text-slate-400 font-normal">(admin)</span></b>
                <a href="/admin/health" class="text-xs text-indigo-600 hover:underline">Full report →</a>
            </div>
            <div id="dash-sys-health-tiles" class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <span class="text-slate-400 col-span-4">⏳ Loading probes…</span>
            </div>
        </div>`;
    try {
        const r = await fetch('/api/admin/health');
        if (!r.ok) return;
        const j = await r.json();
        const checks = j.checks || {};
        const tiles = [
            { key: 'sqlite', label: 'SQLite', icon: '💾' },
            { key: 'supabase_db', label: 'Supabase DB', icon: '☁️' },
            { key: 'supabase_auth', label: 'Auth', icon: '🔐' },
            { key: 'smtp', label: 'SMTP', icon: '✉️' },
            { key: 'mail_queue', label: 'Mail Queue', icon: '📮' },
            { key: 'disk', label: 'Disk', icon: '💽' },
            { key: 'backup', label: 'Backup', icon: '🗄' },
            { key: 'webhook', label: 'Webhook', icon: '🪝' },
        ];
        const html = tiles.map(t => {
            const c = checks[t.key] || {};
            const cls = c.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : (c.status === 'disabled' || c.status === 'not_configured'
                    ? 'bg-slate-50 border-slate-200 text-slate-500'
                    : 'bg-rose-50 border-rose-200 text-rose-800');
            const lbl = c.ok ? 'OK' : (c.status === 'disabled' ? 'off' : (c.status === 'not_configured' ? 'n/a' : 'FAIL'));
            return `<a href="/admin/health" class="rounded-lg border ${cls} p-2 flex items-center gap-2 hover:brightness-95 no-underline">
                <span class="text-base">${t.icon}</span>
                <span class="flex-1 min-w-0">
                    <span class="block font-bold truncate">${t.label}</span>
                    <span class="block text-[10px] opacity-70 truncate">${(c.detail || '').substring(0, 32) || lbl}</span>
                </span>
                <span class="text-[10px] font-bold uppercase">${lbl}</span>
            </a>`;
        }).join('');
        const el = document.getElementById('dash-sys-health-tiles');
        if (el) el.innerHTML = html;
    } catch(_) {}
}
window.renderSystemHealthMini = renderSystemHealthMini;
