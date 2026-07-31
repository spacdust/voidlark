import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCatalogFragranceDetailReply, buildCatalogFragranceRelationReply, buildExternalFragranceIntroductionReply, buildVerifiedExternalFragranceMatch, buildVerifiedFragranceConsultationReply, buildVerifiedFragranceRecommendation, extractAromaProfile, extractVerifiedFragranceReference, loadCatalogSchemaRows, matchCatalogCandidates, resolveCatalogFragranceProduct, selectFragranceBudgetOption, type CatalogAroma } from '../src/ai/catalog-matcher.js';

const catalog: CatalogAroma[] = [
    { inspired: 'Britney Radiance', character: 'The Way', family: 'floral' },
    { inspired: 'Azzaro Chrome', character: 'Zero Night', family: 'fresh' },
    { inspired: 'Tom Ford Oud Wood', character: 'Woodland', family: 'woody' },
    { inspired: 'Jo Malone English Pear', character: 'Bosa Nova', family: 'floral' },
];

test('extracts normalized notes and aroma families from web reference', () => {
    const profile = extractAromaProfile('Top notes pear, melon and green notes. Heart cedarwood. Base moss, caramel and musk. Floral fruity fragrance.');
    assert.deepEqual(profile.notes, ['pear', 'melon', 'green notes', 'cedarwood', 'moss', 'caramel', 'musk']);
    assert.deepEqual(profile.families, ['fresh', 'floral', 'woody', 'glamour']);
});

test('budget option follows usage need before choosing lowest price', () => {
    const options = [
        { option: { values: { quality: 'Embun', size: '30ml' }, price: 35_000, recommendationTags: ['kuliah', 'ringan'] } },
        { option: { values: { quality: 'Senja', size: '30ml' }, price: 60_000, recommendationTags: ['kondangan', 'malam'] } },
        { option: { values: { quality: 'Senja', size: '50ml' }, price: 75_000, recommendationTags: ['kondangan', 'malam'] } },
    ];
    assert.equal(selectFragranceBudgetOption(options, 'buat kondangan malam')?.option.price, 60_000);
    assert.equal(selectFragranceBudgetOption(options, 'buat kuliah yang ringan')?.option.price, 35_000);
    assert.equal(selectFragranceBudgetOption(options, 'yang fresh')?.option.price, 35_000);
});

test('budget recommendation follows configured tags instead of active product tier names', () => {
    const options = [
        { option: { values: { tier: 'Paket A' }, price: 10_000, recommendationTags: ['acara resmi'] } },
        { option: { values: { tier: 'Paket B' }, price: 20_000, recommendationTags: ['kerja santai'] } },
    ];
    assert.equal(selectFragranceBudgetOption(options, 'buat kerja santai')?.option.values.tier, 'Paket B');
    assert.equal(selectFragranceBudgetOption(options, 'tidak ada kebutuhan khusus')?.option.values.tier, 'Paket A');
});

test('ranks catalog candidates deterministically and preserves pair direction', () => {
    const result = matchCatalogCandidates({ notes: ['pear', 'melon', 'cedarwood'], families: ['fresh', 'woody'] }, catalog, 2);
    assert.deepEqual(result.map(({ inspired, character }) => [inspired, character]), [
        ['Azzaro Chrome', 'Zero Night'],
        ['Tom Ford Oud Wood', 'Woodland'],
    ]);
    assert.ok(result.every((candidate) => candidate.score > 0));
});

test('returns no recommendation without a supported family match', () => {
    assert.deepEqual(matchCatalogCandidates({ notes: ['salt'], families: ['marine'] }, catalog), []);
});

test('reads the existing catalog workbook first sheet into rows', async () => {
    const rows = await loadCatalogSchemaRows();
    assert.ok(rows.length > 1);
    assert.ok(rows.some((row) => row.map((cell) => String(cell).trim().toLowerCase()).includes('nama item')));
});

