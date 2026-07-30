// static/js/modules/partners/partners_actions.js
function showPartnerAccessModal(partnerId) {
    const partner = state.data.partners.find(p => p.id === partnerId);
    if(!partner) return;
    
    fetch('/api/users').then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
    }).then(users => {
        if (!Array.isArray(users)) users = [];
        const workers = users.filter(u => u.role !== 'admin');
        const listHtml = workers.map(w => {
            const isShared = (partner.sharedWith || []).includes(w.id);
            const isOwner = partner.ownerId === w.id;
            return `
            <label class="flex items-center justify-between p-3 bg-[var(--panel)] border border-[var(--border)] rounded-lg cursor-pointer hover:bg-[var(--hover-bg)] transition-colors">
                <div class="flex items-center gap-3">
                    <span class="text-2xl">👤</span>
                    <div>
                        <div class="font-bold text-main">${escapeHtml(w.username)}</div>
                        ${isOwner ? `<div class="text-xs text-blue-500 font-bold uppercase">CREATOR (Owner)</div>` : ''}
                    </div>
                </div>
                <input type="checkbox" name="sharedWorker" value="${w.id}" class="w-6 h-6 text-green-500 bg-[var(--card)] border-[var(--border)] focus:ring-green-500" ${isShared || isOwner ? 'checked' : ''} ${isOwner ? 'disabled' : ''}>
            </label>
            `;
        }).join('') || `<p class="text-[var(--muted)] text-center p-4">${Utils.t('finances.noData')}</p>`;
        
        const html = `
        <form id="access-form" class="space-y-4">
            <p class="text-sm text-[var(--muted)] mb-4">${Utils.t('users.accessManageDesc')}</p>
            <div class="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-2">
                ${listHtml}
            </div>
            <div class="flex justify-end pt-4 border-t border-[var(--border)]">
                <button type="submit" class="btn bg-accent text-white px-8 shadow-lg">${Utils.t('actions.saveChanges')}</button>
            </div>
        </form>`;
        openModal(Utils.t('users.accessManageTitle'), html, async (fd) => {
            const shared = fd.getAll('sharedWorker');
            partner.sharedWith = shared;
            await saveSingleItem('partners', partner);
            closeModal();
            renderPartnerDetailView(partnerId);
        });
    });
}

