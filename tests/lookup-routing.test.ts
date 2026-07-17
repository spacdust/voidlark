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
