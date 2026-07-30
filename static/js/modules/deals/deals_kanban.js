// static/js/modules/deals/deals_kanban.js
function renderDealsKanbanView() {
  const main = document.getElementById('main-content');
  if(!main) return;
  main.innerHTML = '';
  
  const header = Utils.createViewHeader(Utils.t('nav.deals'), Utils.t('add.deal'), () => showDealForm());
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'btn bg-[var(--panel)] border border-[var(--border)] ml-4 hover:bg-[var(--hover-bg)] text-main'; 
  toggleBtn.innerText = `📋 ${Utils.t('actions.list_view')}`;
  toggleBtn.onclick = () => { renderDealsListView(); };
  header.querySelector('h2').appendChild(toggleBtn);
  main.appendChild(header);

  const filters = document.createElement('div'); 
  filters.className = 'filter-container p-4 rounded-lg mb-6 grid grid-cols-1 md:grid-cols-3 gap-4 border border-[var(--border)] bg-[var(--card)]';
  
  const isBuyer = p => (p.types||[]).includes('buyer') || (p.types||[]).includes('Kupac');
  const isSupplier = p => (p.types||[]).includes('supplier') || (p.types||[]).includes('Dobavljač');
  
  const buyerOpts = `<option value="">${Utils.t('actions.select_buyer')}</option>` + (state.data.partners||[]).filter(isBuyer).map(p=>`<option value="${p.id}">${Utils.escapeHtml(p.companyName)}</option>`).join('');
  const supplierOpts = `<option value="">${Utils.t('actions.select_supplier')}</option>` + (state.data.partners||[]).filter(isSupplier).map(p=>`<option value="${p.id}">${Utils.escapeHtml(p.companyName)}</option>`).join('');
  
  filters.innerHTML = `
      <div><label class="block text-sm font-medium text-[var(--muted)] mb-1">${Utils.t('fields.status')}</label><select id="filter-deal-status" class="form-input border-gray-300 focus:border-accent"><option value="">${Utils.t('misc.allTypesLabel')}</option><option value="negotiation">${Utils.t('deals.status_negotiation')}</option><option value="signed">${Utils.t('deals.status_signed')}</option><option value="payment_pending">${Utils.t('deals.status_payment')}</option><option value="completed">${Utils.t('deals.status_completed')}</option></select></div>
      <div><label class="block text-sm font-medium text-[var(--muted)] mb-1">${Utils.t('fields.buyer')}</label><select id="filter-deal-buyer" class="form-input border-gray-300 focus:border-accent">${buyerOpts}</select></div>
      <div><label class="block text-sm font-medium text-[var(--muted)] mb-1">${Utils.t('fields.supplier')}</label><select id="filter-deal-supplier" class="form-input border-gray-300 focus:border-accent">${supplierOpts}</select></div>`;
  
  filters.querySelector('#filter-deal-status').value = state.activeFilters.deals?.status || ''; 
  filters.querySelector('#filter-deal-status').addEventListener('change', e => Utils.handleFilterChange('deals','status', e.target.value));
  
  filters.querySelector('#filter-deal-buyer').value = state.activeFilters.deals?.buyerId || ''; 
  filters.querySelector('#filter-deal-buyer').addEventListener('change', e => Utils.handleFilterChange('deals','buyerId', e.target.value));
  
  filters.querySelector('#filter-deal-supplier').value = state.activeFilters.deals?.supplierId || ''; 
  filters.querySelector('#filter-deal-supplier').addEventListener('change', e => Utils.handleFilterChange('deals','supplierId', e.target.value));
  
  main.appendChild(filters);

  const columnsDef = [
      { key: 'negotiation', legacyKey: 'U pregovorima', label: Utils.t('deals.status_negotiation') },
      { key: 'signed', legacyKey: 'Ugovor potpisan', label: Utils.t('deals.status_signed') },
      { key: 'payment_pending', legacyKey: 'Plaćanje u toku', label: Utils.t('deals.status_payment') },
      { key: 'completed', legacyKey: 'Završen', legacyKey2: 'Završeno', label: Utils.t('deals.status_completed') }
  ];

  const kanbanContainer = document.createElement('div'); 
  kanbanContainer.className = 'grid grid-cols-1 md:grid-cols-4 gap-6 items-start';
  
  const data = Utils.applyFiltersFor('deals');
  const canEdit = Utils.hasPerm('deals', 'edit');

  columnsDef.forEach((colDef) => {
      const col = document.createElement('div'); 
      col.className = 'kanban-column bg-[var(--card)] rounded-xl p-4 min-h-[400px] border border-[var(--border)] shadow-sm';
      col.innerHTML = `<h3 class="font-bold mb-4 pb-2 border-b border-[var(--border)] text-main uppercase tracking-wider text-sm">${colDef.label}</h3><div class="kanban-items space-y-3 min-h-[150px]" data-status="${colDef.key}"></div>`;
      const itemsContainer = col.querySelector('.kanban-items');
      
      const colData = data.filter(d => {
          if (state.activeFilters.deals?.status && colDef.key !== state.activeFilters.deals.status) return false;
          return d.status === colDef.key || d.status === colDef.legacyKey || d.status === colDef.legacyKey2;
      });

      colData.forEach(d => {
          const item = document.createElement('div'); 
          item.className = 'kanban-item p-4 bg-[var(--panel)] border border-[var(--border)] rounded-lg shadow cursor-move hover:shadow-lg transition-shadow relative group';
          item.dataset.id = d.id;
          
          const exRate = d.exchangeRate || 1;
          const purchaseVal = (d.purchasePrice || 0) * (d.quantity || 1) * exRate;
          const saleVal = (d.sellingPrice || 0) * (d.quantity || 1);
          const totalCosts = d.costs ? d.costs.reduce((s,c)=>s+(c.amount||0),0) * exRate : 0;
          const bankCosts = (d.bankCosts || 0) * exRate;
          
          let commission = 0;
          if(typeof DealsCalculations !== 'undefined') {
              commission = DealsCalculations.calculateTotalCommission(d, saleVal - purchaseVal - totalCosts - bankCosts);
          }

          const profit = saleVal - purchaseVal - totalCosts - bankCosts - commission;
          const profitColor = profit >= 0 ? 'text-success' : 'text-danger';
          const cur = d.sellingCurrency || d.currency || 'USD';

          item.innerHTML = `<div class="font-bold text-main mb-1 truncate pr-6 text-lg hover:text-blue-500" title="${Utils.escapeHtml(d.contractId)}">${Utils.escapeHtml(d.contractId)}</div>
          <div class="text-xs text-[var(--muted)] mb-2 font-medium">${Utils.escapeHtml(d.productName)}</div>
          <div class="flex justify-between items-center mt-3 pt-2 border-t border-[var(--border)] border-dashed">
             <span class="text-xs font-bold px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-[var(--muted)]">${d.quantity} ${Utils.escapeHtml(d.unit || '')}</span>
             <span class="font-black text-base ${profitColor}">${Utils.formatCurrency(profit, cur)}</span>
          </div>`;
          item.addEventListener('click', () => showDealForm({dealId: d.id}));
          itemsContainer.appendChild(item);
      });
      kanbanContainer.appendChild(col);
  });
  
  main.appendChild(kanbanContainer);

  if (typeof dragula !== 'undefined') {
      const cols = Array.from(kanbanContainer.querySelectorAll('.kanban-items'));
      let drake = dragula(cols, {
          moves: function (el, container, handle) {
              return canEdit;
          }
      });
      drake.on('drop', async (el, target, source, sibling) => {
          if (!canEdit) {
              drake.cancel(true);
              if (typeof showToast === 'function') showToast(Utils.t('users.accessDeniedEdit'), 'error');
              else alert(Utils.t('users.accessDeniedEdit'));
              return;
          }
          const dealId = el.dataset.id;
          const newStatus = target.dataset.status;
          const deal = state.data.deals.find(d => d.id === dealId);
          if (deal && deal.status !== newStatus) {
              deal.status = newStatus;
              deal.lastModified = new Date().toISOString();
              try {
                  await saveSingleItem('deals', deal);
                  // Opciono tiho osvežavanje tabele da svi proračuni budu čisti
              } catch(err) {
                  console.error("Save failed during drag", err);
                  drake.cancel(true);
              }
          }
      });
  }
}