function showDocumentsModal(type, itemId){
    const item = state.data[type].find(i => i.id === itemId);
    if(!item) return;
    
    const docs = item.documents || [];
    
    let listHtml = docs.length ? docs.map((d, idx) => {
        let expiryBadge = '';
        if (d.expiryDate) {
            const expD = new Date(d.expiryDate);
            const diffDays = Math.ceil((expD - new Date()) / (1000 * 60 * 60 * 24));
            
            if (diffDays < 0) {
                expiryBadge = `<span class="bg-red-100 text-red-800 text-[10px] font-bold px-2 py-0.5 rounded border border-red-300 ml-2 whitespace-nowrap uppercase">${Utils.getLang() === 'sr' ? 'ISTEKLO' : 'EXPIRED'}</span>`;
            } else if (diffDays <= 30) {
                expiryBadge = `<span class="bg-orange-100 text-orange-800 text-[10px] font-bold px-2 py-0.5 rounded border border-orange-300 ml-2 whitespace-nowrap uppercase">${Utils.getLang() === 'sr' ? 'Ističe uskoro' : 'Expiring Soon'} (${diffDays}d)</span>`;
            } else {
                expiryBadge = `<span class="bg-green-100 text-green-800 text-[10px] font-bold px-2 py-0.5 rounded border border-green-300 ml-2 whitespace-nowrap uppercase">${Utils.getLang() === 'sr' ? 'Važi do' : 'Valid until'}: ${expD.toLocaleDateString(Utils.getLang() === 'sr' ? 'sr-RS' : 'en-US')}</span>`;
            }
        }

        if (d.isExternal) {
            return `<li class="mb-2 flex items-center justify-between p-3 bg-[var(--panel)] border border-[var(--border)] rounded-lg"><div class="flex items-center gap-3 overflow-hidden flex-wrap"><span class="text-xs font-bold bg-yellow-100 text-yellow-800 border border-yellow-300 px-2 py-1 rounded whitespace-nowrap">${Utils.t('misc.linkFolderLabel')}</span><a class="text-blue-600 dark:text-blue-400 font-medium hover:underline truncate block" href="${escapeHtml(d.link)}" target="_blank">${escapeHtml(d.name)}</a> ${expiryBadge}</div><div><button class="btn small bg-red-100 text-red-600 border border-red-200 hover:bg-red-600 hover:text-white transition-colors del-doc ml-2" data-idx="${idx}" data-type="${type}">${Utils.t('actions.delete')}</button></div></li>`;
        }
        return `<li class="mb-2 flex items-center justify-between p-3 bg-[var(--panel)] border border-[var(--border)] rounded-lg"><div class="flex items-center gap-3 overflow-hidden flex-wrap"><span class="text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300 px-2 py-1 rounded whitespace-nowrap">${Utils.t('misc.fileLabel')}</span><a class="file-link font-medium truncate block text-blue-600 dark:text-blue-400 hover:underline" data-idx="${idx}" data-type="${type}" href="${d.dataUrl||'#'}" target="_blank">${escapeHtml(d.name)} <span class="text-[var(--muted)] font-normal text-xs ml-1">${d.size ? '('+formatBytes(d.size)+')' : ''}</span></a> ${expiryBadge}</div><div><button class="btn small bg-red-100 text-red-600 border border-red-200 hover:bg-red-600 hover:text-white transition-colors del-doc ml-2" data-idx="${idx}" data-type="${type}">${Utils.t('actions.delete')}</button></div></li>`;
    }).join('') : `<p class="text-[var(--muted)] p-4 text-center border-dashed border-2 rounded-lg font-medium">${Utils.t('finances.noData')}</p>`;
    
    const html = `
    <div>
      <ul id="docs-list" class="mb-6 max-h-60 overflow-y-auto custom-scrollbar pr-2 space-y-2">${listHtml}</ul>
      
      <div class="border-2 border-dashed border-blue-300 bg-blue-50/50 dark:bg-blue-900/10 p-5 rounded-xl mb-4">
          <h5 class="font-black mb-3 text-blue-600 uppercase tracking-wider text-sm">${Utils.t('misc.add_physical_file')}</h5>
          <div class="flex gap-3 items-center flex-wrap">
              <input id="doc-file" type="file" class="form-input flex-1 bg-[var(--card)]" />
              <div class="flex items-center gap-2">
                  <label class="text-xs font-bold text-main whitespace-nowrap">${Utils.getLang() === 'sr' ? 'Ističe:' : 'Expires:'}</label>
                  <input id="doc-expiry" type="date" class="form-input bg-[var(--card)] w-36" title="${Utils.getLang() === 'sr' ? 'Opciono: Odredi rok trajanja dokumenta' : 'Optional: Set document expiry date'}" />
              </div>
              <button id="upload-doc" class="btn bg-blue-600 text-white shadow-md whitespace-nowrap px-6">📤 Upload</button>
          </div>
      </div>
      
      <div class="border-2 border-dashed border-yellow-300 bg-yellow-50/50 dark:bg-yellow-900/10 p-5 rounded-xl">
          <h5 class="font-black mb-3 text-yellow-600 uppercase tracking-wider text-sm">${Utils.t('misc.addLink')}</h5>
          <form id="add-link-form" class="space-y-3">
              <input name="linkName" class="form-input bg-[var(--card)]" placeholder="${Utils.t('misc.nameLabel')}" required />
              <input name="linkUrl" class="form-input bg-[var(--card)]" placeholder="${Utils.t('misc.pathLabel')} (https://...)" required />
              <div class="flex justify-between items-center mt-2">
                  <div class="flex items-center gap-2">
                      <label class="text-xs font-bold text-main whitespace-nowrap">${Utils.getLang() === 'sr' ? 'Ističe (opciono):' : 'Expires (Optional):'}</label>
                      <input name="expiryDate" type="date" class="form-input bg-[var(--card)] w-36" />
                  </div>
                  <button type="submit" class="btn bg-yellow-500 text-black font-bold shadow-md px-6">${Utils.t('actions.save')}</button>
              </div>
          </form>
      </div>
    </div>`;
    
    openModal(Utils.t('misc.docLinksTitle'), html, null);
    
    document.getElementById('upload-doc').addEventListener('click', async () => {
      const file = document.getElementById('doc-file').files[0];
      const expiryDate = document.getElementById('doc-expiry').value;
      if(!file) return;
      const uploadBtn = document.getElementById('upload-doc');
      
      const fileLimit = (state.settings.fileLimitMB || (typeof FILE_LIMIT_MB !== 'undefined' ? FILE_LIMIT_MB : 50)) * 1024 * 1024;
      if(file.size > fileLimit) {
            alert(Utils.t('misc.fileLimitError')); return;
        }
      
      uploadBtn.innerText = `⏳ ${Utils.t('misc.loadingStatus')}`; uploadBtn.disabled = true;
      
      const fileUrl = await uploadFileToServer(file);
      
      if (fileUrl) {
          item.documents = item.documents || [];
          item.documents.push({ 
              id: Utils.generateId(), 
              name: file.name, 
              size: file.size, 
              uploadedAt: new Date().toISOString(), 
              dataUrl: fileUrl,
              expiryDate: expiryDate || null 
          });
          
          await saveSingleItem(type, item);
          closeModal(); showDocumentsModal(type, itemId);
      } else {
          uploadBtn.innerText = '📤 Upload'; uploadBtn.disabled = false;
      }
    });

    document.getElementById('add-link-form').addEventListener('submit', async (e) => {
        e.preventDefault(); const fd = new FormData(e.target);
        let linkUrl = fd.get('linkUrl');
        if (!linkUrl.startsWith('http://') && !linkUrl.startsWith('https://')) {
            linkUrl = 'https://' + linkUrl;
        }
        item.documents = item.documents || [];
        item.documents.push({ 
            id: Utils.generateId(), 
            name: fd.get('linkName'), 
            isExternal: true, 
            link: linkUrl, 
            uploadedAt: new Date().toISOString(),
            expiryDate: fd.get('expiryDate') || null
        });
        
        await saveSingleItem(type, item);
        closeModal(); showDocumentsModal(type, itemId);
    });
    
    document.querySelectorAll('.del-doc').forEach(b => b.addEventListener('click', async (e) => {
        if(!confirm(Utils.t('misc.confirmDelete'))) return;
        const idx = parseInt(e.currentTarget.dataset.idx, 10);
        const deletedDoc = item.documents.splice(idx, 1)[0];
        
        if (!deletedDoc.isExternal && deletedDoc.dataUrl) {
            await deleteFileFromServer(deletedDoc.dataUrl);
        }
        
        await saveSingleItem(type, item);
        closeModal(); showDocumentsModal(type, itemId);
    }));
}

