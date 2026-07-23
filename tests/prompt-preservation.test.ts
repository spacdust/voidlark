import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('viewing prompt page cannot overwrite the active system prompt', async () => {
    const source = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');
    const routeStart = source.indexOf("app.get('/admin/prompt'");
    const routeEnd = source.indexOf("app.post('/admin/prompt/builder'", routeStart);
    assert.ok(routeStart > 0 && routeEnd > routeStart);
    const getRoute = source.slice(routeStart, routeEnd);
    assert.doesNotMatch(getRoute, /writeFileSync\(PROMPT_PATH/);
    assert.match(getRoute, /readFileSync\(PROMPT_PATH/);
});

test('active prompt changes only through explicit prompt builder save', async () => {
    const source = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');
    const writes = [...source.matchAll(/writeFileSync\(PROMPT_PATH/g)];
    assert.equal(writes.length, 1);
    const builderRoute = source.indexOf("app.post('/admin/prompt/builder'");
    assert.ok(writes[0].index! > builderRoute);
});

test('active prompt uses the dedicated config path', async () => {
    const source = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');
    assert.match(source, /path\.resolve\('config', 'system-prompt\.txt'\)/);
    const prompt = await readFile(new URL('../config/system-prompt.txt', import.meta.url), 'utf8');
    assert.match(prompt, /KONTEKS BISNIS/);
});

test('simple reply preferences preserve intelligence policy fields', async () => {
    const source = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');
    for (const field of ['replyLength', 'sellingStyle', 'salutation', 'emojiLevel']) {
        assert.match(source, new RegExp(`name="${field}"`));
    }
    assert.match(source, /promptPreferenceRules/);
    assert.match(source, /Pengaturan bahasa lanjutan/);
    for (const policy of ['identityRules', 'consultationRules', 'productRules', 'checkoutRules', 'shippingRules', 'escalationRules', 'formattingRules']) {
        assert.match(source, new RegExp(`name="${policy}"`));
        assert.match(source, new RegExp(`DEFAULT_PROMPT_BUILDER\\.${policy}`));
    }
    assert.match(source, /buildSystemPrompt\(builder/);
    assert.match(source, /promptPreferenceRules\(builder\)/);
});
