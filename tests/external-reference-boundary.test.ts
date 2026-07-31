import assert from 'node:assert/strict';
import test from 'node:test';

import { containsExternalProductCommerceClaim, containsUnverifiedExternalRecommendation } from '../src/ai/agent.js';

test('external product may be explained but cannot be sold as store inventory', () => {
    assert.equal(containsExternalProductCommerceClaim(
        'Monaco Royale memiliki profil fresh fruity dengan sentuhan woody.',
        'Mykonos Monaco Royale',
    ), false);
    assert.equal(containsExternalProductCommerceClaim(
        'Untuk Mykonos ukuran 30ml kualitas EDP harganya Rp60.000, Kak.',
        'Mykonos Monaco Royale',
    ), true);
    assert.equal(containsExternalProductCommerceClaim(
        'Kami punya Monaco Royale. Mau ambil satu?',
        'Mykonos Monaco Royale',
    ), true);
    assert.equal(containsExternalProductCommerceClaim(
        'Produk internal yang paling mendekati adalah Secret Garden.',
        'Mykonos Monaco Royale',
    ), false);
});

test('external lookup recommendations must name a verified internal candidate', () => {
    const evidence = '1. Referensi pencocokan, bukan produk toko: Brand Luar | Produk internal yang boleh direkomendasikan dan dijual: Secret Garden | Keluarga terverifikasi: fresh';
    assert.equal(containsUnverifiedExternalRecommendation('Produk internal paling mendekati adalah Secret Garden.', evidence), false);
    assert.equal(containsUnverifiedExternalRecommendation('Di toko kami ada versi inspired bernama Exotic Escape.', evidence), true);
    assert.equal(containsUnverifiedExternalRecommendation('Produk luar itu punya profil fresh dan woody.', evidence), false);
    assert.equal(containsUnverifiedExternalRecommendation('Alternatif internal belum ditemukan.', 'Tidak ada kandidat katalog yang melewati pencocokan terverifikasi.'), true);
    assert.equal(containsUnverifiedExternalRecommendation('Qardashi. Hangat dan manis. Tersedia EDT, EDP, Murni.', 'Tidak ada kandidat katalog yang melewati pencocokan terverifikasi.'), true);
});
