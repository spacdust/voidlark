import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExternalLookupFallback } from '../src/ai/external-fallback.js';

test('keeps external lookup facts in safe fallback', () => {
    const result = buildExternalLookupFallback('Monaco Royale', 'REFERENSI EKSTERNAL\nSumber: tavily\n1. Result\nFresh pear, melon, cedarwood, caramel, and musk.\nhttps://example.com', 'Aromatique');
    assert.match(result, /pear, melon, cedarwood/i);
    assert.match(result, /belum mau menebak/i);
});

test('keeps generic product facts and uses configured business name', () => {
    const result = buildExternalLookupFallback('Canva Pro', 'REFERENSI EKSTERNAL\nSumber: tavily\nCanva Pro includes premium templates, brand kits, and background remover.\nhttps://example.com', 'Digital Hub');
    assert.match(result, /premium templates/i);
    assert.match(result, /katalog Digital Hub/i);
    assert.doesNotMatch(result, /Aromatique|aroma|parfum/i);
});
