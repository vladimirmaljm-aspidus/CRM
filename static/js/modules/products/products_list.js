// static/js/modules/products/products_list.js

window.showPriceHistory = function(productId, offerIndex) {
    const product = state.data.products.find(p => p.id === productId);
    if(!product) return;
    const offer = product.supplyOffers[offerIndex];
    const history = [...(offer.history || []), {price: offer.price, date: new Date().toISOString(), current: true}];
    
    const maxPrice = Math.max(...history.map(h => h.price));
    const minPrice = Math.min(...history.map(h => h.price));
    const range = maxPrice - minPrice || 1;
    
    const chartBars = history.map(h => {
        const heightPct = Math.max(10, ((h.price - minPrice) / range) * 100);
        const dStr = new Date(h.date).toLocaleDateString(Utils.getLang() === 'sr' ? 'sr-RS' : 'en-US');
        return `
        <div class="flex flex-col items-center justify-end h-full gap-2 group relative">
            <span class="text-xs font-black ${h.current ? 'text-blue-600' : 'text-slate-500'}">${h.price}</span>
            <div class="w-8 md:w-12 rounded-t-sm transition-all duration-500 ${h.current ? 'bg-blue-500 shadow-sm' : 'bg-slate-200'}" style="height: ${heightPct}%"></div>
            <span class="text-[10px] text-center text-slate-500 font-medium rotate-45 md:rotate-0 origin-left mt-2">${dStr}</span>
        </div>`;
    }).join('');
    
    const html = `
    <div class="p-6 bg-white rounded-xl border border-slate-200 shadow-sm">
        <h4 class="font-black text-slate-800 text-lg mb-6 flex justify-between items-center">
            <span>📈 ${Utils.getLang() === 'sr' ? 'Kretanje cene dobavljača' : 'Supplier Price Trend'}</span>
            <span class="text-xs bg-slate-50 px-3 py-1.5 rounded-md border border-slate-200 text-slate-700 uppercase tracking-wider">${Utils.escapeHtml(Utils.getPartnerNameById(offer.supplierId))}</span>
        </h4>
        <div class="h-64 flex items-end gap-4 border-b-2 border-l-2 border-slate-200 p-4 pt-10 relative">
            ${chartBars}
        </div>
    </div>`;
    Utils.openModal(Utils.getLang() === 'sr' ? 'Analitika cena' : 'Price Analytics', html, null);
};

