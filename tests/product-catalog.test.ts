import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { DEFAULT_PRODUCT_CATALOG, buildCatalogBudgetContext, buildCatalogComparisonAdvice, buildCatalogEvidence, buildCatalogShippingWeights, buildDeterministicPriceReply, buildVariationCombinations, inferCatalogOfferFromText, inferCatalogOrdinalReference, inferCatalogPartialSelectionFromText, inferCatalogRecommendationFromText, inferCatalogSelectionUpdateFromText, inferOrdinalProductName, resolveCatalogOffer } from '../src/catalog/product-catalog.js';
import { setChatState } from '../src/chat/orders.js';
import { estimateConfiguredShippingWeightGrams } from '../src/api/rajaongkir.js';
import { getBusinessConfig } from '../src/config/business.js';

const fragrancePrices = {
    version: 3 as const,
    schemes: [
        { id: 'inspired', name: 'Parfum Inspired', aliases: ['inspired'], variations: [{ id: 'quality', name: 'Tingkat aroma', values: ['3:1 / EDP'] }, { id: 'size', name: 'Ukuran', values: ['30ml'] }], options: [{ values: { quality: '3:1 / EDP', size: '30ml' }, price: 39_500 }] },
        { id: 'character', name: 'Parfum Karakter', aliases: ['character', 'karakter'], variations: [{ id: 'quality', name: 'Tingkat aroma', values: ['Super Premium', 'Platinum'] }, { id: 'size', name: 'Ukuran', values: ['30ml', '50ml'] }], options: [{ values: { quality: 'Super Premium', size: '30ml' }, price: 120_000 }, { values: { quality: 'Platinum', size: '50ml' }, price: 180_000 }] },
    ],
};

test('new installations have no business-specific hardcoded price groups', () => {
    assert.deepEqual(DEFAULT_PRODUCT_CATALOG, { version: 3, schemes: [] });
});

test('business flow ignores legacy catalog-owned order fields', () => {
    const fields = getBusinessConfig().orderFields;
    assert.deepEqual(fields.slice(0, 2), ['productName', 'quantity']);
    for (const field of ['variant', 'quality', 'packageSize', 'productPrice']) assert.doesNotMatch(fields.join(','), new RegExp(field));
});

test('structured price groups resolve deterministic prices without a product allowlist', () => {
    const offer = resolveCatalogOffer({ classification: 'inspired', quality: '3:1', sizeMl: 30 }, fragrancePrices);
    assert.equal(offer.valid, true);
    if (offer.valid) assert.equal(offer.unitPrice, 39_500);
});

test('structured price groups accept localized aliases and custom groups', () => {
    const offer = resolveCatalogOffer({ classification: 'karakter', quality: 'Super Premium', sizeMl: 30 }, fragrancePrices);
    assert.equal(offer.valid, true);
    if (offer.valid) assert.equal(offer.unitPrice, 120_000);
    const localized = resolveCatalogOffer({ classification: 'karakter', quality: 'Platinum', sizeMl: 50 }, fragrancePrices);
    assert.equal(localized.valid, true);
    if (localized.valid) assert.equal(localized.unitPrice, 180_000);
    const custom = { version: 3 as const, schemes: [{ id: 'digital', name: 'Produk Digital', aliases: ['digital', 'akun'], variations: [{ id: 'duration', name: 'Durasi', values: ['Tahunan'] }], options: [{ values: { duration: 'Tahunan' }, price: 250_000 }] }] };
    const customOffer = resolveCatalogOffer({ classification: 'akun', attributes: { Durasi: 'Tahunan' } }, custom);
    assert.equal(customOffer.valid, true);
    if (customOffer.valid) assert.equal(customOffer.unitPrice, 250_000);
});

