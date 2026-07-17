import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createBackupPayload, normalizeCustomerJid, parseBackupPayload, restoreBackupPayload } from '../src/admin/server.js';

test('customer maintenance input normalizes phone numbers and rejects lid identifiers', () => {
    assert.equal(normalizeCustomerJid('0812 3456-7890'), '6281234567890@s.whatsapp.net');
    assert.equal(normalizeCustomerJid('6281234567890'), '6281234567890@s.whatsapp.net');
    assert.equal(normalizeCustomerJid('6281234567890@s.whatsapp.net'), '6281234567890@s.whatsapp.net');
    assert.throws(() => normalizeCustomerJid('148953811128395@lid'), /@lid/);
    assert.throws(() => normalizeCustomerJid('148953811128395@lid:device'), /@lid/);
    assert.throws(() => normalizeCustomerJid('abc6281234567890@s.whatsapp.net'), /tidak valid/);
    assert.throws(() => normalizeCustomerJid('123'), /tidak valid/);
    assert.throws(() => normalizeCustomerJid('6281234567890@g.us'), /tidak didukung/);
});

test('config backup includes complete safe configuration and excludes credentials', () => {
    const previous = {
        AI_API_KEY: process.env.AI_API_KEY,
        DATABASE_URL: process.env.DATABASE_URL,
        ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
        AI_MODEL: process.env.AI_MODEL,
        LOG_LEVEL: process.env.LOG_LEVEL,
    };
    process.env.AI_API_KEY = 'secret-ai';
    process.env.DATABASE_URL = 'postgres://secret';
    process.env.ADMIN_PASSWORD = 'secret-admin';
    process.env.AI_MODEL = 'safe-model';
    process.env.LOG_LEVEL = 'warn';
    try {
        const payload = createBackupPayload();
        assert.equal(payload.version, 2);
        assert.ok('business.config.json' in payload.files);
        assert.ok('config/system-prompt.txt' in payload.files);
        assert.ok('prompt.builder.json' in payload.files);
        assert.equal(payload.operationalSettings?.AI_MODEL, 'safe-model');
        assert.equal(payload.operationalSettings?.LOG_LEVEL, 'warn');
        assert.equal(payload.operationalSettings?.SQLITE_PATH, process.env.SQLITE_PATH?.trim() || '');
        assert.equal('AI_API_KEY' in (payload.operationalSettings || {}), false);
        assert.equal('DATABASE_URL' in (payload.operationalSettings || {}), false);
        assert.equal('ADMIN_PASSWORD' in (payload.operationalSettings || {}), false);
        assert.ok(payload.knowledge.length > 0);
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});

test('backup parser fully validates v1/v2 content and canonical base64', () => {
    const base = { version: 2, createdAt: new Date().toISOString(), files: {}, knowledge: [] };
    assert.throws(() => parseBackupPayload(Buffer.from(JSON.stringify({ ...base, files: { 'business.config.json': 42 } }))), /isi file/i);
    assert.throws(() => parseBackupPayload(Buffer.from(JSON.stringify({ ...base, knowledge: [{ name: 'catalog.txt', contentBase64: '***' }] }))), /base64/i);
    assert.throws(() => parseBackupPayload(Buffer.from(JSON.stringify({ ...base, createdAt: 'not-a-date' }))), /tanggal/i);
    const v1 = parseBackupPayload(Buffer.from(JSON.stringify({ ...base, version: 1, files: { 'system_prompt.txt': 'legacy prompt' } })));
    assert.equal(v1.files['config/system-prompt.txt'], 'legacy prompt');
});

test('backup restore replaces knowledge, clears v2 allowlisted settings, and rolls back on activation failure', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'voidlark-portable-restore-'));
    await mkdir(path.join(root, 'config'), { recursive: true });
    await mkdir(path.join(root, 'knowledge_base'), { recursive: true });
    await writeFile(path.join(root, 'business.config.json'), '{"old":true}\n');
    await writeFile(path.join(root, 'config', 'system-prompt.txt'), 'old prompt');
    await writeFile(path.join(root, 'prompt.builder.json'), '{"old":true}\n');
    await writeFile(path.join(root, 'knowledge_base', 'old.txt'), 'old knowledge');
    await writeFile(path.join(root, '.env'), 'AI_MODEL=stale\nLOG_LEVEL=warn\nSECRET_KEY=preserved\n');

    const payload = parseBackupPayload(Buffer.from(JSON.stringify({
        version: 2,
        createdAt: new Date().toISOString(),
        files: {
            'business.config.json': '{"new":true}\n',
            'config/system-prompt.txt': 'new prompt',
            'prompt.builder.json': '{"new":true}\n',
        },
        knowledge: [{ name: 'new.txt', contentBase64: Buffer.from('new knowledge').toString('base64') }],
        operationalSettings: { AI_MODEL: 'new-model' },
    })));

    try {
        await assert.rejects(
            restoreBackupPayload(payload, { rootDirectory: root, activateKnowledge: async () => { throw new Error('activation failed'); } }),
            /activation failed/,
        );
        assert.equal(await readFile(path.join(root, 'business.config.json'), 'utf8'), '{"old":true}\n');
        assert.equal(await readFile(path.join(root, 'knowledge_base', 'old.txt'), 'utf8'), 'old knowledge');

        await restoreBackupPayload(payload, { rootDirectory: root, activateKnowledge: async () => undefined });
        assert.equal(await readFile(path.join(root, 'knowledge_base', 'new.txt'), 'utf8'), 'new knowledge');
        await assert.rejects(readFile(path.join(root, 'knowledge_base', 'old.txt'), 'utf8'));
        const env = await readFile(path.join(root, '.env'), 'utf8');
        assert.match(env, /AI_MODEL=new-model/);
        assert.match(env, /LOG_LEVEL=/);
        assert.match(env, /SECRET_KEY=preserved/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('backup parser rejects secret or unknown operational settings', () => {
    const base = { version: 2, createdAt: new Date().toISOString(), files: {}, knowledge: [] };
    assert.throws(
        () => parseBackupPayload(Buffer.from(JSON.stringify({ ...base, operationalSettings: { AI_API_KEY: 'secret' } }))),
        /tidak diizinkan/,
    );
    assert.doesNotThrow(
        () => parseBackupPayload(Buffer.from(JSON.stringify({ ...base, operationalSettings: { AI_MODEL: 'model', LOG_LEVEL: 'info' } }))),
    );
});

test('settings preserve connection intent and keep tests beside their controls', async () => {
    const source = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');
    assert.match(source, /data-connection-kind=/);
    assert.match(source, /name = 'connectionKind'/);
    assert.match(source, /req\.body\.connectionKind \|\| req\.body\.kind/);
    assert.match(source, /queueMicrotask\(\(\) => \{ submit\.disabled = true; \}\)/);
    assert.match(source, /key-editor-head[\s\S]*renderConnectionTest\(field\.key === 'TAVILY_API_KEY'/);
    assert.doesNotMatch(source, /group\.title === 'AI' \? renderConnectionTest/);
});

test('pipeline failures and retries live on the handoff page', async () => {
    const source = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');
    const settings = source.slice(source.indexOf("app.get('/admin/settings'"), source.indexOf("app.post('/admin/settings/env'"));
    const handoff = source.slice(source.indexOf("app.get('/admin/handoff'"), source.indexOf("app.post('/admin/handoff/assign'"));
    assert.doesNotMatch(settings, /pipeline-failures/);
    assert.match(handoff, /pipeline-failures/);
    assert.match(handoff, /retryInboundFailure|listInboundFailures/);
    assert.match(source, /href="\/admin\/handoff#pipeline-failures"/);
    assert.match(source, /redirectWithMsg\(res, '\/admin\/handoff#pipeline-failures'/);
});
