// static/js/modules/products/customer_offers.js

function showCustomerOfferModal({productId = null, offerIndex = null, isInventory = false, invIndex = null, savedOfferId = null, prefillCustomerId = null, prefillQuantity = null}) {
    let savedOfferData = {};
    let currentItems = [];

    // Učitavanje postojeće ponude ili kreiranje nove
    if (savedOfferId) {
        savedOfferData = state.data.offers.find(o => o.id === savedOfferId);
        if (!savedOfferData) return;
        
        // Kompatibilnost unazad: Ako stara ponuda ima samo jedan proizvod, pretvaramo ga u niz
        if (savedOfferData.items && savedOfferData.items.length > 0) {
            currentItems = JSON.parse(JSON.stringify(savedOfferData.items));
        } else if (savedOfferData.productId) {
            currentItems.push({
                productId: savedOfferData.productId,
                quantity: savedOfferData.quantity || 1,
                price: savedOfferData.sellingPrice || 0,
                unit: savedOfferData.unit || 'MT',
                isInventory: savedOfferData.isInventory,
                invIndex: savedOfferData.invIndex,
                offerIndex: savedOfferData.offerIndex
            });
        }
    } else {
        const product = state.data.products.find(p => p.id === productId);
        const sourceData = isInventory ? product?.inventory[invIndex] : product?.supplyOffers[offerIndex];
        
        if (!product || !sourceData) {
            alert(Utils.getLang() === 'sr' ? 'Izvorni podaci za ovu ponudu više ne postoje (obrisani su).' : 'Source data for this offer no longer exists (deleted).');
            return;
        }

        currentItems.push({
            productId: product.id,
            quantity: (parseFloat(prefillQuantity) > 0 ? parseFloat(prefillQuantity) : 1),
            price: sourceData.sellingPrice || sourceData.price || sourceData.purchasePrice || 0,
            unit: sourceData.unit || 'MT',
            isInventory: isInventory,
            invIndex: invIndex,
            offerIndex: offerIndex
        });
    }

    let displayOfferNum = savedOfferData.offerNo || (((state.settings.lastOfferNumber || 0) + 1) + '/' + new Date().getFullYear());
    const initialCurrency = savedOfferData.currency || 'USD';
    const isBuyer = (p) => (p.types || []).includes('buyer') || (p.types || []).includes('Kupac');
    const currentLang = Utils.getLang() === 'sr' ? 'sr-RS' : 'en-US';
    const tLang = (srStr, enStr) => Utils.getLang() === 'sr' ? srStr : enStr;
    
    const incotermsList = typeof INCOTERMS !== 'undefined' ? INCOTERMS : ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];

    const datalists = `
      <datalist id="payment-terms-list">
        <option value="100% Avans (Advance)">
        <option value="30% Avans, 70% pre isporuke">
        <option value="100% Neopozivi L/C po viđenju">
        <option value="CAD (Cash Against Documents)">
        <option value="Net 30 Dana">
        <option value="Net 60 Dana">
      </datalist>
      <datalist id="packaging-list">
        <option value="25kg Multi-wall Kraft Paper Bags">
        <option value="25kg PP Woven Bags">
        <option value="50kg PP Woven Bags">
        <option value="1 MT Jumbo Bags (FIBC)">
        <option value="Bulk in 20ft Container">
        <option value="Bulk in 40ft Container">
        <option value="25kg Cartons with inner PE liner">
        <option value="Flexitanks">
        <option value="Palletized and Shrink-wrapped">
      </datalist>
      <datalist id="tax-clause-list">
        <option value="${tLang('Oslobođeno PDV-a (Izvoz)', 'VAT Exempt (Export)')}">
        <option value="Reverse Charge">
        <option value="${tLang('Uključen PDV', 'VAT Included')}">
      </datalist>
    `;
    
    const html = `${datalists}<div id="offer-container" class="p-4 md:p-6">
      <div id="offer-controls" class="crm-form-panel">
          <div class="crm-form-section">
              <h4 class="crm-form-section-title">👤 ${tLang('Osnovni podaci ponude','Offer header')}</h4>
              <p class="crm-form-section-desc">${tLang('Kome se ponuda šalje, u kojoj valuti i do kad važi.','Who the offer is addressed to, in what currency, and how long it is valid.')}</p>
              <div class="crm-form-grid crm-form-grid-4">
                  <div class="crm-field crm-field-span-2">
                      <label class="crm-label crm-label-required">${Utils.t('offer.customer')}</label>
                      <select id="offer-customer-select" class="crm-input">
                          <option value="">${Utils.t('actions.select_buyer')}</option>
                          ${state.data.partners.filter(isBuyer).map(p => `<option value="${p.id}" ${p.id===savedOfferData.customerId?'selected':''}>${Utils.escapeHtml(p.companyName)}</option>`).join('')}
                      </select>
                      <p class="crm-help">${tLang('Partner iz Partners modula (tip Buyer).','Partner from Partners module (Buyer type).')}</p>
                  </div>
                  <div class="crm-field">
                      <label class="crm-label">${Utils.t('fields.currency')}</label>
                      <select id="offer-currency" class="crm-input">
                          ${(typeof CURRENCIES !== 'undefined' ? CURRENCIES : ['USD','EUR','AED']).map(c => `<option value="${c}" ${c===initialCurrency?'selected':''}>${c}</option>`).join('')}
                      </select>
                  </div>
                  <div class="crm-field">
                      <label class="crm-label crm-label-warning">${Utils.t('offer.valid_until')}</label>
                      <input type="date" id="offer-valid-until" class="crm-input crm-input-warning" value="${savedOfferData.validUntil || ''}"/>
                      <p class="crm-help">${tLang('Datum posle koga ponuda ne važi.','Date after which the offer expires.')}</p>
                  </div>
              </div>
          </div>

          <div class="crm-form-section">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                  <div>
                      <h4 class="crm-form-section-title">🛒 ${tLang('Stavke ponude','Offer items')}</h4>
                      <p class="crm-form-section-desc" style="margin-bottom:0;">${tLang('Dodaj jednu ili više roba iz kataloga.','Add one or more products from the catalog.')}</p>
                  </div>
                  <button id="add-item-btn" class="crm-btn crm-btn-ghost" style="min-height:36px;padding:8px 14px;">➕ ${tLang('Dodaj proizvod','Add product')}</button>
              </div>
              <div id="offer-items-list" class="crm-form-grid" style="grid-template-columns:1fr;margin-top:12px;"></div>
              <div id="logistics-calc" class="crm-help" style="margin-top:8px;font-weight:700;"></div>
              <div id="substitutes-warning-container"></div>
          </div>

          <div class="crm-form-section">
              <h4 class="crm-form-section-title">📄 ${tLang('Komercijalni uslovi','Commercial terms')}</h4>
              <p class="crm-form-section-desc">${tLang('Incoterm, poreska klauzula i pakovanje.','Incoterm, tax clause and packaging.')}</p>
              <div class="crm-form-grid crm-form-grid-4">
                  <div class="crm-field">
                      <label class="crm-label">${tLang('Incoterm (paritet)','Incoterm')}</label>
                      <select id="off-incoterm" class="crm-input">
                          <option value="">${tLang('— Izaberi —','— Select —')}</option>
                          ${incotermsList.map(i => `<option value="${i}" ${i === savedOfferData.incoterm ? 'selected' : ''}>${i}</option>`).join('')}
                      </select>
                  </div>
                  <div class="crm-field crm-field-span-2">
                      <label class="crm-label">${tLang('Poreska klauzula', 'Tax clause')}</label>
                      <input id="off-tax-clause" list="tax-clause-list" class="crm-input" value="${Utils.escapeHtml(savedOfferData.taxClause || '')}" placeholder="${tLang('Npr. Oslobođeno PDV-a...', 'e.g. VAT Exempt...')}"/>
                      <p class="crm-help">${tLang('Ako je izuzeto od PDV-a — piše se u PDF-u.','If VAT-exempt — printed on the PDF.')}</p>
                  </div>
                  <div class="crm-field">
                      <label class="crm-label">${Utils.t('offer.packaging')}</label>
                      <input id="off-packaging" list="packaging-list" class="crm-input" value="${Utils.escapeHtml(savedOfferData.packaging || '')}" placeholder="${Utils.t('placeholders.pack')}"/>
                  </div>
              </div>
          </div>

          <div class="crm-form-section transport-section">
              <h4 class="crm-form-section-title">🚢 ${tLang('Logistika','Logistics')}</h4>
              <p class="crm-form-section-desc">${tLang('Port utovara/istovara, prevozno sredstvo, kontejner. Prikazuje se u PDF-u.','Port of loading/discharge, vessel/truck, container. Printed on the PDF.')}</p>
              <div class="crm-form-grid crm-form-grid-4">
                  <div class="crm-field transport-field">
                      <label class="crm-label">${Utils.t('offer.pol')}</label>
                      <input id="off-pol" class="crm-input" value="${Utils.escapeHtml(savedOfferData.pol || '')}" placeholder="${Utils.t('placeholders.pol')}"/>
                      <p class="crm-help">${tLang('Port of Loading — luka polaska.','Port of Loading.')}</p>
                  </div>
                  <div class="crm-field transport-field">
                      <label class="crm-label">${Utils.t('offer.pod')}</label>
                      <input id="off-pod" class="crm-input" value="${Utils.escapeHtml(savedOfferData.pod || '')}" placeholder="${Utils.t('placeholders.pod')}"/>
                      <p class="crm-help">${tLang('Port of Discharge — luka istovara.','Port of Discharge.')}</p>
                  </div>
                  <div class="crm-field transport-field">
                      <label class="crm-label">${tLang('Brod / Kamion', 'Vessel / Truck')}</label>
                      <input id="off-vessel" class="crm-input" value="${Utils.escapeHtml(savedOfferData.vessel || '')}" placeholder="${tLang('Ime broda / reg. kamiona', 'Vessel name / truck plate')}"/>
                  </div>
                  <div class="crm-field transport-field">
                      <label class="crm-label">${tLang('Br. kontejnera', 'Container No.')}</label>
                      <input id="off-container" class="crm-input crm-input-mono" value="${Utils.escapeHtml(savedOfferData.containerNo || '')}" placeholder="e.g. HLBU1234567"/>
                  </div>
                  <div class="crm-field">
                      <label class="crm-label">${Utils.t('offer.leadTime')}</label>
                      <input id="off-lead" class="crm-input" value="${Utils.escapeHtml(savedOfferData.leadTime || '')}" placeholder="${Utils.t('placeholders.lead')}"/>
                  </div>
                  <div class="crm-field crm-field-span-2" style="grid-column:span 3;">
                      <label class="crm-label">${Utils.t('offer.paymentTerms')}</label>
                      <input id="off-pay-terms" list="payment-terms-list" class="crm-input" value="${Utils.escapeHtml(savedOfferData.paymentTerms || '')}" placeholder="${Utils.t('placeholders.pay')}"/>
                      <p class="crm-help">${tLang('Npr. 30% avans, 70% pre otpreme.','e.g. 30% advance, 70% before shipment.')}</p>
                  </div>
              </div>
          </div>

          <div class="crm-form-section crm-form-section-highlighted">
              <h4 class="crm-form-section-title">🏦 ${tLang('Banka za uplatu', 'Payment bank')}</h4>
              <p class="crm-form-section-desc">${tLang('Klijent u PDF-u dobija tačne bank instrukcije za ovu ponudu.','Client gets the exact bank instructions for this offer on the PDF.')}</p>
              <div class="crm-field">
                  <label class="crm-label">${tLang('Kupac plaća na', 'Buyer pays to')}</label>
                  <select id="off-payment-bank" class="crm-input">
                      ${(() => {
                          const banks = (state.company && Array.isArray(state.company.bankAccounts)) ? state.company.bankAccounts : [];
                          if (banks.length === 0) return `<option value="">${tLang('— Nema banaka (dodaj u Podešavanja → Bank Accounts) —', '— No banks configured (add in Settings → Bank Accounts) —')}</option>`;
                          const savedIdx = (savedOfferData.paymentBankIdx == null ? 0 : savedOfferData.paymentBankIdx);
                          return banks.map((b, i) => `<option value="${i}" ${i === savedIdx ? 'selected' : ''}>${Utils.escapeHtml(b.bankName || 'Bank')} — ${Utils.escapeHtml(b.accountNumber || '')} (${Utils.escapeHtml(b.currency || '')})</option>`).join('');
                      })()}
                  </select>
                  <p class="crm-help">${tLang('Bank instrukcije se automatski popune u PDF-u.', 'Bank instructions will auto-fill on the PDF.')}</p>
              </div>
          </div>

          <div class="crm-form-section">
              <h4 class="crm-form-section-title">📝 ${tLang('Napomene', 'Notes')}</h4>
              <div class="crm-field">
                  <label class="crm-label">${Utils.t('offer.specificNotes')}</label>
                  <textarea id="off-notes" class="crm-input" rows="3" placeholder="${tLang('Bilo koja dodatna napomena za kupca.','Any additional notes for the buyer.')}">${Utils.escapeHtml(savedOfferData.notes || state.settings.defaultOfferNotes || Utils.t('offer.default_note'))}</textarea>
              </div>
          </div>

          <div class="crm-form-section">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                  <div>
                      <h4 class="crm-form-section-title">➕ ${Utils.t('offer.additional_services')}</h4>
                      <p class="crm-form-section-desc" style="margin-bottom:0;">${tLang('Dodatne usluge (transport, osiguranje, carinjenje…) — svaka sa cenom.','Extra services (freight, insurance, customs…) — each with a price.')}</p>
                  </div>
                  <button id="add-offer-service-btn" class="crm-btn crm-btn-ghost" style="min-height:36px;padding:8px 14px;">+ ${Utils.t('actions.addService')}</button>
              </div>
              <div id="offer-services-list" style="margin-top:12px;display:flex;flex-direction:column;gap:10px;">
                  ${(savedOfferData.services || []).map(s => `<div class="crm-input-pair off-svc-item"><input class="crm-input svc-name" value="${Utils.escapeHtml(s.name)}" placeholder="${Utils.t('offer.service_name') || 'Service name'}"/><input type="number" step="0.01" min="0" class="crm-input crm-input-suffix svc-price" value="${s.price}" placeholder="0.00" style="width:110px;"/><button type="button" class="crm-btn crm-btn-danger" style="padding:0 12px;min-height:40px;" onclick="this.parentElement.remove(); document.getElementById('offer-currency').dispatchEvent(new Event('change'));">✕</button></div>`).join('')}
              </div>
          </div>

          <div class="crm-form-actions">
              <button id="save-offer-btn" class="crm-btn crm-btn-success">💾 ${Utils.t('offer.saveOfferBtn')}</button>
              <button id="preview-offer-btn" class="crm-btn crm-btn-ghost" title="${tLang('Isti PDF koji će klijent videti u portalu', 'Same PDF the client will see in the portal')}">👁️ ${tLang('Pregled PDF-a', 'Preview PDF')}</button>
              <button id="print-offer-btn" class="crm-btn crm-btn-primary">🖨️ ${tLang('Sačuvaj i preuzmi PDF', 'Save & Download')}</button>
              <button id="email-offer-btn" class="crm-btn crm-btn-primary" style="background:#4f46e5;">📧 ${tLang('Pošalji mail', 'Send email')}</button>
          </div>
      </div>
      
      <div id="offer-body" class="p-10 bg-white text-slate-800 shadow-md rounded-2xl border border-slate-200 relative overflow-hidden">
        <header class="flex justify-between items-start mb-10 border-b border-slate-200 pb-6 relative z-10">
            <div><h1 class="text-4xl font-black uppercase text-slate-900 tracking-wider">${Utils.t('offer.firmOffer')}</h1></div>
            <div class="text-sm">
                <table class="text-right">
                    <tr><td class="pr-4 font-bold text-slate-500 uppercase tracking-widest text-[10px]">${Utils.t('offer.offer_no')}:</td><td class="font-black text-xl text-slate-900" id="preview-offer-no">${displayOfferNum}</td></tr>
                    <tr><td class="pr-4 font-bold text-slate-500 uppercase tracking-widest text-[10px]">${Utils.t('invoice.date_of_issue')}:</td><td class="font-bold text-slate-700">${savedOfferData.date ? new Date(savedOfferData.date).toLocaleDateString(currentLang) : new Date().toLocaleDateString(currentLang)}</td></tr>
                    <tr id="offer-valid-row" class="hidden"><td class="pr-4 font-bold text-slate-500 uppercase tracking-widest text-[10px]">${Utils.t('offer.valid_until')}:</td><td id="offer-display-valid" class="font-black text-red-600 bg-red-50 px-2 py-0.5 rounded"></td></tr>
                </table>
            </div>
        </header>
        
        <section class="invoice-parties mb-10">
            <div id="offer-customer-details" class="bg-slate-50 p-6 border border-slate-200 rounded-xl">
                <h4 class="font-black mb-3 text-slate-500 uppercase tracking-widest text-[10px]">${Utils.t('invoice.to')}:</h4>
                <p class="italic text-slate-400 font-bold">${Utils.t('offer.select_customer')}</p>
            </div>
        </section>
        
        <h3 class="text-lg font-black mb-4 text-slate-900 uppercase tracking-widest flex items-center gap-3"><span class="bg-blue-100 text-blue-800 w-6 h-6 flex items-center justify-center rounded-full text-xs font-black">1</span> ${Utils.t('offer.product_specs')}</h3>
        <div id="preview-specs-container"></div>
        
        <h3 class="text-lg font-black mb-4 mt-10 text-slate-900 uppercase tracking-widest flex items-center gap-3"><span class="bg-blue-100 text-blue-800 w-6 h-6 flex items-center justify-center rounded-full text-xs font-black">2</span> Logistics & Payment</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-6 mb-10 text-sm bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div><strong class="block text-[10px] text-slate-400 uppercase tracking-widest mb-1">Incoterm:</strong> <span id="disp-off-incoterm" class="font-black text-slate-900"></span></div>
            <div><strong class="block text-[10px] text-slate-400 uppercase tracking-widest mb-1">${Utils.t('offer.packaging')}:</strong> <span id="disp-off-packaging" class="font-bold text-slate-700"></span></div>
            <div><strong class="block text-[10px] text-slate-400 uppercase tracking-widest mb-1">${Utils.t('offer.leadTime')}:</strong> <span id="disp-off-lead" class="font-bold text-slate-700"></span></div>
            <div><strong class="block text-[10px] text-slate-400 uppercase tracking-widest mb-1">${tLang('Poreska Klauzula', 'Tax Clause')}:</strong> <span id="disp-off-tax-clause" class="font-bold text-slate-700"></span></div>

            <div class="disp-transport"><strong class="block text-[10px] text-slate-400 uppercase tracking-widest mb-1">${Utils.t('offer.pol')}:</strong> <span id="disp-off-pol" class="font-bold text-slate-700"></span></div>
            <div class="disp-transport"><strong class="block text-[10px] text-slate-400 uppercase tracking-widest mb-1">${Utils.t('offer.pod')}:</strong> <span id="disp-off-pod" class="font-bold text-slate-700"></span></div>
            <div class="disp-transport"><strong class="block text-[10px] text-slate-400 uppercase tracking-widest mb-1">${tLang('Brod/Kamion', 'Vessel/Truck')}:</strong> <span id="disp-off-vessel" class="font-bold text-slate-700"></span></div>
            <div class="disp-transport"><strong class="block text-[10px] text-slate-400 uppercase tracking-widest mb-1">${tLang('Kontejner', 'Container')}:</strong> <span id="disp-off-container" class="font-bold text-slate-700"></span></div>
            
            <div class="col-span-2 md:col-span-4 mt-2 border-t border-slate-100 pt-4 flex flex-col"><strong class="block text-[10px] text-slate-400 uppercase tracking-widest mb-1">${Utils.t('offer.paymentTerms')}:</strong> <span id="disp-off-pay-terms" class="text-slate-900 font-black text-lg"></span></div>
        </div>
        
        <h3 class="text-lg font-black mb-4 mt-10 text-slate-900 uppercase tracking-widest flex items-center gap-3"><span class="bg-blue-100 text-blue-800 w-6 h-6 flex items-center justify-center rounded-full text-xs font-black">3</span> Financials</h3>
        <table class="w-full text-left mb-8 border-collapse shadow-sm rounded-xl overflow-hidden border border-slate-200">
          <thead>
              <tr class="bg-slate-100 text-slate-700">
                  <th class="p-4 uppercase text-[10px] font-black tracking-widest">${Utils.t('invoice.description')}</th>
                  <th class="p-4 uppercase text-[10px] font-black tracking-widest text-right">${Utils.t('invoice.quantity')}</th>
                  <th class="p-4 uppercase text-[10px] font-black tracking-widest text-right">${Utils.t('invoice.unit_price')}</th>
                  <th class="p-4 uppercase text-[10px] font-black tracking-widest text-right">${Utils.t('invoice.total')}</th>
              </tr>
          </thead>
          <tbody id="offer-table-body" class="bg-white"></tbody>
        </table>
        
        <section class="flex justify-end bg-slate-50 p-6 rounded-xl border border-slate-200">
          <table class="w-full md:w-1/2">
              <tr class="font-black text-3xl text-slate-900">
                  <td class="p-2 pt-2 uppercase tracking-widest text-sm text-slate-500 border-t border-slate-300">${Utils.t('invoice.grand_total')}:</td>
                  <td class="text-right p-2 pt-2 border-t border-slate-300" id="offer-grand-total"></td>
              </tr>
          </table>
        </section>
        
        <div class="mt-12 bg-amber-50 p-6 rounded-xl border border-amber-200"><h4 class="font-black text-amber-800 uppercase tracking-widest text-[10px] mb-3 flex items-center gap-2">⚠️ ${Utils.t('invoice.remarks')}</h4><p id="disp-off-notes" class="text-sm font-bold text-amber-900 whitespace-pre-wrap leading-relaxed"></p></div>
      </div>
    </div>`;
    
    Utils.openModal(Utils.t('offer.generate'), html, null);
    
    const mBody = document.getElementById('modal-body');
    if(mBody) { mBody.classList.remove('p-6'); mBody.classList.add('p-0', 'bg-slate-50'); }
    
    const oldClose = window.closeModal;
    window.closeModal = function() {
        if(mBody) { mBody.classList.add('p-6'); mBody.classList.remove('p-0', 'bg-slate-50'); }
        oldClose();
        window.closeModal = oldClose; 
    };

    const curInp = document.getElementById('offer-currency');
    const custSel = document.getElementById('offer-customer-select'); 

    // RENDEROVANJE STAVKI (ITEMS)
    function renderItemsList() {
        const list = document.getElementById('offer-items-list');
        const curr = curInp.value;
        
        list.innerHTML = currentItems.map((item, idx) => {
            const p = state.data.products.find(x => x.id === item.productId);
            const source = item.isInventory ? p?.inventory[item.invIndex] : p?.supplyOffers[item.offerIndex];
            const rawBaseCost = source ? (source.price || source.purchasePrice || 0) : 0;
            const sourceUnit = source ? (source.unit || source.priceUnit || item.unit) : item.unit;
            // Konvertuj baseCost iz sourceUnit u item.unit da margin bude realna.
            // Ako konverzija nije moguca (razlicit "kind" jedinica), koristi raw vrednost
            // ali ne racunaj margin (izbegavamo laznu procentualnu vrednost).
            let baseCost = rawBaseCost;
            let baseCostConverted = true;
            if (rawBaseCost > 0 && sourceUnit && sourceUnit !== item.unit) {
                const conv = Utils.convertPricePerUnit(rawBaseCost, sourceUnit, item.unit);
                if (conv !== null) {
                    baseCost = conv;
                } else {
                    baseCostConverted = false;
                }
            }

            // Kalkulacija marže — samo ako smo uspešno normalizovali cenu na item.unit.
            let marginHtml = '';
            if (baseCost > 0 && baseCostConverted) {
                const marginAbs = item.price - baseCost;
                const marginPct = ((item.price - baseCost) / baseCost) * 100;
                const badgeClass = marginPct > 0 ? 'bg-emerald-500 text-white' : (marginPct < 0 ? 'bg-red-500 text-white animate-pulse' : 'bg-slate-500 text-white');
                const sign = marginPct > 0 ? '+' : '';
                marginHtml = `<div class="mt-2 w-full text-right"><span class="text-[10px] font-black uppercase text-slate-400 tracking-widest mr-2">${tLang('Profit', 'Margin')}:</span><span class="px-2 py-0.5 rounded-md text-[10px] font-black shadow-sm ${badgeClass}">${sign}${marginPct.toFixed(2)}% | ${sign}${Utils.formatCurrency(marginAbs, curr)}/${item.unit}</span></div>`;
            }

            return `
            <div class="flex flex-wrap md:flex-nowrap gap-3 items-end p-4 bg-white border border-slate-200 rounded-xl shadow-sm relative transition-all hover:border-blue-300">
                <div class="w-full md:w-5/12">
                    <label class="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">${tLang('Proizvod', 'Product')}</label>
                    <select class="item-sel w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-sm font-bold" data-idx="${idx}">
                        ${state.data.products.map(pr => `<option value="${pr.id}" ${pr.id === item.productId ? 'selected' : ''}>${pr.name}</option>`).join('')}
                    </select>
                </div>
                <div class="w-1/3 md:w-2/12">
                    <label class="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">${Utils.t('fields.quantity')}</label>
                    <input type="number" step="0.01" class="item-qty w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-sm font-black text-slate-800" data-idx="${idx}" value="${item.quantity}">
                </div>
                <div class="w-1/3 md:w-3/12">
                    <label class="block text-[10px] font-black text-blue-600 uppercase tracking-widest mb-1">${Utils.t('offer.your_price')}</label>
                    <input type="number" step="0.01" class="item-price w-full bg-blue-50 border border-blue-300 text-blue-800 rounded-md px-3 py-2 text-sm font-black" data-idx="${idx}" value="${item.price}">
                </div>
                <div class="w-1/4 md:w-1/12">
                    <label class="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">${Utils.t('fields.unit')}</label>
                    <select class="item-unit w-full bg-slate-50 border border-slate-300 rounded-md px-2 py-2 text-xs font-bold" data-idx="${idx}">
                        ${(typeof UNITS !== 'undefined' ? UNITS : ['MT']).map(u => `<option value="${u}" ${u===item.unit?'selected':''}>${u}</option>`).join('')}
                    </select>
                </div>
                <div class="w-full md:w-1/12 text-right">
                    <button type="button" class="item-del bg-red-50 hover:bg-red-100 text-red-600 px-3 py-2 rounded-md font-black border border-red-200 transition-colors w-full" data-idx="${idx}">✕</button>
                </div>
                ${marginHtml}
            </div>`;
        }).join('');

        // Event listeneri za stavke
        document.querySelectorAll('.item-sel').forEach(el => el.addEventListener('change', e => {
            const idx = e.target.dataset.idx;
            const newProdId = e.target.value;
            const np = state.data.products.find(x => x.id === newProdId);
            if(np) {
                const off = np.supplyOffers && np.supplyOffers.length > 0 ? np.supplyOffers[0] : {};
                currentItems[idx].productId = newProdId;
                currentItems[idx].price = off.price || 0;
                currentItems[idx].unit = off.unit || 'MT';
                currentItems[idx].isInventory = false;
                currentItems[idx].offerIndex = 0;
            }
            renderItemsList();
            updateDetails();
        }));
        // KRITIČNO: `input` handler NIKAD ne sme da poziva renderItemsList()
        // jer to re-kreira DOM i uništi cursor u polju u koje korisnik trenutno
        // kuca. Umesto toga ažuriramo samo state i totale (updateDetails).
        // renderItemsList se poziva tek na change (blur), delete ili add.
        document.querySelectorAll('.item-qty').forEach(el => el.addEventListener('input', e => {
            currentItems[e.target.dataset.idx].quantity = parseFloat(e.target.value) || 0;
            updateDetails();
        }));
        document.querySelectorAll('.item-price').forEach(el => el.addEventListener('input', e => {
            currentItems[e.target.dataset.idx].price = parseFloat(e.target.value) || 0;
            updateDetails();
        }));
        document.querySelectorAll('.item-unit').forEach(el => el.addEventListener('change', e => {
            currentItems[e.target.dataset.idx].unit = e.target.value;
            updateDetails();
        }));
        document.querySelectorAll('.item-del').forEach(el => el.addEventListener('click', e => { currentItems.splice(e.target.dataset.idx, 1); renderItemsList(); updateDetails(); }));
    }

    document.getElementById('add-item-btn').addEventListener('click', (e) => {
        e.preventDefault();
        const firstProd = state.data.products[0];
        currentItems.push({
            productId: firstProd ? firstProd.id : '',
            quantity: 1, price: 0, unit: 'MT', isInventory: false, offerIndex: 0
        });
        renderItemsList();
        updateDetails();
    });

    const toggleTransportFields = () => {
        const incoterm = document.getElementById('off-incoterm').value.toUpperCase();
        const isExw = ['EXW', 'FCA'].includes(incoterm);
        
        document.querySelectorAll('.transport-field').forEach(el => {
            el.style.display = isExw ? 'none' : 'block';
            if (isExw) {
                const input = el.querySelector('input');
                if(input) input.value = '';
            }
        });
        document.querySelectorAll('.disp-transport').forEach(el => {
            el.style.display = isExw ? 'none' : 'block';
        });
    };

    const updateDetails = () => {
        const cust = state.data.partners.find(p => p.id === custSel.value);
        if (cust) {
            document.getElementById('offer-customer-details').innerHTML = `<p class="text-xl font-black text-slate-900 uppercase tracking-wide"><strong>${Utils.escapeHtml(cust.companyName)}</strong></p><p class="text-slate-600 font-medium mt-2">${Utils.escapeHtml(cust.address?.street || '')}</p><p class="text-slate-600 font-medium">${Utils.escapeHtml(cust.address?.city || '')}, ${Utils.escapeHtml(cust.address?.zip || '')}</p><p class="text-slate-900 font-black mt-1">${Utils.escapeHtml(cust.address?.country || '')}</p>`;
        }
        
        toggleTransportFields();

        const curr = curInp.value; 
        let baseTotal = 0;
        let servicesTotal = 0;
        
        // Zbirni prikaz logistike i supstituta
        let total20ft = 0, total40ft = 0;
        let subWarnHtml = '';
        let specsHtml = '';

        const tBody = document.getElementById('offer-table-body');
        tBody.innerHTML = '';

        currentItems.forEach(item => {
            const p = state.data.products.find(x => x.id === item.productId);
            if(!p) return;
            
            const itemTotal = item.price * item.quantity;
            baseTotal += itemTotal;

            // Logistika: cap20/cap40 su u tonama (MT). item.unit može biti bilo šta iz UNITS.
            // Konvertujemo qty iz item.unit → MT preko canonical form kroz kg. Ako jedinica
            // nije tezinska (npr. pcs, L, CBM), preskacemo container packing i logujemo warning
            // umesto da izbacimo besmislen broj (npr. 500 pcs / 17 MT).
            const qtyInMt = Utils.toMetricTons(item.quantity, item.unit);
            if (qtyInMt !== null) {
                if (p.logistics?.cap20) total20ft += (qtyInMt / p.logistics.cap20);
                if (p.logistics?.cap40) total40ft += (qtyInMt / p.logistics.cap40);
            }
            
            // Supstituti
            const source = item.isInventory ? p.inventory[item.invIndex] : p.supplyOffers[item.offerIndex];
            if (source && item.quantity > (source.qty || source.quantity || 0)) {
                const subs = state.data.products.filter(sub => sub.id !== p.id && sub.category === p.category);
                if (subs.length > 0) {
                    subWarnHtml += `<div class="mt-3 p-4 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-800 shadow-sm"><strong class="uppercase text-xs flex items-center gap-2 mb-1">⚠️ ${tLang('Manjak na stanju:', 'Low Stock:')} ${p.name}</strong><ul class="list-disc pl-6 font-medium">${subs.map(s => `<li>Alt: ${Utils.escapeHtml(s.name)}</li>`).join('')}</ul></div>`;
                }
            }

            // Tabela
            tBody.insertAdjacentHTML('beforeend', `<tr class="border-b border-slate-200 hover:bg-slate-50"><td class="p-4"><strong class="text-slate-900 text-lg">${Utils.escapeHtml(p.name)}</strong></td><td class="p-4 text-right font-black text-slate-800">${item.quantity} ${item.unit}</td><td class="p-4 text-right font-black text-slate-800">${Utils.formatCurrency(item.price, curr)}</td><td class="p-4 text-right font-black text-slate-900 text-xl">${Utils.formatCurrency(itemTotal, curr)}</td></tr>`);

            // Specs Preview
            specsHtml += `
            <div class="mb-6">
                <div class="grid grid-cols-2 md:grid-cols-4 gap-6 text-sm bg-slate-50 p-6 rounded-t-xl border border-slate-200">
                    <div class="col-span-2"><strong class="block text-[10px] text-slate-400 uppercase tracking-widest mb-1">${Utils.t('fields.productName')}:</strong> <span class="text-lg font-black text-slate-900">${Utils.escapeHtml(p.name)}</span></div>
                    <div><strong class="block text-[10px] text-slate-400 uppercase tracking-widest mb-1">${Utils.t('fields.hsCode')}:</strong> <span class="font-bold text-slate-700 font-mono">${Utils.escapeHtml(p.hsCode || 'N/A')}</span></div>
                    <div><strong class="block text-[10px] text-slate-400 uppercase tracking-widest mb-1">${Utils.t('fields.origin')}:</strong> <span class="font-bold text-slate-700">${Utils.escapeHtml(source?.country || source?.location || 'N/A')}</span></div>
                </div>
                ${p.coaParams && p.coaParams.length > 0 ? `<div class="text-sm bg-blue-50/50 p-4 border-x border-slate-200"><div class="grid grid-cols-2 gap-3">${p.coaParams.map(c => `<div><span class="font-black text-slate-500 uppercase text-[10px] tracking-widest">${Utils.escapeHtml(c.name)}:</span> <span class="font-bold text-slate-900 ml-2">${Utils.escapeHtml(c.value)}</span></div>`).join('')}</div></div>` : ''}
                ${p.detailedSpec ? `<div class="text-sm bg-white p-4 border-x border-b border-slate-200 rounded-b-xl"><p class="whitespace-pre-wrap font-medium text-slate-700 leading-relaxed text-xs">${Utils.escapeHtml(p.detailedSpec)}</p></div>` : '<div class="border-b border-slate-200 rounded-b-xl"></div>'}
            </div>`;
        });

        document.getElementById('preview-specs-container').innerHTML = specsHtml;
        
        let logMsg = '';
        if (total20ft > 0 || total40ft > 0) {
            logMsg = `📦 <span class="uppercase tracking-widest text-[10px] text-slate-400 mr-2">${tLang('Ukupan kontejnerski zahtev:', 'Total Container Load:')}</span> `;
            if(total20ft > 0) logMsg += `<span class="${!Number.isInteger(total20ft) ? 'text-orange-700 bg-orange-100' : 'text-emerald-700 bg-emerald-100'} px-2 py-0.5 rounded font-black border border-transparent shadow-sm">${total20ft.toFixed(2)} x 20'ft</span> `;
            if(total40ft > 0) logMsg += ` <span class="${!Number.isInteger(total40ft) ? 'text-orange-700 bg-orange-100' : 'text-emerald-700 bg-emerald-100'} px-2 py-0.5 rounded font-black border border-transparent shadow-sm">${total40ft.toFixed(2)} x 40'ft</span>`;
        }
        document.getElementById('logistics-calc').innerHTML = logMsg;
        document.getElementById('substitutes-warning-container').innerHTML = subWarnHtml;

        document.getElementById('disp-off-incoterm').innerText = document.getElementById('off-incoterm').value || 'TBA';
        document.getElementById('disp-off-tax-clause').innerText = document.getElementById('off-tax-clause').value || 'N/A';
        document.getElementById('disp-off-packaging').innerText = document.getElementById('off-packaging').value || 'N/A';
        document.getElementById('disp-off-pol').innerText = document.getElementById('off-pol').value || 'N/A';
        document.getElementById('disp-off-pod').innerText = document.getElementById('off-pod').value || 'N/A';
        document.getElementById('disp-off-vessel').innerText = document.getElementById('off-vessel').value || 'N/A';
        document.getElementById('disp-off-container').innerText = document.getElementById('off-container').value || 'N/A';
        document.getElementById('disp-off-lead').innerText = document.getElementById('off-lead').value || 'N/A';
        document.getElementById('disp-off-pay-terms').innerText = document.getElementById('off-pay-terms').value || 'TBA';
        document.getElementById('disp-off-notes').innerHTML = Utils.escapeHtml(document.getElementById('off-notes').value).replace(/\n/g, '<br>');
        
        document.querySelectorAll('.off-svc-item').forEach(el => {
           const sName = el.querySelector('.svc-name').value; const sPrice = parseFloat(el.querySelector('.svc-price').value) || 0;
           if(sName && sPrice > 0) {
                servicesTotal += sPrice;
                tBody.insertAdjacentHTML('beforeend', `<tr class="border-b border-slate-100 bg-slate-50"><td class="p-4 font-bold text-slate-700">${Utils.escapeHtml(sName)}</td><td class="p-4 text-right font-bold text-slate-700">1</td><td class="p-4 text-right font-bold text-slate-700">${Utils.formatCurrency(sPrice, curr)}</td><td class="p-4 text-right font-black text-slate-900">${Utils.formatCurrency(sPrice, curr)}</td></tr>`);
            }
        });
        
        document.getElementById('offer-grand-total').innerText = Utils.formatCurrency(baseTotal + servicesTotal, curr);
        
        const validInp = document.getElementById('offer-valid-until');
        if(validInp.value) {
            document.getElementById('offer-valid-row').classList.remove('hidden');
            document.getElementById('offer-display-valid').innerText = new Date(validInp.value).toLocaleDateString(currentLang);
        } else {
            document.getElementById('offer-valid-row').classList.add('hidden');
        }
    };

    // ZAŠTIĆENO ČUVANJE (Preuzima i fiksira broj)
    async function saveOfferToDB() {
        const custId = custSel.value;
        if (!custId) { alert(Utils.t('misc.selectCustomerAlert')); return false; }
        if (currentItems.length === 0) { alert(tLang('Dodajte barem jedan proizvod.', 'Add at least one product.')); return false; }
        
        if (!savedOfferId) {
            state.settings.lastOfferNumber = (state.settings.lastOfferNumber || 0) + 1;
            displayOfferNum = state.settings.lastOfferNumber + '/' + new Date().getFullYear();
            await saveToStorage('settings');
            document.getElementById('preview-offer-no').innerText = displayOfferNum;
        }

        const svcs = [];
        document.querySelectorAll('.off-svc-item').forEach(el => {
            const sName = el.querySelector('.svc-name').value; const sPrice = parseFloat(el.querySelector('.svc-price').value) || 0;
            if(sName && sPrice > 0) svcs.push({name: sName, price: sPrice});
        });
        
        const offerObj = {
            id: savedOfferId || Utils.generateId(),
            offerNo: displayOfferNum,
            date: savedOfferData.date || new Date().toISOString(),
            validUntil: document.getElementById('offer-valid-until').value,
            customerId: custId,
            items: currentItems, 
            productId: currentItems[0].productId, // Zadržano zbog kompatibilnosti
            quantity: currentItems[0].quantity,
            sellingPrice: currentItems[0].price,
            unit: currentItems[0].unit,
            currency: curInp.value,
            incoterm: document.getElementById('off-incoterm').value,
            taxClause: document.getElementById('off-tax-clause').value,
            packaging: document.getElementById('off-packaging').value,
            pol: document.getElementById('off-pol').value,
            pod: document.getElementById('off-pod').value,
            vessel: document.getElementById('off-vessel').value,
            containerNo: document.getElementById('off-container').value,
            leadTime: document.getElementById('off-lead').value,
            paymentTerms: document.getElementById('off-pay-terms').value,
            notes: document.getElementById('off-notes').value,
            services: svcs,
            ownerId: savedOfferData.ownerId || state.user?.id || 'SYSTEM',
            sharedWith: savedOfferData.sharedWith || []
        };

        // === PAYMENT BANK AUTO-FILL ===
        // Ako je admin izabrao banku iz dropdown-a, generišemo bankDetails string
        // koji server-side PDF generator preuzima direktno. Ovim se garantuje da
        // ono što admin izabere ovde bude tačno ono što klijent vidi u PDF-u i
        // na koji račun uplaćuje. Rešava klasu bagova gde je admin ručno pisao
        // instrukcije i mešao valute/računa.
        const bankSelEl = document.getElementById('off-payment-bank');
        if (bankSelEl && bankSelEl.value !== '' && state.company && Array.isArray(state.company.bankAccounts)) {
            const idx = parseInt(bankSelEl.value, 10);
            const bank = state.company.bankAccounts[idx];
            if (bank) {
                offerObj.paymentBankIdx = idx;
                const bd = [];
                if (bank.bankName)      bd.push(`Bank: ${bank.bankName}`);
                if (bank.bankAddress)   bd.push(bank.bankAddress);
                if (bank.accountNumber) bd.push(`IBAN / Account: ${bank.accountNumber}`);
                if (bank.swiftCode)     bd.push(`SWIFT / BIC: ${bank.swiftCode}`);
                if (bank.correspondentBank) bd.push(`Correspondent bank: ${bank.correspondentBank}`);
                if (bank.currency)      bd.push(`Currency: ${bank.currency}`);
                offerObj.bankDetails = bd.join('\n');
            }
        } else if (savedOfferData.bankDetails) {
            // Sačuvaj postojeći manual bankDetails ako korisnik nije birao iz dropdown-a
            offerObj.bankDetails = savedOfferData.bankDetails;
            if (savedOfferData.paymentBankIdx != null) offerObj.paymentBankIdx = savedOfferData.paymentBankIdx;
        }
        
        if (!state.data.offers) state.data.offers = [];
        if (savedOfferId) {
            state.data.offers[state.data.offers.findIndex(o => o.id === savedOfferId)] = offerObj;
        } else {
            state.data.offers.push(offerObj);
            savedOfferId = offerObj.id; // Fiksiramo ID
            savedOfferData = offerObj;
        }
        await saveSingleItem('offers', offerObj);

        // V23.1 #6 — Register offer in Book of Documents (Knjiga izdatih dokumenata).
        // Postojeci offerNo ostaje "1/2026" format za backward-compat, ali sada
        // paralelno registrujemo i formal docNumber (OFF-2026-00001) sa V-suffixom.
        // Ako se ponuda edituje ponovo, backend bumpuje reviziju (V2, V3...).
        try {
            const csrfTok = (document.cookie.match(/csrf_token=([^;]+)/) || [])[1] || '';
            const r = await fetch('/api/documents/register-existing/offer/' + encodeURIComponent(offerObj.id), {
                method: 'POST',
                headers: {'Content-Type':'application/json', 'X-CSRF-Token': csrfTok},
                body: JSON.stringify({ change_reason: savedOfferId ? 'Edit via existing offer form' : 'New offer' })
            });
            if (r.ok) {
                const j = await r.json();
                if (j.docNumber) {
                    offerObj.docNumber = j.docNumber;
                    offerObj.versionLabel = j.versionLabel;
                    offerObj.revision = j.revision;
                    // Update state u memoriji
                    const idx = state.data.offers.findIndex(o => o.id === offerObj.id);
                    if (idx >= 0) state.data.offers[idx] = offerObj;
                }
            }
        } catch (_regErr) {
            // Best-effort — offer je vec sačuvan, registracija se moze naknadno pokrenuti
            console.warn('Doc register hook failed:', _regErr);
        }

        // NAPOMENA: Auto-slanje PDF-a klijentu je NAMERNO uklonjeno.
        // Save samo čuva ponudu u bazi. Da bi klijent dobio dokument, admin mora
        // EKSPLICITNO da klikne '📤 Pošalji klijentu' u tabeli ponuda. Time se
        // izbegava rizik da klijent u portalu vidi verziju pre nego što je admin
        // proverio i odobrio konačan izgled i podatke.
        //
        // Ako želiš da pregledaš PDF pre slanja, koristi dugme '🔍 Pregled PDF'.

        if (typeof renderOffersView === 'function' && document.getElementById('offers-container-marker')) renderOffersView();
        return true;
    }

    // GENERISANJE PDF PODATAKA
    function buildPdfData() {
        const curr = curInp.value;
        let baseTotal = 0;
        let servicesTotal = 0;
        
        const pdfItems = currentItems.map(item => {
            const p = state.data.products.find(x => x.id === item.productId);
            const total = item.price * item.quantity;
            baseTotal += total;
            return { 
                desc: p ? p.name : 'Unknown', 
                hsCode: p ? (p.hsCode || '') : '',
                qty: item.quantity, 
                unit: item.unit, 
                price: item.price, 
                total: total 
            };
        });

        document.querySelectorAll('.off-svc-item').forEach(el => {
            const sName = el.querySelector('.svc-name').value; 
            const sPrice = parseFloat(el.querySelector('.svc-price').value) || 0;
            if(sName && sPrice > 0) {
                servicesTotal += sPrice;
                pdfItems.push({desc: sName, hsCode: '', qty: 1, unit: 'srv', price: sPrice, total: sPrice});
            }
        });
        
        let specCombined = '';
        currentItems.forEach(item => {
            const p = state.data.products.find(x => x.id === item.productId);
            if(p) {
                specCombined += `\n--- ${p.name} ---\n`;
                if(p.detailedSpec) specCombined += p.detailedSpec + '\n';
                if(p.coaParams && p.coaParams.length > 0) specCombined += 'COA:\n' + p.coaParams.map(c => `- ${c.name}: ${c.value}`).join('\n') + '\n';
            }
        });
        
        return {
            type: 'offer',
            documentNo: displayOfferNum,
            date: savedOfferData.date || new Date().toISOString(),
            validUntil: document.getElementById('offer-valid-until').value,
            customer: state.data.partners.find(p => p.id === custSel.value),
            productName: currentItems.length > 1 ? 'Multiple Commodities' : (state.data.products.find(x => x.id === currentItems[0].productId)?.name || ''),
            hsCode: 'N/A', // Ostavljeno kao fallback, koristi se unutar items za svaki posebno
            detailedSpec: specCombined.trim(),
            currency: curr,
            logistics: {
                origin: 'Various',
                incoterm: document.getElementById('off-incoterm').value || 'TBA',
                pol: document.getElementById('off-pol').value || 'N/A',
                pod: document.getElementById('off-pod').value || 'N/A',
                vessel: document.getElementById('off-vessel').value || 'N/A',
                containerNo: document.getElementById('off-container').value || 'N/A',
                packaging: document.getElementById('off-packaging').value || 'N/A',
                leadTime: document.getElementById('off-lead').value || 'N/A',
                paymentTerms: document.getElementById('off-pay-terms').value || 'N/A'
            },
            taxClause: document.getElementById('off-tax-clause').value || '',
            items: pdfItems,
            subtotal: baseTotal + servicesTotal,
            vat: 0,
            grandTotal: baseTotal + servicesTotal,
            bankDetails: '', 
            notes: document.getElementById('off-notes').value
        };
    }

    document.getElementById('off-incoterm').addEventListener('change', updateDetails);
    custSel.addEventListener('change', updateDetails); 
    curInp.addEventListener('change', updateDetails); 
    document.getElementById('offer-valid-until').addEventListener('change', updateDetails);
    document.querySelectorAll('#off-packaging, #off-tax-clause, #off-pol, #off-pod, #off-vessel, #off-container, #off-lead, #off-pay-terms, #off-notes').forEach(el => el.addEventListener('input', updateDetails));
    
    document.getElementById('add-offer-service-btn').addEventListener('click', (e) => {
       e.preventDefault();
       const id = Date.now();
       document.getElementById('offer-services-list').insertAdjacentHTML('beforeend', `<div class="flex gap-3 off-svc-item" id="off-svc-${id}"><input class="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500 svc-name" placeholder="${Utils.t('offer.service_name')}"><input type="number" step="0.01" class="w-32 bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm font-bold text-slate-800 outline-none focus:border-blue-500 svc-price" placeholder="${Utils.t('fields.price')}"><button class="bg-red-50 text-red-600 border border-red-200 hover:bg-red-600 hover:text-white px-3 rounded-lg font-black transition-colors" type="button" onclick="this.parentElement.remove(); document.getElementById('offer-currency').dispatchEvent(new Event('change'));">✕</button></div>`);
       document.querySelectorAll('.svc-name, .svc-price').forEach(el => el.addEventListener('input', updateDetails));
    });
    
    document.getElementById('save-offer-btn').addEventListener('click', async (e) => {
        e.preventDefault();
        const success = await saveOfferToDB();
        if (success) alert(tLang('Ponuda je uspešno sačuvana.', 'Offer saved successfully.'));
    });
    
    // PREVIEW — otvara identičan PDF koji će klijent videti u portalu, u iframe modalu.
    // Ne skida fajl na disk, samo pregled. Ide preko istog server-side ReportLab-a.
    const previewBtn = document.getElementById('preview-offer-btn');
    if (previewBtn) previewBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const originalText = previewBtn.innerHTML;
        previewBtn.innerHTML = `⏳ ${tLang('PRIPREMA...', 'PREPARING...')}`;
        previewBtn.disabled = true;
        const saved = await saveOfferToDB();
        if (!saved) { previewBtn.innerHTML = originalText; previewBtn.disabled = false; return; }
        try {
            const currentOffer = state.data.offers.find(o => o.offerNo === displayOfferNum || o.id === (savedOfferData && savedOfferData.id));
            if (!currentOffer) throw new Error('Saved offer not found');
            if (typeof showLoader === 'function') showLoader(tLang('Priprema pregleda…', 'Preparing preview…'));
            const res = await fetch('/api/offers/preview_pdf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currentOffer)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            // Otvori modal sa iframe (isto kao portal preview)
            openModal(tLang('Pregled PDF-a (isto kao u portalu)', 'PDF Preview (same as in portal)'),
                `<div class="p-2 bg-slate-100">
                  <iframe src="${url}" class="w-full rounded-lg border border-slate-300 bg-white" style="height: 75vh; min-height: 500px;" title="Offer PDF preview"></iframe>
                  <div class="mt-2 flex items-center justify-between text-xs text-slate-600 px-1">
                    <span>${tLang('Ovaj PDF je identičan onom koji klijent vidi u portalu.', 'This PDF is identical to what the client sees in the portal.')}</span>
                    <a href="${url}" download="Offer_${displayOfferNum.replace(/\//g,'_')}.pdf" class="text-blue-600 hover:underline font-semibold">${tLang('Preuzmi', 'Download')} ↓</a>
                  </div>
                </div>`, null);
            // Očisti blob URL kada se modal zatvori (posle 5min automatski)
            setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
        } catch (err) {
            if (typeof showToast === 'function') showToast('Preview failed: ' + err.message, 'error');
        } finally {
            if (typeof hideLoader === 'function') hideLoader();
            previewBtn.innerHTML = originalText;
            previewBtn.disabled = false;
        }
    });

    document.getElementById('print-offer-btn').addEventListener('click', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('print-offer-btn');
        const originalText = btn.innerHTML;
        btn.innerHTML = `⏳ ${tLang('GENERIŠEM PDF...', 'GENERATING PDF...')}`;
        btn.disabled = true;

        // Uvek prvo snimimo — server-side PDF čita iz baze da bi generisao istu
        // stvar koju klijent vidi u portalu (ista ReportLab funkcija za oba).
        const saved = await saveOfferToDB();
        if (!saved) { btn.innerHTML = originalText; btn.disabled = false; return; }

        try {
            // Uzmi TREUTNI zapis ponude iz state-a (nakon što je saveOfferToDB
            // ažurirao id) i pošalji ga u preview endpoint. Portal koristi
            // identičan build_offer_pdf() nad istim zapisom pa je izlaz identičan.
            const currentOffer = state.data.offers.find(o => o.offerNo === displayOfferNum || o.id === (savedOfferData && savedOfferData.id));
            if (!currentOffer) throw new Error('Saved offer not found in state');
            const res = await fetch('/api/offers/preview_pdf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currentOffer)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Offer_${displayOfferNum.replace(/\//g,'_')}.pdf`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            if (typeof showToast === 'function') showToast(tLang('PDF preuzet.', 'PDF downloaded.'), 'success');
        } catch (err) {
            // Fallback na client-side jsPDF (u slučaju da server PDF nije dostupan)
            if (typeof generateNativePDF === 'function') {
                const filename = `Offer_${displayOfferNum.replace(/\//g,'_')}.pdf`;
                await generateNativePDF(buildPdfData(), filename, 'download');
            } else {
                if (typeof showToast === 'function') showToast('PDF generation failed: ' + err.message, 'error');
            }
        }

        btn.innerHTML = originalText;
        btn.disabled = false;
    });

    document.getElementById('email-offer-btn').addEventListener('click', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('email-offer-btn');
        const originalText = btn.innerHTML;
        btn.innerHTML = `⏳ ${tLang('PRIPREMA...', 'PREPARING...')}`;
        btn.disabled = true;

        // UVIJEK SAČUVAJ PRIJE SLANJA E-MAILA
        const saved = await saveOfferToDB();
        if (!saved) { btn.innerHTML = originalText; btn.disabled = false; return; }

        const filename = `Offer_${displayOfferNum.replace(/\//g,'_')}.pdf`;
        if(typeof generateNativePDF === 'function') {
            // Slanje komande 'send' pokreće Comms.showSendModal iz tvog pdf_generator.js fajla
            await generateNativePDF(buildPdfData(), filename, 'send'); 
        } else alert("PDF module not loaded.");

        btn.innerHTML = originalText;
        btn.disabled = false;
    });
    
    renderItemsList();
    updateDetails();

    // AUTOMATIZACIJA: ako je modal otvoren iz potražnje (RFQ), pred-popuni kupca.
    if (prefillCustomerId && custSel) {
        const hasOption = Array.from(custSel.options).some(o => o.value === prefillCustomerId);
        if (hasOption) {
            custSel.value = prefillCustomerId;
            custSel.dispatchEvent(new Event('change'));
        }
    }
}

