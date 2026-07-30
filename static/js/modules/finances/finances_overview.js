// static/js/modules/finances/finances_overview.js
function renderFinanceView() {
    const main = document.getElementById('main-content');
    if(!main) return;
    main.innerHTML = '';
    const header = Utils.createViewHeader(Utils.t('finances.title'), '', null); 
    if (header.querySelector('button')) header.querySelector('button').remove(); 
    main.appendChild(header);
  
    const filters = document.createElement('div'); 
    filters.className = 'p-4 bg-[var(--card)] rounded-lg mb-6 flex items-center gap-4 flex-wrap border border-[var(--border)] shadow-sm';
    
    filters.innerHTML = `
        <span class="text-sm font-bold text-main">${Utils.t('finances.filterBy')}:</span>
        <div class="flex gap-2 flex-wrap">
            <button class="btn small filter-btn" data-range="today">${Utils.t('finances.today')}</button>
            <button class="btn small filter-btn" data-range="thisWeek">${Utils.t('finances.thisWeek')}</button>
            <button class="btn small filter-btn" data-range="thisMonth">${Utils.t('finances.thisMonth')}</button>
            <button class="btn small filter-btn" data-range="thisYear">${Utils.t('finances.thisYear')}</button>
        </div>
        <div class="flex items-center gap-2">
            <span class="text-sm text-main font-medium">${Utils.t('finances.customRange')}:</span>
            <input type="date" id="finance-start-date" class="form-input small">
            <input type="date" id="finance-end-date" class="form-input small">
        </div>`;
    main.appendChild(filters);
  
    const activeRange = state.activeFilters.finances?.range || 'thisMonth'; 
    const { startDate, endDate } = state.activeFilters.finances || {};
    
    filters.querySelectorAll('.filter-btn').forEach(btn => {
        if (btn.dataset.range === activeRange) btn.classList.add('bg-accent', 'text-white'); 
        else btn.classList.add('bg-[var(--panel)]', 'border', 'border-[var(--border)]', 'text-main');
        
        btn.addEventListener('click', () => { 
            if(!state.activeFilters.finances) state.activeFilters.finances = {};
            state.activeFilters.finances.startDate = ''; 
            state.activeFilters.finances.endDate = ''; 
            Utils.handleFilterChange('finances', 'range', btn.dataset.range); 
        });
    });
    
    const startInput = filters.querySelector('#finance-start-date'); 
    const endInput = filters.querySelector('#finance-end-date');
    startInput.value = startDate || ''; endInput.value = endDate || '';
    
    const dateChangeHandler = () => { 
        if(!state.activeFilters.finances) state.activeFilters.finances = {};
        state.activeFilters.finances.range = 'custom'; 
        state.activeFilters.finances.startDate = startInput.value; 
        state.activeFilters.finances.endDate = endInput.value; 
        render(); 
    };
    startInput.addEventListener('change', dateChangeHandler); 
    endInput.addEventListener('change', dateChangeHandler);
  
    let filteredDeals = [];
    if(typeof CashflowEngine !== 'undefined') {
        filteredDeals = CashflowEngine.getFilteredFinanceData(); 
    }
    
    let totalRevenueBase = 0, totalExpensesBase = 0;
    const baseCurrency = state.settings?.currency || 'USD';
  
    const paidDeals = filteredDeals.filter(d => d.buyerPaidOn && d.supplierPaidOn);
    paidDeals.forEach(d => {
        const exRate = d.exchangeRate || 1;
        const sCur = d.sellingCurrency || d.currency || 'USD';
        
        const saleValue = (d.sellingPrice || 0) * (d.quantity || 1); 
        const purchaseValue = (d.purchasePrice || 0) * (d.quantity || 1) * exRate;
        const totalCosts = d.costs ? d.costs.reduce((s,c) => s + (c.amount || 0), 0) * exRate : 0;
        const bankCosts = (d.bankCosts || 0) * exRate;
        
        // FIX: Bezbedno pozivanje iz DealsCalculations, štiti od potpunog pada!
        let commission = 0;
        if(typeof DealsCalculations !== 'undefined') {
            commission = DealsCalculations.calculateTotalCommission(d, saleValue - purchaseValue - totalCosts - bankCosts);
        }
        
        const totalExpenseInSellCur = purchaseValue + totalCosts + bankCosts + commission;
        
        if(typeof Utils.convertCurrency === 'function') {
            totalRevenueBase += Utils.convertCurrency(saleValue, sCur, baseCurrency);
            totalExpensesBase += Utils.convertCurrency(totalExpenseInSellCur, sCur, baseCurrency);
        } else {
            totalRevenueBase += saleValue;
            totalExpensesBase += totalExpenseInSellCur;
        }
    });
    
    const summary = document.createElement('div'); 
    summary.className = 'grid grid-cols-1 md:grid-cols-3 gap-4 mb-6';
    summary.innerHTML = `
        <div class="p-5 bg-green-50 dark:bg-green-900/10 border border-success rounded-xl shadow-sm relative overflow-hidden">
            <div class="absolute right-0 top-0 w-2 h-full bg-success"></div>
            <div class="text-sm font-bold text-success uppercase tracking-wider mb-1">${Utils.t('finances.totalRevenue')} <span class="text-xs">(${baseCurrency})</span></div>
            <div class="text-3xl font-black text-success">${Utils.formatCurrency(totalRevenueBase, baseCurrency)}</div>
        </div>
        <div class="p-5 bg-red-50 dark:bg-red-900/10 border border-danger rounded-xl shadow-sm relative overflow-hidden">
            <div class="absolute right-0 top-0 w-2 h-full bg-danger"></div>
            <div class="text-sm font-bold text-danger uppercase tracking-wider mb-1">${Utils.t('finances.totalExpenses')} <span class="text-xs">(${baseCurrency})</span></div>
            <div class="text-3xl font-black text-danger">${Utils.formatCurrency(totalExpensesBase, baseCurrency)}</div>
        </div>
        <div class="p-5 bg-blue-50 dark:bg-blue-900/10 border border-blue-500 rounded-xl shadow-sm relative overflow-hidden">
            <div class="absolute right-0 top-0 w-2 h-full bg-blue-500"></div>
            <div class="text-sm font-bold text-blue-600 dark:text-blue-300 uppercase tracking-wider mb-1">${Utils.t('finances.netProfit')} <span class="text-xs">(${baseCurrency})</span></div>
            <div class="text-3xl font-black text-blue-600 dark:text-blue-300">${Utils.formatCurrency(totalRevenueBase - totalExpensesBase, baseCurrency)}</div>
        </div>`;
    main.appendChild(summary);
  
    const tablesContainer = document.createElement('div'); 
    tablesContainer.className = 'grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6';
    tablesContainer.innerHTML = `
        <div class="bg-[var(--card)] p-5 rounded-xl border border-[var(--border)] shadow-sm">
            <h3 class="font-bold mb-4 text-accent border-b border-[var(--border)] pb-2">${Utils.t('finances.receivables')}</h3>
            <div class="overflow-y-auto max-h-60 custom-scrollbar pr-2">${renderFinanceTable((state.data.deals||[]).filter(d => d.paymentDates?.buyer && !d.buyerPaidOn), 'buyer')}</div>
        </div>
        <div class="bg-[var(--card)] p-5 rounded-xl border border-[var(--border)] shadow-sm">
            <h3 class="font-bold mb-4 text-danger border-b border-[var(--border)] pb-2">${Utils.t('finances.payables')}</h3>
            <div class="overflow-y-auto max-h-60 custom-scrollbar pr-2">${renderFinanceTable((state.data.deals||[]).filter(d => d.paymentDates?.supplier && !d.supplierPaidOn), 'supplier')}</div>
        </div>`;
    main.appendChild(tablesContainer);
  
    const analyticsContainer = document.createElement('div'); 
    analyticsContainer.className = 'grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6';
    analyticsContainer.innerHTML = `
        <div class="bg-[var(--card)] p-5 rounded-xl border border-[var(--border)] shadow-sm flex flex-col">
            <h3 class="font-bold mb-4 text-main border-b border-[var(--border)] pb-2">${Utils.t('finances.cashFlow')}</h3>
            <div id="cashflow-chart-container" class="flex-1 min-h-[250px]"></div>
        </div>
        <div class="bg-[var(--card)] p-5 rounded-xl border border-[var(--border)] shadow-sm">
            <h3 class="font-bold mb-4 text-main border-b border-[var(--border)] pb-2">${Utils.t('finances.topPartners')}</h3>
            ${renderTopPartners(paidDeals)}
        </div>`;
    main.appendChild(analyticsContainer); 
    
    renderCashFlowChart(paidDeals);
}
  
