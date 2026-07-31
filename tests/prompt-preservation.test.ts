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

test('active prompt stays synchronized after prompt builder or business config saves', async () => {
    const source = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');
    const writes = [...source.matchAll(/writeFileSync\(PROMPT_PATH/g)];
    assert.equal(writes.length, 3);
    const configRoute = source.indexOf("app.post('/admin/config'");
    const rawConfigRoute = source.indexOf("app.post('/admin/config/raw'");
    const builderRoute = source.indexOf("app.post('/admin/prompt/builder'");
    assert.ok(writes.some((write) => write.index! > configRoute && write.index! < rawConfigRoute));
    assert.ok(writes.some((write) => write.index! > rawConfigRoute && write.index! < builderRoute));
    assert.ok(writes.some((write) => write.index! > builderRoute));
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
    for (const policy of ['identityRules', 'consultationRules', 'checkoutRules', 'escalationRules', 'formattingRules']) {
        assert.match(source, new RegExp(`name="${policy}"`));
        assert.match(source, new RegExp(`DEFAULT_PROMPT_BUILDER\\.${policy}`));
    }
    for (const protectedPolicy of ['productRules', 'shippingRules']) {
        assert.doesNotMatch(source, new RegExp(`name="${protectedPolicy}"`));
        assert.match(source, new RegExp(`${protectedPolicy}: DEFAULT_PROMPT_BUILDER\\.${protectedPolicy}`));
    }
    assert.match(source, /buildSystemPrompt\(builder/);
    assert.match(source, /promptPreferenceRules\(builder\)/);
});

test('AI prompt cleanup sends CSRF and handles non-JSON failures safely', async () => {
    const source = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');
    const assistStart = source.indexOf("fetch('/admin/prompt/assist'");
    const assistEnd = source.indexOf('renderPromptValidator();', assistStart);
    const assist = source.slice(assistStart, assistEnd);
    assert.match(assist, /'X-CSRF-Token': csrfToken/);
    assert.match(assist, /const raw = await response\.text\(\)/);
    assert.match(assist, /JSON\.parse\(raw\)/);
    assert.doesNotMatch(assist, /response\.json\(\)/);
    assert.match(source, /res\.status\(403\)\.json\(\{ error: 'Sesi keamanan berubah/);
});

test('AI prompt cleanup reveals and labels changed fields', async () => {
    const source = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');
    assert.match(source, /prompt-ai-changed/);
    assert.match(source, /prompt-ai-section-badge/);
    assert.match(source, /details\.open = true/);
    assert.match(source, /prefers-reduced-motion: reduce/);
    assert.match(source, /scrollIntoView\(\{ behavior: scrollBehavior, block: 'center' \}\)/);
    assert.match(source, /changedFields \+ ' bagian diperbarui/);
});

test('AI prompt cleanup only edits user-dirty fields and preserves intelligence terms', async () => {
    const source = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');
    assert.match(source, /promptAiDirtyFields/);
    assert.match(source, /_aiFields: \[\.\.\.promptAiDirtyFields\]/);
    assert.match(source, /Tidak ada teks baru untuk dirapikan/);
    assert.match(source, /PROMPT_PROTECTED_TERMS/);
    assert.match(source, /validatePromptEdit\(field, chunk, cleaned\)/);
    assert.match(source, /terlalu banyak menghapus isi/);
});

test('saved prompt builder and active prompt contain no AI transport artifacts', async () => {
    const builder = await readFile(new URL('../prompt.builder.json', import.meta.url), 'utf8');
    const prompt = await readFile(new URL('../config/system-prompt.txt', import.meta.url), 'utf8');
    for (const content of [builder, prompt]) {
        assert.doesNotMatch(content, /<<ccr:/i);
        assert.doesNotMatch(content, /â†’/);
        assert.doesNotMatch(content, /\*\*productRules\*\*/i);
        assert.doesNotMatch(content, /Field:\s*(?:productRules|shippingRules|escalationRules)/i);
    }
    for (const term of ['CUSTOMER STATE', 'simpanDraftPesanan', 'lookup external', 'cekOngkir']) {
        assert.match(prompt, new RegExp(term));
    }
});

test('WhatsApp formatting rules reject tables and isolate closing question', async () => {
    const builder = await readFile(new URL('../prompt.builder.json', import.meta.url), 'utf8');
    const prompt = await readFile(new URL('../config/system-prompt.txt', import.meta.url), 'utf8');
    const source = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');
    for (const content of [builder, prompt, source]) {
        assert.match(content, /Jangan gunakan tabel Markdown/);
        assert.match(content, /daftar vertikal/);
        assert.match(content, /Pertanyaan penutup wajib menjadi paragraf tersendiri/);
    }
});

test('AI prompt cleanup edits free text per field and rejects cache references', async () => {
    const source = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');
    assert.match(source, /isCompletionCacheReference/);
    assert.match(source, /\^<<ccr:\[\^>\]\+>>\$/);
    assert.match(source, /stream: true/);
    assert.match(source, /PROMPT_AI_TEXT_FIELDS/);
    assert.match(source, /splitPromptField/);
    assert.match(source, /const fields = PROMPT_AI_TEXT_FIELDS\.filter/);
    assert.match(source, /for \(const field of fields\)/);
    assert.match(source, /requestCompletion\(field, chunk, randomBytes\(8\)\.toString\('hex'\)\)/);
    assert.match(source, /Gateway AI tidak mengirim isi lengkap untuk \$\{field\}/);
    assert.doesNotMatch(source, /Wajib memiliki semua key berikut tepat satu kali/);
});
