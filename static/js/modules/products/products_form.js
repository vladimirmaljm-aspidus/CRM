// static/js/modules/products/products_form.js

function showProductForm(id = null) {
    state.editingItem = id ? state.data.products.find(p => p.id === id) : null; 
    const item = state.editingItem || { supplyOffers: [], inventory: [], coaParams: [], logistics: {}, tags: [] };
    item.inventory = item.inventory || [];
    item.coaParams = item.coaParams || [];
    item.logistics = item.logistics || { cap20: '', cap40: '' };
    item.tags = item.tags || [];
    
    const catFallback = typeof PRODUCT_CATEGORIES !== 'undefined' ? PRODUCT_CATEGORIES : [];
    const categoriesOptions = [''].concat(catFallback).map(c => {
        const catName = typeof getTranslatedCategory === 'function' ? getTranslatedCategory(c) : c;
        return `<option value="${c}" ${item.category === c ? 'selected' : ''}>${catName || '...'}</option>`;
    }).join('');
    
    const isSupplier = (p) => (p.types || []).includes('supplier') || (p.types || []).includes('Dobavljač');
    const supplierOptions = state.data.partners.filter(isSupplier).map(p => `<option value="${p.id}">${Utils.escapeHtml(p.companyName)}</option>`).join('');
    
    let currentEditOfferIndex = -1;
    const currentLang = Utils.getLang() === 'sr' ? 'sr-RS' : 'en-US';
    const tLang = (srStr, enStr) => Utils.getLang() === 'sr' ? srStr : enStr;
    const predefinedTags = ['New Crop', 'Fast Moving', 'Bestseller', 'Organic', 'Fairtrade', 'Premium', 'Clearance'];
    
    const tagsHtml = predefinedTags.map(t => {
        const isChecked = item.tags.includes(t);
        return `<label class="inline-flex items-center text-xs bg-white px-3 py-1.5 rounded-full cursor-pointer hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold transition-colors"><input type="checkbox" name="product_tags" value="${t}" ${isChecked?'checked':''} class="mr-2 w-4 h-4 text-blue-600 focus:ring-blue-500 rounded-sm border-slate-300"> ${t}</label>`;
    }).join('');

    const renderOffersList = () => {
        return (item.supplyOffers || []).map((o, i) => {
            const histBtn = (o.history && o.history.length > 0) ? `<button type="button" class="bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold px-3 py-1 rounded text-xs transition-colors w-full mt-2 border border-blue-200" onclick="document.getElementById('hist-${i}').classList.toggle('hidden')">⏱️ ${Utils.t('actions.history') || 'Istorija Cena'}</button>` : '';
            const histLog = (o.history || []).map(h => `<div class="text-[10px] text-slate-600 border-l-2 border-amber-400 pl-2 mb-1.5 bg-slate-50 p-1.5 rounded">${Utils.t('fields.modified') || 'Izmenjeno:'} <strong>${new Date(h.date).toLocaleString(currentLang)}</strong><br>${Utils.t('fields.oldPrice') || 'Stara Cena:'} <strong class="text-red-500">${h.price} ${h.currency || o.currency}</strong> | ${Utils.t('fields.incoterm') || 'Incoterm'}: ${h.incoterm}</div>`).join('');
            
            const reserved = Math.max(
                (state.data.offers || []).filter(off => off.productId === item.id && off.offerIndex === i).reduce((s, off) => s + Number(off.quantity || 0), 0),
                (state.data.deals || []).filter(d => d.productId === item.id && d.supplierId === o.supplierId).reduce((s, d) => s + Number(d.quantity || 0), 0)
            );
            const available = (o.quantity || 0) - reserved;
            
            let stockWarning = '';
            if (available < 0) stockWarning = `<span class="bg-red-600 text-white px-2 py-0.5 rounded text-[10px] ml-2 font-black uppercase animate-pulse">Manjak: ${available}</span>`;
            else if (available === 0) stockWarning = `<span class="bg-amber-100 text-amber-800 border border-amber-300 px-2 py-0.5 rounded text-[10px] ml-2 font-black uppercase">Rasprodato</span>`;
            
            let validityBadge = '';
            if(o.validUntil) {
                const diffDays = Math.ceil((new Date(o.validUntil) - new Date()) / (1000 * 60 * 60 * 24));
                if(diffDays < 0) validityBadge = `<span class="bg-red-50 text-red-700 text-[9px] font-black px-1.5 py-0.5 rounded border border-red-200 ml-2 uppercase">${tLang('ISTEKLA PONUDA', 'EXPIRED')}</span>`;
                else if(diffDays <= 7) validityBadge = `<span class="bg-orange-50 text-orange-700 text-[9px] font-black px-1.5 py-0.5 rounded border border-orange-200 ml-2 uppercase">${tLang('Istiće uskoro', 'Expiring soon')} (${diffDays}d)</span>`;
                else validityBadge = `<span class="text-[9px] text-slate-500 ml-2 font-bold uppercase tracking-wider">${tLang('Važi do', 'Valid until')}: ${new Date(o.validUntil).toLocaleDateString(currentLang)}</span>`;
            }
            return `
            <div class="mb-3 p-4 border border-slate-200 rounded-xl bg-white shadow-sm ${o.validUntil && Math.ceil((new Date(o.validUntil) - new Date()) / (1000 * 60 * 60 * 24)) < 0 ? 'opacity-70 grayscale' : ''}">
                <div class="flex justify-between items-start mb-2">
                    <div class="text-sm text-slate-800">
                        <div class="flex items-center"><span class="text-xs text-slate-500 uppercase tracking-widest font-black mr-2">${tLang('Dobavljač', 'Supplier')}:</span> <strong class="text-base">${Utils.getPartnerNameById(o.supplierId)}</strong> ${validityBadge}</div>
                        <div class="text-blue-700 mt-2 text-xs font-bold bg-blue-50 inline-block px-2 py-1 rounded border border-blue-200">
                            Zalihe kod dobavljača: <strong>${o.quantity || 0} ${Utils.escapeHtml(o.unit || '')}</strong> | Rezervisano: <strong>${reserved}</strong> | Slobodno: <strong class="${available < 0 ? 'text-red-500' : 'text-emerald-600'}">${available}</strong> ${stockWarning}
                        </div>
                        <div class="mt-3 flex items-center gap-3">
                            <span class="bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 uppercase tracking-wider">Cena: <strong class="text-lg text-slate-900 font-black ml-1">${Utils.formatCurrency(o.price, o.currency)}</strong> / ${Utils.escapeHtml(o.unit || '')}</span>
                            <span class="bg-slate-50 px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-black text-slate-600">${Utils.escapeHtml(o.incoterm || 'N/A')}</span>
                            ${o.moq ? `<span class="bg-purple-50 text-purple-700 text-[10px] font-black px-2 py-1.5 rounded border border-purple-200 tracking-widest uppercase">MOQ: ${o.moq} ${Utils.escapeHtml(o.unit || '')}</span>` : ''}
                        </div>
                        <div class="mt-3 text-xs text-slate-600 grid grid-cols-2 gap-2">
                            <div><strong class="uppercase tracking-wider text-[9px] block mb-0.5 text-slate-400">Poreklo</strong> <span class="font-bold text-slate-800">${Utils.escapeHtml(o.country || 'N/A')}</span></div>
                            ${o.certificates ? `<div><strong class="uppercase tracking-wider text-[9px] block mb-0.5 text-slate-400">Sertifikati</strong> <span class="font-bold text-slate-800">${Utils.escapeHtml(o.certificates)}</span></div>` : ''}
                        </div>
                    </div>
                    <div class="flex flex-col gap-2">
                        <button type="button" class="bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 font-bold px-3 py-1.5 rounded shadow-sm text-xs transition-colors edit-offer" data-index="${i}">✏️ ${tLang('Izmeni', 'Edit')}</button>
                        <button type="button" class="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-bold px-3 py-1.5 rounded shadow-sm text-xs transition-colors remove-offer" data-index="${i}">🗑️ ${tLang('Obriši', 'Delete')}</button>
                    </div>
                </div>
                ${histBtn}
                <div id="hist-${i}" class="hidden mt-2 border-t border-slate-200 pt-2">${histLog}</div>
            </div>`;
        }).join('');
    };

    const renderInventoryList = () => {
        const stMap = {
            'available': { label: tLang('Slobodno', 'Available'), cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
            'in_transit': { label: tLang('U tranzitu', 'In Transit'), cls: 'bg-blue-50 text-blue-700 border-blue-200' },
            'customs': { label: tLang('Na carini', 'Customs Hold'), cls: 'bg-orange-50 text-orange-700 border-orange-200' },
            'reserved': { label: tLang('Rezervisano', 'Reserved'), cls: 'bg-slate-100 text-slate-700 border-slate-300' }
        };
        return item.inventory.map((inv, i) => {
            const expBadge = inv.expiry ? `<span class="ml-2 text-[10px] bg-red-50 text-red-700 px-2 py-0.5 rounded border border-red-200 font-black tracking-widest uppercase">EXP: ${new Date(inv.expiry).toLocaleDateString(currentLang)}</span>` : '';
            const stBadgeInfo = stMap[inv.status || 'available'];
            const statusBadge = `<span class="ml-2 text-[10px] px-2 py-0.5 rounded border font-black uppercase tracking-wider shadow-sm ${stBadgeInfo.cls}">${stBadgeInfo.label}</span>`;
            
            return `
            <div class="mb-2 p-4 border border-emerald-200 bg-emerald-50/50 rounded-xl flex justify-between items-center shadow-sm">
                <div class="text-sm text-slate-800">
                    <div class="flex items-center mb-1"><span class="text-lg mr-2">📍</span> <strong class="text-base">${Utils.escapeHtml(inv.location)}</strong> <span class="text-slate-400 mx-2">|</span> <span class="text-xs font-mono text-slate-600 font-bold">BATCH: ${Utils.escapeHtml(inv.batchNo || 'N/A')}</span></div>
                    <div class="flex items-center mt-2">
                        <span class="bg-white border border-emerald-200 px-3 py-1 rounded-lg shadow-sm font-black text-emerald-700 text-base">${inv.qty} ${Utils.escapeHtml(item.supplyOffers[0]?.unit || 'MT')}</span>
                        <span class="text-slate-400 font-bold mx-2">@</span>
                        <span class="text-slate-800 font-bold">${Utils.formatCurrency(inv.purchasePrice, inv.currency)}</span>
                        ${statusBadge}
                        ${expBadge}
                    </div>
                </div>
                <button type="button" class="bg-white hover:bg-red-50 text-red-500 border border-slate-200 hover:border-red-200 font-black px-3 py-2 rounded-lg transition-colors shadow-sm remove-inv" data-index="${i}">🗑️</button>
            </div>`;
        }).join('') || `<div class="p-8 text-center border-2 border-dashed border-emerald-200 rounded-xl bg-emerald-50/30"><span class="text-3xl block mb-2">📦</span><p class="text-emerald-700 font-bold text-sm">${tLang('Sopstveni magacin je prazan.', 'Own warehouse is empty.')}</p></div>`;
    };

    const renderCOAList = () => {
        return item.coaParams.map((coa, i) => `
            <div class="flex items-center gap-3 mb-2 p-3 bg-white border border-slate-200 rounded-lg shadow-sm">
                <span class="font-black text-xs uppercase tracking-widest text-slate-500 min-w-[120px]">${Utils.escapeHtml(coa.name)}:</span>
                <span class="text-sm font-bold text-slate-800 flex-1">${Utils.escapeHtml(coa.value)}</span>
                <button type="button" class="text-red-500 hover:text-red-700 bg-red-50 border border-red-100 px-2 py-1 rounded shadow-sm transition-colors remove-coa" data-index="${i}">✕</button>
            </div>
        `).join('') || `<p class="text-slate-400 text-xs italic text-center p-4 border border-dashed border-slate-200 rounded-lg">${tLang('Nema definisanih parametara.', 'No parameters defined.')}</p>`;
    };

    const html = `
    <form id="product-form" class="space-y-0 relative">
      
      <!-- TABS HEADER -->
      <div class="flex overflow-x-auto border-b border-slate-200 mb-6 custom-scrollbar pb-1">
          <button type="button" class="prod-tab-btn active px-6 py-3 border-b-2 border-blue-600 font-black text-blue-600 text-xs uppercase tracking-widest whitespace-nowrap transition-colors" data-target="tab-general">📝 ${tLang('Osnovni Podaci', 'General Info')}</button>
          <button type="button" class="prod-tab-btn px-6 py-3 border-b-2 border-transparent font-bold text-slate-500 hover:text-slate-800 text-xs uppercase tracking-widest whitespace-nowrap transition-colors" data-target="tab-commercial">🤝 ${tLang('Ponude Dobavljača', 'Supplier Offers')}</button>
          <button type="button" class="prod-tab-btn px-6 py-3 border-b-2 border-transparent font-bold text-slate-500 hover:text-slate-800 text-xs uppercase tracking-widest whitespace-nowrap transition-colors" data-target="tab-inventory">📦 ${tLang('Naš Lager (Zalihe)', 'Own Inventory')}</button>
          <button type="button" class="prod-tab-btn px-6 py-3 border-b-2 border-transparent font-bold text-slate-500 hover:text-slate-800 text-xs uppercase tracking-widest whitespace-nowrap transition-colors" data-target="tab-specs">🧪 ${tLang('Specifikacija & COA', 'Specs & COA')}</button>
      </div>

      <!-- TAB 1: GENERAL INFO -->
      <div id="tab-general" class="prod-pane block">
          <div class="crm-form-panel">
              <div class="crm-form-section">
                  <h4 class="crm-form-section-title">${tLang('📋 Osnovni podaci proizvoda','📋 Basic product information')}</h4>
                  <p class="crm-form-section-desc">${tLang('Koje ime, šifru i kategoriju roba nosi. Ovaj deo je vidljiv u katalogu i svim izveštajima.','Product name, code and category. This block is what buyers see on the catalog and every report.')}</p>
                  <div class="crm-form-grid crm-form-grid-3">
                      <div class="crm-field crm-field-span-2">
                          <label class="crm-label crm-label-required">${Utils.t('fields.productName')}</label>
                          <input name="name" class="crm-input crm-input-bold" value="${Utils.escapeHtml(item.name || '')}" required placeholder="${tLang('Npr. Refined White Sugar ICUMSA 45','e.g. Refined White Sugar ICUMSA 45')}"/>
                          <p class="crm-help">${tLang('Puno komercijalno ime robe. Dodaj kvalitet ili grade ako je bitan.','Full commercial name. Include grade / quality if relevant.')}</p>
                      </div>
                      <div class="crm-field">
                          <label class="crm-label">${tLang('Slika (URL)', 'Image URL')}</label>
                          <input name="imageUrl" class="crm-input" value="${Utils.escapeHtml(item.imageUrl || '')}" placeholder="https://…"/>
                          <p class="crm-help">${tLang('Opciono. Direktan link na sliku (jpg/png/webp).','Optional. Direct URL to jpg/png/webp image.')}</p>
                      </div>
                  </div>
                  <div class="crm-form-grid crm-form-grid-4">
                      <div class="crm-field">
                          <label class="crm-label">${Utils.t('fields.category')}</label>
                          <select name="category" class="crm-input">${categoriesOptions}</select>
                          <p class="crm-help">${tLang('Grupa za lakšu pretragu i grupisanje.','Group for search & reporting.')}</p>
                      </div>
                      <div class="crm-field" style="position:relative;">
                          <label class="crm-label">${Utils.t('fields.hsCode')}</label>
                          <input name="hsCode" id="prod-hs-input" autocomplete="off" class="crm-input crm-input-mono" value="${Utils.escapeHtml(item.hsCode || '')}" placeholder="${tLang('Npr. 1806 ili kucaj: chocolate, iron pipe, sunflower oil…','e.g. 1806 or type: chocolate, iron pipe, sunflower oil…')}" pattern="[0-9]{2,10}"/>
                          <div id="prod-hs-dd" class="hs-dd" style="position:absolute;top:100%;left:0;right:0;z-index:20;background:#fff;border:1px solid #cbd5e1;border-radius:6px;max-height:280px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.12);display:none;"></div>
                          <p class="crm-help" id="prod-hs-desc">${tLang('Harmonizovana carinska šifra (6–10 cifara). Pretraga po nazivu ili kodu.','Harmonized customs code (6-10 digits). Search by name or code.')}</p>
                          <button type="button" id="prod-hs-trade-btn" style="margin-top:6px;font-size:11px;background:#eef2ff;color:#3730a3;border:1px solid #c7d2fe;padding:4px 10px;border-radius:4px;cursor:pointer;font-weight:700;">${tLang('📊 Vidi svetsku trgovinu (UN Comtrade)', '📊 View world trade (UN Comtrade)')}</button>
                          <div id="prod-hs-trade-out" style="margin-top:8px;font-size:11px;"></div>
                      </div>
                      <script>
                      (function(){
                          setTimeout(function(){
                              var inp = document.getElementById('prod-hs-input');
                              var dd = document.getElementById('prod-hs-dd');
                              var desc = document.getElementById('prod-hs-desc');
                              if (!inp || !dd || typeof HS === 'undefined') return;
                              function paint(hits) {
                                  if (!hits || !hits.length) { dd.style.display = 'none'; return; }
                                  dd.innerHTML = hits.map(function(h){
                                      return '<div data-code="'+h.code+'" style="padding:8px 10px;cursor:pointer;border-bottom:1px solid #f1f5f9;font-size:12px;">' +
                                             '<span style="font-family:monospace;font-weight:800;color:#1e40af;">' + h.code + '</span>' +
                                             ' <span style="color:#374151;">' + h.label + '</span>' +
                                             '</div>';
                                  }).join('');
                                  dd.style.display = 'block';
                                  dd.querySelectorAll('[data-code]').forEach(function(el){
                                      el.addEventListener('click', function(){
                                          inp.value = el.dataset.code;
                                          dd.style.display = 'none';
                                          var name = HS.headingName(el.dataset.code) || HS.chapterName(el.dataset.code);
                                          if (desc && name) desc.textContent = '→ ' + name;
                                      });
                                  });
                              }
                              function showResolved() {
                                  var v = inp.value.trim();
                                  if (v.length >= 2 && desc) {
                                      var n = HS.headingName(v) || HS.chapterName(v);
                                      if (n) desc.textContent = '→ ' + n;
                                  }
                              }
                              inp.addEventListener('input', function(){
                                  var q = inp.value.trim();
                                  if (q.length < 1) { dd.style.display = 'none'; return; }
                                  paint(HS.lookup(q, 15));
                              });
                              inp.addEventListener('focus', function(){
                                  var q = inp.value.trim();
                                  if (q.length >= 1) paint(HS.lookup(q, 15));
                              });
                              inp.addEventListener('blur', function(){
                                  setTimeout(function(){ dd.style.display = 'none'; showResolved(); }, 150);
                              });
                              document.addEventListener('click', function(e){
                                  if (e.target !== inp && !dd.contains(e.target)) dd.style.display = 'none';
                              });
                              showResolved();
                          }, 50);
                      })();

                      // UN Comtrade panel — na klik dugmeta povučemo top 10 zemalja
                      // izvoznika/uvoznika za dati HS kod. Podaci iz comtradeapi.un.org.
                      setTimeout(function(){
                          var btnT = document.getElementById('prod-hs-trade-btn');
                          var inpT = document.getElementById('prod-hs-input');
                          var outT = document.getElementById('prod-hs-trade-out');
                          if (!btnT || !inpT || !outT) return;
                          btnT.addEventListener('click', async function(){
                              var hs = (inpT.value || '').trim().replace(/\s|\./g,'');
                              if (!hs || !/^\d{2,10}$/.test(hs)) {
                                  outT.innerHTML = '<span style="color:#dc2626;">Unesite prvo validan HS kod (2-10 cifara).</span>';
                                  return;
                              }
                              btnT.disabled = true;
                              outT.innerHTML = '<span style="color:#6b7280;">⏳ Povlačim iz UN Comtrade…</span>';
                              try {
                                  var r = await fetch('/api/geo/trade/' + encodeURIComponent(hs));
                                  if (!r.ok) throw new Error('HTTP ' + r.status);
                                  var j = await r.json();
                                  if (!j.rows || !j.rows.length) {
                                      outT.innerHTML = '<span style="color:#a16207;">⚠ Nema podataka za ovaj HS kod.</span>';
                                      btnT.disabled = false;
                                      return;
                                  }
                                  var rows = j.rows.slice(0, 10).map(function(r){
                                      return '<tr><td style="padding:2px 6px;">' + (r.reporter || '-') + '</td>' +
                                             '<td style="padding:2px 6px;font-family:monospace;text-align:right;">' + (r.partner || '-') + '</td>' +
                                             '<td style="padding:2px 6px;font-family:monospace;text-align:right;">' + (r.tradeValue ? Number(r.tradeValue).toLocaleString() : '-') + '</td></tr>';
                                  }).join('');
                                  outT.innerHTML =
                                      '<div style="border:1px solid #c7d2fe;border-radius:4px;padding:6px;background:#eef2ff;">' +
                                      '<div style="font-weight:800;font-size:11px;margin-bottom:4px;color:#3730a3;">📊 UN Comtrade — HS ' + hs + '</div>' +
                                      '<table style="width:100%;font-size:10px;"><thead><tr style="border-bottom:1px solid #c7d2fe;"><th style="text-align:left;padding:2px 6px;">Reporter</th><th style="text-align:right;padding:2px 6px;">Partner</th><th style="text-align:right;padding:2px 6px;">Value (USD)</th></tr></thead><tbody>' +
                                      rows + '</tbody></table>' +
                                      '<div style="font-size:9px;color:#4b5563;margin-top:4px;">Izvor: comtradeapi.un.org — poslednja godina objavljenih podataka.</div>' +
                                      '</div>';
                              } catch (e) {
                                  outT.innerHTML = '<span style="color:#dc2626;">✗ ' + (e.message || e) + '</span>';
                              } finally {
                                  btnT.disabled = false;
                              }
                          });
                      }, 100);
                      </script>
                      <div class="crm-field">
                          <label class="crm-label">SKU / Article No.</label>
                          <input name="sku" class="crm-input crm-input-mono" value="${Utils.escapeHtml(item.sku || '')}" placeholder="Npr. CCO-001"/>
                          <p class="crm-help">${tLang('Interni kod za skladišnu evidenciju.','Internal code for stock tracking.')}</p>
                      </div>
                      <div class="crm-field">
                          <label class="crm-label">${tLang('Brend / Proizvođač', 'Brand / Manufacturer')}</label>
                          <input name="brand" class="crm-input" value="${Utils.escapeHtml(item.brand || '')}" placeholder="Npr. Cargill"/>
                          <p class="crm-help">${tLang('Prazno ako je generic / bez brenda.','Leave empty if unbranded / generic.')}</p>
                      </div>
                      <div class="crm-field">
                          <label class="crm-label">${tLang('CAS # (hemijski registar)','CAS # (chemical registry)')}</label>
                          <div class="flex gap-2">
                              <input name="casNumber" id="prod-cas-input" class="crm-input crm-input-mono flex-1" value="${Utils.escapeHtml(item.casNumber || '')}" placeholder="e.g. 56-81-5" pattern="[0-9]{2,7}-[0-9]{2}-[0-9]"/>
                              <button type="button" id="prod-cas-lookup" class="btn small bg-blue-500 text-white" style="white-space:nowrap;">🔬 ${tLang('PubChem lookup','PubChem lookup')}</button>
                          </div>
                          <div id="prod-cas-result" class="text-xs mt-1" style="min-height:1.1em;color:#374151;"></div>
                          <p class="crm-help">${tLang('Za hemijske sirovine — dovoljan CAS broj, PubChem sam popuni ostalo.','For chemical raw materials — enter CAS #, PubChem auto-fills the rest.')}</p>
                      </div>
                  </div>
              </div>
              <script>
              (function(){
                  setTimeout(function(){
                      var btn = document.getElementById('prod-cas-lookup');
                      var inp = document.getElementById('prod-cas-input');
                      var out = document.getElementById('prod-cas-result');
                      if (!btn || !inp || !out) return;
                      btn.addEventListener('click', async function(){
                          var cas = (inp.value || '').trim();
                          if (!cas) { out.textContent = 'Enter a CAS number first.'; out.style.color = '#dc2626'; return; }
                          btn.disabled = true;
                          out.textContent = '⏳ Querying PubChem…';
                          out.style.color = '#6b7280';
                          try {
                              var r = await fetch('/api/geo/chem/cas/' + encodeURIComponent(cas));
                              if (!r.ok) {
                                  out.textContent = '✗ CAS ' + cas + ' not found in PubChem';
                                  out.style.color = '#dc2626';
                              } else {
                                  var j = await r.json();
                                  out.innerHTML = '✓ <strong>' + (j.name || j.iupac_name || '?') + '</strong> · ' +
                                                  (j.formula || '') + ' · MW ' + (j.molecular_weight || '?') +
                                                  ' · <a href="' + j.pubchem_url + '" target="_blank" style="color:#2563eb;">PubChem CID ' + j.cid + '</a>';
                                  out.style.color = '#059669';
                                  // Auto-fill product name if empty
                                  var nameInp = document.querySelector('input[name="name"]');
                                  if (nameInp && !nameInp.value && j.name) {
                                      nameInp.value = j.name;
                                  }
                                  // Auto-fill notes with formula + MW
                                  var descArea = document.querySelector('textarea[name="description"], textarea[name="notes"]');
                                  if (descArea && !descArea.value) {
                                      descArea.value = 'Chemical formula: ' + (j.formula || '') +
                                                       '\\nMolecular weight: ' + (j.molecular_weight || '') +
                                                       (j.iupac_name ? '\\nIUPAC: ' + j.iupac_name : '') +
                                                       (j.inchi_key ? '\\nInChI Key: ' + j.inchi_key : '');
                                  }
                              }
                          } catch(e) {
                              out.textContent = '✗ Network error: ' + (e && e.message || e);
                              out.style.color = '#dc2626';
                          }
                          btn.disabled = false;
                      });
                  }, 50);
              })();
              </script>
              <div class="crm-form-section crm-form-section-highlighted">
                  <div class="crm-form-grid crm-form-grid-2">
                      <div class="crm-field">
                          <label class="crm-label crm-label-emphasis">🎯 ${tLang('Ciljana nabavna cena (Deal Radar)', 'Target purchase price (Deal Radar)')}</label>
                          <p class="crm-help">${tLang('Cena koju ciljamo. Ponude ispod ove cene biće markirane zeleno.', 'Target price. Supplier offers below this price get a green flag.')}</p>
                          <div class="crm-input-pair">
                              <input name="targetPrice" type="number" step="0.01" min="0" class="crm-input crm-input-price" value="${item.targetPrice || ''}" placeholder="0.00"/>
                              <select name="targetCurrency" class="crm-input crm-input-suffix">${CURRENCIES.map(c => `<option value="${c}" ${(item.targetCurrency || 'USD') === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
                          </div>
                      </div>
                      <div class="crm-field">
                          <label class="crm-label">🏷️ ${tLang('Oznake / Tagovi', 'Tags')}</label>
                          <p class="crm-help">${tLang('Označi robu tagovima za brzu pretragu.','Tag products for quick filtering.')}</p>
                          <div class="crm-tag-wrap">${tagsHtml}</div>
                      </div>
                  </div>
              </div>
          </div>
      </div>

      <!-- TAB 2: SUPPLIER OFFERS -->
      <div id="tab-commercial" class="prod-pane hidden">
          <div class="crm-form-panel">
              <div class="crm-form-section">
                  <h4 class="crm-form-section-title">🤝 ${Utils.t('fields.supplier_offers') || tLang('Aktuelne ponude dobavljača','Current supplier offers')}</h4>
                  <p class="crm-form-section-desc">${tLang('Sve ponude iste robe od raznih dobavljača/porekala. Deal Radar ističe najbolju varijantu zeleno.','All supplier variants for this product. Deal Radar highlights the best deal green.')}</p>
                  <div id="offers-list" class="crm-list-scrollable">${renderOffersList() || `<div class="crm-empty">${Utils.t('product_search.noResults') || tLang('Još nema ponuda.','No offers yet.')}</div>`}</div>
              </div>

              <div id="offer-edit-box" class="crm-form-section crm-form-section-highlighted">
                  <h4 class="crm-form-section-title" id="offer-box-title">➕ ${Utils.t('actions.add_new_offer') || tLang('Dodaj novu ponudu dobavljača','Add new supplier offer')}</h4>
                  <p class="crm-form-section-desc">${tLang('Unesi jednu ponudu jednog dobavljača za ovu robu, sa svim specifičnostima porekla.','Enter one supplier offer for this product, with all origin-specific fields.')}</p>
                  <div class="crm-form-grid crm-form-grid-2">
                      <div class="crm-field">
                          <label class="crm-label crm-label-required">${Utils.t('actions.select_supplier')}</label>
                          <select id="offer-supplier" class="crm-input"><option value="">${tLang('— Izaberite dobavljača —','— Select supplier —')}</option>${supplierOptions}</select>
                          <p class="crm-help">${tLang('Partner tipa Supplier iz Partners modula.','Partner tagged as Supplier in Partners module.')}</p>
                      </div>
                      <div class="crm-field">
                          <label class="crm-label">${tLang('Poreklo / Zemlja', 'Country of origin')}</label>
                          <div class="autocomplete-container">
                              <input id="offer-country" class="crm-input" placeholder="Npr. Indonesia" autocomplete="off"/>
                          </div>
                          <p class="crm-help">${tLang('Zemlja proizvodnje/gajenja robe kod ovog dobavljača.','Country where the goods are produced/grown.')}</p>
                      </div>
                  </div>
                  <div class="crm-form-grid crm-form-grid-4">
                      <div class="crm-field">
                          <label class="crm-label">${tLang('Zalihe kod dobavljača (Qty)','Supplier stock (Qty)')}</label>
                          <input id="offer-qty" class="crm-input crm-input-mono" placeholder="0.00" type="number" step="0.01" min="0"/>
                          <p class="crm-help">${tLang('Koliko dobavljač ima trenutno na stanju.','How much the supplier currently has in stock.')}</p>
                      </div>
                      <div class="crm-field">
                          <label class="crm-label">${tLang('Jedinica','Unit')}</label>
                          <select id="offer-unit" class="crm-input">${UNITS.map(u => `<option value="${u}">${u}</option>`).join('')}</select>
                      </div>
                      <div class="crm-field">
                          <label class="crm-label">MOQ ${tLang('(min. porudžbina)','(min order)')}</label>
                          <input id="offer-moq" class="crm-input crm-input-mono" placeholder="0.00" type="number" step="0.01" min="0"/>
                          <p class="crm-help">${tLang('Najmanja količina koju dobavljač prihvata.','Smallest quantity supplier accepts.')}</p>
                      </div>
                      <div class="crm-field">
                          <label class="crm-label">${Utils.t('fields.incoterm')}</label>
                          <select id="offer-incoterm" class="crm-input"><option value="">${tLang('— Paritet —','— Term —')}</option>${INCOTERMS.map(i => `<option value="${i}">${i}</option>`).join('')}</select>
                      </div>
                  </div>
                  <div class="crm-form-grid crm-form-grid-3">
                      <div class="crm-field crm-field-span-2">
                          <label class="crm-label crm-label-emphasis">${tLang('Nabavna cena','Purchase price')}</label>
                          <div class="crm-input-pair">
                              <input id="offer-price" class="crm-input crm-input-price" placeholder="0.00" type="number" step="0.01" min="0"/>
                              <select id="offer-currency" class="crm-input crm-input-suffix">${CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('')}</select>
                          </div>
                          <p class="crm-help">${tLang('Cena po jedinici. Ako je ispod target cene, obeležava se zeleno.','Price per unit. Below your target price → green flag.')}</p>
                      </div>
                      <div class="crm-field">
                          <label class="crm-label crm-label-warning">${tLang('Ponuda važi do','Valid until')}</label>
                          <input id="offer-validUntil" type="date" class="crm-input crm-input-warning"/>
                          <p class="crm-help">${tLang('Datum kad ponuda ističe.','Date the offer expires.')}</p>
                      </div>
                  </div>
                  <div class="crm-field">
                      <label class="crm-label">${Utils.t('fields.certificates')}</label>
                      <div id="offer-certs-wrapper" class="crm-chip-wrap">
                          ${(typeof CERTIFICATES !== 'undefined' ? CERTIFICATES : []).map(c => `<label class="crm-chip"><input type="checkbox" name="offer_cert" value="${c}"/>${c}</label>`).join('')}
                      </div>
                      <p class="crm-help">${tLang('Sertifikati koje ovaj dobavljač poseduje (ISO, HACCP, Halal…).','Certifications this supplier holds (ISO, HACCP, Halal, …).')}</p>
                  </div>
                  <div class="crm-form-subsection">
                      <h5 class="crm-form-subsection-title">${tLang('Karakteristike za OVOG dobavljača / porekla', 'Variant-specific characteristics')}</h5>
                      <p class="crm-form-section-desc">${tLang('Ista roba iz različitih zemalja često ima potpuno drugačiju spec, pakovanje i lead time.','Same product from different origins often has completely different specs, packaging and lead time.')}</p>
                      <div class="crm-form-grid crm-form-grid-3">
                          <div class="crm-field">
                              <label class="crm-label">${tLang('Pakovanje', 'Packaging')}</label>
                              <input id="offer-packaging" class="crm-input" placeholder="${tLang('npr. 50kg PP vreća','e.g. 50kg PP bag')}"/>
                          </div>
                          <div class="crm-field">
                              <label class="crm-label">${tLang('Težina paketa (kg)', 'Package weight (kg)')}</label>
                              <input id="offer-package-weight" type="number" step="0.01" min="0" class="crm-input crm-input-mono" placeholder="0.00"/>
                          </div>
                          <div class="crm-field">
                              <label class="crm-label">${tLang('Lead time', 'Lead time')}</label>
                              <input id="offer-leadtime" class="crm-input" placeholder="${tLang('npr. 15-20 dana','e.g. 15-20 days')}"/>
                          </div>
                      </div>
                      <div class="crm-field">
                          <label class="crm-label">${tLang('Specifikacija ove varijante', 'Variant specification')}</label>
                          <textarea id="offer-spec" rows="3" class="crm-input" placeholder="${tLang('npr. Polarizacija ≥99.7%, boja ICUMSA 45, vlaga ≤0.04%', 'e.g. Polarization ≥99.7%, ICUMSA 45, moisture ≤0.04%')}"></textarea>
                      </div>
                  </div>
                  <div class="crm-form-actions">
                      <button type="button" id="cancel-offer-edit" class="crm-btn crm-btn-ghost hidden">${tLang('Odustani', 'Cancel')}</button>
                      <button type="button" id="add-offer" class="crm-btn crm-btn-primary">💾 ${Utils.t('actions.save')}</button>
                  </div>
              </div>
          </div>
      </div>

      <!-- TAB 3: INVENTORY -->
      <div id="tab-inventory" class="prod-pane hidden">
          <div class="crm-form-panel">
              <div class="crm-form-section">
                  <h4 class="crm-form-section-title">📦 ${tLang('Sopstveni magacin / Lager', 'Own inventory & stock')}</h4>
                  <p class="crm-form-section-desc">${tLang('Vlastite zalihe robe koje se već drže u magacinu — spremne za prodaju bez čekanja na dobavljača.','Stock already sitting in your warehouse — ready for sale without waiting on a supplier.')}</p>
                  <div id="inventory-list" class="crm-list-scrollable">${renderInventoryList()}</div>
              </div>

              <div class="crm-form-section crm-form-section-highlighted-green">
                  <h4 class="crm-form-section-title">➕ ${tLang('Dodaj partiju na stanje', 'Receive stock batch')}</h4>
                  <p class="crm-form-section-desc">${tLang('Prijem robe u magacin — po lokaciji, batch broju i statusu.','Book a batch into the warehouse — with location, batch code and status.')}</p>
                  <div class="crm-form-grid crm-form-grid-2">
                      <div class="crm-field">
                          <label class="crm-label">${tLang('Fizička lokacija (skladište)', 'Physical location')}</label>
                          <input id="inv-loc" class="crm-input" placeholder="${tLang('Npr. Jebel Ali, Dubai', 'e.g. Jebel Ali, Dubai')}"/>
                          <p class="crm-help">${tLang('Ime skladišta / bonded warehouse.','Warehouse or bonded facility name.')}</p>
                      </div>
                      <div class="crm-field">
                          <label class="crm-label">Batch / LOT No.</label>
                          <input id="inv-batch" class="crm-input crm-input-mono" placeholder="Npr. LOT-2026-05A"/>
                          <p class="crm-help">${tLang('Interni broj partije za traceability.','Internal batch number for traceability.')}</p>
                      </div>
                  </div>
                  <div class="crm-form-grid crm-form-grid-4">
                      <div class="crm-field">
                          <label class="crm-label crm-label-emphasis">${tLang('Količina (Qty)','Quantity')}</label>
                          <input id="inv-qty" class="crm-input crm-input-price crm-input-green" placeholder="0.00" type="number" step="0.01" min="0"/>
                      </div>
                      <div class="crm-field">
                          <label class="crm-label">${tLang('Nabavna cena','Purchase price')}</label>
                          <input id="inv-price" class="crm-input crm-input-mono" placeholder="0.00" type="number" step="0.01" min="0"/>
                      </div>
                      <div class="crm-field">
                          <label class="crm-label">${tLang('Valuta','Currency')}</label>
                          <select id="inv-currency" class="crm-input">${CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('')}</select>
                      </div>
                      <div class="crm-field">
                          <label class="crm-label crm-label-warning">${tLang('Rok trajanja','Expiry date')}</label>
                          <input id="inv-expiry" type="date" class="crm-input crm-input-warning"/>
                      </div>
                  </div>
                  <div class="crm-field">
                      <label class="crm-label">${tLang('Trenutni status robe','Current stock status')}</label>
                      <select id="inv-status" class="crm-input">
                          <option value="available">🟢 ${tLang('Slobodno za prodaju', 'Available for sale')}</option>
                          <option value="in_transit">🔵 ${tLang('U tranzitu (na putu)', 'In transit')}</option>
                          <option value="customs">🟠 ${tLang('Na carini / Inspekciji', 'Customs / Inspection')}</option>
                          <option value="reserved">⚫ ${tLang('Rezervisano za kupca', 'Reserved for buyer')}</option>
                      </select>
                      <p class="crm-help">${tLang('Samo "Slobodno za prodaju" ulazi u kalkulaciju slobodnih zaliha.','Only "Available for sale" enters the free-stock calculation.')}</p>
                  </div>
                  <div class="crm-form-actions">
                      <button type="button" id="add-inv-btn" class="crm-btn crm-btn-success">💾 ${Utils.t('actions.save') || tLang('Sačuvaj na lager','Save to inventory')}</button>
                  </div>
              </div>
          </div>
      </div>

      <!-- TAB 4: SPECS & COA -->
      <div id="tab-specs" class="prod-pane hidden space-y-6">
          <div class="bg-slate-50 p-6 rounded-xl border border-slate-200 shadow-sm">
              <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  
                  <div>
                      <h4 class="font-black text-sm uppercase tracking-widest text-slate-800 mb-4 flex items-center gap-2">🧪 Kvalitet & COA Parametri</h4>
                      <p class="text-[10px] text-slate-500 font-bold mb-4">${tLang('Unesite specifikacije iz laboratorijske analize (COA).', 'Enter specs from Certificate of Analysis.')}</p>
                      
                      <div id="coa-list" class="mb-4 max-h-60 overflow-y-auto custom-scrollbar pr-2 space-y-2">${renderCOAList()}</div>
                      
                      <div class="flex flex-col md:flex-row gap-3 border border-blue-200 bg-blue-50 p-4 rounded-xl shadow-sm mt-4">
                          <input id="coa-name" class="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-500" placeholder="${tLang('Parametar (npr. Vlaga)', 'Parameter (e.g. Moisture)')}" />
                          <input id="coa-value" class="w-full bg-white border border-slate-300 rounded-md px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-blue-500" placeholder="${tLang('Vrednost (npr. max 5%)', 'Value (e.g. max 5%)')}" />
                          <button type="button" id="add-coa-btn" class="bg-blue-600 hover:bg-blue-700 text-white font-black px-6 py-2 rounded-lg text-xs shadow-sm transition-colors uppercase tracking-wider w-full md:w-auto">Dodaj</button>
                      </div>
                  </div>

                  <div class="space-y-6">
                      <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                          <h4 class="font-black text-sm uppercase tracking-widest text-slate-800 mb-4 flex items-center gap-2">🚢 Kontejnerska Logistika</h4>
                          <div class="grid grid-cols-2 gap-4">
                              <div><label class="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Capacity 1x20'ft (MT)</label><input name="cap20" type="number" class="w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-sm font-mono text-slate-900 outline-none focus:border-blue-500" value="${item.logistics.cap20 || ''}" placeholder="Npr. 17" /></div>
                              <div><label class="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Capacity 1x40'ft (MT)</label><input name="cap40" type="number" class="w-full bg-slate-50 border border-slate-300 rounded-md px-3 py-2 text-sm font-mono text-slate-900 outline-none focus:border-blue-500" value="${item.logistics.cap40 || ''}" placeholder="Npr. 25" /></div>
                          </div>
                      </div>
                      
                      <div>
                          <label class="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Shelf Life (Rok trajanja)</label>
                          <input name="shelfLife" class="w-full bg-white border border-slate-300 rounded-lg px-4 py-3 text-sm font-bold text-slate-900 focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm" value="${Utils.escapeHtml(item.shelfLife || '')}" placeholder="Npr. 24 meseca" />
                      </div>

                      <div>
                          <label class="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">${Utils.t('fields.detailedSpec')} & Description</label>
                          <textarea name="detailedSpec" class="w-full bg-white border border-slate-300 rounded-lg px-4 py-3 text-sm font-medium text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none transition-all shadow-sm leading-relaxed" rows="5" placeholder="Detaljan opis, proces proizvodnje, uslovi čuvanja...">${Utils.escapeHtml(item.detailedSpec || '')}</textarea>
                      </div>
                  </div>
              </div>
          </div>
      </div>
      
      <!-- FOOTER SAVE BUTTON -->
      <div class="sticky bottom-0 bg-white p-4 border-t border-slate-200 flex justify-end mt-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-10 rounded-b-2xl">
          <button class="bg-white border border-slate-300 text-slate-700 font-bold px-8 py-3 rounded-xl text-sm transition-colors hover:bg-slate-50 mr-4 shadow-sm" type="button" onclick="closeModal()">${tLang('Odustani', 'Cancel')}</button>
          <button class="bg-blue-600 hover:bg-blue-700 text-white px-10 py-3 shadow-xl rounded-xl text-sm font-black uppercase tracking-widest transition-transform transform hover:-translate-y-0.5" type="submit">💾 ${Utils.t('actions.saveChanges') || 'Sačuvaj Proizvod'}</button>
      </div>
    </form>`;
    
    // Uklanjamo p-6 iz modala da bi sticky footer legao lepo
    const mBody = document.getElementById('modal-body');
    if(mBody) { mBody.classList.remove('p-6'); mBody.classList.add('p-0'); }

    Utils.openModal(state.editingItem ? tLang('Uređivanje Proizvoda', 'Edit Product Profile') : tLang('Novi Proizvod u Katalogu', 'Create New Product'), html, async (fd) => {
        const id = state.editingItem?.id || Utils.generateId();

        // P0 FIX: SOFT WARNING for HS Code — earlier v22 hard-block rejected legit codes.
        // Format check (2-10 digits) still blocks obvious typos; unknown codes save with warning.
        const hsIn = String(fd.get('hsCode') || '').trim().replace(/\s|\./g,'');
        if (hsIn && !/^\d{2,10}$/.test(hsIn)) {
            const el = document.querySelector('input[name="hsCode"]');
            if (el) { el.style.borderColor='#dc2626'; el.focus(); setTimeout(()=>el.style.borderColor='',3500); }
            if (typeof showToast === 'function') showToast('✗ HS code must be 2-10 digits (or leave empty).', 'error', 6000);
            return;
        }
        if (hsIn && typeof HS !== 'undefined') {
            const known = HS.chapterName(hsIn.slice(0,2)) || HS.headingName(hsIn.slice(0,4));
            if (!known && typeof showToast === 'function') {
                showToast(`⚠ HS code ${hsIn} not in local bundle — saving anyway. Verify with your customs broker.`, 'warning', 5000);
            }
        }
        // P0 FIX: SOFT WARNING for CAS — format still blocks obvious typos.
        const casIn = String(fd.get('casNumber') || '').trim();
        if (casIn && !/^\d{2,7}-\d{2}-\d$/.test(casIn)) {
            const el = document.querySelector('input[name="casNumber"]');
            if (el) { el.style.borderColor='#dc2626'; el.focus(); setTimeout(()=>el.style.borderColor='',3500); }
            if (typeof showToast === 'function') showToast('✗ CAS format must be XXXXX-XX-X (e.g. 56-81-5), or leave empty.', 'error', 6000);
            return;
        }
        if (casIn) {
            const out = document.getElementById('prod-cas-result');
            try {
                const r = await fetch('/api/geo/chem/cas/' + encodeURIComponent(casIn));
                if (r.status === 404) {
                    if (out) { out.textContent = `⚠ PubChem: CAS ${casIn} not found — saved anyway`; out.style.color = '#a16207'; }
                    if (typeof showToast === 'function') showToast(`⚠ CAS ${casIn} not in PubChem — saved as-is.`, 'warning', 5000);
                } else if (r.ok) {
                    const j = await r.json();
                    if (out) { out.innerHTML = `✓ ${j.name || j.iupac_name || 'valid'} · ${j.formula || ''}`; out.style.color = '#059669'; }
                }
            } catch (_) {
                if (out) { out.textContent = '⚠ PubChem unreachable — CAS saved without verification.'; out.style.color = '#a16207'; }
            }
        }

        const prod = {
             id,
             name: fd.get('name'),
             imageUrl: fd.get('imageUrl'),
             category: fd.get('category'), 
             hsCode: fd.get('hsCode'),
             sku: fd.get('sku'),
             brand: fd.get('brand'),
             casNumber: fd.get('casNumber'),
             shelfLife: fd.get('shelfLife'),
             detailedSpec: fd.get('detailedSpec'), 
             targetPrice: parseFloat(fd.get('targetPrice')) || 0,
             targetCurrency: fd.get('targetCurrency') || 'USD',
             tags: fd.getAll('product_tags'),
             supplyOffers: item.supplyOffers || [], 
             inventory: item.inventory || [],
             coaParams: item.coaParams || [],
             documents: item.documents || [],
             logistics: { cap20: parseFloat(fd.get('cap20')) || null, cap40: parseFloat(fd.get('cap40')) || null },
             lastModified: new Date().toISOString() 
         };
         
         if(state.editingItem) state.data.products[state.data.products.findIndex(p => p.id === id)] = prod; 
         else state.data.products.push(prod);
         
         await saveSingleItem('products', prod); 
         Utils.closeModal(); 
         render(); 
    });

    // Vraćanje paddinga kad se modal zatvori
    const oldClose = window.closeModal;
    window.closeModal = function() {
        if(mBody) { mBody.classList.add('p-6'); mBody.classList.remove('p-0'); }
        oldClose();
        window.closeModal = oldClose; 
    };

    // TAB LOGIC
    document.querySelectorAll('.prod-tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.prod-tab-btn').forEach(b => {
                b.classList.remove('active', 'border-blue-600', 'text-blue-700', 'font-black');
                b.classList.add('border-transparent', 'text-slate-500', 'font-bold');
            });
            const target = e.currentTarget;
            target.classList.add('active', 'border-blue-600', 'text-blue-700', 'font-black');
            target.classList.remove('border-transparent', 'text-slate-500', 'font-bold');
            document.querySelectorAll('.prod-pane').forEach(p => p.classList.add('hidden'));
            document.getElementById(target.dataset.target).classList.remove('hidden');
        });
    });
    
    if(typeof Utils.initAutocomplete === 'function' && typeof COUNTRIES !== 'undefined') Utils.initAutocomplete(document.getElementById('offer-country'), COUNTRIES);
    
    const refreshOffers = () => { document.getElementById('offers-list').innerHTML = renderOffersList(); attachOfferListeners(); };
    const refreshCOA = () => { document.getElementById('coa-list').innerHTML = renderCOAList(); attachCOAListeners(); };
    const refreshInv = () => { document.getElementById('inventory-list').innerHTML = renderInventoryList(); attachInvListeners(); };
    
    const attachCOAListeners = () => {
        document.querySelectorAll('.remove-coa').forEach(b => b.addEventListener('click', e => {
            item.coaParams.splice(parseInt(e.currentTarget.dataset.index, 10), 1); refreshCOA();
        }));
    };
    
    const attachInvListeners = () => {
        document.querySelectorAll('.remove-inv').forEach(b => b.addEventListener('click', async e => {
            const _ok = await window.askConfirm(
                tLang('Obriši stavku?','Delete item?'),
                tLang('Obriši stavku sa lagera?', 'Delete from inventory?'),
                { danger: true }
            );
            if(_ok) { item.inventory.splice(parseInt(e.currentTarget.dataset.index, 10), 1); refreshInv(); }
        }));
    };

    document.getElementById('add-coa-btn').addEventListener('click', () => {
        const name = document.getElementById('coa-name').value.trim(); const val = document.getElementById('coa-value').value.trim();
        if(name && val) { item.coaParams.push({name, value: val}); document.getElementById('coa-name').value=''; document.getElementById('coa-value').value=''; refreshCOA(); }
    });

    document.getElementById('add-inv-btn').addEventListener('click', () => {
        const loc = document.getElementById('inv-loc').value.trim(); const qty = parseFloat(document.getElementById('inv-qty').value); const price = parseFloat(document.getElementById('inv-price').value);
        if(loc && qty > 0) {
            item.inventory.push({ 
                location: loc, batchNo: document.getElementById('inv-batch').value.trim(), 
                qty, purchasePrice: price || 0, currency: document.getElementById('inv-currency').value, 
                expiry: document.getElementById('inv-expiry').value,
                status: document.getElementById('inv-status').value
            });
            ['inv-loc', 'inv-batch', 'inv-qty', 'inv-price', 'inv-expiry'].forEach(id => document.getElementById(id).value = '');
            document.getElementById('inv-status').value = 'available';
            refreshInv();
        } else {
            alert(tLang('Lokacija i Količina su obavezni.', 'Location and Qty are required.'));
        }
    });
    
    const attachOfferListeners = () => {
        document.querySelectorAll('.remove-offer').forEach(b => b.addEventListener('click', async (e) => {
            const _ok = await window.askConfirm(
                tLang('Obriši ponudu?','Delete offer?'),
                tLang('Da li ste sigurni?', 'Are you sure?'),
                { danger: true }
            );
            if(_ok) { item.supplyOffers.splice(parseInt(e.currentTarget.dataset.index, 10), 1); refreshOffers(); }
        }));
        document.querySelectorAll('.edit-offer').forEach(b => b.addEventListener('click', (e) => { 
            currentEditOfferIndex = parseInt(e.currentTarget.dataset.index, 10);
            const o = item.supplyOffers[currentEditOfferIndex];
            document.getElementById('offer-supplier').value = o.supplierId || ''; document.getElementById('offer-qty').value = o.quantity || 0; document.getElementById('offer-moq').value = o.moq || ''; document.getElementById('offer-price').value = o.price || 0; document.getElementById('offer-currency').value = o.currency || 'USD'; document.getElementById('offer-unit').value = o.unit || ''; document.getElementById('offer-incoterm').value = o.incoterm || ''; document.getElementById('offer-country').value = o.country || ''; document.getElementById('offer-validUntil').value = o.validUntil || '';
            // Varijantno specifična polja
            document.getElementById('offer-packaging').value = o.packaging || '';
            document.getElementById('offer-package-weight').value = o.packageWeight || '';
            document.getElementById('offer-leadtime').value = o.leadTime || '';
            document.getElementById('offer-spec').value = o.spec || '';
            
            const currentCerts = o.certificates ? o.certificates.split(', ') : [];
            document.querySelectorAll('input[name="offer_cert"]').forEach(cb => { cb.checked = currentCerts.includes(cb.value); });
            document.getElementById('offer-box-title').innerHTML = `✏️ ${tLang('Izmena Ponude', 'Edit Offer')}`; document.getElementById('cancel-offer-edit').classList.remove('hidden');
            document.getElementById('offer-edit-box').className = 'p-6 border border-amber-300 bg-amber-50 rounded-xl shadow-lg space-y-4 transition-all relative';
            document.getElementById('offer-edit-box').scrollIntoView({ behavior: 'smooth' });
        }));
    };
    
    document.getElementById('cancel-offer-edit').addEventListener('click', () => {
        currentEditOfferIndex = -1;
        ['offer-supplier', 'offer-qty', 'offer-moq', 'offer-price', 'offer-country', 'offer-validUntil'].forEach(id => document.getElementById(id).value = '');
        document.querySelectorAll('input[name="offer_cert"]').forEach(cb => cb.checked = false);
        document.getElementById('offer-box-title').innerHTML = `➕ ${tLang('Dodaj Novu Ponudu', 'Add New Offer')}`; document.getElementById('cancel-offer-edit').classList.add('hidden'); 
        document.getElementById('offer-edit-box').className = 'p-6 border border-slate-300 bg-white rounded-xl shadow-lg space-y-4 transition-all relative';
    });

    document.getElementById('add-offer').addEventListener('click', () => {
        const supId = document.getElementById('offer-supplier').value; const qty = parseFloat(document.getElementById('offer-qty').value) || 0; const moq = parseFloat(document.getElementById('offer-moq').value) || null; const price = parseFloat(document.getElementById('offer-price').value) || 0; const currency = document.getElementById('offer-currency').value; const unit = document.getElementById('offer-unit').value; const country = document.getElementById('offer-country').value.trim(); const incoterm = document.getElementById('offer-incoterm').value; const validUntil = document.getElementById('offer-validUntil').value;
        const certificates = Array.from(document.querySelectorAll('input[name="offer_cert"]:checked')).map(cb => cb.value).join(', ');
        // Varijantno specifična polja - svaka varijanta ima svoju spec/pakovanje/lead time
        const packaging = document.getElementById('offer-packaging')?.value.trim() || '';
        const packageWeight = parseFloat(document.getElementById('offer-package-weight')?.value) || null;
        const leadTime = document.getElementById('offer-leadtime')?.value.trim() || '';
        const spec = document.getElementById('offer-spec')?.value.trim() || '';

        if(!supId || !price || !country) return alert(tLang('Dobavljač, Cena i Poreklo su obavezni!', 'Supplier, Price, and Country are required!'));

        if (currentEditOfferIndex >= 0) {
            const o = item.supplyOffers[currentEditOfferIndex];
            if (o.price !== price || o.incoterm !== incoterm) { o.history = o.history || []; o.history.push({ price: o.price, currency: o.currency, incoterm: o.incoterm, date: new Date().toISOString() }); }
            o.supplierId = supId; o.quantity = qty; o.moq = moq; o.price = price; o.currency = currency; o.unit = unit; o.country = country; o.incoterm = incoterm; o.validUntil = validUntil; o.certificates = certificates;
            o.packaging = packaging; o.packageWeight = packageWeight; o.leadTime = leadTime; o.spec = spec;
        } else item.supplyOffers.push({ supplierId: supId, quantity: qty, moq, price, currency, unit, country, incoterm, validUntil, certificates, packaging, packageWeight, leadTime, spec, history: [] });
        
        document.getElementById('cancel-offer-edit').click(); refreshOffers();
    });
    
    attachCOAListeners(); attachInvListeners(); attachOfferListeners();
}