function renderFinanceTable(data, type) {
    if (!data || data.length === 0) return `<p class="text-sm text-[var(--muted)] font-medium py-4 text-center border-dashed border-2 rounded-lg">${Utils.t('finances.noData')}</p>`;
    const currentLang = Utils.getLang() === 'sr' ? 'sr-RS' : 'en-US';
    
    const rows = data.map(d => {
        const amt = type === 'buyer' ? ((d.sellingPrice || 0) * (d.quantity || 1)) : ((d.purchasePrice || 0) * (d.quantity || 1));
        const cur = type === 'buyer' ? (d.sellingCurrency || d.currency || 'USD') : (d.purchaseCurrency || d.currency || 'USD');
        return `
        <tr class="table-row text-sm border-b border-[var(--border)] hover:bg-[var(--hover-bg)] transition-colors">
            <td class="py-3 px-2 text-main font-medium">${Utils.escapeHtml((type === 'buyer') ? d.buyerName : d.supplierName)}</td>
            <td class="py-3 px-2 font-bold ${type === 'buyer' ? 'text-success' : 'text-danger'}">${Utils.formatCurrency(amt, cur)}</td>
            <td class="py-3 px-2 text-[var(--muted)]">${new Date(d.paymentDates[type]).toLocaleDateString(currentLang)}</td>
        </tr>`;
    }).join('');
    
    return `
    <table class="w-full">
        <thead>
            <tr class="text-xs text-[var(--muted)] uppercase tracking-wider border-b border-[var(--border)] bg-[var(--hover-bg)]">
                <th class="text-left py-2 px-2">${type === 'buyer' ? Utils.t('finances.buyer') : Utils.t('finances.supplier')}</th>
                <th class="text-left py-2 px-2">${Utils.t('finances.amount')}</th>
                <th class="text-left py-2 px-2">${Utils.t('finances.dueDate')}</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>`;
}
  
