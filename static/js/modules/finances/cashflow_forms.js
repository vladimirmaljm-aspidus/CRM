// static/js/modules/finances/cashflow_forms.js
function showAccountForm() {
    // Company bank accounts (nabrojani u Settings) — cashflow račun MOŽE biti
    // povezan sa jednim od njih. Time se automatski, kada admin izabere ovaj
    // cashflow račun pri kreiranju ponude/dila, klijent dobija tačne bankarske
    // instrukcije za uplatu (bez ručnog prepisivanja).
    const companyBanks = (state.company && Array.isArray(state.company.bankAccounts))
        ? state.company.bankAccounts : [];

    const bankBadge = (acc) => {
        if (!acc.linkedCompanyBankIdx && acc.linkedCompanyBankIdx !== 0) return '';
        const b = companyBanks[acc.linkedCompanyBankIdx];
        if (!b) return `<span class="ml-2 text-[10px] text-red-500 font-bold uppercase">Linked bank missing</span>`;
        return `<span class="ml-2 text-[10px] text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 rounded px-1.5 py-0.5 font-bold">🏦 ${Utils.escapeHtml(b.bankName || 'Bank')}</span>`;
    };

    const listHtml = (state.data.accounts || []).map(acc => `
        <div class="flex items-center justify-between p-3 border-b border-[var(--border)] hover:bg-[var(--hover-bg)] transition-colors">
            <div>
                <span class="font-bold text-main">${Utils.escapeHtml(acc.name)}</span>${bankBadge(acc)}<br>
                <span class="text-sm font-black ${acc.initialBalance >= 0 ? 'text-success' : 'text-danger'}">${Utils.formatCurrency(acc.initialBalance, acc.currency)}</span>
            </div>
            <div>
                <button class="edit-account-btn text-blue-600 font-bold mr-3 hover:underline" data-id="${acc.id}">${Utils.t('actions.edit')}</button>
                <button class="delete-account-btn text-danger font-bold hover:underline" data-id="${acc.id}">${Utils.t('actions.delete')}</button>
            </div>
        </div>`).join('');

    // Dropdown opcije za povezivanje sa company bankAccounts
    const bankOptionsHtml = companyBanks.length === 0
        ? `<option value="">— No company banks configured (add in Settings → Bank Accounts) —</option>`
        : `<option value="">— None (standalone cash account) —</option>` +
          companyBanks.map((b, i) => `<option value="${i}">${Utils.escapeHtml(b.bankName || 'Bank')} — ${Utils.escapeHtml(b.accountNumber || '')} (${Utils.escapeHtml(b.currency || '')})</option>`).join('');

    const html = `
    <div class="space-y-4">
        <div id="accounts-list" class="max-h-60 overflow-y-auto">${listHtml}</div>
        <hr class="border-[var(--border)]"/>
        <form id="account-form" class="space-y-4 p-4 border border-dashed border-blue-300 bg-blue-50/30 dark:bg-blue-900/10 rounded-lg">
            <h4 id="account-form-title" class="font-bold text-blue-700 dark:text-blue-400">${Utils.t('cashflow.addAccount')}</h4>
            <input type="hidden" name="id">
            <label class="block font-bold text-main">${Utils.t('cashflow.accountName')}<input name="name" class="form-input mt-1 border-blue-200" required placeholder="${Utils.t('cashflow.accPlaceholder')}"/></label>
            <div class="grid grid-cols-2 gap-4">
                <label class="block font-bold text-main">${Utils.t('cashflow.initialBalance')}<input name="initialBalance" type="number" step="0.01" class="form-input mt-1 border-blue-200" required/></label>
                <label class="block font-bold text-main">${Utils.t('cashflow.currency')}<select name="currency" class="form-input mt-1 border-blue-200">${(typeof CURRENCIES !== 'undefined' ? CURRENCIES : ['USD','EUR']).map(c => `<option value="${c}">${c}</option>`).join('')}</select></label>
            </div>
            <label class="block font-bold text-main">
                🏦 Link to company bank account
                <select name="linkedCompanyBankIdx" class="form-input mt-1 border-blue-200">${bankOptionsHtml}</select>
                <p class="text-[11px] font-normal text-slate-500 mt-1">When you generate an invoice/offer that receives money on this cashflow account, the linked bank's payment instructions (IBAN, SWIFT, bank name) will auto-fill on the document.</p>
            </label>
            <div class="flex justify-end gap-2 mt-4 pt-3 border-t border-[var(--border)]">
                <button type="button" id="cancel-edit-account" class="btn bg-[var(--panel)] border border-[var(--border)] hidden text-main">${Utils.t('actions.cancel')}</button>
                <button type="submit" class="btn bg-blue-600 text-white shadow">${Utils.t('actions.save')}</button>
            </div>
        </form>
    </div>`;

    Utils.openModal(Utils.t('cashflow.manageAccounts'), html, async (fd) => {
        const id = fd.get('id') || Utils.generateId();
        const linkedIdxRaw = fd.get('linkedCompanyBankIdx');
        const linkedIdx = (linkedIdxRaw === '' || linkedIdxRaw == null) ? null : parseInt(linkedIdxRaw, 10);
        const account = {
            id,
            name: fd.get('name'),
            initialBalance: parseFloat(fd.get('initialBalance')) || 0,
            currency: fd.get('currency'),
            linkedCompanyBankIdx: (Number.isFinite(linkedIdx) ? linkedIdx : null),
            createdAt: state.editingItem?.createdAt || new Date().toISOString(),
            lastModified: new Date().toISOString()
        };
        if (state.editingItem) state.data.accounts[state.data.accounts.findIndex(a => a.id === id)] = account;
        else state.data.accounts.push(account);

        await saveSingleItem('accounts', account);
        state.editingItem = null; Utils.closeModal(); render(); showAccountForm();
    });
    
    const form = document.getElementById('account-form'); 
    const title = document.getElementById('account-form-title'); 
    const cancelBtn = document.getElementById('cancel-edit-account');
    
    cancelBtn.addEventListener('click', () => { 
        form.reset(); form.querySelector('[name="id"]').value = ''; 
        title.innerText = Utils.t('cashflow.addAccount'); 
        cancelBtn.classList.add('hidden'); state.editingItem = null; 
    });
    
    document.querySelectorAll('.edit-account-btn').forEach(btn => btn.addEventListener('click', (e) => {
        const acc = state.data.accounts.find(a => a.id === e.currentTarget.dataset.id);
        if(acc) {
            state.editingItem = acc;
            form.querySelector('[name="id"]').value = acc.id;
            form.querySelector('[name="name"]').value = acc.name;
            form.querySelector('[name="initialBalance"]').value = acc.initialBalance;
            form.querySelector('[name="currency"]').value = acc.currency;
            const linkedSelect = form.querySelector('[name="linkedCompanyBankIdx"]');
            if (linkedSelect) linkedSelect.value = (acc.linkedCompanyBankIdx == null ? '' : String(acc.linkedCompanyBankIdx));
            title.innerText = Utils.t('actions.edit');
            cancelBtn.classList.remove('hidden');
        }
    }));
    
    document.querySelectorAll('.delete-account-btn').forEach(btn => btn.addEventListener('click', async (e) => {
        const _ok = await window.askConfirm(Utils.t('misc.confirmDeleteTitle') || 'Obrisati?',
                                            Utils.t('misc.confirmDelete'),
                                            { danger: true });
        if(_ok) { Utils.handleDelete('accounts', e.currentTarget.dataset.id); Utils.closeModal(); showAccountForm(); }
    }));
}
  