function renderOffersView() {
    const main = document.getElementById('main-content'); 
    if(!main) return;
    main.innerHTML = '';
    const header = Utils.createViewHeader(Utils.t('misc.savedOffersTitle') || 'Sačuvane Ponude', '', null); 
    if (header.querySelector('button')) header.querySelector('button').remove(); 
    main.appendChild(header);
    
    if (!state.data.offers) state.data.offers = [];
    const currentLang = Utils.getLang() === 'sr' ? 'sr-RS' : 'en-US';
    const container = document.createElement('div'); 
    container.id = 'offers-container-marker';
    container.className = 'bg-white rounded-2xl shadow-xl border border-slate-200 overflow-x-auto mt-6 mb-10';
    
    container.innerHTML = `
    <table class="w-full text-left border-collapse">
        <thead>
            <tr class="border-b border-slate-200 bg-slate-50 text-slate-500">
              <th class="p-5 uppercase text-[10px] font-black tracking-widest">${Utils.t('misc.offerNoTable') || 'Broj Ponude'}</th>
              <th class="p-5 uppercase text-[10px] font-black tracking-widest">${Utils.t('misc.offerDateTable') || 'Datum'}</th>
              <th class="p-5 uppercase text-[10px] font-black tracking-widest">${Utils.t('misc.offerCustomerTable') || 'Kupac'}</th>
              <th class="p-5 uppercase text-[10px] font-black tracking-widest">${Utils.t('misc.offerProductTable') || 'Proizvod'}</th>
              <th class="p-5 uppercase text-[10px] font-black tracking-widest">${Utils.t('misc.offerValueTable') || 'Vrednost'}</th>
              <th class="p-5 text-right uppercase text-[10px] font-black tracking-widest">${Utils.t('misc.offerActionsTable') || 'Akcije'}</th>
            </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
            ${state.data.offers.map(offer => {
                let prodName = '';
                let totalVal = 0;
                
                if (offer.items && offer.items.length > 0) {
                    prodName = offer.items.length > 1 ? `Multiple (${offer.items.length})` : Utils.getProductNameById(offer.items[0].productId);
                    totalVal = offer.items.reduce((s, i) => s + (i.price * i.quantity), 0) + (offer.services || []).reduce((s, c) => s + c.price, 0);
                } else {
                    prodName = Utils.getProductNameById(offer.productId);
                    totalVal = (offer.sellingPrice * offer.quantity) + (offer.services || []).reduce((s, c) => s + c.price, 0);
                }

                const custName = Utils.getPartnerNameById(offer.customerId);
                const canConvert = (typeof hasPerm === 'function') ? hasPerm('offers_to_deal', 'view') || (state.user && state.user.permissions && state.user.permissions.offers_to_deal) : true;
                const canForce = (typeof hasPerm === 'function') ? (state.user && (state.user.role === 'admin' || (state.user.permissions && state.user.permissions.offers_to_deal_force))) : true;
                const clientAccepted = offer.clientStatus === 'accepted';
                const converted = !!offer.convertedDealId;

                let statusBadge = '';
                if (converted) statusBadge = `<span class="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200 font-semibold ml-2">→ DEAL</span>`;
                else if (clientAccepted) statusBadge = `<span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 font-semibold ml-2">✓ ACCEPTED</span>`;
                else if (offer.clientStatus === 'declined') statusBadge = `<span class="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-200 font-semibold ml-2">✕ DECLINED</span>`;
                // Ako admin još nije pregledao klijentov odgovor, dodaj upozorenje pill.
                if ((offer.clientStatus === 'accepted' || offer.clientStatus === 'declined') && offer.adminReviewedByClient === false) {
                    statusBadge += `<span class="text-[9px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 font-bold uppercase tracking-wider ml-1 animate-pulse">NEW</span>`;
                }

                let convertBtn = '';
                if (!converted && (state.user?.role === 'admin' || (state.user?.permissions && state.user.permissions.offers_to_deal))) {
                    if (clientAccepted) {
                        convertBtn = `<button class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm transition-all mr-2" data-convert-offer="${offer.id}" data-force="false">➜ ${Utils.t('offer.createDeal') || 'Kreiraj dil'}</button>`;
                    } else if (canForce) {
                        convertBtn = `<button class="bg-amber-500 hover:bg-amber-600 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm transition-all mr-2" data-convert-offer="${offer.id}" data-force="true">➜ ${Utils.t('offer.createDealForce') || 'Kreiraj dil (bez portala)'}</button>`;
                    }
                }

                // Razlog odbijanja/potpisa klijenta ispod glavnog reda (ako postoji clientNote ili clientSignature).
                let clientNoteRow = '';
                const hasSig = offer.clientSignature && offer.clientSignature.dataUrl;
                if ((offer.clientNote || hasSig) && (offer.clientStatus === 'declined' || offer.clientStatus === 'accepted')) {
                    const isDecl = offer.clientStatus === 'declined';
                    const cls = isDecl ? 'bg-red-50 border-red-200 text-red-900' : 'bg-emerald-50 border-emerald-200 text-emerald-900';
                    const label = isDecl ? (Utils.t('offers.declineReason') || 'Client decline reason') : (Utils.t('offers.acceptNote') || 'Client accept note');
                    const markSeenBtn = (offer.adminReviewedByClient === false)
                        ? `<button class="ml-2 text-[10px] font-bold uppercase text-blue-700 hover:underline" onclick="event.stopPropagation(); (async () => { await fetch('/api/portal/admin/offers/mark_seen/${offer.id}', {method:'POST'}); if (typeof showToast==='function') showToast('Marked as seen.', 'success'); if (typeof renderOffersView==='function') renderOffersView(); })()">Mark seen</button>`
                        : '';
                    // Render signature block ako je klijent potpisao ponudu
                    let sigBlock = '';
                    if (hasSig) {
                        const s = offer.clientSignature;
                        sigBlock = `
                        <div class="mt-2 pt-2 border-t border-emerald-300/50">
                          <div class="text-[10px] font-bold uppercase tracking-wider text-emerald-800 mb-1">
                            🖋️ Legally binding e-signature
                          </div>
                          <div class="flex items-center gap-3">
                            <img src="${Utils.escapeHtml(s.dataUrl)}" alt="Client signature" style="max-height:48px;max-width:200px;background:#fff;padding:2px;border:1px solid #d4d4d8;border-radius:4px;" />
                            <div class="text-[11px] text-emerald-900 leading-tight">
                              <div><strong>${Utils.escapeHtml(s.signerName || '')}</strong></div>
                              <div class="opacity-80">Signed ${s.signedAt ? new Date(s.signedAt).toLocaleString(currentLang) : ''}</div>
                              ${s.ipAddress ? `<div class="opacity-70">IP ${Utils.escapeHtml(s.ipAddress)}</div>` : ''}
                            </div>
                          </div>
                        </div>`;
                    }
                    clientNoteRow = `
                    <tr class="border-t-0">
                      <td colspan="6" class="px-5 pb-3 pt-0">
                        <div class="${cls} border rounded-lg px-3 py-2 text-sm flex items-start gap-2">
                          <span class="text-lg">${isDecl ? '❌' : '✅'}</span>
                          <div class="flex-1">
                            <strong class="text-xs font-bold uppercase tracking-wider block mb-0.5">${label}</strong>
                            ${offer.clientNote ? `<span class="italic">"${Utils.escapeHtml(offer.clientNote)}"</span>` : ''}
                            ${offer.clientDeclinedAt || offer.clientAcceptedAt ? `<span class="block text-[10px] mt-1 opacity-75">${new Date(offer.clientDeclinedAt || offer.clientAcceptedAt).toLocaleString(currentLang)}${markSeenBtn}</span>` : markSeenBtn}
                            ${sigBlock}
                          </div>
                        </div>
                      </td>
                    </tr>`;
                }

                return `
                <tr class="hover:bg-slate-50 transition-colors">
                  <td class="p-5 font-black text-slate-900">${Utils.escapeHtml(offer.offerNo)}${statusBadge}</td>
                  <td class="p-5 text-slate-500 font-bold">${new Date(offer.date).toLocaleDateString(currentLang)}</td>
                  <td class="p-5 font-black text-blue-700">${Utils.escapeHtml(custName)}</td>
                  <td class="p-5 font-bold text-slate-600">${Utils.escapeHtml(prodName)}</td>
                  <td class="p-5 font-black text-emerald-600 text-lg">${Utils.formatCurrency(totalVal, offer.currency)}</td>
                  <td class="p-5 text-right whitespace-nowrap">
                      ${convertBtn}
                      <button class="bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 font-bold px-4 py-2 rounded-lg text-xs shadow-sm transition-all mr-2" data-preview-offer="${offer.id}" title="Pregled PDF-a (ne šalje se klijentu)">🔍 ${Utils.t('offer.previewPdf') || 'Pregled'}</button>
                      ${offer.documentId
                          ? `<button class="bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-800 font-bold px-4 py-2 rounded-lg text-xs shadow-sm transition-all mr-2" data-resend-offer="${offer.id}" title="Ponovo generiši i pošalji klijentu">📤 ${Utils.t('offer.resendPdf') || 'Pošalji ponovo'}</button>`
                          : `<button class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-lg text-xs shadow-sm transition-all mr-2" data-send-offer="${offer.id}" title="Pošalji dokument klijentu u portal">📤 ${Utils.t('offer.sendPdf') || 'Pošalji klijentu'}</button>`}
                      <button class="bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-800 font-bold px-4 py-2 rounded-lg text-xs shadow-sm transition-all mr-2" data-logistics-offer="${offer.id}" title="${Utils.t('logistics.plannerTitle') || 'Multimodalni logistički planer'}">🌍 ${Utils.t('logistics.plan') || 'Ruta'}</button>
                      <button class="bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 font-bold px-4 py-2 rounded-lg text-xs shadow-sm transition-all mr-2" onclick="document.dispatchEvent(new CustomEvent('createCustomerOffer', {detail: {savedOfferId: '${offer.id}'}}))">${Utils.t('actions.openEdit') || 'Otvori / Uredi'}</button>
                      <button class="bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-800 font-bold px-4 py-2 rounded-lg text-xs shadow-sm transition-all mr-2" data-history-offer="${offer.id}" title="View version history">📜 History</button>
                      <button class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 font-bold px-4 py-2 rounded-lg text-xs shadow-sm transition-colors offer-delete-btn" data-offer-id="${offer.id}">🗑️</button>
                  </td>
                </tr>${clientNoteRow}`;
            }).join('') || `<tr><td colspan="6" class="p-10 text-center text-slate-400 font-bold border-dashed border-2 border-slate-200 text-sm">${Utils.t('misc.noOffersStored') || 'Nema sačuvanih ponuda.'}</td></tr>`}
        </tbody>
    </table>`;
    main.appendChild(container);

    // Delete offer — profesionalan potvrdni modal umesto browser confirm-a
    container.querySelectorAll('.offer-delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const offerId = e.currentTarget.dataset.offerId;
            const srLang = Utils.getLang() === 'sr';
            const yes = await (window.askConfirm
                ? askConfirm(srLang ? 'Obrisati ponudu?' : 'Delete offer?',
                             srLang ? 'Ova akcija se ne može poništiti.' : 'This action cannot be undone.',
                             { danger: true, confirmText: srLang ? 'Obriši' : 'Delete' })
                : confirm(srLang ? 'Obrisati?' : 'Delete?'));
            if (!yes) return;
            try {
                await deleteItemFromServer('offers', offerId);
                state.data.offers = state.data.offers.filter(o => o.id !== offerId);
                renderOffersView();
                if (typeof showToast === 'function') showToast(srLang ? 'Ponuda obrisana.' : 'Offer deleted.', 'success');
            } catch (err) {
                if (typeof showToast === 'function') showToast(err.message || 'Delete failed.', 'error');
            }
        });
    });

    // Konverzija ponude u dil se rešava globalnim event delegation-om (jednom
    // na document body) — vidi installOfferConvertDelegatedHandler(). Time se
    // izbegava rizik da re-render izgubi handler ili da izuzetak u petlji za
    // vezivanje sprečimo klik. Dugmad ostaju standardna <button data-convert-offer>.
    installOfferConvertDelegatedHandler();
    installOfferLogisticsDelegatedHandler();
    installOfferPdfDelegatedHandler();
    installOfferHistoryDelegatedHandler();
}

