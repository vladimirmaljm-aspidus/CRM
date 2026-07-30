// static/js/modules/deals/deals_calculations.js
const DealsCalculations = {
    renderAssociateRow: function(associate, index) {
        const associateOptions = (state.data.partners||[]).filter(p => (p.types||[]).includes('associate') || (p.types||[]).includes('Saradnik'))
            .map(p => `<option value="${p.id}" ${associate.partnerId === p.id ? 'selected' : ''}>${Utils.escapeHtml(p.companyName)}</option>`).join('');
        return `
        <div class="flex gap-2 mb-2 associate-item">
            <select name="associateId_${index}" class="form-input small flex-1"><option value="">${Utils.t('actions.select_associate')}</option>${associateOptions}</select>
            <select name="commissionType_${index}" class="form-input small w-32">
                <option value="percent_profit" ${associate.commissionType === 'percent_profit' ? 'selected' : ''}>${Utils.t('deals.percentOfProfit')}</option>
                <option value="fixed_ton" ${associate.commissionType === 'fixed_ton' ? 'selected' : ''}>${Utils.t('deals.fixedPerTon')}</option>
                <option value="fixed_kg" ${associate.commissionType === 'fixed_kg' ? 'selected' : ''}>${Utils.t('deals.fixedPerKg')}</option>
            </select>
            <input name="commissionValue_${index}" type="number" step="0.01" class="form-input small w-24" placeholder="${Utils.t('deals.commissionValue')}" value="${associate.commissionValue || ''}">
            <button type="button" class="btn small bg-red-600 text-white remove-associate">🗑</button>
        </div>`;
    },
    attachRemoveListener: function(element, callback) {
        if(!element) return;
        const btn = element.querySelector('.remove-associate');
        if(btn) {
            btn.addEventListener('click', () => { 
                element.remove(); 
                if(callback) callback(); 
            });
        }
    },
    calculateTotalCommission: function(deal, baseProfit) {
        if(!deal.associates || deal.associates.length === 0) return 0;
        return deal.associates.reduce((total, asc) => {
            let commission = 0; 
            const val = asc.commissionValue || 0;
            switch(asc.commissionType) { 
                case 'percent_profit':
                    commission = baseProfit * (val / 100);
                    break;
                case 'fixed_ton': {
                    // ISPRAVKA: ranije se pretpostavljalo da je kolicina u kg ako
                    // jedinica nije eksplicitno 't'/'MT', sto je davalo pogresan
                    // obracun za lb/oz/g i sve nemerne jedinice (pcs, CBM, box...).
                    const tons = Utils.toMetricTons(deal.quantity, deal.unit);
                    commission = (tons !== null ? tons : deal.quantity) * val;
                    break;
                }
                case 'fixed_kg': {
                    const kilos = Utils.toKilograms(deal.quantity, deal.unit);
                    commission = (kilos !== null ? kilos : deal.quantity) * val;
                    break;
                }
            }
            return total + commission;
        }, 0);
    },
    initFormEvents: function(formEl) {
        if(!formEl) return;
        const pCur = document.getElementById('purchaseCurrency'); 
        const sCur = document.getElementById('sellingCurrency');
        const exCont = document.getElementById('exchange-rate-container');
        const exRateInp = formEl.querySelector('[name="exchangeRate"]');
        
        const supplierSelect = formEl.querySelector('[name="supplierId"]');
        if (supplierSelect) {
            supplierSelect.addEventListener('change', (e) => {
                const supplier = (state.data.partners||[]).find(p => p.id === e.target.value);
                const bankField = formEl.querySelector('[name="supplierBankDetails"]');
                if(supplier && supplier.bank && bankField && !bankField.value) {
                    bankField.value = `${Utils.t('invoice.bank')}: ${supplier.bank.name || ''}\n${Utils.t('invoice.account_no')}: ${supplier.bank.accountNumber || ''}\n${Utils.t('invoice.swift')}: ${supplier.bank.swift || ''}`;
                }
            });
        }

        // AUTO-FILL: kada se izabere kupac (buyer), popuni deliveryLocation iz kupčeve
        // adrese ako polje nije već ručno popunjeno. Format "city, country" (bez street-a
        // jer je delivery location obično luka/terminal a ne konkretna ulica).
        const buyerSelect = formEl.querySelector('[name="buyerId"]');
        if (buyerSelect) {
            buyerSelect.addEventListener('change', (e) => {
                const buyer = (state.data.partners||[]).find(p => p.id === e.target.value);
                const locField = formEl.querySelector('[name="deliveryLocation"]');
                if (buyer && buyer.address && locField && !locField.value) {
                    const parts = [buyer.address.city, buyer.address.country].filter(Boolean);
                    if (parts.length) locField.value = parts.join(', ');
                }
            });
        }

        // AUTO-FILL: kada se izabere product, ako user nije ručno odabrao unit/purchasePrice,
        // predloži iz prve supplyOffers stavke istog dobavljača.
        const productSelect = formEl.querySelector('[name="productId"]');
        if (productSelect) {
            productSelect.addEventListener('change', (e) => {
                const prod = (state.data.products||[]).find(p => p.id === e.target.value);
                if (!prod) return;
                const supplierId = formEl.querySelector('[name="supplierId"]')?.value;
                let src = null;
                if (supplierId && Array.isArray(prod.supplyOffers)) {
                    src = prod.supplyOffers.find(o => o.supplierId === supplierId);
                }
                if (!src && Array.isArray(prod.supplyOffers) && prod.supplyOffers.length > 0) {
                    src = prod.supplyOffers[0];
                }
                if (!src) return;
                const unitInp = formEl.querySelector('[name="unit"]');
                const purchasePrice = formEl.querySelector('[name="purchasePrice"]');
                const purchaseCurrency = formEl.querySelector('[name="purchaseCurrency"]');
                const incotermInp = formEl.querySelector('[name="incoterm"]');
                if (unitInp && !unitInp.value && src.unit) unitInp.value = src.unit;
                if (purchasePrice && !purchasePrice.value && src.price) purchasePrice.value = src.price;
                if (purchaseCurrency && src.currency) purchaseCurrency.value = src.currency;
                if (incotermInp && !incotermInp.value && src.incoterm) incotermInp.value = src.incoterm;
            });
        }
        const updateExRateUI = () => {
            if(!pCur || !sCur || !exCont) return;
            if(pCur.value !== sCur.value) { 
                exCont.classList.remove('hidden'); 
                const baseEl = document.getElementById('rate-base-cur');
                const targetEl = document.getElementById('rate-target-cur');
                if(baseEl) baseEl.innerText = pCur.value; 
                if(targetEl) targetEl.innerText = sCur.value;
            } else { 
                exCont.classList.add('hidden'); 
                if(exRateInp) exRateInp.value = 1; 
            }
        };
        if (pCur) pCur.addEventListener('change', updateExRateUI); 
        if (sCur) sCur.addEventListener('change', updateExRateUI); 
        updateExRateUI();

        const refreshBtn = document.getElementById('refresh-rate-btn');
        if(refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                const pc = pCur?.value; const sc = sCur?.value;
                if(typeof LIVE_RATES !== 'undefined' && pc && sc && LIVE_RATES[pc] && LIVE_RATES[sc]) {
                    const exactRate = LIVE_RATES[sc] / LIVE_RATES[pc];
                    if(exRateInp) {
                        exRateInp.value = exactRate.toFixed(6);
                        exRateInp.classList.add('bg-green-100'); 
                        setTimeout(() => exRateInp.classList.remove('bg-green-100'), 500);
                        formEl.dispatchEvent(new Event('input'));
                    }
                } else {
                    if (typeof showToast === 'function') showToast(Utils.t('misc.apiRateError'), 'error');
                    else alert(Utils.t('misc.apiRateError'));
                }
            });
        }

        const calcLiveProfit = () => {
            const pPrice = parseFloat(formEl.querySelector('[name="purchasePrice"]')?.value) || 0;
            const sPrice = parseFloat(formEl.querySelector('[name="sellingPrice"]')?.value) || 0;
            const qty = parseFloat(formEl.querySelector('[name="quantity"]')?.value) || 1;
            const exRate = parseFloat(formEl.querySelector('[name="exchangeRate"]')?.value) || 1;
            const unit = formEl.querySelector('[name="unit"]')?.value;
            const bankCosts = parseFloat(formEl.querySelector('[name="bankCosts"]')?.value) || 0;
            let costs = 0;
            formEl.querySelectorAll('input[name^="costAmount_"]').forEach(inp => costs += (parseFloat(inp.value)||0) * exRate);
            
            const purchaseValue = pPrice * qty * exRate;
            const saleValue = sPrice * qty;
            const baseProfit = saleValue - purchaseValue - costs - (bankCosts * exRate);
            
            let commission = 0;
            formEl.querySelectorAll('.associate-item').forEach(el => {
               const type = el.querySelector('[name^="commissionType_"]')?.value;
               const val = parseFloat(el.querySelector('[name^="commissionValue_"]')?.value) || 0;
               if(type === 'percent_profit') {
                   commission += baseProfit * (val / 100);
               } else if(type === 'fixed_ton') {
                   const tons = Utils.toMetricTons(qty, unit);
                   commission += (tons !== null ? tons : qty) * val;
               } else if(type === 'fixed_kg') {
                   const kilos = Utils.toKilograms(qty, unit);
                   commission += (kilos !== null ? kilos : qty) * val;
               }
            });
            const netProfit = baseProfit - commission;
            const sellCur = formEl.querySelector('[name="sellingCurrency"]')?.value || 'USD';
            const display = document.getElementById('live-profit-amount');
            if(display) {
                display.innerText = Utils.formatCurrency(netProfit, sellCur);
                display.className = `text-3xl font-extrabold ${netProfit >= 0 ? 'text-green-500' : 'text-red-500'}`;
            }
        };

        formEl.addEventListener('input', calcLiveProfit);

        const addCostBtn = document.getElementById('add-cost');
        if(addCostBtn) {
            addCostBtn.addEventListener('click', () => { 
                const container = document.getElementById('costs-container');
                if(!container) return;
                const div = document.createElement('div'); 
                div.className = 'flex gap-2 mb-2 cost-item'; 
                div.innerHTML = `
                    <input name="costType_${container.children.length}" class="form-input" placeholder="${Utils.t('fields.costType')}" />
                    <input name="costAmount_${container.children.length}" type="number" step="0.01" class="form-input" placeholder="${Utils.t('fields.costAmount')}" />
                    <button type="button" class="btn small bg-red-600 text-white remove-cost">🗑</button>`; 
                container.appendChild(div); 
                div.querySelector('.remove-cost').addEventListener('click', () => { div.remove(); calcLiveProfit(); }); 
                div.addEventListener('input', calcLiveProfit); 
                calcLiveProfit(); 
            });
        }
        
        document.querySelectorAll('#costs-container .remove-cost').forEach(b => 
            b.addEventListener('click', (e) => { e.currentTarget.closest('.cost-item').remove(); calcLiveProfit(); })
        );
        
        const addAssocBtn = document.getElementById('add-associate');
        if(addAssocBtn) {
            addAssocBtn.addEventListener('click', () => { 
                const container = document.getElementById('associates-container'); 
                if(!container) return;
                container.insertAdjacentHTML('beforeend', DealsCalculations.renderAssociateRow({}, container.children.length)); 
                DealsCalculations.attachRemoveListener(container.lastElementChild, calcLiveProfit); 
                container.lastElementChild.addEventListener('input', calcLiveProfit); 
                calcLiveProfit(); 
            });
        }
        document.querySelectorAll('.remove-associate').forEach(b => DealsCalculations.attachRemoveListener(b.closest('.associate-item'), calcLiveProfit));
        
        const calcPriceBtn = document.getElementById('calculate-price-btn');
        if(calcPriceBtn) {
            calcPriceBtn.addEventListener('click', () => { 
                const purchasePrice = parseFloat(formEl.querySelector('[name="purchasePrice"]')?.value) || 0; 
                const targetProfit = parseFloat(formEl.querySelector('[name="targetProfit"]')?.value) || 0; 
                const exRate = parseFloat(formEl.querySelector('[name="exchangeRate"]')?.value) || 1;
                const sellingInp = formEl.querySelector('[name="sellingPrice"]');
                if(purchasePrice > 0 && targetProfit > 0 && sellingInp) {
                    const priceInTargetCurrency = purchasePrice * exRate;
                    sellingInp.value = (priceInTargetCurrency * (1 + targetProfit / 100)).toFixed(2); 
                    calcLiveProfit();
                }
            });
        }
        calcLiveProfit();
    }
};