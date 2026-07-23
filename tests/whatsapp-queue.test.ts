import assert from 'node:assert/strict';
import test from 'node:test';
import { PerNumberQueue } from '../src/whatsapp/per-number-queue.js';
import { isWaSessionStaleConnecting } from '../src/whatsapp/status.js';

test('per-number queue serializes same number but runs different numbers concurrently', async () => {
    const queue = new PerNumberQueue();
    let active = 0;
    let peak = 0;
    const task = async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active -= 1;
        return true;
    };
    await Promise.all([queue.enqueue('one', 0, task), queue.enqueue('one', 0, task), queue.enqueue('two', 0, task)]);
    assert.equal(peak, 2);
    assert.equal(queue.depth('one'), 0);
});

test('connecting status becomes stale after threshold', () => {
    assert.equal(isWaSessionStaleConnecting({ state: 'connecting', lastUpdate: new Date(Date.now() - 61_000).toISOString() }, 60_000), true);
    assert.equal(isWaSessionStaleConnecting({ state: 'connecting', lastUpdate: new Date().toISOString() }, 60_000), false);
});