test('structured catalog rejects retired sizes and exposes stable evidence', () => {
    assert.equal(resolveCatalogOffer({ classification: 'inspired', quality: '2:1', sizeMl: 15 }, fragrancePrices).valid, false);
    const evidence = buildCatalogEvidence('Nama Fajar alamat Sleman', fragrancePrices);
    assert.match(evidence, /Tingkat aroma: 3:1 \/ EDP; Ukuran: 30ml; Rp39\.500/);
    assert.match(evidence, /Tingkat aroma: Super Premium; Ukuran: 30ml; Rp120\.000/);
    assert.match(evidence, /Nama item dan detail produk berasal dari Knowledge/);
    assert.doesNotMatch(evidence, /James Bond|Uniblack/);
});

test('shipping weight comes from price combinations and only exposes unambiguous size aliases', () => {
    const catalog = {
        version: 2 as const,
        schemes: [
            { id: 'regular', name: 'Reguler', aliases: ['regular'], variations: [{ id: 'quality', name: 'Kualitas', values: ['Premium'] }, { id: 'size', name: 'Ukuran', values: ['30ml'] }], options: [{ values: { quality: 'Premium', size: '30ml' }, price: 50_000, weightGrams: 120 }] },
            { id: 'special', name: 'Spesial', aliases: ['special'], variations: [{ id: 'quality', name: 'Kualitas', values: ['Premium'] }, { id: 'size', name: 'Ukuran', values: ['30ml', '50ml'] }], options: [{ values: { quality: 'Premium', size: '30ml' }, price: 70_000, weightGrams: 180 }, { values: { quality: 'Premium', size: '50ml' }, price: 90_000, weightGrams: 240 }] },
        ],
    };
    const weights = buildCatalogShippingWeights(catalog);
    assert.equal(weights['Reguler Premium 30ml'], 120);
    assert.equal(weights['special Premium 50ml'], 240);
    assert.equal(weights['50ml'], 240);
    assert.equal(weights['30ml'], undefined);
    assert.equal(estimateConfiguredShippingWeightGrams('2x Reguler Premium 30ml', weights, 500), 240);
});

test('dynamic variation axes generate every price combination', () => {
    const combinations = buildVariationCombinations([
        { id: 'size', name: 'Ukuran', values: ['30ml', '50ml'] },
        { id: 'grade', name: 'Tingkat aroma', values: ['Platinum', 'Premium'] },
    ]);
    assert.equal(combinations.length, 4);
    assert.deepEqual(combinations[3], { size: '50ml', grade: 'Premium' });
    const incomplete = resolveCatalogOffer({ classification: 'karakter', attributes: { Ukuran: '30ml' } }, fragrancePrices);
    assert.equal(incomplete.valid, false);
    if (!incomplete.valid) assert.equal(incomplete.error, 'Pilihan variasi belum lengkap.');
});

test('catalog infers the latest complete dynamic selection and quantity from conversation text', () => {
    const fragrance = inferCatalogOfferFromText('Aku pilih Parfum Inspired kualitas 3:1 / EDP ukuran 30ml, ambil dua botol.', fragrancePrices);
    assert.equal(fragrance?.subtotal, 79_000);
    const custom = { version: 3 as const, schemes: [{ id: 'digital', name: 'Produk Digital', aliases: ['akun'], variations: [{ id: 'duration', name: 'Durasi', values: ['Tahunan'] }, { id: 'seat', name: 'Pengguna', values: ['5 User'] }], options: [{ values: { duration: 'Tahunan', seat: '5 User' }, price: 250_000 }] }] };
    const digital = inferCatalogOfferFromText('Pilih akun dengan Durasi Tahunan untuk 5 User, satu paket.', custom);
    assert.equal(digital?.unitPrice, 250_000);
    assert.equal(digital?.quantity, 1);
});

test('catalog infers a unique variation combination without a scheme name', () => {
    const offer = inferCatalogOfferFromText('Saya cuma mau tahu harga EDP 30ml.', fragrancePrices);
    assert.equal(offer?.unitPrice, 39_500);
});

