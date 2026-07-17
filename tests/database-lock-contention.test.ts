import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DB_DRIVER = 'sqlite';

test('SQLite lock contention fails within the configured offline bound and succeeds after release', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'voidlark-db-lock-'));
    const file = path.join(directory, 'locked.sqlite');
    const { createSqliteDatabase } = await import('../src/config/db.js');
    const holder = createSqliteDatabase(file, { busyTimeoutMs: 25 });
    const contender = createSqliteDatabase(file, { busyTimeoutMs: 25 });
    let release: (() => void) | undefined;
    let holding: Promise<void> | undefined;
    try {
        await holder.query('CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
        let locked!: () => void;
        const lockAcquired = new Promise<void>((resolve) => { locked = resolve; });
        const releaseLock = new Promise<void>((resolve) => { release = resolve; });
        holding = holder.transaction(async (transaction) => {
            await transaction.query("INSERT INTO records (id, value) VALUES (1, 'holder')");
            locked();
            await releaseLock;
        });
        await lockAcquired;
        const started = performance.now();
        await assert.rejects(contender.query("INSERT INTO records (id, value) VALUES (2, 'contender')"), /database is locked/i);
        const elapsedMs = performance.now() - started;
        assert.ok(elapsedMs >= 15 && elapsedMs < 250, `lock timeout was ${elapsedMs.toFixed(1)}ms`);
        release();
        await holding;
        await contender.query("INSERT INTO records (id, value) VALUES (2, 'contender')");
        assert.equal(Number((await contender.query('SELECT COUNT(*) AS count FROM records')).rows[0].count), 2);
    } finally {
        release?.();
        await holding?.catch(() => undefined);
        await Promise.all([holder.end(), contender.end()]);
        await rm(directory, { recursive: true, force: true });
    }
});
