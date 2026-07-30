// static/js/modules/finances/cashflow_list.js

function renderCashFlowView() {
    const main = document.getElementById('main-content');
    if(!main) return;
    main.innerHTML = '';
    const header = Utils.createViewHeader(Utils.t('cashflow.title'), '', null);
    
    const srLang = Utils.getLang() === 'sr';
    const tt = (sr, en) => srLang ? sr : en;
    header.querySelector('h2').parentNode.insertAdjacentHTML('beforeend', `
        <div class="flex items-center gap-2 flex-wrap mt-2 sm:mt-0">
            <button id="manage-accounts-btn" class="btn bg-[var(--panel)] border border-[var(--border)] text-main hover:bg-[var(--hover-bg)] shadow-sm"
                    data-tooltip="${tt('Upravljaj računima, valutama i početnim stanjima', 'Manage bank accounts, currencies and opening balances')}">
                ${Utils.t('cashflow.manageAccounts')}
            </button>
            <button id="manage-recurring-btn" class="btn bg-purple-600 text-white shadow-sm hover:bg-purple-700"
                    data-tooltip="${tt('Periodični troškovi (mesečni/godišnji) — automatski se knjiže', 'Recurring expenses (monthly/annual) posted automatically on schedule')}">
                ${Utils.t('cashflow.recurringExpenses')}
            </button>
            <button id="add-transfer-btn" class="btn bg-warning text-black shadow-sm hover:bg-yellow-500"
                    data-tooltip="${tt('Prenos novca između vaših računa (bez uticaja na P&L)', 'Money transfer between your own accounts (no P&L impact)')}">
                ${Utils.t('cashflow.addTransfer')}
            </button>
            <button id="add-expense-btn" class="btn bg-danger text-white shadow-sm hover:bg-red-700"
                    data-tooltip="${tt('Novi trošak (odliv sa računa)', 'New expense (money leaving an account)')}">
                ${Utils.t('cashflow.addExpense')}
            </button>
            <button id="add-income-btn" class="btn bg-success text-white shadow-sm hover:bg-green-700"
                    data-tooltip="${tt('Novi prihod (priliv na račun)', 'New income (money coming into an account)')}">
                ${Utils.t('cashflow.addIncome')}
            </button>
        </div>`);
    main.appendChild(header); 
    main.appendChild(renderCashFlowDashboard());
  
    const filters = document.createElement('div'); 
    filters.className = 'p-4 bg-[var(--card)] border border-[var(--border)] rounded-lg my-6 flex items-center gap-4 flex-wrap shadow-sm';
    
    const accountOptions = `<option value="all">${Utils.t('cashflow.allAccounts')}</option>` + (state.data.accounts || []).map(a => `<option value="${a.id}">${Utils.escapeHtml(a.name)}</option>`).join('');
    
    let incCats = Utils.t('cashflow.incomeCategories'); if(!Array.isArray(incCats)) incCats = [];
    let expCats = Utils.t('cashflow.expenseCategories'); if(!Array.isArray(expCats)) expCats = [];
    const allCategories = [...incCats, ...expCats].filter((v,i,a) => a.indexOf(v) === i).sort();
    
    filters.innerHTML = `
        <span class="text-sm font-bold text-main">${Utils.t('cashflow.filter')}:</span>
        <div class="flex gap-2 flex-wrap">
            <button class="btn small filter-btn" data-range="today">${Utils.t('finances.today')}</button>
            <button class="btn small filter-btn" data-range="thisWeek">${Utils.t('finances.thisWeek')}</button>
            <button class="btn small filter-btn" data-range="thisMonth">${Utils.t('finances.thisMonth')}</button>
            <button class="btn small filter-btn" data-range="thisYear">${Utils.t('finances.thisYear')}</button>
        </div>
        <div class="flex items-center gap-2">
            <input type="date" id="cashflow-start-date" class="form-input small border-gray-300">
            <input type="date" id="cashflow-end-date" class="form-input small border-gray-300">
        </div>
        <select id="cashflow-account-filter" class="form-input small border-gray-300">${accountOptions}</select>
        <select id="cashflow-category-filter" class="form-input small border-gray-300">
            <option value="all">${Utils.t('cashflow.allCategories')}</option>
            ${allCategories.map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
        <button id="export-cashflow-csv" class="btn small bg-accent text-white shadow ml-auto">${Utils.t('cashflow.exportCSV')}</button>`;
    main.appendChild(filters);
  
    // BEZBEDNO INICIJALIZOVANJE FILTERA
    const cfFilters = state.activeFilters.cashflow || {range: 'thisMonth'};
    filters.querySelectorAll('.filter-btn').forEach(btn => {
        if (btn.dataset.range === cfFilters.range) btn.classList.add('bg-accent', 'text-white'); 
        else btn.classList.add('bg-[var(--panel)]', 'border', 'border-[var(--border)]', 'text-main');
        
        btn.addEventListener('click', () => { 
            cfFilters.startDate = ''; cfFilters.endDate = ''; 
            Utils.handleFilterChange('cashflow', 'range', btn.dataset.range); 
        });
    });
    
    const startInput = filters.querySelector('#cashflow-start-date'); 
    const endInput = filters.querySelector('#cashflow-end-date');
    startInput.value = cfFilters.startDate || ''; 
    endInput.value = cfFilters.endDate || '';
    
    const dateChangeHandler = () => { 
        cfFilters.range = 'custom'; 
        Utils.handleFilterChange('cashflow', 'startDate', startInput.value); 
        Utils.handleFilterChange('cashflow', 'endDate', endInput.value); 
    };
    startInput.addEventListener('change', dateChangeHandler); 
    endInput.addEventListener('change', dateChangeHandler);
    
    filters.querySelector('#cashflow-account-filter').value = cfFilters.accountId || 'all'; 
    filters.querySelector('#cashflow-account-filter').addEventListener('change', (e) => Utils.handleFilterChange('cashflow', 'accountId', e.target.value));
    
    filters.querySelector('#cashflow-category-filter').value = cfFilters.category || 'all'; 
    filters.querySelector('#cashflow-category-filter').addEventListener('change', (e) => Utils.handleFilterChange('cashflow', 'category', e.target.value));
    
    const transactionsContainer = document.createElement('div'); 
    transactionsContainer.className = 'overflow-x-auto bg-[var(--card)] rounded-2xl shadow-xl border border-[var(--border)]';
    transactionsContainer.innerHTML = renderTransactionsTable();
    main.appendChild(transactionsContainer);
  
    document.getElementById('manage-accounts-btn').addEventListener('click', typeof showAccountForm === 'function' ? showAccountForm : () => {});
    document.getElementById('add-expense-btn').addEventListener('click', () => typeof showTransactionForm === 'function' ? showTransactionForm('expense') : null);
    document.getElementById('add-income-btn').addEventListener('click', () => typeof showTransactionForm === 'function' ? showTransactionForm('income') : null);
    document.getElementById('add-transfer-btn').addEventListener('click', () => typeof showTransactionForm === 'function' ? showTransactionForm('transfer') : null);
    
    document.getElementById('manage-recurring-btn').addEventListener('click', typeof showRecurringExpensesModal === 'function' ? showRecurringExpensesModal : () => { alert("Modal nije pronađen!"); });

    if(typeof generateCashFlowReport === 'function') {
        document.getElementById('export-cashflow-csv').addEventListener('click', generateCashFlowReport);
    }
    
    transactionsContainer.querySelectorAll('.edit-transaction-btn').forEach(b => b.addEventListener('click', (e) => typeof showTransactionForm === 'function' && showTransactionForm(null, e.currentTarget.dataset.id)));
    transactionsContainer.querySelectorAll('.delete-transaction-btn').forEach(b => b.addEventListener('click', (e) => Utils.handleDelete('transactions', e.currentTarget.dataset.id)));
}
  
