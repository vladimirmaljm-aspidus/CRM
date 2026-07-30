// static/js/modules/products/demands.js

function showDemandForm(id = null) {
    state.editingItem = id ? state.data.demands.find(d => d.id === id) : null; 
    const item = state.editingItem || {};
    const tLang = (srStr, enStr) => Utils.getLang() === 'sr' ? srStr : enStr;
    
    const isBuyer = (p) => (p.types || []).includes('buyer') || (p.types || []).includes('Kupac');
    const buyerOptions = state.data.partners.filter(isBuyer).map(p => `<option value="${p.id}" ${item.buyerId === p.id ? 'selected' : ''}>${Utils.escapeHtml(p.companyName)}</option>`).join('');
    const productOptions = state.data.products.map(p => `<option value="${p.id}" ${item.productId === p.id ? 'selected' : ''}>${Utils.escapeHtml(p.name)}</option>`).join('');
    
    const html = `
    <form id="demand-form" class="crm-form-panel">
      <div class="crm-form-section">
          <h4 class="crm-form-section-title">👤 ${tLang('Kupac koji traži robu','Buyer requesting product')}</h4>
          <p class="crm-form-section-desc">${tLang('Klijent iz Partners modula koji je poslao potražnju.','Client from Partners module who submitted the demand.')}</p>
          <div class="crm-field">
              <label class="crm-label crm-label-required">${Utils.t('offer.customer')}</label>
              <select name="buyerId" class="crm-input" required>
                  <option value="">${Utils.t('actions.select_buyer')}</option>
                  ${buyerOptions}
              </select>
          </div>
      </div>

      <div class="crm-form-section crm-form-section-highlighted">
          <h4 class="crm-form-section-title">📦 ${Utils.t('fields.demandFor')}</h4>
          <p class="crm-form-section-desc">${tLang('Šta klijent traži — postojeća roba iz kataloga ili sasvim nova roba.','What the client is looking for — existing catalog product or a brand new one.')}</p>
          <div class="crm-form-grid crm-form-grid-2">
              <label class="crm-chip" style="padding:12px;border-radius:10px;background:#fff;">
                  <input type="radio" name="demandType" value="existing" ${!item.isNewProduct ? 'checked' : ''}/>
                  <span>📦 <b>${Utils.t('fields.existingProduct')}</b></span>
              </label>
              <label class="crm-chip" style="padding:12px;border-radius:10px;background:#fff;">
                  <input type="radio" name="demandType" value="new" ${item.isNewProduct ? 'checked' : ''}/>
                  <span>✨ <b>${Utils.t('fields.newProduct')}</b></span>
              </label>
          </div>
          <div id="existing-product-container" class="crm-field" style="margin-top:14px;">
              <label class="crm-label">${Utils.t('actions.select_product')}</label>
              <select name="productId" class="crm-input">
                  <option value="">${tLang('— Izaberi robu iz kataloga —','— Select from catalog —')}</option>
                  ${productOptions}
              </select>
              <p class="crm-help">${tLang('Roba iz naše baze proizvoda.','Product from our catalog.')}</p>
          </div>
          <div id="new-product-container" class="crm-field hidden" style="margin-top:14px;">
              <label class="crm-label crm-label-required" style="color:#b45309;">${Utils.t('fields.newProductName')}</label>
              <input name="newProductName" class="crm-input crm-input-warning" value="${Utils.escapeHtml(item.productName || '')}" placeholder="${Utils.t('placeholders.newProduct')}"/>
              <p class="crm-help">${tLang('Ako roba nije u katalogu, upiši opis; admin će je kasnije dodati u proizvode.','If the product is not in our catalog, describe it; admin will add it later.')}</p>
          </div>
      </div>

      <div class="crm-form-section">
          <h4 class="crm-form-section-title">📊 ${tLang('Detalji potražnje','Demand details')}</h4>
          <div class="crm-form-grid crm-form-grid-2">
              <div class="crm-field">
                  <label class="crm-label crm-label-required">${Utils.t('fields.quantity')}</label>
                  <input name="quantity" type="number" step="0.01" min="0" class="crm-input crm-input-price" value="${Utils.escapeHtml(item.quantity || '')}" placeholder="0.00"/>
                  <p class="crm-help">${tLang('Količina koju kupac traži (u jedinici mere iz proizvoda).','Quantity requested (in the product unit of measure).')}</p>
              </div>
              <div class="crm-field">
                  <label class="crm-label">${tLang('Status zahteva','Demand status')}</label>
                  <select name="status" class="crm-input">
                      <option value="open" ${item.status === 'open' ? 'selected' : ''}>🟢 ${tLang('Otvoreno (tražimo)','Open (sourcing)')}</option>
                      <option value="sourced" ${item.status === 'sourced' ? 'selected' : ''}>🔵 ${tLang('Pronađen dobavljač','Supplier found')}</option>
                      <option value="closed" ${item.status === 'closed' ? 'selected' : ''}>⚫ ${tLang('Završeno / Prodato','Closed / Sold')}</option>
                  </select>
                  <p class="crm-help">${tLang('Trenutna faza potražnje.','Current stage of the demand.')}</p>
              </div>
          </div>
      </div>

      <div class="crm-form-actions">
          <button type="submit" class="crm-btn crm-btn-primary">💾 ${Utils.t('actions.save')}</button>
      </div>
    </form>`;
    
    Utils.openModal(state.editingItem ? tLang('Izmena Zahteva', 'Edit Demand') : tLang('Novi Zahtev Kupca', 'New Client Demand'), html, async (fd) => {
        const id = state.editingItem?.id || Utils.generateId(); 
        const isNew = fd.get('demandType') === 'new';
        
        if (isNew && !fd.get('newProductName').trim()) { alert(tLang('Unesite naziv novog proizvoda.', 'Enter new product name.')); return; }
        if (!isNew && !fd.get('productId')) { alert(tLang('Izaberite postojeći proizvod.', 'Select existing product.')); return; }
        
        const demand = {
            id,
            buyerId: fd.get('buyerId'),
            // customerId se drži usklađenim sa buyerId da bi potražnja bila vidljiva
            // i klijentu u B2B portalu (portal filtrira po customerId).
            customerId: fd.get('buyerId'),
            productId: isNew ? null : fd.get('productId'),
            productName: isNew ? fd.get('newProductName') : Utils.getProductNameById(fd.get('productId')),
            quantity: fd.get('quantity'),
            targetPrice: state.editingItem?.targetPrice || 0,
            status: fd.get('status') || 'open',
            isNewProduct: isNew,
            source: state.editingItem?.source || 'CRM',
            createdAt: state.editingItem?.createdAt || state.editingItem?.date || new Date().toISOString(),
            ownerId: state.editingItem?.ownerId || state.user?.id || 'SYSTEM',
            sharedWith: state.editingItem?.sharedWith || []
        };
        
        if(state.editingItem) {
           state.data.demands[state.data.demands.findIndex(d => d.id === id)] = demand; 
        } else {
           state.data.demands.push(demand);
        }
        
        await saveSingleItem('demands', demand); 
        Utils.closeModal(); 
        render(); 
        if(typeof checkAllNotifications === 'function') checkAllNotifications();
    });
    
    const form = document.getElementById('demand-form'); 
    const existingContainer = form.querySelector('#existing-product-container'); 
    const newContainer = form.querySelector('#new-product-container');
    
    const updateVisibility = () => { 
        if(form.querySelector('input[name="demandType"]:checked').value === 'new') {
           existingContainer.classList.add('hidden'); 
           newContainer.classList.remove('hidden');
       } else {
           existingContainer.classList.remove('hidden'); 
           newContainer.classList.add('hidden');
       }
    };
    
    form.querySelectorAll('input[name="demandType"]').forEach(input => input.addEventListener('change', updateVisibility)); 
    updateVisibility();
}

