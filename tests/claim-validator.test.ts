import assert from 'node:assert/strict';
import test from 'node:test';
import { validateClaims } from '../src/ai/claim-validator.js';

test('rejects unsupported price, stock, warranty, and product format claims', () => {
    const result = validateClaims('Laptop Nova harganya Rp9.999.000, ready stock, garansi 2 tahun dan tersedia versi roll on.', 'Laptop Nova RAM 16GB.');
    assert.deepEqual(result.unsupportedTypes, ['price', 'stock', 'warranty', 'format']);
});

test('rejects unsupported digital, fashion, and electronics claims', () => {
    const result = validateClaims(
        'Akun Canva lisensi pro durasi 1 tahun, ukuran XL bahan katun combed, RAM 16GB Storage 512GB.',
        'Akun Canva lisensi personal durasi 1 bulan, ukuran M bahan polyester, RAM 8GB Storage 256GB.'
    );
    assert.ok(result.unsupportedTypes.includes('duration'));
    assert.ok(result.unsupportedTypes.includes('license'));
    assert.ok(result.unsupportedTypes.includes('size'));
    assert.ok(result.unsupportedTypes.includes('material'));
    assert.ok(result.unsupportedTypes.includes('spec'));
});

test('accepts factual claims found in evidence across domains', () => {
    const evidence = 'Laptop Nova. Harga Rp9.999.000. Stok tersedia. Garansi Resmi 2 tahun. RAM 16GB Storage 512GB. Ukuran L bahan katun. Lisensi pro durasi 1 tahun.';
    const answer = 'Laptop Nova harganya Rp9.999.000, stok tersedia, garansi resmi 2 tahun, RAM 16GB Storage 512GB, ukuran L bahan katun, lisensi pro durasi 1 tahun.';
    const result = validateClaims(answer, evidence);
    assert.deepEqual(result.unsupportedTypes, []);
});

test('does not confuse conversational language with factual claims', () => {
    const result = validateClaims('Kakak lebih suka yang ringan atau performanya tinggi?', 'Laptop Nova RAM 16GB.');
    assert.deepEqual(result.unsupportedTypes, []);
});