function showActivityForm(partnerId) {
    const partner = state.data.partners.find(p => p.id === partnerId);
    const html = `
    <form id="activity-form" class="space-y-4 p-2">
        <div><label class="block text-sm font-bold text-main">${Utils.t('cashflow.date')}</label><input type="datetime-local" name="date" class="form-input mt-1 border-blue-300" value="${new Date().toISOString().slice(0,16)}" required></div>
        <div><label class="block text-sm font-bold text-main">${Utils.t('cashflow.category')}</label><input name="type" class="form-input mt-1" required placeholder="${Utils.t('placeholders.activityType')}"></div>
        <div><label class="block text-sm font-bold text-main">${Utils.t('cashflow.description')}</label><textarea name="note" class="form-input mt-1" rows="5" required placeholder="${Utils.t('placeholders.activityDetails')}"></textarea></div>
        <div class="flex justify-end pt-2"><button type="submit" class="btn bg-accent text-white shadow-lg px-8">${Utils.t('actions.save')}</button></div>
    </form>`;
    
    openModal(Utils.t('misc.addActivity'), html, async (fd) => {
        partner.activities = partner.activities || [];
        partner.activities.unshift({ id: Utils.generateId(), date: fd.get('date'), type: fd.get('type'), note: fd.get('note') });
        
        await saveSingleItem('partners', partner);
        closeModal();
        renderPartnerDetailView(partnerId);
    });
}