test('catalog remembers a partial recommendation and resolves natural smallest-size reference', () => {
    const recommendation = inferCatalogRecommendationFromText('Untuk ngantor, aku rekomendasi Parfum Inspired level 3:1 / EDP.', fragrancePrices);
    assert.deepEqual(recommendation, { classification: 'Parfum Inspired', attributes: { 'Tingkat aroma': '3:1 / EDP' } });
    assert.equal(buildDeterministicPriceReply('Yang pertama berapaan Kak ukuran kecilnya?', 'Yang pertama berapaan Kak ukuran kecilnya?', recommendation || undefined, fragrancePrices), 'Parfum Inspired Ukuran 30ml:\n\n3:1 / EDP 30ml: Rp39.500\n\nKakak tertarik tingkat aroma yang mana?');
    assert.deepEqual(
        inferCatalogRecommendationFromText('Parfum Inspired level 3:1 / EDP. Wangi ringan dan cocok kerja.', fragrancePrices),
        { classification: 'Parfum Inspired', attributes: { 'Tingkat aroma': '3:1 / EDP' } },
    );
    const threeQualities = {
        version: 3 as const,
        schemes: [{ id: 'inspired', name: 'Parfum Inspired', aliases: ['inspired'], variations: [{ id: 'quality', name: 'Kualitas', values: ['EDT', 'EDP', 'Murni'] }], options: [] }],
    };
    assert.equal(inferCatalogRecommendationFromText('Parfum Inspired punya EDT, EDP, dan Murni.', threeQualities), null);
});

test('smallest-size answer leads with requested size and follows with same-quality alternatives', () => {
    const catalog = {
        version: 3 as const,
        schemes: [{
            id: 'inspired', name: 'Parfum Inspired', aliases: ['inspired'],
            variations: [{ id: 'quality', name: 'Kualitas', values: ['EDT'] }, { id: 'size', name: 'Ukuran', values: ['30ml', '50ml', '100ml'] }],
            options: [
                { values: { quality: 'EDT', size: '30ml' }, price: 35_000 },
                { values: { quality: 'EDT', size: '50ml' }, price: 45_000 },
                { values: { quality: 'EDT', size: '100ml' }, price: 55_000 },
            ],
        }],
    };
    assert.equal(buildDeterministicPriceReply('Ukuran paling kecil berapa?', 'Ukuran paling kecil berapa?', { classification: 'Parfum Inspired', attributes: { Kualitas: 'EDT' } }, catalog), 'Parfum Inspired Ukuran 30ml:\n\nEDT 30ml: Rp35.000\n\nKakak tertarik kualitas yang mana?');
    assert.equal(
        buildDeterministicPriceReply('EDT ukuran paling kecil berapa?', 'EDT ukuran paling kecil berapa?', { classification: 'Parfum Inspired', attributes: { Kualitas: 'EDT' } }, catalog),
        'Parfum Inspired EDT 30ml harganya Rp35.000 per item, Kak.\n\nUkuran lainnya dengan kualitas yang sama:\nEDT 50ml: Rp45.000\nEDT 100ml: Rp55.000',
    );
});

test('smallest-size request without explicit quality lists every quality at that size', () => {
    const catalog = {
        version: 3 as const,
        schemes: [{
            id: 'inspired', name: 'Parfum Inspired', aliases: ['inspired'],
            variations: [{ id: 'quality', name: 'Kualitas', values: ['EDT', 'EDP', 'Murni'] }, { id: 'size', name: 'Ukuran', values: ['30ml', '50ml'] }],
            options: [
                { values: { quality: 'EDT', size: '30ml' }, price: 35_000 },
                { values: { quality: 'EDP', size: '30ml' }, price: 60_000 },
                { values: { quality: 'Murni', size: '30ml' }, price: 120_000 },
                { values: { quality: 'EDT', size: '50ml' }, price: 45_000 },
            ],
        }],
    };
    assert.equal(
        buildDeterministicPriceReply('Yang pertama berapaan Kak ukuran kecilnya?', 'Yang pertama berapaan Kak ukuran kecilnya?', { classification: 'Parfum Inspired', attributes: { Kualitas: 'EDT' } }, catalog),
        'Parfum Inspired Ukuran 30ml:\n\nEDT 30ml: Rp35.000\nEDP 30ml: Rp60.000\nMurni 30ml: Rp120.000\n\nKakak tertarik kualitas yang mana?',
    );
});

