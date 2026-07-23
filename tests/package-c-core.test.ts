import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DB_DRIVER = 'sqlite';

const setup = async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'voidlark-package-c-'));
    const { createSqliteDatabase } = await import('../src/config/db.js');
    const { initSchema } = await import('../src/config/schema.js');
    const database = createSqliteDatabase(path.join(directory, 'test.db'));
    await initSchema(database);
    return { directory, database, initSchema };
};

test('migrations are idempotent and reject checksum drift', async () => {
    const { directory, database, initSchema } = await setup();
    try {
        await initSchema(database);
        const applied = await database.query('SELECT * FROM schema_migrations ORDER BY version');
        assert.deepEqual(applied.rows.map((row) => Number(row.version)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
        await database.query("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1");
        await assert.rejects(initSchema(database), /checksum mismatch/);
    } finally {
        await database.end();
        await rm(directory, { recursive: true, force: true });
    }
});

test('order state machine rejects invalid transitions', async () => {
    const { assertOrderTransition, InvalidOrderTransitionError } = await import('../src/chat/orders.js');
    assert.doesNotThrow(() => assertOrderTransition('draft', 'awaiting_payment'));
    assert.throws(() => assertOrderTransition('paid', 'draft'), InvalidOrderTransitionError);
    assert.throws(() => assertOrderTransition('completed', 'paid'), InvalidOrderTransitionError);
});

test('database transaction rolls back all writes', async () => {
    const { directory, database } = await setup();
    try {
        await assert.rejects(database.transaction(async (transaction) => {
            await transaction.query("INSERT INTO orders (jid, product_name) VALUES ('rollback@test', 'Test')");
            await transaction.query("INSERT INTO audit_events (event_type, aggregate_type, aggregate_id, data) VALUES ('test', 'order', '1', '{}')");
            throw new Error('rollback');
        }), /rollback/);
        assert.equal((await database.query("SELECT * FROM orders WHERE jid = 'rollback@test'")).rowCount, 0);
        assert.equal((await database.query("SELECT * FROM audit_events WHERE event_type = 'test'")).rowCount, 0);
    } finally {
        await database.end();
        await rm(directory, { recursive: true, force: true });
    }
});

test('payment webhook is authenticated and replay-safe', async () => {
    const { directory, database } = await setup();
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-secret';
    try {
        await database.query("INSERT INTO orders (jid, product_name, customer_name, status) VALUES ('buyer@test', 'Test', 'Buyer', 'awaiting_payment')");
        const order = (await database.query("SELECT * FROM orders WHERE jid = 'buyer@test'")).rows[0];
        const payload = { eventId: 'pay-evt-1', orderId: order.id, status: 'paid' };
        const rawBody = Buffer.from(JSON.stringify(payload));
        const signature = createHmac('sha256', 'test-secret').update(rawBody).digest('hex');
        const request = { headers: { 'x-payment-signature': signature } } as any;
        const { processPaymentWebhook } = await import('../src/payments/webhook.js');

        const first = await processPaymentWebhook(payload, rawBody, request, database);
        const replay = await processPaymentWebhook(payload, rawBody, request, database);
        assert.deepEqual(first.body, { ok: true, replayed: false });
        assert.deepEqual(replay.body, { ok: true, replayed: true });
        assert.equal((await database.query("SELECT status FROM orders WHERE id = $1", [order.id])).rows[0].status, 'paid');
        assert.equal((await database.query("SELECT * FROM payment_events WHERE provider_event_id = 'pay-evt-1'")).rowCount, 1);
        assert.equal((await database.query("SELECT * FROM audit_events WHERE aggregate_id = $1", [String(order.id)])).rowCount, 1);
        assert.equal((await database.query("SELECT * FROM outbound_intents WHERE dedupe_key = $1", [`order:${order.id}:paid`])).rowCount, 1);
    } finally {
        await database.end();
        await rm(directory, { recursive: true, force: true });
    }
});
