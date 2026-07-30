// static/js/modules/partners/kyc_compliance.js

window.reviewKYC = async function(partnerId) {
    const partner = state.data.partners.find(p => p.id === partnerId);
    
    if (!partner) {
        alert(Utils.t('kyc.notFound'));
        return;
    }

    Utils.openModal(
        Utils.t('kyc.loading'), 
        `<div class="p-16 text-center">
            <div class="animate-spin rounded-full h-12 w-12 border-b-4 border-blue-600 mx-auto mb-4"></div>
            <p class="text-slate-500 font-bold uppercase tracking-widest text-xs">${Utils.t('kyc.connecting')}</p>
        </div>`, 
        null
    );

    try {
        let submissions = [];
        const fetchFn = typeof fetchWithRetry === 'function' ? fetchWithRetry : fetch;
        // Povezivanje na backend rutu
        const res = await fetchFn(`/api/portal/admin/submissions/${partnerId}`);
        
        if (res.ok) {
            const jsonRes = await res.json();
            if (Array.isArray(jsonRes)) {
                submissions = jsonRes;
            }
        } else {
            console.warn("API Error:", res.status);
        }

        if (!Array.isArray(submissions) || submissions.length === 0) {
            const noDataHtml = `
            <div class="p-12 text-center bg-slate-50 rounded-xl border border-slate-200 shadow-inner">
                <span class="text-5xl block mb-4">📭</span>
                <h3 class="text-xl font-black text-slate-900 uppercase tracking-widest">${Utils.t('kyc.noSubmissions')}</h3>
                <p class="text-slate-500 font-bold mt-2 text-sm">${Utils.t('kyc.noSubmissionsDesc')}</p>
            </div>`;
            Utils.openModal(Utils.t('kyc.reviewTitle'), noDataHtml, null);
            return;
        }

        const latest = submissions[0];
        const data = latest.data || {};
        const aml = data.aml || {};
        const files = data.files || {};

        const renderFiles = (fileData, label) => {
            if (!fileData) return '';
            let fileArr = Array.isArray(fileData) ? fileData : [fileData];
            fileArr = fileArr.filter(f => f); 
            if (fileArr.length === 0) return '';
            
            return fileArr.map((url, i) => `
                <a href="${url}" target="_blank" class="inline-flex items-center gap-2 bg-white border border-slate-300 hover:bg-blue-50 hover:border-blue-300 text-slate-700 hover:text-blue-700 font-bold px-3 py-1.5 rounded-lg text-[10px] uppercase tracking-wider transition-colors shadow-sm mb-2 mr-2">
                    📄 ${label} ${fileArr.length > 1 ? (i+1) : ''}
                </a>
            `).join('');
        };

        const renderPersons = (persons) => {
            if (!persons || !Array.isArray(persons) || persons.length === 0) return `<p class="text-[10px] text-slate-400 italic">${Utils.t('kyc.notProvided')}</p>`;
            return `
            <table class="w-full text-left border-collapse mt-2">
                <thead>
                    <tr class="bg-slate-100 border-b border-slate-200">
                        <th class="p-2 text-[9px] font-black text-slate-500 uppercase tracking-widest">${Utils.t('kyc.fullName')}</th>
                        <th class="p-2 text-[9px] font-black text-slate-500 uppercase tracking-widest">${Utils.t('kyc.passport')}</th>
                        <th class="p-2 text-[9px] font-black text-slate-500 uppercase tracking-widest">${Utils.t('kyc.nationality')}</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 bg-white">
                    ${persons.map(p => `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="p-2 text-sm font-bold text-slate-800">${Utils.escapeHtml(p.name || p.dirName || p.uboName)}</td>
                        <td class="p-2 text-xs font-mono text-slate-600">${Utils.escapeHtml(p.passport || p.dirPassport || p.uboPassport)}</td>
                        <td class="p-2 text-xs font-bold text-slate-600">${Utils.escapeHtml(p.nationality || p.dirNat || p.uboNat)}</td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>`;
        };

        const renderAmlBadge = (val, trueText, falseText) => {
            if (val) return `<span class="bg-red-50 text-red-700 border border-red-200 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest shadow-sm">⚠️ ${trueText}</span>`;
            return `<span class="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest shadow-sm">✅ ${falseText}</span>`;
        };

        const currentKyc = partner.kyc || {};
        const tLangKY = (sr, en) => Utils.getLang() === 'sr' ? sr : en;
        const subDate = latest.submitted_at ? new Date(latest.submitted_at).toLocaleString(Utils.getLang() === 'sr' ? 'sr-RS' : 'en-US') : 'Unknown';

        // Prikaz trenutnog statusa i istorije prijava (kad je klijent poslao vise puta)
        const statusBadge = (() => {
            const st = currentKyc.status || latest.data?.status;
            const map = {
                'approved': { c: 'bg-emerald-100 text-emerald-800 border-emerald-300', l: tLangKY('ODOBRENO', 'APPROVED') },
                'rejected': { c: 'bg-red-100 text-red-800 border-red-300', l: tLangKY('ODBIJENO', 'REJECTED') },
                'update_requested': { c: 'bg-amber-100 text-amber-800 border-amber-300', l: tLangKY('TRAŽENA DOPUNA', 'UPDATE REQUESTED') },
                'pending': { c: 'bg-blue-100 text-blue-800 border-blue-300', l: tLangKY('NA ČEKANJU', 'PENDING') }
            };
            const s = map[st] || map['pending'];
            return `<span class="inline-block px-2.5 py-1 text-[10px] font-black uppercase tracking-widest border rounded-full shadow-sm ${s.c}">${s.l}</span>`;
        })();

        // Ako je zatražena dopuna, prikaži razlog
        const reviewNoteBlock = (currentKyc.status === 'update_requested' && currentKyc.reviewNote) ? `
            <div class="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-lg mb-5 shadow-sm">
                <p class="text-[10px] font-black text-amber-800 uppercase tracking-widest mb-1">⚠️ ${tLangKY('Zahtev za dopunu', 'Update requested')}</p>
                <p class="text-sm text-amber-900 leading-relaxed">${Utils.escapeHtml(currentKyc.reviewNote)}</p>
                ${currentKyc.reviewedAt ? `<p class="text-[10px] text-amber-700 mt-2 font-bold">${tLangKY('Traženo', 'Requested at')}: ${new Date(currentKyc.reviewedAt).toLocaleString(Utils.getLang() === 'sr' ? 'sr-RS' : 'en-US')}</p>` : ''}
            </div>` : '';

        // Istorija svih prijava (ako ih ima više)
        const historyBlock = submissions.length > 1 ? `
            <div class="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-5">
                <p class="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">📜 ${tLangKY('Istorija prijava', 'Submission history')} (${submissions.length})</p>
                <div class="space-y-1 max-h-32 overflow-y-auto">
                    ${submissions.map((s, i) => {
                        const dt = s.submitted_at ? new Date(s.submitted_at).toLocaleString(Utils.getLang() === 'sr' ? 'sr-RS' : 'en-US') : '—';
                        const st = s.data?.status || 'pending';
                        const stColor = st === 'approved' ? 'text-emerald-700' : (st === 'rejected' ? 'text-red-700' : (st === 'update_requested' ? 'text-amber-700' : 'text-slate-600'));
                        return `<p class="text-xs ${i === 0 ? 'font-black text-slate-800' : 'text-slate-500'}">${i === 0 ? '▶ ' : '  '}${dt} <span class="ml-2 ${stColor} font-bold">[${st}]</span>${i === 0 ? ' ' + tLangKY('(najnovija)', '(latest)') : ''}</p>`;
                    }).join('')}
                </div>
            </div>` : '';

        const html = `
        <div class="flex flex-col md:flex-row h-[85vh] bg-slate-50 rounded-b-2xl overflow-hidden">
            <div class="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-8 border-r border-slate-200">
                <div class="flex justify-between items-center mb-6 border-b border-slate-200 pb-5">
                    <div>
                        <div class="flex items-center gap-3 mb-1">
                            <h3 class="text-2xl font-black text-slate-900 tracking-tight">${Utils.t('kyc.dossier')}</h3>
                            ${statusBadge}
                        </div>
                        <p class="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">${Utils.escapeHtml(partner.companyName)}</p>
                    </div>
                    <div class="text-right bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                        <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">${Utils.t('kyc.submissionDate')}</p>
                        <p class="text-sm font-bold text-blue-600">${subDate}</p>
                    </div>
                </div>

                ${reviewNoteBlock}
                ${historyBlock}
                ${(() => {
                    // Sanctions screening banner — samo ako je backend zabeležio screening rezultat
                    const s = data._sanctionsScreening;
                    if (!s) return '';
                    const anyMatch = !!s.anyMatch;
                    if (!anyMatch) {
                        return `<div class="bg-emerald-50 border-l-4 border-emerald-500 p-3 rounded-r-lg mb-4 shadow-sm text-sm">
                            <strong class="text-emerald-800 font-black text-[10px] uppercase tracking-widest">✓ OpenSanctions:</strong>
                            <span class="text-emerald-900 ml-2">${tLangKY('Nema pogodaka na sankcionim listama.', 'No matches on sanctions lists.')}</span>
                            <span class="text-emerald-700 text-[10px] ml-2 font-mono">${s.ranAt ? new Date(s.ranAt).toLocaleString(Utils.getLang() === 'sr' ? 'sr-RS' : 'en-US') : ''}</span>
                        </div>`;
                    }
                    const hitCards = (s.results || []).filter(r => (r.matches || []).length > 0).map(r => `
                        <div class="mt-2 p-3 bg-white border border-red-300 rounded-lg">
                            <div class="text-xs font-black text-red-800 uppercase tracking-widest">🎯 Match on: ${Utils.escapeHtml(r.name)}</div>
                            ${r.matches.slice(0, 3).map(m => `
                                <div class="mt-2 pl-3 border-l-2 border-red-300 text-xs text-slate-800">
                                    <div><strong>${Utils.escapeHtml(m.caption || m.id)}</strong> · <span class="opacity-70">${Utils.escapeHtml(m.schema || '')}</span></div>
                                    <div class="opacity-70 mt-1">Topics: ${(m.topics || []).map(t => Utils.escapeHtml(t)).join(', ') || '—'}</div>
                                    <div class="opacity-70">Datasets: ${(m.datasets || []).slice(0,3).map(d => Utils.escapeHtml(d)).join(', ')}</div>
                                    <a href="${Utils.escapeHtml(m.opensanctions_url)}" target="_blank" class="text-blue-600 hover:underline font-bold text-[10px]">→ view on OpenSanctions</a>
                                </div>
                            `).join('')}
                        </div>
                    `).join('');
                    return `<div class="bg-red-50 border-l-4 border-red-600 p-4 rounded-r-lg mb-5 shadow-sm">
                        <div class="flex items-center gap-2 mb-2">
                            <span class="text-2xl">🚨</span>
                            <div>
                                <p class="text-[10px] font-black text-red-800 uppercase tracking-widest">${tLangKY('OpenSanctions upozorenje', 'OpenSanctions warning')}</p>
                                <p class="text-sm text-red-900 leading-tight">${tLangKY('Automatska provera je pronašla moguća poklapanja na globalnim sankcionim listama. Pregledajte pre odobrenja.', 'Automated screening found possible matches on global sanctions lists. Review before approval.')}</p>
                            </div>
                        </div>
                        ${hitCards}
                    </div>`;
                })()}

                <div class="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6">
                    <h4 class="font-black text-slate-800 uppercase text-[10px] tracking-widest mb-5 pb-3 border-b border-slate-100 flex items-center gap-2">🏢 ${Utils.t('kyc.corpData')}</h4>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-5">
                        <div class="col-span-2"><span class="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">${Utils.t('kyc.regName')}</span><strong class="text-sm text-slate-800">${Utils.escapeHtml(data.companyName)}</strong></div>
                        <div class="col-span-2"><span class="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">${Utils.t('kyc.industry')}</span><strong class="text-sm text-slate-800">${Utils.escapeHtml(data.industry || 'N/A')}</strong></div>
                        
                        <div class="col-span-2 md:col-span-1"><span class="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">${Utils.t('kyc.regNo')}</span><strong class="text-sm font-mono text-slate-800">${Utils.escapeHtml(data.regNo)}</strong></div>
                        <div class="col-span-2 md:col-span-1"><span class="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">${Utils.t('kyc.taxId')}</span><strong class="text-sm font-mono text-slate-800">${Utils.escapeHtml(data.taxId || 'N/A')}</strong></div>
                        <div class="col-span-2"><span class="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">${Utils.t('kyc.website')}</span><a href="${Utils.escapeHtml(data.website || '#')}" target="_blank" class="text-sm font-bold text-blue-600 hover:underline">${Utils.escapeHtml(data.website || 'N/A')}</a></div>

                        <div class="col-span-2 md:col-span-4"><span class="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">${Utils.t('kyc.regAddr')}</span><strong class="text-sm text-slate-800">${Utils.escapeHtml(data.regAddr)}</strong></div>
                        <div class="col-span-2 md:col-span-4"><span class="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">${Utils.t('kyc.opAddr')}</span><strong class="text-sm text-slate-800">${Utils.escapeHtml(data.opAddr || Utils.t('kyc.sameAsReg'))}</strong></div>
                    </div>
                </div>

                <div class="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6">
                    <h4 class="font-black text-slate-800 uppercase text-[10px] tracking-widest mb-5 pb-3 border-b border-slate-100 flex items-center gap-2">💰 ${Utils.t('kyc.finProfile')}</h4>
                    <div class="grid grid-cols-2 gap-5 mb-5">
                        <div><span class="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">${Utils.t('kyc.turnover')}</span><strong class="text-base text-emerald-700 font-black">${Utils.formatCurrency(data.turnover, 'USD')}</strong></div>
                        <div><span class="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">${Utils.t('kyc.sourceOfFunds')}</span><strong class="text-sm text-slate-800">${Utils.escapeHtml(data.sourceOfFunds)}</strong></div>
                    </div>
                    <div class="bg-slate-50 border border-slate-200 p-5 rounded-lg shadow-inner">
                        <span class="block text-[10px] font-black text-blue-800 uppercase tracking-widest mb-3">${Utils.t('kyc.bankingDetails')}</span>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div class="md:col-span-3"><strong class="text-sm text-slate-900 block">${Utils.escapeHtml(data.bankName)}</strong><span class="text-xs text-slate-500">${Utils.escapeHtml(data.bankAddr || '')}</span></div>
                            <div><span class="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">IBAN / ACC</span><strong class="text-sm font-mono text-slate-800">${Utils.escapeHtml(data.bankIban)}</strong></div>
                            <div><span class="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">SWIFT</span><strong class="text-sm font-mono text-slate-800">${Utils.escapeHtml(data.bankSwift)}</strong></div>
                            <div><span class="block text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">${Utils.t('kyc.corrBank')}</span><strong class="text-sm text-slate-800">${Utils.escapeHtml(data.corrBank || 'N/A')}</strong></div>
                        </div>
                    </div>
                </div>

                <div class="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6">
                    <h4 class="font-black text-slate-800 uppercase text-[10px] tracking-widest mb-5 pb-3 border-b border-slate-100 flex items-center gap-2">👥 ${Utils.t('kyc.structure')}</h4>
                    <div class="mb-5">
                        <span class="block text-[10px] font-black text-blue-700 uppercase tracking-widest mb-2 bg-blue-50 inline-block px-2 py-0.5 rounded border border-blue-100">${Utils.t('kyc.directors')}</span>
                        ${renderPersons(data.directors || [{name: data.dirName, passport: data.dirPassport, nationality: data.dirNat}])}
                    </div>
                    <div>
                        <span class="block text-[10px] font-black text-emerald-700 uppercase tracking-widest mb-2 bg-emerald-50 inline-block px-2 py-0.5 rounded border border-emerald-100">${Utils.t('kyc.ubos')}</span>
                        ${renderPersons(data.ubos || [{name: data.uboName, passport: data.uboPassport, nationality: data.uboNat}])}
                    </div>
                </div>

                <div class="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6">
                    <h4 class="font-black text-slate-800 uppercase text-[10px] tracking-widest mb-5 pb-3 border-b border-slate-100 flex items-center gap-2">🚨 AML / CFT Skrining</h4>
                    <div class="flex flex-col gap-3">
                        <div class="flex justify-between items-center p-2.5 hover:bg-slate-50 rounded-lg transition-colors border border-transparent hover:border-slate-200"><span class="text-xs font-bold text-slate-600">${Utils.t('kyc.pep')}</span> ${renderAmlBadge(aml.isPEP || data.isPEP, Utils.t('kyc.yes'), Utils.t('kyc.no'))}</div>
                        <div class="flex justify-between items-center p-2.5 hover:bg-slate-50 rounded-lg transition-colors border border-transparent hover:border-slate-200"><span class="text-xs font-bold text-slate-600">${Utils.t('kyc.sanctions')}</span> ${renderAmlBadge(aml.isSanctioned || data.isSanctioned, Utils.t('kyc.yes'), Utils.t('kyc.no'))}</div>
                        <div class="flex justify-between items-center p-2.5 hover:bg-slate-50 rounded-lg transition-colors border border-transparent hover:border-slate-200"><span class="text-xs font-bold text-slate-600">${Utils.t('kyc.litigation')}</span> ${renderAmlBadge(aml.litigation, Utils.t('kyc.yes'), Utils.t('kyc.no'))}</div>
                        <div class="flex justify-between items-center p-2.5 hover:bg-slate-50 rounded-lg transition-colors border border-transparent hover:border-slate-200"><span class="text-xs font-bold text-slate-600">${Utils.t('kyc.dualUse')}</span> ${renderAmlBadge(aml.dualUse, Utils.t('kyc.yes'), Utils.t('kyc.no'))}</div>
                    </div>
                </div>

                <div class="bg-white border border-slate-200 rounded-xl p-6 shadow-sm mb-6">
                    <h4 class="font-black text-slate-800 uppercase text-[10px] tracking-widest mb-5 pb-3 border-b border-slate-100 flex items-center gap-2">📎 ${Utils.t('kyc.attachedDocs')}</h4>
                    <div class="mb-4">
                        <span class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">${Utils.t('kyc.tradeLicenses')}</span>
                        <div class="flex flex-wrap">${renderFiles(files.licenses || files.license, 'License')}</div>
                    </div>
                    <div class="mb-4">
                        <span class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">${Utils.t('kyc.passportsDoc')}</span>
                        <div class="flex flex-wrap">${renderFiles(files.passports || files.passport, 'Passport')}</div>
                    </div>
                    <div>
                        <span class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">${Utils.t('kyc.incorpDocs')}</span>
                        <div class="flex flex-wrap">${renderFiles(files.incorporation, 'Incorp_Doc')}</div>
                    </div>
                </div>
                
                <div class="bg-blue-50 border border-blue-200 rounded-xl p-6 shadow-inner">
                    <h4 class="font-black text-blue-800 uppercase text-[10px] tracking-widest mb-3 flex items-center gap-2">✍️ ${Utils.t('kyc.declaration')}</h4>
                    <p class="text-sm font-bold text-slate-800">${Utils.escapeHtml(data.submitterName)} <span class="text-xs text-slate-500 ml-2 border-l border-slate-300 pl-2">${Utils.escapeHtml(data.submitterTitle)}</span></p>
                    <p class="text-[10px] text-blue-700 font-bold mt-2 uppercase tracking-widest">✅ ${Utils.t('kyc.consent')}</p>
                </div>
            </div>

            <form id="kyc-action-form" class="w-full md:w-80 bg-white border-t md:border-t-0 md:border-l border-slate-200 flex flex-col flex-shrink-0 z-10 shadow-[-4px_0_15px_rgba(0,0,0,0.03)]">
                <div class="p-6 border-b border-slate-200 bg-slate-50">
                    <h3 class="text-sm font-black text-slate-800 uppercase tracking-widest">${Utils.t('kyc.complianceActions')}</h3>
                    <p class="text-[10px] text-slate-500 font-bold mt-1">${Utils.t('kyc.dashboard')}</p>
                </div>
                
                <div class="flex-1 p-6 space-y-6 overflow-y-auto">
                    <div>
                        <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">${Utils.t('kyc.riskLevel')}</label>
                        <select name="riskLevel" class="w-full bg-white border border-slate-300 rounded-lg px-4 py-3 text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer shadow-sm transition-all">
                            <option value="low" ${currentKyc.riskLevel === 'low' ? 'selected' : ''}>🟢 ${Utils.t('kyc.lowRisk')}</option>
                            <option value="medium" ${currentKyc.riskLevel === 'medium' ? 'selected' : ''}>🟡 ${Utils.t('kyc.mediumRisk')}</option>
                            <option value="high" ${currentKyc.riskLevel === 'high' ? 'selected' : ''}>🔴 ${Utils.t('kyc.highRisk')}</option>
                        </select>
                    </div>

                    <div>
                        <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">${Utils.t('kyc.notesPlaceholder')}</label>
                        <textarea name="notes" rows="8" class="w-full bg-white border border-slate-300 rounded-lg px-4 py-3 text-sm font-medium text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 shadow-sm leading-relaxed transition-all" placeholder="${Utils.t('kyc.notesPlaceholder')}">${Utils.escapeHtml(currentKyc.notes || '')}</textarea>
                    </div>
                </div>

                <div class="p-5 border-t border-slate-200 bg-slate-50 flex flex-col gap-3">
                    ${(data._sanctionsScreening && data._sanctionsScreening.anyMatch) ? `
                    <div class="bg-red-100 border-2 border-red-500 rounded-lg p-3">
                        <label class="flex items-start gap-2 cursor-pointer">
                            <input type="checkbox" id="sanctions-ack-check" class="mt-1 w-5 h-5 accent-red-600">
                            <div class="text-xs text-red-900 leading-snug">
                                <strong class="block text-red-800 uppercase tracking-widest text-[10px] mb-1">🚨 ${tLangKY('Sankcije: potvrda odgovornosti', 'Sanctions: acknowledgment required')}</strong>
                                <span>${tLangKY('Ovaj partner ima poklapanja na sankcionim listama. Potvrđujem da sam pregledao pogodke gore, da preuzimam odgovornost, i da imam osnov za odobrenje.', 'This partner has sanctions list matches. I confirm I have reviewed the hits above, accept responsibility, and have grounds for approval.')}</span>
                                <textarea id="sanctions-ack-note" rows="2" class="w-full mt-2 bg-white border border-red-300 rounded px-2 py-1 text-xs" placeholder="${tLangKY('Kratko objašnjenje (obavezno)…','Short justification (required)…')}"></textarea>
                            </div>
                        </label>
                    </div>` : ''}
                    <button type="button" id="kyc-approve-btn" class="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-black py-3.5 rounded-xl shadow-md uppercase tracking-widest text-[11px] transition-transform transform hover:-translate-y-0.5" onclick="submitKycDecision('approved')" ${(data._sanctionsScreening && data._sanctionsScreening.anyMatch) ? 'disabled' : ''}>
                        ✅ ${Utils.t('kyc.approve')}
                    </button>
                    <button type="button" class="w-full bg-amber-500 hover:bg-amber-600 text-white font-black py-3.5 rounded-xl shadow-md uppercase tracking-widest text-[11px] transition-transform transform hover:-translate-y-0.5" onclick="submitKycDecision('update_requested')">
                        ⚠️ ${Utils.t('kyc.requestUpdate')}
                    </button>
                    <button type="button" class="w-full bg-red-600 hover:bg-red-700 text-white font-black py-3.5 rounded-xl shadow-md uppercase tracking-widest text-[11px] transition-transform transform hover:-translate-y-0.5" onclick="submitKycDecision('rejected')">
                        ❌ ${Utils.t('kyc.reject')}
                    </button>
                </div>
            </form>
        </div>`;

        const mBody = document.getElementById('modal-body');
        if(mBody) { mBody.classList.remove('p-6'); mBody.classList.add('p-0'); }

        Utils.openModal(Utils.t('kyc.reviewTitle'), html, null);

        const oldClose = window.closeModal;
        window.closeModal = function() {
            if(mBody) { mBody.classList.add('p-6'); mBody.classList.remove('p-0'); }
            oldClose();
            window.closeModal = oldClose;
        };

        // Sanctions acknowledgment gate — enable Approve tek kad checkbox + note popunjen
        const ackCheck = document.getElementById('sanctions-ack-check');
        const ackNote = document.getElementById('sanctions-ack-note');
        const approveBtn = document.getElementById('kyc-approve-btn');
        if (ackCheck && approveBtn) {
            const refresh = () => {
                const noteOk = ackNote && ackNote.value.trim().length >= 10;
                approveBtn.disabled = !(ackCheck.checked && noteOk);
                approveBtn.title = approveBtn.disabled
                    ? 'Check the acknowledgment box and write at least 10 chars of justification.'
                    : '';
            };
            ackCheck.addEventListener('change', refresh);
            if (ackNote) ackNote.addEventListener('input', refresh);
            refresh();
        }

        window.submitKycDecision = async function(decisionStatus) {
            const form = document.getElementById('kyc-action-form');
            const fd = new FormData(form);
            const riskLevel = fd.get('riskLevel');
            const notes = fd.get('notes');

            // Poziva pravi server endpoint koji MERGE-uje sve KYC podatke
            // (banking, directors, UBOs, AML, files) u partner profil i šalje email
            // obaveštenje klijentu (profesionalni šablon). Ranije se pozivao samo
            // saveSingleItem što lokalno menja partnera bez merge-a KYC podataka.
            const endpointMap = {
                'approved': `/api/portal/admin/submissions/approve/${latest.id}`,
                'update_requested': `/api/portal/admin/submissions/request_update/${latest.id}`,
                'rejected': `/api/portal/admin/submissions/reject/${latest.id}`
            };
            const url = endpointMap[decisionStatus];
            if (!url) { alert('Unknown action'); return; }

            const btn = document.activeElement;
            if (btn) { btn.disabled = true; btn.dataset.original = btn.innerHTML; btn.innerHTML = '⏳ ...'; }

            // Sanctions acknowledgment — kad je banner aktivan, admin je morao
            // da tikira checkbox + napiše note; server dodatno strogo tera 400 ako
            // je _sanctionsScreening.anyMatch true bez ovih vrednosti.
            const ackCheck = document.getElementById('sanctions-ack-check');
            const ackNote = document.getElementById('sanctions-ack-note');
            const sanctionsAck = ackCheck?.checked || false;
            const sanctionsAckNote = ackNote?.value || '';

            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ riskLevel, notes, sanctionsAck, sanctionsAckNote })
                });
                const data = await res.json();
                if (!res.ok) {
                    if (data.error === 'SANCTIONS_ACK_REQUIRED') {
                        alert('⚠ Sanctions acknowledgment required.\n\n' + (data.message || '') +
                              `\n\nMatches on file: ${data.matches_count || '?'}. Tick the red checkbox and write your justification before approving.`);
                        const ackBox = document.getElementById('sanctions-ack-check');
                        if (ackBox) ackBox.scrollIntoView({behavior: 'smooth', block: 'center'});
                    } else {
                        alert('Error: ' + (data.message || data.error || 'Unknown'));
                    }
                    if (btn && btn.dataset.original) { btn.disabled = false; btn.innerHTML = btn.dataset.original; }
                    return;
                }

                // Osvezi lokalno stanje (server je vec sacuvao sve u partner profil)
                if (typeof loadFromStorage === 'function') await loadFromStorage();

                const statusLabel = {
                    'approved': (Utils.getLang() === 'sr' ? 'ODOBRENO' : 'APPROVED'),
                    'rejected': (Utils.getLang() === 'sr' ? 'ODBIJENO' : 'REJECTED'),
                    'update_requested': (Utils.getLang() === 'sr' ? 'TRAŽENA DOPUNA' : 'UPDATE REQUESTED')
                }[decisionStatus];

                Utils.closeModal();
                if (typeof renderPartnersView === 'function') renderPartnersView();
                if (typeof renderPartnerDetailView === 'function' && state.currentView === 'partnerDetail') renderPartnerDetailView(partner.id);
                if (typeof checkAllNotifications === 'function') checkAllNotifications();
                alert(`${Utils.t('kyc.statusUpdated')} ${statusLabel}`);
            } catch (e) {
                console.error('Error:', e);
                alert(Utils.t('kyc.saveError'));
                if (btn && btn.dataset.original) { btn.disabled = false; btn.innerHTML = btn.dataset.original; }
            }
        };

    } catch (globalErr) {
        console.error("Error:", globalErr);
        alert(Utils.t('api.serverError'));
        Utils.closeModal();
    }
};