import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('persists, deduplicates, leases, retries, dead-letters, and tracks outbound provider status', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'voidlark-message-store-'));
    process.env.DB_DRIVER = 'sqlite';
    process.env.SQLITE_PATH = path.join(directory, 'messages.db');

    const { initSchema } = await import('../src/config/schema.js');
    const { pool } = await import('../src/config/db.js');
    const { MessageStore } = await import('../src/whatsapp/message-store.js');
    await initSchema();

    let now = new Date('2030-01-01T00:00:00.000Z');
    const store = new MessageStore({ database: pool, driver: 'sqlite', now: () => now, random: () => 0.5, baseBackoffMs: 1_000 });

    try {
        const first = await store.enqueueInbound('wa-in-1', '123@s.whatsapp.net', { text: 'hello' }, 2);
        const duplicate = await store.enqueueInbound('wa-in-1', 'other', { text: 'ignored' }, 2);
        assert.equal(first.inserted, true);
        assert.equal(duplicate.inserted, false);
        assert.equal(duplicate.message.id, first.message.id);

        const claim = await store.claimInbound(5_000);
        assert.equal(claim?.status, 'processing');
        assert.deepEqual(claim?.payload, { text: 'hello' });
        assert.equal(await store.claimInbound(), null);
        await store.completeInbound(claim!.id, claim!.lease_token!);

        const jidA = await store.enqueueInbound('wa-jid-a', 'same@s.whatsapp.net', { text: 'first' });
        const jidB = await store.enqueueInbound('wa-jid-b', 'same@s.whatsapp.net', { text: 'second' });
        const otherJid = await store.enqueueInbound('wa-jid-c', 'other@s.whatsapp.net', { text: 'parallel' });
        const firstJidClaim = await store.claimInbound(5_000);
        assert.equal(firstJidClaim?.id, jidA.message.id);
        const parallelClaim = await store.claimInbound(5_000, ['same@s.whatsapp.net']);
        assert.equal(parallelClaim?.id, otherJid.message.id);
        assert.notEqual(parallelClaim?.id, jidB.message.id);
        await store.completeInbound(firstJidClaim!.id, firstJidClaim!.lease_token!);
        await store.completeInbound(parallelClaim!.id, parallelClaim!.lease_token!);
        const secondJidClaim = await store.claimInbound(5_000);
        assert.equal(secondJidClaim?.id, jidB.message.id);
        await store.completeInbound(secondJidClaim!.id, secondJidClaim!.lease_token!);

        const retryMessage = await store.enqueueInbound('wa-retry', 'retry@s.whatsapp.net', { text: 'retry me' }, 2);
        const initialRetryClaim = await store.claimInbound(5_000);
        assert.equal(initialRetryClaim?.id, retryMessage.message.id);
        const retry = await store.failInbound(initialRetryClaim!.id, new Error('temporary'), initialRetryClaim!.lease_token!);
        assert.equal(retry?.status, 'retry');
        assert.equal(retry?.attempts, 1);
        assert.equal(await store.claimInbound(), null);

        now = new Date('2030-01-01T00:00:01.000Z');
        const secondClaim = await store.claimInbound();
        const dead = await store.failInbound(secondClaim!.id, 'permanent', secondClaim!.lease_token!);
        assert.equal(dead?.status, 'dead_letter');
        assert.equal((await store.listInboundFailures())[0].last_error, 'permanent');
        assert.equal(await store.retryInboundFailure(dead!.id), true);
        const retried = await store.claimInbound();
        assert.equal(await store.completeInbound(retried!.id, retried!.lease_token!), true);

        const outgoing = await store.enqueueOutbound('123@s.whatsapp.net', { text: 'reply' }, { dedupeKey: 'reply-1', maxAttempts: 2 });
        const outgoingDuplicate = await store.enqueueOutbound('123@s.whatsapp.net', { text: 'ignored' }, { dedupeKey: 'reply-1' });
        assert.equal(outgoing.inserted, true);
        assert.equal(outgoingDuplicate.inserted, false);

        const outboundClaim = await store.claimOutbound();
        const sent = await store.markOutboundSent(outboundClaim!.id, 'wa-out-1', outboundClaim!.lease_token!);
        assert.equal(sent?.status, 'sent');
        assert.equal((await store.getOutboundStatusByProviderId('wa-out-1'))?.id, outgoing.message.id);
        assert.equal(await store.updateOutboundReceipt('wa-out-1', 'read'), true);
        assert.equal(await store.updateOutboundReceipt('wa-out-1', 'delivered'), false);
        assert.equal((await store.getOutboundStatusByProviderId('wa-out-1'))?.status, 'read');

        const missingOperator = await store.enqueuePermanentOutboundFailure(
            'ADMIN_WA_JID',
            { text: 'operator notification' },
            'ADMIN_WA_JID is not configured',
            { dedupeKey: 'operator-missing-1' },
        );
        const missingOperatorDuplicate = await store.enqueuePermanentOutboundFailure(
            'ADMIN_WA_JID',
            { text: 'ignored duplicate' },
            'ADMIN_WA_JID is not configured',
            { dedupeKey: 'operator-missing-1' },
        );
        assert.equal(missingOperator.inserted, true);
        assert.equal(missingOperatorDuplicate.inserted, false);
        assert.equal(missingOperator.message.status, 'dead_letter');
        assert.match(missingOperator.message.last_error || '', /ADMIN_WA_JID/);
        assert.equal(await store.retryOutboundFailure(missingOperator.message.id), false);
        assert.equal(await store.retryOutboundFailure(missingOperator.message.id, '628123@s.whatsapp.net'), true);
        const reroutedOperator = await store.claimOutbound();
        assert.equal(reroutedOperator?.id, missingOperator.message.id);
        assert.equal(reroutedOperator?.jid, '628123@s.whatsapp.net');
        await store.markOutboundSent(reroutedOperator!.id, 'wa-operator-1', reroutedOperator!.lease_token!);

        const abandoned = await store.enqueueOutbound('789@s.whatsapp.net', { text: 'recover lease' });
        const abandonedClaim = await store.claimOutbound(1_000);
        assert.equal(abandonedClaim?.id, abandoned.message.id);
        assert.equal(await store.claimOutbound(), null);
        now = new Date('2030-01-01T00:00:02.000Z');
        assert.equal((await store.claimOutbound())?.id, abandoned.message.id);
        await store.failOutbound(abandoned.message.id, 'abandoned lease recovered');

        const failing = await store.enqueueOutbound('456@s.whatsapp.net', { text: 'retry me' });
        const failingClaim = await store.claimOutbound();
        const failed = await store.failOutbound(failingClaim!.id, 'network', failingClaim!.lease_token!);
        assert.equal(failed?.status, 'failed');
        assert.equal(failed?.id, failing.message.id);
    } finally {
        await pool.end();
        await rm(directory, { recursive: true, force: true });
    }
});
