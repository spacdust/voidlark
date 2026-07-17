import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DB_DRIVER = 'sqlite';

const setup = async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'voidlark-package-d-'));
    const { createSqliteDatabase } = await import('../src/config/db.js');
    const { initSchema } = await import('../src/config/schema.js');
    const database = createSqliteDatabase(path.join(directory, 'test.db'));
    await initSchema(database);
    return { directory, database };
};

test('handoff assignment is race-safe and assignment/reassign/resolve are audited', async () => {
    const { directory, database } = await setup();
    const { HandoffRepository } = await import('../src/chat/handoff.js');
    const repository = new HandoffRepository(database, () => new Date('2026-07-16T10:00:00.000Z'));
    try {
        const created = await repository.create('race@test', 'Need operator', 'urgent');
        assert.equal(created.created, true);
        const [one, two] = await Promise.all([
            repository.assign(Number(created.handoff.id), 'operator-a'),
            repository.assign(Number(created.handoff.id), 'operator-b'),
        ]);
        assert.equal([one, two].filter(Boolean).length, 1, `assignment results: ${JSON.stringify([one, two])}`);
        const owner = (one || two).assigned_operator;
        assert.ok(['operator-a', 'operator-b'].includes(owner));
        await repository.reassign(Number(created.handoff.id), 'supervisor', 'lead');
        await repository.startHandling(Number(created.handoff.id), 'supervisor');
        await repository.resolveById(Number(created.handoff.id), 'supervisor', 'Answered');
        const events = await database.query("SELECT event_type FROM audit_events WHERE aggregate_type = 'handoff' ORDER BY id");
        assert.deepEqual(events.rows.map((row) => row.event_type), ['handoff.created', 'handoff.assigned', 'handoff.reassigned', 'handoff.handling', 'handoff.resolved']);
    } finally {
        await database.end(); await rm(directory, { recursive: true, force: true });
    }
});

test('concurrent handoff creation preserves one active row and one creation audit', async () => {
    const { directory, database } = await setup();
    const { HandoffRepository } = await import('../src/chat/handoff.js');
    const repository = new HandoffRepository(database, () => new Date('2026-07-16T10:00:00.000Z'));
    try {
        const results = await Promise.all([
            repository.create('creation-race@test', 'First request', 'high'),
            repository.create('creation-race@test', 'Second request', 'urgent'),
        ]);
        assert.equal(results.filter((result) => result.created).length, 1);
        assert.equal(new Set(results.map((result) => Number(result.handoff.id))).size, 1);
        assert.equal(Number((await database.query("SELECT COUNT(*) AS count FROM handoff_log WHERE jid = $1 AND resolved = 0", ['creation-race@test'])).rows[0].count), 1);
        assert.equal(Number((await database.query("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'handoff.created' AND aggregate_type = 'handoff'")).rows[0].count), 1);
    } finally {
        await database.end(); await rm(directory, { recursive: true, force: true });
    }
});

test('SLA due and breach state are deterministic', async () => {
    const { directory, database } = await setup();
    const { HandoffRepository } = await import('../src/chat/handoff.js');
    let now = new Date('2026-07-16T10:00:00.000Z');
    const repository = new HandoffRepository(database, () => now);
    try {
        const created = await repository.create('sla@test', 'Urgent', 'urgent');
        assert.equal(created.handoff.sla_due_at, '2026-07-16T10:15:00.000Z');
        assert.equal(Number((await repository.listActive())[0].sla_breached), 0);
        now = new Date('2026-07-16T10:15:00.001Z');
        assert.equal(Number((await repository.listActive())[0].sla_breached), 1);
    } finally {
        await database.end(); await rm(directory, { recursive: true, force: true });
    }
});

test('handoff SQL uses the database-native resolved boolean predicate', async () => {
    const statements: string[] = [];
    const database = {
        query: async (sql: string) => {
            statements.push(sql);
            return { rows: [], rowCount: 0 };
        },
        transaction: async (work: any) => work(database),
        end: async () => undefined,
    };
    const { HandoffRepository } = await import('../src/chat/handoff.js');
    const repository = new HandoffRepository(database as any, () => new Date('2026-07-16T10:00:00.000Z'), 'postgres');
    await repository.listActive();
    assert.match(statements[0], /resolved = FALSE/);
    assert.doesNotMatch(statements[0], /resolved = 0/);
});