function renderTopPartners(deals) {
    if (!deals || deals.length === 0) return `<p class="text-sm text-[var(--muted)] py-4 text-center">${Utils.t('finances.noData')}</p>`;
    const baseCurrency = state.settings?.currency || 'USD';
    const partnerTurnover = {};
    
    deals.forEach(d => {
        if(d.buyerId) {
            const v = (d.sellingPrice || 0) * (d.quantity || 1);
            const conv = typeof Utils.convertCurrency === 'function' ? Utils.convertCurrency(v, d.sellingCurrency || d.currency || 'USD', baseCurrency) : v;
            partnerTurnover[d.buyerId] = (partnerTurnover[d.buyerId] || 0) + conv;
        }
        if(d.supplierId) {
            const v = (d.purchasePrice || 0) * (d.quantity || 1);
            const conv = typeof Utils.convertCurrency === 'function' ? Utils.convertCurrency(v, d.purchaseCurrency || d.currency || 'USD', baseCurrency) : v;
            partnerTurnover[d.supplierId] = (partnerTurnover[d.supplierId] || 0) + conv;
        }
    });
    
    const sortedPartners = Object.keys(partnerTurnover).sort((a,b) => partnerTurnover[b] - partnerTurnover[a]).slice(0, 5);
    
    return `<div class="space-y-2">${sortedPartners.map(id => `
        <div class="text-sm flex justify-between p-2 bg-[var(--panel)] rounded border border-[var(--border)] hover:bg-[var(--hover-bg)] transition-colors">
            <span class="font-medium text-main">${Utils.escapeHtml(Utils.getPartnerNameById(id))}</span>
            <span class="font-bold text-accent">${Utils.formatCurrency(partnerTurnover[id], baseCurrency)}</span>
        </div>`).join('')}</div>`;
}
  
