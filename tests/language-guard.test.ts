import assert from 'node:assert/strict';
import test from 'node:test';
import { containsUnexpectedCjk, sanitizeCustomerLanguage } from '../src/ai/language-guard.js';

test('detects unexpected Chinese characters', () => {
    assert.equal(containsUnexpectedCjk('Sebelum aku推荐, Kakak suka apa?'), true);
});

test('removes isolated Chinese fragments without damaging Indonesian text', () => {
    assert.equal(sanitizeCustomerLanguage('Sebelum aku推荐, Kakak suka apa?'), 'Sebelum aku, Kakak suka apa?');
});
