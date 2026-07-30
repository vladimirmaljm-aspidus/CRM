const translations = {
  sr: {
    user_exists: 'Korisničko ime već postoji u bazi. Izaberite drugo.',
    missing_username: 'Korisničko ime je obavezno.',
    missing_password: 'Lozinka je obavezna za novog korisnika.',
    cannot_delete_self: 'Sistem bezbednosti: Ne možete obrisati sopstveni nalog dok ste ulogovani.',
    
    nav: { dashboard: 'Kontrolna Tabla', deals: 'Poslovi (Kanban)', network: 'Mreža Kontakata', finances: 'Finansije', product_search: 'Pretraga Robe', offers: 'Ponude', partners:'Partneri', products:'Proizvodi', demands:'Potražnja', cashflow: 'Tok Novca' },
    audit: {
        title: '🛡️ Bezbednosni Dnevnik (Audit Log)',
        desc: 'Kompletan, neizbrisiv trag svih dešavanja na serveru. Prati svaku prijavu, izmenu, klik i IP adresu.',
        time: 'Datum i Vreme', user: 'Korisnik', action: 'Akcija', module: 'Modul', details: 'Detalji Zapisa', ip: 'IP / Lokacija', device: 'Pregledač / Uređaj',
        suspicious: '🚨 BEZBEDNOSNI RIZIK', noLogs: 'Trenutno nema zapisa u dnevniku.', refresh: '🔄 Osveži', search: 'Pretraži logove...',
        filterUser: 'Svi korisnici', analyticsBtn: '📊 Analiza Rada', analyticsTitle: 'Analiza Produktivnosti Radnika',
        totalTime: 'Ukupno provedeno u sistemu:', totalActions: 'Broj akcija (Klikova/Izmena):',
        hours: 'sati', minutes: 'minuta', seconds: 'sekundi', openMap: '📍 Otvori Mapu', loadError: 'Greška pri učitavanju dnevnika.',
        loginSuccess: 'Uspešna prijava na sistem.', logoutSuccess: 'Uspešna odjava. Trajanje sesije:'
    },
    log_actions: { LOGIN: 'Prijava', LOGOUT: 'Odjava', CREATE: 'Kreiranje', EDIT: 'Izmena', DELETE: 'Brisanje', DOWNLOAD: 'Preuzimanje', SCREENSHOT: 'Snimak Ekrana', SECURITY: 'Bezbednost' },
    modules: { system: 'Sistem', audit: 'Dnevnik', users: 'Zaposleni', files: 'Fajlovi', database: 'Baza Podataka', partners: 'Partneri', products: 'Proizvodi', deals: 'Poslovi', demands: 'Potražnja', accounts: 'Računi', transactions: 'Transakcije', recurringExpenses: 'Ponavljajući Troškovi', connections: 'Povezanosti', offers: 'Ponude' },
    loader: {
        default: 'Učitavanje…', loadingData: 'Učitavanje radnog prostora…', refreshing: 'Osvežavanje…',
        refreshed: 'Podaci osveženi.', saving: 'Snimanje…', deleting: 'Brisanje…',
        working: 'Radim…', authenticating: 'Provera prijave…'
    },
    documents: {
        navLabel: 'Dokumenti', title: 'Upravljanje Dokumentima',
        desc: 'Pregled, brisanje i preuzimanje svih fajlova uploadovanih kroz CRM i portal, sortirano po klijentu.'
    },
    logistics: {
        plan: 'Ruta',
        plannerTitle: 'Multimodalni logistički planer — mapa svih ruta i procena vremena',
        title: 'Logistički planer',
        subtitle: 'Kopno · More · Vazduh — automatska ruta',
        origin: 'Polazište',
        destination: 'Odredište',
        cargo: 'Teret (t)',
        priority: 'Prioritet',
        fastest: 'Najbrži', cheapest: 'Najjeftiniji', greenest: 'Najzeleniji',
        compute: 'Izračunaj rute',
    },
    offers: {
        declineReason: 'Razlog odbijanja od strane klijenta',
        acceptNote: 'Napomena klijenta uz prihvatanje',
        markSeen: 'Obeleži kao pregledano',
        newResponse: 'NOVO'
    },
    portalPreview: {
        navLabel: 'Portal Pregled', title: 'Portal Pregled i Kontrola Pristupa',
        desc: 'Vidite šta svaki klijent tačno vidi u portalu, i podesite mu vidljivost tabova i proizvoda u katalogu.',
        selectClient: 'Izaberi klijenta', pickHint: 'Izaberite klijenta levo za pregled i uređivanje.',
        previewingFor: 'Prikaz za',
        tabAccess: 'Pristup tabovima', tabAccessDesc: 'Isključite tab koji ne želite da klijent vidi.',
        catalogAccess: 'Vidljivost kataloga', catalogAccessDesc: 'Izaberite proizvode koje klijent vidi u katalogu. Prazna lista = klijent ne vidi ništa u katalogu.',
        noPartners: 'Nema partnera.', noProducts: 'Nema proizvoda.'
    },
    portalActivity: {
        navLabel: 'Portal Aktivnost', title: 'Aktivnost Klijenata Portala',
        desc: 'Prati prijave, KYC podneske, upload-e i preuzimanja klijenata sa lokacijama.',
        client: 'Klijent', location: 'Lokacija',
        allClients: 'Svi klijenti', allActions: 'Sve akcije',
        last7: 'Poslednjih 7 dana', last30: 'Poslednjih 30 dana', last90: 'Poslednjih 90 dana', last365: 'Poslednjih 12 meseci', allTime: 'Sve vreme',
        searchPh: 'Pretraži firmu, IP, detalj...',
        loading: 'Učitavanje portal aktivnosti…', empty: 'Nema podataka za date filtere.',
        loadError: 'Greška pri učitavanju portal aktivnosti.',
        stats30d: 'Analitika Klijenata (30 dana)', noStats: 'Nema portal aktivnosti u poslednjih 30 dana.',
        kpiLogins: 'Prijave klijenata', kpiKyc: 'KYC podnesci', kpiDocs: 'Pregleda/preuzimanja dokumenata', kpiOffers: 'Odgovori na ponude'
    },
    finances: {
        title: 'Finansijski Pregled', totalRevenue: 'Ukupni Primici', totalExpenses: 'Ukupni Troškovi', netProfit: 'Neto Profit', commission: 'Očekivana Provizija',
        receivables: 'Potraživanja (Nije naplaćeno)', payables: 'Obaveze (Nije plaćeno)', buyer: 'Kupac', supplier: 'Dobavljač', amount: 'Iznos', dueDate: 'Rok', deal: 'Posao',
        filterBy: 'Filtriraj po periodu', today: 'Danas', thisWeek: 'Ova nedelja', thisMonth: 'Ovaj mesec', thisYear: 'Ova godina', customRange: 'Izaberi period',
        cashFlow: 'Tok Novca (Plaćeni Poslovi)', topDeals: 'Top 5 Najprofitabilnijih Poslova', topPartners: 'Top 5 Partnera (po prometu)',
        noData: 'Nema podataka.', paymentStatus: 'Status Plaćanja', paidOn: 'Plaćeno datuma', convertedTotal: 'Ukupno (u glavnoj valuti):', every: 'Svakog', dayInMonthWith: 'u mesecu sa:'
    },
    cashflow: {
        title: 'Tok Novca', manageAccounts: 'Upravljaj Računima', addExpense: 'Dodaj Trošak', addIncome: 'Dodaj Prihod', addTransfer: 'Novi Transfer', exportCSV: 'Izvezi u CSV',
        accountState: 'Stanje na Računima', account: 'Račun', balance: 'Stanje', noAccounts: 'Nema kreiranih računa. Kreirajte prvi račun da biste počeli.',
        recentTransactions: 'Nedavne Transakcije', filter: 'Filter', allAccounts: 'Svi računi', allCategories: 'Sve kategorije', date: 'Datum', description: 'Opis', category: 'Kategorija', income: 'Prihod', expense: 'Trošak',
        addAccount: 'Dodaj Račun', editAccount: 'Uredi Račun', accountName: 'Naziv računa', initialBalance: 'Početno stanje',
        addTransaction: 'Dodaj Transakciju', editTransaction: 'Uredi Transakciju', type: 'Tip', expense_type: 'Trošak', income_type: 'Prihod', transfer_type: 'Transfer',
        reasonPlaceholder: 'npr. Plaćanje zakupa', amount: 'Iznos', currency: 'Valuta', paymentMethod: 'Način plaćanja', card: 'Kartica', bank_transfer: 'Bankarski transfer', cash: 'Keš',
        sourceOfFunds: 'Izvor sredstava', sourcePlaceholder: 'npr. Uplata osnivača', noTransactions: 'Nema transakcija za prikazani period.', invoiceNumber: 'Broj fakture / dokumenta', fromAccount: 'Sa računa', toAccount: 'Na račun',
        incomeCategories: ['Prihod od prodaje', 'Uplata osnivača', 'Pozajmica', 'Refundacija', 'Ostalo'], expenseCategories: ['Zakup', 'Kancelarijski materijal', 'Marketing', 'Plate i doprinosi', 'Transport', 'Komunalije', 'Bankarske naknade', 'Reprezentacija', 'IT usluge', 'Oprema', 'Ostalo'],
        bankFee: 'Bankarska provizija (opciono)', recurringExpenses: 'Ponavljajući Troškovi', dayOfMonth: 'Dan u mesecu', addRecurring: 'Dodaj ponavljajući trošak', editRecurring: 'Uredi Ponavljajući Trošak',
        accPlaceholder: "Npr. Glavni Račun / Kasa", recPlaceholder: "Npr. Zakup magacina", txDate: "Datum Dešavanja", txTime: "Vreme Dešavanja", txStatus: "Status",
        txCompleted: "Završeno", txPending: "Na čekanju", txReference: "Broj reference / Izvoda", txRefPlaceholder: "Npr. IZV-245", txPurpose: "Svrha Transfera",
        txBankFee: "Provizija banke (Fee)", txFeeDesc: "Banka: Provizija za", txDetailTitle: "Detalji Transakcije", txNewIncome: "Novi Priliv", txNewExpense: "Novi Trošak", txNewTransfer: "Novi Transfer", txCreated: "Kreirano u bazi:", txModified: "Poslednja izmena:", autoGenerated: "Auto-Generisano", amountDeducted: "Iznos koji se skida", amountTarget: "Iznos koji leže na ciljni račun (Konverzija)", every: 'Svakog'
    },
    invoice: {
        title: 'Faktura', type_proforma: 'PROFORMA INVOICE / PREDRAČUN', type_invoice: 'COMMERCIAL INVOICE / FAKTURA', generate: 'Generiši Fakturu/Profakturu', print: 'Štampaj', from: 'Od:', to: 'Za:', invoice_no: 'Broj dokumenta', date_of_issue: 'Datum izdavanja',
        description: 'Opis', hs_code: 'HS Kod', incoterm: 'Incoterm', quantity: 'Količina', unit_price: 'Jedinična cena', total: 'Ukupno', subtotal: 'Međuzbir', vat_5: 'PDV (5%)', grand_total: 'Ukupno za plaćanje',
        vat_options: 'PDV Opcije', doc_type_options: 'Tip Dokumenta', no_vat: 'Bez PDV-a', vat_inclusive: 'PDV uračunat u cenu', vat_exclusive: 'PDV se dodaje na cenu',
        bank_details: 'Bankovne Instrukcije (Bank Details)', bank: 'Banka', account_no: 'IBAN / Broj računa', swift: 'SWIFT/BIC', thank_you: 'Hvala na poslovanju!',
        additional_services: 'Dodatne usluge (Transport, Pakovanje...)', service_name: 'Naziv usluge', service_price: 'Cena usluge', pol: 'Luka Ukrcaja (POL)', pod: 'Luka Iskrcaja (POD)', paymentTerms: 'Uslovi Plaćanja', packaging: 'Pakovanje (Packaging)', bankDetailsEdit: 'Bankovne Instrukcije (Editujte slobodno)', page: 'Strana', of: 'od', generatedBy: 'Dokument generisan iz Aspidus CRM-a', leadTime: 'Vreme Isporuke (Lead Time):', remarks: 'Napomene i Uslovi:', acceptedBy: 'Prihvaćeno od strane kupca\n(Potpis i Pečat)'
    },
    offer: {
        title: 'Ponuda', generate: 'Kreiraj Ponudu', print: 'Štampaj Ponudu', offer_no: 'Ponuda br.', offer_date: 'Datum ponude', valid_until: 'Važi do (Validity)', product_specs: 'Specifikacija Proizvoda', origin: 'Poreklo', price_terms: 'Cena i Uslovi Plaćanja', your_price: 'Ponuđena cena (po jed.)', prepared_by: 'Ponudu pripremio/la', notes: 'Dodatne napomene', default_note: 'Ova ponuda je informativnog karaktera i ne predstavlja obavezu dok se ne potvrdi Proforma fakturom.', customer: 'Klijent / Kupac', select_customer: 'Molimo izaberite kupca iz padajućeg menija.', additional_services: 'Dodatne usluge i troškovi', service_name: 'Naziv usluge', service_price: 'Cena usluge', specificNotes: 'Specifične beleške / Notes (Vidljivo kupcu u PDF-u)', saveOfferBtn: 'Sačuvaj Ponudu', firmOffer: 'ČVRSTA KORPORATIVNA PONUDA', packaging: 'Pakovanje (Packaging)', pol: 'Luka Ukrcaja (POL)', pod: 'Luka Iskrcaja (POD)', leadTime: 'Vreme isporuke (Lead Time)', paymentTerms: 'Plaćanje (Payment Terms)', createDeal: 'Kreiraj dil', createDealForce: 'Kreiraj dil (bez portala)'
    },
    deals: {
        purchaseValue: 'Nabavna Vrednost', saleValue: 'Prodajna Vrednost', expenses: 'Dodatni Troškovi', commissions: 'Provizije', netProfit: 'Neto Profit', paymentDue: 'Rok Plaćanja',
        targetProfit: 'Ciljani Profit (%)', calculatePrice: 'Izračunaj Cenu', associateCommissions: 'Provizije Saradnika', addAssociate: 'Dodaj Saradnika', commissionType: 'Tip provizije', commissionValue: 'Vrednost', percentOfProfit: '% od profita', fixedPerTon: 'Fiksno po toni', fixedPerKg: 'Fiksno po kg', createDeal: 'Kreiraj Posao', createOffer: 'Kreiraj Ponudu',
        status_negotiation: 'U pregovorima', status_signed: 'Ugovor potpisan', status_payment: 'Plaćanje u toku', status_completed: 'Završeno', exchangeRate: 'Kurs (Exchange Rate)', purchaseSupplier: 'NABAVKA (Dobavljač)', saleBuyer: 'PRODAJA (Kupac)', exchangeRateFetch: 'Preuzmi današnji online kurs', calcSellingPriceBtn: 'Izračunaj Prodajnu Cenu', expectedProfit: 'Očekivani Neto Profit:', logisticsAndPayments: 'Logistika i Plaćanja', accountForSupplier: 'Sa kog računa je plaćeno dobavljaču?', accountForBuyer: 'Na koji račun je primljena uplata?', confirmCascadeDelete: "Da li ste sigurni da želite da trajno obrišete posao {0}?\n\nPAŽNJA: Ovo će automatski ukloniti i sve vezane finansijske transakcije iz modula 'Cashflow', kao i fizičke fajlove vezane za ovaj posao!", buyerPaidPrefix: "✓ K:", supplierPaidPrefix: "✓ D:", buyerUnpaidPrefix: "! K:", supplierUnpaidPrefix: "! D:", paymentSupplierTitle: "Plaćanje Dobavljaču", paymentBuyerTitle: "Potvrda uplate"
    },
    product_search: { title: 'Napredna Pretraga Robe', search: 'Pretraži', productName: 'Naziv proizvoda', category: 'Kategorija', countryOrigin: 'Zemlja porekla', supplier: 'Dobavljač', certificates: 'Sertifikati', incoterm: 'Incoterm', priceRange: 'Raspon cena', from: 'od', to: 'do', noResults: 'Nema rezultata.', typeName: 'Kucaj ime...' },
    network: { title: 'Mreža Kontakata', new_connection: 'Nova Spona u Mreži', source_company: 'Izvorna Firma / Lice', relation_type: 'Vrsta Povezanosti', target_company: 'Ciljna Firma / Lice', notes: 'Dodatne beleške', error_self: 'Ne možete povezati firmu samu sa sobom.', info_text: 'Pratite ko je preporučio određene partnere. Kliknite na ime partnera da vidite njegove detalje.', no_data: 'Nema unetih poveznica.' },
    add: { partner: 'Dodaj partnera / osobu', deal: 'Kreiraj posao', product: 'Dodaj proizvod', demand: 'Dodaj potražnju', connection: 'Dodaj Poveznicu' },
    actions: { edit:'Uredi', delete:'Obriši', save:'Sačuvaj', cancel:'Otkaži', details: 'Detalji', backToList: 'Nazad na listu', invoice: 'Faktura/Profaktura', select_buyer: 'Izaberi kupca', select_product: 'Izaberi proizvod', select_supplier: 'Izaberi dobavljača', select_associate: 'Izaberi saradnika', add_cost: 'Dodaj trošak', add_new_offer: 'Dodaj novu ponudu', list_view: 'Tabelarni Prikaz', kanban_view: 'Kanban Prikaz', open: 'Otvori', openEdit: 'Otvori / Uredi', confirm: 'Potvrdi', addService: 'Dodaj uslugu', history: 'Istorija', saveChanges: 'Sačuvaj izmene', copy: 'Kopiraj', exportCsv: '📊 Export CSV', select: 'Izaberi', view: 'Pregledaj' },
    fields: {
        companyName:'Naziv firme', fullName: 'Ime i Prezime', taxId:'PIB / ID', regNumber:'Matični broj', street:'Ulica i broj', city:'Grad', zip:'Poštanski broj', country:'Država', contactPerson:'Kontakt osoba', contactEmail:'Email', phone:'Telefon', bankName:'Naziv banke', accountNumber:'Broj računa', swift:'SWIFT', notes:'Beleške', tags: 'Oznake / Tagovi', types:'Tipovi partnera', quantity:'Količina', unit:'Jedinica mere', hsCode: 'HS Kod', description: 'Kratak opis proizvoda', detailedSpec: 'Detaljna specifikacija', certificates: 'Sertifikati', incoterm: 'Incoterm', demandFor: 'Potražnja za', existingProduct: 'Postojeći proizvod iz baze', newProduct: 'Potpuno novi proizvod', newProductName: 'Naziv novog proizvoda', actions: 'Akcije', currency: 'Valuta', date: 'Datum',
        stockQuantity: 'Nabavljeno / Na stanju', soldQuantity: 'Rezervisano / Prodato', availableQuantity: 'Slobodno za prodaju', dealId: 'ID ugovora / Referenca', buyer: 'Kupac', supplier: 'Dobavljač (Izvor)', product: 'Proizvod', purchasePrice: 'Kupovna cena (po jed.)', sellingPrice: 'Prodajna cena (po jed.)', price: 'Cena', purchasePricePlaceholder: 'Cena kupovine', sellingPricePlaceholder: 'Cena prodaje', targetProfitPlaceholder: 'Ciljani profit %', purchaseCurrency: 'Valuta plaćanja', sellingCurrency: 'Valuta naplate',
        costs: 'Dodatni operativni troškovi', costType: 'Vrsta troška', costAmount: 'Iznos troška', bankCosts: 'Bankarski troškovi transfera', dealStartDate: 'Datum početka posla', deliveryDate: 'Datum isporuke / realizacije', deliveryLocation: 'Mesto isporuke', paymentAccount: 'Naš račun (Za uplatu kupca)', supplierBankDetails: 'Bankovni račun dobavljača', paymentDueDateBuyer: 'Rok uplate kupca nama', paymentDueDateSupplier: 'Rok naše uplate dobavljaču', status: 'Status posla', productName: 'Naziv proizvoda', category: 'Kategorija', targetProfit: 'Ciljani Profit (%)', supplier_offers: 'Ponude dobavljača',
        company: 'Firma', person: 'Fizičko lice (Predstavnik)', linkedCompany: 'Povezana kompanija', noLink: '-- Samostalno / Nema poveznice --', linkedCompanyEntity: 'Povezana kompanija (Entitet koji predstavlja)', representatives: 'Predstavnici / Povezana lica', leadSource: 'Izvor / Preporuka', currencySetup: 'Podešavanje Valuta i Cene', origin: 'Poreklo:', countryOfOrigin: 'Zemlja Porekla', modified: 'Izmenjeno:', oldPrice: 'Stara cena:', condition: 'Uslov:', basicData: 'Osnovni Podaci', addressInfo: 'Adresa', contactInfo: 'Kontakt', bankInfo: 'Banka', activitiesAndDeals: 'Aktivnosti i Dogovori',
        stockNegative: '⚠️ U MINUSU:', soldOut: 'RASPRODATO', statusLabel: 'Status Partnera', active: 'AKTIVAN', inactive: 'NEAKTIVAN', blacklisted: '🚨 Blacklisted (Zabranjen)', ratingLabel: 'Interni Rejting (Pouzdanost)', ratingNone: 'Nepoznato / Bez ocene', noRating: 'Bez ocene', rating1: '⭐ Loše (Rizik)', rating2: '⭐⭐ Ispod proseka', rating3: '⭐⭐⭐ Prosek', rating4: '⭐⭐⭐⭐ Vrlo dobar', rating5: '⭐⭐⭐⭐⭐ Odličan (Pouzdan)', whatsapp: 'WhatsApp / WeChat', website: 'Web stranica', statusRating: 'Status i Rejting', premiumClient: 'PREMIUM Klijent'
    },
    settings: {
        lang: 'Jezik', baseCurrency: 'Glavna valuta (Prikaz sume)', lastInvoiceNum: 'Poslednji broj fakture', lastOfferNum: 'Poslednji broj ponude', commRate: 'Stopa provizije (%)', maxFileLimit: 'Maks veličina fajla (MB)', companyInfo: 'Informacije o firmi', companyName: 'Ime firme', address: 'Adresa', taxId: 'PIB', regNum: 'Matični broj', bankName: 'Naziv banke', accountNum: 'Broj računa', swift: 'SWIFT', logo: 'Logo (PNG/JPG)', saving: 'Čuvanje...', vatRate: 'Podrazumevani PDV (%)', paymentWarningDays: 'Dani za podsetnik naplate', defaultInvoiceNotes: 'Default tekst za Fakture', defaultOfferNotes: 'Default tekst za Ponude', stamp: 'Pečat i Potpis (PNG/JPG)', settingsTitle: 'Podešavanja'
    },
    kyc: {
        loading: 'Učitavanje KYC Podataka...', connecting: 'Povezivanje sa B2B Trezorom...', notFound: 'Partner nije pronađen.', moduleNotLoaded: 'KYC modul nije učitan.', noSubmissions: 'Nema KYC Prijava', noSubmissionsDesc: 'Ovaj klijent još uvek nije popunio KYC formu preko B2B Portala.', reviewTitle: 'Compliance & KYC Revizija', fullName: 'Ime i Prezime', passport: 'Pasoš', nationality: 'Nacionalnost', notProvided: 'Nije navedeno', dossier: 'KYC Dosije', submissionDate: 'Datum prijave', corpData: 'Korporativni Podaci', regName: 'Zvanično Ime', industry: 'Industrija', regNo: 'Reg. Broj', taxId: 'PIB / Tax ID', website: 'Veb sajt', regAddr: 'Zvanična Adresa', opAddr: 'Operativna Adresa', sameAsReg: 'Isto kao zvanična', finProfile: 'Finansijski Profil', turnover: 'Očekivani Promet', sourceOfFunds: 'Izvor Sredstava', bankingDetails: 'Bankovni Podaci', corrBank: 'Korespondentska banka', structure: 'Struktura i Vlasništvo', directors: 'Direktori / Menadžeri', ubos: 'Stvarni Vlasnici (UBO)', pep: 'Politički izložena lica (PEP)?', sanctions: 'Međunarodne sankcije (UN/OFAC)?', litigation: 'Pravni sporovi (AML/CFT)?', dualUse: 'Trgovina oružjem / Dual-Use?', yes: 'DA', no: 'NE', attachedDocs: 'Priložena Dokumentacija', tradeLicenses: 'Licence / Registracije', passportsDoc: 'Pasoši (Direktori & UBO)', incorpDocs: 'Statut / Rešenje o osnivanju', declaration: 'Izjava i Potpis', consent: 'Saglasnost za obradu podataka prikupljena.', complianceActions: 'Akcije & Odluka', dashboard: 'Kontrolna tabla oficira', riskLevel: 'Nivo Rizika (Risk Assessment)', lowRisk: 'Nizak Rizik (Low)', mediumRisk: 'Srednji Rizik (Medium)', highRisk: 'Visok Rizik (High)', notesPlaceholder: 'Razlozi za odobrenje/odbijanje, sumnjivi detalji...', approve: 'ODOBRI PARTNERA', requestUpdate: 'ZATRAŽI DOPUNU', reject: 'ODBIJ (REJECT)', statusUpdated: 'KYC status promenjen u:', saveError: 'Greška pri čuvanju statusa.', pending: 'KYC: Na čekanju', approved: 'KYC: Odobreno', updateReq: 'KYC: Zahtevan Update', blocked: 'KYC: Blokirano'
    },
    categories: { agriculture: 'Poljoprivreda i hrana', food: 'Prehrambeni proizvodi', beverages: 'Pića', inputs: 'Poljoprivredni inputi', industry: 'Industrija i sirovine', construction: 'Građevinski materijal', energy: 'Energentni', metals: 'Metali', chemicals: 'Hemikalije', textiles: 'Tekstil', electronics: 'Elektronika', pharma: 'Farmacija', packaging: 'Ambalaža', other: 'Ostalo' },
    legal: { confidentiality_title: 'STROGO POVERLJIVO / STRICTLY CONFIDENTIAL', confidentiality_text: 'Ovaj dokument je striktno poverljiv i namenjen isključivo licu ili kompaniji na koju je naslovljen. Svako neovlašćeno kopiranje, menjanje, prosleđivanje trećim licima ili zloupotreba informacija iz ovog dokumenta podleže zakonskim sankcijama i rezultiraće momentalnim blokiranjem klijenta ili partnera za svaku buduću saradnju.' },
    notifications: { title:'Obaveštenja', noNotifications:'Nema obaveštenja', paymentDue:'Rok plaćanja uskoro', oldPartner:'Nema unosa kod partnera', oldDemand:'Stara potražnja', productAvailable: 'Traženi proizvod je sada dostupan', reminder: 'Podsetnik' },
    placeholders: { pack: 'Npr. 25kg PP Woven Bags', pol: 'Npr. Jebel Ali, UAE', pod: 'Npr. Any Safe Port', lead: 'Npr. 15-20 days after confirmation', pay: 'Npr. 100% LC at Sight ili Net 30', qty: 'Unesi količinu...', newProduct: 'Upiši tačan naziv tražene robe...', activityType: 'Npr. Telefonski poziv, Sastanak...', activityDetails: 'Detalji...', relationType: 'Npr. Preporuka, Osnivač, Podizvođač...', networkNotes: 'Dodatne informacije...', username: 'Npr. marko.radnik', password: 'Unesi tajnu lozinku', searchName: 'Kucaj ime...' },
    tooltips: { pack: 'Odaberite iz liste ili upišite specifično pakovanje robe.', pol: 'Luka iz koje se roba šalje (Port of Loading).', pod: 'Luka u koju roba stiže (Port of Discharge).', lead: 'Očekivano vreme isporuke nakon uplate.', pay: 'Koji su uslovi plaćanja odobreni kupcu?' },
    users: {
        manage: 'Upravljanje Zaposlenima', addWorker: '+ Dodaj Radnika', workerRole: '👷 Radnik (Ograničeno)', adminRole: '👑 Glavni Administrator (Apsolutno sve)', settingsPerms: '⚙️ Podešavanja i Dozvole', delWorker: '✕ Obriši', delWorkerConfirm: 'UPOZORENJE:\nDa li ste sigurni da želite trajno obrisati ovog radnika iz CRM sistema? Radnik više neće moći da se prijavi.', editWorker: 'Izmena Podataka o Radniku', newWorker: 'Registracija Novog Radnika', accessDenied: '⛔ Pristup Odbijen', accessDeniedDelDeal: '⛔ Pristup Odbijen: Nemate pravo brisanja poslova.', accessDeniedDelProd: '⛔ Pristup Odbijen: Nemate pravo brisanja proizvoda.', accessDeniedDelFin: '⛔ Pristup Odbijen: Nemate pravo brisanja finansija.', accessDeniedDelPart: '⛔ Pristup Odbijen: Nemate pravo brisanja partnera.', accessDeniedMsg: 'Vaš nalog nema dodeljene privilegije za pregled ove sekcije. Obratite se administratoru.', accessDeniedEdit: '⛔ Pristup Odbijen: Nemate privilegije da unosite ili menjate podatke u ovom modulu.', adminOnlyMsg: 'Samo Administrator može upravljati zaposlenima.',
        usernameLabelFull: 'Korisničko ime (Username)', passwordLabelFull: 'Lozinka (Password)', accessLevel: 'Nivo Pristupa (Uloga u firmi)', saveWorker: '💾 Sačuvaj Radnika', permsMatrix: '🛡️ Matrica Preciznih Dozvola', permsDesc: 'Za svakog radnika ponaosob štiklirajte šta mu je dozvoljeno da radi u sistemu. Ako radnik nema dozvolu za prikaz, taj deo menija mu se neće ni prikazati.', pwLeaveBlank: '(Ostavi prazno da ne menjaš)', newPassword: 'Nova Lozinka',
        permViewAll: '👁 Vidi SVE Podatke u modulu', permViewOwn: '👤 Vidi SAMO SVOJE Podatke (I one koji su mu dodeljeni)', permEdit: '✍️ Unos i Izmena', permDelete: '🗑 Brisanje Podataka', permViewCosts: '💰 Vidi Nabavne Cene, Profit i Dobavljače', permViewPrices: '🏭 Vidi Cene Dobavljača', accessShareBtn: '🔑 Pristup', accessManageTitle: 'Upravljanje Pristupom', accessManageDesc: 'Označi koji radnici smeju da vide i uređuju ovog klijenta. (Administrator uvek vidi sve)'
    },
    api: { dbLoadError: 'Greška pri učitavanju iz baze:', bulkSaveError: 'Greška pri bulk čuvanju u bazi:', singleSaveError: 'Greška pri snimanju pojedinačne stavke:', deleteError: 'Greška pri brisanju stavke:', fileDeleteError: 'Greška pri fizičkom brisanju fajla na serveru:', unauthorized: 'Neautorizovan pristup', usersLoadError: 'Greška pri učitavanju radnika:', userSaveError: 'Greška pri čuvanju radnika:', userDeleteError: 'Greška pri brisanju radnika:', cannotDeleteSelf: 'Ne možete obrisati sami sebe iz sistema.', fileTooLarge: 'Fajl je prevelik i server ga je iz bezbednosnih razloga odbio!', invalidFileType: 'Ovaj tip fajla nije dozvoljen zbog bezbednosti.', fileNotFound: 'Traženi fajl ne postoji na serveru.', serverError: 'Sistemska greška na serveru.', offline: 'Nema internet konekcije. Prikazani su sačuvani (keširani) podaci.', rateLimited: 'Previše zahteva u kratkom periodu. Sačekajte trenutak.', smtpIncomplete: 'Nepotpuna SMTP podešavanja. Popunite sva obavezna polja.', smtpSuccess: 'SMTP konekcija je uspešno testirana!', smtpNotConfigured: 'SMTP podešavanja nisu konfigurisana. Podesite ih u Podešavanjima Firme.', smtpAuthError: 'Autentifikacija na SMTP serveru nije uspela. Proverite korisničko ime i lozinku.', smtpTimeoutError: 'Vreme za povezivanje sa SMTP serverom je isteklo. Proverite podešavanja i mrežnu konekciju.', smtpConnectError: 'Povezivanje sa SMTP serverom nije uspelo. Proverite host i port.' },
    misc: { 
        confirmDeleteTitle: 'Potvrda brisanja',
        partnerNotFound: 'Partner nije pronađen', geoRequired: 'Sistem bezbednosti: Morate dozvoliti lokaciju u pregledaču da biste pristupili CRM-u!', geoNotSupported: 'Geolokacija nije podržana', authenticating: 'Autentifikacija...', appDesc: 'Napredna platforma za upravljanje klijentima, poslovima i finansijama u međunarodnoj trgovini.', confirmDelete:'Da li ste sigurni da želite da obrišete ovu stavku? Akcija je nepovratna.', importSuccess:'Podaci su uspešno učitani i spojeni sa postojećim.', importError:'Uvoz nije uspeo. Proverite fajl.', invalidCsv: 'Neispravan CSV format. Proverite strukturu fajla.', saved:'Sačuvano.', partnerDetails: 'Detalji Partnera', downloadTemplate: 'Preuzmi šablon (CSV)', importPartners: 'Uvezi partnere (CSV)', partnersImported: 'Partneri uspešno uvezeni.', addActivity: 'Dodaj Aktivnost / Zabelešku', addLink: 'Dodaj Eksterni Link / Folder', add_physical_file: 'Dodaj Fizički Fajl', importProducts: 'Uvezi Proizvode (CSV)', importOffers: 'Uvezi Ponude (CSV)', downloadProductTemplate: 'Šablon: Proizvodi', downloadOfferTemplate: 'Šablon: Ponude', selectSupplierForOffers: 'Izaberi Dobavljača za Ponude iz CSV-a', offersImported: 'Ponude uspešno uvezene.', productsImported: 'Proizvodi uspešno uvezeni.', loginError: 'Pogrešni podaci. Pokušajte ponovo.', savedOffersTitle: 'Sačuvane Ponude Kupcima', offerNoTable: 'Broj Ponude', offerDateTable: 'Datum', offerCustomerTable: 'Kupac', offerProductTable: 'Proizvod', offerValueTable: 'Vrednost', offerActionsTable: 'Akcije', openPrintAction: 'Otvori / Štampaj', noOffersStored: 'Nemate sačuvanih ponuda. Ponudu kreirate iz sekcije \'Proizvodi\'.', creatingPdfStatus: '⏳ Kreiram PDF...', selectCustomerAlert: 'Izaberite kupca pre čuvanja!', offerSavedAlert: 'Ponuda uspešno sačuvana u bazi!', newTag: 'Novo', historyLabel: 'Istorija', docLinksTitle: 'Dokumenti / Linkovi', linkFolderLabel: 'Link / Fascikla', fileLabel: 'Fajl', loadingStatus: 'Otpremanje...', fileLimitError: 'Fajl prelazi maksimalnu dozvoljenu veličinu!', nameLabel: 'Naziv', pathLabel: 'Link ili Putanja', basicDataLabel: 'Osnovni Podaci', addressLabel: 'Adresa', contactLabel: 'Kontakt', bankLabel: 'Banka', activitiesLabel: 'Aktivnosti i Dogovori', allTypesLabel: 'Svi Tipovi', textFieldPlaceholder: '...', apiRateError: 'Greška pri preuzimanju API kursa.', appVersion: 'v22.0 Enterprise', companySettingsLabel: 'Podešavanja Firme', accountLabel: 'Nalog', importLabel: 'Uvezi', exportLabel: 'Izvezi', logoutLabel: 'Odjavi se', welcomeBack: 'Dobrodošli nazad', loginInstruction: 'Prijavite se za pristup sistemu', usernameLabel: 'Korisničko ime', passwordLabel: 'Lozinka', loginBtn: 'Pristupi Sistemu', loginErrorMsg: 'Pogrešni podaci. Pokušajte ponovo.', rejectPartnerDelete: '❌ ODBIJENO: Nije moguće obrisati ovog partnera jer postoje registrovani Poslovi ili Ponude vezane za njega.', rejectProductDelete: '❌ ODBIJENO: Nije moguće obrisati ovaj proizvod jer se već nalazi u aktivnim Poslovima ili kreiranim Ponudama.', rejectAccountDelete: '❌ ODBIJENO: Na ovom računu postoji istorija transakcija (Cashflow).', enterNewProductName: 'Upozorenje: Molimo unesite tačan naziv novog proizvoda.', selectExistingProduct: 'Upozorenje: Molimo izaberite postojeći proizvod iz baze.', sessionExpired: 'Vaša sesija je istekla zbog neaktivnosti. Molimo prijavite se ponovo.', myProfile: 'Moj Profil / Lozinka', copied: 'Kopirano!', exportNoData: 'Nema podataka za export.', searchNameTax: 'Pretraga (Ime / PIB)', call: 'Pozovi', maps: 'Mape', noTags: 'Nema tagova', expired: 'ISTEKLO:', expiringSoon: 'ISTIČE USKORO:', docRenewal: 'Obnova Dokumentacije', highRiskAlert: 'Visok nivo rizika. Moguće bankarske blokade.', socialMedia: 'Društvene Mreže', systemMetrics: 'Sistemska Metrika', sysStatus: 'Sistemski Status', dateAdded: 'Datum Dodavanja', notRecorded: 'Nije zabeleženo', automationNote: 'Automatizacija', automationDesc: 'Sistem povezuje dokumentaciju sa ovim entitetom isključivo koristeći PIB bazu:', portalLinkGen: 'Vaš bezbedni link je generisan', portalLinkDesc: 'Ovaj link omogućava klijentu da pristupi B2B portalu uz OTP verifikaciju.', b2bLinkBtn: 'B2B Portal Link', portalRevoke: 'Opozovi Pristup Portalu', portalReactivate: 'Aktiviraj Pristup Portalu', portalRevokeConfirm: 'Da li ste sigurni da želite da OPOZOVETE pristup ovog partnera B2B portalu? Sve aktivne sesije će odmah prestati da rade.', portalReactivateConfirm: 'Da li želite ponovo da aktivirate pristup ovog partnera B2B portalu?'
    },
    session: {
        title: 'Sesija ističe',
        logoutIn: 'Odjavljujemo te za',
        stayLoggedIn: 'Ostavi me ulogovanog',
        logout: 'Odjavi se',
        warning: 'Zbog neaktivnosti, tvoja sesija ističe uskoro.'
    }
  },
  en: {
    user_exists: 'Username already exists. Please choose another one.',
    missing_username: 'Username is required.',
    missing_password: 'Password is required for a new user.',
    cannot_delete_self: 'Security System: You cannot delete your own account while logged in.',
    
    nav: { dashboard: 'Dashboard', deals: 'Deals (Kanban)', network: 'Network Connections', finances: 'Finances', product_search: 'Product Search', offers: 'Offers', partners:'Partners', products:'Products', demands:'Demands', cashflow: 'Cash Flow' },
    audit: {
        title: 'System Audit Log',
        desc: 'Complete, immutable track of all server events. Monitors every login, modification, and IP address.',
        time: 'Date & Time', user: 'User', action: 'Action', module: 'Module', details: 'Record Details', ip: 'IP / Location', device: 'Browser / Device',
        suspicious: '🚨 SECURITY RISK', noLogs: 'No records found in the audit log.', refresh: '🔄 Refresh', search: 'Search logs...',
        filterUser: 'All users', analyticsBtn: '📊 Worker Analytics', analyticsTitle: 'Worker Productivity Analytics',
        totalTime: 'Total Time Logged In:', totalActions: 'Total Actions Performed:',
        hours: 'hours', minutes: 'minutes', seconds: 'seconds', openMap: '📍 Open Map', loadError: 'Error loading audit log.',
        loginSuccess: 'System login successful.', logoutSuccess: 'Logout successful. Session duration:'
    },
    log_actions: { LOGIN: 'Login', LOGOUT: 'Logout', CREATE: 'Create', EDIT: 'Modify', DELETE: 'Delete', DOWNLOAD: 'Download', SCREENSHOT: 'Screenshot', SECURITY: 'Security' },
    modules: { system: 'System', audit: 'Audit', users: 'Employees', files: 'Files', database: 'Database', partners: 'Partners', products: 'Products', deals: 'Deals', demands: 'Demands', accounts: 'Accounts', transactions: 'Transactions', recurringExpenses: 'Recurring Expenses', connections: 'Connections', offers: 'Offers' },
    loader: {
        default: 'Loading…', loadingData: 'Loading your workspace…', refreshing: 'Refreshing…',
        refreshed: 'Data refreshed.', saving: 'Saving…', deleting: 'Deleting…',
        working: 'Working…', authenticating: 'Authenticating…'
    },
    documents: {
        navLabel: 'Documents', title: 'Document Manager',
        desc: 'View, delete, or download every file uploaded through CRM & portal, organized by client.'
    },
    logistics: {
        plan: 'Route',
        plannerTitle: 'Multimodal logistics planner — route map and ETA estimate',
        title: 'Logistics Planner',
        subtitle: 'Road · Sea · Air — automatic multimodal routing',
        origin: 'Origin',
        destination: 'Destination',
        cargo: 'Cargo (t)',
        priority: 'Priority',
        fastest: 'Fastest', cheapest: 'Cheapest', greenest: 'Lowest CO₂',
        compute: 'Compute routes',
    },
    offers: {
        declineReason: 'Client decline reason',
        acceptNote: 'Client accept note',
        markSeen: 'Mark as seen',
        newResponse: 'NEW'
    },
    portalPreview: {
        navLabel: 'Portal Preview', title: 'Portal Preview & Access Control',
        desc: 'See exactly what each client sees, and control their tab-level access and product catalog visibility.',
        selectClient: 'Select client', pickHint: 'Choose a client on the left to view and edit their portal access.',
        previewingFor: 'Previewing for',
        tabAccess: 'Tab access', tabAccessDesc: 'Uncheck a tab to hide it from this client.',
        catalogAccess: 'Catalog visibility', catalogAccessDesc: 'Select which products this client sees. Empty list = client sees nothing in the catalog.',
        noPartners: 'No partners.', noProducts: 'No products.'
    },
    portalActivity: {
        navLabel: 'Portal Activity', title: 'Portal Client Activity',
        desc: 'Track client logins, KYC submissions, uploads, and downloads with locations.',
        client: 'Client', location: 'Location',
        allClients: 'All clients', allActions: 'All actions',
        last7: 'Last 7 days', last30: 'Last 30 days', last90: 'Last 90 days', last365: 'Last 12 months', allTime: 'All time',
        searchPh: 'Search company, IP, detail...',
        loading: 'Loading portal activity…', empty: 'No matching portal events.',
        loadError: 'Failed to load portal activity.',
        stats30d: 'Client Analytics (30 days)', noStats: 'No portal activity in the last 30 days.',
        kpiLogins: 'Client logins', kpiKyc: 'KYC submissions', kpiDocs: 'Doc views/downloads', kpiOffers: 'Offer responses'
    },
    finances: {
        title: 'Financial Overview', totalRevenue: 'Total Revenue', totalExpenses: 'Total Expenses', netProfit: 'Net Profit', commission: 'Expected Commission',
        receivables: 'Receivables (Unpaid)', payables: 'Payables (Unpaid)', buyer: 'Buyer', supplier: 'Supplier', amount: 'Amount', dueDate: 'Due Date', deal: 'Deal',
        filterBy: 'Filter by period', today: 'Today', thisWeek: 'This Week', thisMonth: 'This Month', thisYear: 'This Year', customRange: 'Custom Range',
        cashFlow: 'Cash Flow (Paid Deals)', topDeals: 'Top 5 Most Profitable Deals', topPartners: 'Top 5 Partners (by turnover)',
        noData: 'No data.', paymentStatus: 'Payment Status', paidOn: 'Paid On', convertedTotal: 'Total (in Base Currency):', every: 'Every', dayInMonthWith: 'day of month with:'
    },
    cashflow: {
        title: 'Cash Flow', manageAccounts: 'Manage Accounts', addExpense: 'Add Expense', addIncome: 'Add Income', addTransfer: 'New Transfer', exportCSV: 'Export to CSV',
        accountState: 'Account Balances', account: 'Account', balance: 'Balance', noAccounts: 'No accounts created. Create your first account to begin.',
        recentTransactions: 'Recent Transactions', filter: 'Filter', allAccounts: 'All Accounts', allCategories: 'All Categories', date: 'Date', description: 'Description', category: 'Category', income: 'Income', expense: 'Expense',
        addAccount: 'Add Account', editAccount: 'Edit Account', accountName: 'Account Name', initialBalance: 'Initial Balance',
        addTransaction: 'Add Transaction', editTransaction: 'Edit Transaction', type: 'Type', expense_type: 'Expense', income_type: 'Income', transfer_type: 'Transfer',
        reasonPlaceholder: 'e.g. Office Rent', amount: 'Amount', currency: 'Currency', paymentMethod: 'Payment Method', card: 'Card', bank_transfer: 'Bank Transfer', cash: 'Cash',
        sourceOfFunds: 'Source of Funds', sourcePlaceholder: 'e.g. Founder Deposit', noTransactions: 'No transactions for selected period.', invoiceNumber: 'Invoice / Document No.', fromAccount: 'From Account', toAccount: 'To Account',
        incomeCategories: ['Sales Revenue', 'Founder Deposit', 'Loan', 'Refund', 'Other'], expenseCategories: ['Rent', 'Office Supplies', 'Marketing', 'Payroll', 'Transport', 'Utilities', 'Bank Fees', 'Representation', 'IT Services', 'Equipment', 'Other'],
        bankFee: 'Bank Fee (Optional)', recurringExpenses: 'Recurring Expenses', dayOfMonth: 'Day of Month', addRecurring: 'Add Recurring Expense', editRecurring: 'Edit Recurring Expense',
        accPlaceholder: "e.g. Main Account / Cash", recPlaceholder: "e.g. Warehouse Rent", txDate: "Transaction Date", txTime: "Transaction Time", txStatus: "Status",
        txCompleted: "Completed", txPending: "Pending", txReference: "Reference / Statement No.", txRefPlaceholder: "e.g. STM-245", txPurpose: "Transfer Purpose",
        txBankFee: "Bank Fee", txFeeDesc: "Bank: Fee for", txDetailTitle: "Transaction Details", txNewIncome: "New Income", txNewExpense: "New Expense", txNewTransfer: "New Transfer", txCreated: "Created in DB:", txModified: "Last Modified:", autoGenerated: "Auto-Generated", amountDeducted: "Amount Deducted", amountTarget: "Target Amount (Conversion)", every: 'Every'
    },
    invoice: {
        title: 'Invoice', type_proforma: 'PROFORMA INVOICE', type_invoice: 'COMMERCIAL INVOICE', generate: 'Generate Invoice/Proforma', print: 'Print', from: 'From:', to: 'To:', invoice_no: 'Document No.', date_of_issue: 'Date of Issue',
        description: 'Description', hs_code: 'HS Code', incoterm: 'Incoterm', quantity: 'Quantity', unit_price: 'Unit Price', total: 'Total', subtotal: 'Subtotal', vat_5: 'VAT (5%)', grand_total: 'Grand Total',
        vat_options: 'VAT Options', doc_type_options: 'Document Type', no_vat: 'No VAT', vat_inclusive: 'VAT Inclusive', vat_exclusive: 'VAT Exclusive',
        bank_details: 'Bank Details', bank: 'Bank', account_no: 'IBAN / Account No', swift: 'SWIFT/BIC', thank_you: 'Thank you for your business!',
        additional_services: 'Additional Services', service_name: 'Service Name', service_price: 'Service Price', pol: 'Port of Loading (POL)', pod: 'Port of Discharge (POD)', paymentTerms: 'Payment Terms', packaging: 'Packaging', bankDetailsEdit: 'Bank Details (Edit Freely)', page: 'Page', of: 'of', generatedBy: 'Document generated from Aspidus CRM', leadTime: 'Lead Time:', remarks: 'Remarks & Conditions:', acceptedBy: 'Accepted by / Buyer\n(Signature & Stamp)'
    },
    offer: {
        title: 'Offer', generate: 'Create Offer', print: 'Print Offer', offer_no: 'Offer No.', offer_date: 'Offer Date', valid_until: 'Valid Until (Validity)', product_specs: 'Product Specifications', origin: 'Origin', price_terms: 'Price and Payment Terms', your_price: 'Your Offered Price (per unit)', prepared_by: 'Prepared by', notes: 'Additional Notes', default_note: 'This offer is for informational purposes and does not constitute a commitment until confirmed by a Proforma Invoice.', customer: 'Customer', select_customer: 'Please select a customer from the list.', additional_services: 'Additional Services', service_name: 'Service Name', service_price: 'Service Price', specificNotes: 'Specific Notes (Visible to Customer in PDF)', saveOfferBtn: 'Save Offer', firmOffer: 'FIRM CORPORATE OFFER', packaging: 'Packaging', pol: 'Port of Loading (POL)', pod: 'Port of Discharge (POD)', leadTime: 'Lead Time', paymentTerms: 'Payment Terms', createDeal: 'Create Deal', createDealForce: 'Create Deal (without portal)'
    },
    deals: {
        purchaseValue: 'Purchase Value', saleValue: 'Sale Value', expenses: 'Additional Costs', commissions: 'Commissions', netProfit: 'Net Profit', paymentDue: 'Payment Due',
        targetProfit: 'Target Profit (%)', calculatePrice: 'Calculate Price', associateCommissions: 'Associate Commissions', addAssociate: 'Add Associate', commissionType: 'Commission Type', commissionValue: 'Value', percentOfProfit: '% of profit', fixedPerTon: 'Fixed per ton', fixedPerKg: 'Fixed per kg', createDeal: 'Create Deal', createOffer: 'Create Offer',
        status_negotiation: 'In Negotiation', status_signed: 'Contract Signed', status_payment: 'Payment Processing', status_completed: 'Completed', exchangeRate: 'Exchange Rate', purchaseSupplier: 'PURCHASE (Supplier)', saleBuyer: 'SALE (Buyer)', exchangeRateFetch: 'Fetch today\'s online exchange rate', calcSellingPriceBtn: 'Calculate Selling Price', expectedProfit: 'Expected Net Profit:', logisticsAndPayments: 'Logistics and Payments', accountForSupplier: 'Account used to pay supplier?', accountForBuyer: 'Account received from buyer?', confirmCascadeDelete: "Are you sure you want to permanently delete deal {0}?\n\nWARNING: This will automatically remove all linked financial transactions from 'Cashflow' and associated physical files!", buyerPaidPrefix: "✓ B:", supplierPaidPrefix: "✓ S:", buyerUnpaidPrefix: "! B:", supplierUnpaidPrefix: "! S:", paymentSupplierTitle: "Supplier Payment", paymentBuyerTitle: "Payment Confirmation"
    },
    product_search: { title: 'Advanced Product Search', search: 'Search', productName: 'Product Name', category: 'Category', countryOrigin: 'Country of Origin', supplier: 'Supplier', certificates: 'Certificates', incoterm: 'Incoterm', priceRange: 'Price Range', from: 'from', to: 'to', noResults: 'No results found.', typeName: 'Type name...' },
    network: { title: 'Network Connections', new_connection: 'New Connection', source_company: 'Source Company / Person', relation_type: 'Relation Type', target_company: 'Target Company / Person', notes: 'Additional Notes', error_self: 'You cannot connect a company to itself.', info_text: 'Track who recommended or connected certain partners. Click on a partner name to view details.', no_data: 'No connections entered.' },
    add: { partner: 'Add Partner / Person', deal: 'Create Deal', product: 'Add Product', demand: 'Add Demand', connection: 'Add Connection' },
    actions: { edit:'Edit', delete:'Delete', save:'Save', cancel:'Cancel', details: 'Details', backToList: 'Back to List', invoice: 'Invoice/Proforma', select_buyer: 'Select buyer', select_product: 'Select product', select_supplier: 'Select supplier', select_associate: 'Select associate', add_cost: 'Add Cost', add_new_offer: 'Add New Offer', list_view: 'List View', kanban_view: 'Kanban View', open: 'Open', openEdit: 'Open / Edit', confirm: 'Confirm', addService: 'Add Service', history: 'History', saveChanges: 'Save Changes', copy: 'Copy', exportCsv: '📊 Export CSV', select: 'Select', view: 'View' },
    fields: {
        companyName:'Company Name', fullName: 'Full Name', taxId:'Tax ID (VAT)', regNumber:'Registration No', street:'Street and No', city:'City', zip:'ZIP Code', country:'Country', contactPerson:'Contact Person', contactEmail:'Email', phone:'Phone', bankName:'Bank Name', accountNumber:'Account Number', swift:'SWIFT', notes:'Notes', tags: 'Tags', types:'Partner Types', quantity:'Quantity', unit:'Unit of Measure', hsCode: 'HS Code', description: 'Short Description', detailedSpec: 'Detailed Specification', certificates: 'Certificates', incoterm: 'Incoterm', demandFor: 'Demand For', existingProduct: 'Existing Product from DB', newProduct: 'Brand New Product', newProductName: 'New Product Name', actions: 'Actions', currency: 'Currency', date: 'Date',
        stockQuantity: 'Stock / Sourced', soldQuantity: 'Reserved / Sold', availableQuantity: 'Available', dealId: 'Contract ID / Ref', buyer: 'Buyer', supplier: 'Supplier (Source)', product: 'Product', purchasePrice: 'Purchase Price (per unit)', sellingPrice: 'Selling Price (per unit)', price: 'Price', purchasePricePlaceholder: 'Purchase Price', sellingPricePlaceholder: 'Selling Price', targetProfitPlaceholder: 'Target Profit %', purchaseCurrency: 'Payment Currency', sellingCurrency: 'Receiving Currency',
        costs: 'Additional Operational Costs', costType: 'Cost Type', costAmount: 'Cost Amount', bankCosts: 'Bank Transfer Fees', dealStartDate: 'Deal Start Date', deliveryDate: 'Delivery / Fulfillment Date', deliveryLocation: 'Delivery Location', paymentAccount: 'Our Receiving Account', supplierBankDetails: 'Supplier Bank Account', paymentDueDateBuyer: 'Buyer Payment Due to Us', paymentDueDateSupplier: 'Our Payment Due to Supplier', status: 'Deal Status', productName: 'Product Name', category: 'Category', targetProfit: 'Target Profit (%)', supplier_offers: 'Supplier Offers',
        company: 'Company', person: 'Individual (Representative)', linkedCompany: 'Linked Company', noLink: '-- Independent / No link --', linkedCompanyEntity: 'Linked Company (Entity represented)', representatives: 'Representatives / Linked Individuals', leadSource: 'Lead Source', currencySetup: 'Currency and Price Setup', origin: 'Origin:', countryOfOrigin: 'Country of Origin', modified: 'Modified:', oldPrice: 'Old price:', condition: 'Condition:', basicData: 'Basic Data', addressInfo: 'Address', contactInfo: 'Contact', bankInfo: 'Bank', activitiesAndDeals: 'Activities and Deals',
        stockNegative: '⚠️ NEGATIVE:', soldOut: 'SOLD OUT', statusLabel: 'Partner Status', active: 'ACTIVE', inactive: 'INACTIVE', blacklisted: '🚨 Blacklisted (Banned)', ratingLabel: 'Internal Rating (Reliability)', ratingNone: 'Unknown / No rating', noRating: 'No rating', rating1: '⭐ Poor (Risk)', rating2: '⭐⭐ Below Average', rating3: '⭐⭐⭐ Average', rating4: '⭐⭐⭐⭐ Very Good', rating5: '⭐⭐⭐⭐⭐ Excellent (Reliable)', whatsapp: 'WhatsApp / WeChat', website: 'Website', statusRating: 'Status & Rating', premiumClient: 'PREMIUM Client'
    },
    settings: {
        lang: 'Language', baseCurrency: 'Base Currency', lastInvoiceNum: 'Last Invoice Number', lastOfferNum: 'Last Offer Number', commRate: 'Commission Rate (%)', maxFileLimit: 'Max File Limit (MB)', companyInfo: 'Company Info', companyName: 'Company Name', address: 'Address', taxId: 'Tax ID', regNum: 'Registration No', bankName: 'Bank Name', accountNum: 'Account No', swift: 'SWIFT', logo: 'Logo (PNG/JPG)', saving: 'Saving...', vatRate: 'Default VAT (%)', paymentWarningDays: 'Payment Due Warning (Days)', defaultInvoiceNotes: 'Default Invoice Notes', defaultOfferNotes: 'Default Offer Notes', stamp: 'Stamp & Signature (PNG/JPG)', settingsTitle: 'Settings'
    },
    kyc: {
        loading: 'Loading KYC Data...', connecting: 'Connecting to B2B Vault...', notFound: 'Partner not found.', moduleNotLoaded: 'KYC module is not loaded.', noSubmissions: 'No KYC Submissions', noSubmissionsDesc: 'This client has not submitted the KYC form via B2B Portal yet.', reviewTitle: 'Compliance & KYC Review', fullName: 'Full Name', passport: 'Passport No.', nationality: 'Nationality', notProvided: 'Not provided', dossier: 'KYC Dossier', submissionDate: 'Submission Date', corpData: 'Corporate Data', regName: 'Registered Name', industry: 'Industry', regNo: 'Reg. No.', taxId: 'Tax ID', website: 'Website', regAddr: 'Registered Address', opAddr: 'Operational Address', sameAsReg: 'Same as registered', finProfile: 'Financial Profile', turnover: 'Expected Turnover', sourceOfFunds: 'Source of Funds', bankingDetails: 'Banking Details', corrBank: 'Corr. Bank', structure: 'Structure & Ownership', directors: 'Directors / Managers', ubos: 'Ultimate Beneficial Owners', pep: 'Politically Exposed Person (PEP)?', sanctions: 'Subject to international sanctions?', litigation: 'AML/CFT Litigation?', dualUse: 'Dual-Use / Military goods?', yes: 'YES', no: 'NO', attachedDocs: 'Attached Documents', tradeLicenses: 'Trade Licenses', passportsDoc: 'Passports', incorpDocs: 'Incorporation Docs', declaration: 'Declaration', consent: 'Consent for data processing collected.', complianceActions: 'Compliance Actions', dashboard: 'Compliance Officer Dashboard', riskLevel: 'Risk Assessment Level', lowRisk: 'Low Risk', mediumRisk: 'Medium Risk', highRisk: 'High Risk', notesPlaceholder: 'Reasons for approval/rejection...', approve: 'APPROVE PARTNER', requestUpdate: 'REQUEST UPDATE', reject: 'REJECT PARTNER', statusUpdated: 'KYC Status updated to:', saveError: 'Error saving status.', pending: 'KYC: Pending', approved: 'KYC: Approved', updateReq: 'KYC: Update Req', blocked: 'KYC: Blocked'
    },
    categories: { agriculture: 'Agriculture & Food', food: 'Food Products', beverages: 'Beverages', inputs: 'Agricultural Inputs', industry: 'Industry & Raw Materials', construction: 'Construction Materials', energy: 'Energy', metals: 'Metals', chemicals: 'Chemicals', textiles: 'Textiles', electronics: 'Electronics', pharma: 'Pharmaceuticals', packaging: 'Packaging', other: 'Other' },
    legal: { confidentiality_title: 'STRICTLY CONFIDENTIAL', confidentiality_text: 'This document is strictly confidential and intended solely for the individual or company to whom it is addressed. Any unauthorized copying, alteration, forwarding to third parties, or misuse of the information from this document is subject to legal sanctions and will result in the immediate blocking of the client or partner for any future cooperation.' },
    notifications: { title:'Notifications', noNotifications:'No notifications', paymentDue:'Payment due soon', oldPartner:'No recent updates for partner', oldDemand:'Old demand', productAvailable: 'Requested product is now available', reminder: 'Reminder' },
    placeholders: { pack: 'e.g. 25kg PP Woven Bags', pol: 'e.g. Jebel Ali, UAE', pod: 'e.g. Any Safe Port', lead: 'e.g. 15-20 days after confirmation', pay: 'e.g. 100% LC at Sight or Net 30', qty: 'Enter quantity...', newProduct: 'Enter exact name of requested product...', activityType: 'e.g. Phone call, Meeting...', activityDetails: 'Details...', relationType: 'e.g. Recommendation, Founder, Subcontractor...', networkNotes: 'Additional information...', username: 'e.g. marko.worker', password: 'Enter secret password', searchName: 'Type name...' },
    tooltips: { pack: 'Select from the list or type specific packaging.', pol: 'Port where the goods are loaded.', pod: 'Destination port where goods are discharged.', lead: 'Expected delivery time after payment/confirmation.', pay: 'What are the approved payment terms for this buyer?' },
    users: {
        manage: 'Employee Management', addWorker: '+ Add Employee', workerRole: '👷 Worker (Restricted)', adminRole: '👑 Chief Administrator (Absolute access)', settingsPerms: '⚙️ Settings & Permissions', delWorker: '✕ Delete', delWorkerConfirm: 'WARNING:\nAre you sure you want to permanently delete this employee? They will no longer be able to log in.', editWorker: 'Edit Employee Data', newWorker: 'Register New Employee', accessDenied: '⛔ Access Denied', accessDeniedDelDeal: '⛔ Access Denied: You do not have permission to delete deals.', accessDeniedDelProd: '⛔ Access Denied: You do not have permission to delete products.', accessDeniedDelFin: '⛔ Access Denied: You do not have permission to delete finances.', accessDeniedDelPart: '⛔ Access Denied: You do not have permission to delete partners.', accessDeniedMsg: 'Your account does not have privileges to view this section. Contact your administrator.', accessDeniedEdit: '⛔ Access Denied: You do not have privileges to input or modify data in this module.', adminOnlyMsg: 'Only the Administrator can manage employees.',
        usernameLabelFull: 'Username', passwordLabelFull: 'Password', accessLevel: 'Access Level (Role)', saveWorker: '💾 Save Employee', permsMatrix: '🛡️ Precise Permissions Matrix', permsDesc: 'Configure specific permissions for each employee. If an employee lacks view permissions, the module will be hidden.', pwLeaveBlank: '(Leave blank to keep current)', newPassword: 'New Password',
        permViewAll: '👁 View ALL Data in module', permViewOwn: '👤 View ONLY OWN Data (And assigned ones)', permEdit: '✍️ Input & Edit', permDelete: '🗑 Delete Data', permViewCosts: '💰 View Purchase Prices, Profit & Suppliers', permViewPrices: '🏭 View Supplier Prices', accessShareBtn: '🔑 Access', accessManageTitle: 'Manage Access', accessManageDesc: 'Select which workers are allowed to view and edit this client. (Admin always sees all)'
    },
    api: { dbLoadError: 'Database load error:', bulkSaveError: 'Bulk save error:', singleSaveError: 'Single item save error:', deleteError: 'Item delete error:', fileDeleteError: 'Physical file delete error:', unauthorized: 'Unauthorized access', usersLoadError: 'Error loading employees:', userSaveError: 'Error saving employee:', userDeleteError: 'Error deleting employee:', cannotDeleteSelf: 'You cannot delete yourself from the system.', fileTooLarge: 'File is too large and was rejected by the server!', invalidFileType: 'This file type is not allowed for security reasons.', fileNotFound: 'The requested file does not exist on the server.', serverError: 'Internal server error.', offline: 'No internet connection. Showing cached data.', rateLimited: 'Too many requests in a short period. Please wait.', smtpIncomplete: 'Incomplete SMTP settings. Please fill in all required fields.', smtpSuccess: 'SMTP connection tested successfully!', smtpNotConfigured: 'SMTP settings are not configured. Please set them up in Company Settings.', smtpAuthError: 'SMTP server authentication failed. Please check the username and password.', smtpTimeoutError: 'Connection to the SMTP server timed out. Please check your settings and network connection.', smtpConnectError: 'Could not connect to the SMTP server. Please check the host and port.' },
    misc: { 
        confirmDeleteTitle: 'Confirm Deletion',
        partnerNotFound: 'Partner not found', geoRequired: 'Security System: You MUST allow Location Access to log into the CRM!', geoNotSupported: 'Geolocation not supported', authenticating: 'Authenticating...', appDesc: 'Advanced platform for client, trade, and financial management in international trade.', confirmDelete:'Are you sure you want to delete this item? This action cannot be undone.', importSuccess:'Data successfully loaded and merged.', importError:'Import failed. Check the CSV/JSON file.', invalidCsv: 'Invalid CSV format. Please check the file structure.', saved:'Saved.', partnerDetails: 'Partner Details', downloadTemplate: 'Download Template (CSV)', importPartners: 'Import Partners (CSV)', partnersImported: 'Partners successfully imported.', addActivity: 'Add Activity / Note', addLink: 'Add External Link / Folder', add_physical_file: 'Add Physical File', importProducts: 'Import Products (CSV)', importOffers: 'Import Offers (CSV)', downloadProductTemplate: 'Template: Products', downloadOfferTemplate: 'Template: Offers', selectSupplierForOffers: 'Select Supplier for CSV Offers', offersImported: 'Offers successfully imported.', productsImported: 'Products successfully imported.', loginError: 'Invalid credentials. Try again.', savedOffersTitle: 'Saved Customer Offers', offerNoTable: 'Offer No', offerDateTable: 'Date', offerCustomerTable: 'Customer', offerProductTable: 'Product', offerValueTable: 'Value', offerActionsTable: 'Actions', openPrintAction: 'Open / Print', noOffersStored: 'You have no saved offers. Create an offer from the \'Products\' section.', creatingPdfStatus: '⏳ Generating PDF...', selectCustomerAlert: 'Select a customer before saving!', offerSavedAlert: 'Offer successfully saved in database!', newTag: 'New', historyLabel: 'History', docLinksTitle: 'Documents / Links', linkFolderLabel: 'Link / Folder', fileLabel: 'File', loadingStatus: 'Uploading...', fileLimitError: 'File exceeds maximum allowed size!', nameLabel: 'Name', pathLabel: 'Link or Path', basicDataLabel: 'Basic Data', addressLabel: 'Address', contactLabel: 'Contact', bankLabel: 'Bank', activitiesLabel: 'Activities and Agreements', allTypesLabel: 'All Types', textFieldPlaceholder: '...', apiRateError: 'Error fetching API exchange rates.', appVersion: 'v22.0 Enterprise', companySettingsLabel: 'Company Settings', accountLabel: 'Account', importLabel: 'Import', exportLabel: 'Export', logoutLabel: 'Logout', welcomeBack: 'Welcome Back', loginInstruction: 'Log in to access the system', usernameLabel: 'Username', passwordLabel: 'Password', loginBtn: 'Access System', loginErrorMsg: 'Invalid credentials. Try again.', rejectPartnerDelete: '❌ DENIED: Cannot delete this partner because there are linked Deals or Offers. Remove them first to preserve ledger integrity.', rejectProductDelete: '❌ DENIED: Cannot delete this product as it is already part of active Deals or Offers.', rejectAccountDelete: '❌ DENIED: This account has a transaction history (Cashflow). Deleting an account with traffic is not allowed.', enterNewProductName: 'Warning: Please enter the exact name of the new product.', selectExistingProduct: 'Warning: Please select an existing product from the database.', sessionExpired: 'Your session has expired due to inactivity. Please log in again.', myProfile: 'My Profile / Password', copied: 'Copied!', exportNoData: 'No data to export.', searchNameTax: 'Search (Name / Tax ID)', call: 'Call', maps: 'Maps', noTags: 'No tags', expired: 'EXPIRED:', expiringSoon: 'EXPIRING SOON:', docRenewal: 'Document Renewal Required', highRiskAlert: 'High Risk Level. Potential banking restrictions apply.', socialMedia: 'Social Media & Presence', systemMetrics: 'System Metrics', sysStatus: 'System Status', dateAdded: 'Date Added', notRecorded: 'Not recorded', automationNote: 'Automation Note', automationDesc: 'System links documentation to this entity exclusively using the Tax ID database:', portalLinkGen: 'Secure link generated', portalLinkDesc: 'This link grants the client B2B portal access via OTP verification.', b2bLinkBtn: 'B2B Portal Link', portalRevoke: 'Revoke Portal Access', portalReactivate: 'Reactivate Portal Access', portalRevokeConfirm: 'Are you sure you want to REVOKE this partner\'s B2B portal access? All active sessions will stop working immediately.', portalReactivateConfirm: 'Do you want to reactivate this partner\'s B2B portal access?'
    },
    session: {
        title: 'Session Expiring',
        logoutIn: 'Logging you out in',
        stayLoggedIn: 'Keep Me Logged In',
        logout: 'Log Out',
        warning: 'Your session is expiring soon due to inactivity.'
    }
  }
};