function renderDemandsView() {
    const main = document.getElementById('main-content'); 
    if(!main) return;
    main.innerHTML = '';
    
    const tLang = (srStr, enStr) => Utils.getLang() === 'sr' ? srStr : enStr;
    const header = Utils.createViewHeader(tLang('Zahtevi Kupaca', 'Client Demands'), tLang('+ Novi Zahtev', '+ New Demand'), showDemandForm); 
    main.appendChild(header);
    
    const container = document.createElement('div'); 
    container.className = 'bg-white rounded-2xl shadow-xl border border-slate-200 overflow-x-auto mt-6 mb-10';
    
    const currentLang = Utils.getLang() === 'sr' ? 'sr-RS' : 'en-US';
    
    const stColors = {
        'pending': 'bg-amber-100 text-amber-800 border-amber-300',
        'open': 'bg-blue-100 text-blue-800 border-blue-300',
        'sourced': 'bg-emerald-100 text-emerald-800 border-emerald-300',
        'closed': 'bg-slate-200 text-slate-700 border-slate-300'
    };
    const stLabels = {
        'pending': tLang('NOVO SA PORTALA', 'NEW FROM PORTAL'), 'open': 'OTVORENO', 'sourced': 'PRONAĐENO', 'closed': 'ZAVRŠENO'
    };

    container.innerHTML = `
    <table class="w-full text-left border-collapse">
        <thead>
            <tr class="bg-slate-50 border-b border-slate-200">
                <th class="p-5 uppercase text-[10px] font-black tracking-widest text-slate-500">${Utils.t('offer.customer') || 'Kupac'}</th>
                <th class="p-5 uppercase text-[10px] font-black tracking-widest text-slate-500">${Utils.t('fields.productName') || 'Proizvod'}</th>
                <th class="p-5 uppercase text-[10px] font-black tracking-widest text-slate-500">${Utils.t('fields.quantity') || 'Količina'}</th>
                <th class="p-5 uppercase text-[10px] font-black tracking-widest text-slate-500">Status</th>
                <th class="p-5 uppercase text-[10px] font-black tracking-widest text-slate-500">${Utils.t('audit.time') || 'Datum'}</th>
                <th class="p-5 text-right uppercase text-[10px] font-black tracking-widest text-slate-500">${Utils.t('misc.offerActionsTable') || 'Akcije'}</th>
            </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
            ${state.data.demands.map(d => {
                const isNewIndicator = d.isNewProduct ? `<span class="bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 text-[9px] rounded-full font-black uppercase ml-2 shadow-sm whitespace-nowrap">✨ ${Utils.t('misc.newTag') || 'NOVO (VAN KATALOGA)'}</span>` : '';
                const isPortalRFQ = (d.source || '').startsWith('B2B Portal');
                const sourceIndicator = isPortalRFQ ? `<span class="bg-indigo-100 text-indigo-800 border border-indigo-300 px-2 py-0.5 text-[9px] rounded-full font-black uppercase ml-2 shadow-sm whitespace-nowrap">🌐 ${d.source === 'B2B Portal Catalog' ? 'CATALOG RFQ' : 'B2B PORTAL'}</span>` : '';
                const bC = stColors[d.status || 'open'] || stColors['open'];
                const bL = stLabels[d.status || 'open'] || (d.status || 'open').toUpperCase();
                const dateVal = d.createdAt || d.date;

                // Ekstra detalji iz portal catalog RFQ-a — Incoterm, destinacija, plaćanje, banka, agent, end-buyer, automation hints
                const incotermBadge = d.incoterm ? `<span class="bg-slate-800 text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider mr-1 shadow-sm">${Utils.escapeHtml(d.incoterm)}</span>` : '';
                const requestorBadge = d.requestor === 'third_party' ? `<span class="bg-purple-100 text-purple-800 border border-purple-300 px-2 py-0.5 text-[9px] rounded-full font-black uppercase ml-1 shadow-sm whitespace-nowrap">👥 FOR 3RD PARTY</span>` : '';
                let extraRow = '';
                if (isPortalRFQ && (d.incoterm || d.destination || d.paymentTerms || d.logisticsAgent || d.endBuyer || (d.autoHints && d.autoHints.length))) {
                    const pill = (label, value, cls) => value ? `<span class="inline-flex items-center gap-1 text-[11px] ${cls || 'bg-slate-50 border-slate-200 text-slate-700'} border rounded-md px-2 py-1"><strong>${label}:</strong> ${Utils.escapeHtml(String(value))}</span>` : '';
                    const hints = (d.autoHints || []).map(h => `<div class="text-[11px] flex items-start gap-1.5 text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-2 py-1"><span>⚡</span><span>${Utils.escapeHtml(h)}</span></div>`).join('');
                    extraRow = `
                    <tr class="bg-slate-50/50 border-t-0">
                      <td colspan="6" class="px-5 py-3">
                        <div class="flex flex-wrap gap-1.5 mb-2">
                          ${pill('Incoterm', d.incoterm, 'bg-blue-50 border-blue-200 text-blue-800')}
                          ${pill('Destination', d.destination)}
                          ${pill('Payment', (d.paymentTerms || '').replace(/_/g, ' '))}
                          ${pill('Bank', d.buyerBank)}
                          ${pill('Agent', d.logisticsAgent)}
                          ${pill('Needed by', d.neededBy)}
                          ${pill('Target', d.targetPrice ? (d.targetPrice + ' ' + (d.currency || '')) : '')}
                          ${d.endBuyer && d.endBuyer.companyName ? pill('End-buyer', d.endBuyer.companyName + (d.endBuyer.country ? ' (' + d.endBuyer.country + ')' : ''), 'bg-purple-50 border-purple-200 text-purple-800') : ''}
                        </div>
                        ${hints ? `<div class="space-y-1 mt-2">${hints}</div>` : ''}
                        ${d.notes ? `<div class="mt-2 text-xs text-slate-600 border-l-2 border-slate-300 pl-2 italic">"${Utils.escapeHtml(d.notes)}"</div>` : ''}
                      </td>
                    </tr>`;
                }

                return `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="p-5 text-sm font-black text-slate-900">🏢 ${Utils.escapeHtml(Utils.getPartnerNameById(d.buyerId || d.customerId) || d.buyerName || tLang('(Nepoznat kupac)', '(Unknown client)'))}${requestorBadge}</td>
                    <td class="p-5 text-sm font-bold text-slate-700">${incotermBadge}${Utils.escapeHtml(d.productName || '')} ${isNewIndicator}${sourceIndicator}</td>
                    <td class="p-5 font-black text-blue-700 text-lg">${Utils.escapeHtml(d.quantity || '')}</td>
                    <td class="p-5"><span class="px-2.5 py-1 rounded text-[10px] font-black uppercase tracking-wider border shadow-sm ${bC}">${bL}</span></td>
                    <td class="p-5 text-xs text-slate-500 font-bold">${dateVal ? new Date(dateVal).toLocaleDateString(currentLang) : 'N/A'}</td>
                    <td class="p-5 text-right whitespace-nowrap">
                        <button class="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold px-4 py-2 rounded-lg text-xs shadow-sm transition-colors mr-2 offer-from-demand" data-id="${d.id}">💱 ${tLang('Kreiraj ponudu', 'Create offer')}</button>
                        <button class="bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold px-4 py-2 rounded-lg text-xs shadow-sm transition-colors mr-2 edit-demand" data-id="${d.id}">✏️ ${Utils.t('actions.edit') || 'Izmeni'}</button>
                        <button class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 font-bold px-4 py-2 rounded-lg text-xs shadow-sm transition-colors del-demand" data-id="${d.id}">🗑️</button>
                    </td>
                </tr>${extraRow}`;
            }).join('') || `<tr><td colspan="6" class="p-10 text-center text-slate-400 font-bold border-dashed border-2 border-slate-200 text-sm">${Utils.t('product_search.noResults') || 'Nema zahteva.'}</td></tr>`}
        </tbody>
    </table>`;
    
    main.appendChild(container);
    container.querySelectorAll('.edit-demand').forEach(b => b.addEventListener('click', e => showDemandForm(e.currentTarget.dataset.id)));
    container.querySelectorAll('.del-demand').forEach(b => b.addEventListener('click', e => Utils.handleDelete('demands', e.currentTarget.dataset.id)));
    container.querySelectorAll('.offer-from-demand').forEach(b => b.addEventListener('click', e => createOfferFromDemand(e.currentTarget.dataset.id)));
}

