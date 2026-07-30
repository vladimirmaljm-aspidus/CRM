// static/js/modules/partners/network.js
function showConnectionForm() {
    const partnerOptions = state.data.partners.map(p => `<option value="${p.id}">${Utils.escapeHtml(p.companyName)}</option>`).join('');
    const html = `
    <form id="connection-form" class="space-y-4 p-2">
        <div class="grid grid-cols-1 gap-4">
            <label class="block font-bold text-main">${Utils.t('network.source_company')} <select name="sourceId" class="form-input mt-1 border-blue-300" required><option value="">${Utils.t('misc.textFieldPlaceholder')}</option>${partnerOptions}</select></label>
            <label class="block font-bold text-main">${Utils.t('network.relation_type')} <input name="relationType" class="form-input mt-1" required placeholder="${Utils.t('placeholders.relationType')}" /></label>
            <label class="block font-bold text-main">${Utils.t('network.target_company')} <select name="targetId" class="form-input mt-1 border-blue-300" required><option value="">${Utils.t('misc.textFieldPlaceholder')}</option>${partnerOptions}</select></label>
            <label class="block font-bold text-main">${Utils.t('network.notes')} <input name="notes" class="form-input mt-1" placeholder="${Utils.t('placeholders.networkNotes')}" /></label>
        </div>
        <div class="flex justify-end pt-4"><button class="btn bg-accent text-white shadow-lg text-lg px-8" type="submit">${Utils.t('actions.save')}</button></div>
    </form>`;
    
    Utils.openModal(Utils.t('network.new_connection'), html, async (fd) => {
        if(fd.get('sourceId') === fd.get('targetId')) { 
             alert(Utils.t('network.error_self')); 
             return; 
         }
         
        const newConnection = { 
             id: Utils.generateId(), 
             sourceId: fd.get('sourceId'), 
             targetId: fd.get('targetId'), 
             relationType: fd.get('relationType'), 
             notes: fd.get('notes') 
         };
         
        state.data.connections.push(newConnection);
        await saveSingleItem('connections', newConnection); 
        Utils.closeModal(); 
        render();
    });
}

function renderNetworkView() {
    const main = document.getElementById('main-content');
    main.innerHTML = '';
    
    const header = Utils.createViewHeader(Utils.t('nav.network'), Utils.t('add.connection'), showConnectionForm);
    main.appendChild(header);
    
    const container = document.createElement('div');
    container.className = 'bg-[var(--card)] rounded-2xl shadow-xl p-6 min-h-[500px] border border-[var(--border)] relative overflow-hidden';
    
    const connectionsHtml = state.data.connections.map(c => {
        const source = state.data.partners.find(p => p.id === c.sourceId);
        const target = state.data.partners.find(p => p.id === c.targetId);
        if(!source || !target) return '';
        
        return `
        <div class="network-card bg-[var(--panel)] border border-[var(--border)] rounded-xl p-4 shadow-sm relative group hover:shadow-md transition-shadow">
            <div class="network-flow flex flex-col items-center">
                <div class="network-node w-full text-center bg-blue-50 dark:bg-blue-900/20 border border-blue-200 text-blue-800 dark:text-blue-300 font-bold py-2 px-4 rounded-lg cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-800 transition-colors shadow-sm" onclick="openPartner('${source.id}')">🏢 ${Utils.escapeHtml(source.companyName)}</div>
                
                <div class="network-edge my-3 text-center flex flex-col items-center relative w-full">
                    <div class="w-px h-6 bg-gray-300 dark:bg-gray-600 mb-1"></div>
                    <span class="bg-gray-100 dark:bg-gray-800 text-main text-xs font-black uppercase px-3 py-1 rounded-full border border-gray-300 dark:border-gray-600 shadow-sm z-10">${Utils.escapeHtml(c.relationType)}</span>
                    <span class="text-xs text-[var(--muted)] font-medium mt-1 text-center w-full truncate px-2" title="${Utils.escapeHtml(c.notes || '')}">${Utils.escapeHtml(c.notes || '')}</span>
                    <div class="w-px h-6 bg-gray-300 dark:bg-gray-600 mt-1 relative"><div class="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-2 h-2 border-b-2 border-r-2 border-gray-300 dark:border-gray-600 rotate-45"></div></div>
                </div>
                
                <div class="network-node w-full text-center bg-green-50 dark:bg-green-900/20 border border-green-200 text-green-800 dark:text-green-300 font-bold py-2 px-4 rounded-lg cursor-pointer hover:bg-green-100 dark:hover:bg-green-800 transition-colors shadow-sm" onclick="openPartner('${target.id}')">🏢 ${Utils.escapeHtml(target.companyName)}</div>
            </div>
            <button class="absolute top-2 right-2 btn small bg-red-100 text-red-600 border border-red-200 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 hover:text-white" onclick="deleteConnection('${c.id}')" title="${Utils.t('actions.delete')}">✕</button>
        </div>
        `;
    }).join('') || `<div class="col-span-full p-10 text-center border-dashed border-2 rounded-xl text-[var(--muted)] font-bold text-lg">${Utils.t('network.no_data')}</div>`;

    container.innerHTML = `
        <div class="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-blue-50 dark:from-blue-900/10 to-transparent pointer-events-none"></div>
        <p class="text-sm font-medium text-main mb-8 bg-blue-100 dark:bg-blue-900/30 inline-block px-4 py-2 rounded-lg border border-blue-200 shadow-sm relative z-10">ℹ️ ${Utils.t('network.info_text')}</p>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 relative z-10">${connectionsHtml}</div>
    `;
    main.appendChild(container);

    window.openPartner = (id) => { state.currentView = 'partnerDetail'; state.detailViewId = id; render(); };
    window.deleteConnection = async (id) => {
        const _ok = await window.askConfirm('Obrisati vezu?', Utils.t('misc.confirmDelete'), { danger: true });
        if(_ok) {
            state.data.connections = state.data.connections.filter(c => c.id !== id);
            await deleteItemFromServer('connections', id);
            render();
        }
    };
}