test('explicit all-prices request ignores stale quality and keeps active classification', () => {
    const catalog = {
        version: 3 as const,
        schemes: [{
            id: 'inspired', name: 'Parfum Inspired', aliases: ['inspired'],
            variations: [{ id: 'quality', name: 'Kualitas', values: ['EDT', 'EDP', 'Murni'] }, { id: 'size', name: 'Ukuran', values: ['30ml', '50ml'] }],
            options: [
                { values: { quality: 'EDT', size: '30ml' }, price: 35_000 },
                { values: { quality: 'EDP', size: '30ml' }, price: 60_000 },
                { values: { quality: 'Murni', size: '30ml' }, price: 120_000 },
            ],
        }],
    };
    assert.match(
        buildDeterministicPriceReply('tampilin smua harga yg 30ml aja ya', 'EDT EDP Murni', { classification: 'Parfum Inspired', attributes: { Kualitas: 'Murni' } }, catalog) || '',
        /EDT 30ml: Rp35\.000[\s\S]*EDP 30ml: Rp60\.000[\s\S]*Murni 30ml: Rp120\.000/,
    );
});

test('partial selection inference remains dynamic and does not invent missing axes', () => {
    const catalog = {
        version: 3 as const,
        schemes: [{ id: 'inspired', name: 'Parfum Inspired', aliases: ['inspired'], variations: [{ id: 'quality', name: 'Kualitas', values: ['EDT', 'EDP', 'Murni'] }, { id: 'size', name: 'Ukuran', values: ['30ml', '50ml'] }], options: [] }],
    };
    assert.deepEqual(inferCatalogPartialSelectionFromText('Aku mau Parfum Inspired ukuran 50ml', catalog), {
        classification: 'Parfum Inspired',
        attributes: { Ukuran: '50ml' },
    });
    assert.equal(inferCatalogPartialSelectionFromText('Aku belum ngerti EDT EDP Murni bedanya', catalog), null);
    assert.equal(inferCatalogPartialSelectionFromText('karakter aromanya hangat', fragrancePrices), null);
});

test('smallest-option and ambiguity replies stay dynamic for non-fragrance products', () => {
    const catalog = {
        version: 3 as const,
        schemes: [{
            id: 'subscription', name: 'Paket Langganan', aliases: ['paket'],
            variations: [{ id: 'tier', name: 'Paket', values: ['Basic', 'Pro'] }, { id: 'capacity', name: 'Kapasitas', values: ['1 User', '5 User'] }],
            options: [
                { values: { tier: 'Basic', capacity: '1 User' }, price: 25_000 },
                { values: { tier: 'Pro', capacity: '1 User' }, price: 50_000 },
                { values: { tier: 'Basic', capacity: '5 User' }, price: 100_000 },
                { values: { tier: 'Pro', capacity: '5 User' }, price: 175_000 },
            ],
        }],
    };
    assert.equal(
        buildDeterministicPriceReply('Kapasitas paling kecil berapa?', 'Kapasitas paling kecil berapa?', { classification: 'Paket Langganan' }, catalog),
        'Paket Langganan Kapasitas 1 User:\n\nBasic 1 User: Rp25.000\nPro 1 User: Rp50.000\n\nKakak tertarik paket yang mana?',
    );
    assert.match(buildDeterministicPriceReply('Yang beda berapa?', 'Yang beda berapa?', undefined, catalog) || '', /paket dan kapasitas/i);
    assert.doesNotMatch(buildDeterministicPriceReply('Yang beda berapa?', 'Yang beda berapa?', undefined, catalog) || '', /EDT|EDP|Murni|Platinum|ml/i);
});

