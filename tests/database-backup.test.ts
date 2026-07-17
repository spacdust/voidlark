import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DB_DRIVER = 'sqlite';

const setup = async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'voidlark-db-backup-'));
    const sqlitePath = path.join(directory, 'source.sqlite');
    const backupDirectory = path.join(directory, 'backups');
    const { createSqliteDatabase } = await import('../src/config/db.js');
    const { initSchema } = await import('../src/config/schema.js');
    const database = createSqliteDatabase(sqlitePath);
    await initSchema(database);
    await database.query("INSERT INTO leads (jid, name) VALUES ('backup@test', 'Backup Test')");
    return { directory, sqlitePath, backupDirectory, database };
};

test('SQLite backup is created atomically with audit metadata and checksum', async () => {
    const context = await setup();
    const { createDatabaseBackup, validateDatabaseBackup } = await import('../src/config/database-backup.js');
    try {
        const result = await createDatabaseBackup({
            driver: 'sqlite',
            database: context.database,
            sqlitePath: context.sqlitePath,
            directory: context.backupDirectory,
        });
        const expected = createHash('sha256').update(await readFile(result.path)).digest('hex');
        assert.equal(result.checksum, expected);
        assert.match(await readFile(`${result.path}.sha256`, 'utf8'), new RegExp(`^${expected}`));
        assert.equal((await readdir(context.backupDirectory)).some((name) => name.endsWith('.tmp')), false);
        assert.deepEqual(await validateDatabaseBackup(result.path, 'sqlite'), { path: result.path, checksum: expected, valid: true });
        const run = (await context.database.query('SELECT * FROM backup_runs ORDER BY id DESC LIMIT 1')).rows[0];
        assert.equal(run.status, 'succeeded');
        assert.equal(run.checksum_sha256, expected);
        assert.equal(Number(run.size_bytes), result.sizeBytes);
    } finally {
        await context.database.end();
        await rm(context.directory, { recursive: true, force: true });
    }
});

test('SQLite backup retention removes oldest backup and checksum sidecar', async () => {
    const context = await setup();
    const { createDatabaseBackup } = await import('../src/config/database-backup.js');
    try {
        await createDatabaseBackup({ driver: 'sqlite', database: context.database, sqlitePath: context.sqlitePath, directory: context.backupDirectory, retention: 2, now: new Date('2026-01-01T00:00:00Z') });
        await createDatabaseBackup({ driver: 'sqlite', database: context.database, sqlitePath: context.sqlitePath, directory: context.backupDirectory, retention: 2, now: new Date('2026-01-02T00:00:00Z') });
        await createDatabaseBackup({ driver: 'sqlite', database: context.database, sqlitePath: context.sqlitePath, directory: context.backupDirectory, retention: 2, now: new Date('2026-01-03T00:00:00Z') });
        const files = await readdir(context.backupDirectory);
        assert.equal(files.filter((name) => name.endsWith('.sqlite')).length, 2);
        assert.equal(files.filter((name) => name.endsWith('.sha256')).length, 2);
        assert.equal(files.some((name) => name.includes('2026-01-01')), false);
    } finally {
        await context.database.end();
        await rm(context.directory, { recursive: true, force: true });
    }
});

test('corrupt SQLite backup is rejected before restore', async () => {
    const context = await setup();
    const { createDatabaseBackup, restoreSqliteBackup, validateDatabaseBackup } = await import('../src/config/database-backup.js');
    try {
        const result = await createDatabaseBackup({ driver: 'sqlite', database: context.database, sqlitePath: context.sqlitePath, directory: context.backupDirectory });
        await appendFile(result.path, Buffer.from('corruption'));
        await assert.rejects(validateDatabaseBackup(result.path, 'sqlite'), /Checksum backup tidak cocok/);
        await assert.rejects(restoreSqliteBackup(result.path, path.join(context.directory, 'restored.sqlite')), /Checksum backup tidak cocok/);

        const fakePath = path.join(context.backupDirectory, 'voidlark-sqlite-fake.sqlite');
        await writeFile(fakePath, 'not sqlite');
        const fakeChecksum = createHash('sha256').update('not sqlite').digest('hex');
        await writeFile(`${fakePath}.sha256`, `${fakeChecksum}  ${path.basename(fakePath)}\n`);
        await assert.rejects(validateDatabaseBackup(fakePath, 'sqlite'), /Backup SQLite tidak valid/);
    } finally {
        await context.database.end();
        await rm(context.directory, { recursive: true, force: true });
    }
});

test('SQLite restore drill restores a disposable copy and validates schema', async () => {
    const context = await setup();
    const { createDatabaseBackup, runRestoreDrill } = await import('../src/config/database-backup.js');
    try {
        const result = await createDatabaseBackup({ driver: 'sqlite', database: context.database, sqlitePath: context.sqlitePath, directory: context.backupDirectory });
        const drill = await runRestoreDrill(result.path, { driver: 'sqlite' });
        assert.equal(drill.restored, true);
        assert.ok(drill.tableCount > 0);
    } finally {
        await context.database.end();
        await rm(context.directory, { recursive: true, force: true });
    }
});

test('SQLite restore callable atomically replaces a destination after validation', async () => {
    const context = await setup();
    const destination = path.join(context.directory, 'restore-target.sqlite');
    const { createDatabaseBackup, restoreSqliteBackup } = await import('../src/config/database-backup.js');
    try {
        const result = await createDatabaseBackup({ driver: 'sqlite', database: context.database, sqlitePath: context.sqlitePath, directory: context.backupDirectory });
        await writeFile(destination, 'old database placeholder');
        const restored = await restoreSqliteBackup(result.path, destination);
        assert.equal(restored.restored, true);
        const { DatabaseSync } = await import('node:sqlite');
        const database = new DatabaseSync(destination, { readOnly: true });
        try {
            const lead = database.prepare("SELECT name FROM leads WHERE jid = 'backup@test'").get() as { name: string };
            assert.equal(lead.name, 'Backup Test');
        } finally {
            database.close();
        }
        assert.equal((await readdir(context.directory)).some((name) => name.endsWith('.restore.tmp') || name.endsWith('.previous')), false);
    } finally {
        await context.database.end();
        await rm(context.directory, { recursive: true, force: true });
    }
});
