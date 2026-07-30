// static/js/modules/partners/partners_details.js
function renderPartnerDetailView(partnerId) {
    const main = document.getElementById('main-content');
    const partner = state.data.partners.find(p => String(p.id) === String(partnerId));
    
    if (!partner) { 
        main.innerHTML = `<div class="p-10 text-center"><p class="text-lg text-[var(--muted)] mb-4 font-bold">${Utils.t('misc.partnerNotFound')}</p><button id="back-btn" class="btn bg-accent text-white shadow-lg">${Utils.t('actions.backToList')}</button></div>`; 
        document.getElementById('back-btn')?.addEventListener('click', () => { state.currentView = 'partners'; render(); }); 
        return; 
    }

    const contact = partner.contact || {};
    const address = partner.address || {};
    const bank = partner.bank || {};
    const social = partner.social || {}; 
    const tags = partner.tags || []; 
    const metadata = partner.metadata || {}; 
    const kyc = partner.kyc || { status: 'pending', riskLevel: 'low' }; 
    
    const header = Utils.createViewHeader(Utils.t('misc.partnerDetails'), Utils.t('actions.backToList'), () => { state.currentView = 'partners'; state.detailViewId = null; render(); });
    header.querySelector('#view-add-btn').className = 'btn bg-[var(--panel)] border border-[var(--border)] text-main hover:bg-[var(--hover-bg)] shadow-sm font-bold';
    header.querySelector('#view-add-btn').innerHTML = `⬅️ ${Utils.t('actions.backToList')}`;
    main.appendChild(header);
    
    const detailContainer = document.createElement('div'); 
    detailContainer.className = `bg-[var(--card)] rounded-2xl shadow-xl p-6 border ${partner.status === 'blacklisted' ? 'border-red-500 shadow-red-500/20' : 'border-[var(--border)]'} relative overflow-hidden`;
    
    const adminAccessBtn = state.user.role === 'admin' ? `<button id="access-partner-btn" class="btn bg-[var(--panel)] border border-[var(--border)] text-main font-bold shadow-sm hover:bg-[var(--hover-bg)]">🛡️ ${Utils.t('users.accessShareBtn')}</button>` : '';
    
    // OČIŠĆENA GORNJA KONTROLA (Samo operativne stvari)
    const actionButtons = `
        <div class="flex justify-end gap-3 mb-6 flex-wrap relative z-20">
            ${adminAccessBtn}
            <button id="edit-partner-btn" class="btn bg-yellow-500 text-black font-bold shadow-sm border border-yellow-600">✏️ ${Utils.t('actions.edit')}</button>
            <button id="docs-partner-btn" class="btn bg-blue-600 text-white font-bold shadow-sm border border-blue-700">📁 ${Utils.t('misc.docLinksTitle')}</button>
            <button id="delete-partner-btn" class="btn bg-red-50 text-red-600 font-bold shadow-sm border border-red-200 hover:bg-red-600 hover:text-white">🗑 ${Utils.t('actions.delete')}</button>
        </div>`;
        
    const currentLang = Utils.getLang() === 'sr' ? 'sr-RS' : 'en-US';

    const activitiesHtml = (partner.activities || []).map(a => `
        <div class="mb-4 pl-4 border-l-4 border-blue-500 relative bg-[var(--panel)] p-3 rounded-r-lg shadow-sm group hover:bg-[var(--hover-bg)] transition-colors">
            <div class="text-xs font-bold text-[var(--muted)] uppercase tracking-wider">${new Date(a.date).toLocaleString(currentLang)} • <span class="text-blue-600 dark:text-blue-400">${Utils.escapeHtml(a.type || '-')}</span></div>
            <div class="mt-2 whitespace-pre-wrap text-sm text-main font-medium">${Utils.escapeHtml(a.note || '-')}</div>
            <button class="absolute top-2 right-2 text-xs bg-red-100 text-red-600 px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity border border-red-200 hover:bg-red-600 hover:text-white del-activity" data-id="${a.id}">${Utils.t('actions.delete')}</button>
        </div>`).join('') || `<p class="text-[var(--muted)] p-4 text-center border-dashed border-2 rounded-lg font-medium">${Utils.t('finances.noData')}</p>`;
        
    let representationHtml = '';
    if(partner.entityType === 'person' && partner.linkedCompanyId) {
        const companyName = typeof Utils.getPartnerNameById === 'function' ? Utils.getPartnerNameById(partner.linkedCompanyId) : Utils.t('fields.linkedCompany');
        representationHtml = `
           <div class="mt-6 mb-6 p-5 border border-blue-200 bg-blue-50/50 dark:bg-blue-900/10 rounded-xl shadow-sm">
             <h4 class="font-black text-xs text-[var(--muted)] uppercase tracking-wider mb-3">${Utils.t('fields.linkedCompanyEntity')}</h4>
             <div class="inline-flex items-center gap-2 bg-[var(--card)] text-main px-4 py-2 rounded-lg cursor-pointer hover:bg-[var(--hover-bg)] border border-[var(--border)] shadow-sm transition-all" onclick="state.currentView='partnerDetail'; state.detailViewId='${partner.linkedCompanyId}'; render();"><span class="text-xl text-blue-500">🏢</span> <span class="font-bold text-sm">${Utils.escapeHtml(companyName)}</span></div>
           </div>
        `;
    } else if (partner.entityType !== 'person') {
        const representatives = state.data.partners.filter(p => p.entityType === 'person' && p.linkedCompanyId === partner.id);
        if(representatives.length > 0) {
            representationHtml = `
               <div class="mt-6 mb-6 p-5 border border-[var(--border)] bg-[var(--panel)] rounded-xl shadow-sm">
                 <h4 class="font-black text-xs text-[var(--muted)] uppercase tracking-wider mb-3">${Utils.t('fields.representatives')}</h4>
                 <div class="flex gap-3 flex-wrap">
                    ${representatives.map(r => `<div class="inline-flex items-center gap-2 bg-[var(--card)] text-main px-4 py-2 rounded-lg cursor-pointer hover:bg-[var(--hover-bg)] border border-[var(--border)] shadow-sm transition-all" onclick="state.currentView='partnerDetail'; state.detailViewId='${r.id}'; render();"><span class="text-xl text-blue-500">👤</span> <span class="font-bold text-sm">${Utils.escapeHtml(r.companyName || '-')}</span></div>`).join('')}
                 </div>
               </div>
            `;
        }
    }
    
    const translatedTypes = (partner.types || []).map(typ => {
        if(typ === 'Kupac' || typ === 'buyer') return `<span class="bg-blue-100 text-blue-800 px-2 py-0.5 rounded uppercase font-black text-[10px] border border-blue-300">${Utils.t('finances.buyer')}</span>`;
        if(typ === 'Dobavljač' || typ === 'supplier') return `<span class="bg-orange-100 text-orange-800 px-2 py-0.5 rounded uppercase font-black text-[10px] border border-orange-300">${Utils.t('finances.supplier')}</span>`;
        if(typ === 'Saradnik' || typ === 'associate') return `<span class="bg-gray-100 text-gray-800 px-2 py-0.5 rounded uppercase font-black text-[10px] border border-gray-300">Associate</span>`;
        return typ;
    }).join(' ');

    const ratingStars = '⭐'.repeat(parseInt(partner.rating || 0)) || `<span class="text-[var(--muted)] text-sm">${Utils.t('fields.noRating')}</span>`;
    
    let statusBadge = `<span class="px-3 py-1 rounded-full text-[10px] tracking-wider font-black bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-sm">${Utils.t('fields.active')}</span>`;
    let bgGradient = 'from-slate-100 to-transparent dark:from-slate-800/40';
    
    if(partner.status === 'inactive') {
        statusBadge = `<span class="px-3 py-1 rounded-full text-[10px] tracking-wider font-black bg-gray-200 text-gray-700 border border-gray-400 shadow-sm">${Utils.t('fields.inactive')}</span>`;
    } else if(partner.status === 'blacklisted') {
        statusBadge = `<span class="px-3 py-1 rounded-full text-[10px] tracking-wider font-black bg-red-100 text-red-800 border border-red-400 shadow-sm">${Utils.t('fields.blacklisted').toUpperCase()}</span>`;
        bgGradient = 'from-red-100 to-transparent dark:from-red-900/40';
    }

    const copyBtn = (text) => text && text !== '-' ? `<button class="ml-2 text-[var(--muted)] hover:text-blue-500 transition-colors" onclick="navigator.clipboard.writeText('${String(text).replace(/'/g, "\\'")}'); alert('${Utils.t('misc.copied')}');" title="${Utils.t('actions.copy')}">📋</button>` : '';

    const quickActions = `
        <div class="flex gap-2 mt-4 flex-wrap relative z-20">
            ${contact.email ? `<a href="mailto:${Utils.escapeHtml(contact.email)}" class="btn small bg-[var(--panel)] border border-[var(--border)] text-main hover:bg-[var(--hover-bg)] transition-all rounded-full shadow-sm font-bold text-xs">📧 Email</a>` : ''}
            ${contact.whatsapp ? `<a href="https://wa.me/${Utils.escapeHtml(contact.whatsapp).replace(/[^0-9]/g, '')}" target="_blank" class="btn small bg-[var(--panel)] border border-[var(--border)] text-main hover:bg-[var(--hover-bg)] transition-all rounded-full shadow-sm font-bold text-xs">💬 WhatsApp</a>` : ''}
            ${contact.phone ? `<a href="tel:${Utils.escapeHtml(contact.phone)}" class="btn small bg-[var(--panel)] border border-[var(--border)] text-main hover:bg-[var(--hover-bg)] transition-all rounded-full shadow-sm font-bold text-xs">📞 ${Utils.t('misc.call')}</a>` : ''}
        </div>
    `;

    let mapLink = '';
    if(address.street || address.city || address.country) {
        const query = encodeURIComponent(`${address.street || ''} ${address.city || ''} ${address.country || ''}`.trim());
        mapLink = `<a href="https://www.google.com/maps/search/?api=1&query=${query}" target="_blank" class="text-blue-500 hover:text-blue-700 hover:underline text-xs ml-2 flex items-center gap-1 inline-flex bg-[var(--panel)] px-2 py-0.5 rounded border border-[var(--border)] shadow-sm"><span class="text-xs">🗺️</span> ${Utils.t('misc.maps')}</a>`;
    }

    const tagsHtml = tags.length > 0 ? tags.map(t => `<span class="bg-indigo-50 text-indigo-700 text-[10px] uppercase font-black px-2 py-1 rounded border border-indigo-200 shadow-sm">${Utils.escapeHtml(t)}</span>`).join('') : `<span class="text-[var(--muted)] text-[10px] font-bold border border-dashed border-[var(--border)] px-2 py-1 rounded">${Utils.t('misc.noTags')}</span>`;

    let documentWarnings = '';
    if (partner.documents && partner.documents.length > 0) {
        const expiringDocs = [];
        const expiredDocs = [];
        const today = new Date();
        
        partner.documents.forEach(d => {
            if (d.expiryDate) {
                const diff = Math.ceil((new Date(d.expiryDate) - today) / (1000 * 60 * 60 * 24));
                if (diff < 0) expiredDocs.push(Utils.escapeHtml(d.name));
                else if (diff <= 30) expiringDocs.push(`${Utils.escapeHtml(d.name)} (${diff}d)`);
            }
        });
        
        if (expiredDocs.length > 0 || expiringDocs.length > 0) {
            documentWarnings = `
            <div class="bg-slate-900 border-l-4 border-amber-500 p-4 mb-6 rounded-r-xl shadow-lg relative z-20 text-white">
                <div class="flex items-center gap-2 mb-2">
                    <span class="text-amber-500">⚠️</span>
                    <h4 class="font-black text-amber-500 uppercase tracking-widest text-xs">${Utils.t('misc.docRenewal')}</h4>
                </div>
                ${expiredDocs.length > 0 ? `<p class="text-xs font-bold text-slate-300 mb-1">${Utils.t('misc.expired')} <span class="text-white">${expiredDocs.join(', ')}</span></p>` : ''}
                ${expiringDocs.length > 0 ? `<p class="text-xs font-bold text-slate-400">${Utils.t('misc.expiringSoon')} <span class="text-white">${expiringDocs.join(', ')}</span></p>` : ''}
            </div>`;
        }
    }

    let kycWarning = '';
    if (kyc.status === 'rejected' || kyc.riskLevel === 'high') {
        kycWarning = `
        <div class="bg-slate-900 border-l-4 border-red-500 p-4 mb-6 rounded-r-xl shadow-lg relative z-20 text-white">
            <div class="flex items-center gap-3">
                <span class="text-2xl">🛑</span>
                <div>
                    <h4 class="font-black text-red-400 uppercase tracking-widest text-xs">COMPLIANCE RESTRICTION</h4>
                    <p class="text-[10px] font-bold text-slate-400 mt-1">${Utils.t('misc.highRiskAlert')}</p>
                </div>
            </div>
        </div>`;
    }

    const kycMap = {
        'pending': { color: 'text-slate-500 bg-slate-100 border-slate-300', icon: '⏳', label: Utils.t('kyc.pending') },
        'approved': { color: 'text-emerald-700 bg-emerald-100 border-emerald-300', icon: '✅', label: Utils.t('kyc.approved') },
        'update_requested': { color: 'text-amber-700 bg-amber-100 border-amber-300', icon: '⚠️', label: Utils.t('kyc.updateReq') },
        'rejected': { color: 'text-red-700 bg-red-100 border-red-300', icon: '🚫', label: Utils.t('kyc.blocked') }
    };
    const kInfo = kycMap[kyc.status] || kycMap['pending'];
    const kycBadge = `<span class="px-2 py-1 rounded text-[10px] font-black uppercase border ${kInfo.color}">${kInfo.icon} ${kInfo.label}</span>`;

    detailContainer.innerHTML = actionButtons + kycWarning + documentWarnings + `
        <div class="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl ${bgGradient} rounded-bl-full pointer-events-none opacity-40 z-0"></div>
        <div class="flex flex-col md:flex-row items-start md:items-center gap-5 mb-4 relative z-10">
          <div class="w-16 h-16 min-w-[4rem] rounded-xl bg-[var(--panel)] flex items-center justify-center text-3xl shadow-sm border border-[var(--border)]">${partner.entityType === 'person' ? '👤' : '🏢'}</div>
          <div>
             <h3 class="text-3xl font-black text-main leading-none mb-2 tracking-tight">${Utils.escapeHtml(partner.companyName || '-')}</h3>
             <div class="text-sm mt-2 flex flex-wrap items-center gap-2">
                 ${statusBadge}
                 <span class="ml-2">${ratingStars}</span>
             </div>
             ${quickActions}
          </div>
        </div>
        
        <div class="mt-6 flex flex-wrap gap-2 relative z-10">${translatedTypes}</div>
        ${representationHtml}
        
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8 relative z-10">
            <div class="bg-[var(--panel)] rounded-xl border border-[var(--border)] p-5 shadow-sm">
               <h4 class="font-black text-[var(--muted)] uppercase tracking-wider text-xs mb-4 border-b border-[var(--border)] pb-2 flex items-center gap-2"><span class="text-blue-500">📄</span> ${Utils.t('fields.basicData')}</h4>
               <div class="space-y-3">
                   <div class="flex flex-col"><span class="text-[10px] font-bold text-[var(--muted)] uppercase">${Utils.t('fields.taxId')}</span><div class="text-sm font-bold text-main flex items-center">${Utils.escapeHtml(partner.taxId || '-')} ${copyBtn(partner.taxId)}</div></div>
                   <div class="flex flex-col"><span class="text-[10px] font-bold text-[var(--muted)] uppercase">${Utils.t('fields.regNumber')}</span><div class="text-sm font-bold text-main flex items-center">${Utils.escapeHtml(partner.regNumber || '-')} ${copyBtn(partner.regNumber)}</div></div>
                   <div class="flex flex-col pt-3 border-t border-dashed border-[var(--border)] mt-2">
                       <span class="text-[10px] font-bold text-[var(--muted)] uppercase">${Utils.t('fields.leadSource')}</span>
                       <span class="text-sm font-bold text-blue-600">${Utils.escapeHtml(partner.leadSource || '-')}</span>
                   </div>
                   <div class="flex flex-col pt-3 border-t border-[var(--border)] mt-2">
                       <span class="text-[10px] font-bold text-[var(--muted)] uppercase mb-2">🏷️ ${Utils.t('fields.tags')}</span>
                       <div class="flex flex-wrap gap-1.5">${tagsHtml}</div>
                   </div>
               </div>
            </div>
            
            <div class="bg-[var(--panel)] rounded-xl border border-[var(--border)] p-5 shadow-sm">
               <h4 class="font-black text-[var(--muted)] uppercase tracking-wider text-xs mb-4 border-b border-[var(--border)] pb-2 flex items-center gap-2"><span class="text-emerald-500">📞</span> ${Utils.t('fields.contactInfo')}</h4>
               <div class="space-y-3">
                   <div class="flex flex-col"><span class="text-[10px] font-bold text-[var(--muted)] uppercase">${Utils.t('fields.contactPerson')}</span><span class="text-sm font-bold text-main">${Utils.escapeHtml(contact.person || '-')}</span></div>
                   <div class="flex flex-col"><span class="text-[10px] font-bold text-[var(--muted)] uppercase">${Utils.t('fields.contactEmail')}</span><span class="text-sm font-bold text-blue-600 hover:underline"><a href="mailto:${Utils.escapeHtml(contact.email || '')}">${Utils.escapeHtml(contact.email || '-')}</a></span></div>
                   <div class="grid grid-cols-2 gap-2">
                       <div class="flex flex-col"><span class="text-[10px] font-bold text-[var(--muted)] uppercase">${Utils.t('fields.phone')}</span><span class="text-sm font-bold text-main">${Utils.escapeHtml(contact.phone || '-')}</span></div>
                       <div class="flex flex-col"><span class="text-[10px] font-bold text-[var(--muted)] uppercase">${Utils.t('fields.whatsapp')}</span><span class="text-sm font-bold text-emerald-600">${Utils.escapeHtml(contact.whatsapp || '-')}</span></div>
                   </div>
                   <div class="flex flex-col"><span class="text-[10px] font-bold text-[var(--muted)] uppercase">${Utils.t('fields.website')}</span><span class="text-sm font-bold text-blue-500 hover:underline"><a href="${contact.website?.startsWith('http') ? '' : 'https://'}${Utils.escapeHtml(contact.website || '#')}" target="_blank">${Utils.escapeHtml(contact.website || '-')}</a></span></div>
               </div>
            </div>
            
            <div class="bg-[var(--panel)] rounded-xl border border-[var(--border)] p-5 shadow-sm">
               <h4 class="font-black text-[var(--muted)] uppercase tracking-wider text-xs mb-4 border-b border-[var(--border)] pb-2 flex items-center gap-2"><span class="text-indigo-500">📍</span> ${Utils.t('fields.addressInfo')}</h4>
               <div class="space-y-3">
                   <div class="flex flex-col"><span class="text-[10px] font-bold text-[var(--muted)] uppercase flex justify-between items-center">${Utils.t('fields.street')} ${mapLink}</span><span class="text-sm font-bold text-main">${Utils.escapeHtml(address.street || '-')}</span></div>
                   <div class="flex flex-col"><span class="text-[10px] font-bold text-[var(--muted)] uppercase">${Utils.t('fields.city')} / ${Utils.t('fields.zip')}</span><span class="text-sm font-bold text-main">${Utils.escapeHtml(address.city || '-')} ${Utils.escapeHtml(address.zip || '')}</span></div>
                   <div class="flex flex-col"><span class="text-[10px] font-bold text-[var(--muted)] uppercase">${Utils.t('fields.country')}</span><span class="text-sm font-bold text-main">${Utils.escapeHtml(address.country || '-')}</span></div>
               </div>
            </div>
            
            <div class="bg-[var(--panel)] rounded-xl border border-[var(--border)] p-5 shadow-sm lg:col-span-1">
               <h4 class="font-black text-[var(--muted)] uppercase tracking-wider text-xs mb-4 border-b border-[var(--border)] pb-2 flex items-center gap-2"><span class="text-amber-500">🏦</span> ${Utils.t('fields.bankInfo')}</h4>
               <div class="space-y-3">
                   <div class="flex flex-col"><span class="text-[10px] font-bold text-[var(--muted)] uppercase">${Utils.t('fields.bankName')}</span><span class="text-sm font-bold text-main">${Utils.escapeHtml(bank.name || '-')}</span></div>
                   <div class="flex flex-col"><span class="text-[10px] font-bold text-[var(--muted)] uppercase">${Utils.t('fields.accountNumber')}</span><div class="text-sm font-bold text-main flex items-center break-all">${Utils.escapeHtml(bank.accountNumber || '-')} ${copyBtn(bank.accountNumber)}</div></div>
                   <div class="flex flex-col"><span class="text-[10px] font-bold text-[var(--muted)] uppercase">${Utils.t('fields.swift')}</span><div class="text-sm font-bold text-main flex items-center">${Utils.escapeHtml(bank.swift || '-')} ${copyBtn(bank.swift)}</div></div>
               </div>
            </div>
            
            <div class="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl border border-indigo-200 dark:border-indigo-800 p-5 shadow-sm lg:col-span-1">
               <h4 class="font-black text-indigo-800 dark:text-indigo-400 uppercase tracking-wider text-xs mb-4 border-b border-indigo-200 dark:border-indigo-800 pb-2 flex items-center gap-2"><span class="text-indigo-600">🛡️</span> B2B Portal & Compliance</h4>
               <div class="space-y-4">
                   <div class="flex justify-between items-center mb-2">
                       <span class="text-[10px] font-bold text-indigo-700 dark:text-indigo-400 uppercase tracking-widest">KYC Status</span>
                       ${kycBadge}
                   </div>
                   <!-- Risk score placeholder — async fetch nakon rendera -->
                   <div id="partner-risk-tile" class="rounded-lg border border-slate-200 bg-white p-2 text-xs" style="display:none">
                       <div class="flex items-center justify-between">
                           <span class="text-[10px] font-bold uppercase tracking-widest text-slate-500">Risk Score</span>
                           <span id="risk-band" class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 uppercase">—</span>
                       </div>
                       <div class="flex items-center gap-2 mt-1">
                           <div class="flex-1 h-2 rounded-full bg-slate-200 overflow-hidden">
                               <div id="risk-bar" class="h-full transition-all" style="width:0%"></div>
                           </div>
                           <span id="risk-score" class="text-lg font-bold text-slate-900">—</span>
                       </div>
                       <details class="mt-1">
                           <summary class="text-[10px] text-slate-500 cursor-pointer hover:text-slate-700">Breakdown</summary>
                           <ul id="risk-breakdown" class="text-[10px] text-slate-500 mt-1 space-y-0.5 pl-3 list-disc"></ul>
                       </details>
                   </div>
                   <button id="kyc-partner-btn" class="w-full btn bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-2 shadow-sm border border-indigo-800">📄 ${Utils.t('kyc.reviewTitle')}</button>
                   <button id="b2b-portal-btn" class="w-full btn bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs py-2 shadow-sm border border-slate-900">🌐 ${Utils.t('misc.b2bLinkBtn')}</button>
                   <button id="portal-invite-btn" class="w-full btn bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs py-2 shadow-sm border border-blue-800">📧 Send Portal Invite / Reset</button>
                   <button id="portal-setpwd-btn" class="w-full btn bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs py-2 shadow-sm border border-amber-800">🔑 Set Portal Password</button>
                   <button id="partner-inventory-btn" class="w-full btn bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs py-2 shadow-sm border border-emerald-800" title="Track stock on hand and movements for this partner (Faza 5)">📦 Inventory</button>
                   ${partner.portalToken ? `<button id="portal-access-btn" class="w-full btn ${partner.isPortalActive === false ? 'bg-emerald-600 hover:bg-emerald-700 border-emerald-800' : 'bg-rose-600 hover:bg-rose-700 border-rose-800'} text-white font-bold text-xs py-2 shadow-sm border">${partner.isPortalActive === false ? '✅ ' + Utils.t('misc.portalReactivate') : '🔒 ' + Utils.t('misc.portalRevoke')}</button>` : ''}
               </div>
            </div>
            
            <div class="bg-[var(--panel)] rounded-xl border border-[var(--border)] p-5 shadow-sm lg:col-span-1">
               <h4 class="font-black text-[var(--muted)] uppercase tracking-wider text-xs mb-4 border-b border-[var(--border)] pb-2 flex items-center gap-2"><span class="text-rose-500">🌐</span> ${Utils.t('misc.socialMedia')}</h4>
               <div class="grid grid-cols-1 gap-3">
                   <div class="flex flex-col"><span class="text-[10px] font-bold text-[var(--muted)] uppercase">LinkedIn</span><span class="text-sm font-bold text-blue-700 hover:underline"><a href="${social.linkedin?.startsWith('http') ? '' : 'https://'}${Utils.escapeHtml(social.linkedin || '#')}" target="_blank">${Utils.escapeHtml(social.linkedin || '-')}</a></span></div>
                   <div class="flex flex-col"><span class="text-[10px] font-bold text-[var(--muted)] uppercase">Facebook</span><span class="text-sm font-bold text-blue-600 hover:underline"><a href="${social.facebook?.startsWith('http') ? '' : 'https://'}${Utils.escapeHtml(social.facebook || '#')}" target="_blank">${Utils.escapeHtml(social.facebook || '-')}</a></span></div>
                   <div class="flex flex-col"><span class="text-[10px] font-bold text-[var(--muted)] uppercase">Twitter / X</span><span class="text-sm font-bold text-slate-800 dark:text-slate-200 hover:underline"><a href="${social.twitter?.startsWith('http') ? '' : 'https://'}${Utils.escapeHtml(social.twitter || '#')}" target="_blank">${Utils.escapeHtml(social.twitter || '-')}</a></span></div>
               </div>
            </div>
        </div>
        
        <div class="mt-8 bg-[var(--panel)] p-5 rounded-xl border border-[var(--border)] shadow-sm">
           <h4 class="font-black text-[var(--muted)] mb-3 uppercase tracking-wider text-xs flex items-center gap-2">📝 ${Utils.t('fields.notes')}</h4>
           <p class="text-main text-sm font-medium whitespace-pre-wrap leading-relaxed">${Utils.escapeHtml(partner.notes || Utils.t('finances.noData'))}</p>
        </div>
        
        <div class="mt-10 border-t border-[var(--border)] pt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
           <div class="lg:col-span-2">
               <div class="flex justify-between items-center mb-6">
                  <h4 class="font-black text-xl text-main">${Utils.t('fields.activitiesAndDeals')}</h4>
                  <button id="add-activity-btn" class="btn bg-[var(--panel)] border border-[var(--border)] hover:bg-[var(--hover-bg)] text-main shadow-sm font-bold text-xs">+ ${Utils.t('misc.addActivity')}</button>
               </div>
               <div class="bg-[var(--card)] p-2 rounded-xl border border-[var(--border)] max-h-96 overflow-y-auto custom-scrollbar pr-2">
                  ${activitiesHtml}
               </div>
           </div>
           
           <div class="bg-slate-50 dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-inner h-fit">
               <h4 class="font-black text-sm text-slate-500 uppercase tracking-widest mb-6 border-b border-slate-200 dark:border-slate-700 pb-2">📊 ${Utils.t('misc.systemMetrics')}</h4>
               <div class="space-y-4">
                   <div class="flex justify-between items-center pb-3 border-b border-slate-200 dark:border-slate-800">
                       <span class="text-xs font-bold text-slate-400 uppercase">${Utils.t('misc.sysStatus')}</span>
                       <span class="font-black text-[10px] px-2 py-0.5 rounded-full ${partner.status === 'active' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-red-100 text-red-700 border border-red-200'}">${partner.status === 'active' ? Utils.t('fields.active') : Utils.t('fields.inactive')}</span>
                   </div>
                   <div class="flex justify-between items-center pb-3 border-b border-slate-200 dark:border-slate-800">
                       <span class="text-xs font-bold text-slate-400 uppercase">${Utils.t('misc.dateAdded')}</span>
                       <span class="font-bold text-slate-700 dark:text-slate-300 text-xs">${metadata.createdAt ? new Date(metadata.createdAt).toLocaleDateString(currentLang) : Utils.t('misc.notRecorded')}</span>
                   </div>
                   <div class="mt-4">
                       <p class="text-[10px] text-slate-400 font-bold uppercase mb-1">${Utils.t('misc.automationNote')}</p>
                       <p class="text-xs text-slate-600 dark:text-slate-400 font-medium leading-relaxed">${Utils.t('misc.automationDesc')} <strong class="text-blue-500">${Utils.escapeHtml(partner.taxId || 'N/A')}</strong></p>
                   </div>
               </div>
           </div>
        </div>
    `;
    main.appendChild(detailContainer);

    document.getElementById('b2b-portal-btn').addEventListener('click', async () => {
        const btn = document.getElementById('b2b-portal-btn');
        btn.innerText = '⏳...'; btn.disabled = true;
        try {
            const res = await fetch(`/api/portal/generate/${partnerId}`, { method: 'POST' });
            const data = await res.json();
            if(data.status === 'success') {
                const link = `${window.location.origin}/portal/${data.token}`;
                const mHtml = `
                <div class="text-center p-4">
                    <p class="text-sm text-gray-500 font-bold mb-4 uppercase">${Utils.t('misc.portalLinkGen')}</p>
                    <div class="bg-slate-100 border border-slate-300 p-3 rounded-lg flex items-center justify-between gap-3 mb-4">
                        <input class="w-full bg-transparent outline-none text-slate-800 font-mono text-sm" value="${link}" readonly id="portal-link-input" />
                        <button class="bg-blue-600 text-white px-4 py-2 rounded-md font-bold hover:bg-blue-700" onclick="navigator.clipboard.writeText(document.getElementById('portal-link-input').value); alert('${Utils.t('misc.copied')}')">📋 Copy</button>
                    </div>
                    <p class="text-xs text-slate-400 italic">${Utils.t('misc.portalLinkDesc')}</p>
                </div>`;
                Utils.openModal('🌐 B2B Tracking Portal', mHtml, null);
                await loadFromStorage(); 
            } else { alert("Error: " + data.error); }
        } catch(e) { alert("Network Error."); }
        btn.innerHTML = `🌐 ${Utils.t('misc.b2bLinkBtn')}`; btn.disabled = false;
    });

    // KILL SWITCH: opoziv / reaktivacija pristupa partnera B2B portalu
    const portalAccessBtn = document.getElementById('portal-access-btn');
    if (portalAccessBtn) {
        portalAccessBtn.addEventListener('click', async () => {
            const willActivate = partner.isPortalActive === false;
            const confirmMsg = willActivate ? Utils.t('misc.portalReactivateConfirm') : Utils.t('misc.portalRevokeConfirm');
            if (!confirm(confirmMsg)) return;
            portalAccessBtn.disabled = true; portalAccessBtn.innerText = '⏳...';
            try {
                const res = await fetch(`/api/portal/access/${partnerId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ active: willActivate })
                });
                const data = await res.json();
                if (res.ok && data.status === 'success') {
                    await loadFromStorage();
                    renderPartnerDetailView(partnerId);
                } else {
                    alert("Error: " + (data.error || 'Unknown'));
                    portalAccessBtn.disabled = false;
                }
            } catch (e) {
                alert("Network Error.");
                portalAccessBtn.disabled = false;
            }
        });
    }

    // Send Portal Invite / Reset (Supabase Auth email) — koristi in-app modal + toast
    const inviteBtn = document.getElementById('portal-invite-btn');
    if (inviteBtn) {
        inviteBtn.addEventListener('click', async () => {
            const ok = await askConfirm(
                'Send Portal Invite / Reset?',
                'Slaće se Supabase Auth email partneru sa linkom za postavljanje portal lozinke. Ako Auth nalog ne postoji, biće kreiran automatski.'
            );
            if (!ok) return;
            inviteBtn.disabled = true; inviteBtn.innerText = '⏳ Sending...';
            try {
                const res = await fetch(`/api/portal/admin/send-portal-invite/${partnerId}`, { method: 'POST' });
                const data = await res.json();
                if (res.ok && data.status === 'success') {
                    showToast(data.message || 'Invite sent.', 'success');
                } else {
                    showToast('Greška: ' + (data.error || data.detail || 'nepoznato'), 'error', 6000);
                }
            } catch (e) { showToast('Mrežna greška: ' + e.message, 'error'); }
            inviteBtn.disabled = false; inviteBtn.innerHTML = '📧 Send Portal Invite / Reset';
        });
    }

    // Set Portal Password manually — in-app modal sa password input polje
    const setPwdBtn = document.getElementById('portal-setpwd-btn');
    if (setPwdBtn) {
        setPwdBtn.addEventListener('click', async () => {
            const pwd = await askInput('Set Portal Password', {
                description: 'Unesi novu lozinku za ovog partnera (min. 8 karaktera). Klijent može odmah da se uloguje sa njom. Prosledi mu je bezbednim kanalom (WhatsApp/telefon).',
                inputType: 'password',
                placeholder: 'nova lozinka',
                okText: 'Set Password',
            });
            if (!pwd) return;
            if (pwd.length < 8) {
                showToast('Lozinka mora biti najmanje 8 karaktera.', 'error');
                return;
            }
            setPwdBtn.disabled = true; setPwdBtn.innerText = '⏳ Setting...';
            try {
                const res = await fetch(`/api/portal/admin/set-partner-password/${partnerId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: pwd })
                });
                const data = await res.json();
                if (res.ok && data.status === 'success') {
                    showToast(data.message || 'Password set. Partner can sign in now.', 'success', 5000);
                } else {
                    showToast('Greška: ' + (data.error || data.detail || 'nepoznato'), 'error', 6000);
                }
            } catch (e) { showToast('Mrežna greška: ' + e.message, 'error'); }
            setPwdBtn.disabled = false; setPwdBtn.innerHTML = '🔑 Set Portal Password';
        });
    }

    if(state.user.role === 'admin') {
        document.getElementById('access-partner-btn').addEventListener('click', () => typeof showPartnerAccessModal === 'function' && showPartnerAccessModal(partnerId));
    }
    
    // POPRAVLJENA GREŠKA OTVARANJA KYC MODULA
    document.getElementById('kyc-partner-btn').addEventListener('click', () => {
        if(typeof reviewKYC === 'function') reviewKYC(partnerId);
        else alert(Utils.t('kyc.moduleNotLoaded'));
    });
    
    document.getElementById('edit-partner-btn').addEventListener('click', () => showPartnerForm(partnerId));
    document.getElementById('docs-partner-btn').addEventListener('click', () => typeof showDocumentsModal === 'function' && showDocumentsModal('partners', partnerId));

    const invBtn = document.getElementById('partner-inventory-btn');
    if (invBtn) invBtn.addEventListener('click', () => {
        if (typeof showPartnerInventoryModal === 'function') showPartnerInventoryModal(partnerId);
        else showToast('Inventory module not loaded.', 'error');
    });

    // BATCH D — load risk score async
    (async () => {
        try {
            const r = await fetch(`/api/partners/${encodeURIComponent(partnerId)}/risk-score`);
            if (!r.ok) return;
            const j = await r.json();
            const tile = document.getElementById('partner-risk-tile');
            const bar = document.getElementById('risk-bar');
            const sc = document.getElementById('risk-score');
            const band = document.getElementById('risk-band');
            const bd = document.getElementById('risk-breakdown');
            if (!tile) return;
            tile.style.display = '';
            sc.textContent = j.score;
            band.textContent = j.band;
            bar.style.width = j.score + '%';
            if (j.band === 'LOW') {
                band.className = 'text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 uppercase';
                bar.style.background = '#10b981';
            } else if (j.band === 'MEDIUM') {
                band.className = 'text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 uppercase';
                bar.style.background = '#f59e0b';
            } else {
                band.className = 'text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 uppercase';
                bar.style.background = '#ef4444';
            }
            bd.innerHTML = (j.breakdown || []).map(b =>
                `<li>${Utils.escapeHtml(b.factor)} <span class="${b.delta > 0 ? 'text-emerald-700' : (b.delta < 0 ? 'text-rose-700' : 'text-slate-400')}">${b.delta > 0 ? '+' : ''}${b.delta}</span></li>`
            ).join('') || '<li class="italic">No factors</li>';
        } catch(_) {}
    })();
    
    document.getElementById('delete-partner-btn').addEventListener('click', async () => {
        const _ok = await window.askConfirm('Obrisati partnera?', Utils.t('misc.confirmDelete'), { danger: true });
        if (_ok) {
            Utils.handleDelete('partners', partnerId);
            state.currentView = 'partners';
            render();
        }
    });
    
    document.getElementById('add-activity-btn').addEventListener('click', () => typeof showActivityForm === 'function' && showActivityForm(partnerId));
    
    document.querySelectorAll('.del-activity').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if(!confirm(Utils.t('misc.confirmDelete'))) return;
            partner.activities = partner.activities.filter(a => a.id !== e.currentTarget.dataset.id);
            await saveSingleItem('partners', partner);
            renderPartnerDetailView(partnerId);
        });
    });
}