test('full price lists group repeated leading variation values for readable chat', () => {
    const catalog = {
        version: 3 as const,
        schemes: [{
            id: 'subscription', name: 'Paket Langganan', aliases: ['paket'],
            variations: [{ id: 'tier', name: 'Paket', values: ['Basic', 'Pro'] }, { id: 'capacity', name: 'Kapasitas', values: ['1 User', '5 User'] }],
            options: [
                { values: { tier: 'Basic', capacity: '1 User' }, price: 25_000 },
                { values: { tier: 'Basic', capacity: '5 User' }, price: 100_000 },
                { values: { tier: 'Pro', capacity: '1 User' }, price: 50_000 },
                { values: { tier: 'Pro', capacity: '5 User' }, price: 175_000 },
            ],
        }],
    };
    assert.equal(
        buildDeterministicPriceReply('Harga paket apa aja?', 'Paket Langganan', { classification: 'Paket Langganan' }, catalog),
        'Paket Langganan:\n\nBasic\n1 User: Rp25.000\n5 User: Rp100.000\n\nPro\n1 User: Rp50.000\n5 User: Rp175.000\n\nKakak tertarik pilihan yang mana?',
    );
});

test('advice after a size comparison keeps prior variation and chooses the cheaper size', () => {
    const catalog = {
        version: 3 as const,
        schemes: [{
            id: 'subscription', name: 'Paket Langganan', aliases: ['paket'],
            variations: [{ id: 'tier', name: 'Paket', values: ['Basic', 'Pro'] }, { id: 'capacity', name: 'Kapasitas', values: ['1 User', '5 User'] }],
            options: [
                { values: { tier: 'Pro', capacity: '1 User' }, price: 50_000 },
                { values: { tier: 'Pro', capacity: '5 User' }, price: 175_000 },
            ],
        }],
    };
    assert.equal(
        buildCatalogComparisonAdvice('Kalau Kakak sendiri pilih yang mana?', '1 User sama 5 User beda berapa?', { classification: 'Paket Langganan', attributes: { Paket: 'Pro', Kapasitas: '1 User' } }, catalog),
        'Kalau dari dua pilihan tadi, aku pilih Pro 1 User, Kak. Pro tetap sama seperti pilihan sebelumnya, tetapi harganya Rp50.000 dan lebih hemat Rp125.000 daripada Pro 5 User. Kalau belum butuh kapasitas lebih besar, pilihan ini lebih masuk akal.',
    );
    assert.equal(buildCatalogComparisonAdvice('Pilih yang mana?', 'Basic sama Pro beda berapa?', { classification: 'Paket Langganan', attributes: { Kapasitas: '1 User' } }, catalog), null);
});

test('known classification lists all prices when product ordinal asks sizes without locked attributes', () => {
    assert.equal(
        buildDeterministicPriceReply('Ada ukuran sama harga apa aja?', 'Axbomba', { classification: 'Parfum Karakter' }, fragrancePrices),
        'Parfum Karakter:\n\nSuper Premium 30ml: Rp120.000\nPlatinum 50ml: Rp180.000\n\nKakak tertarik pilihan yang mana?',
    );
});

test('catalog resolves first option from the latest relevant assistant choice list', () => {
    const selection = inferCatalogOrdinalReference('Yang pertama berapaan ukuran kecilnya?', [
        'Untuk ngantor, Parfum Inspired paling pas. Ada kualitas 3:1 / EDP atau level lain.',
        'Pilihan kualitas Parfum Inspired: 3:1 / EDP lalu tingkat lain.',
    ], fragrancePrices);
    assert.deepEqual(selection, null);
    const completeCatalog = {
        version: 3 as const,
        schemes: [{ id: 'inspired', name: 'Parfum Inspired', aliases: ['inspired'], variations: [{ id: 'quality', name: 'Kualitas', values: ['EDT', 'EDP', 'Murni'] }, { id: 'size', name: 'Ukuran', values: ['30ml'] }], options: [] }],
    };
    assert.deepEqual(inferCatalogOrdinalReference('Yang pertama berapa?', ['Parfum Inspired punya EDT atau EDP.'], completeCatalog), { classification: 'Parfum Inspired', attributes: { Kualitas: 'EDT' } });
});