function renderCashFlowDashboard() {
    const dashboard = document.createElement('div'); 
    dashboard.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6';
    
    if(!state.data.accounts || state.data.accounts.length === 0) { 
        dashboard.innerHTML = `<div class="md:col-span-2 lg:col-span-4 p-6 bg-[var(--card)] border border-dashed border-gray-400 rounded-lg text-center font-medium text-[var(--muted)]">${Utils.t('cashflow.noAccounts')}</div>`; 
        return dashboard; 
    }
    
    const balances = {}; 
    state.data.accounts.forEach(acc => { balances[acc.id] = { ...acc, currentBalance: acc.initialBalance }; });
    
    (state.data.transactions || []).forEach(tr => {
      if(tr.status !== 'pending') {
          if (tr.type === 'income' && balances[tr.accountId]) balances[tr.accountId].currentBalance += tr.amount;
          else if (tr.type === 'expense' && balances[tr.accountId]) balances[tr.accountId].currentBalance -= tr.amount;
          else if (tr.type === 'transfer') { 
              if(balances[tr.fromAccountId]) balances[tr.fromAccountId].currentBalance -= tr.amount; 
              if(balances[tr.toAccountId]) balances[tr.toAccountId].currentBalance += (tr.targetAmount || tr.amount); 
          }
      }
    });
    
    dashboard.innerHTML = Object.values(balances).map(acc => `
        <div class="p-5 bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-md relative overflow-hidden">
            <div class="absolute right-0 top-0 w-2 h-full ${acc.currentBalance >= 0 ? 'bg-success' : 'bg-danger'}"></div>
            <div class="text-sm font-bold text-[var(--muted)] uppercase tracking-wider mb-1">${Utils.escapeHtml(acc.name)}</div>
            <div class="text-3xl font-black text-main">${Utils.formatCurrency(acc.currentBalance, acc.currency)}</div>
        </div>`).join('');
    return dashboard;
}
  
