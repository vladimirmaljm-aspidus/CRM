// static/js/modules/users/users_list.js

let allUsersData = []; // Čuvamo sve korisnike za potrebe pretrage

function renderUsersView() {
    const main = document.getElementById('main-content');
    main.innerHTML = '';
    
    const tLang = (srStr, enStr) => Utils.getLang() === 'sr' ? srStr : enStr;
    
    if(state.user.role !== 'admin') {
        main.innerHTML = `<div class="p-10 text-center"><h2 class="text-2xl text-red-600 font-black mb-4">${tLang('Pristup Odbijen', 'Access Denied')}</h2><p class="text-slate-500 font-bold">${tLang('Samo administrator može upravljati korisničkim nalozima.', 'Only administrators can manage user accounts.')}</p></div>`;
        return;
    }
  
    const header = createViewHeader(tLang('Upravljanje Korisnicima', 'User Management'), tLang('+ Novi Radnik', '+ Add Worker'), () => showUserForm());
    main.appendChild(header);

    // Sekcija za pretragu i filtriranje
    const filterSection = document.createElement('div');
    filterSection.className = 'flex flex-col md:flex-row gap-4 mt-6 mb-2';
    filterSection.innerHTML = `
        <div class="relative flex-1">
            <span class="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">🔍</span>
            <input type="text" id="user-search-input" class="w-full pl-11 pr-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none shadow-sm transition-all" placeholder="${tLang('Pretraži korisnike po imenu ili ID-u...', 'Search users by username or ID...')}">
        </div>
        <select id="user-role-filter" class="w-full md:w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm cursor-pointer transition-all">
            <option value="all">${tLang('Sve Uloge', 'All Roles')}</option>
            <option value="admin">${tLang('Samo Administratori', 'Admins Only')}</option>
            <option value="manager">${tLang('Samo Menadžeri', 'Managers Only')}</option>
            <option value="worker">${tLang('Samo Radnici', 'Workers Only')}</option>
        </select>
    `;
    main.appendChild(filterSection);
  
    const container = document.createElement('div'); 
    container.className = 'bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden mt-4 mb-10';
    main.appendChild(container);

    const renderTable = (usersToRender) => {
        if(usersToRender.length === 0) {
            container.innerHTML = `<div class="p-10 text-center text-slate-400 dark:text-slate-500 font-bold">${tLang('Nema pronađenih korisnika.', 'No users found.')}</div>`;
            return;
        }

        const rows = usersToRender.map(u => {
            let roleIcon = '👷';
            let roleName = tLang('Radnik', 'Worker');
            let roleClass = 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-600';
            
            if (u.role === 'admin') {
                roleIcon = '👑';
                roleName = tLang('Administrator', 'Administrator');
                roleClass = 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 border-blue-300 dark:border-blue-700';
            } else if (u.role === 'manager') {
                roleIcon = '👔';
                roleName = tLang('Menadžer', 'Manager');
                roleClass = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700';
            }

            const isMe = u.id === state.user.id;
            const meBadge = isMe ? `<span class="ml-3 text-[10px] bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded uppercase tracking-wider font-black">Tvoj Nalog</span>` : '';

            return `
            <tr class="border-b border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${isMe ? 'bg-blue-50/30 dark:bg-blue-900/10' : ''}">
                <td class="p-5 font-bold text-sm flex items-center gap-4 text-slate-900 dark:text-white">
                    <span class="text-2xl bg-white dark:bg-slate-800 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">${roleIcon}</span>
                    <div>
                        <span class="flex items-center text-base tracking-tight">${escapeHtml(u.username)} ${meBadge}</span>
                        <span class="block text-[11px] text-slate-500 font-mono tracking-tight mt-1">ID: ${u.id.split('-')[0]}...</span>
                    </div>
                </td>
                <td class="p-5">
                    <span class="px-3 py-1.5 rounded-md text-[11px] font-black uppercase tracking-widest border shadow-sm ${roleClass}">
                        ${roleName}
                    </span>
                </td>
                <td class="p-5 text-right whitespace-nowrap">
                    <button class="bg-slate-800 hover:bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white font-black edit-user mr-2 text-xs px-5 py-2.5 rounded-lg shadow-md transition-all" data-id="${u.id}">⚙️ ${tLang('Profil i Dozvole', 'Profile & Perms')}</button>
                    ${!isMe && u.role !== 'admin' ? `<button class="bg-red-600 hover:bg-red-700 text-white font-black px-5 py-2.5 rounded-lg text-xs shadow-md transition-colors del-user" data-id="${u.id}">🗑️ ${tLang('Obriši', 'Delete')}</button>` : ''}
                </td>
            </tr>`;
        }).join('');

        container.innerHTML = `
        <table class="w-full text-left border-collapse">
            <thead>
                <tr class="border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
                    <th class="p-5 uppercase text-[10px] font-black tracking-widest text-slate-500 dark:text-slate-400">${tLang('Korisnik', 'User')}</th>
                    <th class="p-5 uppercase text-[10px] font-black tracking-widest text-slate-500 dark:text-slate-400">${tLang('Nivo Pristupa', 'Access Level')}</th>
                    <th class="p-5 text-right uppercase text-[10px] font-black tracking-widest text-slate-500 dark:text-slate-400">${tLang('Upravljanje', 'Actions')}</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;

        // Attach events again after render
        container.querySelectorAll('.edit-user').forEach(b => b.addEventListener('click', e => {
            const user = allUsersData.find(u => u.id === e.currentTarget.dataset.id);
            showUserForm(user);
        }));
        
        container.querySelectorAll('.del-user').forEach(b => b.addEventListener('click', async e => {
            const _ok = await window.askConfirm(
                tLang('Obrisati nalog?','Delete account?'),
                tLang('Da li ste sigurni da želite da trajno obrišete nalog ovog radnika?',
                      'Are you sure you want to permanently delete this worker?'),
                { danger: true, confirmText: tLang('Obriši','Delete') }
            );
            if(_ok) {
                const userId = e.currentTarget.dataset.id;
                try {
                    const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
                    const json = await res.json();
                    if (json.error === 'cannot_delete_self') {
                        const msg = tLang('Ne možete obrisati sopstveni nalog.', 'You cannot delete your own account.');
                        if (typeof showToast === 'function') showToast(msg, 'error');
                        else alert(msg);
                    } else renderUsersView();
                } catch(err) { console.error(err); }
            }
        }));
    };
    
    if(typeof fetchUsers === 'function') {
        fetchUsers().then(users => {
            allUsersData = users;
            renderTable(allUsersData);
            
            // Search & Filter Logic
            const searchInput = document.getElementById('user-search-input');
            const roleFilter = document.getElementById('user-role-filter');
            
            const filterData = () => {
                const sTerm = searchInput.value.toLowerCase();
                const rTerm = roleFilter.value;
                const filtered = allUsersData.filter(u => {
                    const matchSearch = u.username.toLowerCase().includes(sTerm) || u.id.toLowerCase().includes(sTerm);
                    const matchRole = rTerm === 'all' || u.role === rTerm;
                    return matchSearch && matchRole;
                });
                renderTable(filtered);
            };

            searchInput.addEventListener('input', filterData);
            roleFilter.addEventListener('change', filterData);
        });
    }
}
  
function showUserForm(user = null) {
    const isEdit = !!user;
    const isMe = user?.id === state.user.id;
    const perms = user?.permissions || {};
    const tLang = (srStr, enStr) => Utils.getLang() === 'sr' ? srStr : enStr;
    
    const txtViewAll = tLang('Svi podaci u sistemu', 'View All Records');
    const txtViewOwn = tLang('Samo sopstveni unosi', 'View Own Records Only');
    const txtEdit = tLang('Kreiranje i Izmena', 'Create / Edit');
    const txtDelete = tLang('Pravo na Brisanje', 'Delete Records');
    
    const renderMatrixRow = (icon, title, id, opts) => {
        const { hasViewOwn, isSystemConfig, isSecurity } = opts;
        
        let viewHtml = '';
        if (isSystemConfig || isSecurity) {
            viewHtml = `<span class="text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">${tLang('Sistemski nivo', 'System Level')}</span>`;
        } else if (hasViewOwn) {
            viewHtml = `
                <div class="flex flex-col gap-2.5 pt-1">
                    <label class="inline-flex items-center cursor-pointer text-xs font-bold text-slate-900 dark:text-white hover:text-blue-600 transition-colors">
                        <input type="radio" name="perm_${id}_view_level" value="all" ${perms[`${id}_view_all`] ? 'checked' : ''} class="w-4 h-4 mr-2 text-blue-600 focus:ring-blue-500 border-slate-400"> 
                        ${txtViewAll}
                    </label>
                    <label class="inline-flex items-center cursor-pointer text-xs font-bold text-slate-900 dark:text-white hover:text-blue-600 transition-colors">
                        <input type="radio" name="perm_${id}_view_level" value="own" ${perms[`${id}_view_own`] && !perms[`${id}_view_all`] ? 'checked' : ''} class="w-4 h-4 mr-2 text-blue-600 focus:ring-blue-500 border-slate-400"> 
                        ${txtViewOwn}
                    </label>
                    <label class="inline-flex items-center cursor-pointer text-[11px] font-bold text-slate-500 hover:text-red-600 transition-colors border-t border-slate-200 dark:border-slate-700 pt-2 mt-1">
                        <input type="radio" name="perm_${id}_view_level" value="none" ${!perms[`${id}_view_all`] && !perms[`${id}_view_own`] ? 'checked' : ''} class="w-3.5 h-3.5 mr-1.5 text-red-600 border-slate-400"> 
                        ${tLang('Blokiraj pristup', 'Deny access')}
                    </label>
                </div>
            `;
        } else {
            viewHtml = `
                <label class="inline-flex items-center cursor-pointer text-xs font-bold text-slate-900 dark:text-white hover:text-blue-600 transition-colors pt-1">
                    <input type="checkbox" name="perm_${id}_view" ${perms[`${id}_view`] ? 'checked' : ''} class="w-4 h-4 mr-2 rounded text-blue-600 focus:ring-blue-500 border-slate-400"> 
                    ${tLang('Dozvoli pristup', 'Grant access')}
                </label>
            `;
        }

        let editDeleteHtml = '';
        if (!isSystemConfig && !isSecurity) {
            editDeleteHtml = `
                <td class="p-4 align-top border-r border-slate-200 dark:border-slate-700">
                    <label class="inline-flex items-center cursor-pointer text-xs font-black text-emerald-700 dark:text-emerald-400 hover:text-emerald-500 transition-colors pt-1">
                        <input type="checkbox" name="perm_${id}_edit" ${perms[`${id}_edit`] ? 'checked' : ''} class="w-4 h-4 mr-2 rounded text-emerald-600 focus:ring-emerald-500 border-slate-400"> 
                        ${txtEdit}
                    </label>
                </td>
                <td class="p-4 align-top border-r border-slate-200 dark:border-slate-700">
                    <label class="inline-flex items-center cursor-pointer text-xs font-black text-red-700 dark:text-red-400 hover:text-red-500 transition-colors pt-1">
                        <input type="checkbox" name="perm_${id}_delete" ${perms[`${id}_delete`] ? 'checked' : ''} class="w-4 h-4 mr-2 rounded text-red-600 focus:ring-red-500 border-slate-400"> 
                        ${txtDelete}
                    </label>
                </td>
            `;
        } else {
            editDeleteHtml = `<td class="p-4 bg-slate-100 dark:bg-slate-800/80" colspan="2"></td>`;
        }

        let advancedHtml = '';
        if (id === 'deals') {
            advancedHtml = `
                <div class="flex flex-col gap-3 pt-1">
                    <label class="inline-flex items-center cursor-pointer text-[11px] font-black text-amber-800 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 px-2 py-1.5 rounded transition-colors hover:bg-amber-200">
                        <input type="checkbox" name="perm_deals_view_costs" ${perms['deals_view_costs'] ? 'checked' : ''} class="w-4 h-4 mr-2 rounded text-amber-600 focus:ring-amber-500 border-amber-400"> 
                        ${tLang('Nabavne Cene & Profit', 'Cost Prices & Profits')}
                    </label>
                    <label class="inline-flex items-center cursor-pointer text-[11px] font-black text-blue-800 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700 px-2 py-1.5 rounded transition-colors hover:bg-blue-200">
                        <input type="checkbox" name="perm_deals_approve" ${perms['deals_approve'] ? 'checked' : ''} class="w-4 h-4 mr-2 rounded text-blue-600 focus:ring-blue-500 border-blue-400">
                        ${tLang('Pravo Odobravanja', 'Approve Deals')}
                    </label>
                    <label class="inline-flex items-center cursor-pointer text-[11px] font-black text-rose-800 dark:text-rose-400 bg-rose-100 dark:bg-rose-900/30 border border-rose-300 dark:border-rose-700 px-2 py-1.5 rounded transition-colors hover:bg-rose-200">
                        <input type="checkbox" name="perm_use_company_stamp" ${perms['use_company_stamp'] ? 'checked' : ''} class="w-4 h-4 mr-2 rounded text-rose-600 focus:ring-rose-500 border-rose-400">
                        ${tLang('Korišćenje Pečata Firme', 'Use Company Stamp')}
                    </label>
                </div>`;
        } else if (id === 'partners') {
            advancedHtml = `
                <label class="inline-flex items-center cursor-pointer text-[11px] font-black text-purple-800 dark:text-purple-400 bg-purple-100 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-700 px-2 py-1.5 rounded transition-colors hover:bg-purple-200 pt-1">
                    <input type="checkbox" name="perm_partners_kyc" ${perms['partners_kyc'] ? 'checked' : ''} class="w-4 h-4 mr-2 rounded text-purple-600 focus:ring-purple-500 border-purple-400"> 
                    ${tLang('KYC & Compliance', 'KYC & Compliance')}
                </label>`;
        } else if (id === 'products') {
            advancedHtml = `
                <label class="inline-flex items-center cursor-pointer text-[11px] font-black text-amber-800 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 px-2 py-1.5 rounded transition-colors hover:bg-amber-200 pt-1">
                    <input type="checkbox" name="perm_products_view_prices" ${perms['products_view_prices'] ? 'checked' : ''} class="w-4 h-4 mr-2 rounded text-amber-600 focus:ring-amber-500 border-amber-400">
                    ${tLang('Cene Dobavljača', 'Supplier Catalog Prices')}
                </label>`;
        } else if (id === 'offers') {
            advancedHtml = `
                <div class="flex flex-col gap-3 pt-1">
                    <label class="inline-flex items-center cursor-pointer text-[11px] font-black text-emerald-800 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700 px-2 py-1.5 rounded transition-colors hover:bg-emerald-200">
                        <input type="checkbox" name="perm_offers_to_deal" ${perms['offers_to_deal'] ? 'checked' : ''} class="w-4 h-4 mr-2 rounded text-emerald-600 focus:ring-emerald-500 border-emerald-400">
                        ${tLang('Konverzija ponude u dil', 'Convert Offer → Deal')}
                    </label>
                    <label class="inline-flex items-center cursor-pointer text-[11px] font-black text-orange-800 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30 border border-orange-300 dark:border-orange-700 px-2 py-1.5 rounded transition-colors hover:bg-orange-200">
                        <input type="checkbox" name="perm_offers_to_deal_force" ${perms['offers_to_deal_force'] ? 'checked' : ''} class="w-4 h-4 mr-2 rounded text-orange-600 focus:ring-orange-500 border-orange-400">
                        ${tLang('Konverzija BEZ potvrde klijenta (force)', 'Force conversion (bypass portal accept)')}
                    </label>
                </div>`;
        } else if (id === 'finances') {
            advancedHtml = `
                <label class="inline-flex items-center cursor-pointer text-[11px] font-black text-emerald-800 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-700 px-2 py-1.5 rounded transition-colors hover:bg-emerald-200 pt-1">
                    <input type="checkbox" name="perm_finances_export" ${perms['finances_export'] ? 'checked' : ''} class="w-4 h-4 mr-2 rounded text-emerald-600 focus:ring-emerald-500 border-emerald-400"> 
                    ${tLang('Eksport Izveštaja', 'Export Reports')}
                </label>`;
        } else if (isSystemConfig) {
            advancedHtml = `
                <div class="flex flex-col gap-3 pt-1">
                    <label class="inline-flex items-center cursor-pointer text-[11px] font-black text-blue-700 dark:text-blue-400 hover:text-blue-900 uppercase">
                        <input type="checkbox" name="perm_system_export" ${perms['system_export'] ? 'checked' : ''} class="w-4 h-4 mr-2 rounded text-blue-600 border-slate-400"> 
                        ${tLang('Eksport Baze (JSON/CSV)', 'Export Database')}
                    </label>
                    <label class="inline-flex items-center cursor-pointer text-[11px] font-black text-red-700 dark:text-red-400 hover:text-red-900 uppercase">
                        <input type="checkbox" name="perm_system_import" ${perms['system_import'] ? 'checked' : ''} class="w-4 h-4 mr-2 rounded text-red-600 border-slate-400"> 
                        ${tLang('Import / Preklapanje Baze', 'Import Overwrite')}
                    </label>
                    <label class="inline-flex items-center cursor-pointer text-[11px] font-black text-slate-800 dark:text-slate-200 hover:text-black uppercase">
                        <input type="checkbox" name="perm_settings_manage" ${perms['settings_manage'] ? 'checked' : ''} class="w-4 h-4 mr-2 rounded text-slate-800 border-slate-400"> 
                        ${tLang('Izmena Master Podešavanja', 'Manage Control Settings')}
                    </label>
                </div>
            `;
        } else if (isSecurity) {
            advancedHtml = `
                <div class="flex flex-col gap-3 pt-1">
                    <label class="inline-flex items-center cursor-pointer text-[11px] font-black text-indigo-700 dark:text-indigo-400 hover:text-indigo-900 uppercase">
                        <input type="checkbox" name="perm_audit_view" ${perms['audit_view'] ? 'checked' : ''} class="w-4 h-4 mr-2 rounded text-indigo-600 border-slate-400"> 
                        ${tLang('Pregled Audit Logova', 'View Audit Logs')}
                    </label>
                    <label class="inline-flex items-center cursor-pointer text-[11px] font-black text-orange-700 dark:text-orange-400 hover:text-orange-900 uppercase">
                        <input type="checkbox" name="perm_firewall_manage" ${perms['firewall_manage'] ? 'checked' : ''} class="w-4 h-4 mr-2 rounded text-orange-600 border-slate-400">
                        ${tLang('IP Blokade & Firewall', 'Manage Firewall & Bans')}
                    </label>
                    <label class="inline-flex items-center cursor-pointer text-[11px] font-black text-sky-700 dark:text-sky-400 hover:text-sky-900 uppercase">
                        <input type="checkbox" name="perm_portal_activity_view" ${perms['portal_activity_view'] ? 'checked' : ''} class="w-4 h-4 mr-2 rounded text-sky-600 border-slate-400">
                        ${tLang('Pregled Portal Aktivnosti', 'View Portal Activity Log')}
                    </label>
                    <label class="inline-flex items-center cursor-pointer text-[11px] font-black text-teal-700 dark:text-teal-400 hover:text-teal-900 uppercase">
                        <input type="checkbox" name="perm_portal_preview_manage" ${perms['portal_preview_manage'] ? 'checked' : ''} class="w-4 h-4 mr-2 rounded text-teal-600 border-slate-400">
                        ${tLang('Portal Pregled i Vidljivost', 'Portal Preview & Visibility')}
                    </label>
                </div>
            `;
        }

        return `
            <tr class="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors bg-white dark:bg-slate-900">
                <td class="p-4 align-top border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                    <div class="font-black text-slate-900 dark:text-white flex items-center gap-3 text-xs uppercase tracking-wider">
                        <span class="text-2xl">${icon}</span> ${title}
                    </div>
                </td>
                <td class="p-4 align-top border-r border-slate-200 dark:border-slate-700">${viewHtml}</td>
                ${editDeleteHtml}
                <td class="p-4 align-top bg-slate-50/50 dark:bg-slate-800/30">${advancedHtml}</td>
            </tr>
        `;
    };

    const matrixHtml = `
        <div class="overflow-x-auto border border-slate-300 dark:border-slate-600 rounded-xl shadow-lg bg-white dark:bg-slate-900 mt-4">
            <table class="w-full text-left border-collapse min-w-[950px]">
                <thead>
                    <tr class="bg-slate-800 dark:bg-black border-b border-slate-900 text-white">
                        <th class="p-4 text-[10px] font-black uppercase tracking-widest w-[22%]">${tLang('Sistemska Sekcija', 'System Module')}</th>
                        <th class="p-4 text-[10px] font-black uppercase tracking-widest w-[20%]">👁 ${tLang('Pregled', 'View Level')}</th>
                        <th class="p-4 text-[10px] font-black uppercase tracking-widest w-[16%]">✏️ ${tLang('Izmena', 'Write / Edit')}</th>
                        <th class="p-4 text-[10px] font-black uppercase tracking-widest w-[16%]">🗑️ ${tLang('Brisanje', 'Delete Right')}</th>
                        <th class="p-4 text-[10px] font-black uppercase tracking-widest w-[26%]">${tLang('🛡️ Specijalne Restrikcije', '🛡️ Special Rights')}</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-200 dark:divide-slate-700">
                    ${renderMatrixRow('📄', tLang('Poslovi i Logistika', 'Deals & Logistics'), 'deals', { hasViewOwn: true })}
                    ${renderMatrixRow('👥', tLang('Partneri & Kontakti', 'Partners & Network'), 'partners', { hasViewOwn: true })}
                    ${renderMatrixRow('🛒', tLang('Zahtevi (Demands)', 'Client Demands'), 'demands', { hasViewOwn: true })}
                    ${renderMatrixRow('💎', tLang('Ponude (Offers)', 'Offers Hub'), 'offers', { hasViewOwn: true })}
                    ${renderMatrixRow('📦', tLang('Katalog Proizvoda', 'Product Catalog'), 'products', { hasViewOwn: false })}
                    ${renderMatrixRow('💰', tLang('Finansije i Računi', 'Cashflow & Accounts'), 'finances', { hasViewOwn: false })}
                    ${renderMatrixRow('⚙️', tLang('Podešavanja i Baza', 'System Config'), 'system', { isSystemConfig: true })}
                    ${renderMatrixRow('🛡️', tLang('Sigurnost i Nadzor', 'Security & Audit'), 'security', { isSecurity: true })}
                </tbody>
            </table>
        </div>
    `;
  
    const html = `
    <form id="user-form" class="space-y-6">
        <div class="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-700 grid grid-cols-1 md:grid-cols-3 gap-6 shadow-sm">
            <div>
                <label class="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2">${tLang('Korisničko Ime', 'Username')}</label>
                <input name="username" class="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-3 text-sm font-bold text-slate-900 dark:text-white focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm" value="${escapeHtml(user?.username||'')}" required ${isEdit ? 'readonly' : ''} placeholder="ime.prezime">
            </div>
            <div>
                <label class="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2 flex justify-between">
                    <span>${tLang('Lozinka', 'Password')}</span>
                    ${isEdit ? `<span class="text-amber-600 font-bold normal-case">(${tLang('Prazno ostavlja staru', 'Leave blank to retain current')})</span>` : ''}
                </label>
                <div class="flex relative">
                    <input name="password" id="gen-password-input" type="text" class="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-l-lg px-4 py-3 text-sm font-bold text-slate-900 dark:text-white focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm" ${!isEdit ? 'required' : ''} placeholder="${isEdit ? '••••••••' : 'Unesite ili generišite lozinku'}">
                    <button type="button" id="btn-generate-pw" class="bg-slate-800 hover:bg-slate-900 text-white px-3 border-y border-r border-slate-800 transition-colors" title="${tLang('Generiši Lozinku', 'Generate Password')}">🎲</button>
                    <button type="button" id="btn-copy-pw" class="bg-slate-200 hover:bg-slate-300 text-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-white px-3 rounded-r-lg border-y border-r border-slate-300 dark:border-slate-600 transition-colors" title="${tLang('Kopiraj', 'Copy')}">📋</button>
                </div>
            </div>
            <div>
                <label class="block text-[11px] font-black text-slate-500 uppercase tracking-widest mb-2">${tLang('Glavna Uloga', 'System Role')}</label>
                <select name="role" class="w-full bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-4 py-3 text-sm font-bold text-slate-900 dark:text-white focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all cursor-pointer shadow-sm" ${isMe ? 'disabled' : ''}>
                    <option value="worker" ${user?.role === 'worker' ? 'selected' : ''}>👷 ${tLang('Radnik (Ograničen pristup)', 'Worker (Restricted)')}</option>
                    <option value="manager" ${user?.role === 'manager' ? 'selected' : ''}>👔 ${tLang('Menadžer (Napredni nadzor)', 'Manager (Elevated)')}</option>
                    <option value="admin" ${user?.role === 'admin' ? 'selected' : ''}>👑 ${tLang('Administrator (Sve dozvoljeno)', 'Administrator (Full)')}</option>
                </select>
                ${isMe ? `<p class="text-[10px] text-amber-600 font-bold mt-1">🔒 ${tLang('Ne možete menjati sopstvenu ulogu.', 'You cannot change your own role.')}</p>` : ''}
            </div>
        </div>
        
        <div id="permissions-container" class="${user?.role === 'admin' ? 'opacity-20 pointer-events-none grayscale' : 'transition-opacity duration-300'}">
            <div class="mt-8">
                <h4 class="font-black text-2xl text-slate-900 dark:text-white tracking-tight">${tLang('Matrica Sigurnosnih Dozvola', 'Security Permissions Matrix')}</h4>
                <p class="text-sm text-slate-500 dark:text-slate-400 font-bold mt-1">${tLang('Definišite nivoe vidljivosti, prava modifikacije i brisanja za izabranog korisnika.', 'Granularly assign data isolation layers, read, write and operational constraints.')}</p>
            </div>
            ${matrixHtml}
        </div>
        
        <div class="flex justify-end gap-4 mt-10 pt-6 border-t border-slate-200 dark:border-slate-700">
            <button type="button" class="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-bold px-8 py-3 rounded-xl text-sm transition-colors hover:bg-slate-50 shadow-sm" onclick="closeModal()">${tLang('Odustani', 'Cancel')}</button>
            <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-black px-10 py-3 rounded-xl text-sm shadow-xl transition-transform transform hover:-translate-y-0.5 tracking-widest uppercase">${tLang('Sačuvaj Promene', 'Save Changes')}</button>
        </div>
    </form>`;
  
    openModal(isEdit ? tLang('Uređivanje Nivoa Pristupa', 'Edit Operational Account') : tLang('Kreiranje Novog Korisnika', 'Provision New System Identity'), html, async (fd) => {
        const payload = {
            id: user?.id,
            username: fd.get('username'),
            password: fd.get('password'),
            // Ako je korisnik "me", šaljemo rolu admin da ne bi puklo ako je select disabled
            role: isMe ? 'admin' : (fd.get('role') || user?.role || 'worker'),
            permissions: {}
        };
        
        const modulesWithRadios = ['deals', 'partners', 'offers', 'demands'];
        modulesWithRadios.forEach(mod => {
            const val = fd.get(`perm_${mod}_view_level`);
            if (val === 'all') payload.permissions[`${mod}_view_all`] = true;
            if (val === 'own') payload.permissions[`${mod}_view_own`] = true;
            
            if (fd.get(`perm_${mod}_edit`)) payload.permissions[`${mod}_edit`] = true;
            if (fd.get(`perm_${mod}_delete`)) payload.permissions[`${mod}_delete`] = true;
        });

        const modulesWithCheckboxes = ['products', 'finances'];
        modulesWithCheckboxes.forEach(mod => {
            if (fd.get(`perm_${mod}_view`)) payload.permissions[`${mod}_view`] = true;
            if (fd.get(`perm_${mod}_edit`)) payload.permissions[`${mod}_edit`] = true;
            if (fd.get(`perm_${mod}_delete`)) payload.permissions[`${mod}_delete`] = true;
        });
  
        // Napredne dozvole (Special Rights)
        if (fd.get('perm_deals_view_costs')) payload.permissions['deals_view_costs'] = true;
        if (fd.get('perm_deals_approve')) payload.permissions['deals_approve'] = true;
        if (fd.get('perm_use_company_stamp')) payload.permissions['use_company_stamp'] = true;
        if (fd.get('perm_offers_to_deal')) payload.permissions['offers_to_deal'] = true;
        if (fd.get('perm_offers_to_deal_force')) payload.permissions['offers_to_deal_force'] = true;
        if (fd.get('perm_partners_kyc')) payload.permissions['partners_kyc'] = true;
        if (fd.get('perm_products_view_prices')) payload.permissions['products_view_prices'] = true;
        if (fd.get('perm_finances_export')) payload.permissions['finances_export'] = true;
        if (fd.get('perm_system_export')) payload.permissions['system_export'] = true;
        if (fd.get('perm_system_import')) payload.permissions['system_import'] = true;
        if (fd.get('perm_settings_manage')) payload.permissions['settings_manage'] = true;
        if (fd.get('perm_audit_view')) payload.permissions['audit_view'] = true;
        if (fd.get('perm_portal_activity_view')) payload.permissions['portal_activity_view'] = true;
        if (fd.get('perm_portal_preview_manage')) payload.permissions['portal_preview_manage'] = true;
        if (fd.get('perm_firewall_manage')) payload.permissions['firewall_manage'] = true;
        if (fd.get('perm_firewall_manage')) payload.permissions['firewall_manage'] = true;
  
        try {
            const btn = document.querySelector('#user-form button[type="submit"]');
            if(btn) { btn.disabled = true; btn.innerText = `⏳ ...`; }
            
            if(typeof saveUser === 'function') await saveUser(payload);
            closeModal(); renderUsersView();
        } catch(e) { 
            console.error(e);
            const _m = tLang('Došlo je do greške na serveru prilikom upisa.', 'Server error while saving.');
            if (typeof showToast === 'function') showToast(_m, 'error'); else alert(_m);
            const btn = document.querySelector('#user-form button[type="submit"]');
            if(btn) { btn.disabled = false; btn.innerText = tLang('Sačuvaj Promene', 'Save Changes'); }
        }
    });

    // Password Generator Logic
    document.getElementById('btn-generate-pw')?.addEventListener('click', () => {
        const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
        let pass = "";
        for(let i=0; i<12; i++) pass += chars.charAt(Math.floor(Math.random() * chars.length));
        document.getElementById('gen-password-input').value = pass;
    });

    document.getElementById('btn-copy-pw')?.addEventListener('click', () => {
        const input = document.getElementById('gen-password-input');
        if(!input.value) return;
        navigator.clipboard.writeText(input.value).then(() => {
            const btn = document.getElementById('btn-copy-pw');
            const oldHtml = btn.innerHTML;
            btn.innerHTML = '✅';
            setTimeout(() => btn.innerHTML = oldHtml, 2000);
        });
    });
  
    const roleSelect = document.querySelector('select[name="role"]');
    if(roleSelect && !isMe) {
        roleSelect.addEventListener('change', (e) => {
            const pc = document.getElementById('permissions-container');
            if(e.target.value === 'admin') { 
                pc.classList.add('opacity-20', 'pointer-events-none', 'grayscale'); 
            } else { 
                pc.classList.remove('opacity-20', 'pointer-events-none', 'grayscale'); 
            }
        });
    }
}