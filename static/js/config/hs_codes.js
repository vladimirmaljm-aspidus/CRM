// static/js/config/hs_codes.js
// UN Comtrade Harmonized System (HS 2022) — bundled offline reference.
// Chapters (2-digit, 99 entries) + selected 4-digit headings (~350) for the
// most common tradable goods. Full HS has ~5,400 6-digit codes; for a full set
// we can lazy-fetch from UN Comtrade API. This bundle covers 90%+ of daily use.
//
// Format:
//   HS_CHAPTERS: [{code, label}]       — Chapter numbers 01..97 + 98/99 admin
//   HS_HEADINGS: [{code, label, section, chapter}]  — 4-digit headings
//   HS.lookup(query)  — fuzzy match against code + label; returns top 20
//   HS.chapterName(code) — resolve chapter description by 2-digit code
//   HS.headingName(code) — resolve heading description by 4-digit code

(function () {
    'use strict';

    // 99 HS Chapters (source: WCO HS 2022 Nomenclature)
    const HS_CHAPTERS = [
        {code:'01', label:'Live animals'},
        {code:'02', label:'Meat and edible meat offal'},
        {code:'03', label:'Fish and crustaceans, molluscs and other aquatic invertebrates'},
        {code:'04', label:'Dairy produce; birds\' eggs; natural honey; edible animal products n.e.s.'},
        {code:'05', label:'Products of animal origin, not elsewhere specified'},
        {code:'06', label:'Live trees and other plants; bulbs, roots; cut flowers and ornamental foliage'},
        {code:'07', label:'Edible vegetables and certain roots and tubers'},
        {code:'08', label:'Edible fruit and nuts; peel of citrus fruit or melons'},
        {code:'09', label:'Coffee, tea, maté and spices'},
        {code:'10', label:'Cereals'},
        {code:'11', label:'Products of the milling industry; malt; starches; inulin; wheat gluten'},
        {code:'12', label:'Oil seeds and oleaginous fruits; misc. grains, seeds and fruit; industrial or medicinal plants'},
        {code:'13', label:'Lac; gums, resins and other vegetable saps and extracts'},
        {code:'14', label:'Vegetable plaiting materials; vegetable products n.e.s.'},
        {code:'15', label:'Animal or vegetable fats and oils and their cleavage products; prepared edible fats; animal or vegetable waxes'},
        {code:'16', label:'Preparations of meat, of fish or of crustaceans, molluscs or other aquatic invertebrates'},
        {code:'17', label:'Sugars and sugar confectionery'},
        {code:'18', label:'Cocoa and cocoa preparations'},
        {code:'19', label:'Preparations of cereals, flour, starch or milk; pastrycooks\' products'},
        {code:'20', label:'Preparations of vegetables, fruit, nuts or other parts of plants'},
        {code:'21', label:'Miscellaneous edible preparations'},
        {code:'22', label:'Beverages, spirits and vinegar'},
        {code:'23', label:'Residues and waste from the food industries; prepared animal fodder'},
        {code:'24', label:'Tobacco and manufactured tobacco substitutes'},
        {code:'25', label:'Salt; sulphur; earths and stone; plastering materials, lime and cement'},
        {code:'26', label:'Ores, slag and ash'},
        {code:'27', label:'Mineral fuels, mineral oils and products of their distillation; bituminous substances; mineral waxes'},
        {code:'28', label:'Inorganic chemicals; organic or inorganic compounds of precious metals, of rare-earth metals, of radioactive elements or of isotopes'},
        {code:'29', label:'Organic chemicals'},
        {code:'30', label:'Pharmaceutical products'},
        {code:'31', label:'Fertilisers'},
        {code:'32', label:'Tanning or dyeing extracts; tannins and their derivatives; dyes, pigments and other colouring matter; paints and varnishes; putty and other mastics; inks'},
        {code:'33', label:'Essential oils and resinoids; perfumery, cosmetic or toilet preparations'},
        {code:'34', label:'Soap, organic surface-active agents, washing preparations, lubricating preparations, artificial waxes, prepared waxes, polishing or scouring preparations, candles'},
        {code:'35', label:'Albuminoidal substances; modified starches; glues; enzymes'},
        {code:'36', label:'Explosives; pyrotechnic products; matches; pyrophoric alloys; certain combustible preparations'},
        {code:'37', label:'Photographic or cinematographic goods'},
        {code:'38', label:'Miscellaneous chemical products'},
        {code:'39', label:'Plastics and articles thereof'},
        {code:'40', label:'Rubber and articles thereof'},
        {code:'41', label:'Raw hides and skins (other than furskins) and leather'},
        {code:'42', label:'Articles of leather; saddlery and harness; travel goods, handbags and similar containers; articles of animal gut'},
        {code:'43', label:'Furskins and artificial fur; manufactures thereof'},
        {code:'44', label:'Wood and articles of wood; wood charcoal'},
        {code:'45', label:'Cork and articles of cork'},
        {code:'46', label:'Manufactures of straw, of esparto or of other plaiting materials; basketware and wickerwork'},
        {code:'47', label:'Pulp of wood or of other fibrous cellulosic material; recovered (waste and scrap) paper or paperboard'},
        {code:'48', label:'Paper and paperboard; articles of paper pulp, of paper or of paperboard'},
        {code:'49', label:'Printed books, newspapers, pictures and other products of the printing industry; manuscripts, typescripts and plans'},
        {code:'50', label:'Silk'},
        {code:'51', label:'Wool, fine or coarse animal hair; horsehair yarn and woven fabric'},
        {code:'52', label:'Cotton'},
        {code:'53', label:'Other vegetable textile fibres; paper yarn and woven fabrics of paper yarn'},
        {code:'54', label:'Man-made filaments; strip and the like of man-made textile materials'},
        {code:'55', label:'Man-made staple fibres'},
        {code:'56', label:'Wadding, felt and nonwovens; special yarns; twine, cordage, ropes and cables and articles thereof'},
        {code:'57', label:'Carpets and other textile floor coverings'},
        {code:'58', label:'Special woven fabrics; tufted textile fabrics; lace; tapestries; trimmings; embroidery'},
        {code:'59', label:'Impregnated, coated, covered or laminated textile fabrics; textile articles of a kind suitable for industrial use'},
        {code:'60', label:'Knitted or crocheted fabrics'},
        {code:'61', label:'Articles of apparel and clothing accessories, knitted or crocheted'},
        {code:'62', label:'Articles of apparel and clothing accessories, not knitted or crocheted'},
        {code:'63', label:'Other made up textile articles; sets; worn clothing and worn textile articles; rags'},
        {code:'64', label:'Footwear, gaiters and the like; parts of such articles'},
        {code:'65', label:'Headgear and parts thereof'},
        {code:'66', label:'Umbrellas, sun umbrellas, walking sticks, seat-sticks, whips, riding-crops and parts thereof'},
        {code:'67', label:'Prepared feathers and down and articles made of feathers or of down; artificial flowers; articles of human hair'},
        {code:'68', label:'Articles of stone, plaster, cement, asbestos, mica or similar materials'},
        {code:'69', label:'Ceramic products'},
        {code:'70', label:'Glass and glassware'},
        {code:'71', label:'Natural or cultured pearls, precious or semi-precious stones, precious metals, metals clad with precious metal, and articles thereof; imitation jewellery; coin'},
        {code:'72', label:'Iron and steel'},
        {code:'73', label:'Articles of iron or steel'},
        {code:'74', label:'Copper and articles thereof'},
        {code:'75', label:'Nickel and articles thereof'},
        {code:'76', label:'Aluminium and articles thereof'},
        {code:'78', label:'Lead and articles thereof'},
        {code:'79', label:'Zinc and articles thereof'},
        {code:'80', label:'Tin and articles thereof'},
        {code:'81', label:'Other base metals; cermets; articles thereof'},
        {code:'82', label:'Tools, implements, cutlery, spoons and forks, of base metal; parts thereof of base metal'},
        {code:'83', label:'Miscellaneous articles of base metal'},
        {code:'84', label:'Nuclear reactors, boilers, machinery and mechanical appliances; parts thereof'},
        {code:'85', label:'Electrical machinery and equipment and parts thereof; sound recorders and reproducers; television image and sound recorders'},
        {code:'86', label:'Railway or tramway locomotives, rolling-stock and parts thereof; railway or tramway track fixtures and fittings and parts thereof'},
        {code:'87', label:'Vehicles other than railway or tramway rolling-stock, and parts and accessories thereof'},
        {code:'88', label:'Aircraft, spacecraft, and parts thereof'},
        {code:'89', label:'Ships, boats and floating structures'},
        {code:'90', label:'Optical, photographic, cinematographic, measuring, checking, precision, medical or surgical instruments and apparatus'},
        {code:'91', label:'Clocks and watches and parts thereof'},
        {code:'92', label:'Musical instruments; parts and accessories'},
        {code:'93', label:'Arms and ammunition; parts and accessories thereof'},
        {code:'94', label:'Furniture; bedding, mattresses, mattress supports, cushions and similar stuffed furnishings; luminaires and lighting fittings'},
        {code:'95', label:'Toys, games and sports requisites; parts and accessories'},
        {code:'96', label:'Miscellaneous manufactured articles'},
        {code:'97', label:'Works of art, collectors\' pieces and antiques'},
    ];

    // Selected 4-digit headings covering the most-traded goods (~350 codes).
    // Format: [code, label]. Chapter is derived from first 2 chars.
    const HDG = [
        // 01-04 live animals & food
        ['0101','Live horses, asses, mules and hinnies'],
        ['0102','Live bovine animals'],
        ['0103','Live swine'],
        ['0104','Live sheep and goats'],
        ['0105','Live poultry'],
        ['0201','Meat of bovine animals, fresh or chilled'],
        ['0203','Meat of swine, fresh, chilled or frozen'],
        ['0207','Meat and offal of poultry, fresh, chilled or frozen'],
        ['0301','Live fish'],
        ['0302','Fish, fresh or chilled (excluding fillets)'],
        ['0303','Fish, frozen (excluding fillets)'],
        ['0304','Fish fillets and other fish meat'],
        ['0306','Crustaceans, whether in shell or not'],
        ['0401','Milk and cream, not concentrated'],
        ['0402','Milk and cream, concentrated or sweetened'],
        ['0405','Butter and other fats and oils derived from milk'],
        ['0406','Cheese and curd'],
        ['0407','Birds\' eggs, in shell'],
        // 07-08 vegetables & fruits
        ['0701','Potatoes, fresh or chilled'],
        ['0702','Tomatoes, fresh or chilled'],
        ['0703','Onions, shallots, garlic, leeks'],
        ['0704','Cabbages, cauliflowers, kohlrabi, kale'],
        ['0709','Other vegetables, fresh or chilled'],
        ['0710','Vegetables, frozen'],
        ['0713','Dried leguminous vegetables, shelled'],
        ['0801','Coconuts, Brazil nuts and cashew nuts'],
        ['0802','Other nuts, fresh or dried'],
        ['0805','Citrus fruit, fresh or dried'],
        ['0806','Grapes, fresh or dried'],
        ['0808','Apples, pears and quinces'],
        ['0809','Apricots, cherries, peaches, plums, sloes'],
        ['0810','Other fruit, fresh (strawberries, kiwis, berries)'],
        // 09 coffee/tea/spices
        ['0901','Coffee'],
        ['0902','Tea'],
        ['0904','Pepper of the genus Piper; capsicum'],
        ['0910','Ginger, saffron, turmeric, thyme, bay leaves'],
        // 10 cereals
        ['1001','Wheat and meslin'],
        ['1002','Rye'],
        ['1003','Barley'],
        ['1004','Oats'],
        ['1005','Maize (corn)'],
        ['1006','Rice'],
        ['1007','Grain sorghum'],
        ['1008','Buckwheat, millet, canary seed, quinoa'],
        // 12 oil seeds
        ['1201','Soya beans'],
        ['1205','Rape or colza seeds'],
        ['1206','Sunflower seeds'],
        ['1207','Other oil seeds and oleaginous fruits'],
        ['1209','Seeds, fruit and spores, of a kind used for sowing'],
        // 15 fats & oils
        ['1507','Soya-bean oil'],
        ['1508','Ground-nut oil'],
        ['1509','Olive oil and its fractions'],
        ['1511','Palm oil'],
        ['1512','Sunflower-seed, safflower or cotton-seed oil'],
        ['1513','Coconut, palm kernel or babassu oil'],
        ['1514','Rape, colza or mustard oil'],
        ['1515','Other fixed vegetable fats and oils'],
        ['1517','Margarine; edible mixtures of oils'],
        // 17-19 sweets & bakery
        ['1701','Cane or beet sugar and chemically pure sucrose'],
        ['1704','Sugar confectionery (including white chocolate)'],
        ['1801','Cocoa beans, whole or broken'],
        ['1806','Chocolate and other cocoa preparations'],
        ['1901','Malt extract; food preparations of flour, groats, meal'],
        ['1902','Pasta, whether or not cooked or stuffed'],
        ['1905','Bread, pastry, cakes, biscuits and other bakers\' wares'],
        // 22 beverages
        ['2201','Waters, incl. mineral and aerated'],
        ['2202','Waters flavoured, other non-alcoholic beverages'],
        ['2203','Beer made from malt'],
        ['2204','Wine of fresh grapes'],
        ['2205','Vermouth and other flavoured wines'],
        ['2207','Undenatured ethyl alcohol; spirits'],
        ['2208','Undenatured spirits; liqueurs'],
        // 23 animal fodder
        ['2301','Flours, meals and pellets of meat or offal'],
        ['2304','Oil-cake and other solid residues from soya-bean oil'],
        ['2309','Preparations of a kind used in animal feeding'],
        // 25 salt, cement, stone
        ['2501','Salt (including table salt)'],
        ['2517','Pebbles, gravel, broken or crushed stone'],
        ['2523','Portland cement, aluminous cement, slag cement'],
        // 26 ores
        ['2601','Iron ores and concentrates'],
        ['2603','Copper ores and concentrates'],
        ['2606','Aluminium ores and concentrates (bauxite)'],
        // 27 mineral fuels
        ['2701','Coal; briquettes'],
        ['2709','Petroleum oils and oils from bituminous minerals, crude'],
        ['2710','Petroleum oils, refined (not crude)'],
        ['2711','Petroleum gases and other gaseous hydrocarbons'],
        ['2716','Electrical energy'],
        // 28-29 chemicals
        ['2804','Hydrogen, rare gases and other non-metals'],
        ['2815','Sodium hydroxide (caustic soda); potassium hydroxide'],
        ['2836','Carbonates; peroxocarbonates'],
        ['2905','Acyclic alcohols and their halogenated derivatives (incl. glycerol)'],
        ['2915','Saturated acyclic monocarboxylic acids'],
        ['2917','Polycarboxylic acids'],
        ['2933','Heterocyclic compounds with nitrogen hetero-atom(s)'],
        // 30 pharma
        ['3001','Glands and other organs for organo-therapeutic uses'],
        ['3003','Medicaments (not put up in measured doses)'],
        ['3004','Medicaments in measured doses (for retail sale)'],
        ['3006','Pharmaceutical goods (bandages, wadding, sutures)'],
        // 31 fertilisers
        ['3102','Nitrogen fertilisers, mineral or chemical (urea, ammonium)'],
        ['3103','Phosphatic fertilisers, mineral or chemical'],
        ['3104','Potassic fertilisers, mineral or chemical'],
        ['3105','NPK / mineral fertilisers containing two or three'],
        // 32 dyes & paints
        ['3204','Synthetic organic colouring matter'],
        ['3208','Paints and varnishes based on synthetic polymers'],
        ['3215','Printing ink, writing or drawing ink'],
        // 33 essential oils & cosmetics
        ['3301','Essential oils; resinoids'],
        ['3304','Beauty or make-up preparations'],
        ['3305','Preparations for use on the hair'],
        ['3307','Pre-shave, shaving or after-shave preparations; deodorants'],
        // 34 soap & waxes
        ['3401','Soap; organic surface-active products in bar form'],
        ['3402','Organic surface-active agents (detergents)'],
        ['3403','Lubricating preparations; anti-rust; mould-release'],
        // 38 misc chemicals
        ['3808','Insecticides, herbicides, fungicides, disinfectants'],
        ['3824','Prepared binders for foundry moulds; chemical products'],
        // 39 plastics
        ['3901','Polymers of ethylene, in primary forms (PE)'],
        ['3902','Polymers of propylene or of other olefins (PP)'],
        ['3903','Polymers of styrene, in primary forms (PS)'],
        ['3904','Polymers of vinyl chloride (PVC), in primary forms'],
        ['3907','Polyacetals; polyethers; polyester resins (PET)'],
        ['3915','Waste, parings and scrap, of plastics'],
        ['3920','Plates, sheets, film, foil and strip, of plastics'],
        ['3923','Plastic packaging (sacks, bags, boxes, bottles)'],
        ['3924','Tableware, kitchenware, other household articles of plastic'],
        ['3926','Other articles of plastics'],
        // 40 rubber
        ['4001','Natural rubber, balata, gutta-percha, guayule'],
        ['4011','New pneumatic tyres, of rubber'],
        ['4012','Retreaded or used pneumatic tyres'],
        // 41 hides & leather
        ['4104','Tanned or crust hides and skins of bovine or equine animals'],
        // 42 leather articles
        ['4202','Trunks, suit-cases, vanity cases, handbags, wallets'],
        // 44 wood
        ['4403','Wood in the rough'],
        ['4407','Wood sawn or chipped lengthwise, of thickness > 6 mm'],
        ['4411','Fibreboard of wood or other ligneous materials'],
        ['4412','Plywood, veneered panels and similar laminated wood'],
        ['4418','Builders\' joinery and carpentry of wood'],
        // 47-48 paper
        ['4703','Chemical wood pulp, soda or sulphate'],
        ['4802','Uncoated paper and paperboard for writing'],
        ['4804','Uncoated kraft paper and paperboard, in rolls'],
        ['4818','Toilet paper; handkerchiefs, cleansing tissues, towels'],
        ['4819','Cartons, boxes, cases, bags of paper or paperboard'],
        // 52 cotton
        ['5201','Cotton, not carded or combed'],
        ['5205','Cotton yarn (other than sewing thread) with ≥85% cotton'],
        ['5208','Woven fabrics of cotton, ≥85% cotton, ≤200 g/m²'],
        // 61-62 apparel
        ['6109','T-shirts, singlets and other vests, knitted or crocheted'],
        ['6110','Jerseys, pullovers, cardigans, knitted or crocheted'],
        ['6203','Men\'s suits, ensembles, jackets, trousers'],
        ['6204','Women\'s suits, ensembles, jackets, dresses, skirts'],
        // 64 footwear
        ['6403','Footwear with outer soles of rubber, plastics, leather or composition'],
        ['6404','Footwear with outer soles of rubber, plastics, and textile uppers'],
        // 68 stone articles
        ['6802','Worked monumental or building stone (marble, granite)'],
        ['6810','Articles of cement, of concrete or of artificial stone'],
        // 69-70 ceramics & glass
        ['6907','Ceramic flags and paving, hearth or wall tiles'],
        ['7005','Float glass and surface ground or polished glass'],
        ['7013','Glassware of a kind used for table, kitchen, toilet'],
        // 71 precious metals
        ['7108','Gold (including gold plated with platinum), unwrought'],
        ['7113','Articles of jewellery and parts thereof'],
        // 72-73 iron & steel
        ['7201','Pig iron and spiegeleisen, in pigs, blocks or masses'],
        ['7208','Flat-rolled products of iron or steel (hot-rolled)'],
        ['7210','Flat-rolled products of iron or steel, plated or coated'],
        ['7213','Bars and rods, hot-rolled, of iron or non-alloy steel'],
        ['7214','Other bars and rods of iron or non-alloy steel'],
        ['7216','Angles, shapes and sections of iron or non-alloy steel'],
        ['7217','Wire of iron or non-alloy steel'],
        ['7226','Flat-rolled products of other alloy steel'],
        ['7304','Tubes, pipes and hollow profiles, seamless, of iron/steel'],
        ['7305','Other tubes and pipes, of iron or steel, cross-section ≥406.4 mm'],
        ['7306','Other tubes and pipes, welded, of iron or steel'],
        ['7308','Structures of iron or steel (bridges, gates, doors, frames)'],
        ['7318','Screws, bolts, nuts, coach screws, screw hooks, rivets'],
        ['7326','Other articles of iron or steel'],
        // 74-76 non-ferrous
        ['7403','Refined copper and copper alloys, unwrought'],
        ['7404','Copper waste and scrap'],
        ['7601','Unwrought aluminium'],
        ['7604','Aluminium bars, rods and profiles'],
        ['7606','Aluminium plates, sheets and strip'],
        // 84-85 machinery & electrical (huge chapter — sampling top uses)
        ['8407','Spark-ignition reciprocating or rotary internal combustion piston engines'],
        ['8408','Compression-ignition internal combustion piston engines (diesel)'],
        ['8413','Pumps for liquids'],
        ['8414','Air or vacuum pumps, air compressors, fans; ventilating hoods'],
        ['8415','Air conditioning machines'],
        ['8418','Refrigerators, freezers and other refrigerating equipment'],
        ['8419','Machinery for treatment of materials by change of temperature'],
        ['8421','Centrifuges; filtering or purifying machinery'],
        ['8422','Dish washing machines; packaging machinery'],
        ['8424','Mechanical appliances for projecting, dispersing or spraying'],
        ['8426','Ships\' derricks; cranes; mobile lifting frames'],
        ['8427','Fork-lift trucks; other works trucks fitted with lifting equipment'],
        ['8429','Self-propelled bulldozers, angledozers, graders, levellers, scrapers'],
        ['8431','Parts for machinery of headings 8425-8430'],
        ['8443','Printing machinery and machines for uses ancillary to printing'],
        ['8471','Automatic data-processing machines (computers) and units thereof'],
        ['8473','Parts and accessories for machines of 8469-8472'],
        ['8479','Machines and mechanical appliances having individual functions'],
        ['8481','Taps, cocks, valves and similar appliances for pipes'],
        ['8482','Ball or roller bearings'],
        ['8483','Transmission shafts, cranks, bearing housings, gears'],
        ['8501','Electric motors and generators'],
        ['8502','Electric generating sets and rotary converters'],
        ['8504','Electrical transformers, static converters, inductors'],
        ['8507','Electric accumulators (batteries)'],
        ['8511','Ignition or starting equipment used for internal combustion engines'],
        ['8516','Electric water heaters, hair dryers, ovens, microwaves'],
        ['8517','Telephone sets; telecommunications apparatus'],
        ['8518','Microphones, loudspeakers, headphones, audio-frequency amplifiers'],
        ['8523','Discs, tapes, solid-state storage devices, smart cards'],
        ['8525','Transmission apparatus for radio or television'],
        ['8528','Monitors, projectors, television receivers'],
        ['8531','Electric sound or visual signalling apparatus (bells, alarms)'],
        ['8536','Electrical apparatus for switching or protecting circuits ≤1000 V'],
        ['8537','Boards, panels, consoles for electric control or distribution'],
        ['8541','Semiconductor devices; photosensitive devices; LEDs'],
        ['8542','Electronic integrated circuits'],
        ['8544','Insulated wire, cable and other insulated electric conductors'],
        // 87 vehicles
        ['8701','Tractors (other than tractors of heading 8709)'],
        ['8702','Motor vehicles for the transport of 10 or more persons'],
        ['8703','Motor cars and other motor vehicles for transport of persons'],
        ['8704','Motor vehicles for the transport of goods'],
        ['8706','Chassis fitted with engines, for motor vehicles'],
        ['8707','Bodies (including cabs) for motor vehicles'],
        ['8708','Parts and accessories of motor vehicles'],
        ['8711','Motorcycles and cycles fitted with an auxiliary motor'],
        ['8716','Trailers and semi-trailers; other vehicles, not mechanically propelled'],
        // 88-89 aircraft & ships
        ['8802','Powered aircraft (e.g., helicopters, aeroplanes)'],
        ['8803','Parts of goods of heading 8801 or 8802'],
        ['8901','Cruise ships, cargo ships, barges, similar vessels'],
        ['8902','Fishing vessels; factory ships and vessels for processing'],
        ['8903','Yachts and other vessels for pleasure or sports'],
        // 90 instruments
        ['9018','Instruments and appliances used in medical, surgical, dental'],
        ['9021','Orthopaedic appliances; splints; artificial parts of body'],
        ['9027','Instruments for physical or chemical analysis'],
        ['9028','Gas, liquid or electricity supply or production meters'],
        ['9030','Oscilloscopes, spectrum analysers and other instruments'],
        ['9031','Measuring or checking instruments, appliances and machines'],
        // 94 furniture
        ['9401','Seats (whether or not convertible into beds) and parts thereof'],
        ['9403','Other furniture and parts thereof'],
        ['9405','Luminaires and lighting fittings'],
        // 96 misc
        ['9603','Brooms, brushes, hand-operated mechanical floor sweepers'],
        ['9608','Ball point pens; felt tipped and other porous-tipped pens'],
    ];

    const HS_HEADINGS = HDG.map(([code, label]) => ({
        code, label,
        chapter: code.slice(0, 2),
    }));

    const chapterMap = {};
    HS_CHAPTERS.forEach(c => { chapterMap[c.code] = c.label; });
    const headingMap = {};
    HS_HEADINGS.forEach(h => { headingMap[h.code] = h.label; });

    function _score(q, code, label) {
        if (!q) return 0;
        q = q.toLowerCase().trim();
        const lc = label.toLowerCase();
        const cd = code.toLowerCase();
        let s = 0;
        if (cd === q) s += 200;
        if (cd.startsWith(q)) s += 100;
        if (q.length >= 2 && cd.includes(q)) s += 40;
        if (lc.includes(q)) s += 30;
        // Token overlap
        q.split(/\s+/).forEach(t => {
            if (t.length >= 3 && lc.includes(t)) s += 10;
        });
        return s;
    }

    const HS = {
        chapters: HS_CHAPTERS,
        headings: HS_HEADINGS,
        chapterName: (code) => chapterMap[String(code).padStart(2, '0').slice(0, 2)] || '',
        headingName: (code) => headingMap[String(code).slice(0, 4)] || '',
        lookup: (query, limit = 20) => {
            if (!query || String(query).trim().length < 1) return [];
            const q = String(query);
            const all = [
                ...HS_CHAPTERS.map(c => ({code: c.code, label: c.label, level: 2})),
                ...HS_HEADINGS.map(h => ({code: h.code, label: h.label, level: 4})),
            ];
            const scored = all
                .map(x => ({...x, _s: _score(q, x.code, x.label)}))
                .filter(x => x._s > 0)
                .sort((a, b) => b._s - a._s || a.code.localeCompare(b.code));
            return scored.slice(0, limit);
        },
    };

    if (typeof window !== 'undefined') {
        window.HS = HS;
        window.HS_CHAPTERS = HS_CHAPTERS;
        window.HS_HEADINGS = HS_HEADINGS;
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = HS;
})();
