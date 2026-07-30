// static/js/config/shared_constants.js
// Jedno mesto istine za konstante koje se koriste I na CRM strani I na portal strani.
// Portal ne učitava constants.js (jer taj fajl deklariše `state` i vezan je za CRM),
// pa se ove liste ovde exportuju na `window` da bi portal skripte mogle da ih koriste.
// Ako je constants.js takodje ucitan (u CRM-u), on ce sam preglasati window.COUNTRIES/etc,
// ali vrednosti su namerno identicne.

(function() {
    const COUNTRIES = ["Afghanistan","Albania","Algeria","Argentina","Armenia","Australia","Austria","Bahrain","Bangladesh","Belarus","Belgium","Bosnia and Herzegovina","Brazil","Bulgaria","Canada","Chile","China","Colombia","Croatia","Cyprus","Czechia","Denmark","Egypt","Ethiopia","Finland","France","Georgia","Germany","Ghana","Greece","Hungary","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy","Japan","Jordan","Kazakhstan","Kenya","Kuwait","Lebanon","Libya","Malaysia","Mexico","Montenegro","Morocco","Netherlands","New Zealand","Nigeria","North Macedonia","Norway","Oman","Pakistan","Peru","Philippines","Poland","Portugal","Qatar","Romania","Russia","Saudi Arabia","Senegal","Serbia","Singapore","Slovakia","Slovenia","South Africa","South Korea","Spain","Sri Lanka","Sweden","Switzerland","Syria","Taiwan","Tanzania","Thailand","Tunisia","Turkey","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States of America","Vietnam"];

    const CURRENCIES = ['USD', 'EUR', 'AED', 'RSD', 'GBP', 'CHF', 'BAM', 'TRY', 'CNY'];

    const CURRENCIES_WITH_LABEL = {
        'USD': 'USD — US Dollar',
        'EUR': 'EUR — Euro',
        'AED': 'AED — UAE Dirham',
        'RSD': 'RSD — Serbian Dinar',
        'GBP': 'GBP — British Pound',
        'CHF': 'CHF — Swiss Franc',
        'BAM': 'BAM — Bosnian Convertible Mark',
        'TRY': 'TRY — Turkish Lira',
        'CNY': 'CNY — Chinese Yuan'
    };

    const INCOTERMS = [
        'EXW - Ex Works', 'FCA - Free Carrier', 'CPT - Carriage Paid To', 'CIP - Carriage and Insurance Paid To',
        'DAP - Delivered at Place', 'DPU - Delivered at Place Unloaded', 'DDP - Delivered Duty Paid',
        'FAS - Free Alongside Ship', 'FOB - Free On Board', 'CFR - Cost and Freight', 'CIF - Cost, Insurance and Freight',
        'DAT - Delivered at Terminal', 'DDU - Delivered Duty Unpaid'
    ];

    const UNITS = ['kg - Kilogram', 'MT - Metric Ton', 'g - Gram', 'lb - Pound', 'oz - Ounce', 'pcs - Pieces', 'L - Liter', 'mL - Milliliter', 'CBM - Cubic Meter', 'sqm - Square Meter', 'm - Meter', 'plt - Pallet', 'ctr - Container', 'FCL - Full Container Load', 'box - Box', 'ctn - Carton', 'bag - Bag', 'bbl - Barrel', 'gal - Gallon'];

    const CERTIFICATES = ['HALAL', 'HACCP', 'ISO 9001', 'ISO 14001', 'ISO 22000', 'ISO 45001', 'FSSC 22000', 'BRC', 'IFS', 'UTZ', 'Rainforest Alliance', 'RSPO', 'FDA', 'CE', 'Kosher', 'Organic', 'Fairtrade', 'GlobalGAP', 'FSC', 'GMP', 'Vegan', 'SGS Inspected', 'Bez Sertifikata'];

    const PAYMENT_TERMS = [
        {value: 'TT_100_advance', label: '100% T/T in advance'},
        {value: 'TT_50_50', label: '50% advance / 50% before shipment'},
        {value: 'TT_30_70', label: '30% advance / 70% against B/L copy'},
        {value: 'TT_30_days', label: 'T/T 30 days after B/L'},
        {value: 'TT_60_days', label: 'T/T 60 days after B/L'},
        {value: 'LC_sight', label: 'L/C at sight (Irrevocable, Confirmed)'},
        {value: 'LC_30_days', label: 'L/C 30 days after B/L'},
        {value: 'LC_60_days', label: 'L/C 60 days after B/L'},
        {value: 'LC_90_days', label: 'L/C 90 days after B/L'},
        {value: 'CAD', label: 'Cash Against Documents (D/P)'},
        {value: 'DA', label: 'Documents Against Acceptance (D/A)'},
        {value: 'Escrow', label: 'Escrow / Trade Assurance'},
        {value: 'OpenAccount', label: 'Open Account (existing relationship)'}
    ];

    if (typeof window !== 'undefined') {
        // NE preglasavaj ako je constants.js vec postavio ove vrednosti (CRM slucaj).
        if (!window.COUNTRIES) window.COUNTRIES = COUNTRIES;
        if (!window.CURRENCIES) window.CURRENCIES = CURRENCIES;
        if (!window.INCOTERMS) window.INCOTERMS = INCOTERMS;
        if (!window.UNITS) window.UNITS = UNITS;
        if (!window.CERTIFICATES) window.CERTIFICATES = CERTIFICATES;
        // Ovi su novi — nisu u CRM constants.js pa se uvek postavljaju.
        window.CURRENCIES_WITH_LABEL = CURRENCIES_WITH_LABEL;
        window.PAYMENT_TERMS = PAYMENT_TERMS;

        // Bootstrap: kada se DOM učita, popuni sve <select data-populate="X"> iz tih lista.
        // Time se izbegava duplikat <option> tagova rasutih po HTML-u.
        function populateSelects() {
            document.querySelectorAll('select[data-populate]').forEach(sel => {
                const src = sel.getAttribute('data-populate');
                let list = null;
                if (src === 'countries') list = COUNTRIES.map(c => ({value: c, label: c}));
                else if (src === 'currencies') list = CURRENCIES.map(c => ({value: c, label: CURRENCIES_WITH_LABEL[c] || c}));
                else if (src === 'incoterms') list = INCOTERMS.map(i => ({value: i.split(' ')[0], label: i}));
                else if (src === 'units') list = UNITS.map(u => ({value: u, label: u}));
                else if (src === 'certificates') list = CERTIFICATES.map(c => ({value: c, label: c}));
                else if (src === 'payment_terms') list = PAYMENT_TERMS;
                if (!list) return;
                const current = sel.value;
                const placeholder = sel.getAttribute('data-placeholder');
                let html = '';
                if (placeholder) html += `<option value="">${placeholder}</option>`;
                list.forEach(opt => {
                    html += `<option value="${opt.value}">${opt.label}</option>`;
                });
                sel.innerHTML = html;
                if (current) sel.value = current;
            });
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', populateSelects);
        } else {
            populateSelects();
        }
        window.populateSharedSelects = populateSelects;
    }
})();
