const PRODUCT_CATEGORIES = [ 'agriculture', 'food', 'beverages', 'inputs', 'industry', 'construction', 'energy', 'metals', 'chemicals', 'textiles', 'electronics', 'pharma', 'packaging', 'other' ];

const UNITS = ['kg - Kilogram', 'MT - Metric Ton', 'g - Gram', 'lb - Pound', 'oz - Ounce', 'pcs - Pieces', 'L - Liter', 'mL - Milliliter', 'CBM - Cubic Meter', 'sqm - Square Meter', 'm - Meter', 'plt - Pallet', 'ctr - Container', 'FCL - Full Container Load', 'box - Box', 'ctn - Carton', 'bag - Bag', 'bbl - Barrel', 'gal - Gallon'];

// ==========================================================
//  UNIT NORMALIZATION SYSTEM
// ==========================================================
// Bilo koji tekst iz UNITS liste ili "MT", "mt", "tona", "Metric Ton" itd.
// mapira se u kanonski oblik (kg / t / L / mL / pcs / box / ...).
// Sve konverzije mase se rade kroz KILOGRAM kao pivot.
const UNIT_CANONICAL = {
    // === MASA (canonical = kg) ===
    'kg': { canonical: 'kg', kind: 'mass', toKg: 1 },
    'g':  { canonical: 'g',  kind: 'mass', toKg: 0.001 },
    'mg': { canonical: 'mg', kind: 'mass', toKg: 0.000001 },
    't':  { canonical: 't',  kind: 'mass', toKg: 1000 },
    'mt': { canonical: 't',  kind: 'mass', toKg: 1000 },
    'ton':{ canonical: 't',  kind: 'mass', toKg: 1000 },
    'tona':{canonical: 't',  kind: 'mass', toKg: 1000 },
    'tonna':{canonical: 't', kind: 'mass', toKg: 1000 },
    'metric ton':{ canonical: 't', kind: 'mass', toKg: 1000 },
    'tonne':{ canonical: 't', kind: 'mass', toKg: 1000 },
    // Imperial masa (US customary + Avoirdupois)
    'lb': { canonical: 'lb', kind: 'mass', toKg: 0.45359237 },
    'lbs':{ canonical: 'lb', kind: 'mass', toKg: 0.45359237 },
    'pound':{canonical:'lb', kind: 'mass', toKg: 0.45359237 },
    'oz': { canonical: 'oz', kind: 'mass', toKg: 0.028349523125 },
    'ounce':{canonical:'oz', kind: 'mass', toKg: 0.028349523125 },
    'grain':{canonical:'gr', kind: 'mass', toKg: 0.00006479891 },
    'stone':{canonical:'st', kind: 'mass', toKg: 6.35029318 },
    'st':  { canonical: 'st',kind: 'mass', toKg: 6.35029318 },
    // Cwt = hundredweight; US short = 100 lb, UK long = 112 lb
    'cwt': { canonical: 'cwt_us', kind: 'mass', toKg: 45.359237 },       // default US short
    'cwt_us':{canonical:'cwt_us', kind: 'mass', toKg: 45.359237 },
    'cwt_uk':{canonical:'cwt_uk', kind: 'mass', toKg: 50.80234544 },
    // Short ton (US) = 2000 lb; long ton (UK) = 2240 lb
    'short_ton':{canonical:'sh_tn',kind:'mass', toKg: 907.18474 },
    'sh_tn':{canonical:'sh_tn',kind:'mass', toKg: 907.18474 },
    'long_ton': {canonical:'l_tn',kind:'mass', toKg: 1016.0469088 },
    'l_tn':{canonical:'l_tn',kind:'mass', toKg: 1016.0469088 },

    // === ZAPREMINA (canonical = L) ===
    'l':   { canonical: 'L',  kind: 'volume', toL: 1 },
    'ml':  { canonical: 'mL', kind: 'volume', toL: 0.001 },
    'hl':  { canonical: 'hL', kind: 'volume', toL: 100 },
    'cbm': { canonical: 'CBM',kind: 'volume', toL: 1000 },
    'm3':  { canonical: 'CBM',kind: 'volume', toL: 1000 },
    'gal': { canonical: 'gal_us', kind: 'volume', toL: 3.785411784 },  // default US
    'gal_us':{canonical:'gal_us', kind: 'volume', toL: 3.785411784 },
    'gal_uk':{canonical:'gal_uk', kind: 'volume', toL: 4.54609 },
    'imp_gal':{canonical:'gal_uk', kind:'volume', toL: 4.54609 },
    'qt':  { canonical: 'qt', kind: 'volume', toL: 0.946352946 },       // US quart
    'pt':  { canonical: 'pt', kind: 'volume', toL: 0.473176473 },       // US pint
    'fl_oz':{canonical:'fl_oz',kind: 'volume', toL: 0.0295735295625 },  // US fluid oz
    'floz':{canonical:'fl_oz',kind: 'volume', toL: 0.0295735295625 },
    'bbl': { canonical: 'bbl',kind: 'volume', toL: 158.987294928 },     // petroleum barrel
    'bbl_dry':{canonical:'bbl_dry',kind:'volume', toL: 115.6271236 },
    'ft3': { canonical: 'ft3',kind: 'volume', toL: 28.316846592 },
    'cft': { canonical: 'ft3',kind: 'volume', toL: 28.316846592 },
    'in3': { canonical: 'in3',kind: 'volume', toL: 0.016387064 },

    // === DISKRETNI (count) ===
    'pcs':{ canonical: 'pcs',kind: 'count' },
    'pc': { canonical: 'pcs',kind: 'count' },
    'kom':{ canonical: 'pcs',kind: 'count' },
    'box':{ canonical: 'box',kind: 'count' },
    'ctn':{ canonical: 'ctn',kind: 'count' },
    'bag':{ canonical: 'bag',kind: 'count' },
    'plt':{ canonical: 'plt',kind: 'count' },
    'plt.':{canonical: 'plt',kind: 'count' },
    'pallet':{canonical:'plt',kind:'count' },
    'paleta':{canonical:'plt',kind:'count' },
    'ctr':{ canonical: 'ctr',kind: 'count' },
    'fcl':{ canonical: 'fcl',kind: 'count' },
    'drum':{canonical: 'drum',kind:'count' },
    'roll':{canonical: 'roll',kind:'count' },

    // === POVRŠINA (canonical = sqm) ===
    'sqm':{ canonical: 'sqm',kind: 'area', toSqm: 1 },
    'm2': { canonical: 'sqm',kind: 'area', toSqm: 1 },
    'sqft':{canonical:'sqft',kind: 'area', toSqm: 0.09290304 },
    'ft2':{ canonical: 'sqft',kind: 'area', toSqm: 0.09290304 },
    'sqyd':{canonical:'sqyd',kind: 'area', toSqm: 0.83612736 },
    'sqin':{canonical:'sqin',kind: 'area', toSqm: 0.00064516 },
    'ha': { canonical: 'ha', kind: 'area', toSqm: 10000 },
    'acre':{canonical:'acre',kind: 'area', toSqm: 4046.8564224 },

    // === DUŽINA (canonical = m) ===
    'm':  { canonical: 'm',  kind: 'length', toM: 1 },
    'mm': { canonical: 'mm', kind: 'length', toM: 0.001 },
    'cm': { canonical: 'cm', kind: 'length', toM: 0.01 },
    'km': { canonical: 'km', kind: 'length', toM: 1000 },
    'in': { canonical: 'in', kind: 'length', toM: 0.0254 },
    'inch':{canonical: 'in',kind: 'length', toM: 0.0254 },
    'ft': { canonical: 'ft', kind: 'length', toM: 0.3048 },
    'foot':{canonical: 'ft',kind: 'length', toM: 0.3048 },
    'yd': { canonical: 'yd', kind: 'length', toM: 0.9144 },
    'yard':{canonical: 'yd',kind: 'length', toM: 0.9144 },
    'mile':{canonical:'mi', kind: 'length', toM: 1609.344 },
    'mi': { canonical: 'mi', kind: 'length', toM: 1609.344 },
    'nmi':{ canonical: 'nmi',kind: 'length', toM: 1852 },   // nautical mile
};