test('deterministic price replies use catalog values for price, quantity, difference, and budget', () => {
    assert.equal(
        buildDeterministicPriceReply('Harganya berapa?', 'Saya mau Parfum Inspired EDP 30ml. Harganya berapa?', undefined, fragrancePrices),
        'Parfum Inspired 3:1 / EDP 30ml harganya Rp39.500 per item, Kak.',
    );
    assert.equal(
        buildDeterministicPriceReply('Total 20 botol berapa?', 'Parfum Inspired EDP 30ml. Total 20 botol berapa?', undefined, fragrancePrices),
        'Parfum Inspired 3:1 / EDP 30ml harganya Rp39.500 per item. Untuk 20 item, totalnya Rp790.000, Kak.',
    );
    assert.equal(
        buildDeterministicPriceReply('Yang 50ml selisih berapa?', 'Parfum Karakter Platinum 50ml. Yang 50ml selisih berapa?', { unitPrice: 120_000, classification: 'Parfum Karakter', attributes: { quality: 'Platinum' } }, fragrancePrices),
        'Harga pilihan sebelumnya Rp120.000, sedangkan Platinum 50ml Rp180.000. Selisihnya Rp60.000, Kak.',
    );
    assert.match(buildDeterministicPriceReply('Budget 100 ribu dapat apa?', 'Budget 100 ribu dapat apa?', undefined, fragrancePrices) || '', /Rp39\.500/);
    assert.equal(
        buildDeterministicPriceReply('Harga normal satuannya berapa?', 'Sebelumnya ambil 20 botol Parfum Inspired EDP 30ml. Harga normal satuannya berapa?', undefined, fragrancePrices),
        'Parfum Inspired 3:1 / EDP 30ml harganya Rp39.500 per item, Kak.',
    );
    assert.match(
        buildDeterministicPriceReply('Bisa diskon grosir nggak?', 'Ambil 20 botol Parfum Inspired EDP 30ml. Bisa diskon grosir nggak?', undefined, fragrancePrices) || '',
        /belum tercantum.*Harga normal.*Rp39\.500/i,
    );
    assert.match(
        buildDeterministicPriceReply('Diskonnya beneran nggak ada?', 'Ambil 20 botol Parfum Inspired EDP 30ml.', undefined, fragrancePrices) || '',
        /belum tercantum.*admin/i,
    );
    assert.match(
        buildDeterministicPriceReply('30ml sama 50ml beda berapa?', 'Sebelumnya membahas EDT, EDP, dan Murni.', undefined, fragrancePrices) || '',
        /pastikan tingkat aroma.*selisih 30ml dan 50ml/i,
    );
    assert.match(
        buildDeterministicPriceReply('Ada ukuran sama harga apa aja?', 'Aku pilih Platinum. Ada ukuran sama harga apa aja?', undefined, fragrancePrices) || '',
        /Platinum 50ml: Rp180\.000/,
    );
    assert.equal(buildDeterministicPriceReply('Tahan berapa lama masing-masing?', 'EDT EDP Murni', undefined, fragrancePrices), null);
    assert.match(
        buildDeterministicPriceReply('Yang kedua menarik. Ada ukuran sama harga apa aja?', '2. Parfum Inspired kualitas 3:1 / EDP 30ml. Yang kedua menarik.', undefined, fragrancePrices) || '',
        /3:1 \/ EDP 30ml: Rp39\.500/,
    );
});

