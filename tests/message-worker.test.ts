import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { WAMessage } from '@whiskeysockets/baileys';

const eventually = async (check: () => boolean | Promise<boolean>, timeoutMs = 2_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail('Condition was not met before timeout');
};

const message = (id: string, jid: string, text = id) => ({
    key: { id, remoteJid: jid, fromMe: false },
    message: { conversation: text },
} as WAMessage);

test('durable workers enqueue batches, dedupe, serialize, retry, dead-letter, and recover', async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'voidlark-message-workers-'));
    process.env.DB_DRIVER = 'sqlite';
    process.env.SQLITE_PATH = path.join(directory, 'workers.db');

    const { initSchema } = await import('../src/config/schema.js');
    const { pool } = await import('../src/config/db.js');
    const { MessageStore } = await import('../src/whatsapp/message-store.js');
    const { DurableInboundWorker, DurableOutboundWorker, PermanentInboundError } = await import('../src/whatsapp/message-worker.js');
    await initSchema();
    const store = new MessageStore({ database: pool, driver: 'sqlite', random: () => 0.5, baseBackoffMs: 5, maxBackoffMs: 20 });

    const row = async (table: string, providerId: string) => (await pool.query(
        `SELECT * FROM ${table} WHERE provider_message_id = $1`,
        [providerId],
    )).rows[0];

    try {
        await t.test('all valid upsert items enqueue and duplicate provider IDs dedupe', async () => {
            const handled: string[] = [];
            const worker = new DurableInboundWorker(async (item) => {
                handled.push(item.key.id!);
            }, 2, { store, pollIntervalMs: 5, activePollMs: 2 });

            await worker.enqueue([
                message('batch-1', 'batch-a@s.whatsapp.net'),
                message('batch-2', 'batch-b@s.whatsapp.net'),
                message('batch-1', 'ignored@s.whatsapp.net', 'duplicate'),
            ]);
            await eventually(() => handled.length === 2);
            worker.stop();

            assert.deepEqual(new Set(handled), new Set(['batch-1', 'batch-2']));
            assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM inbound_messages WHERE provider_message_id LIKE $1', ['batch-%'])).rows[0].count), 2);
        });

        await t.test('same JID is serialized while different JIDs run concurrently', async () => {
            const started: string[] = [];
            const releases = new Map<string, () => void>();
            const worker = new DurableInboundWorker(async (item) => {
                const id = item.key.id!;
                started.push(id);
                await new Promise<void>((resolve) => releases.set(id, resolve));
            }, 2, { store, pollIntervalMs: 5, activePollMs: 2 });

            await worker.enqueue([
                message('serial-a1', 'serial-a@s.whatsapp.net'),
                message('serial-a2', 'serial-a@s.whatsapp.net'),
                message('serial-b1', 'serial-b@s.whatsapp.net'),
            ]);
            await eventually(() => started.length === 2);
            assert.deepEqual(new Set(started), new Set(['serial-a1', 'serial-b1']));
            assert.equal(started.includes('serial-a2'), false);

            releases.get('serial-a1')!();
            await eventually(() => started.includes('serial-a2'));
            releases.get('serial-b1')!();
            releases.get('serial-a2')!();
            await eventually(async () => (await row('inbound_messages', 'serial-a2'))?.status === 'completed');
            worker.stop();
        });

        await t.test('load harness never exceeds configured concurrency and drains every item', async () => {
            let active = 0;
            let peak = 0;
            let completed = 0;
            const worker = new DurableInboundWorker(async () => {
                active += 1;
                peak = Math.max(peak, active);
                await new Promise((resolve) => setTimeout(resolve, 2));
                active -= 1;
                completed += 1;
            }, 3, { store, pollIntervalMs: 5, activePollMs: 1 });
            await worker.enqueue(Array.from({ length: 30 }, (_, index) => message(`load-${index}`, `load-${index}@s.whatsapp.net`)));
            await eventually(() => completed === 30);
            worker.stop();
            assert.equal(peak, 3);
            assert.equal(active, 0);
        });

        await t.test('replaying a completed provider ID does not execute the handler twice', async () => {
            let executions = 0;
            const worker = new DurableInboundWorker(async () => { executions += 1; }, 1, { store, pollIntervalMs: 5, activePollMs: 1 });
            await worker.enqueue([message('completed-replay', 'replay@s.whatsapp.net', 'original')]);
            await eventually(async () => (await row('inbound_messages', 'completed-replay'))?.status === 'completed');
            await worker.enqueue([message('completed-replay', 'replay@s.whatsapp.net', 'duplicate replay')]);
            await new Promise((resolve) => setTimeout(resolve, 20));
            worker.stop();
            assert.equal(executions, 1);
            const persisted = await row('inbound_messages', 'completed-replay');
            const payload = typeof persisted.payload === 'string' ? JSON.parse(persisted.payload) : persisted.payload;
            assert.equal(payload.message.message.conversation, 'original');
        });

        await t.test('transient failures retry and permanent failures dead-letter', async () => {
            const attempts = new Map<string, number>();
            const worker = new DurableInboundWorker(async (item) => {
                const id = item.key.id!;
                const count = (attempts.get(id) || 0) + 1;
                attempts.set(id, count);
                if (id === 'transient' && count === 1) throw new Error('temporary inbound failure');
                if (id === 'permanent') throw new Error('permanent inbound failure');
            }, 2, { store, pollIntervalMs: 5, activePollMs: 2 });

            await worker.enqueue([
                message('transient', 'retry@s.whatsapp.net'),
                message('permanent', 'dead@s.whatsapp.net'),
            ]);
            await eventually(async () => (await row('inbound_messages', 'transient'))?.status === 'completed');
            await eventually(async () => (await row('inbound_messages', 'permanent'))?.status === 'dead_letter');
            worker.stop();

            assert.equal(attempts.get('transient'), 2);
            assert.equal(attempts.get('permanent'), 5);
            assert.match((await row('inbound_messages', 'permanent')).last_error, /permanent inbound failure/);
        });

        await t.test('classified permanent inbound failures dead-letter after one attempt', async () => {
            let attempts = 0;
            const worker = new DurableInboundWorker(async () => {
                attempts += 1;
                throw new PermanentInboundError('unsupported media');
            }, 1, { store, pollIntervalMs: 5, activePollMs: 2 });
            await worker.enqueue([message('classified-permanent', 'media-dead@s.whatsapp.net')]);
            await eventually(async () => (await row('inbound_messages', 'classified-permanent'))?.status === 'dead_letter');
            worker.stop();
            assert.equal(attempts, 1);
            assert.equal(Number((await row('inbound_messages', 'classified-permanent')).attempts), 5);
        });

        await t.test('queued inbound work recovers after worker restart', async () => {
            await store.enqueueInbound('restart-queued', 'restart@s.whatsapp.net', {
                message: message('restart-queued', 'restart@s.whatsapp.net'),
                receivedAt: new Date().toISOString(),
            });
            const stoppedWorker = new DurableInboundWorker(async () => assert.fail('stopped worker ran'), 1, { store, pollIntervalMs: 5, activePollMs: 2 });
            stoppedWorker.stop();

            let handled = false;
            const restartedWorker = new DurableInboundWorker(async () => { handled = true; }, 1, { store, pollIntervalMs: 5, activePollMs: 2 });
            restartedWorker.wake();
            await eventually(() => handled);
            await eventually(async () => (await row('inbound_messages', 'restart-queued'))?.status === 'completed');
            restartedWorker.stop();
        });

        await t.test('expired inbound lease is reclaimed after a worker restart', async () => {
            await store.enqueueInbound('restart-expired', 'expired@s.whatsapp.net', {
                message: message('restart-expired', 'expired@s.whatsapp.net'),
                receivedAt: new Date().toISOString(),
            });
            const abandoned = await store.claimInbound(-1);
            assert.equal(abandoned?.status, 'processing');
            let handled = 0;
            const restartedWorker = new DurableInboundWorker(async () => { handled += 1; }, 1, { store, pollIntervalMs: 5, activePollMs: 1 });
            restartedWorker.wake();
            await eventually(async () => (await row('inbound_messages', 'restart-expired'))?.status === 'completed');
            restartedWorker.stop();
            assert.equal(handled, 1);
        });

        await t.test('outbound retries transient sends and deduplicates enqueue requests', async () => {
            let attempts = 0;
            const worker = new DurableOutboundWorker(async () => {
                attempts += 1;
                if (attempts === 1) throw new Error('temporary outbound failure');
                return 'provider-outbound-1';
            }, { store, pollIntervalMs: 5 });

            const first = await worker.enqueue('outbound@s.whatsapp.net', { text: 'send once' }, 'outbound-dedupe');
            const duplicate = await worker.enqueue('outbound@s.whatsapp.net', { text: 'must not send' }, 'outbound-dedupe');
            assert.equal(duplicate.id, first.id);
            await eventually(async () => (await store.getOutboundStatusByProviderId('provider-outbound-1'))?.status === 'sent');
            worker.stop();

            assert.equal(attempts, 2);
            assert.deepEqual((await store.getOutboundStatusByProviderId('provider-outbound-1'))?.payload, { text: 'send once' });
        });

        await t.test('post-send actions run only after sent and recover idempotently after restart', async () => {
            const actions: unknown[] = [];
            const queued = await store.enqueueOutbound('handoff@s.whatsapp.net', { text: 'payment summary' }, {
                dedupeKey: 'payment-summary-1',
                postSendAction: { type: 'handoff', reason: 'Payment summary sent' },
            });
            assert.equal(await store.claimPostSendAction(), null);

            const firstWorker = new DurableOutboundWorker(async () => 'provider-payment-summary', {
                store,
                pollIntervalMs: 5,
                postSendHandler: async (action) => {
                    actions.push(action);
                    throw new Error('simulate restart after durable send');
                },
                postSendPollMs: 5,
            });
            firstWorker.wake();
            await eventually(async () => (await store.getOutboundStatusByProviderId('provider-payment-summary'))?.status === 'sent');
            await eventually(async () => (await store.getPostSendActionStatus(queued.message.id)) === 'pending');
            firstWorker.stop();

            const restartedWorker = new DurableOutboundWorker(async () => assert.fail('sent message was transmitted twice'), {
                store,
                pollIntervalMs: 5,
                postSendHandler: async (action) => { actions.push(action); },
                postSendPollMs: 5,
            });
            restartedWorker.wake();
            await eventually(async () => (await store.getPostSendActionStatus(queued.message.id)) === 'completed');
            restartedWorker.stop();

            assert.deepEqual(actions, [
                { type: 'handoff', reason: 'Payment summary sent' },
                { type: 'handoff', reason: 'Payment summary sent' },
            ]);
        });
    } finally {
        await pool.end();
        await rm(directory, { recursive: true, force: true });
    }
});