// ==========================================================
// OFFER VERSION HISTORY — modal koji čita /api/offers/<id>/versions
// ==========================================================
// Cilj: kada admin (ili radnik) klikne 📜 History na redu ponude, prikaži
// timeline svake izmene: KO, KADA, ŠTA se promenilo (lista polja) i ZAŠTO.
// Iz timeline-a admin može da otvori pun snapshot verzije i da vrati staru
// verziju u aktivnu ponudu (samo admin/offers_edit permisija).

let __offerHistoryHandlerInstalled = false;
function installOfferHistoryDelegatedHandler() {
    if (__offerHistoryHandlerInstalled) return;
    __offerHistoryHandlerInstalled = true;
    document.addEventListener('click', async (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest('[data-history-offer]') : null;
        if (!btn) return;
        ev.preventDefault(); ev.stopPropagation();
        const offerId = btn.getAttribute('data-history-offer');
        if (!offerId) return;
        await openOfferHistoryModal(offerId);
    });
}

async function openOfferHistoryModal(offerId) {
    // Skini istoriju
    let versions = [];
    try {
        const res = await fetch(`/api/offers/${encodeURIComponent(offerId)}/versions`, { credentials: 'same-origin' });
        if (!res.ok) {
            if (typeof showToast === 'function') showToast(`✗ History load failed (${res.status})`, 'error');
            return;
        }
        const j = await res.json();
        versions = j.versions || [];
    } catch (e) {
        if (typeof showToast === 'function') showToast(`✗ ${e.message || e}`, 'error');
        return;
    }

    const offer = (state.data.offers || []).find(o => o.id === offerId) || {};
    const offerNo = offer.offerNo || offerId;
    const canRestore = state.user?.role === 'admin' || (state.user?.permissions && state.user.permissions.offers_edit);

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-[9998] flex items-start justify-center bg-black/50 p-6 overflow-y-auto';
    modal.setAttribute('data-offer-history-modal', offerId);
    modal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl my-6" style="max-height:90vh;display:flex;flex-direction:column;">
        <div class="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 rounded-t-2xl">
          <div>
            <div class="text-[10px] font-black uppercase tracking-widest text-slate-500">Version history</div>
            <h3 class="text-xl font-black text-slate-900">Offer ${Utils.escapeHtml(offerNo)}</h3>
          </div>
          <button type="button" class="text-slate-500 hover:text-slate-900 text-2xl font-bold px-3" data-close-history>×</button>
        </div>
        <div class="p-6 overflow-y-auto flex-1" data-history-body>
          ${versions.length === 0
            ? `<div class="text-center text-slate-500 italic py-10">No prior versions yet — every future edit will appear here.</div>`
            : `<div class="text-xs text-slate-500 mb-4">Showing <strong>${versions.length}</strong> version${versions.length === 1 ? '' : 's'} (most recent first). Each row is the state BEFORE the change.</div>
               <div class="space-y-3">
                 ${versions.map(v => `
                   <div class="border border-slate-200 rounded-xl p-4 hover:shadow-md transition-shadow">
                     <div class="flex items-center justify-between mb-2">
                       <div class="flex items-center gap-3">
                         <span class="text-xs font-black px-2.5 py-1 rounded-md bg-slate-900 text-white">v${v.version}</span>
                         <span class="text-xs font-bold text-slate-700">${v.changedAt ? new Date(v.changedAt).toLocaleString() : '—'}</span>
                         <span class="text-[10px] uppercase px-2 py-0.5 rounded-full font-bold ${v.origin === 'portal' ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'}">${v.origin || 'crm'}</span>
                         <span class="text-[10px] text-slate-500">by ${Utils.escapeHtml(v.changedBy || 'system')} (${Utils.escapeHtml(v.changedByRole || '')})</span>
                       </div>
                       <div class="flex items-center gap-2">
                         <button class="bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 font-bold px-3 py-1.5 rounded-md text-[11px]" data-view-version="${v.id}">🔍 View snapshot</button>
                         ${canRestore ? `<button class="bg-amber-100 hover:bg-amber-200 border border-amber-300 text-amber-900 font-bold px-3 py-1.5 rounded-md text-[11px]" data-restore-version="${v.id}" data-version-number="${v.version}">↩ Restore</button>` : ''}
                       </div>
                     </div>
                     ${(v.changedFields || []).length > 0 ? `
                       <div class="text-[11px] text-slate-600 mt-1">
                         <strong class="uppercase tracking-wider text-slate-500">Changed fields:</strong>
                         <span class="ml-1">${v.changedFields.map(f => `<code class="bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 mr-1 text-[10px]">${Utils.escapeHtml(f)}</code>`).join('')}</span>
                       </div>` : ''}
                     ${v.changeReason ? `<div class="text-[11px] text-slate-700 mt-2 italic bg-slate-50 border-l-4 border-slate-300 pl-3 py-1">"${Utils.escapeHtml(v.changeReason)}"</div>` : ''}
                   </div>`).join('')}
               </div>`}
        </div>
      </div>`;
    document.body.appendChild(modal);

    modal.addEventListener('click', async (e) => {
        if (e.target === modal || (e.target.closest && e.target.closest('[data-close-history]'))) {
            modal.remove();
            return;
        }
        const viewBtn = e.target.closest && e.target.closest('[data-view-version]');
        const restoreBtn = e.target.closest && e.target.closest('[data-restore-version]');
        if (viewBtn) {
            const vid = viewBtn.getAttribute('data-view-version');
            try {
                const res = await fetch(`/api/offers/${encodeURIComponent(offerId)}/versions/${encodeURIComponent(vid)}`, { credentials: 'same-origin' });
                if (!res.ok) { if (typeof showToast === 'function') showToast(`Snapshot load failed (${res.status})`, 'error'); return; }
                const j = await res.json();
                const pre = document.createElement('pre');
                pre.textContent = JSON.stringify(j.snapshot || {}, null, 2);
                pre.style.cssText = 'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;background:#0f172a;color:#e2e8f0;padding:16px;border-radius:8px;overflow:auto;max-height:60vh;white-space:pre-wrap;word-break:break-word;';
                const wrap = document.createElement('div');
                wrap.className = 'fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-6';
                wrap.innerHTML = `<div class="bg-white rounded-2xl w-full max-w-3xl shadow-2xl p-6"><div class="flex items-center justify-between mb-3"><h4 class="font-black">Snapshot — v${j.version || '?'}</h4><button class="text-2xl font-bold text-slate-500 hover:text-slate-900" data-close-snap>×</button></div></div>`;
                wrap.querySelector('.bg-white').appendChild(pre);
                document.body.appendChild(wrap);
                wrap.addEventListener('click', ee => { if (ee.target === wrap || ee.target.closest('[data-close-snap]')) wrap.remove(); });
            } catch (er) { if (typeof showToast === 'function') showToast(er.message || 'Snapshot load failed', 'error'); }
        } else if (restoreBtn) {
            const vid = restoreBtn.getAttribute('data-restore-version');
            const vnum = restoreBtn.getAttribute('data-version-number');
            const yes = await (window.askConfirm
                ? askConfirm('Restore this version?', `The current offer state will first be saved as a new version (v${(versions[0]?.version || 0) + 1}), then v${vnum} will become the active offer.`, { danger: false, confirmText: 'Restore' })
                : confirm(`Restore v${vnum} to active?`));
            if (!yes) return;
            const reason = prompt('Optional reason for the restore (audit trail):', '') || '';
            try {
                const csrf = (typeof getCsrfToken === 'function') ? await getCsrfToken() : '';
                const res = await fetch(`/api/offers/${encodeURIComponent(offerId)}/versions/${encodeURIComponent(vid)}/restore`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
                    credentials: 'same-origin',
                    body: JSON.stringify({ reason }),
                });
                const j = await res.json();
                if (!res.ok) { if (typeof showToast === 'function') showToast(j.error || `Restore failed (${res.status})`, 'error'); return; }
                if (typeof showToast === 'function') showToast(`✓ Restored to v${j.restoredToVersion || vnum}. Refresh to see changes.`, 'success', 6000);
                modal.remove();
                // Refresh in-memory offer + view
                try { await loadDataFromServer(); if (typeof renderOffersView === 'function') renderOffersView(); } catch (_) {}
            } catch (er) { if (typeof showToast === 'function') showToast(er.message || 'Restore failed', 'error'); }
        }
    });
}

// Delegirani handler za dva dugmeta u tabeli ponuda:
//   🔍 Pregled — otvara PDF blob u novom tabu (ne dira bazu, ne šalje klijentu)
//   📤 Pošalji — generiše dokument, snima u shared_documents, poziva optional email
let __offerPdfHandlerInstalled = false;
function installOfferPdfDelegatedHandler() {
    if (__offerPdfHandlerInstalled) return;
    __offerPdfHandlerInstalled = true;

    document.addEventListener('click', async (ev) => {
        const previewBtn = ev.target && ev.target.closest ? ev.target.closest('[data-preview-offer]') : null;
        const sendBtn = ev.target && ev.target.closest ? ev.target.closest('[data-send-offer]') : null;
        const resendBtn = ev.target && ev.target.closest ? ev.target.closest('[data-resend-offer]') : null;
        if (!previewBtn && !sendBtn && !resendBtn) return;
        ev.preventDefault();
        ev.stopPropagation();

        const srLang = Utils.getLang() === 'sr';
        const T = (sr, en) => srLang ? sr : en;
        const toast = (msg, kind) => {
            if (typeof showToast === 'function') showToast(msg, kind || 'info');
            else if (kind === 'error') alert(msg);
        };

        // -------- PREVIEW (nije trajno, ne dira bazu) --------
        if (previewBtn) {
            const offerId = previewBtn.dataset.previewOffer;
            const offer = (state.data.offers || []).find(o => o.id === offerId);
            if (!offer) { toast(T('Ponuda nije nađena.','Offer not found.'), 'error'); return; }
            const origText = previewBtn.innerHTML;
            previewBtn.disabled = true;
            previewBtn.innerHTML = T('⏳ Otvaram…','⏳ Opening…');
            try {
                const res = await fetch('/api/offers/preview_pdf', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(offer)
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                // Otvara u novom tabu — korisnik vidi PDF viewer, može da preuzme,
                // ali dokument NIJE upisan u vault niti dostupan klijentu.
                const w = window.open(url, '_blank');
                if (!w) toast(T('Popup blokiran — dozvolite popup-e za pregled.','Popup blocked — allow popups to preview.'), 'warning');
                // Cleanup URL posle 60s
                setTimeout(() => URL.revokeObjectURL(url), 60000);
                toast(T('Pregled otvoren u novom tabu (dokument NIJE poslat klijentu).',
                        'Preview opened in a new tab (document was NOT sent to client).'), 'info');
            } catch (err) {
                toast(T('Greška pri generisanju pregleda: ','Preview generation failed: ') + err.message, 'error');
            } finally {
                previewBtn.disabled = false;
                previewBtn.innerHTML = origText;
            }
            return;
        }

        // -------- SEND / RESEND (upisuje u vault, klijent dobija u portalu) --------
        const btn = sendBtn || resendBtn;
        const offerId = btn.dataset.sendOffer || btn.dataset.resendOffer;
        const isResend = !!resendBtn;

        const yes = await (window.askConfirm
            ? window.askConfirm(
                T('Poslati klijentu?','Send to client?'),
                isResend
                    ? T('Ovo će REPLACE-ovati postojeći dokument novom verzijom u portalu klijenta. Nastavljate?',
                        'This will REPLACE the existing document with a new version in the client portal. Continue?')
                    : T('Klijent će odmah videti ovaj dokument u B2B portalu i moći će da ga preuzme sa audit tragom. Nastavljate?',
                        'The client will immediately see this document in the B2B portal and be able to download it with an audit trail. Continue?'),
                { danger: false, confirmText: T('Pošalji','Send') })
            : confirm(T('Poslati klijentu?','Send to client?')));
        if (!yes) return;

        const origText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = T('⏳ Šaljem…','⏳ Sending…');
        try {
            const res = await fetch(`/api/offers/${encodeURIComponent(offerId)}/generate_pdf`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
            toast(T('Dokument poslat u portal klijenta. Hash je ubeležen u audit trag.',
                    'Document sent to client portal. Verification hash logged in audit trail.'), 'success');
            if (typeof loadFromStorage === 'function') { try { await loadFromStorage(); } catch (_) {} }
            if (typeof renderOffersView === 'function') { try { renderOffersView(); } catch (_) {} }
        } catch (err) {
            toast(T('Greška pri slanju: ','Send failed: ') + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = origText;
        }
    }, false);
}

// Delegirani handler za dugme "🌍 Ruta" u tabeli ponuda (CRM). Kada se klikne,
// otvara Logistics Planner modal auto-popunjen iz podataka ponude:
//   - polazište = adresa dobavljača (ako postoji productId → productData.supplier)
//     ili adresa naše firme (state.company.address) kao fallback
//   - odredište = adresa kupca (offer.customerId → partners → address)
//   - teret = quantity + unit iz ponude
let __offerLogisticsHandlerInstalled = false;
function installOfferLogisticsDelegatedHandler() {
    if (__offerLogisticsHandlerInstalled) return;
    __offerLogisticsHandlerInstalled = true;

    document.addEventListener('click', async (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest('[data-logistics-offer]') : null;
        if (!btn) return;
        ev.preventDefault();
        ev.stopPropagation();

        const offerId = btn.dataset.logisticsOffer;
        const offer = (state.data.offers || []).find(o => o.id === offerId);
        if (!offer) {
            if (typeof showToast === 'function') showToast('Offer not found', 'error');
            return;
        }

        // Svi partneri (kupci + dobavljači) su u state.data.partners.
        // Kupac (odredište): partner sa istim id kao offer.customerId.
        // Dobavljač (polazište): iz product.supplyOffers[0].supplierId ako postoji,
        //   inače iz product.supplierId, inače pad na company address (naša firma).
        const allPartners = state.data.partners || [];
        const buyer = allPartners.find(c => c.id === offer.customerId);

        const productId = offer.productId || (offer.items && offer.items[0] && offer.items[0].productId);
        const product = productId ? (state.data.products || []).find(p => p.id === productId) : null;
        let supplier = null;
        if (product) {
            const supplyOffers = product.supplyOffers || [];
            const supIdx = offer.items && offer.items[0] && offer.items[0].supplyOfferIndex;
            const supplyOffer = (typeof supIdx === 'number' && supplyOffers[supIdx]) ? supplyOffers[supIdx] : supplyOffers[0];
            const supId = (supplyOffer && supplyOffer.supplierId) || product.supplierId;
            if (supId) supplier = allPartners.find(p => p.id === supId);
        }

        // Formatiraj label — koristi ime + adresu ili samo adresu.
        // Ako je partner.address DICT, izvuci street/city/country komponente.
        const partnerToLabel = (p) => {
            if (!p) return '';
            const parts = [p.companyName || p.name];
            const addr = p.address;
            if (typeof addr === 'string' && addr) parts.push(addr);
            else if (addr && typeof addr === 'object') {
                if (addr.street) parts.push(addr.street);
                if (addr.city) parts.push(addr.city);
                if (addr.country) parts.push(addr.country);
            } else {
                if (p.city) parts.push(p.city);
                if (p.country) parts.push(p.country);
            }
            return parts.filter(Boolean).join(', ');
        };

        const originLabel = supplier
            ? partnerToLabel(supplier)
            : (state.company && [state.company.address, state.company.city, state.company.country]
                                 .filter(Boolean).join(', ')) || '';
        const destLabel = partnerToLabel(buyer);

        // Teret (t) — koristi Utils.toMetricTons za tacnu konverziju za sve tezinske jedinice
        // (kg, g, mt, t, lb, oz). Ako korisnik ima vise items, zbrajaj tone svih items.
        let cargoTons = 0;
        if (offer.items && offer.items.length > 0) {
            offer.items.forEach(it => {
                const t = Utils.toMetricTons(parseFloat(it.quantity) || 0, it.unit);
                if (t !== null) cargoTons += t;
            });
        }
        if (!cargoTons) {
            const qty = parseFloat(offer.quantity || 0);
            const unit = offer.unit || 'MT';
            const t = Utils.toMetricTons(qty, unit);
            cargoTons = t !== null ? t : (qty || 20);
        }
        if (!cargoTons) cargoTons = 20;

        if (typeof window.openLogisticsPlanner !== 'function') {
            alert('Logistics planner module not loaded (please refresh)');
            return;
        }
        window.openLogisticsPlanner({
            origin: originLabel ? { address: originLabel } : null,
            destination: destLabel ? { address: destLabel } : null,
            cargoTons,
            apiBase: '/api/logistics',
        });
    }, false);
}

// Instalira jednom-po-sesiji delegirani click handler za dugmad
// "Kreiraj dil" ([data-convert-offer]). Ovo je robusnije od per-row
// bindovanja jer:
//   - preživljava re-render tabele bez potrebe da se ponovo vezuje,
//   - jedan izuzetak u pojedinačnom klik ciklusu ne obara ostale klikove,
//   - radi i za dugmad renderovana preko innerHTML nakon inicijalnog binding-a.
let __offerConvertHandlerInstalled = false;
function installOfferConvertDelegatedHandler() {
    if (__offerConvertHandlerInstalled) return;
    __offerConvertHandlerInstalled = true;

    document.addEventListener('click', async (ev) => {
        const btn = ev.target && ev.target.closest ? ev.target.closest('[data-convert-offer]') : null;
        if (!btn) return;
        ev.preventDefault();
        ev.stopPropagation();

        const offerId = btn.dataset.convertOffer;
        const force = btn.dataset.force === 'true';
        const srLang = (typeof Utils !== 'undefined' && Utils.getLang) ? Utils.getLang() === 'sr' : true;
        const T = (sr, en) => srLang ? sr : en;

        // Zaštita od duplog klika (dugme se onesposobi dok traje mrežni zahtev
        // i eventualni modal). Vraća se u prvobitno stanje u finally bloku.
        if (btn.disabled) return;
        btn.disabled = true;
        btn.dataset.originalText = btn.dataset.originalText || btn.innerHTML;
        btn.innerHTML = T('⏳ Kreiram…', '⏳ Creating…');

        const toast = (msg, kind) => {
            if (typeof showToast === 'function') showToast(msg, kind || 'info');
            else if (kind === 'error') alert(msg);
        };

        try {
            const msg = force
                ? T('PAŽNJA: Klijent nije potvrdio ovu ponudu preko portala.\nDa li ste sigurni da želite da napravite dil bez njegove potvrde?',
                    'WARNING: Client has not confirmed via portal.\nAre you sure you want to create the deal without client confirmation?')
                : T('Kreirati dil iz ove ponude?', 'Create deal from this offer?');

            let yes;
            if (typeof window.askConfirm === 'function') {
                try {
                    yes = await window.askConfirm(
                        T('Konverzija u dil', 'Convert to deal'),
                        msg,
                        { danger: force, confirmText: T('Nastavi', 'Continue') }
                    );
                } catch (mErr) {
                    // Ako custom modal padne iz bilo kog razloga, ne guši klik —
                    // predji na native confirm da korisnik ipak može da nastavi.
                    console.warn('askConfirm failed, falling back to native confirm', mErr);
                    yes = window.confirm(msg);
                }
            } else {
                yes = window.confirm(msg);
            }

            if (!yes) return;

            const res = await fetch(`/api/deals/from_offer/${encodeURIComponent(offerId)}`, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ force })
            });

            let data = {};
            try { data = await res.json(); } catch (_) { data = {}; }

            if (res.ok) {
                toast(T('Dil kreiran uspešno.', 'Deal created successfully.'), 'success');
                if (typeof loadFromStorage === 'function') {
                    try { await loadFromStorage(); } catch (_) {}
                }
                if (typeof renderOffersView === 'function') {
                    try { renderOffersView(); } catch (_) {}
                }
                // Ako je korisnik u drugom pogledu, forsiraj re-render offera nakon povratka.
                if (typeof checkAllNotifications === 'function') {
                    try { checkAllNotifications(); } catch (_) {}
                }
            } else if (data.error === 'CLIENT_HAS_NOT_ACCEPTED') {
                toast(T('Klijent nije prihvatio ponudu preko portala. Zatražite mu da uđe u portal i klikne "Prihvatam", ili koristite "Bez portala" opciju (traži posebnu dozvolu).',
                        'Client has not accepted via portal. Ask them to accept from the portal, or use the "no portal" option (requires special permission).'), 'error');
            } else if (data.error === 'ALREADY_CONVERTED') {
                toast(T('Ova ponuda je već konvertovana u dil.', 'This offer is already converted to a deal.'), 'warning');
            } else if (data.error === 'OFFER_NOT_FOUND') {
                toast(T('Ponuda nije pronađena.', 'Offer not found.'), 'error');
            } else if (data.error === 'UNAUTHORIZED' || data.error === 'FORCE_NOT_ALLOWED') {
                toast(T('Nemate dozvolu za ovu akciju.', 'You do not have permission for this action.'), 'error');
            } else if (res.status === 403) {
                toast(T('Zabranjeno (proverite prijavu ili osvežite stranicu).', 'Forbidden (check login or refresh the page).'), 'error');
            } else {
                toast(T('Greška: ', 'Error: ') + (data.error || `HTTP ${res.status}`), 'error');
            }
        } catch (err) {
            console.error('create-deal failed', err);
            toast(T('Mrežna greška prilikom kreiranja dila. Pokušajte ponovo.',
                    'Network error while creating deal. Please try again.'), 'error');
        } finally {
            btn.disabled = false;
            if (btn.dataset.originalText) {
                btn.innerHTML = btn.dataset.originalText;
                delete btn.dataset.originalText;
            }
        }
    }, false);
}