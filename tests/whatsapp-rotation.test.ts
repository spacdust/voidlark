import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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

test('WhatsAppManager resolves per-number CS name with global fallback', () => {
    const manager = new WhatsAppManager({}, null);
    manager.registerSession({ id: 'Sales', csNameOverride: 'Rara', phone: '628111', status: 'online', dailyLimit: 10, todayLeadCount: 0, todayMessageCount: 0 });
    manager.registerSession({ id: 'Support', phone: '628222', status: 'online', dailyLimit: 10, todayLeadCount: 0, todayMessageCount: 0 });
    assert.equal(manager.getEffectiveCsName('628111', 'Anin'), 'Rara');
    assert.equal(manager.getEffectiveCsName('628222', 'Anin'), 'Anin');
});

test('WhatsAppManager persists deletion and restores runtime state when persistence fails', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'voidlark-wa-manager-'));
    const storage = path.join(root, 'sessions.json');
    const manager = new WhatsAppManager({}, storage);
    manager.registerSession({ id: 'Line 1', phone: '628111', status: 'online', dailyLimit: 10, todayLeadCount: 0, todayMessageCount: 0 });
    assert.equal(manager.removeSession('628111'), true);
    assert.deepEqual(JSON.parse(await readFile(storage, 'utf8')).sessions, []);

    manager.registerSession({ id: 'Line 2', phone: '628222', status: 'online', dailyLimit: 10, todayLeadCount: 0, todayMessageCount: 0 });
    await rm(storage);
    await mkdir(storage);
    assert.equal(manager.removeSession('628222'), false);
    assert.equal(manager.getSession('628222')?.id, 'Line 2');
    await rm(root, { recursive: true, force: true });
});

test('WhatsAppManager resets and persists daily counters once date changes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'voidlark-wa-counter-'));
    const storage = path.join(root, 'sessions.json');
    let date = '2026-07-21';
    const manager = new WhatsAppManager({}, storage, () => date);
    manager.registerSession({ id: 'Line', phone: '628111', status: 'online', dailyLimit: 10, todayLeadCount: 4, todayMessageCount: 9 });
    assert.equal(manager.getSessions()[0].todayMessageCount, 9);
    date = '2026-07-22';
    assert.equal(manager.getSessions()[0].todayMessageCount, 0);
    assert.equal(manager.getSessions()[0].todayLeadCount, 0);
    assert.equal(JSON.parse(await readFile(storage, 'utf8')).sessions[0].counterDate, date);
    await rm(root, { recursive: true, force: true });
});

test('WhatsAppManager restores sticky assignments after restart', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'voidlark-wa-sticky-'));
    const storage = path.join(root, 'sessions.json');
    const manager = new WhatsAppManager({}, storage);
    manager.registerSession({ id: 'Line', phone: '628111', status: 'online', dailyLimit: 10, todayLeadCount: 0, todayMessageCount: 0 });
    manager.setStickyAssignment('buyer@s.whatsapp.net', '628111');
    const restored = new WhatsAppManager({}, storage);
    assert.equal(restored.getStickyAssignment('buyer@s.whatsapp.net'), '628111');
    await rm(root, { recursive: true, force: true });
});

test('WhatsAppManager enforces daily lead limit instead of falling back past quota', () => {
    const manager = new WhatsAppManager({ rotationMode: 'round_robin', enableStickyAssignment: false }, null);
    manager.registerSession({ id: 'Line', phone: '628111', status: 'online', dailyLimit: 1, todayLeadCount: 0, todayMessageCount: 0 });
    assert.ok(manager.assignNumberForLead('first@s.whatsapp.net'));
    assert.equal(manager.assignNumberForLead('second@s.whatsapp.net'), null);
});

test('WhatsAppManager persists sent-message counter', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'voidlark-wa-message-counter-'));
    const storage = path.join(root, 'sessions.json');
    const manager = new WhatsAppManager({}, storage);
    manager.registerSession({ id: 'Line', phone: '628111', status: 'online', dailyLimit: 10, todayLeadCount: 0, todayMessageCount: 0 });
    manager.recordMessageSent('628111');
    const restored = new WhatsAppManager({}, storage);
    assert.equal(restored.getSession('628111')?.todayMessageCount, 1);
    await rm(root, { recursive: true, force: true });
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