test('budget with descriptive need stays in recommendation flow instead of dumping cheap combinations', () => {
    assert.equal(buildDeterministicPriceReply('Budget 50 ribu dapat apa?', 'Budget 50 ribu dapat apa?', undefined, fragrancePrices)?.includes('Rp39.500'), true);
    assert.equal(buildDeterministicPriceReply('Budget 50 ribu, yang fresh ada?', 'Budget 50 ribu, yang fresh ada?', undefined, fragrancePrices), null);
    assert.equal(buildDeterministicPriceReply('Buat kuliah budget 70 ribu, yang kalem', 'Buat kuliah budget 70 ribu, yang kalem', undefined, fragrancePrices), null);
    const context = buildCatalogBudgetContext('Budget 50 ribu, yang fresh ada?', fragrancePrices);
    assert.match(context?.evidence || '', /maksimal Rp50\.000/);
    assert.match(context?.fallback || '', /Rp39\.500/);
});

test('comparison resolves two requested values while preserving other selected axes', () => {
    const catalog = {
        version: 3 as const,
        schemes: [{
            id: 'subscription', name: 'Paket Langganan', aliases: ['paket'],
            variations: [{ id: 'tier', name: 'Paket', values: ['Basic', 'Pro'] }, { id: 'capacity', name: 'Kapasitas', values: ['1 User', '5 User'] }],
            options: [
                { values: { tier: 'Basic', capacity: '1 User' }, price: 25_000 },
                { values: { tier: 'Basic', capacity: '5 User' }, price: 100_000 },
                { values: { tier: 'Pro', capacity: '1 User' }, price: 50_000 },
                { values: { tier: 'Pro', capacity: '5 User' }, price: 175_000 },
            ],
        }],
    };
    assert.equal(
        buildDeterministicPriceReply('1 User sama 5 User beda berapa?', 'Aku pilih Pro. 1 User sama 5 User beda berapa?', { classification: 'Paket Langganan', attributes: { Paket: 'Pro' } }, catalog),
        'Paket Langganan Pro 1 User harganya Rp50.000, sedangkan Pro 5 User Rp175.000. Selisihnya Rp125.000, Kak.',
    );
});

test('comparison resolves one new value against selected previous value', () => {
    const catalog = {
        version: 3 as const,
        schemes: [{
            id: 'character', name: 'Parfum Karakter', aliases: ['karakter'],
            variations: [{ id: 'quality', name: 'Kualitas', values: ['Platinum'] }, { id: 'size', name: 'Ukuran', values: ['30ml', '50ml'] }],
            options: [
                { values: { quality: 'Platinum', size: '30ml' }, price: 135_000 },
                { values: { quality: 'Platinum', size: '50ml' }, price: 180_000 },
            ],
        }],
    };
    assert.equal(
        buildDeterministicPriceReply('Kalau yang 30ml selisihnya berapa dari 50ml?', 'Platinum 50ml Rp180.000', { classification: 'Parfum Karakter', attributes: { Kualitas: 'Platinum', Ukuran: '50ml' } }, catalog),
        'Parfum Karakter Platinum 30ml harganya Rp135.000, sedangkan Platinum 50ml Rp180.000. Selisihnya Rp45.000, Kak.',
    );
});

test('partial ordinal variation lists every matching price option', () => {
    const catalog = {
        version: 3 as const,
        schemes: [{
            id: 'plan', name: 'Paket Layanan', aliases: ['paket'],
            variations: [{ id: 'tier', name: 'Tingkat', values: ['Pro'] }, { id: 'duration', name: 'Durasi', values: ['1 Bulan', '1 Tahun'] }],
            options: [
                { values: { tier: 'Pro', duration: '1 Bulan' }, price: 50_000 },
                { values: { tier: 'Pro', duration: '1 Tahun' }, price: 500_000 },
            ],
        }],
    };
    assert.equal(
        buildDeterministicPriceReply('Ada pilihan sama harga apa aja?', 'Yang kedua Pro.', { classification: 'Paket Layanan', attributes: { Tingkat: 'Pro' } }, catalog),
        'Paket Layanan Pro:\n\nPro 1 Bulan: Rp50.000\nPro 1 Tahun: Rp500.000\n\nKakak mau pilih yang mana?',
    );
});

