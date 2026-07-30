// static/js/modules/deals/invoice.js

function renderInvoiceModal(dealId) {
  const deal = state.data.deals.find(d => d.id === dealId); 
  const buyer = state.data.partners.find(p => p.id === deal.buyerId); 
  const product = state.data.products.find(p => p.id === deal.productId);
  const myCompany = state.company || {};
  const initialCurrency = deal.sellingCurrency || deal.currency || 'USD';
  const displayInvNum = ((state.settings.lastInvoiceNumber || 0) + 1) + '/' + new Date().getFullYear();
  const currentVatRate = state.settings.vatRate || 5;

  const tLang = (srStr, enStr) => Utils.getLang() === 'sr' ? srStr : enStr;

  const datalists = `
    <datalist id="inv-payment-terms-list">
      <!-- Advance Payments (T/T) -->
      <option value="100% Advance Payment (T/T)">
      <option value="30% Advance (T/T), 70% Before Shipment">
      <option value="30% Advance (T/T), 70% Against Copy of B/L">
      <option value="50% Advance (T/T), 50% Before Shipment">
      
      <!-- Letters of Credit (L/C) -->
      <option value="100% Irrevocable L/C at Sight">
      <option value="Irrevocable L/C 30 Days">
      <option value="Irrevocable L/C 60 Days">
      <option value="Irrevocable L/C 90 Days">
      
      <!-- Documentary Collections -->
      <option value="CAD (Cash Against Documents)">
      <option value="D/P (Documents Against Payment) at Sight">
      <option value="D/A (Documents Against Acceptance) 30 Days">
      <option value="D/A (Documents Against Acceptance) 60 Days">
      
      <!-- Net Terms / Open Account (O/A) -->
      <option value="Net 15 Days">
      <option value="Net 30 Days">
      <option value="Net 45 Days">
      <option value="Net 60 Days">
      <option value="Net 90 Days">
      <option value="EOM (End of Month)">
    </datalist>

    <datalist id="inv-packaging-list">
      <!-- Bags & Sacks -->
      <option value="10kg PE (Polyethylene) Bags">
      <option value="25kg Multi-wall Kraft Paper Bags">
      <option value="25kg PP Woven Bags">
      <option value="25kg PP Woven Bags with PE Liner">
      <option value="50kg PP Woven Bags">
      
      <!-- FIBC / Jumbo Bags -->
      <option value="500kg FIBC (Jumbo Bags)">
      <option value="1 MT FIBC (Jumbo Bags)">
      <option value="1.2 MT FIBC (Jumbo Bags)">
      
      <!-- Drums & Totes (Liquids/Chemicals) -->
      <option value="200 Liter Steel Drums">
      <option value="200 Liter HDPE Drums">
      <option value="1000 Liter IBC Totes">
      
      <!-- Bulk & Large Containers -->
      <option value="Bulk in 20ft Container">
      <option value="Bulk in 40ft Container">
      <option value="Flexitanks (24,000 Liters)">
      <option value="ISO Tank Container">
      
      <!-- General/Retail Packaging -->
      <option value="Corrugated Carton Boxes">
      <option value="Wooden Crates / Cases">
      <option value="Palletized and Shrink-wrapped">
    </datalist>

    <datalist id="tax-clause-list">
      <!-- Standard International/EU Invoicing Tax Clauses -->
      <option value="${tLang('Oslobođeno PDV-a (Izvoz)', 'VAT Exempt (Export)')}">
      <option value="${tLang('Obrnuto zaduženje', 'Reverse Charge Mechanism')}">
      <option value="${tLang('Isporuka unutar EU (Nulta stopa)', 'Intra-Community Supply (Zero-Rated)')}">
      <option value="${tLang('Uključen PDV', 'VAT Included')}">
      <option value="${tLang('Nulta stopa PDV-a (0%)', 'Zero Rated VAT (0%)')}">
      <option value="${tLang('Van sistema PDV-a', 'Out of Scope of VAT')}">
      <option value="${tLang('Standardna stopa PDV-a', 'Standard Rate VAT')}">
    </datalist>
`;

  const consigneeOptions = state.data.partners.map(p => `<option value="${p.id}">${Utils.escapeHtml(p.companyName)}</option>`).join('');

  const html = `${datalists}<div class="p-4" id="invoice-container">
    <div id="invoice-controls" class="p-5 bg-[var(--panel)] rounded-xl mb-4 border border-[var(--border)] shadow-sm text-main">
      
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 border-b border-[var(--border)] border-dashed pb-5">
         <div>
             <strong class="text-xs uppercase tracking-wider text-[var(--muted)] mb-2 block">${Utils.t('invoice.doc_type_options')}:</strong>
             <div class="space-y-1">
                 <label class="flex items-center text-sm font-bold cursor-pointer"><input type="radio" name="doc_type" value="proforma" checked class="mr-2 text-blue-600 focus:ring-blue-500 w-4 h-4"> ${Utils.t('invoice.type_proforma')}</label>
                 <label class="flex items-center text-sm font-bold cursor-pointer"><input type="radio" name="doc_type" value="invoice" class="mr-2 text-blue-600 focus:ring-blue-500 w-4 h-4"> ${tLang('Komercijalna Faktura', 'Commercial Invoice')}</label>
             </div>
         </div>
         <div>
             <strong class="text-xs uppercase tracking-wider text-[var(--muted)] mb-2 block">${Utils.t('invoice.vat_options')}:</strong>
             <div class="space-y-1">
                 <label class="flex items-center text-sm font-bold cursor-pointer"><input type="radio" name="vat_option" value="none" checked class="mr-2 text-blue-600 focus:ring-blue-500 w-4 h-4"> ${Utils.t('invoice.no_vat')}</label>
                 <label class="flex items-center text-sm font-bold cursor-pointer"><input type="radio" name="vat_option" value="exclusive" class="mr-2 text-blue-600 focus:ring-blue-500 w-4 h-4"> ${Utils.t('invoice.vat_exclusive')}</label>
                 <label class="flex items-center text-sm font-bold cursor-pointer"><input type="radio" name="vat_option" value="inclusive" class="mr-2 text-blue-600 focus:ring-blue-500 w-4 h-4"> ${Utils.t('invoice.vat_inclusive')}</label>
             </div>
         </div>
         <div>
             <label class="block text-xs font-bold text-[var(--muted)] uppercase tracking-wider mb-2">${Utils.t('fields.currency')}</label>
             <select id="inv-currency" class="form-input text-main font-bold border-blue-400 focus:ring-blue-500 bg-[var(--card)] shadow-inner">
                 ${(typeof CURRENCIES !== 'undefined' ? CURRENCIES : ['USD', 'EUR']).map(c=>`<option value="${c}" ${c===initialCurrency?'selected':''}>${c}</option>`).join('')}
             </select>
             <div id="currency-warning" class="text-[10px] text-orange-600 font-bold mt-1 hidden">⚠️ Nema unetog računa za ovu valutu!</div>
         </div>
         <div class="flex flex-col gap-2 justify-end">
             <button id="print-invoice-btn" class="btn bg-blue-600 hover:bg-blue-700 text-white w-full py-3 shadow-lg font-black text-lg transition-transform transform hover:-translate-y-0.5">🖨️ ${Utils.t('invoice.print')}</button>
             <button id="send-invoice-btn" class="btn bg-green-600 hover:bg-green-700 text-white w-full py-3 shadow-lg font-black text-lg transition-transform transform hover:-translate-y-0.5">📬 ${tLang('Pošalji', 'Send')}</button>
         </div>
      </div>
      
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 border-b border-[var(--border)] border-dashed pb-5">
          <div><label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">PO Number / Contract Ref</label><input id="inv-po-num" class="form-input bg-[var(--card)]" value="" placeholder="e.g. PO-2026-881" /></div>
          <div><label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">${tLang('Popust (Discount)', 'Discount')}</label><input id="inv-discount" type="number" step="0.01" class="form-input bg-[var(--card)] text-red-500 font-bold" value="0" placeholder="0.00" /></div>
          <div class="md:col-span-2"><label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">${tLang('Već Uplaćen Avans', 'Less Advance Payment')}</label><input id="inv-advance" type="number" step="0.01" class="form-input bg-[var(--card)] text-green-600 font-bold" value="0" placeholder="0.00" /></div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mt-5 border-b border-[var(--border)] border-dashed pb-5">
          <div class="md:col-span-2"><label class="block text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1">${tLang('Primalac (Consignee - Ship To)', 'Consignee (Ship To)')}</label><select id="inv-consignee" class="form-input bg-[var(--card)]"><option value="">-- Ista firma kao Kupac --</option>${consigneeOptions}</select></div>
          
          <div><label class="block text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1">${Utils.t('invoice.paymentTerms')}</label><input id="inv-pay-terms" list="inv-payment-terms-list" class="form-input bg-[var(--card)]" value="" placeholder="${Utils.t('placeholders.pay')}" /></div>
          <div><label class="block text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1">${tLang('Poreska Klauzula', 'Tax Clause')}</label><input id="inv-tax-clause" list="tax-clause-list" class="form-input bg-[var(--card)]" value="" placeholder="e.g. VAT Exempt" /></div>

          <div class="inv-transport-field"><label class="block text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1">Vessel / Truck</label><input id="inv-vessel" class="form-input bg-[var(--card)]" value="" placeholder="e.g. MSC DANIELA V.123" /></div>
          <div class="inv-transport-field"><label class="block text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1">${tLang('Br. Kontejnera', 'Container No.')}</label><input id="inv-container" class="form-input bg-[var(--card)]" value="" placeholder="e.g. HLBU1234567" /></div>
          <div class="inv-transport-field"><label class="block text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1">B/L Number</label><input id="inv-bl-num" class="form-input bg-[var(--card)] font-mono" value="" placeholder="Bill of Lading No." /></div>
          <div class="inv-transport-field"><label class="block text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1">${tLang('Datum Utovara', 'Date of Shipment')}</label><input type="date" id="inv-ship-date" class="form-input bg-[var(--card)]" /></div>
          <div class="inv-transport-field"><label class="block text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1">${Utils.t('invoice.pol')}</label><input id="inv-pol" class="form-input bg-[var(--card)]" value="" placeholder="${Utils.t('placeholders.pol')}" /></div>
          <div class="inv-transport-field"><label class="block text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1">${Utils.t('invoice.pod')}</label><input id="inv-pod" class="form-input bg-[var(--card)]" value="${Utils.escapeHtml(deal.deliveryLocation || '')}" placeholder="${Utils.t('placeholders.pod')}" /></div>
          
          <div><label class="block text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1">${Utils.t('invoice.packaging')}</label><input id="inv-packaging" list="inv-packaging-list" class="form-input bg-[var(--card)]" value="" placeholder="${Utils.t('placeholders.pack')}" /></div>
          <div><label class="block text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1">Net Weight (${deal.unit})</label><input id="inv-net-weight" type="number" step="0.001" class="form-input bg-[var(--card)]" value="${deal.quantity}" /></div>
          <div><label class="block text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1">Gross Weight (${deal.unit})</label><input id="inv-gross-weight" type="number" step="0.001" class="form-input bg-[var(--card)]" placeholder="e.g. 50.150" /></div>
          <div><label class="block text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1">Volume (CBM)</label><input id="inv-cbm" type="number" step="0.01" class="form-input bg-[var(--card)]" placeholder="e.g. 65.50" /></div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mt-5 border-b border-[var(--border)] border-dashed pb-5">
          <div class="md:col-span-2">
              <label class="block text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1 flex items-center gap-2">🏦 ${Utils.t('invoice.bankDetailsEdit')}</label>
              <textarea id="inv-bank-details" class="form-input font-mono text-xs bg-blue-50 dark:bg-blue-900/10 border-blue-200 shadow-inner" rows="4"></textarea>
          </div>
          <div class="md:col-span-2">
              <label class="block text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider mb-1">📝 ${Utils.t('fields.notes')}</label>
              <textarea id="inv-notes" class="form-input bg-[var(--card)] text-sm" rows="4">${Utils.escapeHtml(state.settings.defaultInvoiceNotes || '')}</textarea>
          </div>
      </div>
      
      <div class="mt-5">
         <div class="flex justify-between items-center mb-3 border-b border-[var(--border)] pb-2">
             <strong class="text-sm font-black uppercase tracking-wider flex items-center gap-2">🛠️ ${Utils.t('invoice.additional_services')}</strong>
             <button id="add-inv-service-btn" class="btn small bg-[var(--card)] border border-[var(--border)] font-bold">+ ${Utils.t('actions.addService')}</button>
         </div>
         <div id="inv-services-list" class="space-y-2"></div>
      </div>
    </div>
    
    <div id="invoice-body" class="p-8 bg-white text-black shadow-2xl rounded-2xl border border-gray-200">
        <header class="flex justify-between items-start mb-8 border-b-4 border-gray-800 pb-6">
            <div>
                <h1 class="text-4xl font-extrabold uppercase text-gray-900 tracking-widest" id="invoice-main-title">${Utils.t('invoice.type_proforma')}</h1>
            </div>
            <div class="text-sm bg-gray-50 p-4 rounded-lg border border-gray-200">
                <table class="text-right">
                    <tr><td class="pr-4 font-bold text-gray-500 uppercase text-xs tracking-wider">${Utils.t('invoice.invoice_no')}:</td><td class="font-black text-lg text-gray-900">${Utils.escapeHtml(deal.contractId)} (${displayInvNum})</td></tr>
                    <tr><td class="pr-4 font-bold text-gray-500 uppercase text-xs tracking-wider">${Utils.t('invoice.date_of_issue')}:</td><td class="font-bold">${new Date().toLocaleDateString(state.lang)}</td></tr>
                    <tr id="disp-po-row" class="hidden"><td class="pr-4 font-bold text-blue-600 uppercase text-xs tracking-wider">PO Number:</td><td class="font-black text-blue-900" id="disp-po-num"></td></tr>
                </table>
            </div>
        </header>
    
        <section class="grid grid-cols-2 gap-8 mb-8">
            <div class="bg-blue-50/50 p-5 rounded-lg border border-blue-100">
                <h4 class="font-black mb-3 border-b-2 border-blue-800 text-blue-900 pb-1 uppercase tracking-wider text-xs">${Utils.t('invoice.to')} (BILL TO):</h4>
                <p class="text-lg text-gray-900 font-black mb-1">${Utils.escapeHtml(buyer?.companyName || '')}</p>
                <p class="text-gray-700 leading-tight">${Utils.escapeHtml(buyer?.address?.street || '')}</p>
                <p class="text-gray-700 leading-tight">${Utils.escapeHtml(buyer?.address?.city || '')}, ${Utils.escapeHtml(buyer?.address?.zip || '')}</p>
                <p class="text-gray-700 font-bold leading-tight">${Utils.escapeHtml(buyer?.address?.country || '')}</p>
                <p class="mt-2 text-xs font-bold text-gray-500 uppercase">${Utils.t('settings.taxId')}: <span class="text-gray-900">${Utils.escapeHtml(buyer?.taxId || '')}</span></p>
            </div>
            <div class="bg-indigo-50/50 p-5 rounded-lg border border-indigo-100">
                <h4 class="font-black mb-3 border-b-2 border-indigo-800 text-indigo-900 pb-1 uppercase tracking-wider text-xs">${tLang('Primalac (SHIP TO)', 'Consignee (SHIP TO)')}:</h4>
                <div id="disp-consignee-details" class="text-sm"></div>
            </div>
        </section>
        
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-sm border-l-4 border-gray-800 pl-5 py-3 bg-gray-50">
            <div><strong class="text-gray-500 uppercase text-[10px] tracking-wider">${Utils.t('fields.incoterm')}:</strong><br> <span class="font-black text-gray-900">${Utils.escapeHtml(deal.incoterm || 'N/A')}</span></div>
            <div><strong class="text-gray-500 uppercase text-[10px] tracking-wider">${Utils.t('invoice.packaging')}:</strong><br> <span id="disp-inv-packaging" class="font-bold text-gray-900"></span></div>
            <div class="col-span-2"><strong class="text-gray-500 uppercase text-[10px] tracking-wider">${Utils.t('invoice.paymentTerms')}:</strong><br> <span id="disp-pay-terms" class="text-red-700 bg-red-50 px-1 py-0.5 rounded font-black"></span></div>
            
            <div class="inv-transport-field mt-2 border-t border-gray-300 pt-2"><strong class="text-gray-500 uppercase text-[10px] tracking-wider">Vessel / Truck:</strong><br> <span id="disp-vessel" class="font-bold text-gray-900"></span></div>
            <div class="inv-transport-field mt-2 border-t border-gray-300 pt-2"><strong class="text-gray-500 uppercase text-[10px] tracking-wider">Container No:</strong><br> <span id="disp-container" class="font-bold text-gray-900"></span></div>
            <div class="inv-transport-field mt-2 border-t border-gray-300 pt-2"><strong class="text-gray-500 uppercase text-[10px] tracking-wider">B/L Number:</strong><br> <span id="disp-bl-num" class="font-bold text-gray-900"></span></div>
            <div class="inv-transport-field mt-2 border-t border-gray-300 pt-2"><strong class="text-gray-500 uppercase text-[10px] tracking-wider">${tLang('Datum Utovara', 'Date of Shipment')}:</strong><br> <span id="disp-ship-date" class="font-bold text-gray-900"></span></div>
            
            <div class="inv-transport-field mt-2 border-t border-gray-300 pt-2"><strong class="text-gray-500 uppercase text-[10px] tracking-wider">${Utils.t('invoice.pol')}:</strong><br> <span id="disp-pol" class="font-bold text-gray-900"></span></div>
            <div class="inv-transport-field mt-2 border-t border-gray-300 pt-2"><strong class="text-gray-500 uppercase text-[10px] tracking-wider">${Utils.t('invoice.pod')}:</strong><br> <span id="disp-pod" class="font-bold text-gray-900"></span></div>
        </div>

        <div class="flex justify-between items-center bg-gray-100 p-3 rounded-lg mb-6 text-sm">
            <div><strong class="text-gray-500 uppercase text-xs">Net Weight:</strong> <span id="disp-net-weight" class="font-bold ml-1"></span></div>
            <div><strong class="text-gray-500 uppercase text-xs">Gross Weight:</strong> <span id="disp-gross-weight" class="font-bold ml-1"></span></div>
            <div><strong class="text-gray-500 uppercase text-xs">Volume (CBM):</strong> <span id="disp-cbm" class="font-bold ml-1"></span></div>
        </div>
        
        <table class="invoice-table text-black border-collapse w-full text-left mb-6 shadow-sm rounded-lg overflow-hidden">
            <thead>
                <tr>
                    <th class="border border-gray-300 p-3 bg-gray-800 text-white uppercase text-xs tracking-wider">${Utils.t('invoice.description')}</th>
                    <th class="border border-gray-300 p-3 bg-gray-800 text-white uppercase text-xs tracking-wider text-right">${Utils.t('invoice.quantity')}</th>
                    <th class="border border-gray-300 p-3 bg-gray-800 text-white uppercase text-xs tracking-wider text-right">${Utils.t('invoice.unit_price')}</th>
                    <th class="border border-gray-300 p-3 bg-gray-800 text-white uppercase text-xs tracking-wider text-right">${Utils.t('invoice.total')}</th>
                </tr>
            </thead>
            <tbody id="invoice-table-body" class="bg-white"></tbody>
        </table>
        
        <section class="invoice-summary flex justify-end bg-gray-50 p-4 rounded-lg border border-gray-200">
            <table class="w-2/3 md:w-1/2">
                <tr><td class="p-2 text-gray-600 font-bold uppercase text-xs tracking-wider">${Utils.t('invoice.subtotal')}:</td><td class="text-right p-2 font-bold" id="invoice-subtotal"></td></tr>
                <tr id="discount-row" class="hidden"><td class="p-2 text-red-600 font-bold uppercase text-xs tracking-wider">Discount:</td><td class="text-right p-2 font-bold text-red-600" id="invoice-discount"></td></tr>
                <tr id="vat-row" class="hidden"><td class="p-2 text-gray-600 font-bold uppercase text-xs tracking-wider">${Utils.t('invoice.vat_5').replace('5', currentVatRate)}:</td><td class="text-right p-2 font-bold" id="invoice-vat"></td></tr>
                <tr class="font-black text-xl text-gray-900 border-t-2 border-gray-400">
                    <td class="p-2 pt-3 uppercase tracking-wider text-sm">${Utils.t('invoice.grand_total')}:</td>
                    <td class="text-right p-2 pt-3 text-blue-800" id="invoice-total"></td>
                </tr>
                <tr id="advance-row" class="hidden"><td class="p-2 text-green-600 font-bold uppercase text-xs tracking-wider">Less Advance Payment:</td><td class="text-right p-2 font-bold text-green-600" id="invoice-advance"></td></tr>
                <tr id="balance-row" class="hidden font-black text-2xl border-t-4 border-gray-800">
                    <td class="p-2 pt-4 uppercase tracking-wider text-sm text-red-700">BALANCE DUE:</td>
                    <td class="text-right p-2 pt-4 text-red-700" id="invoice-balance"></td>
                </tr>
                <tr id="disp-tax-row"><td class="p-2 pt-4 text-gray-500 font-bold uppercase text-[10px] tracking-wider border-t border-gray-300">Tax Clause:</td><td class="text-right p-2 pt-4 font-bold text-gray-700 border-t border-gray-300" id="disp-inv-tax-clause"></td></tr>
            </table>
        </section>

        <section class="mt-8">
            <h4 class="font-black mb-2 border-b-2 border-gray-800 text-gray-900 pb-1 uppercase tracking-wider text-xs">🏦 ${Utils.t('invoice.bank_details')}:</h4>
            <p id="disp-bank-details" class="whitespace-pre-wrap text-xs font-mono text-gray-800 leading-relaxed"></p>
        </section>
        
        <div class="mt-8 bg-yellow-50 p-4 rounded-lg border border-yellow-200">
            <h4 class="font-black text-yellow-800 uppercase tracking-wider text-[10px] mb-1">⚠️ ${Utils.t('invoice.remarks')}</h4>
            <p id="disp-inv-notes" class="text-xs font-medium text-yellow-900 whitespace-pre-wrap leading-relaxed"></p>
        </div>
    </div></div>`;
    
  Utils.openModal(Utils.t('invoice.generate'), html, null); 
  const mContent = document.getElementById('modal-content') || document.getElementById('offer-modal-content') || document.getElementById('invoice-modal-content');
  if (mContent) mContent.id = 'invoice-modal-content';
  
  const curInp = document.getElementById('inv-currency'); 
  const svcsList = document.getElementById('inv-services-list'); 
  const tBody = document.getElementById('invoice-table-body');
  const bankTextarea = document.getElementById('inv-bank-details');
  const currencyWarning = document.getElementById('currency-warning');
  
  const updateBankDetailsForCurrency = (currency) => {
      const accounts = state.company?.bankAccounts || [];
      const matchingAcc = accounts.find(a => a.currency === currency);
      if (matchingAcc) {
          currencyWarning.classList.add('hidden');
          bankTextarea.value = `${Utils.t('invoice.bank') || 'Bank'}: ${matchingAcc.bankName}\nAccount/IBAN: ${matchingAcc.accountNumber}\nSWIFT/BIC: ${matchingAcc.swiftCode || '-'}`;
      } else {
          currencyWarning.classList.remove('hidden');
          if (accounts.length > 0) {
              const fallback = accounts[0];
              bankTextarea.value = `${Utils.t('invoice.bank') || 'Bank'}: ${fallback.bankName}\nAccount/IBAN: ${fallback.accountNumber}\nSWIFT/BIC: ${fallback.swiftCode || '-'} \n(Note: Convert to ${fallback.currency})`;
          } else {
              bankTextarea.value = `Bank: N/A\nAccount/IBAN: N/A\nSWIFT/BIC: N/A\n(Please update company settings)`;
          }
      }
  };

  updateBankDetailsForCurrency(curInp.value);

  const toggleInvTransport = () => {
      const isExw = ['EXW', 'FCA'].includes((deal.incoterm || '').toUpperCase());
      document.querySelectorAll('.inv-transport-field').forEach(el => {
          el.style.display = isExw ? 'none' : 'block';
      });
  };

  const calc = () => {
      toggleInvTransport();
      
      const vOpt = document.querySelector('input[name="vat_option"]:checked').value; 
      const docType = document.querySelector('input[name="doc_type"]:checked').value;
      const curr = curInp.value; 
      const selectedUnit = deal.unit;
      const bTotal = deal.sellingPrice * deal.quantity;
      let servicesTotal = 0;
      
      const vatMult = currentVatRate / 100;
      const vatDiv = 1 + vatMult;
      
      const poNum = document.getElementById('inv-po-num').value.trim();
      if(poNum) {
          document.getElementById('disp-po-row').classList.remove('hidden');
          document.getElementById('disp-po-num').innerText = poNum;
      } else {
          document.getElementById('disp-po-row').classList.add('hidden');
      }

      const consigneeId = document.getElementById('inv-consignee').value;
      if (consigneeId) {
          const cons = state.data.partners.find(p => p.id === consigneeId);
          if (cons) {
              document.getElementById('disp-consignee-details').innerHTML = `<p class="text-lg text-indigo-900 font-black mb-1">${Utils.escapeHtml(cons.companyName)}</p><p class="text-gray-700 leading-tight">${Utils.escapeHtml(cons.address?.street || '')}</p><p class="text-gray-700 leading-tight">${Utils.escapeHtml(cons.address?.city || '')}, ${Utils.escapeHtml(cons.address?.zip || '')}</p><p class="text-gray-700 font-bold leading-tight">${Utils.escapeHtml(cons.address?.country || '')}</p>`;
          }
      } else {
          document.getElementById('disp-consignee-details').innerHTML = `<p class="text-sm italic text-gray-500 mt-2">SAME AS BUYER</p>`;
      }

      document.getElementById('invoice-main-title').innerText = docType === 'proforma' ? Utils.t('invoice.type_proforma') : tLang('KOMERCIJALNA FAKTURA', 'COMMERCIAL INVOICE');
      document.getElementById('disp-bank-details').innerText = bankTextarea.value;
      document.getElementById('disp-inv-notes').innerText = document.getElementById('inv-notes').value;
      
      document.getElementById('disp-vessel').innerText = document.getElementById('inv-vessel').value || 'TBA';
      document.getElementById('disp-container').innerText = document.getElementById('inv-container').value || 'TBA';
      document.getElementById('disp-bl-num').innerText = document.getElementById('inv-bl-num').value || 'TBA';
      const sDate = document.getElementById('inv-ship-date').value;
      document.getElementById('disp-ship-date').innerText = sDate ? new Date(sDate).toLocaleDateString(state.lang) : 'TBA';

      document.getElementById('disp-pol').innerText = document.getElementById('inv-pol').value || 'N/A';
      document.getElementById('disp-pod').innerText = document.getElementById('inv-pod').value || 'N/A';
      document.getElementById('disp-inv-packaging').innerText = document.getElementById('inv-packaging').value || 'N/A';
      document.getElementById('disp-pay-terms').innerText = document.getElementById('inv-pay-terms').value || 'TBA';
      
      const taxClauseVal = document.getElementById('inv-tax-clause').value;
      if (taxClauseVal) {
          document.getElementById('disp-tax-row').classList.remove('hidden');
          document.getElementById('disp-inv-tax-clause').innerText = taxClauseVal;
      } else {
          document.getElementById('disp-tax-row').classList.add('hidden');
      }

      document.getElementById('disp-net-weight').innerText = `${document.getElementById('inv-net-weight').value || 0} ${selectedUnit}`;
      document.getElementById('disp-gross-weight').innerText = `${document.getElementById('inv-gross-weight').value || 0} ${selectedUnit}`;
      document.getElementById('disp-cbm').innerText = document.getElementById('inv-cbm').value || '0.00';

      const extraRows = [];
      document.querySelectorAll('.inv-svc-item').forEach(el => {
          const n = el.querySelector('.svc-name').value; const p = parseFloat(el.querySelector('.svc-price').value) || 0;
          if(n && p > 0) {
              servicesTotal += p;
              extraRows.push(`<tr><td class="border border-gray-300 p-3 font-medium text-gray-700">${Utils.escapeHtml(n)}</td><td class="border border-gray-300 p-3 text-right font-medium text-gray-700">1</td><td class="border border-gray-300 p-3 text-right font-medium text-gray-700">${Utils.formatCurrency(p, curr)}</td><td class="border border-gray-300 p-3 text-right font-bold text-gray-900">${Utils.formatCurrency(p, curr)}</td></tr>`);
          }
      });
      
      let baseTotal = bTotal + servicesTotal;
      let subtotal = baseTotal; let vatAmt = 0;
      
      const discount = parseFloat(document.getElementById('inv-discount').value) || 0;
      const advance = parseFloat(document.getElementById('inv-advance').value) || 0;

      if (discount > 0) {
          baseTotal -= discount;
          document.getElementById('discount-row').classList.remove('hidden');
          document.getElementById('invoice-discount').innerText = `- ${Utils.formatCurrency(discount, curr)}`;
      } else {
          document.getElementById('discount-row').classList.add('hidden');
      }

      if(vOpt === 'inclusive') { subtotal = baseTotal / vatDiv; vatAmt = baseTotal - subtotal; } 
      else if(vOpt === 'exclusive') { vatAmt = baseTotal * vatMult; baseTotal = baseTotal + vatAmt; }
      
      tBody.innerHTML = `<tr><td class="border border-gray-300 p-3"><strong class="text-blue-900 text-lg">${Utils.escapeHtml(product?.name || '')}</strong></td><td class="border border-gray-300 p-3 text-right font-bold text-gray-800">${deal.quantity} ${selectedUnit}</td><td class="border border-gray-300 p-3 text-right font-bold text-gray-800">${Utils.formatCurrency(deal.sellingPrice, curr)}</td><td class="border border-gray-300 p-3 text-right font-black text-gray-900 text-lg">${Utils.formatCurrency(bTotal, curr)}</td></tr>` + extraRows.join('');
      
      document.getElementById('invoice-subtotal').innerText = Utils.formatCurrency(subtotal, curr);
      const vr = document.getElementById('vat-row');
      if(vOpt !== 'none' && vatAmt > 0) { vr.classList.remove('hidden'); document.getElementById('invoice-vat').innerText = Utils.formatCurrency(vatAmt, curr); } else { vr.classList.add('hidden'); }
      document.getElementById('invoice-total').innerText = Utils.formatCurrency(baseTotal, curr);

      if (advance > 0) {
          document.getElementById('advance-row').classList.remove('hidden');
          document.getElementById('invoice-advance').innerText = `- ${Utils.formatCurrency(advance, curr)}`;
          document.getElementById('balance-row').classList.remove('hidden');
          document.getElementById('invoice-balance').innerText = Utils.formatCurrency(baseTotal - advance, curr);
      } else {
          document.getElementById('advance-row').classList.add('hidden');
          document.getElementById('balance-row').classList.add('hidden');
      }
  };
  
  document.querySelectorAll('input[name="vat_option"], input[name="doc_type"]').forEach(r => r.addEventListener('change', calc));
  curInp.addEventListener('change', (e) => { updateBankDetailsForCurrency(e.target.value); calc(); });
  
  document.querySelectorAll('#inv-bank-details, #inv-notes, #inv-tax-clause, #inv-pol, #inv-pod, #inv-packaging, #inv-pay-terms, #inv-po-num, #inv-consignee, #inv-vessel, #inv-container, #inv-bl-num, #inv-ship-date, #inv-net-weight, #inv-gross-weight, #inv-cbm, #inv-discount, #inv-advance').forEach(el => el.addEventListener('input', calc));
  
  document.getElementById('add-inv-service-btn').addEventListener('click', () => {
      const id = Date.now();
      svcsList.insertAdjacentHTML('beforeend', `<div class="flex gap-2 mb-2 inv-svc-item" id="inv-svc-${id}"><input class="form-input text-main svc-name" placeholder="${Utils.t('invoice.service_name')}"><input type="number" step="0.01" class="form-input text-main w-32 svc-price font-bold" placeholder="${Utils.t('invoice.service_price')}"><button class="btn small bg-red-100 text-red-600 border border-red-200" onclick="this.parentElement.remove(); document.getElementById('inv-currency').dispatchEvent(new Event('change'));">✕</button></div>`);
      document.querySelectorAll('.svc-name, .svc-price').forEach(el => el.addEventListener('input', calc));
  });
  
  const executePdfGeneration = async (actionType, btnId) => {
      const btn = document.getElementById(btnId); 
      const originalText = btn.innerHTML;
      btn.innerHTML = `⏳ ${Utils.t('misc.creatingPdfStatus')}`; btn.disabled = true;
      
      const vOpt = document.querySelector('input[name="vat_option"]:checked').value;
      const docType = document.querySelector('input[name="doc_type"]:checked').value;
      const curr = curInp.value; const selectedUnit = deal.unit;
      const bTotal = deal.sellingPrice * deal.quantity;
      let servicesTotal = 0; const svcs = [];
      
      document.querySelectorAll('.inv-svc-item').forEach(el => {
          const n = el.querySelector('.svc-name').value; const p = parseFloat(el.querySelector('.svc-price').value) || 0;
          if(n && p > 0) { servicesTotal += p; svcs.push({desc: n, hsCode: '', qty: 1, unit: 'srv', price: p, total: p}); }
      });
      
      let baseTotal = bTotal + servicesTotal; let subtotal = baseTotal; let vatAmt = 0;
      const discount = parseFloat(document.getElementById('inv-discount').value) || 0;
      const advance = parseFloat(document.getElementById('inv-advance').value) || 0;

      if (discount > 0) baseTotal -= discount;

      if(vOpt === 'inclusive') { subtotal = baseTotal / (1 + currentVatRate / 100); vatAmt = baseTotal - subtotal; } 
      else if(vOpt === 'exclusive') { vatAmt = baseTotal * (currentVatRate / 100); baseTotal = baseTotal + vatAmt; }
      
      const consigneeId = document.getElementById('inv-consignee').value;
      const consigneePartner = consigneeId ? state.data.partners.find(p => p.id === consigneeId) : null;

      const filename = `${docType === 'proforma' ? 'Proforma' : 'Commercial_Invoice'}_${displayInvNum.replace(/\//g,'_')}.pdf`;
      const pdfData = {
          type: docType,
          documentNo: `${deal.contractId} (${displayInvNum})`,
          poNumber: document.getElementById('inv-po-num').value.trim(),
          date: new Date().toISOString(),
          validUntil: deal.paymentDates?.buyer || '',
          customer: buyer,
          consignee: consigneePartner,
          productName: product?.name || 'N/A',
          hsCode: product?.hsCode || 'N/A', // Za unazadnu kompatibilnost
          detailedSpec: product?.detailedSpec || '',
          currency: curr,
          logistics: {
              origin: product?.supplyOffers?.[0]?.country || 'N/A',
              incoterm: deal.incoterm || 'N/A',
              vessel: document.getElementById('inv-vessel').value,
              containerNo: document.getElementById('inv-container').value,
              blNumber: document.getElementById('inv-bl-num').value,
              shipmentDate: document.getElementById('inv-ship-date').value,
              pol: document.getElementById('inv-pol').value || 'N/A',
              pod: document.getElementById('inv-pod').value || 'N/A',
              packaging: document.getElementById('inv-packaging').value || 'N/A',
              paymentTerms: document.getElementById('inv-pay-terms').value || 'TBA',
          },
          taxClause: document.getElementById('inv-tax-clause').value || '',
          weights: {
              net: document.getElementById('inv-net-weight').value || 0,
              gross: document.getElementById('inv-gross-weight').value || 0,
              cbm: document.getElementById('inv-cbm').value || 0,
              unit: selectedUnit
          },
          items: [
              { desc: product?.name || 'N/A', hsCode: product?.hsCode || '', qty: deal.quantity, unit: selectedUnit, price: deal.sellingPrice, total: bTotal },
              ...svcs
          ],
          discount: discount,
          subtotal: subtotal,
          vat: vatAmt,
          customVatRate: currentVatRate,
          grandTotal: baseTotal,
          advance: advance,
          balance: baseTotal - advance,
          bankDetails: bankTextarea.value,
          notes: document.getElementById('inv-notes').value
      };
      
      if(typeof generateNativePDF === 'function') {
          await generateNativePDF(pdfData, filename, actionType);
          
          if (actionType === 'download') {
              state.settings.lastInvoiceNumber = (state.settings.lastInvoiceNumber || 0) + 1;
              await saveToStorage('settings');
              
              if (buyer) {
                  buyer.activities = buyer.activities || [];
                  buyer.activities.unshift({ id: Utils.generateId(), date: new Date().toISOString(), type: 'Invoice Issued', note: `Generated PDF for Invoice/Proforma No. ${displayInvNum}.` });
                  await saveSingleItem('partners', buyer);
              }
          }
      } else if (typeof showToast === 'function') { showToast('PDF module missing.', 'error'); } else alert("PDF module missing.");
      
      btn.innerHTML = originalText; btn.disabled = false;
  };

  document.getElementById('print-invoice-btn').addEventListener('click', () => executePdfGeneration('download', 'print-invoice-btn'));
  document.getElementById('send-invoice-btn').addEventListener('click', () => executePdfGeneration('send', 'send-invoice-btn'));
  calc();
}