test('normal recommendations use verified internal names instead of invented family labels', async () => {
    const result = await buildVerifiedFragranceRecommendation('boleh yang paling aman satu aja', 'Cari wangi fresh citrus buat kuliah', 'Parfum Inspired');
    assert.ok(result?.productNames[0]);
    assert.equal(result?.classification, 'Parfum Inspired');
    assert.doesNotMatch(result?.text || '', /Fresh Citrus(?:\.|,|$)/);
    assert.doesNotMatch(result?.text || '', /terverifikasi|katalog internal/i);
    assert.match(result?.text || '', /paling dekat karena masuk keluarga/i);
    assert.doesNotMatch(result?.text || '', /karakter utamanya/i);
    assert.equal(await buildVerifiedFragranceRecommendation('berapa harganya?', 'fresh citrus', 'Parfum Inspired'), null);
    assert.ok(await buildVerifiedFragranceRecommendation('yang fresh tapi manis dikit', 'Ada rekomendasi buat ngantor. Yang fresh tapi manis dikit', 'Parfum Inspired'));
    const mixed = await buildVerifiedFragranceRecommendation('yang fresh tapi manis dikit', 'Ada rekomendasi buat ngantor. Yang fresh tapi manis dikit', 'Parfum Inspired');
    assert.match(mixed?.text || '', /Sisi fresh-nya paling jelas cocok/);
    assert.match(mixed?.text || '', /nuansa manis/);
    assert.match(mixed?.text || '', /referensi notes.*belum ditemukan/i);
    assert.doesNotMatch(mixed?.text || '', /nggak akan menebak|belum dirinci/i);
});

test('verified fragrance facts produce natural informative consultation replies', () => {
    const evidence = `KLAIM PRODUK TERVERIFIKASI:
- Parfum Inspired memiliki 1 note wangi dengan karakter aroma yang konsisten dari awal sampai akhir.
- Parfum Karakter memiliki 3 notes wangi sehingga profil aromanya lebih berlapis daripada Parfum Inspired.
- EDT pada Parfum Inspired memiliki konsentrasi 66% bibit dan merupakan konsentrasi paling rendah di antara EDT, EDP, dan Murni.
- EDP pada Parfum Inspired memiliki konsentrasi 75% bibit, lebih tinggi daripada EDT dan lebih rendah daripada Murni.
- Murni pada Parfum Inspired memiliki konsentrasi 100% bibit dan merupakan konsentrasi paling tinggi di antara EDT, EDP, dan Murni.`;
    const groups = buildVerifiedFragranceConsultationReply('Bedanya inspired sama karakter apa?', 'Bedanya inspired sama karakter apa?', evidence) || '';
    assert.match(groups, /1 note/);
    assert.match(groups, /3 notes/);
    assert.doesNotMatch(groups, /terverifikasi|katalog|evidence/i);

    const levels = buildVerifiedFragranceConsultationReply('EDT EDP sama Murni bedanya apa?', 'EDT EDP sama Murni bedanya apa?', evidence) || '';
    assert.match(levels, /EDT — 66%/);
    assert.match(levels, /EDP — 75%/);
    assert.match(levels, /Murni — 100%/);

    const office = buildVerifiedFragranceConsultationReply('Kalau buat ngantor enaknya mana?', 'Aku cari parfum buat ngantor', evidence) || '';
    assert.match(office, /Parfum Inspired level EDT/);
    assert.match(office, /66% bibit/);
    assert.match(buildVerifiedFragranceConsultationReply('buat kuliah, budget 70rb', 'buat kuliah', evidence) || '', /Parfum Inspired level EDT/);
    assert.equal(buildVerifiedFragranceConsultationReply('Aku suka fresh tapi manis dikit. Ada rekomendasi?', 'Buat ngantor', evidence), null);
    assert.match(buildVerifiedFragranceConsultationReply('parfume buat cwo yg wanginya kalem', '', evidence) || '', /kebutuhan pemakaiannya/i);
    assert.match(buildVerifiedFragranceConsultationReply('ada parfum cowok murah nggak?', '', evidence) || '', /Budget maksimalnya berapa/i);
    assert.match(buildVerifiedFragranceConsultationReply('Terlalu manis, bikin eneg', '', evidence) || '', /kita hindari dulu/i);
    assert.equal(buildVerifiedFragranceConsultationReply('Maunya yang bisa dipakai berdua, elegan buat malam', '', evidence), null);
});

