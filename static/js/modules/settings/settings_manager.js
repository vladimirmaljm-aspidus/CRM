// static/js/modules/settings/settings_manager.js

// Helper — prikazi rezultate audit provere kroz proper modal umesto alert()
// koji se ne vidi na mobilnom i pravi lošu UX. Ako je issues[] prazan,
// prikaži zelenu OK poruku; inace listu problema sa scroll-om.
function _showAuditResults(title, issues, okMessage, tLang) {
    const isOk = !issues || issues.length === 0;
    const escape = (s) => String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
    const body = isOk
        ? `<div class="p-6 text-center">
             <div class="w-16 h-16 mx-auto rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-3xl mb-3">✓</div>
             <p class="text-lg font-semibold text-slate-900">${escape(okMessage)}</p>
           </div>`
        : `<div class="p-4">
             <div class="flex items-center gap-3 mb-4 pb-3 border-b border-slate-200">
               <div class="w-11 h-11 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-xl">⚠</div>
               <div><b class="text-slate-900">${issues.length} ${tLang('problem(a) pronađeno', 'issue(s) found')}</b>
                    <p class="text-xs text-slate-500 mt-0.5">${tLang('Pregledajte i popravite pre nastavka.', 'Review and fix before continuing.')}</p></div>
             </div>
             <ul class="space-y-1.5 max-h-[52vh] overflow-y-auto pr-1">
               ${issues.map(i => `<li class="text-xs text-slate-700 leading-relaxed pl-3 py-1.5 border-l-2 border-amber-300 bg-amber-50/50 rounded-r">${escape(i)}</li>`).join('')}
             </ul>
           </div>`;
    if (typeof openModal === 'function') openModal(title, body);
    else if (typeof showToast === 'function') showToast(isOk ? okMessage : `${issues.length} issues found`, isOk ? 'success' : 'warn');
    else alert(isOk ? okMessage : issues.join('\n'));
}

