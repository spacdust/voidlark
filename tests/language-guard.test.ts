import assert from 'node:assert/strict';
import test from 'node:test';
import { containsUnexpectedCjk, sanitizeCustomerLanguage } from '../src/ai/language-guard.js';

test('detects unexpected Chinese characters', () => {
    assert.equal(containsUnexpectedCjk('Sebelum aku推荐, Kakak suka apa?'), true);
});

test('preserves intentional WhatsApp line breaks while normalizing spaces', () => {
    assert.equal(
        sanitizeCustomerLanguage('Pilihan:\n\nEDT 30ml: Rp35.000\nEDP 30ml: Rp60.000   \n\nMau yang mana?'),
        'Pilihan:\n\nEDT 30ml: Rp35.000\nEDP 30ml: Rp60.000\n\nMau yang mana?',
    );
});

test('repairs common UTF-8 mojibake in customer-facing fragrance names', () => {
    assert.equal(sanitizeCustomerLanguage('gaÃ¯ac wood â€” fresh'), 'gaïac wood — fresh');
});

test('removes isolated Chinese fragments without damaging Indonesian text', () => {
    assert.equal(sanitizeCustomerLanguage('Sebelum aku推荐, Kakak suka apa?'), 'Sebelum aku, Kakak suka apa?');
});