test('consultation repeats changed Knowledge semantics instead of inferring meaning from note count', () => {
    const evidence = `KLAIM PRODUK TERVERIFIKASI:
- Parfum Inspired memiliki 1 note tetapi berkembang bertahap saat dipakai.
- Parfum Karakter memiliki 3 notes namun diarahkan tetap linear.`;
    const reply = buildVerifiedFragranceConsultationReply('Inspired sama Karakter bedanya apa?', '', evidence) || '';
    assert.match(reply, /1 note tetapi berkembang bertahap/i);
    assert.match(reply, /3 notes namun diarahkan tetap linear/i);
    assert.doesNotMatch(reply, /konsisten dari awal sampai akhir|lebih berlapis daripada/i);
});

test('fragrance consultation reads group names and levels from active Products & Prices data', () => {
    const customCatalog = {
        version: 3 as const,
        schemes: [
            {
                id: 'blend-asli', name: 'Blend Asli', aliases: ['asli'], domainRole: 'reference' as const,
                variations: [{ id: 'tier', name: 'Tingkat', values: ['Ringan 2:1', 'Pekat 4:1'] }],
                options: [
                    { values: { tier: 'Ringan 2:1' }, price: 40_000 },
                    { values: { tier: 'Pekat 4:1' }, price: 90_000 },
                ],
            },
            {
                id: 'blend-racikan', name: 'Blend Racikan', aliases: ['racikan'], domainRole: 'modified' as const,
                variations: [{ id: 'tier', name: 'Tingkat', values: ['Eksklusif'] }],
                options: [{ values: { tier: 'Eksklusif' }, price: 120_000 }],
            },
        ],
    };
    const evidence = `KLAIM PRODUK TERVERIFIKASI:
- Blend Asli memiliki 1 note dengan karakter konsisten.
- Blend Racikan memiliki 3 notes sehingga aromanya berlapis.
- Ringan 2:1 memiliki konsentrasi 60% bibit.
- Pekat 4:1 memiliki konsentrasi 80% bibit.`;
    const groups = buildVerifiedFragranceConsultationReply('asli sama racikan bedanya apa?', '', evidence, customCatalog) || '';
    assert.match(groups, /Blend Asli memiliki 1 note/);
    assert.match(groups, /Blend Racikan memiliki 3 notes/);
    const levels = buildVerifiedFragranceConsultationReply('Ringan 2:1 sama Pekat 4:1 bedanya apa?', '', evidence, customCatalog) || '';
    assert.match(levels, /Ringan 2:1 — 60%/);
    assert.match(levels, /Pekat 4:1 — 80%/);
    assert.doesNotMatch(levels, /EDT|EDP|Murni/);
});

test('customer-facing recommendations translate internal family labels', async () => {
    const result = await buildVerifiedFragranceRecommendation('kasih dua pilihan', 'Cari aroma elegan buat malam, kasih dua pilihan', 'Parfum Karakter');
    assert.equal(result?.productNames.length, 2);
    assert.match(result?.text || '', /keluarga elegan/i);
    assert.doesNotMatch(result?.text || '', /keluarga glamour/i);
});

test('two-product recommendations explain verified notes for each choice', async () => {
    const result = await buildVerifiedFragranceRecommendation(
        'kasih dua pilihan',
        'Cari aroma elegan buat malam, kasih dua pilihan',
        'Parfum Inspired',
        async (inspiredName) => ({
            source: 'test',
            content: `REFERENSI EKSTERNAL
1. ${inspiredName} perfume
   ${inspiredName} is a fragrance. Top notes are Vanilla and Rose; base notes are Musk and Amber.
   https://example.com/${encodeURIComponent(inspiredName)}`,
        }),
    );
    assert.equal(result?.productNames.length, 2);
    assert.equal((result?.text.match(/dengan arah notes/g) || []).length, 2);
});

test('recommendation without a selected group defaults consistently to Inspired', async () => {
    const result = await buildVerifiedFragranceRecommendation(
        'yang manis lembut apa?',
        'Cari parfum yang manis lembut',
        '',
        async (inspiredName) => ({
            source: 'test',
            content: `REFERENSI EKSTERNAL
1. ${inspiredName} perfume
   ${inspiredName} is a fragrance. Top notes are Vanilla and Rose; base notes are Musk and Amber.
   https://example.com/${encodeURIComponent(inspiredName)}`,
        }),
    );
    assert.equal(result?.classification, 'Parfum Inspired');
    assert.match(result?.text || '', /dari Parfum Inspired/i);
    assert.match(result?.text || '', /Arah parfum aslinya memuat/i);
    assert.doesNotMatch(result?.text || '', /versi Karakter|dari Parfum Karakter/i);
});

