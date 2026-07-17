import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExternalSearchQuery, resolveProductDomain, supportsFragranceCatalogSchema } from '../src/ai/product-domain.js';

test('detects fragrance domain from business instructions', () => {
    assert.equal(resolveProductDomain('Semua aroma parfum tercatat di penggolongan notes.', ''), 'fragrance');
});

test('activates fragrance matcher only when its catalog schema exists', () => {
    assert.equal(supportsFragranceCatalogSchema([['No', 'Nama Item', 'karakter', 'Warna', 'Note']]), true);
    assert.equal(supportsFragranceCatalogSchema([['SKU', 'Nama Produk', 'Kategori', 'Harga']]), false);
});

test('keeps unrelated catalogs generic', () => {
    assert.equal(resolveProductDomain('Toko menjual paket Canva Pro dan aplikasi digital.', 'Canva Pro 1 bulan'), 'generic');
});

test('builds domain-specific external search query only for fragrance', () => {
    assert.equal(buildExternalSearchQuery('Monaco Royale', 'fragrance'), 'Monaco Royale perfume fragrance notes official');
    assert.equal(buildExternalSearchQuery('Canva Pro', 'generic'), 'Canva Pro product specifications official');
});