// ADMINISTRATORSKA LOGIKA ZA ODOBRAVANJE ROBE IZ B2B PORTALA
window.showPortalApprovals = async function() {
    try {
        const res = await fetch('/api/portal/admin/products');
        const portalProds = await res.json();
        
        const pendingProds = portalProds.filter(p => p.status === 'pending');
        if (pendingProds.length === 0) {
            alert(Utils.getLang() === 'sr' ? "Nema novih zahteva na čekanju." : "No pending product approvals.");
            return;
        }

        const rows = pendingProds.map(p => {
            const off = (p.data.supplyOffers && p.data.supplyOffers.length > 0) ? p.data.supplyOffers[0] : {};
            return `
            <div class="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-xl mb-3 shadow-sm hover:shadow transition-all">
                <div>
                    <h4 class="font-black text-slate-900 text-base">${Utils.escapeHtml(p.data.name)}</h4>
                    <div class="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">${Utils.escapeHtml(p.partner_name)}</div>
                    <div class="text-sm text-blue-700 font-bold mt-2 bg-blue-50 px-2 py-1 inline-block rounded border border-blue-200">
                        Ponuđena Cena: ${off.price || 0} ${off.currency || 'USD'} / ${off.unit || 'MT'}
                    </div>
                </div>
                <div class="flex flex-col gap-2">
                    <button class="bg-emerald-600 hover:bg-emerald-700 text-white font-black px-4 py-2 rounded-lg text-xs shadow-sm uppercase tracking-wider transition-colors" data-portal-approval="${Utils.escapeHtml(p.id)}" data-approval-action="approve">✅ ${Utils.getLang() === 'sr' ? 'Odobri' : 'Approve'}</button>
                    <button class="bg-white hover:bg-red-50 text-red-600 border border-slate-300 hover:border-red-300 font-black px-4 py-2 rounded-lg text-xs shadow-sm uppercase tracking-wider transition-colors" data-portal-approval="${Utils.escapeHtml(p.id)}" data-approval-action="reject">❌ ${Utils.getLang() === 'sr' ? 'Odbij' : 'Reject'}</button>
                </div>
            </div>`;
        }).join('');

        const html = `<div class="max-h-[60vh] overflow-y-auto custom-scrollbar pr-2">${rows}</div>`;
        Utils.openModal(Utils.getLang() === 'sr' ? 'Robne Prijave sa Portala' : 'B2B Portal Goods Approvals', html, null);

        // Wire portal approval buttons via data attributes (replaces inline onclick)
        setTimeout(() => {
            const modal = document.getElementById('modal-overlay') || document.querySelector('.modal');
            if (modal) {
                modal.querySelectorAll('[data-portal-approval]').forEach(btn => {
                    btn.addEventListener('click', () => {
                        if (typeof window.processPortalApproval === 'function') {
                            window.processPortalApproval(btn.dataset.portalApproval, btn.dataset.approvalAction);
                        }
                    });
                });
            }
        }, 0);

    } catch (err) {
        console.error("Error fetching portal approvals", err);
    }
};