function renderCashFlowChart(deals) {
    const container = document.getElementById('cashflow-chart-container');
    if (!deals || deals.length === 0) { 
        container.innerHTML = `<div class="flex items-center justify-center h-full text-[var(--muted)] font-medium border-dashed border-2 rounded-lg">${Utils.t('finances.noData')}</div>`; 
        return; 
    }
    
    const revenues = {}; 
    const expenses = {};
    const baseCurrency = state.settings?.currency || 'USD';
    
    deals.forEach(d => {
        const date = new Date(d.buyerPaidOn).toISOString().slice(0, 7);
        const exRate = d.exchangeRate || 1;
        const sCur = d.sellingCurrency || d.currency || 'USD';
        
        const saleValue = (d.sellingPrice || 0) * (d.quantity || 1);
        const purchaseValue = (d.purchasePrice || 0) * (d.quantity || 1) * exRate;
        const totalCosts = d.costs ? d.costs.reduce((s,c) => s + (c.amount || 0), 0) * exRate : 0;
        const bankCosts = (d.bankCosts || 0) * exRate;
        
        let commission = 0;
        if(typeof DealsCalculations !== 'undefined') commission = DealsCalculations.calculateTotalCommission(d, saleValue - purchaseValue - totalCosts - bankCosts);
        const totalExpenseInSellCur = purchaseValue + totalCosts + bankCosts + commission;
  
        const revConv = typeof Utils.convertCurrency === 'function' ? Utils.convertCurrency(saleValue, sCur, baseCurrency) : saleValue;
        const expConv = typeof Utils.convertCurrency === 'function' ? Utils.convertCurrency(totalExpenseInSellCur, sCur, baseCurrency) : totalExpenseInSellCur;
        
        revenues[date] = (revenues[date] || 0) + revConv;
        expenses[date] = (expenses[date] || 0) + expConv;
    });
    
    const labels = Object.keys(revenues).concat(Object.keys(expenses)).filter((v,i,a) => a.indexOf(v) === i).sort();
    if(labels.length === 0) { 
        container.innerHTML = `<div class="flex items-center justify-center h-full text-[var(--muted)] font-medium border-dashed border-2 rounded-lg">${Utils.t('finances.noData')}</div>`; 
        return; 
    }
    
    const maxVal = Math.max(...Object.values(revenues), ...Object.values(expenses));
    
    const chartBars = labels.map(label => {
        const rev = revenues[label] || 0; 
        const exp = expenses[label] || 0;
        return `
        <div class="flex flex-col items-center flex-1 group">
            <div class="w-full flex justify-around items-end h-[180px] bg-[var(--panel)] rounded border border-[var(--border)] relative overflow-hidden">
                <div class="w-2/5 bg-gradient-to-t from-green-600 to-green-400 rounded-t shadow-lg transition-all duration-300 group-hover:opacity-80" style="height: ${maxVal > 0 ? (rev / maxVal) * 100 : 0}%" title="${Utils.t('finances.totalRevenue')}: ${Utils.formatCurrency(rev, baseCurrency)}"></div>
                <div class="w-2/5 bg-gradient-to-t from-red-600 to-red-400 rounded-t shadow-lg transition-all duration-300 group-hover:opacity-80" style="height: ${maxVal > 0 ? (exp / maxVal) * 100 : 0}%" title="${Utils.t('finances.totalExpenses')}: ${Utils.formatCurrency(exp, baseCurrency)}"></div>
            </div>
            <div class="text-xs mt-3 font-bold text-[var(--muted)] bg-[var(--hover-bg)] px-2 py-1 rounded">${label}</div>
        </div>`;
    }).join('');
    
    container.innerHTML = `<div class="flex justify-between items-end h-full gap-2 mt-2">${chartBars}</div>`;
}