test('recommendation rejects external references that conflict with requested audience', async () => {
    const lookedUp: string[] = [];
    const result = await buildVerifiedFragranceRecommendation(
        'parfum cewek yang manis lembut apa?',
        'Cari parfum cewek yang manis lembut',
        'Parfum Inspired',
        async (inspiredName) => {
            lookedUp.push(inspiredName);
            const forMen = inspiredName === 'Axe Anarki';
            if (inspiredName === 'Alisya Ashley') return { source: 'test', content: 'REFERENSI EKSTERNAL: hasil ambigu.' };
            return {
                source: 'test',
                content: `REFERENSI EKSTERNAL
1. ${inspiredName} perfume
   ${inspiredName} is a fragrance ${forMen ? 'for men' : 'for women'}. Top notes are Vanilla and Rose; base notes are Musk and Amber.
   https://example.com/${encodeURIComponent(inspiredName)}`,
            };
        },
    );
    assert.ok(lookedUp.length < 12);
    assert.notEqual(result?.productNames[0], 'Axe Anarki');
});

test('calm usage wording does not require an invented soft-note fact', async () => {
    const lookedUp: string[] = [];
    const result = await buildVerifiedFragranceRecommendation(
        'yang fresh aja, pilih satu',
        'Cari parfum cowok yang kalem buat kuliah. Budget 70 ribu, yang fresh aja',
        'Parfum Inspired',
        async (inspiredName) => {
            lookedUp.push(inspiredName);
            return {
                source: 'test',
                content: `REFERENSI EKSTERNAL
1. ${inspiredName} perfume for women and men
   ${inspiredName} is a fragrance for women and men. Top note is Water Lily; base note is Musk.
   https://example.com/${encodeURIComponent(inspiredName)}`,
            };
        },
    );
    assert.ok(result?.productNames[0]);
    assert.ok(lookedUp.length < 12);
    assert.match(result?.text || '', /teratai air|musk/i);
});

test('shared-use recommendation rejects a reference labeled for only one audience', async () => {
    const result = await buildVerifiedFragranceRecommendation(
        'kasih dua pilihan',
        'Cari kado yang dipakai berdua, elegan buat malam. Kasih dua pilihan',
        'Parfum Inspired',
        async (inspiredName) => ({
            source: 'test',
            content: `REFERENSI EKSTERNAL
1. ${inspiredName} perfume
   ${inspiredName} is a fragrance ${inspiredName === 'Axe Anarki' ? 'for men' : 'for women and men'}. Top notes are Rose and Saffron; base notes are Musk and Amber.
   https://example.com/${encodeURIComponent(inspiredName)}`,
        }),
    );
    assert.equal(result?.productNames.length, 2);
    assert.ok(!result?.references.some((reference) => reference.inspiredName === 'Axe Anarki'));
});

test('catalog-note lookup accepts matching perfume notes and rejects celebrity ambiguity', () => {
    const valid = `REFERENSI EKSTERNAL (bukan stok/harga toko) untuk: "Britney Fantasy perfume fragrance notes"
1. Fantasy Britney Spears perfume - a fragrance for women 2005
   Fantasy by Britney Spears is a Floral Fruity Gourmand fragrance. Top notes are Kiwi, Red Litchi and Quince; middle notes are White Chocolate, Orchid and Jasmine; base notes are Musk.
   https://example.com/fantasy`;
    const parsed = extractVerifiedFragranceReference('Britney Fantasy', valid);
    assert.ok(parsed);
    assert.match(parsed?.notes.join(', ') || '', /kiwi/i);
    assert.ok(parsed?.families.includes('fresh'));
    assert.ok(parsed?.families.includes('glamour'));

    const ambiguous = `REFERENSI EKSTERNAL
1. Angelina Jolie's Favorite Perfume Is The Spiced Fruit Scent
   Angelina Jolie's favorite perfume is Histoires de Parfums 1969. Top notes are Peach and Rose.
   https://example.com/celebrity`;
    assert.equal(extractVerifiedFragranceReference('Angelina jolie', ambiguous), null);
});