test('ordinal product names survive natural recommendation lists outside price axes', () => {
    const history = ['Dua pilihan:\n\n1. Paket Hemat – cocok pemula.\n\n2. Paket Studio – cocok tim kreatif.'];
    assert.equal(inferOrdinalProductName('Yang kedua menarik, harganya berapa?', history), 'Paket Studio');
    assert.equal(inferOrdinalProductName('Yang terakhir saja', history), 'Paket Studio');
    assert.equal(inferOrdinalProductName('Yang kedua menarik', ['Pilihan: 1. Amber – lembut. 2. Warm Spicy – tegas.']), 'Warm Spicy');
});

test('state only changes from an explicit latest-turn selection, never from comparisons or descriptions', () => {
    const previous = { classification: 'Parfum Inspired', attributes: { Kualitas: 'EDP', Ukuran: '30ml' } };
    assert.equal(inferCatalogSelectionUpdateFromText('30ml sama 50ml beda berapa?', previous, fragrancePrices), null);
    assert.equal(inferCatalogSelectionUpdateFromText('EDT ringan, EDP kuat, Murni oily.', previous, fragrancePrices), null);
    assert.equal(inferCatalogSelectionUpdateFromText('EDP 30ml ready harga berapa?', previous, fragrancePrices), null);
    assert.equal(inferCatalogSelectionUpdateFromText('Kalau EDP 30ml berapa?', previous, fragrancePrices), null);
    assert.equal(inferCatalogSelectionUpdateFromText('Aku ambil EDP 30ml', previous, fragrancePrices)?.unitPrice, 39_500);
    assert.equal(inferCatalogSelectionUpdateFromText('Balik 30ml aja ya', { classification: 'Parfum Karakter', attributes: { 'Tingkat aroma': 'Platinum', Ukuran: '50ml' } }, fragrancePrices)?.unitPrice, undefined);
});


test('chat state merges checkout data without losing locked product and price', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const database = {
        query: async (sql: string, params: unknown[] = []) => {
            queries.push({ sql, params });
            if (sql.startsWith('SELECT data')) return { rows: [{ data: { productName: 'James Bond', quality: '2:1 / EDT', sizeMl: 30, productPrice: 33_000 } }], rowCount: 1 };
            return { rows: [], rowCount: 1 };
        },
    } as any;

    await setChatState('customer@s.whatsapp.net', 'checkout_data', { customerName: 'Fajar' }, database);
    const saved = JSON.parse(String(queries.at(-1)?.params[2]));
    assert.deepEqual(saved, { productName: 'James Bond', quality: '2:1 / EDT', sizeMl: 30, productPrice: 33_000, customerName: 'Fajar' });
});

test('Admin exposes structured product management and includes catalog in backup', async () => {
    const source = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');
    const agent = await readFile(new URL('../src/ai/agent.ts', import.meta.url), 'utf8');
    assert.match(source, /\['products', '\/admin\/products', 'Produk & Harga', 'products'\]/);
    assert.match(source, /app\.get\('\/admin\/products'/);
    assert.match(source, /app\.post\('\/admin\/products\/scheme'/);
    assert.match(source, /app\.post\('\/admin\/products\/scheme\/add'/);
    assert.match(source, /app\.post\('\/admin\/products\/scheme\/delete'/);
    assert.match(source, /data-add-scheme-panel/);
    assert.match(source, /Berat pengiriman \(gram\)/);
    assert.match(source, /data-add-axis/);
    assert.match(source, /buildVariationCombinations/);
    assert.match(source, /product-intro[\s\S]*?product-add[\s\S]*?product-page-actions/);
    assert.doesNotMatch(source, /<header class="product-scheme-head">/);
    assert.doesNotMatch(source, /data-open-add-scheme/);
    assert.match(source, /body\.admin-app > header/);
    assert.match(agent, /classification: \{ type: 'string'/);
    assert.match(agent, /checkShippingCost\(validatedArgs\.cityName, weightContext/);
    assert.doesNotMatch(source, /<h2>Daftar produk<\/h2>|action="\/admin\/products\/save"/);
    assert.match(source, /config\/product-catalog\.json/);
});
