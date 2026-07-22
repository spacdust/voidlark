import assert from 'node:assert/strict';
import test from 'node:test';
import { WhatsAppManager } from '../src/whatsapp/whatsapp-manager.js';
import { calculateRandomDelayMs, calculateTypingDurationMs } from '../src/whatsapp/anti-ban-delay.js';
import { AiQueueLimiter } from '../src/ai/ai-queue-limiter.js';

test('WhatsAppManager rotates new leads round robin across available online numbers', () => {
    const manager = new WhatsAppManager({ rotationMode: 'round_robin', enableStickyAssignment: true }, null);
    manager.registerSession({ id: 'Line 1', phone: '628111', status: 'online', dailyLimit: 10, todayLeadCount: 0, todayMessageCount: 0 });
    manager.registerSession({ id: 'Line 2', phone: '628222', status: 'online', dailyLimit: 10, todayLeadCount: 0, todayMessageCount: 0 });

    const first = manager.assignNumberForLead('cust_01@c.us');
    const second = manager.assignNumberForLead('cust_02@c.us');

    assert.equal(first?.phone, '628111');
    assert.equal(second?.phone, '628222');
});

test('WhatsAppManager enforces sticky assignment for returning customers', () => {
    const manager = new WhatsAppManager({ rotationMode: 'round_robin', enableStickyAssignment: true }, null);
    manager.registerSession({ id: 'Line 1', phone: '628111', status: 'online', dailyLimit: 10, todayLeadCount: 0, todayMessageCount: 0 });
    manager.registerSession({ id: 'Line 2', phone: '628222', status: 'online', dailyLimit: 10, todayLeadCount: 0, todayMessageCount: 0 });

    // First assignment goes to Line 1
    const initial = manager.assignNumberForLead('cust_repeat@c.us');
    assert.equal(initial?.phone, '628111');

    // Next lead goes to Line 2
    manager.assignNumberForLead('cust_other@c.us');

    // Returning customer cust_repeat MUST still get Line 1
    const repeat = manager.assignNumberForLead('cust_repeat@c.us');
    assert.equal(repeat?.phone, '628111');
});

test('calculateRandomDelayMs returns random values bounded within min-max seconds', () => {
    const delayConfig = { minDelaySeconds: 2, maxDelaySeconds: 5, typingSpeedMsPerChar: 8 };
    for (let i = 0; i < 20; i++) {
        const delay = calculateRandomDelayMs(delayConfig);
        assert.ok(delay >= 2000 && delay <= 5000);
    }
});

test('calculateTypingDurationMs scales realistically with message text length', () => {
    const delayConfig = { minDelaySeconds: 3, maxDelaySeconds: 5, typingSpeedMsPerChar: 10 };
    const shortText = calculateTypingDurationMs(10, delayConfig);
    const longText = calculateTypingDurationMs(500, delayConfig);

    assert.ok(shortText >= 650);
    assert.ok(longText <= 4500);
    assert.ok(longText > shortText);
});

test('AiQueueLimiter limits parallel execution concurrency', async () => {
    const limiter = new AiQueueLimiter(2);
    let activeMax = 0;
    let current = 0;

    const task = async () => {
        return limiter.run(async () => {
            current++;
            activeMax = Math.max(activeMax, current);
            await new Promise((r) => setTimeout(r, 20));
            current--;
        });
    };

    await Promise.all([task(), task(), task(), task()]);
    assert.ok(activeMax <= 2);
});