test('character recommendation looks up the Inspired pair and describes it only as a reference', async () => {
    const lookedUp: string[] = [];
    const result = await buildVerifiedFragranceRecommendation(
        'kasih satu rekomendasi',
        'Cari aroma fresh manis buat malam, kasih satu rekomendasi',
        'Parfum Karakter',
        async (inspiredName) => {
            lookedUp.push(inspiredName);
            return {
                source: 'test',
                content: `REFERENSI EKSTERNAL
1. ${inspiredName} perfume fragrance
   ${inspiredName} is a fresh fruity gourmand fragrance. Top notes are Bergamot and Kiwi; base notes are Vanilla and Musk.
   https://example.com/${encodeURIComponent(inspiredName)}`,
            };
        },
    );
    assert.equal(lookedUp[0], 'Angelina jolie');
    assert.match(result?.text || '', /memakai Angelina jolie sebagai acuan/i);
    assert.match(result?.text || '', /bergamot|kiwi|vanila/i);
    assert.match(result?.text || '', /versi Parfum Karakter dapat dimodifikasi/i);
    assert.doesNotMatch(result?.text || '', /belum dirinci|nggak akan menebak/i);
    assert.deepEqual(result?.lookupSources, ['test']);
});

test('catalog detail maps a Character name back to its Inspired lookup identity', async () => {
    const lookedUp: string[] = [];
    const lookup = async (inspiredName: string) => {
        lookedUp.push(inspiredName);
        return {
            source: 'test',
            content: `REFERENSI EKSTERNAL
1. ${inspiredName} Eau de Parfum
   ${inspiredName} is a fragrance. Top notes are Jasmine and Lavender; base notes are Musk, Amber and Sandalwood.
   https://example.com/${encodeURIComponent(inspiredName)}`,
        };
    };
    const character = await buildCatalogFragranceDetailReply('notes Agolie apa?', 'Parfum Karakter', lookup);
    assert.equal(lookedUp[0], 'Angelina jolie');
    assert.match(character?.text || '', /Agolie dikembangkan dari profil Angelina jolie/i);
    assert.match(character?.text || '', /tidak (?:harus identik|persis sama)/i);

    lookedUp.length = 0;
    const inspired = await buildCatalogFragranceDetailReply('Angelina jolie wanginya gimana?', 'Parfum Inspired', lookup);
    assert.equal(lookedUp[0], 'Angelina jolie');
    assert.match(inspired?.text || '', /Angelina jolie punya beberapa notes utama/i);
    assert.doesNotMatch(inspired?.text || '', /tidak harus identik/i);
});

test('generic designer result is rejected when it does not identify one catalog perfume', () => {
    const designer = `REFERENSI EKSTERNAL
1. Ariana Grande Perfume Ranking and Review
   God Is A Woman is a fruity scent. Top notes are Ambrette and Pear; base notes are Vanilla and Cedarwood.
   https://example.com/ranking`;
    assert.equal(extractVerifiedFragranceReference('Ariana Grande', designer), null);
});

test('catalog typos may match a clear phonetic perfume identity and feature list', () => {
    const reference = `REFERENSI EKSTERNAL
1. Axe Anarchy For Him Eau de Toilette
   Axe Anarchy is a fragrance for men. The fragrance features Blueberry, Lavender, Pomegranate, Sandalwood and White Amber.
   https://example.com/axe-anarchy`;
    const parsed = extractVerifiedFragranceReference('Axe Anarki', reference);
    assert.ok(parsed);
    assert.match(parsed?.notes.join(', ') || '', /blueberry/i);
    assert.match(parsed?.notes.join(', ') || '', /lavender/i);
    assert.match(parsed?.notes.join(', ') || '', /white amber/i);
});

test('catalog-note lookup prefers concrete structured notes over generic accords', () => {
    const reference = `REFERENSI EKSTERNAL
1. Axe Anarchy fragrance discussion
   Axe Anarchy perfume lists the notes as fresh and fruity notes and sweet woods.
   https://example.com/discussion
2. Anarchy For Him AXE cologne
   The fragrance features Blueberry, Lavender, Pomegranate, Sandalwood and White Amber.
   https://example.com/product`;
    const parsed = extractVerifiedFragranceReference('Axe Anarki', reference);
    assert.equal(parsed?.url, 'https://example.com/product');
    assert.match(parsed?.notes.join(', ') || '', /blueberry/i);
});

