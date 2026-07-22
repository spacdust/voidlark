import assert from 'node:assert/strict';
import test from 'node:test';
import { retrieveFromChunks, type RetrievalChunk } from '../src/ai/knowledge-retrieval.js';

const mockChunks: RetrievalChunk[] = [
    {
        id: 1,
        documentId: 101,
        fileName: 'Katalog_Parfum_2026.xlsx',
        chunkIndex: 0,
        content: 'Produk A-101 Vanilla Musk. Aroma manis lembut vanila dengan sentuhan kayu manis. Tahan hingga 12 jam.',
    },
    {
        id: 2,
        documentId: 101,
        fileName: 'Katalog_Parfum_2026.xlsx',
        chunkIndex: 1,
        content: 'Produk B-202 Citrus Fresh. Aroma wewangian buah jeruk segar dan floral. Cocok untuk penggunaan siang hari.',
    },
    {
        id: 3,
        documentId: 102,
        fileName: 'FAQ_Layanan.pdf',
        chunkIndex: 0,
        content: 'Kebijakan Pengiriman dan Garansi Retur 7 Hari. Pengiriman menggunakan JNE dan JNT.',
    },
];

test('retrieveFromChunks finds exact BM25 keyword matches and builds citations', () => {
    const result = retrieveFromChunks(mockChunks, 'B-202 Citrus Fresh', { limit: 5 });
    assert.ok(result.evidence.length > 0);
    assert.equal(result.evidence[0].citation.fileName, 'Katalog_Parfum_2026.xlsx');
    assert.equal(result.evidence[0].citation.chunkIndex, 1);
    assert.ok(result.citations.some((c) => c.documentId === 101));
});

test('retrieveFromChunks finds semantic n-gram overlap for informal phrasing', () => {
    const result = retrieveFromChunks(mockChunks, 'wewangian buah manis segar', { limit: 5 });
    assert.ok(result.evidence.length > 0);
    // Should rank Citrus Fresh or Vanilla Musk chunks high
    assert.ok(result.citations.length >= 1);
    assert.ok(typeof result.citations[0].relevancePercent === 'number');
    assert.ok(result.citations[0].relevancePercent > 0);
});

test('retrieveFromChunks respects maxChars and limit bounds', () => {
    const result = retrieveFromChunks(mockChunks, 'aroma vanilla pengiriman garansi', { maxChars: 150, limit: 1 });
    assert.equal(result.evidence.length, 1);
    assert.ok(result.text.length <= 180);
});
