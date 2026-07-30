// static/js/modules/partners/partners_list.js
function renderPartnersView() {
    const main = document.getElementById('main-content');
    if(!main) return;
    main.innerHTML = '';
    
    const header = Utils.createViewHeader(Utils.t('nav.partners'), Utils.t('add.partner'), showPartnerForm);
    const csvButtons = document.createElement('div'); 
    csvButtons.className = 'flex gap-2 flex-wrap mt-2 sm:mt-0';
    
    csvButtons.innerHTML = `
        <button id="download-template-btn" class="btn small bg-[var(--panel)] border border-[var(--border)] text-main shadow-sm hover:bg-[var(--hover-bg)]">📥 ${Utils.t('misc.downloadTemplate')}</button>
        <button id="import-csv-btn" class="btn small bg-teal-600 text-white shadow-sm">📤 ${Utils.t('misc.importPartners')}</button>
        <button id="export-partners-btn" class="btn small bg-blue-600 text-white shadow-sm">${Utils.t('actions.exportCsv')}</button>
    `;
    header.querySelector('h2').insertAdjacentElement('afterend', csvButtons);
    main.appendChild(header);

    main.appendChild(renderPartnerFilters());

    document.getElementById('download-template-btn').addEventListener('click', typeof downloadPartnerTemplate === 'function' ? downloadPartnerTemplate : () => {});
    document.getElementById('import-csv-btn').addEventListener('click', () => document.getElementById('import-csv-input').click());
    
    let data = Utils.applyFiltersFor('partners');
    
    const searchTerm = (state.activeFilters.partners.search || '').toLowerCase();
    if (searchTerm) {
        data = data.filter(p => 
            (p.companyName || '').toLowerCase().includes(searchTerm) || 
            (p.taxId || '').toLowerCase().includes(searchTerm)
        );
    }

    document.getElementById('export-partners-btn').addEventListener('click', () => {
        if(data.length === 0) return alert(Utils.t('misc.exportNoData'));
        const csvContent = "data:text/csv;charset=utf-8," + 
            `"${Utils.t('fields.companyName')}","${Utils.t('fields.taxId')}","${Utils.t('fields.types')}","${Utils.t('fields.city')}","${Utils.t('fields.country')}","${Utils.t('fields.statusLabel')}","${Utils.t('fields.ratingLabel')}"\n` + 
            data.map(p => `"${p.companyName}","${p.taxId||''}","${p.types?.join('|')||''}","${p.address?.city||''}","${p.address?.country||''}","${p.status||'active'}","${p.rating||0}"`).join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `partners_export_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link); link.click(); link.remove();
    });

    const container = document.createElement('div'); 
    container.className = 'overflow-x-auto bg-[var(--card)] rounded-2xl shadow-xl p-4 border border-[var(--border)]';

    container.innerHTML = `
    <table class="min-w-full data-table">
        <thead class="text-xs text-[var(--muted)] uppercase tracking-wider bg-[var(--hover-bg)]">
            <tr>
                <th class="text-left px-4 py-3 font-bold">${Utils.t('fields.companyName')}</th>
                <th class="text-left px-4 py-3 font-bold">${Utils.t('fields.statusRating')}</th>
                <th class="text-left px-4 py-3 font-bold">${Utils.t('fields.types')}</th>
                <th class="text-left px-4 py-3 font-bold">${Utils.t('fields.taxId')}</th>
                <th class="text-left px-4 py-3 font-bold">${Utils.t('fields.city')}</th>
                <th class="text-right px-4 py-3 font-bold">${Utils.t('actions.details')}</th>
            </tr>
        </thead>
        <tbody class="divide-y divide-[var(--border)] bg-[var(--card)]">
            ${data.map(p => {
                const icon = p.entityType === 'person' ? '👤' : '🏢';
                const linked = p.entityType === 'person' && p.linkedCompanyId 
                     ? `<div class="text-xs text-blue-500 font-bold mt-1 bg-blue-50 dark:bg-blue-900/20 inline-block px-2 py-0.5 rounded-full border border-blue-200">🔗 ${Utils.getPartnerNameById(p.linkedCompanyId)}</div>` 
                     : '';
                
                const translatedTypes = (p.types || []).map(typ => {
                    if(typ === 'Kupac' || typ === 'buyer') return Utils.t('finances.buyer');
                    if(typ === 'Dobavljač' || typ === 'supplier') return Utils.t('finances.supplier');
                    if(typ === 'Saradnik' || typ === 'associate') return 'Associate';
                    return typ;
                }).join(', ');

                const ratingStars = '⭐'.repeat(parseInt(p.rating || 0));
                let statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700 border border-green-300">${Utils.t('fields.active').toUpperCase()}</span>`;
                if(p.status === 'inactive') statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-700 border border-gray-300">${Utils.t('fields.inactive').toUpperCase()}</span>`;
                if(p.status === 'blacklisted') statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 border border-red-300">${Utils.t('fields.blacklisted').toUpperCase()}</span>`;
                
                return `
                <tr class="table-row border-[var(--border)] transition-colors hover:bg-[var(--hover-bg)] ${p.status === 'blacklisted' ? 'bg-red-50/30 dark:bg-red-900/10' : ''}">
                    <td class="px-4 py-4 text-base font-black text-main"><span class="mr-2 text-xl opacity-80">${icon}</span> ${Utils.escapeHtml(p.companyName)}${p.isPremium ? ' <span title="Premium klijent — portal bez GPS/KYC gate-a" style="display:inline-block;margin-left:6px;padding:1px 8px;background:linear-gradient(135deg,#f4d03f,#b8892e);color:#3d2f00;font-size:9px;font-weight:800;letter-spacing:0.12em;border-radius:20px;vertical-align:middle;">★ PREMIUM</span>' : ''}<br>${linked}</td>
                    <td class="px-4 py-4 text-sm"><div class="flex flex-col gap-1 items-start">${statusBadge} <span class="text-xs">${ratingStars}</span></div></td>
                    <td class="px-4 py-4 text-sm font-bold text-accent">${translatedTypes}</td>
                    <td class="px-4 py-4 text-sm text-[var(--muted)] font-medium">${Utils.escapeHtml(p.taxId || '-')}</td>
                    <td class="px-4 py-4 text-sm text-[var(--muted)] font-medium">${Utils.escapeHtml((p.address?.city || '') + (p.address?.city && p.address?.country ? ', ' : '') + (p.address?.country || ''))}</td>
                    <td class="px-4 py-4 text-right text-sm font-medium">
                        <button class="details-btn btn small bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-600 hover:text-white shadow-sm transition-all" data-id="${p.id}">👁️ ${Utils.t('actions.details')}</button>
                    </td>
                </tr>`;
            }).join('') || `<tr><td colspan="6" class="p-10 text-center text-[var(--muted)] font-bold border-dashed border-2">${Utils.t('product_search.noResults')}</td></tr>`}
        </tbody>
    </table>`;
    
    main.appendChild(container);

    container.querySelectorAll('.details-btn').forEach(b => b.addEventListener('click', (e) => { 
        state.currentView = 'partnerDetail'; 
        state.detailViewId = e.currentTarget.dataset.id; 
        render(); 
    }));
}

function renderPartnerFilters(){
    const div = document.createElement('div'); 
    div.className = 'filter-container p-5 bg-[var(--card)] rounded-xl shadow-sm mb-6 grid grid-cols-1 md:grid-cols-4 gap-4 border border-[var(--border)]';
    
    const typeOpts = `
        <option value="">${Utils.t('misc.allTypesLabel')}</option>
        <option value="buyer">${Utils.t('finances.buyer')}</option>
        <option value="supplier">${Utils.t('finances.supplier')}</option>
        <option value="associate">Associate</option>
    `;
    
    div.innerHTML = `
        <div><label class="block text-sm font-bold text-main mb-1">${Utils.t('misc.searchNameTax')}</label><input id="filter-partner-search" class="form-input border-gray-300 focus:border-accent" placeholder="${Utils.t('placeholders.searchName')}" /></div>
        <div><label class="block text-sm font-bold text-main mb-1">${Utils.t('fields.types')}</label><select id="filter-partner-type" class="form-input border-gray-300 focus:border-accent">${typeOpts}</select></div>
        <div><label class="block text-sm font-bold text-main mb-1">${Utils.t('fields.city')}</label><input id="filter-partner-city" class="form-input border-gray-300 focus:border-accent" placeholder="${Utils.t('product_search.search')}..." /></div>
        <div><label class="block text-sm font-bold text-main mb-1">${Utils.t('fields.country')}</label><input id="filter-partner-country" class="form-input border-gray-300 focus:border-accent" placeholder="${Utils.t('product_search.search')}..." /></div>
    `;
    
    const handleTypeFilter = (e) => {
        let val = e.target.value;
        if(val === 'buyer') val = 'Kupac';
        Utils.handleFilterChange('partners', 'type', e.target.value);
    };

    div.querySelector('#filter-partner-search').value = state.activeFilters.partners.search || '';
    div.querySelector('#filter-partner-search').addEventListener('input', e => Utils.handleFilterChange('partners','search', e.target.value));

    div.querySelector('#filter-partner-type').value = state.activeFilters.partners.type || ''; 
    div.querySelector('#filter-partner-type').addEventListener('change', handleTypeFilter);

    div.querySelector('#filter-partner-city').value = state.activeFilters.partners.city || ''; 
    div.querySelector('#filter-partner-city').addEventListener('input', e => Utils.handleFilterChange('partners','city', e.target.value));

    div.querySelector('#filter-partner-country').value = state.activeFilters.partners.country || ''; 
    div.querySelector('#filter-partner-country').addEventListener('input', e => Utils.handleFilterChange('partners','country', e.target.value));
    
    return div;
}