test('catalog-note lookup removes notes contained inside a more specific note', () => {
    const reference = `REFERENSI EKSTERNAL
1. Axe Anarchy fragrance for men
   The fragrance features Blueberry, White Amber and Sandalwood.
   https://example.com/axe-anarchy`;
    const parsed = extractVerifiedFragranceReference('Axe Anarki', reference);
    assert.ok(parsed?.notes.includes('white amber'));
    assert.ok(!parsed?.notes.includes('amber'));
});

test('catalog-note lookup requires one matching hit to satisfy shared-use audience', () => {
    const reference = `REFERENSI EKSTERNAL
1. Oceanus fragrance notes
   Top notes are Water Lily and Bergamot; base notes are Musk.
   https://example.com/oceanus-notes
2. Oceanus The Body Shop perfume for women and men
   Oceanus is an aquatic fragrance. Notes include Water Lily, Jasmine and Musk.
   https://example.com/oceanus-audience`;
    const parsed = extractVerifiedFragranceReference('Bodyshop Oceanus', reference, { audiences: ['women', 'men'] });
    assert.deepEqual(parsed?.audiences, ['women', 'men']);
    assert.equal(parsed?.url, 'https://example.com/oceanus-audience');
});

test('catalog-note lookup does not combine women and men evidence from different flankers', () => {
    const reference = `REFERENSI EKSTERNAL
1. Benetton Blue perfume for women
   Top notes are Bergamot and Lemon; base note is Musk.
   https://example.com/blue-women
2. Benetton Man Blue perfume for men
   Top notes are Tequila and Birch; base note is Vetiver.
   https://example.com/blue-men`;
    assert.equal(extractVerifiedFragranceReference('Beneton Blue', reference, { audiences: ['women', 'men'] }), null);
});

test('catalog-note lookup does not satisfy a gender request from unlabeled evidence', () => {
    const reference = `REFERENSI EKSTERNAL
1. Secret Wish perfume review
   The first notes are fresh and juicy: lemon, melon and peach.
   https://example.com/secret-wish-review
2. Secret Wish Anna Sui perfume for women
   Top notes are Lemon and Melon; base note is Musk.
   https://example.com/secret-wish-women`;
    assert.equal(extractVerifiedFragranceReference('Annasui secret wish', reference, { audiences: ['men'] }), null);
});

test('catalog-note parser removes prose attached to note sections', () => {
    const reference = `REFERENSI EKSTERNAL
1. Colors De Benetton Blue For Women Perfume
   The top notes of bergamot, lemon, and grapefruit are invigorating and refreshing, while the middle notes of jasmine, rose, and oakmoss are sensual and inviting.
   https://example.com/benetton-blue`;
    const parsed = extractVerifiedFragranceReference('Beneton Blue', reference);
    assert.deepEqual(parsed?.notes, ['bergamot', 'lemon', 'grapefruit', 'jasmine', 'rose', 'oakmoss']);
    assert.doesNotMatch(parsed?.notes.join(', ') || '', /invigorating|sensual|while|\bof\b/i);
});

test('catalog-note parser rejects a note truncated by provider snippet limit', () => {
    const reference = `REFERENSI EKSTERNAL
1. Bodyshop Oceanus perfume for women and men
   Top note is Water Lily; middle notes are Lily-of-
   https://example.com/oceanus`;
    const parsed = extractVerifiedFragranceReference('Bodyshop Oceanus', reference, { audiences: ['men'] });
    assert.deepEqual(parsed?.notes, ['water lily']);
});

test('catalog detail keeps Character context when its Inspired web reference is unavailable', async () => {
    const result = await buildCatalogFragranceDetailReply('Kalau Axbomba notes-nya apa kak?', 'Parfum Karakter', async (inspiredName) => ({
        source: 'test',
        content: `REFERENSI EKSTERNAL untuk ${inspiredName}: hasil tidak cukup jelas.`,
    }));
    assert.match(result?.text || '', /Axbomba dikembangkan dari profil Axe Anarki/i);
    assert.match(result?.text || '', /belum ditemukan/i);
    assert.doesNotMatch(result?.text || '', /rekomendasi yang paling mirip/i);
});