// AUTOMATIZACIJA: iz zahteva kupca (RFQ) direktno u modal za ponudu, sa
// pred-popunjenim kupcem i (ako je iz kataloga) proizvodom.
function createOfferFromDemand(demandId) {
    const tLang = (srStr, enStr) => Utils.getLang() === 'sr' ? srStr : enStr;
    const demand = (state.data.demands || []).find(d => d.id === demandId);
    if (!demand) return;

    if (typeof showCustomerOfferModal !== 'function') {
        alert(tLang('Modul za ponude nije učitan.', 'Offers module is not loaded.'));
        return;
    }

    const customerId = demand.buyerId || demand.customerId || null;
    const product = demand.productId ? (state.data.products || []).find(p => p.id === demand.productId) : null;

    // Modal za ponudu zahteva proizvod iz kataloga sa bar jednom ponudom dobavljača.
    // Ako je zahtev za robom van kataloga, uputimo korisnika da prvo doda proizvod.
    if (!product || !(product.supplyOffers && product.supplyOffers.length > 0)) {
        alert(tLang(
            'Ova potražnja je za robom van kataloga (ili proizvod nema ponudu dobavljača).\nPrvo dodajte proizvod u katalog (Proizvodi), pa kreirajte ponudu.',
            'This demand is for an off-catalog product (or the product has no supplier offer).\nAdd the product to the catalog (Products) first, then create the offer.'
        ));
        return;
    }

    showCustomerOfferModal({ productId: demand.productId, offerIndex: 0, prefillCustomerId: customerId, prefillQuantity: demand.quantity });
}