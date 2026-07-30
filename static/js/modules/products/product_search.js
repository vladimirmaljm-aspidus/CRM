// static/js/modules/products/product_search.js
function renderProductSearchView() {
    const main = document.getElementById('main-content');
    if(!main) return;
    main.innerHTML = '';
    
    const header = Utils.createViewHeader(Utils.t('product_search.title'), '', null); 
    if(header.querySelector('button')) header.querySelector('button').remove(); 
    main.appendChild(header);
    
    const catFallback = typeof PRODUCT_CATEGORIES !== 'undefined' ? PRODUCT_CATEGORIES : [];
    const isSupplier = (p) => (p.types || []).includes('supplier') || (p.types || []).includes('Dobavljač');
    
    const searchForm = document.createElement('form'); 
    searchForm.id = 'product-search-form'; 
    searchForm.className = 'p-5 bg-[var(--card)] rounded-xl shadow-sm mb-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 border border-[var(--border)]';
    
    searchForm.innerHTML = `
        <div><label class="block text-sm mb-1 font-bold text-main">${Utils.t('product_search.productName')}</label><input name="name" class="form-input" placeholder="${Utils.t('product_search.search')}..."></div>
        <div><label class="block text-sm mb-1 font-bold text-main">${Utils.t('product_search.category')}</label><select name="category" class="form-input">${[''].concat(catFallback).map(c => { const catName = typeof getTranslatedCategory === 'function' ? getTranslatedCategory(c) : c; return `<option value="${c}">${catName || Utils.t('misc.allTypesLabel')}</option>`; }).join('')}</select></div>
        <div><label class="block text-sm mb-1 font-bold text-main">${Utils.t('product_search.countryOrigin')}</label><div class="autocomplete-container"><input name="country" class="form-input" placeholder="${Utils.t('product_search.search')}..." autocomplete="off"></div></div>
        <div><label class="block text-sm mb-1 font-bold text-main">${Utils.t('product_search.supplier')}</label><select name="supplierId" class="form-input"><option value="">${Utils.t('misc.allTypesLabel')}</option>${state.data.partners.filter(isSupplier).map(p => `<option value="${p.id || ''}">${Utils.escapeHtml(p.companyName)}</option>`).join('')}</select></div>
        <div><label class="block text-sm mb-1 font-bold text-main">${Utils.t('product_search.certificates')}</label><select name="certificates" class="form-input"><option value="">${Utils.t('misc.allTypesLabel')}</option>${(typeof CERTIFICATES !== 'undefined' ? CERTIFICATES : []).map(c => `<option value="${c}">${c}</option>`).join('')}</select></div>
        <div><label class="block text-sm mb-1 font-bold text-main">${Utils.t('product_search.incoterm')}</label><select name="incoterm" class="form-input"><option value="">${Utils.t('misc.allTypesLabel')}</option>${(typeof INCOTERMS !== 'undefined' ? INCOTERMS : []).map(i => `<option value="${i}">${i}</option>`).join('')}</select></div>
        <div class="md:col-span-2 lg:col-span-1">
            <label class="block text-sm mb-1 font-bold text-main">${Utils.t('product_search.priceRange')} (${state.settings.currency || 'USD'})</label>
            <div class="flex items-center gap-2">
                <input name="minPrice" type="number" class="form-input" placeholder="${Utils.t('product_search.from')}">
                <span class="text-[var(--muted)]">-</span>
                <input name="maxPrice" type="number" class="form-input" placeholder="${Utils.t('product_search.to')}">
            </div>
        </div>
        <div class="flex items-end"><button type="submit" class="btn bg-blue-600 text-white w-full h-[42px] shadow-sm">🔍 ${Utils.t('product_search.search')}</button></div>
    `;
    main.appendChild(searchForm);
    
    if(typeof Utils.initAutocomplete === 'function' && typeof COUNTRIES !== 'undefined') {
        Utils.initAutocomplete(searchForm.querySelector('[name="country"]'), COUNTRIES);
    }
    
    const resultsContainer = document.createElement('div'); 
    resultsContainer.id = 'product-search-results'; 
    resultsContainer.className = 'bg-[var(--card)] rounded-xl p-4 border border-[var(--border)] shadow-xl'; 
    main.appendChild(resultsContainer);
    
    searchForm.addEventListener('submit', e => { 
        e.preventDefault(); 
        const filters = Object.fromEntries(new FormData(searchForm).entries()); 
        displaySearchResults(performProductSearch(filters), resultsContainer); 
    });
}