test('family audience words and negative sweet preference affect recommendation requirements', async () => {
    const lookedUp: string[] = [];
    const result = await buildVerifiedFragranceRecommendation(
        'boleh kasih dua pilihan?',
        'Cari hadiah buat ayah. Woody kalem, jangan manis.',
        'Parfum Inspired',
        async (inspiredName) => {
            lookedUp.push(inspiredName);
            const women = /woman|girl/i.test(inspiredName);
            return {
                source: 'test',
                content: `REFERENSI EKSTERNAL\n1. ${inspiredName} perfume for ${women ? 'women' : 'men'}\n   ${inspiredName} is a woody fragrance for ${women ? 'women' : 'men'}. Top notes are Cedarwood and Vetiver; base note is Musk.\n   https://example.com/${encodeURIComponent(inspiredName)}`,
            };
        },
    );
    assert.ok(lookedUp.length);
    assert.ok(result?.references.every((reference) => reference.audiences.includes('men')));
    assert.doesNotMatch(result?.text || '', /BLV Woman/i);
});

test('catalog relation resolver maps either side without hardcoded product names', async () => {
    const character = await resolveCatalogFragranceProduct('lihat versi Karakter pasangannya Angelina jolie', 'Parfum Inspired');
    assert.equal(character?.productName, 'Agolie');
    const reply = await buildCatalogFragranceRelationReply('nama aslinya apa?', 'Axbomba', 'Parfum Karakter');
    assert.match(reply?.text || '', /Axe Anarki.*parfum acuan/i);
    assert.equal(reply?.classification, 'Parfum Inspired');
});

test('external fragrance match requires verified note overlap instead of name-token coincidence', async () => {
    const external = `REFERENSI EKSTERNAL\n1. Outside Fire fragrance\n   Outside Fire is a fresh woody fragrance. Base notes are Vanilla and Chestnut.\n   https://example.com/outside`;
    const matched = await buildVerifiedExternalFragranceMatch('Outside Fire', external, async (inspiredName) => ({
        source: 'test',
        content: `REFERENSI EKSTERNAL\n1. ${inspiredName} perfume fragrance\n   ${inspiredName} is a fragrance. Base notes are Vanilla and Musk.\n   https://example.com/${encodeURIComponent(inspiredName)}`,
    }), 'boleh kasih beberapa rekomendasi');
    assert.ok(matched?.productNames.length);
    assert.match(matched?.text || '', /Paling mendekati.*notes vanila/is);
    assert.doesNotMatch(matched?.text || '', /overlap|kandidat|terverifikasi/i);
});

test('external fragrance introduction explains verified notes before offering recommendations', () => {
    const external = `REFERENSI EKSTERNAL\n1. Outside Fire fragrance\n   Outside Fire is a woody sweet fragrance. Base notes are Vanilla and Chestnut.\n   https://example.com/outside`;
    const reply = buildExternalFragranceIntroductionReply('Outside Fire', external) || '';
    assert.match(reply, /belum ada di katalog/i);
    assert.match(reply, /vanila.*kastanye/i);
    assert.match(reply, /hingga tiga parfum/i);
    assert.match(reply, /Mau aku carikan\?$/i);
});

test('external closest request returns several evidenced options until customer asks for one', async () => {
    const external = `REFERENSI EKSTERNAL\n1. Outside Fire fragrance\n   Outside Fire is a woody sweet fragrance. Base notes are Vanilla and Chestnut.\n   https://example.com/outside`;
    const many = await buildVerifiedExternalFragranceMatch('Outside Fire', external, async (inspiredName) => ({
        source: 'test',
        content: `REFERENSI EKSTERNAL\n1. ${inspiredName} perfume fragrance\n   ${inspiredName} is a fragrance. Base notes are Vanilla and Musk.\n   https://example.com/${encodeURIComponent(inspiredName)}`,
    }), 'yang paling dekat apa?');
    assert.ok((many?.productNames.length || 0) >= 2);
    assert.equal(many?.productName, undefined);
    assert.match(many?.text || '', /1\..*2\./s);

    const one = await buildVerifiedExternalFragranceMatch('Outside Fire', external, async (inspiredName) => ({
        source: 'test',
        content: `REFERENSI EKSTERNAL\n1. ${inspiredName} perfume fragrance\n   ${inspiredName} is a fragrance. Base notes are Vanilla and Musk.\n   https://example.com/${encodeURIComponent(inspiredName)}`,
    }), 'aku pengin satu pilihan aja');
    assert.ok(one?.productName);
    assert.equal(one?.productNames.length, 1);
});

