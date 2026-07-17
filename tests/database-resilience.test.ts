import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DB_DRIVER = 'sqlite';

test('PostgreSQL nested transactions isolate failures with savepoints', async () => {
    const commands: string[] = [];
    const client = {
        query: async (sql: string) => {
            commands.push(sql);
            return { rows: [], rowCount: 0 };
        },
        release: () => { commands.push('RELEASE_CLIENT'); },
    };
    const fakePool = {
        query: client.query,
        connect: async () => client,
        end: async () => undefined,
    };
    const { createPostgresDatabase } = await import('../src/config/db.js');
    const database = createPostgresDatabase(fakePool as any);

    await database.transaction(async (transaction) => {
        await transaction.query('OUTER BEFORE');
        await assert.rejects(transaction.transaction(async (nested) => {
            await nested.query('NESTED WRITE');
            throw new Error('nested failure');
        }), /nested failure/);
        await transaction.query('OUTER AFTER');
    });

    assert.deepEqual(commands, [
        'BEGIN', 'OUTER BEFORE', 'SAVEPOINT voidlark_nested_1', 'NESTED WRITE',
        'ROLLBACK TO SAVEPOINT voidlark_nested_1', 'RELEASE SAVEPOINT voidlark_nested_1',
        'OUTER AFTER', 'COMMIT', 'RELEASE_CLIENT',
    ]);
});

test('PostgreSQL nested transactions release successful savepoints', async () => {
    const commands: string[] = [];
    const client = {
        query: async (sql: string) => { commands.push(sql); return { rows: [], rowCount: 0 }; },
        release: () => { commands.push('RELEASE_CLIENT'); },
    };
    const { createPostgresDatabase } = await import('../src/config/db.js');
    const database = createPostgresDatabase({ query: client.query, connect: async () => client, end: async () => undefined } as any);
    await database.transaction((transaction) => transaction.transaction(async (nested) => {
        await nested.query('NESTED WRITE');
    }));
    assert.deepEqual(commands, [
        'BEGIN', 'SAVEPOINT voidlark_nested_1', 'NESTED WRITE',
        'RELEASE SAVEPOINT voidlark_nested_1', 'COMMIT', 'RELEASE_CLIENT',
    ]);
});

test('SQLite transaction rolls back atomically on an injected database error', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'voidlark-db-resilience-'));
    const { createSqliteDatabase } = await import('../src/config/db.js');
    const database = createSqliteDatabase(path.join(directory, 'rollback.sqlite'), { busyTimeoutMs: 25 });
    try {
        await database.query('CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL UNIQUE)');
        await assert.rejects(database.transaction(async (transaction) => {
            await transaction.query("INSERT INTO records (id, value) VALUES (1, 'first')");
            await transaction.query("INSERT INTO records (id, value) VALUES (2, 'first')");
        }), /UNIQUE constraint failed/);
        assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM records')).rows[0].count), 0);
    } finally {
        await database.end();
        await rm(directory, { recursive: true, force: true });
    }
});

test('SQLite preserves repeated and out-of-order PostgreSQL placeholders with casts', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'voidlark-db-placeholders-'));
    const { createSqliteDatabase } = await import('../src/config/db.js');
    const database = createSqliteDatabase(path.join(directory, 'placeholders.sqlite'));
    try {
        const repeated = await database.query('SELECT $1::jsonb AS first, $1::jsonb AS second', ['{"ok":true}']);
        assert.equal(repeated.rows[0].first, '{"ok":true}');
        assert.equal(repeated.rows[0].second, '{"ok":true}');

        const reordered = await database.query('SELECT $2 AS second, $1 AS first, $2 AS repeated', ['one', 'two']);
        assert.deepEqual({ second: reordered.rows[0].second, first: reordered.rows[0].first, repeated: reordered.rows[0].repeated }, { second: 'two', first: 'one', repeated: 'two' });
    } finally {
        await database.end();
        await rm(directory, { recursive: true, force: true });
    }
});