function showTransactionForm(type, id = null) {
    state.editingItem = id ? state.data.transactions.find(t => t.id === id) : null; 
    const now = new Date();
    const timeStr = now.toTimeString().slice(0,5);
    const dateStr = now.toISOString().slice(0,10);
    const item = state.editingItem || { type: type, date: dateStr, time: timeStr, currency: state.settings?.currency || 'USD', status: 'completed' }; 
    const transactionType = item.type;
    const isTransfer = transactionType === 'transfer';
    
    const accountOptions = (state.data.accounts || []).map(a => `<option value="${a.id}" ${item.accountId === a.id ? 'selected':''}>${Utils.escapeHtml(a.name)} (${a.currency})</option>`).join('');
    const fromOptions = (state.data.accounts || []).map(a => `<option value="${a.id}" ${item.fromAccountId === a.id ? 'selected':''}>${Utils.escapeHtml(a.name)} (${a.currency})</option>`).join('');
    const toOptions = (state.data.accounts || []).map(a => `<option value="${a.id}" ${item.toAccountId === a.id ? 'selected':''}>${Utils.escapeHtml(a.name)} (${a.currency})</option>`).join('');
  
    const categoriesArray = transactionType === 'income' ? Utils.t('cashflow.incomeCategories') : Utils.t('cashflow.expenseCategories');
    const categoryOptions = (Array.isArray(categoriesArray) ? categoriesArray : []).map(c => `<option value="${c}" ${item.category === c ? 'selected':''}>${c}</option>`).join('');
  
    let themeClass = isTransfer ? 'border-warning bg-yellow-50 dark:bg-yellow-900/10' : (transactionType === 'income' ? 'border-success bg-green-50 dark:bg-green-900/10' : 'border-danger bg-red-50 dark:bg-red-900/10');
  
    const html = `
    <form id="transaction-form" class="space-y-4 p-5 rounded-xl border-2 ${themeClass}">
      <input type="hidden" name="id" value="${item.id || ''}"/>
      <input type="hidden" name="type" value="${transactionType}"/>
      <input type="hidden" name="createdAt" value="${item.createdAt || new Date().toISOString()}"/>
      <input type="hidden" name="isAutoGenerated" value="${item.isAutoGenerated || 'false'}"/>
      
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 pb-4 border-b border-[var(--border)]">
          <label class="block font-bold text-main">${Utils.t('cashflow.txDate')}<input name="date" type="date" class="form-input mt-1 border-gray-400" value="${item.date}" required/></label>
          <label class="block font-bold text-main">${Utils.t('cashflow.txTime')}<input name="time" type="time" class="form-input mt-1 border-gray-400" value="${item.time || '12:00'}" required/></label>
          <label class="block font-bold text-blue-600">${Utils.t('cashflow.txStatus')}<select name="status" class="form-input mt-1 border-blue-400 font-bold"><option value="completed" ${item.status==='completed'?'selected':''}>${Utils.t('cashflow.txCompleted')}</option><option value="pending" ${item.status==='pending'?'selected':''}>${Utils.t('cashflow.txPending')}</option></select></label>
          <label class="block font-bold text-main">${Utils.t('cashflow.txReference')}<input name="reference" class="form-input mt-1 border-gray-400" value="${Utils.escapeHtml(item.reference || '')}" placeholder="${Utils.t('cashflow.txRefPlaceholder')}"/></label>
      </div>
      
      ${isTransfer ? '' : `<div><label class="block font-bold text-main">${Utils.t('cashflow.account')}<select name="accountId" class="form-input mt-1 border-gray-300" required>${accountOptions}</select></label></div>`}
      ${isTransfer ? `<div class="grid grid-cols-2 gap-4"><label class="block font-bold text-main">${Utils.t('cashflow.fromAccount')}<select id="trans-from-acc" name="fromAccountId" class="form-input mt-1 border-gray-300" required>${fromOptions}</select></label><label class="block font-bold text-main">${Utils.t('cashflow.toAccount')}<select id="trans-to-acc" name="toAccountId" class="form-input mt-1 border-gray-300" required>${toOptions}</select></label></div>` : `<div><label class="block font-bold text-main">${Utils.t('cashflow.description')}<input name="description" class="form-input mt-1 border-gray-300" value="${Utils.escapeHtml(item.description || '')}" placeholder="${Utils.t('cashflow.reasonPlaceholder')}" required/></label></div>`}
      
      <div class="grid grid-cols-2 gap-4 p-3 bg-[var(--card)] rounded-lg shadow-sm border border-[var(--border)] mt-2 relative">
          <label class="block font-black text-lg ${transactionType === 'income' ? 'text-success' : (isTransfer ? 'text-warning' : 'text-danger')}">
             ${isTransfer ? Utils.t('cashflow.amountDeducted') : Utils.t('cashflow.amount')}
             <input name="amount" type="number" step="0.01" class="form-input mt-1 font-bold text-xl" value="${item.amount || ''}" required/>
          </label>
          <label class="block font-bold text-main">
             ${Utils.t('cashflow.currency')}
             <select name="currency" class="form-input mt-1 border-gray-300">${(typeof CURRENCIES !== 'undefined' ? CURRENCIES : ['USD','EUR']).map(c => `<option value="${c}" ${item.currency === c ? 'selected':''}>${c}</option>`).join('')}</select>
          </label>
          
          <div id="target-amount-wrapper" class="col-span-2 grid grid-cols-2 gap-4 mt-2 pt-2 border-t border-[var(--border)] hidden">
              <label class="block font-black text-lg text-green-600">
                 ${Utils.t('cashflow.amountTarget')}
                 <input name="targetAmount" type="number" step="0.01" class="form-input mt-1 font-bold text-xl bg-green-50 dark:bg-green-900/20" value="${item.targetAmount || ''}"/>
              </label>
              <label class="block font-bold text-main mt-auto pb-3 text-lg" id="target-currency-label">EUR</label>
          </div>
      </div>
      
      ${!isTransfer ? `<div class="grid grid-cols-2 gap-4 mt-2"><label class="block font-bold text-main">${Utils.t('cashflow.invoiceNumber')}<input name="invoiceNumber" class="form-input mt-1 border-gray-300" value="${Utils.escapeHtml(item.invoiceNumber || '')}"/></label><label class="block font-bold text-main">${Utils.t('cashflow.category')}<select name="category" class="form-input mt-1 border-gray-300">${categoryOptions}</select></label></div>` : `<div><label class="block font-bold text-main">${Utils.t('cashflow.txPurpose')}<input name="description" class="form-input mt-1 border-gray-300" value="${Utils.escapeHtml(item.description || '')}"/></label></div>`}
      
      <div class="grid grid-cols-2 gap-4 mt-2">
          ${transactionType === 'expense' ? `<label class="block font-bold text-main">${Utils.t('cashflow.paymentMethod')}<select name="paymentMethod" class="form-input mt-1 border-gray-300">${[['bank_transfer', Utils.t('cashflow.bank_transfer')], ['card', Utils.t('cashflow.card')], ['cash', Utils.t('cashflow.cash')]].map(p => `<option value="${p[0]}" ${item.paymentMethod === p[0] ? 'selected':''}>${p[1]}</option>`).join('')}</select></label>` : ''}
          ${transactionType === 'income' ? `<label class="block font-bold text-main">${Utils.t('cashflow.sourceOfFunds')}<input name="source" class="form-input mt-1 border-gray-300" value="${Utils.escapeHtml(item.source || '')}" placeholder="${Utils.t('cashflow.sourcePlaceholder')}"/></label>` : ''}
          ${!isTransfer ? `<label class="block font-bold text-red-600">${Utils.t('cashflow.txBankFee')}<input name="bankFee" type="number" step="0.01" class="form-input mt-1 border-red-300 bg-red-50/50" placeholder="0.00" /></label>` : ''}
      </div>
      
      <div class="flex justify-end mt-4 border-t border-[var(--border)] pt-4"><button type="submit" class="btn bg-accent text-white shadow-lg text-lg px-8 py-3 w-full sm:w-auto">${Utils.t('actions.save')}</button></div>
    </form>`;
    
    const modalTitle = item.id ? Utils.t('cashflow.txDetailTitle') : (isTransfer ? Utils.t('cashflow.txNewTransfer') : (transactionType === 'income' ? Utils.t('cashflow.txNewIncome') : Utils.t('cashflow.txNewExpense')));
    
    Utils.openModal(modalTitle, html, async (formData) => {
        const id = formData.get('id') || Utils.generateId(); 
        const type = formData.get('type'); 
        let transaction; 
        const isTransferForm = type === 'transfer';
        const nowIso = new Date().toISOString();
        
        const baseData = {
            id, type, 
            date: formData.get('date'), 
            time: formData.get('time'),
            amount: Math.abs(parseFloat(formData.get('amount')) || 0), 
            currency: formData.get('currency'), 
            description: formData.get('description'),
            status: formData.get('status'),
            reference: formData.get('reference'),
            createdAt: formData.get('createdAt') || nowIso,
            lastModified: nowIso,
            isAutoGenerated: formData.get('isAutoGenerated') === 'true'
        };
  
        if (isTransferForm) { 
            let targetVal = parseFloat(formData.get('targetAmount'));
            if (isNaN(targetVal)) targetVal = baseData.amount;
            transaction = { ...baseData, fromAccountId: formData.get('fromAccountId'), toAccountId: formData.get('toAccountId'), targetAmount: targetVal }; 
        } else { 
            transaction = { ...baseData, accountId: formData.get('accountId'), invoiceNumber: formData.get('invoiceNumber'), category: formData.get('category'), paymentMethod: formData.get('paymentMethod') || null, source: formData.get('source') || null }; 
        }
  
        if (state.editingItem) state.data.transactions[state.data.transactions.findIndex(t => t.id === id)] = transaction; 
        else state.data.transactions.push(transaction);
  
        await saveSingleItem('transactions', transaction);
  
        const bankFee = parseFloat(formData.get('bankFee'));
        if (!isNaN(bankFee) && bankFee > 0 && !isTransferForm) { 
            const feeTx = { 
                id: Utils.generateId(), 
                type: 'expense', 
                date: transaction.date, 
                time: transaction.time, 
                accountId: transaction.accountId, 
                description: `${Utils.t('cashflow.txFeeDesc')} "${transaction.description}"`, 
                amount: bankFee, 
                currency: transaction.currency, 
                category: 'Bank Fees', 
                paymentMethod: transaction.paymentMethod, 
                status: 'completed',
                reference: transaction.reference ? `FEE-${transaction.reference}` : '',
                createdAt: nowIso, 
                lastModified: nowIso
            };
            state.data.transactions.push(feeTx); 
            await saveSingleItem('transactions', feeTx);
        }
        state.editingItem = null; Utils.closeModal(); render();
    });
  
    if (isTransfer) {
        const fromSel = document.getElementById('trans-from-acc');
        const toSel = document.getElementById('trans-to-acc');
        const tw = document.getElementById('target-amount-wrapper');
        const tl = document.getElementById('target-currency-label');
        const trInp = document.querySelector('input[name="targetAmount"]');
  
        const checkCurrencies = () => {
            const fa = state.data.accounts.find(a => a.id === fromSel.value);
            const ta = state.data.accounts.find(a => a.id === toSel.value);
            if (fa && ta && fa.currency !== ta.currency) {
                tw.classList.remove('hidden');
                tl.innerText = ta.currency;
                trInp.required = true;
            } else {
                tw.classList.add('hidden');
                trInp.required = false;
            }
        };
        fromSel.addEventListener('change', checkCurrencies);
        toSel.addEventListener('change', checkCurrencies);
        checkCurrencies();
    }
}

