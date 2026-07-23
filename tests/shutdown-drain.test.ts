import assert from 'node:assert/strict';
import test from 'node:test';
import { DurableInboundWorker, DurableOutboundWorker } from '../src/whatsapp/message-worker.js';

test('workers expose bounded drain for graceful shutdown', async () => {
    const inbound = new DurableInboundWorker(async () => undefined, 1, { store: {} as never });
    const outbound = new DurableOutboundWorker(async () => null, { store: {} as never });
    assert.equal(await inbound.drain(5), true);
    assert.equal(await outbound.drain(5), true);
});
