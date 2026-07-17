import assert from 'node:assert/strict';
import test from 'node:test';
import { selectDomainMatcher } from '../src/ai/domain-matchers.js';

test('selects fragrance plugin only for fragrance domain with matching schema', () => {
    const matcher = selectDomainMatcher('fragrance', [['Nama Item', 'karakter', 'Note']]);
    assert.equal(matcher.id, 'fragrance');
});

test('falls back to generic plugin when fragrance schema is absent', () => {
    const matcher = selectDomainMatcher('fragrance', [['SKU', 'Nama Produk', 'Harga']]);
    assert.equal(matcher.id, 'generic');
});

test('generic plugin returns domain-neutral evidence contract', async () => {
    const matcher = selectDomainMatcher('generic', []);
    const result = await matcher.match('Canva Pro includes premium templates and brand kits.');
    assert.equal(result.profileEvidence, 'Gunakan spesifikasi produk dari referensi web terverifikasi.');
    assert.equal(result.candidateEvidence, 'Gunakan hanya produk dan atribut yang ditemukan pada Knowledge relevan.');
    assert.doesNotMatch(result.policy, /parfum|aroma|inspired|karakter/i);
});
