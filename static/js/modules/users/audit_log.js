// static/js/modules/users/audit_log.js

function renderAuditLogView() {
    const main = document.getElementById('main-content');
    main.innerHTML = '';
    
    if(state.user.role !== 'admin') {
        main.innerHTML = `<div class="p-10 text-center"><h2 class="text-3xl text-red-500 font-bold mb-4">${Utils.t('users.accessDenied') || 'Pristup Odbijen'}</h2></div>`;
        return;
    }

    const header = document.createElement('div');
    header.className = 'flex items-center justify-between mb-6';
    header.innerHTML = `
        <div>
            <h2 class="text-3xl font-extrabold text-main">${Utils.t('audit.title') || 'Sigurnosni Logovi'}</h2>
            <p class="text-[var(--muted)] mt-1">${Utils.t('audit.desc') || 'Detaljan pregled pristupa i promena u sistemu.'}</p>
        </div>
        <div class="flex gap-4">
            <button id="show-analytics-btn" class="btn bg-blue-600 text-white shadow-sm">${Utils.t('audit.analyticsBtn') || 'Radna Analitika'}</button>
            <button id="refresh-audit-btn" class="btn bg-[var(--panel)] border border-[var(--border)] text-main shadow-sm hover:bg-[var(--hover-bg)]">${Utils.t('audit.refresh') || 'Osveži'}</button>
        </div>
    `;
    main.appendChild(header);
    
    const filterDiv = document.createElement('div');
    filterDiv.className = 'mb-4 flex flex-wrap gap-4 items-center';
    filterDiv.innerHTML = `
        <input type="text" id="audit-search" class="form-input bg-[var(--card)] border-[var(--border)] w-full md:w-1/3" placeholder="${Utils.t('audit.search') || 'Pretraži logove...'}">
        <select id="audit-user-filter" class="form-input bg-[var(--card)] border-[var(--border)] w-full md:w-1/4">
            <option value="ALL">${Utils.t('audit.filterUser') || 'Svi korisnici'}</option>
        </select>
    `;
    main.appendChild(filterDiv);
    
    const container = document.createElement('div'); 
    container.className = 'bg-[var(--card)] rounded-2xl shadow-xl border border-[var(--border)] overflow-x-auto';
    main.appendChild(container);
    
    let allLogs = [];
    const currentLang = Utils.getLang() === 'sr' ? 'sr-RS' : 'en-US';
    
    const fetchAndRenderLogs = async () => {
        try {
            const res = await fetch('/api/audit_logs');
            if(!res.ok) throw new Error("Unauthorized");
            allLogs = await res.json();
            
            const uniqueUsers = [...new Set(allLogs.map(l => l.username))];
            const userSelect = document.getElementById('audit-user-filter');
            if (userSelect.options.length === 1) {
                uniqueUsers.forEach(u => {
                    const opt = document.createElement('option');
                    opt.value = u; opt.textContent = u;
                    userSelect.appendChild(opt);
                });
            }
            renderFilteredTable();
        } catch(e) {
            container.innerHTML = `<div class="p-8 text-center text-red-500 font-bold">${Utils.t('audit.loadError') || 'Greška pri učitavanju logova.'}</div>`;
        }
    };
    
    const renderFilteredTable = () => {
        const searchTerm = document.getElementById('audit-search').value.toLowerCase();
        const userFilter = document.getElementById('audit-user-filter').value;
        
        const filtered = allLogs.filter(l => {
            const matchSearch = l.action.toLowerCase().includes(searchTerm) || l.module.toLowerCase().includes(searchTerm) || l.details.toLowerCase().includes(searchTerm) || l.ip.includes(searchTerm);
            const matchUser = userFilter === 'ALL' || l.username === userFilter;
            return matchSearch && matchUser;
        });
        
        if(filtered.length === 0) {
            container.innerHTML = `<div class="p-8 text-center text-[var(--muted)] font-bold">${Utils.t('audit.noLogs') || 'Nema pronađenih logova.'}</div>`;
            return;
        }
        
        const rows = filtered.map(log => {
            const isAlert = log.is_suspicious;
            const rowClass = isAlert ? 'bg-red-50 dark:bg-red-900/10 border-l-4 border-red-500' : 'hover:bg-[var(--hover-bg)] border-b border-[var(--border)] transition-colors';
            
            const criticalBadge = isAlert ? `<span class="bg-red-100 text-red-800 border border-red-300 px-2 py-0.5 rounded text-[10px] font-black uppercase ml-2 shadow-sm">[⚠️ CRITICAL]</span>` : '';
            const actionClass = isAlert ? 'bg-red-600 text-white border border-red-700' : 'bg-blue-50 text-blue-700 border border-blue-200';
            
            let geoHtml = '';
            
            // Logika za prikazivanje validnog Google Maps linka
            if (log.location && log.location !== 'N/A' && log.location !== 'Blocked' && log.location !== 'Odbijeno' && log.location.trim() !== '') {
                if (log.location.includes(',')) {
                    // Prikazuje zvanični Google Maps dugme sa pinom
                    geoHtml = `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(log.location.trim())}" target="_blank" class="bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-1 mt-2 px-2 py-1.5 rounded transition-colors w-max shadow-sm"> ${Utils.t('audit.openMap') || 'Prikaži na Mapi'}</a>`;
                } else {
                    // Prikazuje upozorenje ako string nema zarez
                    geoHtml = `<div class="text-[10px] bg-orange-100 text-orange-800 border border-orange-300 rounded px-1 mt-2 w-max py-0.5 font-bold">Nevalidna lokacija: ${escapeHtml(log.location)}</div>`;
                }
            }
            
            const translatedAction = Utils.t(`log_actions.${log.action}`) !== `log_actions.${log.action}` ? Utils.t(`log_actions.${log.action}`) : log.action;
            const translatedModule = Utils.t(`modules.${log.module}`) !== `modules.${log.module}` ? Utils.t(`modules.${log.module}`) : log.module;
            
            let detailsHtml = escapeHtml(log.details).replace(/ \| /g, '<br><span class="text-xs text-blue-500 font-bold">↳</span> ');
            
            if (log.action === 'LOGOUT') {
                const match = log.details.match(/Total seconds:\s*(\d+)/i) || log.details.match(/duration \(seconds\):\s*(\d+)/i);
                if (match && match[1]) {
                    const totalSec = parseInt(match[1], 10);
                    const h = Math.floor(totalSec / 3600);
                    const m = Math.floor((totalSec % 3600) / 60);
                    const s = totalSec % 60;
                    detailsHtml = `${Utils.t('audit.logoutSuccess') || 'Odjava. Trajanje:'} <br><span class="text-xs text-blue-500 font-bold">↳</span> <strong>${h}h ${m}m ${s}s</strong>`;
                }
            } else if (log.action === 'LOGIN' && log.details.includes('successful')) {
                const parts = log.details.split(' | ');
                detailsHtml = `<strong>Upešan pristup.</strong>`;
                if(parts.length > 1) {
                    detailsHtml += '<br><span class="text-xs text-blue-500 font-bold">↳</span> ' + parts.slice(1).map(escapeHtml).join('<br><span class="text-xs text-blue-500 font-bold">↳</span> ');
                }
            }
            
            return `
            <tr class="${rowClass}">
                <td class="p-3 text-sm text-[var(--muted)] whitespace-nowrap align-top">${new Date(log.timestamp).toLocaleString(currentLang)}</td>
                <td class="p-3 font-bold text-main whitespace-nowrap align-top">👤 ${escapeHtml(log.username)}</td>
                <td class="p-3 whitespace-nowrap align-top"><span class="${actionClass} px-2 py-1 rounded text-xs font-bold uppercase tracking-wider">${escapeHtml(translatedAction)}</span> ${criticalBadge}</td>
                <td class="p-3 text-sm font-semibold text-blue-500 whitespace-nowrap align-top">${escapeHtml(translatedModule)}</td>
                <td class="p-3 text-sm text-main align-top"><div class="whitespace-normal leading-relaxed">${detailsHtml}</div></td>
                <td class="p-3 text-xs text-[var(--muted)] align-top whitespace-nowrap">
                    <div class="font-bold font-mono text-slate-800 dark:text-slate-200">${escapeHtml(log.ip)}</div>
                    ${geoHtml}
                    <div class="mt-2 text-[10px]" title="${escapeHtml(log.user_agent)}">${escapeHtml(log.user_agent).substring(0, 30)}...</div>
                    <button class="btn small bg-red-600 hover:bg-red-700 text-white font-bold mt-2 px-2 py-1 text-[10px] uppercase tracking-wider shadow-sm block-ip-btn w-max" data-ip="${escapeHtml(log.ip)}"> Blokiraj IP</button>
                </td>
            </tr>`;
        }).join('');
        
        container.innerHTML = `
        <table class="w-full text-left">
            <thead class="bg-[var(--hover-bg)] border-b border-[var(--border)]">
                <tr class="text-[var(--muted)] text-xs uppercase tracking-wider">
                    <th class="p-3">${Utils.t('audit.time') || 'Vreme'}</th>
                    <th class="p-3">${Utils.t('audit.user') || 'Korisnik'}</th>
                    <th class="p-3">${Utils.t('audit.action') || 'Akcija'}</th>
                    <th class="p-3">${Utils.t('audit.module') || 'Modul'}</th>
                    <th class="p-3">${Utils.t('audit.details') || 'Detalji'}</th>
                    <th class="p-3">${Utils.t('audit.ip') || 'Mreža & Uređaj'}</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;
        
        container.querySelectorAll('.block-ip-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const ip = e.currentTarget.dataset.ip;
                const _ok = await window.askConfirm(
                    'Blokirati IP adresu?',
                    `Da li ste potpuno sigurni da želite da trajno blokirate IP adresu: ${ip}?`,
                    { danger: true, confirmText: 'Blokiraj' }
                );
                if(_ok) {
                    try {
                        const fwConfigRes = await fetch('/api/firewall/status');
                        if(fwConfigRes.ok) {
                            const fwData = await fwConfigRes.json();
                            if(!fwData.blacklist) fwData.blacklist = [];
                            
                            if(!fwData.blacklist.includes(ip)) {
                                fwData.blacklist.push(ip);
                                const saveRes = await fetch('/api/firewall/config', {
                                    method: 'POST',
                                    headers:{'Content-Type':'application/json'},
                                    body: JSON.stringify(fwData)
                                });
                                
                                const _n = (m, t) => (typeof showToast === 'function' ? showToast(m, t) : alert(m));
                                if(saveRes.ok) {
                                    _n(`IP ${ip} added to Firewall Blacklist.`, 'success');
                                } else {
                                    _n('Error saving firewall rules.', 'error');
                                }
                            } else {
                                (typeof showToast === 'function' ? showToast : alert)(`IP ${ip} is already blacklisted.`, 'info');
                            }
                        }
                    } catch(err) {
                        console.error(err);
                        (typeof showToast === 'function' ? showToast : alert)('System error while blocking IP.', 'error');
                    }
                }
            });
        });
    };
    
    fetchAndRenderLogs();
    
    document.getElementById('refresh-audit-btn').addEventListener('click', fetchAndRenderLogs);
    document.getElementById('audit-search').addEventListener('input', renderFilteredTable);
    document.getElementById('audit-user-filter').addEventListener('change', renderFilteredTable);
    
    document.getElementById('show-analytics-btn').addEventListener('click', () => {
        if(allLogs.length === 0) return;
        
        const workerStats = {};
        allLogs.forEach(l => {
            if(!workerStats[l.username]) workerStats[l.username] = { totalActions: 0, totalSeconds: 0 };
            if(l.action !== 'LOGIN' && l.action !== 'LOGOUT') workerStats[l.username].totalActions++;
            
            // Popravljeno parsiranje vremena
            if (l.action === 'LOGOUT') {
                const match = l.details.match(/Total seconds:\s*(\d+)/i) || l.details.match(/duration \(seconds\):\s*(\d+)/i);
                if (match && match[1]) {
                    workerStats[l.username].totalSeconds += parseInt(match[1], 10);
                }
            }
        });
        
        const analyticsHtml = Object.keys(workerStats).map(user => {
            const stats = workerStats[user];
            const h = Math.floor(stats.totalSeconds / 3600);
            const m = Math.floor((stats.totalSeconds % 3600) / 60);
            const s = stats.totalSeconds % 60;
            
            return `
            <div class="bg-[var(--panel)] border border-[var(--border)] p-4 rounded-xl mb-4 shadow-sm hover:shadow-md transition-shadow">
                <h4 class="font-bold text-xl text-blue-500 border-b border-[var(--border)] pb-2 mb-3 flex items-center gap-2">👤 ${escapeHtml(user)}</h4>
                <div class="grid grid-cols-2 gap-4">
                    <div class="bg-[var(--card)] p-4 rounded-lg border border-[var(--border)]">
                        <span class="text-[10px] text-[var(--muted)] font-bold uppercase tracking-widest block mb-1">${Utils.t('audit.totalTime') || 'Ukupno Vreme u Sistemu'}</span>
                        <span class="font-black text-2xl text-main">${h} <span class="text-sm font-normal text-[var(--muted)]">h</span> ${m} <span class="text-sm font-normal text-[var(--muted)]">m</span> ${s} <span class="text-sm font-normal text-[var(--muted)]">s</span></span>
                    </div>
                    <div class="bg-[var(--card)] p-4 rounded-lg border border-[var(--border)]">
                        <span class="text-[10px] text-[var(--muted)] font-bold uppercase tracking-widest block mb-1">${Utils.t('audit.totalActions') || 'Akcija i Promena Napravljeno'}</span>
                        <span class="font-black text-2xl text-accent">${stats.totalActions}</span>
                    </div>
                </div>
            </div>`;
        }).join('');
        
        openModal(Utils.t('audit.analyticsTitle') || 'Radna Analitika Zaposlenih', `<div class="p-4">${analyticsHtml}</div>`, null);
    });
}