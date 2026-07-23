import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile } from 'node:fs/promises';

test('canonical project documentation uses docs and root changelog', async () => {
    await Promise.all([
        access('CHANGELOG.md'),
        access('docs/PRD.md'),
        access('docs/ROADMAP.md'),
        access('docs/operations.md'),
    ]);
    const files = ['README.md', 'CHANGELOG.md', 'docs/PRD.md', 'docs/ROADMAP.md', 'docs/operations.md'];
    const content = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');
    assert.doesNotMatch(content, /\.project[\\/]|NEXTPLAN\.md|nextplan\.md/);
    const operations = await readFile('docs/operations.md', 'utf8');
    for (const marker of ['/health/live', '/health/ready', '/metrics', 'npm run db:backup', 'qr/generate', 'dead_letter']) {
        assert.match(operations, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    const roadmap = await readFile('docs/ROADMAP.md', 'utf8');
    for (const marker of ['Sprint 1 — Production gate', 'Sprint 2 — Reliability', 'Sprint 3 — Security hardening', 'Launch gates']) {
        assert.match(roadmap, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
});