window.processPortalApproval = async function(productId, action) {
    if(!confirm(Utils.getLang() === 'sr' ? `Da li ste sigurni da želite da ${action === 'approve' ? 'odobrite' : 'odbijete'} ovu robu?` : "Are you sure?")) return;
    try {
        const res = await fetch(`/api/portal/admin/products/review/${productId}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action })
        });
        if(res.ok) {
            Utils.closeModal();
            loadData(); // Osvežava kompletan CRM (vraća nove proizvode iz baze)
        }
    } catch(err) {
        alert("Error processing approval");
    }
};

let allProductsData = []; 

function renderProductsView() {
    const main = document.getElementById('main-content');
    if(!main) return;
    main.innerHTML = '';
    
    const tLang = (srStr, enStr) => Utils.getLang() === 'sr' ? srStr : enStr;

    const header = Utils.createViewHeader(tLang('Katalog Proizvoda', 'Product Catalog'), tLang('+ Novi Proizvod', '+ Add Product'), showProductForm);
    
    const csvButtons = document.createElement('div'); 
    csvButtons.className = 'flex gap-2 flex-wrap mt-2';
    csvButtons.innerHTML = `
        <button id="dl-prod-tmpl" class="bg-white border border-slate-300 text-slate-700 font-bold px-4 py-2 rounded-lg text-xs hover:bg-slate-50 shadow-sm transition-colors">📥 ${tLang('Preuzmi Šablon', 'Download Template')}</button>
        <button id="import-prod-btn" class="bg-teal-600 hover:bg-teal-700 text-white font-black px-4 py-2 rounded-lg text-xs shadow-sm transition-colors">📤 ${tLang('Import Proizvoda', 'Import Products')}</button>
        <input type="file" id="import-prod-file" class="hidden" accept=".csv" />
    `;
    
    // DODATO DUGME ZA ODOBRAVANJE PORTAL ROBE (SAMO ZA ADMINA)
    if (state.user.role === 'admin') {
        const approvalBtn = document.createElement('button');
        approvalBtn.className = 'bg-amber-500 hover:bg-amber-600 text-white font-black px-4 py-2 rounded-lg text-xs shadow-sm transition-colors uppercase tracking-wider border border-amber-600';
        approvalBtn.innerHTML = `🛎️ ${tLang('B2B Portal Odobrenja', 'B2B Portal Approvals')}`;
        approvalBtn.onclick = window.showPortalApprovals;
        csvButtons.appendChild(approvalBtn);
    }
    
    header.querySelector('h2').insertAdjacentElement('afterend', csvButtons);
    main.appendChild(header);

    setTimeout(() => {
        // ISPRAVKA: dugme "Preuzmi Šablon" (id=dl-prod-tmpl) je bilo prisutno u
        // UI-ju od početka, ali nije bilo povezano ni sa jednim handlerom
        // (izgledalo je klikljivo, a klik nije radio ništa).
        document.getElementById('dl-prod-tmpl')?.addEventListener('click', () => {
            if (typeof downloadProductTemplate === 'function') downloadProductTemplate();
            else if (typeof showToast === 'function') showToast('Template download unavailable', 'error');
        });
        document.getElementById('import-prod-btn')?.addEventListener('click', () => document.getElementById('import-prod-file').click());
        document.getElementById('import-prod-file')?.addEventListener('change', (e) => { if(typeof importProductsFromCSV === 'function') importProductsFromCSV(e.target.files[0]); e.target.value = ''; });
    }, 0);

    const categories = [...new Set((state.data.products || []).map(p => p.category).filter(Boolean))];
    
    const filterSection = document.createElement('div');
    filterSection.className = 'flex flex-col md:flex-row gap-4 mt-6 mb-2';
    filterSection.innerHTML = `
        <div class="relative flex-1">
            <span class="absolute inset-y-0 left-0 flex items-center pl-4 text-slate-400">🔍</span>
            <input type="text" id="prod-search-input" class="w-full pl-11 pr-4 py-3 bg-white border border-slate-300 rounded-xl text-sm font-bold text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm transition-all" placeholder="${tLang('Pretraži proizvode (Naziv, SKU, HS Kod)...', 'Search products by name, SKU, HS Code...')}">
        </div>
        <select id="prod-category-filter" class="w-full md:w-48 bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm cursor-pointer transition-all">
            <option value="all">${tLang('Sve Kategorije', 'All Categories')}</option>
            ${categories.map(c => `<option value="${c}">${typeof getTranslatedCategory === 'function' ? getTranslatedCategory(c) : c}</option>`).join('')}
        </select>
        <select id="prod-stock-filter" class="w-full md:w-48 bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm cursor-pointer transition-all">
            <option value="all">${tLang('Svi Statusi Zaliha', 'All Stock Status')}</option>
            <option value="in_stock">${tLang('Samo na stanju', 'In Stock Only')}</option>
            <option value="out_of_stock">${tLang('Nema na stanju', 'Out of Stock')}</option>
        </select>
    `;
    main.appendChild(filterSection);

    const container = document.createElement('div'); 
    container.className = 'bg-white rounded-2xl shadow-md border border-slate-200 overflow-hidden mt-4 mb-10';
    main.appendChild(container);

    const renderTable = (productsToRender) => {
        if(productsToRender.length === 0) {
            container.innerHTML = `<div class="p-10 text-center text-slate-500 font-bold">${tLang('Nema pronađenih proizvoda.', 'No products found.')}</div>`;
            return;
        }

        const rows = productsToRender.map(p => {
            const imgThumb = p.imageUrl ? `<img src="${Utils.escapeHtml(p.imageUrl)}" alt="img" class="w-12 h-12 object-cover rounded-xl border border-slate-200 shadow-sm" onerror="this.outerHTML='<div class=\\'w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center border border-slate-200 text-xl opacity-50\\'>📦</div>'">` : `<div class="w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center border border-slate-200 text-xl opacity-50">📦</div>`;
            
            const catName = typeof getTranslatedCategory === 'function' ? getTranslatedCategory(p.category) : p.category;
            const skuDisplay = p.sku ? `<span class="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono ml-2 border border-slate-200">SKU: ${Utils.escapeHtml(p.sku)}</span>` : '';
            
            const tagsHtml = (p.tags || []).map(t => `<span class="bg-indigo-50 text-indigo-700 text-[9px] uppercase font-black px-1.5 py-0.5 rounded border border-indigo-200 shadow-sm mr-1 whitespace-nowrap">${Utils.escapeHtml(t)}</span>`).join('');
            
            // INDIKATOR ZA PARTNERSKU ROBU (Ako je isPartnerApproved = true)
            const partnerBadge = p.isPartnerApproved ? `<span class="bg-amber-100 text-amber-800 text-[9px] font-black uppercase px-2 py-0.5 rounded border border-amber-300 ml-2 shadow-sm" title="Ovaj proizvod je dodat od strane klijenta putem Portala">🤝 PARTNER GOODS</span>` : '';

            const totalStock = (p.inventory || []).reduce((s, i) => s + Number(i.qty), 0);
            const stockIndicator = totalStock > 0 ? `<span class="text-xs font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 shadow-sm ml-2">${totalStock} MT LAGER</span>` : `<span class="text-xs font-bold text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-200 ml-2">0 LAGER</span>`;

            const stMap = {
                'available': `<span class="bg-emerald-50 text-emerald-700 text-[9px] font-black px-1.5 py-0.5 rounded uppercase border border-emerald-200 ml-2 shadow-sm">${tLang('Slobodno','Avail')}</span>`,
                'in_transit': `<span class="bg-blue-50 text-blue-700 text-[9px] font-black px-1.5 py-0.5 rounded uppercase border border-blue-200 ml-2 shadow-sm">${tLang('Tranzit','Transit')}</span>`,
                'customs': `<span class="bg-orange-50 text-orange-700 text-[9px] font-black px-1.5 py-0.5 rounded uppercase border border-orange-200 ml-2 shadow-sm">${tLang('Carina','Customs')}</span>`,
                'reserved': `<span class="bg-slate-100 text-slate-700 text-[9px] font-black px-1.5 py-0.5 rounded uppercase border border-slate-300 ml-2 shadow-sm">${tLang('Rezervisano','Rsvd')}</span>`
            };

            const inventoryHtml = (p.inventory || []).map((inv, idx) => {
                const stBadge = stMap[inv.status || 'available'];
                return `
                <div class="flex flex-col md:flex-row items-start md:items-center justify-between py-2 border-b border-emerald-100 bg-emerald-50/50 px-3 rounded-lg mb-1.5 gap-2 transition-colors hover:bg-emerald-50">
                    <div class="text-xs flex flex-wrap items-center"><span class="font-bold text-emerald-800">📍 ${Utils.escapeHtml(inv.location)}</span> <span class="text-slate-300 mx-2">|</span> <strong class="text-slate-800 font-black">${inv.qty} MT</strong> ${stBadge}</div>
                    <button class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1 rounded text-[10px] shadow-sm uppercase tracking-wider transition-colors w-full md:w-auto create-offer-btn" data-product-id="${Utils.escapeHtml(p.id)}" data-is-inventory="true" data-inv-index="${idx}">🛍️ ${tLang('Napravi Ponudu', 'Create Offer')}</button>
                </div>`
            }).join('');

            const offersHtml = (p.supplyOffers || []).map((o, index) => {
                let validBadge = '';
                if(o.validUntil) {
                    const diff = Math.ceil((new Date(o.validUntil) - new Date()) / (1000 * 60 * 60 * 24));
                    if(diff < 0) validBadge = `<span class="text-[9px] bg-red-50 text-red-600 font-black px-1.5 py-0.5 rounded border border-red-200 ml-2">${tLang('ISTEKLO', 'EXPIRED')}</span>`;
                }
                const trendBtn = o.history && o.history.length > 0 ? `<button class="text-blue-500 hover:text-blue-700 mx-2 transition-colors price-history-btn" data-product-id="${Utils.escapeHtml(p.id)}" data-offer-index="${index}" title="${tLang('Istorija Cena', 'Price History')}">📈</button>` : '';
                
                let radarClass = 'text-slate-800';
                let radarIcon = '';
                if (p.targetPrice > 0) {
                    if (o.price <= p.targetPrice) {
                        radarClass = 'text-emerald-700 font-black';
                        radarIcon = '<span title="Ispod ciljane cene!">🎯</span> ';
                    } else {
                        radarClass = 'text-red-600 font-bold';
                    }
                }

                return `
                <div class="flex flex-col md:flex-row items-start md:items-center justify-between py-2 border-b border-slate-100 last:border-b-0 gap-2 hover:bg-slate-50 px-2 rounded-lg transition-colors">
                    <div class="text-xs text-slate-700 flex items-center flex-wrap">
                        <span class="font-bold text-slate-800 uppercase tracking-wider">${Utils.getPartnerNameById(o.supplierId) || 'Unknown'}</span> <span class="text-slate-300 mx-2">|</span>
                        ${radarIcon}<strong class="${radarClass} text-sm">${Utils.formatCurrency(o.price, o.currency)}</strong> <span class="text-[10px] text-slate-500 ml-1">/ ${Utils.escapeHtml(o.unit || 'MT')}</span>
                        <span class="text-[9px] uppercase font-black text-slate-500 bg-white px-1.5 py-0.5 rounded border border-slate-200 mx-2 shadow-sm">${Utils.escapeHtml(o.incoterm || 'N/A')}</span>
                        ${validBadge} ${trendBtn}
                    </div>
                    <button class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1 rounded text-[10px] shadow-sm uppercase tracking-wider transition-colors w-full md:w-auto create-offer-btn" data-product-id="${Utils.escapeHtml(p.id)}" data-offer-index="${index}">🛍️ ${tLang('Napravi Ponudu', 'Create Offer')}</button>
                </div>`;
            }).join('');

            return `
            <tr class="border-b border-slate-200 hover:bg-slate-50 transition-colors">
                <td class="p-4 align-top w-16">${imgThumb}</td>
                <td class="p-4 align-top">
                    <div class="font-black text-base text-slate-800 mb-1">${Utils.escapeHtml(p.name)} ${skuDisplay} ${stockIndicator} ${partnerBadge}</div>
                    <div class="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">${Utils.escapeHtml(catName)} <span class="mx-1">|</span> HS: ${Utils.escapeHtml(p.hsCode || 'N/A')}</div>
                    <div class="flex flex-wrap gap-1 mt-2">${tagsHtml}</div>
                </td>
                <td class="p-4 align-top text-xs text-slate-600">
                    <div class="mb-1"><strong class="text-slate-800">COA:</strong> ${(p.coaParams || []).length} params</div>
                    ${p.brand ? `<div class="mb-1"><strong class="text-slate-800">Brand:</strong> ${Utils.escapeHtml(p.brand)}</div>` : ''}
                    ${p.shelfLife ? `<div><strong class="text-slate-800">Shelf Life:</strong> ${Utils.escapeHtml(p.shelfLife)} months</div>` : ''}
                </td>
                <td class="p-4 align-top w-full md:w-2/5">
                    ${inventoryHtml ? `<div class="mb-3">${inventoryHtml}</div>` : ''}
                    <div class="space-y-1">${offersHtml || `<span class="text-xs text-slate-400 italic">${tLang('Nema unetih ponuda.', 'No offers.')}</span>`}</div>
                </td>
                <td class="p-4 align-top text-right whitespace-nowrap">
                    <button class="bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold px-4 py-2 rounded-lg text-xs shadow-sm transition-colors mr-2 edit-product" data-id="${p.id}">⚙️ ${tLang('Izmeni', 'Edit')}</button>
                    ${state.user.role === 'admin' ? `<button class="bg-red-50 text-red-600 hover:bg-red-600 hover:text-white border border-red-200 font-bold px-3 py-2 rounded-lg text-xs shadow-sm transition-colors del-product" data-id="${p.id}">🗑️</button>` : ''}
                </td>
            </tr>`;
        }).join('');

        container.innerHTML = `
        <table class="w-full text-left border-collapse">
            <thead>
                <tr class="bg-slate-50 border-b border-slate-200">
                    <th class="p-4 uppercase text-[10px] font-black tracking-widest text-slate-500 w-16"></th>
                    <th class="p-4 uppercase text-[10px] font-black tracking-widest text-slate-500">${tLang('Proizvod i Detalji', 'Product & Details')}</th>
                    <th class="p-4 uppercase text-[10px] font-black tracking-widest text-slate-500">${tLang('Kvalitet / Info', 'Quality / Info')}</th>
                    <th class="p-4 uppercase text-[10px] font-black tracking-widest text-slate-500 w-2/5">${tLang('Zalihe i Ponude Dobavljača', 'Inventory & Supplier Offers')}</th>
                    <th class="p-4 text-right uppercase text-[10px] font-black tracking-widest text-slate-500">${tLang('Akcije', 'Actions')}</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;

        container.querySelectorAll('.edit-product').forEach(b => b.addEventListener('click', e => showProductForm(e.currentTarget.dataset.id)));
        container.querySelectorAll('.del-product').forEach(b => b.addEventListener('click', e => Utils.handleDelete('products', e.currentTarget.dataset.id)));

        // Data-attribute event listeners (replaces inline onclick handlers for XSS safety)
        container.querySelectorAll('.create-offer-btn').forEach(b => b.addEventListener('click', e => {
            const btn = e.currentTarget;
            const productId = btn.dataset.productId;
            const isInventory = btn.dataset.isInventory === 'true';
            if (isInventory) {
                document.dispatchEvent(new CustomEvent('createCustomerOffer', {detail: {productId, isInventory: true, invIndex: parseInt(btn.dataset.invIndex, 10)}}));
            } else {
                document.dispatchEvent(new CustomEvent('createCustomerOffer', {detail: {productId, offerIndex: parseInt(btn.dataset.offerIndex, 10)}}));
            }
        }));
        container.querySelectorAll('.price-history-btn').forEach(b => b.addEventListener('click', e => {
            const btn = e.currentTarget;
            if (typeof showPriceHistory === 'function') showPriceHistory(btn.dataset.productId, parseInt(btn.dataset.offerIndex, 10));
        }));
    };

    allProductsData = state.data.products || [];
    renderTable(allProductsData);

    const searchInput = document.getElementById('prod-search-input');
    const catFilter = document.getElementById('prod-category-filter');
    const stockFilter = document.getElementById('prod-stock-filter');

    const filterProducts = () => {
        const sTerm = searchInput.value.toLowerCase();
        const cTerm = catFilter.value;
        const stkTerm = stockFilter.value;

        const filtered = allProductsData.filter(p => {
            const matchSearch = p.name.toLowerCase().includes(sTerm) || (p.hsCode && p.hsCode.toLowerCase().includes(sTerm)) || (p.sku && p.sku.toLowerCase().includes(sTerm));
            const matchCat = cTerm === 'all' || p.category === cTerm;
            
            let matchStock = true;
            if (stkTerm === 'in_stock') {
                const totalStock = (p.inventory || []).reduce((s, i) => s + Number(i.qty), 0);
                matchStock = totalStock > 0;
            } else if (stkTerm === 'out_of_stock') {
                const totalStock = (p.inventory || []).reduce((s, i) => s + Number(i.qty), 0);
                matchStock = totalStock === 0;
            }

            return matchSearch && matchCat && matchStock;
        });
        renderTable(filtered);
    };

    searchInput.addEventListener('input', filterProducts);
    catFilter.addEventListener('change', filterProducts);
    stockFilter.addEventListener('change', filterProducts);
}