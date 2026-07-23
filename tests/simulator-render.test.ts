import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('rendered simulator browser script has valid JavaScript syntax offline', async () => {
    process.env.DB_DRIVER = 'sqlite';
    const { renderSandboxPage } = await import('../src/admin/server.js');
    const html = renderSandboxPage();
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    assert.ok(scripts.length >= 2);
    for (const script of scripts) assert.doesNotThrow(() => new Function(script));
});

test('simulator header keeps copy in flexible column after coordinate is hidden', async () => {
    const source = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');
    assert.match(source, /\.coordinate \{ display: none; \}/);
    assert.match(source, /\.simulator-page-head \{ grid-template-columns: minmax\(0, 1fr\) auto; \}/);
    assert.match(source, /\.simulator-page-head \{ grid-template-columns: 1fr; gap: 12px; align-items: start; \}/);
    assert.match(source, /\.simulator-contact \{ grid-column: 1;/);
});
