import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    buildConversationSearch,
    listConversationSummaries,
    renderTranscript,
} from '../src/admin/conversation-history.js';
import { createSqliteDatabase } from '../src/config/db.js';
import { initSchema } from '../src/config/schema.js';

test('conversation search normalizes local and international phone input without requiring JID', () => {
    assert.deepEqual(buildConversationSearch('0812-3456 7890'), {
        textPattern: '%0812-3456 7890%',
        digitPatterns: ['%081234567890%', '%6281234567890%'],
    });
    assert.deepEqual(buildConversationSearch('+62 812 3456 7890'), {
        textPattern: '%+62 812 3456 7890%',
        digitPatterns: ['%6281234567890%', '%081234567890%'],
    });
    assert.deepEqual(buildConversationSearch('6281234567890@s.whatsapp.net'), {
        textPattern: '%6281234567890@s.whatsapp.net%',
        digitPatterns: ['%6281234567890%', '%081234567890%'],
    });
});

test('conversation summary query joins lead metadata safely and remains parameterized', async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const database = {
        async query(sql: string, params?: unknown[]) {
            calls.push({ sql, params });
            return {
                rows: [{
                    jid: '6281234567890@s.whatsapp.net',
                    customer_name: 'Ayu',
                    lead_phone: '081234567890',
                    first_at: '2026-07-16T02:00:00.000Z',
                    last_at: '2026-07-17T03:30:00.000Z',
                    msg_count: 4,
                }],
                rowCount: 1,
            };
        },
    };

    const rows = await listConversationSummaries(database, "Ayu%' OR 1=1 --", 40);

    assert.equal(rows[0]?.customerName, 'Ayu');
    assert.equal(rows[0]?.phone, '081234567890');
    assert.equal(rows[0]?.messageCount, 4);
    assert.match(calls[0]!.sql, /LEFT JOIN leads/);
    assert.match(calls[0]!.sql, /MIN\(created_at\) AS first_at/);
    assert.match(calls[0]!.sql, /COUNT\(\*\) AS msg_count/);
    assert.match(calls[0]!.sql, /LIMIT \$\d+/);
    assert.doesNotMatch(calls[0]!.sql, /Ayu|1=1/);
    assert.ok(calls[0]!.params?.some((value) => String(value).includes("ayu%' or 1=1 --")));
});

test('normalized phone and customer name search return joined metadata from SQLite', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'voidlark-conversations-'));
    const database = createSqliteDatabase(path.join(directory, 'test.db'));
    try {
        await initSchema(database);
        await database.query(
            'INSERT INTO leads (jid, name, phone) VALUES ($1, $2, $3)',
            ['6281234567890@s.whatsapp.net', 'Ayu Lestari', '0812-3456-7890'],
        );
        await database.query(
            'INSERT INTO chat_history (jid, role, content, created_at) VALUES ($1, $2, $3, $4), ($1, $5, $6, $7)',
            ['6281234567890@s.whatsapp.net', 'user', 'Halo', '2026-07-16 02:00:00', 'assistant', 'Hai', '2026-07-17 03:30:00'],
        );

        const byLocalPhone = await listConversationSummaries(database, '0812 3456 7890');
        const byInternationalPhone = await listConversationSummaries(database, '+62-812-3456-7890');
        const byName = await listConversationSummaries(database, 'ayu lestari');

        for (const result of [byLocalPhone, byInternationalPhone, byName]) {
            assert.equal(result.length, 1);
            assert.equal(result[0]?.customerName, 'Ayu Lestari');
            assert.equal(result[0]?.phone, '0812-3456-7890');
            assert.equal(result[0]?.messageCount, 2);
            assert.equal(result[0]?.firstAt, '2026-07-16 02:00:00');
            assert.equal(result[0]?.lastAt, '2026-07-17 03:30:00');
        }
    } finally {
        await database.end();
        await rm(directory, { recursive: true, force: true });
    }
});

test('conversation summaries never expose @lid identifiers as customer phone', async () => {
    const rows = await listConversationSummaries({
        query: async () => ({ rows: [{ jid: '148953811128395@lid', customer_name: '', lead_phone: '148953811128395@lid', first_at: '', last_at: '', msg_count: 1 }], rowCount: 1 }),
    });
    assert.equal(rows[0]?.phone, '');
    assert.equal(rows[0]?.jid, '148953811128395@lid');
});

test('conversation query and transcript ordering use deterministic portable tie breakers', async () => {
    const calls: string[] = [];
    await listConversationSummaries({ query: async (sql) => { calls.push(sql); return { rows: [], rowCount: 0 }; } });
    assert.match(calls[0]!, /ORDER BY history\.last_at DESC, history\.last_id DESC/);

    const source = await readFile(new URL('../src/chat/history.ts', import.meta.url), 'utf8');
    assert.match(source, /ORDER BY created_at DESC, id DESC/);
});

test('transcript uses exact local HH.mm times and inserts separators at local day changes', () => {
    const html = renderTranscript([
        { id: 1, role: 'user', content: 'Malam', created_at: '2026-07-16T16:59:00.000Z' },
        { id: 2, role: 'assistant', content: 'Halo', created_at: '2026-07-16T17:01:00.000Z' },
        { id: 3, role: 'user', content: '<script>alert(1)</script>', created_at: '2026-07-17T03:05:00.000Z' },
    ], { timeZone: 'Asia/Jakarta' });

    assert.match(html, />23\.59</);
    assert.match(html, />00\.01</);
    assert.match(html, />10\.05</);
    assert.equal((html.match(/class="chat-date-separator"/g) || []).length, 2);
    assert.match(html, /17 Juli 2026/);
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
