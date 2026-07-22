import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveProductDomain, buildExternalSearchQuery } from '../src/ai/product-domain.js';
import { selectDomainMatcher } from '../src/ai/domain-matchers.js';

test('resolveProductDomain detects domains correctly from instructions & knowledge', () => {
    assert.equal(resolveProductDomain('Kami menjual parfum inspired aroma vanilla', 'Notes: Rose, Vanilla'), 'fragrance');
    assert.equal(resolveProductDomain('Jual lisensi akun Canva Pro murah', 'Masa aktif 1 tahun, garansi replace'), 'digital');
    assert.equal(resolveProductDomain('Jual Kaos Oversized bahan Katun Combed 30s', 'Size Chart: M (LD 52cm), L (LD 56cm)'), 'fashion');
    assert.equal(resolveProductDomain('Toko Laptop & HP garansi resmi', 'Spesifikasi Tech: RAM 16GB, SSD 512GB'), 'electronics');
    assert.equal(resolveProductDomain('Toko Serba Ada', 'Produk umum tanpa kategori khusus'), 'generic');
});

test('buildExternalSearchQuery tailors query keywords to active domain', () => {
    assert.ok(buildExternalSearchQuery('Sauvage', 'fragrance').includes('perfume fragrance notes'));
    assert.ok(buildExternalSearchQuery('Spotify', 'digital').includes('digital subscription license'));
    assert.ok(buildExternalSearchQuery('T-Shirt', 'fashion').includes('size chart material'));
    assert.ok(buildExternalSearchQuery('MacBook Air', 'electronics').includes('full specifications warranty'));
});

test('selectDomainMatcher selects proper matcher implementation per domain', async () => {
    const digitalMatcher = selectDomainMatcher('digital', []);
    assert.equal(digitalMatcher.id, 'digital');

    const result = await digitalMatcher.match('Paket Spotify Premium Family berlangganan 12 bulan garansi 1 tahun.');
    assert.ok(result.profileEvidence.includes('Durasi Paket:'));
    assert.ok(result.policy.includes('Jangan menjanjikan garansi masa aktif'));

    const fashionMatcher = selectDomainMatcher('fashion', []);
    assert.equal(fashionMatcher.id, 'fashion');

    const fashionResult = await fashionMatcher.match('Kaos Oversized Katun Combed 30s ukuran L dan XL.');
    assert.ok(fashionResult.profileEvidence.includes('Ukuran Terdeteksi: L, XL'));
    assert.ok(fashionResult.profileEvidence.includes('Katun, Combed'));

    const electronicsMatcher = selectDomainMatcher('electronics', []);
    assert.equal(electronicsMatcher.id, 'electronics');

    const techResult = await electronicsMatcher.match('Laptop Asus RAM 16GB SSD 512GB Garansi Resmi 2 Tahun.');
    assert.ok(techResult.profileEvidence.toLowerCase().includes('16gb'));
    assert.ok(techResult.profileEvidence.toLowerCase().includes('512gb'));
    assert.ok(techResult.profileEvidence.includes('Garansi Resmi 2 Tahun'));
});