const SettingsManager = {
    init: function() {
        console.log("Settings Manager Initialized");
    },

    showModal: async function() {
        const tLang = (srStr, enStr) => Utils.getLang() === 'sr' ? srStr : enStr;

        // 1. Priprema podataka
        state.company.bankAccounts = state.company.bankAccounts || [];
        if (state.company.bankAccounts.length === 0 && state.company.bankName) {
            state.company.bankAccounts.push({
                bankName: state.company.bankName, accountNumber: state.company.accountNumber,
                swiftCode: state.company.swift, currency: state.settings.currency || 'USD'
            });
            delete state.company.bankName; delete state.company.accountNumber; delete state.company.swift;
        }

        // Fetch dodatnih podataka
        let cSettings = {};
        try { const res = await fetch('/api/data/comms_settings'); if(res.ok) { const d = await res.json(); cSettings = d.value || {}; } } catch(e){}

        let fwData = { blocked: [], whitelist: [], blacklist: [], max_login: 10, max_portal: 50 };
        try { const fwRes = await fetch('/api/firewall/status'); if(fwRes.ok) fwData = await fwRes.json(); } catch(e){}

        const renderBankAccounts = () => {
            return state.company.bankAccounts.map((acc, i) => `
                <div class="p-4 bg-white border border-slate-200 rounded-lg flex justify-between items-center mb-2 shadow-sm transition-all hover:border-slate-300">
                    <div>
                        <span class="text-xs font-black text-slate-800 bg-slate-100 px-2 py-1 rounded mr-2">${escapeHtml(acc.currency)}</span> 
                        <span class="font-bold text-slate-800">${escapeHtml(acc.bankName)}</span><br>
                        <span class="text-slate-500 text-xs font-mono mt-1 block">ACC: ${escapeHtml(acc.accountNumber)} | SWIFT: ${escapeHtml(acc.swiftCode || '-')}</span>
                    </div>
                    <button type="button" class="text-slate-400 hover:text-red-600 px-2 transition-colors remove-bank" data-idx="${i}">✕</button>
                </div>
            `).join('') || `<p class="text-sm text-slate-400 italic p-4 text-center border border-dashed border-slate-200 rounded-lg">${tLang('Nema unetih bankovnih računa.', 'No bank accounts added.')}</p>`;
        };

        const renderBlockedIPs = () => {
            if (!fwData.blocked || fwData.blocked.length === 0) return `<div class="p-6 text-center border border-slate-200 bg-slate-50 rounded-lg text-slate-500 font-bold text-sm">${tLang('Sistem je čist. Nema aktivnih blokada.', 'System is clear. No active blocks.')}</div>`;
            return fwData.blocked.map(b => `
                <div class="flex justify-between items-center p-4 bg-white border border-slate-200 rounded-lg mb-2 shadow-sm">
                    <div>
                        <h4 class="font-bold text-slate-800 font-mono text-base">${escapeHtml(b.ip)}</h4>
                        <p class="text-xs text-slate-500 uppercase tracking-wider mt-1">🛑 ${escapeHtml(b.reason)} | ${escapeHtml(b.module)}</p>
                    </div>
                    <button type="button" class="bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 font-bold px-4 py-1.5 rounded-md text-xs transition-colors unblock-btn" data-ip="${escapeHtml(b.ip)}">UNBLOCK</button>
                </div>
            `).join('');
        };

        const html = `
        <div class="flex flex-col md:flex-row h-[85vh] bg-slate-50 rounded-b-2xl overflow-hidden">
            
            <div class="w-full md:w-64 bg-slate-900 flex-shrink-0 flex flex-col py-6 border-r border-slate-800">
                <div class="px-6 mb-6">
                    <h2 class="text-xs font-black text-slate-500 uppercase tracking-widest">Control Center</h2>
                </div>
                <div class="flex flex-col gap-1 px-3 overflow-y-auto custom-scrollbar">
                    <button class="settings-tab-btn active flex items-center gap-3 text-left px-4 py-3 rounded-lg text-sm font-bold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors" data-target="tab-company">
                        <span class="opacity-70">🏢</span> ${tLang('Podaci o Firmi', 'Company Data')}
                    </button>
                    <button class="settings-tab-btn flex items-center gap-3 text-left px-4 py-3 rounded-lg text-sm font-bold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors" data-target="tab-system">
                        <span class="opacity-70">⚙️</span> ${tLang('Sistemska Podešavanja', 'System Config')}
                    </button>
                    <button class="settings-tab-btn flex items-center gap-3 text-left px-4 py-3 rounded-lg text-sm font-bold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors" data-target="tab-comms">
                        <span class="opacity-70">📡</span> SMTP & Comms
                    </button>
                    <button class="settings-tab-btn flex items-center gap-3 text-left px-4 py-3 rounded-lg text-sm font-bold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors" data-target="tab-firewall">
                        <span class="opacity-70">🛡️</span> ${tLang('Sigurnost i Firewall', 'Security & Firewall')}
                    </button>
                    <button class="settings-tab-btn flex items-center gap-3 text-left px-4 py-3 rounded-lg text-sm font-bold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors" data-target="tab-database">
                        <span class="opacity-70">💾</span> ${tLang('Baza Podataka', 'Data Management')}
                    </button>
                    <button class="settings-tab-btn flex items-center gap-3 text-left px-4 py-3 rounded-lg text-sm font-bold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors" data-target="tab-integrations">
                        <span class="opacity-70">🔌</span> ${tLang('Integracije (API-ji)', 'Integrations (APIs)')}
                    </button>
                    <div class="my-2 border-t border-slate-800 mx-4"></div>
                    <button class="settings-tab-btn flex items-center gap-3 text-left px-4 py-3 rounded-lg text-sm font-bold text-amber-500 hover:text-amber-400 hover:bg-slate-800 transition-colors" data-target="tab-diagnostics">
                        <span class="opacity-70">🛠️</span> ${tLang('Dijagnostika i Alati', 'Diagnostics & Tools')}
                    </button>
                </div>
            </div>
            
            <div class="flex-1 bg-slate-50 relative flex flex-col">
                <form id="master-settings-form" class="h-full flex flex-col">
                    <div class="flex-1 overflow-y-auto custom-scrollbar p-8">
                        
                        <div id="tab-company" class="settings-pane block max-w-4xl mx-auto">
                            <h3 class="text-xl font-black text-slate-900 mb-8 pb-2 border-b border-slate-200">Company Information</h3>
                            
                            <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm mb-8">
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">${tLang('Naziv Kompanije', 'Company Name')}</label><input name="companyName" class="w-full bg-slate-50 border border-slate-200 rounded-md px-4 py-2.5 text-sm font-bold text-slate-900 focus:bg-white focus:border-slate-400 focus:ring-0 outline-none transition-all" value="${escapeHtml(state.company.name||'')}" /></div>
                                    <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">${tLang('Zvanična Adresa', 'Registered Address')}</label><input name="companyAddress" class="w-full bg-slate-50 border border-slate-200 rounded-md px-4 py-2.5 text-sm font-bold text-slate-900 focus:bg-white focus:border-slate-400 focus:ring-0 outline-none transition-all" value="${escapeHtml(state.company.address||'')}" /></div>
                                    <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">${tLang('Poreski Broj / PIB', 'Tax ID / VAT')}</label><input name="companyTax" class="w-full bg-slate-50 border border-slate-200 rounded-md px-4 py-2.5 text-sm font-mono text-slate-900 focus:bg-white focus:border-slate-400 focus:ring-0 outline-none transition-all" value="${escapeHtml(state.company.taxId||'')}" /></div>
                                    <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">${tLang('Matični Broj', 'Registration Number')}</label><input name="companyReg" class="w-full bg-slate-50 border border-slate-200 rounded-md px-4 py-2.5 text-sm font-mono text-slate-900 focus:bg-white focus:border-slate-400 focus:ring-0 outline-none transition-all" value="${escapeHtml(state.company.regNumber||'')}" /></div>
                                </div>
                            </div>

                            <div class="grid grid-cols-1 lg:grid-cols-5 gap-8 mb-8">
                                <div class="lg:col-span-3">
                                    <h5 class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Bank Accounts</h5>
                                    <div id="bank-accounts-list" class="max-h-60 overflow-y-auto custom-scrollbar pr-2 space-y-2">
                                        ${renderBankAccounts()}
                                    </div>
                                </div>
                                <div class="lg:col-span-2 bg-white p-5 rounded-xl border border-slate-200 shadow-sm h-fit">
                                    <h5 class="text-xs font-bold text-slate-800 uppercase tracking-widest mb-4">Add Bank Account</h5>
                                    <input id="new-bank-name" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm mb-3 focus:bg-white outline-none" placeholder="Bank Name" />
                                    <input id="new-bank-acc" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono mb-3 focus:bg-white outline-none" placeholder="Account No. / IBAN" />
                                    <div class="grid grid-cols-2 gap-3 mb-4">
                                        <input id="new-bank-swift" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono focus:bg-white outline-none" placeholder="SWIFT / BIC" />
                                        <select id="new-bank-curr" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-bold focus:bg-white outline-none">
                                            ${CURRENCIES.map(c => `<option value="${c}">${c}</option>`).join('')}
                                        </select>
                                    </div>
                                    <button type="button" id="add-bank-btn" class="w-full bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold py-2.5 rounded-md transition-colors uppercase tracking-wider">Add to List</button>
                                </div>
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div class="bg-white p-6 rounded-xl border border-slate-200 text-center shadow-sm">
                                    <label class="block text-sm font-bold text-slate-800 mb-2">Company Logo</label>
                                    <input type="file" name="companyLogo" class="text-xs text-slate-500 w-full" accept="image/*" />
                                </div>
                                <div class="bg-white p-6 rounded-xl border border-slate-200 text-center shadow-sm">
                                    <label class="block text-sm font-bold text-slate-800 mb-2">Official Stamp / Seal</label>
                                    <input type="file" name="companyStamp" class="text-xs text-slate-500 w-full" accept="image/*" />
                                </div>
                            </div>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                                <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                    <label class="block text-sm font-bold text-slate-800 mb-2">${tLang('Primarna boja portala/PDF-a', 'Primary color (Portal &amp; PDF)')}</label>
                                    <div class="flex items-center gap-3">
                                        <input type="color" name="brandColor" value="${escapeHtml(state.company.brandColor || '#2563eb')}" class="w-16 h-10 rounded border border-slate-300 cursor-pointer">
                                        <input type="text" name="brandColorHex" value="${escapeHtml(state.company.brandColor || '#2563eb')}" class="flex-1 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono" placeholder="#2563eb">
                                    </div>
                                    <p class="text-xs text-slate-500 mt-2">${tLang('Prikazuje se u B2B portalu klijenta i na PDF dokumentima.', 'Applied to the client B2B portal and PDF documents.')}</p>
                                </div>
                                <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                    <label class="block text-sm font-bold text-slate-800 mb-2">${tLang('Web adresa firme', 'Company Website')}</label>
                                    <input type="text" name="companyWebsite" value="${escapeHtml(state.company.website || '')}" class="w-full bg-slate-50 border border-slate-200 rounded-md px-4 py-2.5 text-sm outline-none" placeholder="https://example.com">
                                </div>
                            </div>
                        </div>

                        <div id="tab-system" class="settings-pane hidden max-w-4xl mx-auto space-y-8">
                            <h3 class="text-xl font-black text-slate-900 pb-2 border-b border-slate-200">System Configuration</h3>
                            
                            <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm grid grid-cols-2 lg:grid-cols-4 gap-6">
                                <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Language</label><select name="lang" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-bold outline-none"><option value="en" ${state.lang==='en'?'selected':''}>English</option><option value="sr" ${state.lang==='sr'?'selected':''}>Srpski</option></select></div>
                                <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Base Currency</label><select name="currency" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-bold outline-none">${CURRENCIES.map(c => `<option value="${c}" ${(state.settings.currency||'USD') === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
                                <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Global VAT (%)</label><input name="vatRate" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none" type="number" step="0.1" value="${state.settings.vatRate||5}" /></div>
                                <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Upload Limit (MB)</label><input name="fileLimitMB" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none" type="number" step="0.1" value="${state.settings.fileLimitMB||FILE_LIMIT_MB}" /></div>
                            </div>

                            <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm grid grid-cols-2 lg:grid-cols-3 gap-6">
                                <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Last Invoice No.</label><input name="lastInvoiceNumber" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none" type="number" value="${state.settings.lastInvoiceNumber||0}" /></div>
                                <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Last Offer No.</label><input name="lastOfferNumber" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none" type="number" value="${state.settings.lastOfferNumber||0}" /></div>
                                <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Payment Warning (Days)</label><input name="paymentWarningDays" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none" type="number" value="${state.settings.paymentWarningDays||7}" /></div>
                            </div>

                            <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Default Offer Remarks</label><textarea name="defaultOfferNotes" class="w-full bg-slate-50 border border-slate-200 rounded-md px-4 py-3 text-sm outline-none" rows="4">${escapeHtml(state.settings.defaultOfferNotes||'')}</textarea></div>
                                <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Default Invoice Remarks</label><textarea name="defaultInvoiceNotes" class="w-full bg-slate-50 border border-slate-200 rounded-md px-4 py-3 text-sm outline-none" rows="4">${escapeHtml(state.settings.defaultInvoiceNotes||'')}</textarea></div>
                            </div>
                        </div>

                        <div id="tab-comms" class="settings-pane hidden max-w-4xl mx-auto space-y-8">
                            <h3 class="text-xl font-black text-slate-900 pb-2 border-b border-slate-200">Communication & SMTP</h3>
                            
                            <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm relative">
                                <h4 class="text-xs font-bold text-slate-800 uppercase tracking-widest mb-6">Server Credentials</h4>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">SMTP Server</label><input id="smtp-server-input" name="smtpServer" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm outline-none" value="${escapeHtml(cSettings.smtpServer || '')}" placeholder="smtp.office365.com" /></div>
                                    <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">SMTP Port</label><input id="smtp-port-input" name="smtpPort" type="number" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none" value="${cSettings.smtpPort || 587}" /></div>
                                    <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">SMTP Username</label><input id="smtp-user-input" name="smtpUser" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm outline-none" value="${escapeHtml(cSettings.smtpUser || '')}" /></div>
                                    <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">SMTP Password</label><input id="smtp-pass-input" name="smtpPass" type="password" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm outline-none" value="${escapeHtml(cSettings.smtpPass || '')}" placeholder="••••••••" /></div>
                                </div>
                                <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6 pt-6 border-t border-slate-100">
                                    <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Sender Name</label><input name="senderName" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm outline-none" value="${escapeHtml(cSettings.senderName || '')}" placeholder="Aspidus DMCC" /></div>
                                    <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Sender Email</label><input name="senderEmail" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm outline-none" value="${escapeHtml(cSettings.senderEmail || '')}" /></div>
                                    <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Security Protocol</label><select id="smtp-sec-input" name="smtpSecurity" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm outline-none font-bold"><option value="tls" ${cSettings.smtpSecurity==='tls'?'selected':''}>STARTTLS (587)</option><option value="ssl" ${cSettings.smtpSecurity==='ssl'?'selected':''}>SSL (465)</option><option value="none" ${cSettings.smtpSecurity==='none'?'selected':''}>None</option></select></div>
                                </div>
                                
                                <button type="button" id="btn-test-smtp" class="w-full bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 font-black py-3 rounded-md text-xs mt-6 transition-colors shadow-sm uppercase tracking-wider flex justify-center items-center gap-2">
                                    <span>📡</span> ${tLang('Testiraj SMTP Konekciju', 'Test SMTP Connection')}
                                </button>
                                <p id="smtp-test-result" class="text-xs font-bold text-center mt-3 hidden"></p>
                            </div>

                            <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                <h4 class="text-xs font-bold text-slate-800 uppercase tracking-widest mb-2">Message Templates</h4>
                                <p class="text-[10px] text-slate-500 font-mono mb-6">Variables: {{doc_type}}, {{doc_no}}, {{partner_name}}, {{company_name}}</p>
                                
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                                    <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Always BCC To</label><input name="defaultBcc" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm outline-none" value="${escapeHtml(cSettings.defaultBcc || '')}" placeholder="management@aspidus.com" /></div>
                                    <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Default Email Subject</label><input name="emailSubjectTpl" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-bold outline-none" value="${escapeHtml(cSettings.emailSubjectTpl || 'Official {{doc_type}} from {{company_name}}')}" /></div>
                                </div>
                                <div class="space-y-6 border-t border-slate-100 pt-6">
                                    <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Email Body Template</label><textarea name="emailBodyTpl" class="w-full bg-slate-50 border border-slate-200 rounded-md px-4 py-3 text-sm outline-none leading-relaxed" rows="5">${escapeHtml(cSettings.emailBodyTpl || 'Dear {{partner_name}},\n\nPlease find attached the official {{doc_type}} No. {{doc_no}}.\n\nBest regards,\n{{company_name}}')}</textarea></div>
                                    <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">WhatsApp Notification Template</label><textarea name="waBodyTpl" class="w-full bg-slate-50 border border-slate-200 rounded-md px-4 py-3 text-sm outline-none leading-relaxed" rows="3">${escapeHtml(cSettings.waBodyTpl || 'Hello {{partner_name}},\nWe have prepared your {{doc_type}} ({{doc_no}}). Please check your email for the PDF.')}</textarea></div>
                                </div>
                            </div>
                        </div>

                        <div id="tab-firewall" class="settings-pane hidden max-w-4xl mx-auto space-y-8">
                            <h3 class="text-xl font-black text-slate-900 pb-2 border-b border-slate-200">Security & Firewall Rules</h3>
                            
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                    <h4 class="text-xs font-bold text-slate-800 uppercase tracking-widest mb-4">Rate Limits</h4>
                                    <div class="space-y-4">
                                        <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Max Login Attempts (per 5 min)</label><input name="fwMaxLogin" type="number" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none" value="${fwData.max_login || 10}" /></div>
                                        <div><label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Max B2B Portal Requests (per min)</label><input name="fwMaxPortal" type="number" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none" value="${fwData.max_portal || 50}" /></div>
                                    </div>
                                </div>

                                <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
                                    <h4 class="text-xs font-bold text-slate-800 uppercase tracking-widest mb-4">Active System Blocks</h4>
                                    <div id="fw-blocked-list" class="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-2 max-h-48">
                                        ${renderBlockedIPs()}
                                    </div>
                                </div>
                            </div>
                            
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                    <div class="flex items-center gap-2 mb-2">
                                        <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                                        <h4 class="text-xs font-bold text-slate-800 uppercase tracking-widest">IP Whitelist (Safe)</h4>
                                    </div>
                                    <p class="text-[10px] text-slate-500 mb-4">IP addresses listed here will bypass all limits.</p>
                                    <textarea id="fw-whitelist" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none leading-relaxed" rows="5" placeholder="192.168.1.10">${(fwData.whitelist||[]).join('\n')}</textarea>
                                </div>
                                <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                    <div class="flex items-center gap-2 mb-2">
                                        <span class="w-2 h-2 rounded-full bg-red-500"></span>
                                        <h4 class="text-xs font-bold text-slate-800 uppercase tracking-widest">IP Blacklist (Banned)</h4>
                                    </div>
                                    <p class="text-[10px] text-slate-500 mb-4">IP addresses listed here are permanently blocked.</p>
                                    <textarea id="fw-blacklist" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none leading-relaxed text-red-700" rows="5" placeholder="8.8.8.8">${(fwData.blacklist||[]).join('\n')}</textarea>
                                </div>
                            </div>
                        </div>

                        <div id="tab-database" class="settings-pane hidden max-w-4xl mx-auto space-y-8">
                            <h3 class="text-xl font-black text-slate-900 pb-2 border-b border-slate-200">Data Management</h3>
                            
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div class="bg-white border border-slate-200 p-8 rounded-xl text-center shadow-sm hover:shadow-md transition-shadow">
                                    <div class="text-4xl mb-4 text-slate-700">📤</div>
                                    <h4 class="font-bold text-slate-800 text-sm uppercase tracking-widest mb-2">Export JSON (Data Only)</h4>
                                    <p class="text-[10px] text-slate-500 mb-6">Only rows from CRM tables in a JSON file.</p>
                                    <button type="button" class="bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold py-2.5 px-6 rounded-md uppercase tracking-wider transition-colors w-full" onclick="exportDatabase()">Download JSON</button>
                                </div>

                                <div class="bg-white border-2 border-emerald-400 p-8 rounded-xl text-center shadow-md hover:shadow-lg transition-shadow" style="background:linear-gradient(135deg,#f0fdf4,#dcfce7);">
                                    <div class="text-4xl mb-4 text-emerald-700">🛡️</div>
                                    <h4 class="font-bold text-emerald-900 text-sm uppercase tracking-widest mb-2">FULL Backup (Recommended)</h4>
                                    <p class="text-[10px] text-emerald-800 mb-6 leading-relaxed">Complete archive: all databases + uploaded files + encryption keys + RESTORE.md. Perfect for full disaster recovery or migration to another server.</p>
                                    <button type="button" class="bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold py-2.5 px-6 rounded-md uppercase tracking-wider transition-colors w-full" onclick="downloadFullBackup(this)">Download Full Backup (.tar.gz)</button>
                                </div>

                                <div class="bg-white border border-slate-200 p-8 rounded-xl text-center shadow-sm hover:shadow-md transition-shadow">
                                    <div class="text-4xl mb-4 text-slate-700">📥</div>
                                    <h4 class="font-bold text-slate-800 text-sm uppercase tracking-widest mb-2">Import JSON Backup</h4>
                                    <p class="text-[10px] text-slate-500 mb-6">Restore data-only from a previous JSON file.</p>
                                    <button type="button" class="bg-white border border-slate-300 text-slate-800 hover:bg-slate-50 text-xs font-bold py-2.5 px-6 rounded-md uppercase tracking-wider transition-colors w-full" onclick="document.getElementById('import-file-input').click()">Upload JSON</button>
                                </div>

                                <div class="bg-white border border-slate-200 p-8 rounded-xl text-center shadow-sm hover:shadow-md transition-shadow">
                                    <div class="text-4xl mb-4 text-emerald-600">📊</div>
                                    <h4 class="font-bold text-slate-800 text-sm uppercase tracking-widest mb-2">Mass Import Partners (CSV)</h4>
                                    <p class="text-[10px] text-slate-500 mb-6">Import client list from Excel/CSV file.</p>
                                    <button type="button" class="bg-white border border-slate-300 text-slate-800 hover:bg-slate-50 text-xs font-bold py-2.5 px-6 rounded-md uppercase tracking-wider transition-colors w-full" onclick="document.getElementById('import-csv-input').click()">Upload CSV</button>
                                </div>
                            </div>

                            <div class="bg-slate-50 border border-slate-200 rounded-xl p-6 mt-6">
                                <h4 class="font-bold text-slate-800 text-sm uppercase tracking-widest mb-3">How to restore a FULL Backup</h4>
                                <ol class="text-xs text-slate-700 space-y-2 leading-relaxed list-decimal ml-5">
                                    <li>On the target server, download the CRM sources (same git repo).</li>
                                    <li>Copy the <code class="bg-slate-200 px-1 rounded">.tar.gz</code> file to that server.</li>
                                    <li>Stop the CRM app if it is running.</li>
                                    <li>Run: <code class="bg-slate-200 px-1 rounded text-[11px]">python scripts/db_import_full.py --archive PATH.tar.gz --confirm</code></li>
                                    <li>Start the CRM app. Login with your existing credentials — the encryption key is inside the backup so all encrypted settings work.</li>
                                </ol>
                                <p class="text-[10px] text-slate-500 mt-3 italic">A copy of these instructions (RESTORE.md) is also included inside every backup archive.</p>
                            </div>
                        </div>

                        <div id="tab-integrations" class="settings-pane hidden max-w-4xl mx-auto space-y-8">
                            <h3 class="text-xl font-black text-slate-900 pb-2 border-b border-slate-200">${tLang('Eksterne Integracije', 'External Integrations')}</h3>
                            <p class="text-xs text-slate-500 leading-relaxed">${tLang(
                                'Sva podešavanja niže se skladište enkriptovano u bazu (Fernet AES-128). Ključevi API-ja se prikazuju maskirani nakon prvog snimanja — možete uneti novi ključ u istom polju kada zaželite da ga rotirate. Prazno polje ne briše postojeći ključ.',
                                'All settings below are stored encrypted in the database (Fernet AES-128). API keys appear masked after the first save — enter a new key in the same field to rotate. Empty field will not delete the existing key.'
                            )}</p>

                            <!-- 1) OTP DELIVERY -->
                            <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                <h4 class="text-sm font-black text-slate-800 uppercase tracking-widest mb-2">📧 ${tLang('Dostava OTP kodova', 'OTP Delivery')}</h4>
                                <p class="text-xs text-slate-500 mb-6 leading-relaxed">${tLang(
                                    'Umesto SMTP-a (koji na deljenom hostingu često ide u spam ili je blokiran), preporučujemo API-first providera: Resend, SendGrid ili Postmark. Prvo se pokušava izabrani provider, pa tek onda SMTP kao fallback. Magic-link šalje jedan-klik URL uz OTP.',
                                    'Instead of SMTP (which on shared hosting often lands in spam or is blocked), we recommend an API-first provider: Resend, SendGrid or Postmark. Selected provider is tried first, SMTP is used as fallback. Magic-link sends a one-click sign-in URL alongside the OTP.'
                                )}</p>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">${tLang('Provider', 'Provider')}</label>
                                        <select id="otpd-provider" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-bold outline-none">
                                            <option value="smtp">SMTP (Comms tab)</option>
                                            <option value="resend">Resend (api.resend.com)</option>
                                            <option value="sendgrid">SendGrid</option>
                                            <option value="postmark">Postmark</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">API Key <span id="otpd-key-mask" class="text-slate-400 font-mono normal-case tracking-normal"></span></label>
                                        <input id="otpd-apikey" type="password" placeholder="re_xxx / SG.xxx / Postmark token" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none">
                                    </div>
                                    <div>
                                        <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">${tLang('Ime pošiljaoca', 'From name')}</label>
                                        <input id="otpd-fromname" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm outline-none" placeholder="Aspidus">
                                    </div>
                                    <div>
                                        <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">${tLang('Adresa pošiljaoca', 'From email')}</label>
                                        <input id="otpd-fromemail" type="email" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm outline-none" placeholder="no-reply@yourdomain.com">
                                    </div>
                                    <div class="md:col-span-2 grid grid-cols-3 gap-4 items-end">
                                        <label class="flex items-center gap-2 col-span-2 p-3 bg-slate-50 rounded-md border border-slate-200 cursor-pointer">
                                            <input id="otpd-magic" type="checkbox" class="w-4 h-4 text-blue-600 rounded">
                                            <span class="text-xs font-bold text-slate-800">${tLang('Uključi Magic Link (jedan-klik prijava)', 'Enable Magic Link (one-click sign-in)')}</span>
                                        </label>
                                        <div>
                                            <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">TTL (min)</label>
                                            <input id="otpd-ttl" type="number" min="5" max="60" value="15" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none">
                                        </div>
                                    </div>
                                </div>
                                <div class="mt-4 flex flex-col md:flex-row gap-3">
                                    <button type="button" id="otpd-save" class="bg-slate-800 hover:bg-slate-900 text-white font-bold px-6 py-2 rounded-md text-xs uppercase tracking-wider transition-colors">${tLang('Snimi OTP config', 'Save OTP config')}</button>
                                    <div class="flex-1 flex gap-2">
                                        <input id="otpd-test-to" type="email" placeholder="test@yourdomain.com" class="flex-1 bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm outline-none">
                                        <button type="button" id="otpd-test" class="bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 font-bold px-4 py-2 rounded-md text-xs uppercase tracking-wider">${tLang('Test mejl', 'Send test')}</button>
                                    </div>
                                </div>
                                <p id="otpd-status" class="text-xs font-bold text-center mt-3 hidden"></p>
                            </div>

                            <!-- 2) CHAT WEBHOOKS -->
                            <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                <h4 class="text-sm font-black text-slate-800 uppercase tracking-widest mb-2">💬 ${tLang('Chat Notifikacije', 'Chat Notifications')}</h4>
                                <p class="text-xs text-slate-500 mb-6 leading-relaxed">${tLang(
                                    'Real-time obaveštenja u Slack / Teams / Telegram / ntfy / WhatsApp kada klijent prihvati ponudu, kada je KYC podnet, kada se okine sankcijski flag, kad se potpiše dokument. Svako polje je opciono — možete koristiti samo jedan kanal.',
                                    'Real-time notifications to Slack / Teams / Telegram / ntfy / WhatsApp when a client accepts an offer, submits KYC, triggers a sanctions flag, or signs a document. Each field is optional — you can use just one channel.'
                                )}</p>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Slack Webhook URL</label>
                                        <input id="cwh-slack" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none" placeholder="https://hooks.slack.com/services/…">
                                    </div>
                                    <div>
                                        <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">MS Teams Webhook URL</label>
                                        <input id="cwh-teams" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none" placeholder="https://outlook.office.com/webhook/…">
                                    </div>
                                    <div>
                                        <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Telegram Bot Token</label>
                                        <input id="cwh-tg-token" type="password" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none" placeholder="123456:AA…">
                                    </div>
                                    <div>
                                        <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Telegram Chat ID</label>
                                        <input id="cwh-tg-chat" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none" placeholder="-1001234567890">
                                    </div>
                                    <div>
                                        <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">ntfy.sh URL</label>
                                        <input id="cwh-ntfy" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none" placeholder="https://ntfy.sh/aspidus-alerts">
                                    </div>
                                    <div class="grid grid-cols-2 gap-2">
                                        <div>
                                            <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">WhatsApp Phone ID</label>
                                            <input id="cwh-wa-pid" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none">
                                        </div>
                                        <div>
                                            <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">WhatsApp To (msisdn)</label>
                                            <input id="cwh-wa-to" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none" placeholder="971501234567">
                                        </div>
                                    </div>
                                    <div class="md:col-span-2">
                                        <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">WhatsApp Cloud API Token</label>
                                        <input id="cwh-wa-token" type="password" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none">
                                    </div>
                                </div>
                                <div class="mt-4 flex gap-3">
                                    <button type="button" id="cwh-save" class="bg-slate-800 hover:bg-slate-900 text-white font-bold px-6 py-2 rounded-md text-xs uppercase tracking-wider transition-colors">${tLang('Snimi webhooks', 'Save webhooks')}</button>
                                    <button type="button" id="cwh-test" class="bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 font-bold px-4 py-2 rounded-md text-xs uppercase tracking-wider">${tLang('Test obaveštenje', 'Send test')}</button>
                                </div>
                                <p id="cwh-status" class="text-xs font-bold text-center mt-3 hidden"></p>
                            </div>

                            <!-- 3) hCAPTCHA -->
                            <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                <h4 class="text-sm font-black text-slate-800 uppercase tracking-widest mb-2">🛡️ ${tLang('hCaptcha (portal anti-bot)', 'hCaptcha (portal anti-bot)')}</h4>
                                <p class="text-xs text-slate-500 mb-6 leading-relaxed">${tLang(
                                    'Zaštita B2B portala od bot-ova. Otvorite hcaptcha.com, kreirajte site, unesite sitekey (public) i secret (private). Ako oba polja ostanu prazna, provera je isključena.',
                                    'Protects the B2B portal from bots. Open hcaptcha.com, create a site, enter the sitekey (public) and secret (private). If both fields are empty, verification is disabled.'
                                )}</p>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Site Key</label>
                                        <input id="hcap-sitekey" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none" placeholder="10000000-ffff-ffff-ffff-000000000001">
                                    </div>
                                    <div>
                                        <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Secret <span id="hcap-secret-mask" class="text-slate-400 font-mono normal-case tracking-normal"></span></label>
                                        <input id="hcap-secret" type="password" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none">
                                    </div>
                                </div>
                                <div class="mt-4">
                                    <button type="button" id="hcap-save" class="bg-slate-800 hover:bg-slate-900 text-white font-bold px-6 py-2 rounded-md text-xs uppercase tracking-wider transition-colors">${tLang('Snimi hCaptcha', 'Save hCaptcha')}</button>
                                </div>
                                <p id="hcap-status" class="text-xs font-bold text-center mt-3 hidden"></p>
                            </div>

                            <!-- 4) TRACKING APIs -->
                            <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                <h4 class="text-sm font-black text-slate-800 uppercase tracking-widest mb-2">📦 ${tLang('Praćenje pošiljki i registri', 'Shipment Tracking & Registers')}</h4>
                                <p class="text-xs text-slate-500 mb-6 leading-relaxed">${tLang(
                                    'Ključevi za praćenje kontejnera (17TRACK), brodova (MarineTraffic), letova (FlightAware) i pretragu registara pravnih lica (Companies House UK). Ako polje ostavite prazno, taj izvor podataka je nedostupan ali sistem radi normalno bez njega.',
                                    'Keys for container tracking (17TRACK), vessels (MarineTraffic), flights (FlightAware) and legal-entity register lookup (Companies House UK). Leaving a field empty makes that data source unavailable, but the app works normally without it.'
                                )}</p>
                                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">17TRACK API key <span id="mask-track17ApiKey" class="text-slate-400 font-mono normal-case tracking-normal"></span></label>
                                        <input id="key-track17ApiKey" type="password" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none">
                                    </div>
                                    <div>
                                        <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">MarineTraffic PS7 key <span id="mask-marineTrafficKey" class="text-slate-400 font-mono normal-case tracking-normal"></span></label>
                                        <input id="key-marineTrafficKey" type="password" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none">
                                    </div>
                                    <div>
                                        <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">FlightAware AeroAPI <span id="mask-flightAwareKey" class="text-slate-400 font-mono normal-case tracking-normal"></span></label>
                                        <input id="key-flightAwareKey" type="password" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none">
                                    </div>
                                    <div>
                                        <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Companies House UK <span id="mask-companiesHouseKey" class="text-slate-400 font-mono normal-case tracking-normal"></span></label>
                                        <input id="key-companiesHouseKey" type="password" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none">
                                    </div>
                                </div>
                                <div class="mt-4">
                                    <button type="button" id="tracking-save" class="bg-slate-800 hover:bg-slate-900 text-white font-bold px-6 py-2 rounded-md text-xs uppercase tracking-wider transition-colors">${tLang('Snimi tracking ključeve', 'Save tracking keys')}</button>
                                </div>
                                <p id="tracking-status" class="text-xs font-bold text-center mt-3 hidden"></p>
                            </div>

                            <!-- 5) MARKET DATA -->
                            <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                                <h4 class="text-sm font-black text-slate-800 uppercase tracking-widest mb-2">💹 ${tLang('Tržišni podaci (Alpha Vantage)', 'Market Data (Alpha Vantage)')}</h4>
                                <p class="text-xs text-slate-500 mb-6 leading-relaxed">${tLang(
                                    'Alpha Vantage nudi besplatan API ključ (25 poziva/dan) za nafta / gas / bakar / aluminijum / pšenica / kafa spot cene. Kursevi valuta idu preko exchangerate.host i ne zahtevaju ključ.',
                                    'Alpha Vantage offers a free API key (25 calls/day) for oil / gas / copper / aluminum / wheat / coffee spot prices. FX rates go through exchangerate.host and require no key.'
                                )}</p>
                                <div>
                                    <label class="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Alpha Vantage key <span id="mask-alphaVantageKey" class="text-slate-400 font-mono normal-case tracking-normal"></span></label>
                                    <input id="key-alphaVantageKey" type="password" class="w-full bg-slate-50 border border-slate-200 rounded-md px-3 py-2 text-sm font-mono outline-none">
                                </div>
                                <div class="mt-4">
                                    <button type="button" id="market-save" class="bg-slate-800 hover:bg-slate-900 text-white font-bold px-6 py-2 rounded-md text-xs uppercase tracking-wider transition-colors">${tLang('Snimi market key', 'Save market key')}</button>
                                </div>
                                <p id="market-status" class="text-xs font-bold text-center mt-3 hidden"></p>
                            </div>
                        </div>

                        <div id="tab-diagnostics" class="settings-pane hidden max-w-4xl mx-auto space-y-8">
                            <h3 class="text-xl font-black text-slate-900 pb-2 border-b border-slate-200">${tLang('Dijagnostika i Rešavanje Problema', 'Diagnostics & Troubleshooting')}</h3>
                            
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                                
                                <div class="bg-white border border-slate-200 p-6 rounded-xl shadow-sm">
                                    <div class="flex items-center gap-3 mb-4">
                                        <span class="text-2xl">🔬</span>
                                        <div>
                                            <h4 class="font-bold text-slate-800 text-sm uppercase tracking-widest">${tLang('Skeniranje Integriteta', 'Deep Integrity Scan')}</h4>
                                            <p class="text-[10px] text-slate-500">${tLang('Analizira celu bazu za prekinute veze i siročiće.', 'Analyzes entire database for broken links and orphans.')}</p>
                                        </div>
                                    </div>
                                    <button type="button" class="w-full bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 font-bold py-2.5 rounded-md text-xs transition-colors" id="btn-integrity-check">${tLang('Pokreni Skener Veza', 'Run Relation Scan')}</button>
                                </div>

                                <div class="bg-white border border-slate-200 p-6 rounded-xl shadow-sm">
                                    <div class="flex items-center gap-3 mb-4">
                                        <span class="text-2xl">💰</span>
                                        <div>
                                            <h4 class="font-bold text-slate-800 text-sm uppercase tracking-widest">${tLang('Finansijska Provera', 'Financial Health Check')}</h4>
                                            <p class="text-[10px] text-slate-500">${tLang('Traži nulte transakcije i greške u valutama.', 'Scans for zero-transactions and currency logic errors.')}</p>
                                        </div>
                                    </div>
                                    <button type="button" class="w-full bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 font-bold py-2.5 rounded-md text-xs transition-colors" id="btn-financial-check">${tLang('Pokreni Finansijski Skener', 'Run Financial Scan')}</button>
                                </div>
                                
                                <div class="bg-white border border-slate-200 p-6 rounded-xl shadow-sm">
                                    <div class="flex items-center gap-3 mb-4">
                                        <span class="text-2xl">💾</span>
                                        <div>
                                            <h4 class="font-bold text-slate-800 text-sm uppercase tracking-widest">${tLang('Status Memorije', 'Storage Status')}</h4>
                                            <p class="text-[10px] text-slate-500">${tLang('Proverava zauzeće i zdravlje lokalnog keša.', 'Checks local cache usage and health.')}</p>
                                        </div>
                                    </div>
                                    <button type="button" class="w-full bg-teal-50 border border-teal-200 text-teal-700 hover:bg-teal-100 font-bold py-2.5 rounded-md text-xs transition-colors" id="btn-storage-check">${tLang('Analiziraj Memoriju', 'Analyze Storage')}</button>
                                </div>

                                <div class="bg-white border border-slate-200 p-6 rounded-xl shadow-sm">
                                    <div class="flex items-center gap-3 mb-4">
                                        <span class="text-2xl">🔒</span>
                                        <div>
                                            <h4 class="font-bold text-slate-800 text-sm uppercase tracking-widest">${tLang('Preuzmi Audit Logove', 'Export Audit Logs')}</h4>
                                            <p class="text-[10px] text-slate-500">${tLang('Preuzima celokupan sigurnosni izveštaj sistema.', 'Downloads the entire security and access log.')}</p>
                                        </div>
                                    </div>
                                    <button type="button" class="w-full bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 font-bold py-2.5 rounded-md text-xs transition-colors" id="btn-export-audit">${tLang('Preuzmi JSON Logove', 'Download JSON Logs')}</button>
                                </div>

                                <div class="bg-white border border-slate-200 p-6 rounded-xl shadow-sm">
                                    <div class="flex items-center gap-3 mb-4">
                                        <span class="text-2xl">🧹</span>
                                        <div>
                                            <h4 class="font-bold text-slate-800 text-sm uppercase tracking-widest">${tLang('Očisti Keš Memoriju', 'Clear Cache & State')}</h4>
                                            <p class="text-[10px] text-slate-500">${tLang('Rešava probleme sa zaglavljenim interfejsom.', 'Resolves UI glitches and stuck data.')}</p>
                                        </div>
                                    </div>
                                    <button type="button" class="w-full bg-orange-50 border border-orange-200 text-orange-700 hover:bg-orange-100 font-bold py-2.5 rounded-md text-xs transition-colors" onclick="(async()=>{const ok=await window.askConfirm(tLang('Restart aplikacije','Restart app'),tLang('Da li ste sigurni? Ovo će osvežiti aplikaciju.','Are you sure? This will reload the app.'),{danger:true,confirmText:tLang('Restart','Restart')});if(ok){localStorage.clear();window.location.reload();}})()">${tLang('Očisti i Restartuj', 'Clear & Restart')}</button>
                                </div>

                                <div class="bg-white border border-slate-200 p-6 rounded-xl shadow-sm">
                                    <div class="flex items-center gap-3 mb-4">
                                        <span class="text-2xl">📋</span>
                                        <div>
                                            <h4 class="font-bold text-slate-800 text-sm uppercase tracking-widest">${tLang('Sistemski Izveštaj', 'System Report')}</h4>
                                            <p class="text-[10px] text-slate-500">${tLang('Preuzmite tehničke detalje za podršku.', 'Download technical details for support.')}</p>
                                        </div>
                                    </div>
                                    <button type="button" class="w-full bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 font-bold py-2.5 rounded-md text-xs transition-colors" id="btn-download-diag">${tLang('Preuzmi Izveštaj', 'Download Report')}</button>
                                </div>
                            </div>
                            
                            <div class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm mt-6">
                                <h4 class="text-xs font-bold text-slate-800 uppercase tracking-widest mb-4">${tLang('Napredne Opcije', 'Advanced Options')}</h4>
                                <div class="space-y-4">
                                    <label class="flex items-center gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 transition-colors">
                                        <input type="checkbox" id="toggle-debug-mode" class="w-4 h-4 text-blue-600 rounded" ${localStorage.getItem('debug_mode') === 'true' ? 'checked' : ''}>
                                        <div>
                                            <span class="block text-sm font-bold text-slate-800">${tLang('Developer Debug Mod', 'Developer Debug Mode')}</span>
                                            <span class="block text-[10px] text-slate-500">${tLang('Prikazuje napredne greške u konzoli.', 'Shows advanced errors in browser console.')}</span>
                                        </div>
                                    </label>
                                </div>
                            </div>
                        </div>

                    </div>
                    
                    <div class="p-6 border-t border-slate-200 bg-white flex justify-end gap-4 rounded-br-2xl shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-10">
                        <button type="button" class="bg-white border border-slate-300 text-slate-600 hover:bg-slate-50 font-bold px-8 py-2.5 rounded-lg text-sm transition-colors" onclick="closeModal()">${tLang('Odustani', 'Cancel')}</button>
                        <button type="submit" id="save-settings-btn" class="bg-blue-600 hover:bg-blue-700 text-white font-black px-12 py-2.5 rounded-lg text-sm shadow-md transition-transform transform hover:-translate-y-0.5 tracking-wider uppercase">${tLang('Sačuvaj Podešavanja', 'Save System Config')}</button>
                    </div>
                </form>
            </div>
        </div>`;
        
        const mBody = document.getElementById('modal-body');
        if(mBody) { mBody.classList.remove('p-6'); mBody.classList.add('p-0'); }

        openModal(`SYSTEM CONTROL CENTER`, html, null);

        const oldClose = window.closeModal;
        window.closeModal = function() {
            if(mBody) { mBody.classList.add('p-6'); mBody.classList.remove('p-0'); }
            oldClose();
            window.closeModal = oldClose; 
        };

        // ISPRAVKA: Logika za hvatanje SMTP Security protokola prilikom testiranja
        document.getElementById('btn-test-smtp')?.addEventListener('click', async () => {
            const btn = document.getElementById('btn-test-smtp');
            const resultMsg = document.getElementById('smtp-test-result');
            
            const smtpServer = document.getElementById('smtp-server-input').value.trim();
            const smtpPort = document.getElementById('smtp-port-input').value.trim();
            const smtpUser = document.getElementById('smtp-user-input').value.trim();
            const smtpPass = document.getElementById('smtp-pass-input').value.trim();
            const smtpSecurity = document.getElementById('smtp-sec-input').value.trim();
            
            if(!smtpServer || !smtpPort || !smtpUser || !smtpPass) {
                resultMsg.innerText = Utils.t('api.smtpIncomplete');
                resultMsg.className = "text-xs font-bold text-center mt-3 text-red-600";
                resultMsg.classList.remove('hidden');
                return;
            }

            btn.disabled = true;
            btn.innerHTML = `⏳ ${tLang('Povezivanje...', 'Connecting...')}`;
            resultMsg.classList.add('hidden');

            try {
                const payload = { smtpServer, smtpPort, smtpUser, smtpPass, smtpSecurity };
                const res = await fetch('/api/comms/test_smtp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                
                const data = await res.json();
                
                if(res.ok && data.status === 'success') {
                    resultMsg.innerText = Utils.t('api.smtpSuccess');
                    resultMsg.className = "text-xs font-bold text-center mt-3 text-emerald-600 bg-emerald-50 py-2 rounded border border-emerald-200";
                } else {
                    // Ovo sada preuzima specifičnu grešku koju vrati backend
                    resultMsg.innerText = Utils.t(data.error) || data.error;
                    resultMsg.className = "text-xs font-bold text-center mt-3 text-red-600 bg-red-50 py-2 rounded border border-red-200";
                }
            } catch(e) {
                resultMsg.innerText = "Network Error / Server nije dostupan.";
                resultMsg.className = "text-xs font-bold text-center mt-3 text-red-600";
            }
            
            resultMsg.classList.remove('hidden');
            btn.disabled = false;
            btn.innerHTML = `<span>📡</span> ${tLang('Testiraj SMTP Konekciju', 'Test SMTP Connection')}`;
        });

        // ==========================================================
        //  INTEGRATIONS TAB — load + wire all sub-sections
        // ==========================================================
        const _integrationsStatus = (id, ok, msg) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.textContent = msg;
            el.className = 'text-xs font-bold text-center mt-3 ' + (ok
                ? 'text-emerald-700 bg-emerald-50 py-2 rounded border border-emerald-200'
                : 'text-red-700 bg-red-50 py-2 rounded border border-red-200');
            el.classList.remove('hidden');
        };

        // 1) OTP DELIVERY — load
        (async () => {
            try {
                const r = await fetch('/api/system/otp_delivery');
                if (!r.ok) return;
                const d = await r.json();
                const prov = document.getElementById('otpd-provider'); if (prov) prov.value = d.provider || 'smtp';
                const fn = document.getElementById('otpd-fromname');  if (fn) fn.value = d.from_name || 'Aspidus';
                const fe = document.getElementById('otpd-fromemail'); if (fe) fe.value = d.from_email || '';
                const mg = document.getElementById('otpd-magic');     if (mg) mg.checked = !!d.magic_link_enabled;
                const tt = document.getElementById('otpd-ttl');       if (tt) tt.value = d.magic_link_ttl_min || 15;
                const mk = document.getElementById('otpd-key-mask');
                if (mk) mk.textContent = d.has_api_key ? `(current: ${d.api_key_masked || '•••'} — leave blank to keep)` : '';
            } catch (e) {}
        })();

        document.getElementById('otpd-save')?.addEventListener('click', async () => {
            const btn = document.getElementById('otpd-save'); btn.disabled = true;
            try {
                const payload = {
                    provider: document.getElementById('otpd-provider').value,
                    api_key: document.getElementById('otpd-apikey').value.trim(),
                    from_name: document.getElementById('otpd-fromname').value.trim(),
                    from_email: document.getElementById('otpd-fromemail').value.trim(),
                    magic_link_enabled: document.getElementById('otpd-magic').checked,
                    magic_link_ttl_min: parseInt(document.getElementById('otpd-ttl').value || 15, 10),
                };
                const r = await fetch('/api/system/otp_delivery', {
                    method: 'POST', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify(payload)
                });
                const d = await r.json();
                if (r.ok && d.status === 'success') {
                    _integrationsStatus('otpd-status', true, tLang(`✓ Snimljeno (provider: ${d.provider})`, `✓ Saved (provider: ${d.provider})`));
                    document.getElementById('otpd-apikey').value = '';
                } else {
                    _integrationsStatus('otpd-status', false, `✗ ${d.message || d.error || 'Save failed'}`);
                }
            } catch (e) {
                _integrationsStatus('otpd-status', false, `✗ ${e.message || e}`);
            } finally { btn.disabled = false; }
        });

        document.getElementById('otpd-test')?.addEventListener('click', async () => {
            const to = document.getElementById('otpd-test-to').value.trim();
            if (!to || !to.includes('@')) { _integrationsStatus('otpd-status', false, tLang('Unesite validan email.', 'Enter a valid email.')); return; }
            const btn = document.getElementById('otpd-test'); btn.disabled = true;
            try {
                const r = await fetch('/api/system/otp_delivery/test', {
                    method: 'POST', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({to})
                });
                const d = await r.json();
                _integrationsStatus('otpd-status', !!d.ok,
                    (d.ok ? tLang(`✓ Test poslat na ${to}: `, `✓ Test dispatched to ${to}: `) : '✗ ') + (d.info || ''));
            } catch (e) {
                _integrationsStatus('otpd-status', false, `✗ ${e.message || e}`);
            } finally { btn.disabled = false; }
        });

        // 2) CHAT WEBHOOKS — load
        (async () => {
            try {
                const r = await fetch('/api/system/chat_webhooks');
                if (!r.ok) return;
                const d = await r.json();
                const setV = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
                setV('cwh-slack', d.slack);
                setV('cwh-teams', d.teams);
                setV('cwh-tg-chat', d.telegram_chat_id);
                setV('cwh-ntfy', d.ntfy_url);
                setV('cwh-wa-pid', d.whatsapp_phone_id);
                setV('cwh-wa-to', d.whatsapp_to);
                // mask fields display current value as placeholder
                const tg = document.getElementById('cwh-tg-token');
                if (tg && d.telegram_bot_token) tg.placeholder = `current: ${d.telegram_bot_token} (leave blank to keep)`;
                const wa = document.getElementById('cwh-wa-token');
                if (wa && d.whatsapp_token) wa.placeholder = `current: ${d.whatsapp_token} (leave blank to keep)`;
            } catch (e) {}
        })();

        document.getElementById('cwh-save')?.addEventListener('click', async () => {
            const btn = document.getElementById('cwh-save'); btn.disabled = true;
            try {
                const payload = {
                    slack: document.getElementById('cwh-slack').value.trim(),
                    teams: document.getElementById('cwh-teams').value.trim(),
                    telegram_bot_token: document.getElementById('cwh-tg-token').value.trim(),
                    telegram_chat_id: document.getElementById('cwh-tg-chat').value.trim(),
                    ntfy_url: document.getElementById('cwh-ntfy').value.trim(),
                    whatsapp_phone_id: document.getElementById('cwh-wa-pid').value.trim(),
                    whatsapp_token: document.getElementById('cwh-wa-token').value.trim(),
                    whatsapp_to: document.getElementById('cwh-wa-to').value.trim(),
                };
                const r = await fetch('/api/system/chat_webhooks', {
                    method: 'POST', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify(payload)
                });
                const d = await r.json();
                if (r.ok && d.status === 'success') {
                    _integrationsStatus('cwh-status', true, tLang('✓ Chat webhooks snimljeni.', '✓ Chat webhooks saved.'));
                    document.getElementById('cwh-tg-token').value = '';
                    document.getElementById('cwh-wa-token').value = '';
                } else {
                    _integrationsStatus('cwh-status', false, `✗ ${d.message || d.error || 'Save failed'}`);
                }
            } catch (e) {
                _integrationsStatus('cwh-status', false, `✗ ${e.message || e}`);
            } finally { btn.disabled = false; }
        });

        document.getElementById('cwh-test')?.addEventListener('click', async () => {
            const btn = document.getElementById('cwh-test'); btn.disabled = true;
            try {
                const r = await fetch('/api/system/chat_webhooks/test', {method:'POST'});
                const d = await r.json();
                _integrationsStatus('cwh-status', r.ok, r.ok
                    ? tLang('✓ Test poslat na sve konfigurisane kanale.', '✓ Test dispatched to all configured channels.')
                    : `✗ ${d.message || d.error || 'Test failed'}`);
            } catch (e) {
                _integrationsStatus('cwh-status', false, `✗ ${e.message || e}`);
            } finally { btn.disabled = false; }
        });

        // 3) hCAPTCHA — load
        (async () => {
            try {
                const r = await fetch('/api/system/hcaptcha');
                if (!r.ok) return;
                const d = await r.json();
                const sk = document.getElementById('hcap-sitekey'); if (sk) sk.value = d.sitekey || '';
                const mk = document.getElementById('hcap-secret-mask');
                if (mk) mk.textContent = d.has_secret ? `(current: ${d.secret_masked} — leave blank to keep)` : '';
            } catch (e) {}
        })();

        document.getElementById('hcap-save')?.addEventListener('click', async () => {
            const btn = document.getElementById('hcap-save'); btn.disabled = true;
            try {
                const payload = {
                    sitekey: document.getElementById('hcap-sitekey').value.trim(),
                    secret: document.getElementById('hcap-secret').value.trim(),
                };
                const r = await fetch('/api/system/hcaptcha', {
                    method: 'POST', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify(payload)
                });
                const d = await r.json();
                if (r.ok && d.status === 'success') {
                    _integrationsStatus('hcap-status', true, d.enabled
                        ? tLang('✓ hCaptcha aktivan.', '✓ hCaptcha enabled.')
                        : tLang('✓ Snimljeno (nedostaje sitekey ili secret — provera je isključena).', '✓ Saved (sitekey or secret missing — verification disabled).'));
                    document.getElementById('hcap-secret').value = '';
                } else {
                    _integrationsStatus('hcap-status', false, `✗ ${d.message || d.error || 'Save failed'}`);
                }
            } catch (e) {
                _integrationsStatus('hcap-status', false, `✗ ${e.message || e}`);
            } finally { btn.disabled = false; }
        });

        // 4) TRACKING APIs + 5) MARKET DATA — shared loader
        (async () => {
            try {
                const r = await fetch('/api/system/service-keys');
                if (!r.ok) return;
                const d = await r.json();
                Object.keys(d).forEach(k => {
                    const m = document.getElementById(`mask-${k}`);
                    if (m) m.textContent = d[k].has_value ? `(current: ${d[k].masked} — blank to keep)` : '';
                });
            } catch (e) {}
        })();

        const _saveKeys = async (keyIds, statusEl) => {
            const payload = {};
            let hasAny = false;
            keyIds.forEach(k => {
                const el = document.getElementById(`key-${k}`);
                const v = el ? el.value.trim() : '';
                if (v) { payload[k] = v; hasAny = true; }
            });
            if (!hasAny) {
                _integrationsStatus(statusEl, false, tLang('Sva polja su prazna — ništa za snimanje.', 'All fields are empty — nothing to save.'));
                return;
            }
            try {
                const r = await fetch('/api/system/service-keys', {
                    method: 'POST', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify(payload)
                });
                const d = await r.json();
                if (r.ok && d.status === 'success') {
                    _integrationsStatus(statusEl, true, tLang(`✓ Snimljeno: ${(d.updated||[]).join(', ')}`, `✓ Saved: ${(d.updated||[]).join(', ')}`));
                    keyIds.forEach(k => { const el = document.getElementById(`key-${k}`); if (el) el.value = ''; });
                } else {
                    _integrationsStatus(statusEl, false, `✗ ${d.message || d.error || 'Save failed'}`);
                }
            } catch (e) {
                _integrationsStatus(statusEl, false, `✗ ${e.message || e}`);
            }
        };

        document.getElementById('tracking-save')?.addEventListener('click', () =>
            _saveKeys(['track17ApiKey','marineTrafficKey','flightAwareKey','companiesHouseKey'], 'tracking-status'));
        document.getElementById('market-save')?.addEventListener('click', () =>
            _saveKeys(['alphaVantageKey'], 'market-status'));

        // TAB LOGIC
        document.querySelectorAll('.settings-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('.settings-tab-btn').forEach(b => {
                    b.classList.remove('active', 'bg-slate-800', 'text-white');
                    if(!b.classList.contains('text-amber-500')) {
                        b.classList.add('text-slate-300');
                    }
                    b.querySelector('span').classList.add('opacity-70');
                });
                const target = e.currentTarget;
                target.classList.add('active', 'bg-slate-800', 'text-white');
                target.classList.remove('text-slate-300', 'text-amber-500');
                target.querySelector('span').classList.remove('opacity-70');

                document.querySelectorAll('.settings-pane').forEach(p => p.classList.add('hidden'));
                document.getElementById(target.dataset.target).classList.remove('hidden');
            });
        });
        const firstTab = document.querySelector('.settings-tab-btn');
        if(firstTab) {
            firstTab.classList.add('bg-slate-800', 'text-white');
            firstTab.classList.remove('text-slate-300');
            firstTab.querySelector('span').classList.remove('opacity-70');
        }

        // UNBLOCK LOGIC
        document.querySelectorAll('.unblock-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                const ip = e.currentTarget.dataset.ip;
                const res = await fetch('/api/firewall/unblock', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ip}) });
                if(res.ok) {
                    if (typeof UI !== 'undefined') UI.showNotification(`IP ${ip} unblocked!`);
                    e.currentTarget.parentElement.remove();
                }
            });
        });

        // BANK LIST LOGIC
        const refreshBankList = () => {
            document.getElementById('bank-accounts-list').innerHTML = renderBankAccounts();
            document.querySelectorAll('.remove-bank').forEach(b => b.addEventListener('click', e => {
                state.company.bankAccounts.splice(parseInt(e.currentTarget.dataset.idx, 10), 1);
                refreshBankList();
            }));
        };
        document.getElementById('add-bank-btn').addEventListener('click', () => {
            const bName = document.getElementById('new-bank-name').value.trim();
            const bAcc = document.getElementById('new-bank-acc').value.trim();
            if(!bName || !bAcc) { 
                if (typeof UI !== 'undefined') UI.showNotification(tLang("Naziv banke i račun su obavezni polja!", "Bank name and account are required!"), "error"); 
                return; 
            }
            state.company.bankAccounts.push({
                bankName: bName, accountNumber: bAcc, swiftCode: document.getElementById('new-bank-swift').value.trim(), currency: document.getElementById('new-bank-curr').value
            });
            document.getElementById('new-bank-name').value = ''; document.getElementById('new-bank-acc').value = ''; document.getElementById('new-bank-swift').value = '';
            refreshBankList();
        });
        refreshBankList();

        // DIAGNOSTICS LOGIC
        document.getElementById('btn-integrity-check')?.addEventListener('click', () => {
            let issues = [];
            (state.data.offers || []).forEach(o => {
                if(!state.data.products.find(p => p.id === o.productId)) {
                    issues.push(tLang(`Ponuda ${o.offerNo}: Nevezana za postojeći proizvod.`, `Offer ${o.offerNo}: Product missing.`));
                }
            });
            (state.data.deals || []).forEach(d => {
                if(!state.data.partners.find(p => p.id === d.supplierId)) issues.push(tLang(`Posao ${d.contractId}: Nedostaje dobavljač.`, `Deal ${d.contractId}: Supplier missing.`));
                if(!state.data.partners.find(p => p.id === d.buyerId)) issues.push(tLang(`Posao ${d.contractId}: Nedostaje kupac.`, `Deal ${d.contractId}: Buyer missing.`));
                if(!state.data.products.find(p => p.id === d.productId)) issues.push(tLang(`Posao ${d.contractId}: Nedostaje proizvod.`, `Deal ${d.contractId}: Product missing.`));
            });
            (state.data.transactions || []).forEach(t => {
                if(t.accountId && !state.data.accounts.find(a => a.id === t.accountId)) issues.push(tLang(`Transakcija ${t.id}: Vezana za obrisan račun.`, `Transaction ${t.id}: Linked to deleted account.`));
            });
            (state.data.recurringExpenses || []).forEach(r => {
                if(r.accountId && !state.data.accounts.find(a => a.id === r.accountId)) issues.push(tLang(`Trošak "${r.description}": Vezan za obrisan račun.`, `Expense "${r.description}": Linked to deleted account.`));
            });
            (state.data.demands || []).forEach(d => {
                if(!state.data.partners.find(p => p.id === d.buyerId)) issues.push(tLang(`Zahtev klijenta za "${d.productName}": Kupac više ne postoji.`, `Demand for "${d.productName}": Buyer missing.`));
            });

            _showAuditResults(
                tLang('Provera integriteta veza', 'Data relations integrity check'),
                issues,
                tLang('Nema prekinutih veza! Baza je savršeno konzistentna.', 'No broken links — database is perfectly consistent.'),
                tLang
            );
        });

        document.getElementById('btn-financial-check')?.addEventListener('click', () => {
            let issues = [];
            (state.data.transactions || []).forEach(t => {
                if(t.amount === 0 || t.amount < 0) issues.push(tLang(`Nulta/Negativna transakcija (ID: ${t.id})`, `Zero/Negative transaction (ID: ${t.id})`));
            });
            (state.data.deals || []).forEach(d => {
                if(!d.quantity || d.quantity <= 0) issues.push(tLang(`Posao ${d.contractId}: Nulta količina.`, `Deal ${d.contractId}: Zero quantity.`));
                if(d.sellingCurrency !== d.purchaseCurrency && (!d.exchangeRate || d.exchangeRate <= 0)) {
                    issues.push(tLang(`Posao ${d.contractId}: Različite valute, a kurs je 0.`, `Deal ${d.contractId}: Different currencies but 0 exchange rate.`));
                }
            });
            _showAuditResults(
                tLang('Finansijska provera', 'Financial audit'),
                issues,
                tLang('Matematika poslova i transakcija je potpuno ispravna.', 'Deal and transaction mathematics are fully valid.'),
                tLang
            );
        });

        document.getElementById('btn-storage-check')?.addEventListener('click', () => {
            let total = 0;
            for(let x in localStorage) {
                if(localStorage.hasOwnProperty(x)) {
                    total += ((localStorage[x].length + x.length) * 2);
                }
            }
            let kb = (total / 1024).toFixed(2);
            let mb = (total / (1024 * 1024)).toFixed(2);
            let limitKb = 5000; 
            let percentage = ((total / 1024) / limitKb * 100).toFixed(1);
            
            const critical = percentage > 80;
            const html = `
                <div class="p-4 space-y-4">
                    <div class="grid grid-cols-2 gap-3">
                        <div class="rounded-xl border border-slate-200 p-3 bg-slate-50">
                            <div class="text-[10px] uppercase font-bold text-slate-500 tracking-wide">${tLang('Zauzeto', 'Used')}</div>
                            <div class="text-2xl font-bold text-slate-900">${kb} <span class="text-sm text-slate-500">KB</span></div>
                            <div class="text-xs text-slate-500">${mb} MB</div>
                        </div>
                        <div class="rounded-xl border ${critical?'border-red-200 bg-red-50':'border-emerald-200 bg-emerald-50'} p-3">
                            <div class="text-[10px] uppercase font-bold ${critical?'text-red-700':'text-emerald-700'} tracking-wide">${tLang('Status', 'Status')}</div>
                            <div class="text-2xl font-bold ${critical?'text-red-800':'text-emerald-800'}">${percentage}%</div>
                            <div class="text-xs ${critical?'text-red-700':'text-emerald-700'}">${critical ? tLang('Kritično — očistite keš.', 'Critical — clear cache.') : tLang('Stabilno.', 'Stable.')}</div>
                        </div>
                    </div>
                    <div class="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                        <div class="h-full ${critical?'bg-red-500':'bg-emerald-500'}" style="width:${Math.min(100, percentage)}%"></div>
                    </div>
                    <p class="text-xs text-slate-500 leading-relaxed">${tLang('Prosečan browser limit je ~5 MB per domain. Preporučuje se export/backup pre nego što se ovaj procent primakne 100%.', 'Average browser limit is ~5 MB per domain. Recommended to export/backup before this approaches 100%.')}</p>
                </div>`;
            if (typeof openModal === 'function') openModal(tLang('Analiza lokalne memorije', 'Local storage analysis'), html);
            else alert(`${kb} KB used (${percentage}%)`);
        });

        document.getElementById('btn-export-audit')?.addEventListener('click', async () => {
            try {
                const res = await fetch('/api/audit_logs');
                if(!res.ok) throw new Error("Unauthorized");
                const data = await res.json();
                const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
                const a = document.createElement('a'); 
                a.href = URL.createObjectURL(blob); 
                a.download = `aspidus_audit_logs_${Date.now()}.json`; 
                a.click();
            } catch(e) {
                if (typeof showToast === 'function') showToast(tLang('Greška pri preuzimanju logova. Da li imate admin prava?', 'Error downloading logs. Do you have admin rights?'), 'error');
                else alert(tLang("Greška pri preuzimanju logova. Da li imate admin prava?", "Error downloading logs. Do you have admin rights?"));
            }
        });

        document.getElementById('btn-download-diag')?.addEventListener('click', () => {
            const diag = {
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                language: navigator.language,
                screen: `${screen.width}x${screen.height}`,
                window: `${window.innerWidth}x${window.innerHeight}`,
                localStorageKeys: Object.keys(localStorage),
                debugModeEnabled: localStorage.getItem('debug_mode') === 'true',
                appStatePreview: state ? Object.keys(state) : 'State Not Found'
            };
            const blob = new Blob([JSON.stringify(diag, null, 2)], {type: 'application/json'});
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `aspidus_diagnostics_${Date.now()}.json`;
            a.click();
        });

        document.getElementById('toggle-debug-mode')?.addEventListener('change', (e) => {
            localStorage.setItem('debug_mode', e.target.checked ? 'true' : 'false');
            if (typeof UI !== 'undefined') UI.showNotification(tLang('Debug mod ažuriran. Prijavite se ponovo za efekat.', 'Debug mode updated. Relogin for effect.'));
        });

        // MASTER SAVE LOGIC
        document.getElementById('master-settings-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const saveBtn = document.getElementById('save-settings-btn');
            const originalText = saveBtn.innerText;
            saveBtn.innerText = tLang('⏳ ČUVANJE...', '⏳ PROCESSING...');
            saveBtn.disabled = true;
            let anyFailure = null;

            try {
                // 1. Core & Company — kompletno se čuva bez granica pošto lokalni state
                //    treba da odražava sve promene čak i pre network poziva.
                state.settings.lang = fd.get('lang') || 'en';
                state.lang = state.settings.lang;
                state.settings.currency = fd.get('currency') || 'USD';
                state.settings.commissionRate = (parseFloat(fd.get('commissionRate')) || 0) / 100;
                state.settings.lastInvoiceNumber = parseInt(fd.get('lastInvoiceNumber') || 0, 10);
                state.settings.lastOfferNumber = parseInt(fd.get('lastOfferNumber') || 0, 10);
                state.settings.fileLimitMB = parseFloat(fd.get('fileLimitMB')) || FILE_LIMIT_MB;
                FILE_LIMIT_MB = state.settings.fileLimitMB;
                state.settings.vatRate = parseFloat(fd.get('vatRate')) || 5;
                state.settings.paymentWarningDays = parseInt(fd.get('paymentWarningDays') || 7, 10);
                state.settings.defaultOfferNotes = fd.get('defaultOfferNotes') || '';
                state.settings.defaultInvoiceNotes = fd.get('defaultInvoiceNotes') || '';
                state.company.name = fd.get('companyName');
                state.company.address = fd.get('companyAddress');
                state.company.taxId = fd.get('companyTax');
                state.company.regNumber = fd.get('companyReg');

                // Brand color: prihvata samo validan hex #RRGGBB.
                const bc = (fd.get('brandColorHex') || fd.get('brandColor') || '').trim();
                if (bc && /^#[0-9a-fA-F]{6}$/.test(bc)) state.company.brandColor = bc;
                const site = (fd.get('companyWebsite') || '').trim();
                if (site) state.company.website = site;

                if (typeof uploadFileToServer === 'function') {
                    const logoFile = fd.get('companyLogo');
                    if (logoFile && logoFile.size > 0) {
                        try {
                            if (state.company.logoDataUrl) await deleteFileFromServer(state.company.logoDataUrl);
                            const logoUrl = await uploadFileToServer(logoFile);
                            if (logoUrl) state.company.logoDataUrl = logoUrl;
                        } catch (err) { console.warn('logo upload failed', err); anyFailure = err; }
                    }
                    const stampFile = fd.get('companyStamp');
                    if (stampFile && stampFile.size > 0) {
                        try {
                            if (state.company.stampDataUrl) await deleteFileFromServer(state.company.stampDataUrl);
                            const stampUrl = await uploadFileToServer(stampFile);
                            if (stampUrl) state.company.stampDataUrl = stampUrl;
                        } catch (err) { console.warn('stamp upload failed', err); anyFailure = err; }
                    }
                }
                await saveToStorage('settings');
                await saveToStorage('company');

                // 2. Comms
                const commsData = {
                    smtpServer: fd.get('smtpServer'),
                    smtpPort: parseInt(fd.get('smtpPort') || 587, 10),
                    smtpUser: fd.get('smtpUser'),
                    smtpPass: fd.get('smtpPass'),
                    smtpSecurity: fd.get('smtpSecurity'),
                    senderName: fd.get('senderName'),
                    senderEmail: fd.get('senderEmail'),
                    defaultBcc: fd.get('defaultBcc'),
                    emailSubjectTpl: fd.get('emailSubjectTpl'),
                    emailBodyTpl: fd.get('emailBodyTpl'),
                    waBodyTpl: fd.get('waBodyTpl')
                };
                const commsRes = await fetch('/api/data/comms_settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ value: commsData })
                });
                if (!commsRes.ok) throw new Error('Comms save failed: HTTP ' + commsRes.status);
                if (typeof Comms !== 'undefined') Comms.settings = commsData;

                // 3. Firewall
                const wList = document.getElementById('fw-whitelist').value
                                     .split('\n').map(i => i.trim()).filter(Boolean);
                const bList = document.getElementById('fw-blacklist').value
                                     .split('\n').map(i => i.trim()).filter(Boolean);
                const fwConfig = {
                    whitelist: wList, blacklist: bList,
                    max_login: parseInt(fd.get('fwMaxLogin') || 10, 10),
                    max_portal: parseInt(fd.get('fwMaxPortal') || 50, 10)
                };
                const fwRes = await fetch('/api/firewall/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(fwConfig)
                });
                if (!fwRes.ok) throw new Error('Firewall save failed: HTTP ' + fwRes.status);

                // Success — obavesti korisnika i osveži da bi UI reflektovao nov jezik/brand.
                if (typeof showToast === 'function') {
                    showToast(tLang('Konfiguracija uspešno sačuvana.',
                                    'Configuration saved successfully.'), 'success');
                } else {
                    (typeof showToast === 'function' ? showToast : alert)(tLang('Konfiguracija uspešno sačuvana.',
                                'System Configuration Saved Successfully.'));
                }
                closeModal();
                // Reload posle kratke pauze da toast bude vidljiv i da se save
                // završi pre reset-a app state-a.
                setTimeout(() => window.location.reload(), 800);
            } catch (err) {
                console.error('Settings save failed:', err);
                if (typeof showToast === 'function') {
                    showToast(tLang('Greška pri čuvanju: ', 'Save error: ') + (err.message || err), 'error');
                } else {
                    alert(tLang('Greška pri čuvanju: ', 'Save error: ') + (err.message || err));
                }
            } finally {
                // OBAVEZNO — dugme se uvek vraća u aktivno stanje, čak i posle greške.
                // Bez ovog finally bloka, dugme je ostajalo trajno onesposobljeno i
                // korisnik nije mogao ponovo da klikne Save bez refresh-a stranice.
                saveBtn.innerText = originalText;
                saveBtn.disabled = false;
            }
        });
    }
};

document.addEventListener('DOMContentLoaded', () => setTimeout(() => SettingsManager.init(), 1000));