function renderTransactionsTable() {
    const cfFilters = state.activeFilters.cashflow || {};
    const { range, startDate, endDate, accountId, category } = cfFilters;
    let start, end; const now = new Date();
    
    if (range === 'custom' && startDate && endDate) { 
        start = new Date(startDate); start.setHours(0,0,0,0); 
        end = new Date(endDate); end.setHours(23,59,59,999); 
    } else {
        end = new Date(); end.setHours(23,59,59,999); 
        start = new Date(); start.setHours(0,0,0,0);
        switch(range) { 
            case 'today': break; 
            case 'thisWeek': start.setDate(start.getDate() - start.getDay() + (start.getDay() === 0 ? -6 : 1)); break; 
            case 'thisMonth': start = new Date(now.getFullYear(), now.getMonth(), 1); break; 
            case 'thisYear': start = new Date(now.getFullYear(), 0, 1); break; 
            default: start = new Date(now.getFullYear(), now.getMonth(), 1); 
        }
    }
    
    let filtered = (state.data.transactions || []).filter(tr => {
      const trDate = new Date(tr.date); 
      let isMatch = trDate >= start && trDate <= end;
      if (accountId && accountId !== 'all' && tr.accountId !== accountId && tr.fromAccountId !== accountId && tr.toAccountId !== accountId) isMatch = false;
      if (category && category !== 'all' && tr.category !== category) isMatch = false;
      return isMatch;
    }).sort((a,b) => new Date(b.date + 'T' + (b.time||'00:00') + ':00') - new Date(a.date + 'T' + (a.time||'00:00') + ':00'));
  
    const currentLang = Utils.getLang() === 'sr' ? 'sr-RS' : 'en-US';

    const rows = filtered.map(tr => {
      let details, income, expense;
      const statusBadge = tr.status === 'pending' ? `<span class="bg-warning text-black text-[10px] px-1.5 py-0.5 rounded ml-2 uppercase font-extrabold shadow-sm">${Utils.t('cashflow.txPending')}</span>` : `<span class="bg-success text-white text-[10px] px-1.5 py-0.5 rounded ml-2 uppercase font-extrabold shadow-sm">${Utils.t('cashflow.txCompleted')}</span>`;
      const autoBadge = tr.isAutoGenerated ? `<span class="bg-purple-100 text-purple-700 text-[10px] px-1.5 py-0.5 rounded ml-1 uppercase font-bold border border-purple-200">${Utils.t('cashflow.autoGenerated')}</span>` : '';
      const timeStr = tr.time ? ` <span class="text-[var(--muted)] font-normal">${tr.time}</span>` : '';
      const refStr = tr.reference ? ` <span class="text-blue-500 font-bold ml-2">| Ref: ${Utils.escapeHtml(tr.reference)}</span>` : '';
      
      if (tr.type === 'transfer') {
        const fromAcc = state.data.accounts.find(a => a.id === tr.fromAccountId); 
        const toAcc = state.data.accounts.find(a => a.id === tr.toAccountId);
        details = `<div class="font-bold text-warning mb-1">${Utils.t('cashflow.transfer_type')} ${statusBadge} ${autoBadge}</div><div class="text-sm font-semibold">${Utils.t('cashflow.fromAccount')}: <span class="text-main">${fromAcc?.name || '-'}</span> ➔ ${Utils.t('cashflow.toAccount')}: <span class="text-main">${toAcc?.name || '-'}</span>${refStr}</div>`;
        income = '-'; 
        expense = `<span class="text-[var(--muted)]">(${Utils.formatCurrency(tr.amount, tr.currency)} ${tr.targetAmount ? '➔ ' + Utils.formatCurrency(tr.targetAmount, toAcc?.currency || '') : ''})</span>`;
      } else {
        const account = state.data.accounts.find(a => a.id === tr.accountId);
        details = `<div class="font-bold text-main mb-1">${Utils.escapeHtml(tr.description)} ${statusBadge} ${autoBadge}</div><div class="text-sm font-semibold text-[var(--muted)]">${Utils.escapeHtml(account?.name || '-')} / <span class="text-main">${Utils.escapeHtml(tr.category || '-')}</span>${refStr}</div>`;
        income = tr.type === 'income' ? Utils.formatCurrency(tr.amount, tr.currency) : '-'; 
        expense = tr.type === 'expense' ? Utils.formatCurrency(tr.amount, tr.currency) : '-';
      }
      
      const rowOpacity = tr.status === 'pending' ? 'opacity-60 bg-[var(--bg)]' : 'hover:bg-[var(--hover-bg)]';
  
      return `<tr class="table-row border-b border-[var(--border)] transition-colors ${rowOpacity}">
          <td class="px-5 py-4 align-top"><div class="font-black text-main text-base whitespace-nowrap">${new Date(tr.date).toLocaleDateString(currentLang)}</div><div class="text-xs">${timeStr}</div></td>
          <td class="px-5 py-4 align-top">${details}</td>
          <td class="px-5 py-4 align-top text-base text-success font-black">${income}</td>
          <td class="px-5 py-4 align-top text-base text-danger font-black">${expense}</td>
          <td class="px-5 py-4 align-top text-right whitespace-nowrap">
              <button class="edit-transaction-btn text-blue-600 font-bold mr-4 hover:underline" data-id="${tr.id}">${Utils.t('actions.edit')}</button>
              <button class="delete-transaction-btn text-danger font-bold hover:underline" data-id="${tr.id}">${Utils.t('actions.delete')}</button>
          </td>
      </tr>`;
    }).join('');
    
    return `
    <table class="min-w-full data-table">
        <thead class="text-xs text-[var(--muted)] uppercase tracking-wider bg-[var(--hover-bg)]">
            <tr class="border-b border-[var(--border)]">
                <th class="px-5 py-3 text-left font-bold">${Utils.t('cashflow.date')}</th>
                <th class="px-5 py-3 text-left font-bold">${Utils.t('cashflow.description')}</th>
                <th class="px-5 py-3 text-left font-bold">${Utils.t('cashflow.income')}</th>
                <th class="px-5 py-3 text-left font-bold">${Utils.t('cashflow.expense')}</th>
                <th class="px-5 py-3 text-right font-bold">${Utils.t('actions.details')}</th>
            </tr>
        </thead>
        <tbody class="divide-y divide-[var(--border)] bg-[var(--card)]">
            ${rows || `<tr><td colspan="5" class="p-10 text-center text-[var(--muted)] font-bold text-lg border-dashed border-2">${Utils.t('finances.noData')}</td></tr>`}
        </tbody>
    </table>`;
}