import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { isInternalRepairText } from '../src/ai/agent.js';

test('internal claim-repair instructions cannot become customer replies', () => {
    assert.equal(isInternalRepairText('Hapus klaim harga. Tidak ada bukti harga di katalog.'), true);
    assert.equal(isInternalRepairText('Koreksi klaim tanpa bukti berikut: price.'), true);
    assert.equal(isInternalRepairText('Maaf Kak, harga produk itu belum tercantum di katalog.'), false);
    assert.equal(isInternalRepairText('Customer belum minta harga. Belum pilih variasi. Hapus daftar harga.'), true);
    assert.equal(isInternalRepairText('Maaf, saya tidak bisa memproses permintaan ini karena balasan awal tidak disertakan. Silakan kirimkan balasan CS yang ingin diperbaiki.'), true);
});

test('claim-guard rewrites pass through the final customer sanitizer', async () => {
    const source = await readFile(new URL('../src/ai/agent.ts', import.meta.url), 'utf8');
    const guardedReturns = [...source.matchAll(/const guarded(?:Text)? = await enforceCatalogEvidence[\s\S]{0,260}?return \{ text: ([^,}]+)/g)].map((match) => match[1].trim());
    assert.ok(guardedReturns.length >= 6);
    assert.ok(guardedReturns.every((value) => value === 'sanitizeAgentText(guarded)' || value === 'finalText'));
});
