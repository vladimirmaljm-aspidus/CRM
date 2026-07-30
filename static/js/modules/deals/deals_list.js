// static/js/modules/deals/deals_list.js
function renderDealsListView() {
    const main = document.getElementById('main-content');
    if(!main) return;
    
    const header = Utils.createViewHeader(Utils.t('nav.deals'), Utils.t('add.deal'), () => showDealForm());
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn bg-[var(--panel)] border border-[var(--border)] ml-4 hover:bg-[var(--hover-bg)] text-main'; 
    toggleBtn.innerText = `📋 ${Utils.t('actions.kanban_view')}`;
    toggleBtn.onclick = () => { renderDealsKanbanView(); };
    header.querySelector('h2').appendChild(toggleBtn);
    main.appendChild(header);

    const data = Utils.applyFiltersFor('deals');
    const container = document.createElement('div'); 
    container.className = 'overflow-x-auto bg-[var(--card)] rounded-2xl shadow-xl p-4 border border-[var(--border)]';

    const tableHeader = `<thead class="text-xs text-[var(--muted)] uppercase bg-[var(--hover-bg)]"><tr><th class="px-4 py-3 text-left font-bold">${Utils.t('finances.deal')}</th><th class="px-4 py-3 text-left font-bold">${Utils.t('deals.purchaseValue')}</th><th class="px-4 py-3 text-left font-bold">${Utils.t('deals.saleValue')}</th><th class="px-4 py-3 text-left font-bold">${Utils.t('deals.netProfit')}</th><th class="px-4 py-3 text-left font-bold">${Utils.t('finances.paymentStatus')}</th><th class="px-4 py-3 text-right font-bold">${Utils.t('actions.details')}</th></tr></thead>`;
    
    const tableBody = `<tbody class="divide-y divide-[var(--border)] bg-[var(--card)]">${data.map(d => {
        const exRate = d.exchangeRate || 1;
        const origPurchaseVal = (d.purchasePrice || 0) * (d.quantity || 1);
        const purchaseValue = origPurchaseVal * exRate;
        const saleValue = (d.sellingPrice || 0) * (d.quantity || 1);
        const totalCosts = d.costs ? d.costs.reduce((s,c)=>s+(c.amount||0),0) * exRate : 0;
        const bankCosts = (d.bankCosts || 0) * exRate;
        const baseProfit = saleValue - purchaseValue - totalCosts - bankCosts;
        
        // FIX: Rešen ReferenceError dodavanjem proverenog poziva DealsCalculations
        let commission = 0;
        if(typeof DealsCalculations !== 'undefined') {
            commission = DealsCalculations.calculateTotalCommission(d, baseProfit);
        }
        const netProfit = baseProfit - commission;
        
        const pCur = d.purchaseCurrency || d.currency || 'USD';
        const sCur = d.sellingCurrency || d.currency || 'USD';
        const buyerPaid = d.buyerPaidOn ? `<div class="text-success font-bold">${Utils.t('deals.buyerPaidPrefix')} ${new Date(d.buyerPaidOn).toLocaleDateString(Utils.getLang() === 'sr' ? 'sr-RS' : 'en-US')}</div>` : `<div class="text-warning font-bold">${Utils.t('deals.buyerUnpaidPrefix')} ${d.paymentDates?.buyer ? new Date(d.paymentDates.buyer).toLocaleDateString(Utils.getLang() === 'sr' ? 'sr-RS' : 'en-US') : 'N/A'}</div>`;
        const supplierPaid = d.supplierPaidOn ? `<div class="text-success font-bold">${Utils.t('deals.supplierPaidPrefix')} ${new Date(d.supplierPaidOn).toLocaleDateString(Utils.getLang() === 'sr' ? 'sr-RS' : 'en-US')}</div>` : `<div class="text-warning font-bold">${Utils.t('deals.supplierUnpaidPrefix')} ${d.paymentDates?.supplier ? new Date(d.paymentDates.supplier).toLocaleDateString(Utils.getLang() === 'sr' ? 'sr-RS' : 'en-US') : 'N/A'}</div>`;
        
        // v22.5: age warning — ako je deal stariji od 60 dana a nije zavrsen, badge
        let ageBadge = '';
        try {
            if (d.createdAt && d.status !== 'completed') {
                const daysOld = Math.floor((Date.now() - new Date(d.createdAt).getTime()) / (1000*60*60*24));
                if (daysOld > 120) ageBadge = ` <span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 uppercase" title="${daysOld} days old and still open">${daysOld}d</span>`;
                else if (daysOld > 60) ageBadge = ` <span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 uppercase" title="${daysOld} days old">${daysOld}d</span>`;
            }
        } catch(_) {}
        return `<tr class="table-row border-[var(--border)] transition-colors hover:bg-[var(--hover-bg)]">
            <td class="px-4 py-4 align-top"><div class="clickable-row font-black text-main text-base cursor-pointer hover:underline text-blue-500" data-id="${d.id}">${Utils.escapeHtml(d.contractId || '')}${ageBadge}</div><div class="text-xs text-[var(--muted)] mt-1">${Utils.escapeHtml(d.productName)} (${Utils.escapeHtml(d.incoterm || 'N/A')})</div></td>
            <td class="px-4 py-4 align-top text-main font-medium">${Utils.formatCurrency(origPurchaseVal, pCur)} ${pCur !== sCur ? `<div class="text-xs text-[var(--muted)] mt-1">(${Utils.formatCurrency(purchaseValue, sCur)})</div>`: ''}</td>
            <td class="px-4 py-4 align-top text-main font-medium">${Utils.formatCurrency(saleValue, sCur)}</td>
            <td class="px-4 py-4 align-top text-base font-black ${netProfit >= 0 ? 'text-success':'text-danger'}">${Utils.formatCurrency(netProfit, sCur)}</td>
            <td class="px-4 py-4 align-top text-xs">${buyerPaid}${supplierPaid}</td>
            <td class="px-4 py-4 align-top text-right whitespace-nowrap"><button class="invoice-deal btn small bg-accent text-white shadow-sm" data-id="${d.id}">📄 ${Utils.t('actions.invoice')}</button><button class="ics-deal text-blue-600 mx-2 font-bold hover:underline" data-id="${d.id}" title="Export dates to calendar">📅</button><button class="timeline-deal text-indigo-600 mx-2 font-bold hover:underline" data-id="${d.id}" title="Timeline">📜</button><button class="edit-deal text-warning mx-2 font-bold hover:underline" data-id="${d.id}">✏️ ${Utils.t('actions.edit')}</button><button class="delete-deal text-danger font-bold hover:underline" data-id="${d.id}">✕ ${Utils.t('actions.delete')}</button></td>
        </tr>`;
    }).join('') || `<tr><td colspan="6" class="p-10 text-center text-[var(--muted)] font-bold border-dashed border-2">${Utils.t('finances.noData')}</td></tr>`}</tbody>`;

    container.innerHTML = `<table class="min-w-full data-table">${tableHeader}${tableBody}</table>`;
    main.appendChild(container);

    container.querySelectorAll('.edit-deal, .clickable-row').forEach(b => b.addEventListener('click', e => showDealForm({dealId: e.currentTarget.dataset.id})));
    container.querySelectorAll('.invoice-deal').forEach(b => b.addEventListener('click', e => { if(typeof renderInvoiceModal === 'function') renderInvoiceModal(e.currentTarget.dataset.id); }));
    container.querySelectorAll('.timeline-deal').forEach(b => b.addEventListener('click', e => {
        e.stopPropagation();
        if (typeof viewDealTimeline === 'function') viewDealTimeline(e.currentTarget.dataset.id);
    }));
    container.querySelectorAll('.ics-deal').forEach(b => b.addEventListener('click', e => {
        e.stopPropagation();
        const deal = (state.data.deals || []).find(d => d.id === e.currentTarget.dataset.id);
        if (!deal || typeof ICS === 'undefined') return;
        const buyer = Utils.getPartnerNameById(deal.buyerId) || 'Buyer';
        const product = Utils.getProductNameById(deal.productId) || 'Product';
        const events = [];
        if (deal.deliveryDate) events.push({
            summary: `📦 Delivery — ${deal.contractId}`,
            description: `Deal ${deal.contractId}\nBuyer: ${buyer}\nProduct: ${product}\nQty: ${deal.quantity || ''} ${deal.unit || ''}`,
            location: deal.deliveryLocation || '',
            start: deal.deliveryDate, allDay: true,
            category: 'Delivery',
        });
        if (deal.paymentDates?.buyer) events.push({
            summary: `💰 Buyer payment due — ${deal.contractId}`,
            description: `Deal ${deal.contractId}\nBuyer: ${buyer}\nExpected: ${deal.sellingPrice || ''} ${deal.sellingCurrency || ''}`,
            start: deal.paymentDates.buyer, allDay: true,
            category: 'Payment',
        });
        if (deal.paymentDates?.supplier) events.push({
            summary: `💸 Supplier payment due — ${deal.contractId}`,
            description: `Deal ${deal.contractId}\nSupplier payment: ${deal.purchasePrice || ''} ${deal.purchaseCurrency || ''}`,
            start: deal.paymentDates.supplier, allDay: true,
            category: 'Payment',
        });
        if (deal.dealStartDate) events.push({
            summary: `🤝 Deal start — ${deal.contractId}`,
            description: `Deal ${deal.contractId} with ${buyer}`,
            start: deal.dealStartDate, allDay: true,
            category: 'Milestone',
        });
        if (!events.length) {
            if (typeof showToast === 'function') showToast('No dates set on this deal to export.', 'warning');
            return;
        }
        ICS.downloadCalendar(events,
            `deal-${(deal.contractId||deal.id).replace(/[^A-Za-z0-9-]/g,'_')}.ics`,
            `Aspidus · ${deal.contractId || 'Deal'}`);
        if (typeof showToast === 'function') showToast(`${events.length} event(s) exported to .ics`, 'success');
    }));
    
    container.querySelectorAll('.delete-deal').forEach(b => b.addEventListener('click', async (e) => {
        const dealId = e.currentTarget.dataset.id;
        const deal = (state.data.deals || []).find(d => d.id === dealId);
        if (!deal) return;
        
        const confirmMsg = Utils.t('deals.confirmCascadeDelete').replace('{0}', deal.contractId);
        
        const _ok = await window.askConfirm('Brisanje posla?', confirmMsg, { danger: true, confirmText: 'Obriši' });
        if (_ok) {
            // FIX: Bezbedno brisanje transakcija čak i ako nema učitanih
            const allTxs = state.data.transactions || [];
            const txsToDelete = allTxs.filter(t => t.invoiceNumber === deal.contractId || (t.reference && t.reference.includes(deal.contractId)));
            for (let tx of txsToDelete) {
                state.data.transactions = state.data.transactions.filter(t => t.id !== tx.id);
                try { await deleteItemFromServer('transactions', tx.id); } catch(err) {}
            }
            
            if(deal.documents && deal.documents.length > 0) {
                for(let doc of deal.documents) {
                    if(!doc.isExternal && doc.dataUrl && typeof deleteFileFromServer === 'function') {
                        try { await deleteFileFromServer(doc.dataUrl); } catch(err){}
                    }
                }
            }
            await Utils.handleDelete('deals', dealId);
        }
    }));
}