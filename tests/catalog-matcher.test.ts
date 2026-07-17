import assert from 'node:assert/strict';
import test from 'node:test';
import { extractAromaProfile, loadCatalogSchemaRows, matchCatalogCandidates, type CatalogAroma } from '../src/ai/catalog-matcher.js';

const catalog: CatalogAroma[] = [
    { inspired: 'Britney Radiance', character: 'The Way', family: 'floral' },
    { inspired: 'Azzaro Chrome', character: 'Zero Night', family: 'fresh' },
    { inspired: 'Tom Ford Oud Wood', character: 'Woodland', family: 'woody' },
    { inspired: 'Jo Malone English Pear', character: 'Bosa Nova', family: 'floral' },
];

test('extracts normalized notes and aroma families from web reference', () => {
    const profile = extractAromaProfile('Top notes pear, melon and green notes. Heart cedarwood. Base moss, caramel and musk. Floral fruity fragrance.');
    assert.deepEqual(profile.notes, ['pear', 'melon', 'green notes', 'cedarwood', 'moss', 'caramel', 'musk']);
    assert.deepEqual(profile.families, ['fresh', 'floral', 'woody', 'glamour']);
});

test('ranks catalog candidates deterministically and preserves pair direction', () => {
    const result = matchCatalogCandidates({ notes: ['pear', 'melon', 'cedarwood'], families: ['fresh', 'woody'] }, catalog, 2);
    assert.deepEqual(result.map(({ inspired, character }) => [inspired, character]), [
        ['Jo Malone English Pear', 'Bosa Nova'],
        ['Azzaro Chrome', 'Zero Night'],
    ]);
    assert.ok(result.every((candidate) => candidate.score > 0));
});

test('returns no recommendation without a supported family match', () => {
    assert.deepEqual(matchCatalogCandidates({ notes: ['salt'], families: ['marine'] }, catalog), []);
});

test('reads the existing catalog workbook first sheet into rows', async () => {
    const rows = await loadCatalogSchemaRows();
    assert.ok(rows.length > 1);
    assert.ok(rows.some((row) => row.map((cell) => String(cell).trim().toLowerCase()).includes('nama item')));
});