function _normalizeUnitKey(raw) {
    if (!raw && raw !== 0) return '';
    // "MT - Metric Ton" → "mt"; "40 kg" → "kg"; " Kilogram" → "kilogram"
    const s = String(raw).trim().toLowerCase();
    // Uzmi prvi token pre "-" ili razmaka koji nije broj
    const beforeDash = s.split(/[-–—]/)[0].trim();
    if (UNIT_CANONICAL[beforeDash]) return beforeDash;
    // Numeric prefix ("40 kg") → skini brojeve
    const stripped = beforeDash.replace(/^[\d.\s]+/, '').trim();
    if (UNIT_CANONICAL[stripped]) return stripped;
    // Whole string as-is
    if (UNIT_CANONICAL[s]) return s;
    return beforeDash || s;
}

if (typeof window !== 'undefined') {
    window.UNIT_CANONICAL = UNIT_CANONICAL;
    window._normalizeUnitKey = _normalizeUnitKey;
}

const CURRENCIES = ['USD', 'EUR', 'AED', 'RSD', 'GBP', 'CHF', 'BAM', 'TRY', 'CNY'];

const INCOTERMS = [
  'EXW - Ex Works', 'FCA - Free Carrier', 'CPT - Carriage Paid To', 'CIP - Carriage and Insurance Paid To',
  'DAP - Delivered at Place', 'DPU - Delivered at Place Unloaded', 'DDP - Delivered Duty Paid',
  'FAS - Free Alongside Ship', 'FOB - Free On Board', 'CFR - Cost and Freight', 'CIF - Cost, Insurance and Freight',
  'DAT - Delivered at Terminal', 'DDU - Delivered Duty Unpaid'
];