test('SQLite serializes unrelated transactions across async gaps', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'voidlark-db-isolation-'));
    const { createSqliteDatabase } = await import('../src/config/db.js');
    const database = createSqliteDatabase(path.join(directory, 'isolation.sqlite'));
    let releaseFirst: (() => void) | undefined;
    let first: Promise<void> | undefined;
    try {
        await database.query('CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
        let firstStarted!: () => void;
        const firstHasStarted = new Promise<void>((resolve) => { firstStarted = resolve; });
        const releaseFirstTransaction = new Promise<void>((resolve) => { releaseFirst = resolve; });
        const order: string[] = [];

        first = database.transaction(async (transaction) => {
            await transaction.query("INSERT INTO records (id, value) VALUES (1, 'first')");
            order.push('first-started');
            firstStarted();
            await releaseFirstTransaction;
            order.push('first-finished');
        });
        await firstHasStarted;
        const second = database.transaction(async (transaction) => {
            order.push('second-started');
            await transaction.query("INSERT INTO records (id, value) VALUES (2, 'second')");
        });

        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.deepEqual(order, ['first-started']);
        releaseFirst();
        await Promise.all([first, second]);
        assert.deepEqual(order, ['first-started', 'first-finished', 'second-started']);
        assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM records')).rows[0].count), 2);
    } finally {
        releaseFirst?.();
        await first?.catch(() => undefined);
        await database.end();
        await rm(directory, { recursive: true, force: true });
    }
});

test('SQLite does not leak transaction access through the pool during an async transaction', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'voidlark-db-pool-leak-'));
    const { createSqliteDatabase } = await import('../src/config/db.js');
    const database = createSqliteDatabase(path.join(directory, 'pool-leak.sqlite'));
    let release: (() => void) | undefined;
    let transaction: Promise<void> | undefined;
    try {
        await database.query('CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
        let started!: () => void;
        const transactionStarted = new Promise<void>((resolve) => { started = resolve; });
        const releaseTransaction = new Promise<void>((resolve) => { release = resolve; });
        const order: string[] = [];
        transaction = database.transaction(async (connection) => {
            await connection.query("INSERT INTO records (id, value) VALUES (1, 'transaction')");
            started();
            await releaseTransaction;
        });
        await transactionStarted;
        const outsideQuery = database.query("INSERT INTO records (id, value) VALUES (2, 'outside')").then(() => order.push('outside-finished'));
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.deepEqual(order, []);
        release();
        await Promise.all([transaction, outsideQuery]);
        assert.deepEqual(order, ['outside-finished']);
    } finally {
        release?.();
        await transaction?.catch(() => undefined);
        await database.end();
        await rm(directory, { recursive: true, force: true });
    }
});

test('SQLite nested transactions use savepoints and do not roll back the outer unit', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'voidlark-db-nested-'));
    const { createSqliteDatabase } = await import('../src/config/db.js');
    const database = createSqliteDatabase(path.join(directory, 'nested.sqlite'));
    try {
        await database.query('CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
        await database.transaction(async (transaction) => {
            await transaction.query("INSERT INTO records (id, value) VALUES (1, 'outer-before')");
            await assert.rejects(transaction.transaction(async (nested) => {
                await nested.query("INSERT INTO records (id, value) VALUES (2, 'nested')");
                throw new Error('nested failure');
            }), /nested failure/);
            await transaction.query("INSERT INTO records (id, value) VALUES (3, 'outer-after')");
        });
        assert.deepEqual((await database.query('SELECT id FROM records ORDER BY id')).rows.map((row) => Number(row.id)), [1, 3]);
    } finally {
        await database.end();
        await rm(directory, { recursive: true, force: true });
    }
});

test('SQLite close waits for queued work and rejects new operations', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'voidlark-db-close-'));
    const { createSqliteDatabase } = await import('../src/config/db.js');
    const database = createSqliteDatabase(path.join(directory, 'close.sqlite'));
    let release: (() => void) | undefined;
    let transaction: Promise<void> | undefined;
    let closing: Promise<void> | undefined;
    try {
        await database.query('CREATE TABLE records (id INTEGER PRIMARY KEY)');
        let started!: () => void;
        const transactionStarted = new Promise<void>((resolve) => { started = resolve; });
        const releaseTransaction = new Promise<void>((resolve) => { release = resolve; });
        transaction = database.transaction(async (connection) => {
            await connection.query('INSERT INTO records (id) VALUES (1)');
            started();
            await releaseTransaction;
        });
        await transactionStarted;
        closing = database.end();
        await assert.rejects(database.query('SELECT 1'), /closing/i);
        release();
        await transaction;
        await closing;
    } finally {
        release?.();
        await transaction?.catch(() => undefined);
        await closing?.catch(() => undefined);
        await rm(directory, { recursive: true, force: true });
    }
});