function performProductSearch(filters) {
    let results = [];
    const baseCur = state.settings.currency || 'USD';
    
    state.data.products.forEach(product => {
        (product.supplyOffers || []).forEach((offer, offerIndex) => {
            let match = true;
            
            if (filters.name && !product.name.toLowerCase().includes(filters.name.toLowerCase())) match = false;
            if (filters.category && product.category !== filters.category) match = false;
            if (filters.country && offer.country && !offer.country.toLowerCase().includes(filters.country.toLowerCase())) match = false;
            if (filters.supplierId && offer.supplierId !== filters.supplierId) match = false;
            if (filters.certificates && (!offer.certificates || !offer.certificates.toLowerCase().includes(filters.certificates.toLowerCase()))) match = false;
            if (filters.incoterm && offer.incoterm !== filters.incoterm) match = false;
            
            let offerPriceInBase = offer.price || 0;
            if(typeof Utils.convertCurrency === 'function') {
                offerPriceInBase = Utils.convertCurrency(offer.price || 0, offer.currency || 'USD', baseCur);
            }
            
            if (filters.minPrice && offerPriceInBase < parseFloat(filters.minPrice)) match = false;
            if (filters.maxPrice && offerPriceInBase > parseFloat(filters.maxPrice)) match = false;
            
            if (match) results.push({ ...offer, productName: product.name, productId: product.id, offerIndex: offerIndex });
        });
    });
    return results;
}

function displaySearchResults(results, container) {
    if (!results || results.length === 0) { 
        container.innerHTML = `<p class="text-[var(--muted)] text-center p-10 font-bold border-dashed border-2 rounded">${Utils.t('product_search.noResults')}</p>`; 
        return; 
    }
    
    const tableRows = results.map(offer => `
        <tr class="table-row border-[var(--border)] transition-colors hover:bg-[var(--hover-bg)]">
            <td class="px-4 py-4 text-main font-bold">${Utils.escapeHtml(offer.productName)}</td>
            <td class="px-4 py-4 text-[var(--muted)]">${Utils.escapeHtml(Utils.getPartnerNameById(offer.supplierId))}</td>
            <td class="px-4 py-4 text-main">${Utils.escapeHtml(offer.country)}</td>
            <td class="px-4 py-4 font-black text-accent">${Utils.formatCurrency(offer.price, offer.currency)} / ${Utils.escapeHtml(offer.unit)}</td>
            <td class="px-4 py-4 text-main">${Utils.escapeHtml(offer.incoterm)}</td>
            <td class="px-4 py-4 text-[var(--muted)] text-xs">${Utils.escapeHtml(offer.certificates || '-')}</td>
            <td class="px-4 py-4 text-right">
                <button class="btn small bg-orange-500 text-white shadow-sm" onclick="document.dispatchEvent(new CustomEvent('createCustomerOffer', {detail: {productId: '${offer.productId}', offerIndex: ${offer.offerIndex}}}))">${Utils.t('offer.generate')}</button>
            </td>
        </tr>
    `).join('');
    
    container.innerHTML = `
    <table class="min-w-full data-table">
        <thead class="text-xs text-[var(--muted)] tracking-wider bg-[var(--hover-bg)] uppercase">
            <tr>
                <th class="px-4 py-3 text-left">${Utils.t('fields.productName')}</th>
                <th class="text-left px-4 py-3">${Utils.t('fields.supplier')}</th>
                <th class="text-left px-4 py-3">${Utils.t('fields.origin')}</th>
                <th class="text-left px-4 py-3">${Utils.t('fields.price')}</th>
                <th class="text-left px-4 py-3">${Utils.t('fields.incoterm')}</th>
                <th class="text-left px-4 py-3">${Utils.t('fields.certificates')}</th>
                <th class="text-right px-4 py-3">${Utils.t('misc.offerActionsTable')}</th>
            </tr>
        </thead>
        <tbody class="divide-y divide-[var(--border)] bg-[var(--card)]">${tableRows}</tbody>
    </table>`;
}