test('external match may use verified family evidence only for secondary tier alternatives', async () => {
    const external = `REFERENSI EKSTERNAL\n1. Outside Fire fragrance\n   Outside Fire is a woody sweet fragrance. Base notes are Vanilla and Chestnut.\n   https://example.com/outside`;
    let index = 0;
    const result = await buildVerifiedExternalFragranceMatch('Outside Fire', external, async (inspiredName) => {
        index += 1;
        return index === 1
            ? { source: 'test', content: `REFERENSI EKSTERNAL\n1. ${inspiredName} perfume fragrance\n   ${inspiredName} is a sweet fragrance. Base notes are Vanilla and Musk.\n   https://example.com/one` }
            : { source: 'test', content: `REFERENSI EKSTERNAL\n1. ${inspiredName} perfume fragrance\n   ${inspiredName} is a woody fragrance. Base notes are Cedarwood and Vetiver.\n   https://example.com/${index}` };
    }, 'boleh kasih beberapa rekomendasi');
    assert.ok((result?.productNames.length || 0) >= 2);
    assert.match(result?.text || '', /1\..*kesamaan pada notes vanila/is);
    assert.match(result?.text || '', /2\..*Alternatif yang lebih woody.*Sisi woody/is);
});

test('external secondary tiers use distinct verified aroma angles when available', async () => {
    const external = `REFERENSI EKSTERNAL\n1. Outside Fire fragrance\n   Outside Fire is a fresh sweet woody fragrance. Base notes are Vanilla and Chestnut.\n   https://example.com/outside`;
    let index = 0;
    const result = await buildVerifiedExternalFragranceMatch('Outside Fire', external, async (inspiredName) => {
        index += 1;
        if (index === 1) return { source: 'test', content: `REFERENSI EKSTERNAL\n1. ${inspiredName} perfume fragrance\n   ${inspiredName} is a sweet fragrance. Base notes are Vanilla and Musk.\n   https://example.com/one` };
        if (index === 2) return { source: 'test', content: `REFERENSI EKSTERNAL\n1. ${inspiredName} perfume fragrance\n   ${inspiredName} is a fresh floral fragrance. Base notes are Lemon and Jasmine.\n   https://example.com/two` };
        return { source: 'test', content: `REFERENSI EKSTERNAL\n1. ${inspiredName} perfume fragrance\n   ${inspiredName} is a fresh sweet fragrance. Base notes are Kiwi and Chocolate.\n   https://example.com/${index}` };
    }, 'boleh kasih beberapa rekomendasi');
    const labels = [...(result?.text || '').matchAll(/Alternatif yang lebih (\w+)/gi)].map((match) => match[1]);
    assert.equal(new Set(labels).size, labels.length);
});

test('catalog detail keeps comparison note visible in a natural follow-up', async () => {
    const reply = await buildCatalogFragranceDetailReply(
        'Squad Girl aromanya gimana?',
        'Parfum Karakter',
        async (inspiredName) => ({
            source: 'test',
            content: `REFERENSI EKSTERNAL\n1. ${inspiredName} perfume fragrance\n   ${inspiredName} is a fresh fragrance. Top notes are Lemon, Apricot, Peach, Plum, Jasmine, Ylang-Ylang, Orange Blossom and Vanilla.\n   https://example.com/${encodeURIComponent(inspiredName)}`,
        }),
        'Kesamaan paling jelas ada pada notes vanila.',
    );
    assert.match(reply?.text || '', /notes utama[^.]*vanila/i);
    assert.match(reply?.text || '', /tidak persis sama dengan Body Shop Vanila/i);
    assert.doesNotMatch(reply?.text || '', /parfum acuannya/i);
});
