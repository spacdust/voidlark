import assert from 'node:assert/strict';
import test from 'node:test';
import { isInternalRepairText } from '../src/ai/agent.js';

test('internal claim-repair instructions cannot become customer replies', () => {
    assert.equal(isInternalRepairText('Hapus klaim harga. Tidak ada bukti harga di katalog.'), true);
    assert.equal(isInternalRepairText('Koreksi klaim tanpa bukti berikut: price.'), true);
    assert.equal(isInternalRepairText('Maaf Kak, harga produk itu belum tercantum di katalog.'), false);
});