function t(path) {
  const parts = path.split('.');
  // 1) primary language
  let cur = translations[state.lang];
  for(const p of parts){ if(!cur) { cur = null; break; } cur = cur[p]; }
  if (cur != null) return cur;
  // 2) fallback: druga podrzana grana (EN default) — cesto SR postoji, EN nema ili obrnuto
  const fallbackLang = state.lang === 'sr' ? 'en' : 'sr';
  let alt = translations[fallbackLang];
  for(const p of parts){ if(!alt) { alt = null; break; } alt = alt[p]; }
  if (alt != null) return alt;
  // 3) Ako ni jedno nema, umesto sirovog "text.text" ključa prikažemo user-friendly
  //    verziju POSLEDNJEG segmenta ključa: 'foo.customerBank' → 'Customer Bank'.
  //    Ovim korisnik dobija smislen label čak i kad prevod nedostaje.
  const last = parts[parts.length - 1] || path;
  const humanized = String(last)
      .replace(/[_-]+/g, ' ')                    // snake_case / kebab-case → space
      .replace(/([a-z])([A-Z])/g, '$1 $2')      // camelCase → camel Case
      .replace(/\s+/g, ' ')
      .trim();
  if (!humanized) return path;
  // Log jednom po ključu — pomaže pri razvoju da vidimo koje nedostaju.
  if (typeof window !== 'undefined' && !window.__missing_t) window.__missing_t = new Set();
  if (window.__missing_t && !window.__missing_t.has(path)) {
      window.__missing_t.add(path);
      if (typeof console !== 'undefined' && console.debug) console.debug('[t] missing key:', path, '→', humanized);
  }
  return humanized.charAt(0).toUpperCase() + humanized.slice(1);
}

function getTranslatedCategory(catKey) {
    if (!catKey) return '';
    const translated = t('categories.' + catKey);
    if (translated === 'categories.' + catKey) return catKey;
    return translated;
}