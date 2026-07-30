// static/js/modules/integrations/communications.js
const Comms = {
    settings: {},

    init: async function() {
        try {
            const res = await fetch('/api/data/comms_settings');
            if(res.ok) {
                const data = await res.json();
                this.settings = data.value || {};
            }
        } catch(e) { console.error('Comms init err'); }
    },

    showSendModal: function(base64Pdf, filename, dataObj) {
        const tLang = (srStr, enStr) => Utils.getLang() === 'sr' ? srStr : enStr;
        const s = this.settings;
        
        const docTypeStr = dataObj.type === 'offer' ? tLang('Ponuda', 'Offer') : (dataObj.type === 'proforma' ? tLang('Profaktura', 'Proforma') : tLang('Faktura', 'Invoice'));
        const partnerName = dataObj.customer ? dataObj.customer.companyName : 'Valued Client';
        const compName = (state.company && state.company.name) ? state.company.name : 'Aspidus';

        const parseTpl = (tpl) => {
            if(!tpl) return '';
            return tpl.replace(/{{doc_type}}/g, docTypeStr)
                      .replace(/{{doc_no}}/g, dataObj.documentNo)
                      .replace(/{{partner_name}}/g, partnerName)
                      .replace(/{{company_name}}/g, compName);
        };

        const subject = parseTpl(s.emailSubjectTpl || 'Document {{doc_no}} from {{company_name}}');
        const body = parseTpl(s.emailBodyTpl || 'Dear {{partner_name}},\nPlease find attached your document.\n\nBest regards,\n{{company_name}}');
        const waBody = parseTpl(s.waBodyTpl || 'Hello {{partner_name}}, your document ({{doc_no}}) is ready.');

        const contactEmail = dataObj.customer?.contact?.email || '';
        const contactPhone = (dataObj.customer?.contact?.whatsapp || dataObj.customer?.contact?.phone || '').replace(/[^0-9]/g, '');

        const html = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="bg-blue-50 dark:bg-blue-900/10 p-5 rounded-xl border border-blue-200 shadow-sm">
                <h4 class="font-black text-blue-800 dark:text-blue-300 uppercase tracking-wider mb-4 flex items-center gap-2">📧 ${tLang('Pošalji Email-om', 'Send via Email')}</h4>
                <div class="space-y-3">
                    <div><label class="block text-xs font-bold text-blue-600 uppercase mb-1">${tLang('Primalac (To)', 'Recipient (To)')}</label><input id="send-email-to" class="form-input bg-white" value="${Utils.escapeHtml(contactEmail)}" /></div>
                    <div><label class="block text-xs font-bold text-blue-600 uppercase mb-1">${tLang('Naslov (Subject)', 'Subject')}</label><input id="send-email-sub" class="form-input bg-white font-bold" value="${Utils.escapeHtml(subject)}" /></div>
                    <div><label class="block text-xs font-bold text-blue-600 uppercase mb-1">${tLang('Poruka (Body)', 'Message')}</label><textarea id="send-email-body" class="form-input bg-white text-sm leading-relaxed" rows="5">${Utils.escapeHtml(body)}</textarea></div>
                    <div class="flex items-center gap-2 text-sm font-bold text-gray-600 bg-[var(--card)] p-2 rounded border border-[var(--border)]">📎 <span>${Utils.escapeHtml(filename)}</span> <span class="text-xs font-normal text-[var(--muted)]">(Attached)</span></div>
                    <button id="exec-send-email" class="btn bg-blue-600 hover:bg-blue-700 text-white w-full py-3 shadow-md font-black transition-transform transform hover:-translate-y-0.5">📤 ${tLang('Pošalji Email', 'Send Email')}</button>
                </div>
            </div>

            <div class="bg-green-50 dark:bg-green-900/10 p-5 rounded-xl border border-green-200 shadow-sm">
                <h4 class="font-black text-green-800 dark:text-green-300 uppercase tracking-wider mb-4 flex items-center gap-2">💬 ${tLang('Pošalji WhatsApp-om', 'Send via WhatsApp')}</h4>
                <div class="space-y-3">
                    <div><label class="block text-xs font-bold text-green-600 uppercase mb-1">${tLang('Broj telefona (Samo cifre)', 'Phone Number (Digits only)')}</label><input id="send-wa-to" class="form-input bg-white font-mono" value="${Utils.escapeHtml(contactPhone)}" placeholder="971501234567" /></div>
                    <div><label class="block text-xs font-bold text-green-600 uppercase mb-1">${tLang('Poruka', 'Message')}</label><textarea id="send-wa-body" class="form-input bg-white text-sm leading-relaxed" rows="5">${Utils.escapeHtml(waBody)}</textarea></div>
                    <p class="text-xs text-[var(--muted)] italic mt-2">${tLang('* WhatsApp ne podržava direktno slanje PDF-a iz pretraživača. Poruka služi kao obaveštenje da provere email.', '* WhatsApp API prevents auto-attaching PDFs from browsers. This serves as a notification to check their email.')}</p>
                    <button id="exec-send-wa" class="btn bg-green-600 hover:bg-green-700 text-white w-full py-3 shadow-md font-black mt-4 transition-transform transform hover:-translate-y-0.5">💬 ${tLang('Otvori WhatsApp', 'Open WhatsApp')}</button>
                </div>
            </div>
        </div>`;

        Utils.openModal(tLang('📬 Distribucija Dokumenta', '📬 Send Document'), html, null);

        document.getElementById('exec-send-email').addEventListener('click', async () => {
            const btn = document.getElementById('exec-send-email');
            const to = document.getElementById('send-email-to').value.trim();
            if (!to) { if (typeof showToast === 'function') showToast('Please enter an email address.', 'error'); else alert('Please enter an email address.'); return; }
            
            btn.innerHTML = '⏳ Slanje...'; btn.disabled = true;

            try {
                const res = await fetch('/api/comms/send_email', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        to: to,
                        subject: document.getElementById('send-email-sub').value,
                        body: document.getElementById('send-email-body').value,
                        attachment_b64: base64Pdf,
                        filename: filename
                    })
                });
                const data = await res.json();
                if(res.ok && data.status === 'success') {
                    alert(tLang('Email je uspešno poslat!', 'Email sent successfully!'));
                    Utils.closeModal();
                } else {
                    alert(tLang('Greška pri slanju: ', 'Error sending: ') + (data.error || 'Unknown error'));
                }
            } catch(e) { alert('Server error'); }
            
            btn.innerHTML = `📤 ${tLang('Pošalji Email', 'Send Email')}`; btn.disabled = false;
        });

        document.getElementById('exec-send-wa').addEventListener('click', () => {
            const phone = document.getElementById('send-wa-to').value.trim();
            const text = encodeURIComponent(document.getElementById('send-wa-body').value);
            if(!phone) return alert('Unesite broj telefona!');
            window.open(`https://wa.me/${phone}?text=${text}`, '_blank');
            Utils.closeModal();
        });
    }
};

document.addEventListener('DOMContentLoaded', () => setTimeout(() => Comms.init(), 1000));