import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveExternalLookupQuery } from '../src/ai/lookup-routing.js';

test('routes explicit unknown-product comparison to external lookup', () => {
    assert.equal(resolveExternalLookupQuery('Ada yg mirip Mykonos Monaco Royale?', []), 'Mykonos Monaco Royale');
});

test('resolves referential follow-up from recent user history', () => {
    assert.equal(resolveExternalLookupQuery('Kalo bisa yang paling mirip aja kak', [
        { role: 'user', content: 'Ada yg mirip Mykonos Monaco Royale?' },
        { role: 'assistant', content: 'Aku cek dulu ya, Kak.' },
    ]), 'Mykonos Monaco Royale');
});

test('does not route generic recommendation request', () => {
    assert.equal(resolveExternalLookupQuery('Aku mau rekomendasi parfum fresh', []), null);
});

test('routes a naturally named outside product before comparison follow-up', () => {
    assert.equal(resolveExternalLookupQuery('Kak aku lagi suka Maison Margiela By the Fireplace, di sini ada nggak?', []), 'Maison Margiela By the Fireplace');
    assert.equal(resolveExternalLookupQuery('Kalau nggak ada, yang paling mirip apa?', [
        { role: 'user', content: 'Kak aku lagi suka Maison Margiela By the Fireplace, di sini ada nggak?' },
    ]), 'Maison Margiela By the Fireplace');
});

test('affirmative reply continues an offered external comparison', () => {
    assert.equal(resolveExternalLookupQuery('boleh kak', [
        { role: 'user', content: 'Aku lagi suka Outside Fire, di sini ada?' },
        { role: 'assistant', content: 'Kalau Kakak mau, aku bisa pilihkan 2–3 parfum yang paling mendekati Outside Fire. Mau aku carikan?' },
    ]), 'Outside Fire');
    assert.equal(resolveExternalLookupQuery('aku pengin satu pilihan aja', [
        { role: 'user', content: 'Aku lagi suka Outside Fire, di sini ada?' },
        { role: 'assistant', content: 'Ada tiga rekomendasi yang mendekati.' },
    ]), 'Outside Fire');
});
