import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DB_DRIVER = 'sqlite';

test('outbound intent projection is idempotent', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'voidlark-intent-'));
    const { createSqliteDatabase } = await import('../src/config/db.js');
    const { initSchema } = await import('../src/config/schema.js');
    const { projectOutboundIntents } = await import('../src/whatsapp/outbound-intent-worker.js');
    const database = createSqliteDatabase(path.join(root, 'test.db'));
    try {
        await initSchema(database);
        const order = await database.query("INSERT INTO orders (jid, status, product_name) VALUES ('6281@s.whatsapp.net', 'paid', 'Produk') RETURNING id");
        const id = Number(order.rows[0].id);
        await database.query("INSERT INTO outbound_intents (dedupe_key, jid, intent_type, payload) VALUES ($1, '6281@s.whatsapp.net', 'order.paid', $2::jsonb)", [`order:${id}:paid`, JSON.stringify({ orderId: id })]);
        assert.equal(await projectOutboundIntents(database), 1);
        assert.equal(await projectOutboundIntents(database), 0);
        assert.equal(Number((await database.query('SELECT COUNT(*) count FROM outbound_messages')).rows[0].count), 1);
        assert.ok((await database.query('SELECT processed_at FROM outbound_intents')).rows[0].processed_at);
    } finally {
        await database.end();
        await rm(root, { recursive: true, force: true });
    }
});