const CERTIFICATES = ['HALAL', 'HACCP', 'ISO 9001', 'ISO 14001', 'ISO 22000', 'ISO 45001', 'FSSC 22000', 'BRC', 'IFS', 'UTZ', 'Rainforest Alliance', 'RSPO', 'FDA', 'CE', 'Kosher', 'Organic', 'Fairtrade', 'GlobalGAP', 'FSC', 'GMP', 'Vegan', 'SGS Inspected', 'Bez Sertifikata'];

const GLOBAL_RATES = { 'USD': 1.0, 'EUR': 0.92, 'AED': 3.67, 'RSD': 108.5, 'GBP': 0.79, 'CHF': 0.90, 'BAM': 1.80, 'TRY': 32.0, 'CNY': 7.23 };

const COUNTRIES = ["Afghanistan","Albania","Algeria","Argentina","Armenia","Australia","Austria","Bahrain","Bangladesh","Belarus","Belgium","Bosnia and Herzegovina","Brazil","Bulgaria","Canada","Chile","China","Colombia","Croatia","Cyprus","Czechia","Denmark","Egypt","Ethiopia","Finland","France","Georgia","Germany","Ghana","Greece","Hungary","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy","Japan","Jordan","Kazakhstan","Kenya","Kuwait","Lebanon","Libya","Malaysia","Mexico","Montenegro","Morocco","Netherlands","New Zealand","Nigeria","North Macedonia","Norway","Oman","Pakistan","Peru","Philippines","Poland","Portugal","Qatar","Romania","Russia","Saudi Arabia","Senegal","Serbia","Singapore","Slovakia","Slovenia","South Africa","South Korea","Spain","Sri Lanka","Sweden","Switzerland","Syria","Taiwan","Tanzania","Thailand","Tunisia","Turkey","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States of America","Vietnam"];

