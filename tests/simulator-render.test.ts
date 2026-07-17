import assert from 'node:assert/strict';
import test from 'node:test';

test('rendered simulator browser script has valid JavaScript syntax offline', async () => {
    process.env.DB_DRIVER = 'sqlite';
    const { renderSandboxPage } = await import('../src/admin/server.js');
    const html = renderSandboxPage();
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
    assert.ok(scripts.length >= 2);
    for (const script of scripts) assert.doesNotThrow(() => new Function(script));
});
