import assert from 'node:assert/strict';
import test from 'node:test';
import { formatWhatsAppReply } from '../src/ai/whatsapp-format.js';

test('moves closing question out of final numbered item', () => {
    const input = '1. Parfum Karakter — hangat dan elegan.\n\n2. Parfum Inspired — lebih ringan dan ekonomis. Kakak tertarik coba yang mana? Aku bisa bantu detailkan varian dan harganya.';
    const output = formatWhatsAppReply(input);

    assert.equal(output, '1. Parfum Karakter — hangat dan elegan.\n\n2. Parfum Inspired — lebih ringan dan ekonomis.\n\nKakak tertarik coba yang mana? Aku bisa bantu detailkan varian dan harganya.');
});

test('does not alter a numbered item without a closing question', () => {
    const input = '2. Green — aroma dedaunan, natural, dan bersih.';
    assert.equal(formatWhatsAppReply(input), input);
});

test('moves a closing CTA containing two questions out of final item', () => {
    const input = '2. Woody – aroma kayu yang hangat, kokoh, elegan. Lebih maskulin tapi tetap cocok dipakai wanita. Mau aku jelasin lebih detail dulu, atau langsung lihat pilihan varian dan harganya?';
    assert.equal(
        formatWhatsAppReply(input),
        '2. Woody – aroma kayu yang hangat, kokoh, elegan. Lebih maskulin tapi tetap cocok dipakai wanita.\n\nMau aku jelasin lebih detail dulu, atau langsung lihat pilihan varian dan harganya?',
    );
});

test('repairs a rupiah amount split across lines', () => {
    assert.equal(
        formatWhatsAppReply('Harga satuannya Rp45.\n\n000. Totalnya Rp135.000.'),
        'Harga satuannya Rp45.000. Totalnya Rp135.000.',
    );
});

test('turns inline size and price options into vertical lines', () => {
    const input = 'Harga Parfum Karakter: Super Premium 30ml - Rp120.000 (200g) 50ml - Rp160.000 (300g) 100ml - Rp310.000 (450g) Platinum 30ml: Rp135.000 (200g) 50ml: Rp180.000 (300g) 100ml: Rp360.000 (450g) Kakak mau yang mana?';
    const output = formatWhatsAppReply(input);

    assert.equal(output, [
        'Harga Parfum Karakter: Super Premium',
        '30ml - Rp120.000 (200g)',
        '50ml - Rp160.000 (300g)',
        '100ml - Rp310.000 (450g)',
        'Platinum',
        '30ml: Rp135.000 (200g)',
        '50ml: Rp180.000 (300g)',
        '100ml: Rp360.000 (450g)',
        'Kakak mau yang mana?',
    ].join('\n'));
});

test('does not split a single size and price mentioned in prose', () => {
    const input = 'Untuk ukuran 50ml - Rp75.000 per botol, Kak.';
    assert.equal(formatWhatsAppReply(input), input);
});

test('removes forbidden strip bullets and separates prices without punctuation', () => {
    const input = '- Super Premium 30ml Rp120.000\n- Super Premium 50ml Rp160.000';
    assert.equal(formatWhatsAppReply(input), 'Super Premium 30ml Rp120.000\nSuper Premium 50ml Rp160.000');
});

test('removes contradictory missing-aroma disclaimer before a recommendation', () => {
    const input = 'Maaf Kak, belum ada daftar aroma lengkap di sistem. Tapi dari referensi yang ada, EA Blue Emotion cocok untuk aroma fresh-manis.';
    assert.equal(formatWhatsAppReply(input), 'Dari referensi yang ada, EA Blue Emotion cocok untuk aroma fresh-manis.');
});

test('keeps one size per variation on one readable line', () => {
    assert.equal(
        formatWhatsAppReply('EDT 30ml: Rp35.000\nEDP 30ml: Rp60.000\nMurni 30ml: Rp120.000'),
        'EDT 30ml: Rp35.000\nEDP 30ml: Rp60.000\nMurni 30ml: Rp120.000',
    );
});

test('does not detach variation label from an already vertical price list', () => {
    const input = 'Parfum Inspired — ukuran terkecil 30ml:\n\nEDT 30ml: Rp35.000\nEDP 30ml: Rp60.000\nMurni 30ml: Rp120.000\n\nKakak tertarik kualitas yang mana?';
    assert.equal(formatWhatsAppReply(input), input);
});

test('separates adjacent variation labels after unsupported text is removed', () => {
    assert.equal(
        formatWhatsAppReply('EDT — ringan\nEDP — Murni — paling kuat'),
        'EDT — ringan\nEDP\nMurni — paling kuat',
    );
});

test('removes orphan punctuation lines from generated price lists', () => {
    assert.equal(formatWhatsAppReply('30ml Rp35.000\n,\n50ml Rp45.000\n;\n100ml Rp55.000'), '30ml Rp35.000\n50ml Rp45.000\n100ml Rp55.000');
});

test('turns an orphan example fragment into a complete customer question', () => {
    assert.equal(
        formatWhatsAppReply('Senang bisa bantu.\n\n Misalnya, lebih suka yang fresh atau woody?'),
        'Senang bisa bantu.\n\nKakak lebih suka yang fresh atau woody?',
    );
    assert.equal(
        formatWhatsAppReply('Maaf parfumnya kurang cocok.\n\n Misalnya terlalu kuat, terlalu ringan, atau kurang sesuai? Biar aku bantu.\n\nSaya bantu cariin alternatif.'),
        'Maaf parfumnya kurang cocok.\n\nYang kurang cocok itu terlalu kuat, terlalu ringan, atau kurang sesuai? Biar aku bantu.\n\nAku bantu carikan alternatif.',
    );
    assert.equal(
        formatWhatsAppReply('Aku bisa bantu rekomendasi. Misalnya floral, fresh, atau woody?'),
        'Aku bisa bantu rekomendasi. Kakak lebih suka floral, fresh, atau woody?',
    );
});
