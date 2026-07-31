import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCustomerReplyStyle } from '../src/ai/reply-style-boundary.js';

test('deterministic reply boundary applies configured salutation and no-emoji policy', () => {
    const result = applyCustomerReplyStyle('Baik, Kak. Kakak mau pilih yang mana? 😊', {
        salutation: 'Bunda', replyLength: 'detailed', sellingStyle: 'balanced', emojiLevel: 'none',
    });
    assert.equal(result, 'Baik, Bunda. Bunda mau pilih yang mana?');
    assert.doesNotMatch(result, /Kak|😊/);
});

test('selling style boundary follows configured soft and proactive modes', () => {
    const soft = applyCustomerReplyStyle('Bisa langsung checkout sekarang, Kak.', {
        salutation: 'Kak', replyLength: 'balanced', sellingStyle: 'soft', emojiLevel: 'light',
    });
    assert.match(soft, /lanjutkan pilihan/i);
    const proactive = applyCustomerReplyStyle('Pilihan ini harganya Rp35.000.', {
        salutation: 'Mas', replyLength: 'balanced', sellingStyle: 'proactive', emojiLevel: 'light',
    });
    assert.match(proactive, /Mas mau lanjut/i);
});

test('concise reply length keeps one statement and closing question', () => {
    const result = applyCustomerReplyStyle('Kalimat satu. Kalimat dua. Kalimat tiga. Kak mau pilih yang mana?', {
        salutation: 'Kak', replyLength: 'concise', sellingStyle: 'balanced', emojiLevel: 'light',
    });
    assert.equal(result, 'Kalimat satu.\n\nKak mau pilih yang mana?');
});

test('proactive style never appends a sales CTA to transactional replies', () => {
    const result = applyCustomerReplyStyle('Ringkasan pesanan #12. Subtotal Rp35.000. Menunggu pembayaran.', {
        salutation: 'Kak', replyLength: 'detailed', sellingStyle: 'proactive', emojiLevel: 'light',
    });
    assert.doesNotMatch(result, /mau lanjut/i);
});
