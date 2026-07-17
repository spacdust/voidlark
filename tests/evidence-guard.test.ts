import assert from 'node:assert/strict';
import test from 'node:test';
import { findUnsupportedCatalogClaims } from '../src/ai/evidence-guard.js';

test('rejects roll-on when it is absent from evidence', () => {
    assert.deepEqual(findUnsupportedCatalogClaims('Mau spray atau roll on, Kak?', 'Ukuran tersedia 30ml, 50ml, dan 100ml.'), ['roll on', 'spray']);
});

test('accepts supported size and format claims', () => {
    assert.deepEqual(findUnsupportedCatalogClaims('Mau ukuran 30ml atau 50ml, Kak?', 'Ukuran tersedia 30ml, 50ml, dan 100ml.'), []);
});