test('business hours honor timezone boundaries, overnight ranges, and holidays', async () => {
    const { getBusinessHoursState } = await import('../src/chat/business-hours.js');
    const base = {
        enabled: true, timezone: 'Asia/Jakarta', holidays: [] as string[], outOfHoursResponse: 'Closed.', responseEstimate: 'Tomorrow.',
        handoffPolicy: 'create' as const, slaMinutes: { low: 240, normal: 120, high: 60, urgent: 15 },
        weekly: { monday: ['09:00-17:00'], tuesday: [], wednesday: [], thursday: [], friday: ['22:00-02:00'], saturday: [], sunday: [] },
    };
    assert.equal(getBusinessHoursState(new Date('2026-07-13T01:59:00Z'), base).open, false);
    assert.equal(getBusinessHoursState(new Date('2026-07-13T02:00:00Z'), base).open, true);
    assert.equal(getBusinessHoursState(new Date('2026-07-13T10:00:00Z'), base).open, false);
    assert.equal(getBusinessHoursState(new Date('2026-07-17T16:30:00Z'), base).open, true);
    assert.equal(getBusinessHoursState(new Date('2026-07-17T18:30:00Z'), base).open, true);
    assert.equal(getBusinessHoursState(new Date('2026-07-13T03:00:00Z'), { ...base, holidays: ['2026-07-13'] }).reason, 'holiday');
});

test('opt-out and re-opt-in persist while transactional replies bypass suppression', async () => {
    const { directory, database } = await setup();
    const { ConsentService, detectConsentCommand } = await import('../src/chat/consent.js');
    const { MessageStore, SuppressedCommunicationError } = await import('../src/whatsapp/message-store.js');
    const consent = new ConsentService(database, () => new Date('2026-07-16T10:00:00Z'));
    const store = new MessageStore({ database, driver: 'sqlite', canSend: (jid, category) => consent.canSend(jid, category) });
    try {
        assert.equal(detectConsentCommand(' berhenti! '), 'opt_out');
        assert.equal(detectConsentCommand('please stop'), null);
        await consent.set('consent@test', false);
        await assert.rejects(store.enqueueOutbound('consent@test', { text: 'sale' }, { category: 'marketing' }), SuppressedCommunicationError);
        await assert.rejects(store.enqueueOutbound('consent@test', { text: 'follow up' }, { category: 'proactive' }), SuppressedCommunicationError);
        assert.equal((await store.enqueueOutbound('consent@test', { text: 'receipt' }, { category: 'transactional' })).inserted, true);
        await consent.set('consent@test', true);
        assert.equal((await store.enqueueOutbound('consent@test', { text: 'sale' }, { category: 'marketing' })).inserted, true);
        const preference = (await database.query('SELECT * FROM communication_preferences WHERE jid = $1', ['consent@test'])).rows[0];
        assert.equal(Boolean(preference.marketing_opt_in), true);
        assert.ok(preference.consented_at);
        assert.equal(preference.opted_out_at, null);
    } finally {
        await database.end(); await rm(directory, { recursive: true, force: true });
    }
});

test('consent writes native booleans for PostgreSQL and integers for SQLite', async () => {
    const captured: unknown[][] = [];
    const database = {
        query: async (_sql: string, params: unknown[] = []) => {
            captured.push(params);
            return { rows: [], rowCount: 1 };
        },
        transaction: async (work: any) => work(database),
        end: async () => undefined,
    };
    const { ConsentService } = await import('../src/chat/consent.js');
    await new ConsentService(database as any, () => new Date('2026-07-16T10:00:00Z'), 'postgres').set('postgres@test', true);
    await new ConsentService(database as any, () => new Date('2026-07-16T10:00:00Z'), 'sqlite').set('sqlite@test', false);
    assert.equal(captured[0][1], true);
    assert.equal(captured[1][1], 0);
});
