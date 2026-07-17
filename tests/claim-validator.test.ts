import assert from 'node:assert/strict';
import test from 'node:test';
import { validateClaims } from '../src/ai/claim-validator.js';

test('rejects unsupported price, stock, warranty, and product format claims', () => {
    const result = validateClaims('Laptop Nova harganya Rp9.999.000, ready stock, garansi 2 tahun dan tersedia versi roll on.', 'Laptop Nova RAM 16GB.');
    assert.deepEqual(result.unsupportedTypes, ['price', 'stock', 'warranty', 'format']);
});

test('accepts factual claims found in evidence', () => {
    const evidence = 'Laptop Nova. Harga Rp9.999.000. Stok tersedia. Garansi 2 tahun. RAM 16GB.';
    const result = validateClaims('Laptop Nova harganya Rp9.999.000, stok tersedia, garansi 2 tahun, RAM 16GB.', evidence);
    assert.deepEqual(result.unsupportedTypes, []);
});

test('does not confuse conversational language with factual claims', () => {
    const result = validateClaims('Kakak lebih suka yang ringan atau performanya tinggi?', 'Laptop Nova RAM 16GB.');
    assert.deepEqual(result.unsupportedTypes, []);
});