const CITIES_BY_COUNTRY = {
    "United Arab Emirates": ["Dubai", "Abu Dhabi", "Sharjah", "Al Ain", "Ajman", "Ras Al Khaimah", "Fujairah"],
    "Serbia": ["Beograd", "Novi Sad", "Niš", "Kragujevac", "Subotica", "Čačak", "Zrenjanin"],
    "Bosnia and Herzegovina": ["Sarajevo", "Banja Luka", "Tuzla", "Zenica", "Mostar", "Bihać", "Brčko"],
    "Montenegro": ["Podgorica", "Nikšić", "Herceg Novi", "Pljevlja", "Bar", "Bijelo Polje", "Kotor"],
    "Croatia": ["Zagreb", "Split", "Rijeka", "Osijek", "Zadar", "Pula", "Slavonski Brod"],
    "North Macedonia": ["Skopje", "Bitola", "Kumanovo", "Prilep", "Tetovo", "Ohrid", "Veles"],
    "Slovenia": ["Ljubljana", "Maribor", "Kranj", "Celje", "Koper", "Velenje", "Novo Mesto"],
    "China": ["Shanghai", "Beijing", "Guangzhou", "Shenzhen", "Chengdu", "Chongqing", "Tianjin"],
    "United States of America": ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio"],
    "India": ["Mumbai", "Delhi", "Bangalore", "Hyderabad", "Ahmedabad", "Chennai", "Kolkata"],
    "Brazil": ["São Paulo", "Rio de Janeiro", "Brasília", "Salvador", "Fortaleza", "Belo Horizonte", "Manaus"],
    "Germany": ["Berlin", "Hamburg", "Munich", "Cologne", "Frankfurt", "Stuttgart", "Düsseldorf"],
    "Russia": ["Moscow", "Saint Petersburg", "Novosibirsk", "Yekaterinburg", "Kazan", "Nizhny Novgorod", "Chelyabinsk"],
    "Turkey": ["Istanbul", "Ankara", "Izmir", "Bursa", "Antalya", "Adana", "Konya"],
    "Italy": ["Rome", "Milan", "Naples", "Turin", "Palermo", "Genoa", "Bologna"],
    "France": ["Paris", "Marseille", "Lyon", "Toulouse", "Nice", "Nantes", "Montpellier"],
    "United Kingdom": ["London", "Birmingham", "Manchester", "Glasgow", "Liverpool", "Bristol", "Sheffield"],
    "Ghana": ["Accra", "Kumasi", "Tamale", "Sekondi-Takoradi", "Ashaiman", "Sunyani", "Cape Coast"],
    "Argentina": ["Buenos Aires", "Córdoba", "Rosario", "Mendoza", "Tucumán", "La Plata", "Mar del Plata"],
    "Armenia": ["Yerevan", "Gyumri", "Vanadzor", "Vagharshapat", "Abovyan", "Kapan", "Hrazdan"]
};

const ALL_CITIES_FLAT = Array.from(new Set(Object.values(CITIES_BY_COUNTRY).flat()));

let FILE_LIMIT_MB = 50;

const state = {
  lang: 'sr', currentView: 'deals', detailViewId: null,
  data: { partners: [], products: [], deals: [], demands: [], accounts: [], transactions: [], recurringExpenses: [], connections: [], offers: [] },
  settings: { commissionRate: 0.05, lastInvoiceNumber: 0, lang: 'sr', fileLimitMB: 50, currency: 'USD', lastOfferNumber: 0, vatRate: 5, paymentWarningDays: 7, defaultInvoiceNotes: '', defaultOfferNotes: '' },
  company: { name:'', address:'', taxId:'', regNumber:'', bankName:'', accountNumber:'', swift:'', logoDataUrl:'', stampDataUrl:'' },
  activeFilters: {}, editingItem: null, notifications: []
};

const DATA_KEYS = ['partners', 'products', 'deals', 'demands', 'accounts', 'transactions', 'recurringExpenses', 'connections', 'offers', 'settings', 'company'];
// Eksponuj top-level state/data ključeve kao window.* da bi test tooling (Playwright)
// mogao da im pristupi kroz page.evaluate. U regular browser skriptama, `const` na
// top-level nije globalna promenljiva pa `window.state` nije auto-postavljen.
if (typeof window !== 'undefined') {
    window.state = state;
    window.DATA_KEYS = DATA_KEYS;
    window.FILE_LIMIT_MB = FILE_LIMIT_MB;
    window.ALL_CITIES_FLAT = ALL_CITIES_FLAT;
    window.CITIES_BY_COUNTRY = CITIES_BY_COUNTRY;
}