function showRecurringExpensesModal() {
    const listHtml = (state.data.recurringExpenses || []).map(re => {
        const accountName = state.data.accounts.find(a => a.id === re.accountId)?.name || 'Unknown';
        return `
        <div class="flex items-center justify-between p-3 border-b border-[var(--border)] hover:bg-[var(--hover-bg)] transition-colors">
            <div>
                <span class="font-bold text-main">${Utils.escapeHtml(re.description)}</span> <span class="text-xs text-[var(--muted)]">(${Utils.escapeHtml(accountName)})</span><br>
                <span class="text-sm text-danger font-black">${Utils.formatCurrency(re.amount, re.currency)}</span> 
                <span class="text-xs text-[var(--muted)] ml-2">(${Utils.t('cashflow.every')} ${re.dayOfMonth}. u mesecu)</span>
            </div>
            <div>
                <button class="edit-re-btn text-blue-600 font-bold mr-3 hover:underline" data-id="${re.id}">${Utils.t('actions.edit')}</button>
                <button class="delete-re-btn text-danger font-bold hover:underline" data-id="${re.id}">${Utils.t('actions.delete')}</button>
            </div>
        </div>`;
    }).join('') || `<p class="text-sm text-[var(--muted)] font-medium py-4 text-center">${Utils.t('finances.noData')}</p>`;
    
    const accountOptions = state.data.accounts.map(a => `<option value="${a.id}">${Utils.escapeHtml(a.name)} (${a.currency})</option>`).join('');
    let expCats = Utils.t('cashflow.expenseCategories'); if(!Array.isArray(expCats)) expCats = [];
    const categoryOptions = expCats.map(c => `<option value="${c}">${c}</option>`).join('');

    const html = `
    <div class="space-y-4">
        <div id="re-list" class="max-h-60 overflow-y-auto custom-scrollbar border border-[var(--border)] rounded-lg bg-[var(--card)]">${listHtml}</div>
        
        <form id="re-form" class="space-y-4 p-4 border border-dashed border-purple-300 bg-purple-50/30 dark:bg-purple-900/10 rounded-lg">
            <h4 id="re-form-title" class="font-bold text-purple-700 dark:text-purple-400">${Utils.t('cashflow.addRecurring')}</h4>
            <input type="hidden" name="id">
            
            <div class="grid grid-cols-2 gap-4">
                <label class="block font-bold text-main col-span-2">${Utils.t('cashflow.description')}<input name="description" class="form-input mt-1 border-purple-200" required placeholder="${Utils.t('cashflow.recPlaceholder')}"/></label>
                <label class="block font-bold text-danger">${Utils.t('cashflow.amount')}<input name="amount" type="number" step="0.01" class="form-input mt-1 border-red-200" required/></label>
                <label class="block font-bold text-main">${Utils.t('cashflow.currency')}<select name="currency" class="form-input mt-1 border-purple-200">${(typeof CURRENCIES !== 'undefined' ? CURRENCIES : ['USD','EUR']).map(c => `<option value="${c}">${c}</option>`).join('')}</select></label>
            </div>
            
            <div class="grid grid-cols-2 gap-4">
                <label class="block font-bold text-main">${Utils.t('cashflow.account')}<select name="accountId" class="form-input mt-1 border-purple-200" required>${accountOptions}</select></label>
                <label class="block font-bold text-main">${Utils.t('cashflow.category')}<select name="category" class="form-input mt-1 border-purple-200" required>${categoryOptions}</select></label>
                <label class="block font-bold text-main">${Utils.t('cashflow.dayOfMonth')}<input name="dayOfMonth" type="number" min="1" max="31" class="form-input mt-1 border-purple-200" required placeholder="npr. 5"/></label>
                <label class="block font-bold text-main">Početak od datuma<input name="startDate" type="date" class="form-input mt-1 border-purple-200" required/></label>
            </div>
            
            <div class="flex justify-end gap-2 mt-4 pt-3 border-t border-[var(--border)]">
                <button type="button" id="cancel-edit-re" class="btn bg-[var(--panel)] border border-[var(--border)] hidden text-main">${Utils.t('actions.cancel')}</button>
                <button type="submit" class="btn bg-purple-600 hover:bg-purple-700 text-white shadow">${Utils.t('actions.save')}</button>
            </div>
        </form>
    </div>`;

    Utils.openModal(Utils.t('cashflow.recurringExpenses'), html, async (fd) => {
        const id = fd.get('id') || Utils.generateId();
        const expense = {
            id,
            description: fd.get('description'),
            amount: parseFloat(fd.get('amount')) || 0,
            currency: fd.get('currency'),
            accountId: fd.get('accountId'),
            category: fd.get('category'),
            dayOfMonth: parseInt(fd.get('dayOfMonth'), 10),
            startDate: fd.get('startDate'),
            createdAt: state.editingItem?.createdAt || new Date().toISOString(),
            lastApplied: state.editingItem?.lastApplied || null
        };

        if (state.editingItem) state.data.recurringExpenses[state.data.recurringExpenses.findIndex(r => r.id === id)] = expense;
        else state.data.recurringExpenses.push(expense);

        await saveSingleItem('recurringExpenses', expense);
        state.editingItem = null;
        Utils.closeModal(); render(); showRecurringExpensesModal();
    });

    const form = document.getElementById('re-form');
    const title = document.getElementById('re-form-title');
    const cancelBtn = document.getElementById('cancel-edit-re');

    cancelBtn.addEventListener('click', () => {
        form.reset(); form.querySelector('[name="id"]').value = '';
        title.innerText = Utils.t('cashflow.addRecurring');
        cancelBtn.classList.add('hidden'); state.editingItem = null;
    });

    document.querySelectorAll('.edit-re-btn').forEach(btn => btn.addEventListener('click', (e) => {
        const re = state.data.recurringExpenses.find(r => r.id === e.currentTarget.dataset.id);
        if(re) {
            state.editingItem = re;
            form.querySelector('[name="id"]').value = re.id;
            form.querySelector('[name="description"]').value = re.description;
            form.querySelector('[name="amount"]').value = re.amount;
            form.querySelector('[name="currency"]').value = re.currency;
            form.querySelector('[name="accountId"]').value = re.accountId;
            form.querySelector('[name="category"]').value = re.category;
            form.querySelector('[name="dayOfMonth"]').value = re.dayOfMonth;
            form.querySelector('[name="startDate"]').value = re.startDate || '';
            title.innerText = Utils.t('actions.edit');
            cancelBtn.classList.remove('hidden');
        }
    }));

    document.querySelectorAll('.delete-re-btn').forEach(btn => btn.addEventListener('click', async (e) => {
        const _ok = await window.askConfirm('Obrisati stavku?', Utils.t('misc.confirmDelete'), { danger: true });
        if(_ok) {
            Utils.handleDelete('recurringExpenses', e.currentTarget.dataset.id);
            Utils.closeModal(); showRecurringExpensesModal();
        }
    }));
}