// static/js/modules/deals/deals_save.js
async function handleSaveDeal(formData) {
    const id = state.editingItem?.id || Utils.generateId(); 
    const canViewCosts = state.user?.role === 'admin' || (state.user?.permissions && state.user.permissions['deals_view_costs']);
  
    const wasBuyerPaid = state.editingItem?.buyerPaidOn; 
    const isBuyerNowPaid = formData.get('buyerPaidOn');
    const wasSupplierPaid = state.editingItem?.supplierPaidOn;
    
    let costs = []; let associates = [];
    if (canViewCosts) {
        document.querySelectorAll('#costs-container .cost-item').forEach((el) => { 
            const type = el.querySelector(`[name^="costType_"]`)?.value; 
            const amount = parseFloat(el.querySelector(`[name^="costAmount_"]`)?.value) || 0; 
            if(type) costs.push({ type, amount }); 
        });
        document.querySelectorAll('#associates-container .associate-item').forEach((el) => { 
            const partnerId = el.querySelector(`[name^="associateId_"]`)?.value; 
            const commissionType = el.querySelector(`[name^="commissionType_"]`)?.value; 
            const commissionValue = parseFloat(el.querySelector(`[name^="commissionValue_"]`)?.value); 
            if(partnerId && commissionValue) associates.push({ partnerId, commissionType, commissionValue }); 
        });
    }
  
    const deal = { 
      id, 
      contractId: formData.get('contractId'), 
      buyerId: formData.get('buyerId'), 
      buyerName: Utils.getPartnerNameById(formData.get('buyerId')), 
      productId: formData.get('productId'), 
      productName: Utils.getProductNameById(formData.get('productId')), 
      sellingPrice: parseFloat(formData.get('sellingPrice')) || 0, 
      sellingCurrency: formData.get('sellingCurrency') || 'USD', 
      quantity: parseFloat(formData.get('quantity')) || 1, 
      unit: formData.get('unit'), 
      incoterm: formData.get('incoterm'), 
      paymentDates: { buyer: formData.get('buyerPaymentDate'), supplier: canViewCosts ? formData.get('supplierPaymentDate') : state.editingItem?.paymentDates?.supplier }, 
      buyerPaidOn: formData.get('buyerPaidOn'), 
      status: formData.get('status'),
      dealStartDate: formData.get('dealStartDate'), 
      deliveryDate: formData.get('deliveryDate'), 
      deliveryLocation: formData.get('deliveryLocation'), 
      paymentAccountId: formData.get('paymentAccountId'), 
      documents: state.editingItem?.documents || [], 
      ownerId: state.editingItem?.ownerId || state.user?.id || 'SYSTEM',
      sharedWith: state.editingItem?.sharedWith || [],
      lastModified: new Date().toISOString() 
    };
    
    if (canViewCosts) {
        deal.supplierId = formData.get('supplierId');
        deal.supplierName = Utils.getPartnerNameById(formData.get('supplierId'));
        deal.purchasePrice = parseFloat(formData.get('purchasePrice')) || 0;
        deal.purchaseCurrency = formData.get('purchaseCurrency') || 'USD';
        deal.exchangeRate = parseFloat(formData.get('exchangeRate')) || 1;
        deal.costs = costs;
        deal.bankCosts = parseFloat(formData.get('bankCosts')) || 0;
        deal.associates = associates;
        deal.supplierPaidOn = formData.get('supplierPaidOn');
        deal.supplierBankDetails = formData.get('supplierBankDetails');
    }
  
    deal.currency = deal.sellingCurrency;
    
    if(state.editingItem) {
        state.data.deals[state.data.deals.findIndex(d => d.id === id)] = deal; 
    } else {
        state.data.deals.push(deal);
    }
    
    await saveSingleItem('deals', deal);
  
    // Osiguravamo postojanje niza transakcija
    state.data.transactions = state.data.transactions || [];
    
    const existingBuyerTx = state.data.transactions.find(t => (t.dealId === deal.id && t.type === 'income') || (t.type === 'income' && t.invoiceNumber === (state.editingItem?.contractId || deal.contractId)));
    const existingSupplierTx = state.data.transactions.find(t => (t.dealId === deal.id && t.type === 'expense' && (t.category === 'Trošak nabavke' || t.category === 'purchase_cost')) || (t.type === 'expense' && t.invoiceNumber === (state.editingItem?.contractId || deal.contractId) && (t.category === 'Trošak nabavke' || t.category === 'purchase_cost')));
  
    if (deal.buyerPaidOn) {
        if (existingBuyerTx) {
            existingBuyerTx.amount = deal.sellingPrice * deal.quantity;
            existingBuyerTx.currency = deal.sellingCurrency;
            existingBuyerTx.date = deal.buyerPaidOn;
            existingBuyerTx.invoiceNumber = deal.contractId;
            existingBuyerTx.dealId = deal.id; 
            await saveSingleItem('transactions', existingBuyerTx);
        }
    } else if (existingBuyerTx) {
        await deleteItemFromServer('transactions', existingBuyerTx.id);
        state.data.transactions = state.data.transactions.filter(t => t.id !== existingBuyerTx.id);
    }
  
    let needsBuyerPrompt = isBuyerNowPaid && !wasBuyerPaid && !existingBuyerTx && (state.data.accounts || []).length > 0;
    
    let needsSupplierPrompt = false;
    const isSupplierNowPaid = canViewCosts ? formData.get('supplierPaidOn') : false;
    if(canViewCosts) {
        if (deal.supplierPaidOn) {
            if (existingSupplierTx) {
                existingSupplierTx.amount = deal.purchasePrice * deal.quantity;
                existingSupplierTx.currency = deal.purchaseCurrency;
                existingSupplierTx.date = deal.supplierPaidOn;
                existingSupplierTx.invoiceNumber = deal.contractId;
                existingSupplierTx.dealId = deal.id; 
                await saveSingleItem('transactions', existingSupplierTx);
            }
        } else if (existingSupplierTx) {
            await deleteItemFromServer('transactions', existingSupplierTx.id);
            state.data.transactions = state.data.transactions.filter(t => t.id !== existingSupplierTx.id);
        }
        needsSupplierPrompt = isSupplierNowPaid && !wasSupplierPaid && !existingSupplierTx && (state.data.accounts || []).length > 0;
    }
  
    const doSupplierPrompt = async () => {
        if(!canViewCosts) return;
        const promptHtml = `<div class="text-main"><p class="mb-4 font-medium">${Utils.t('deals.accountForSupplier')}</p><form id="supplier-account-select-form"><select name="accountId" class="form-input border-red-300 focus:border-red-500">${(state.data.accounts||[]).map(a => `<option value="${a.id}">${Utils.escapeHtml(a.name)} (${a.currency})</option>`).join('')}</select><div class="flex justify-end mt-4 pt-4 border-t border-[var(--border)]"><button type="submit" class="btn bg-red-600 text-white shadow">${Utils.t('actions.confirm')}</button></div></form></div>`;
        Utils.openModal(Utils.t('deals.paymentSupplierTitle'), promptHtml, async (fData) => {
            const newTransaction = { id: Utils.generateId(), dealId: deal.id, type: 'expense', date: deal.supplierPaidOn, accountId: fData.get('accountId'), description: `Expense - ${deal.contractId}`, amount: deal.purchasePrice * deal.quantity, currency: deal.purchaseCurrency, invoiceNumber: deal.contractId, category: 'purchase_cost', source: `Supplier: ${deal.supplierName}`, status: 'completed' };
            state.data.transactions.push(newTransaction);
            await saveSingleItem('transactions', newTransaction); 
            Utils.closeModal(); render();
        });
    };
  
    if (needsBuyerPrompt) {
        const selectedAccountDefault = deal.paymentAccountId || '';
        const promptHtml = `<div class="text-main"><p class="mb-4 font-medium">${Utils.t('deals.accountForBuyer')}</p><form id="account-select-form"><select name="accountId" class="form-input border-green-300 focus:border-green-500">${(state.data.accounts||[]).map(a => `<option value="${a.id}" ${a.id === selectedAccountDefault ? 'selected':''}>${Utils.escapeHtml(a.name)} (${a.currency})</option>`).join('')}</select><div class="flex justify-end mt-4 pt-4 border-t border-[var(--border)]"><button type="submit" class="btn bg-green-600 text-white shadow">${Utils.t('actions.confirm')}</button></div></form></div>`;
        Utils.openModal(Utils.t('deals.paymentBuyerTitle'), promptHtml, async (formDt) => {
            const newTransaction = { id: Utils.generateId(), dealId: deal.id, type: 'income', date: deal.buyerPaidOn, accountId: formDt.get('accountId'), description: `Income - ${deal.contractId}`, amount: deal.sellingPrice * deal.quantity, currency: deal.sellingCurrency, invoiceNumber: deal.contractId, category: 'sales_revenue', source: `Buyer: ${deal.buyerName}`, status: 'completed' };
            state.data.transactions.push(newTransaction);
            await saveSingleItem('transactions', newTransaction);
            if(needsSupplierPrompt) { setTimeout(doSupplierPrompt, 300); } else { Utils.closeModal(); render(); }
        });
    } else if (needsSupplierPrompt) {
        doSupplierPrompt();
    } else {
        Utils.closeModal(); render();
    }
    if (typeof checkAllNotifications === 'function') checkAllNotifications();
}