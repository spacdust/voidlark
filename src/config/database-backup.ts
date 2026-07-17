import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite';
import { Client } from 'pg';
import { promisify } from 'node:util';
import { DB_DRIVER, pool, type Database } from './db.js';
import { appLogger } from './logger.js';
import { operationalMetrics } from '../operations/metrics.js';

const execFileAsync = promisify(execFile);

export type BackupDriver = 'sqlite' | 'postgres';

export type DatabaseBackupOptions = {
    driver?: BackupDriver;
    database?: Database;
    directory?: string;
    retention?: number;
    sqlitePath?: string;
    databaseUrl?: string;
    trigger?: 'manual' | 'scheduled' | 'startup';
    now?: Date;
};

export type DatabaseBackupResult = {
    path: string;
    checksum: string;
    sizeBytes: number;
};

const positiveInteger = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const defaultSqlitePath = () => path.resolve(process.env.SQLITE_PATH || path.join('data', 'voidlark.db'));
const defaultBackupDirectory = () => path.resolve(process.env.DB_BACKUP_DIR || path.join('backups', 'database'));
const checksumFile = (backupPath: string) => `${backupPath}.sha256`;

const sha256 = async (filePath: string) => createHash('sha256').update(await readFile(filePath)).digest('hex');

const safeError = (error: unknown) => error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);

const createAuditRun = async (database: Database, driver: BackupDriver, trigger: string) => {
    const result = await database.query(
        'INSERT INTO backup_runs (driver, trigger_type, status) VALUES ($1, $2, $3) RETURNING id',
        [driver, trigger, 'running'],
    );
    return Number(result.rows[0].id);
};

const completeAuditRun = async (database: Database, id: number, result: DatabaseBackupResult) => {
    await database.query(
        'UPDATE backup_runs SET status = $1, backup_path = $2, checksum_sha256 = $3, size_bytes = $4, completed_at = CURRENT_TIMESTAMP WHERE id = $5',
        ['succeeded', result.path, result.checksum, result.sizeBytes, id],
    );
};

const failAuditRun = async (database: Database, id: number, error: unknown) => {
    await database.query(
        'UPDATE backup_runs SET status = $1, error_message = $2, completed_at = CURRENT_TIMESTAMP WHERE id = $3',
        ['failed', safeError(error), id],
    );
};

const postgresConnection = (databaseUrl: string, databaseName?: string) => {
    const url = new URL(databaseUrl);
    const currentDatabase = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const env = {
        ...process.env,
        PGHOST: url.hostname,
        PGPORT: url.port || '5432',
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        PGDATABASE: databaseName || currentDatabase,
        ...(url.searchParams.get('sslmode') ? { PGSSLMODE: url.searchParams.get('sslmode')! } : {}),
    };
    return { env, databaseName: currentDatabase };
};

const createSqliteFile = async (sourcePath: string, tempPath: string) => {
    if (!fs.existsSync(sourcePath)) throw new Error(`SQLite database tidak ditemukan: ${sourcePath}`);
    const source = new DatabaseSync(sourcePath, { readOnly: true });
    try {
        await sqliteBackup(source, tempPath);
    } finally {
        source.close();
    }
};

const createPostgresFile = async (databaseUrl: string, tempPath: string) => {
    if (!databaseUrl) throw new Error('DATABASE_URL wajib untuk backup PostgreSQL.');
    const connection = postgresConnection(databaseUrl);
    await execFileAsync('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', tempPath], {
        env: connection.env,
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
    });
    await execFileAsync('pg_restore', ['--list', tempPath], { env: connection.env, windowsHide: true });
};

const publishBackup = async (tempPath: string, finalPath: string) => {
    const checksum = await sha256(tempPath);
    const tempChecksumPath = `${tempPath}.sha256`;
    await writeFile(tempChecksumPath, `${checksum}  ${path.basename(finalPath)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(tempPath, finalPath);
    await rename(tempChecksumPath, checksumFile(finalPath));
    return { path: finalPath, checksum, sizeBytes: (await stat(finalPath)).size };
};

export const enforceBackupRetention = async (directory: string, driver: BackupDriver, retention: number) => {
    const extension = driver === 'sqlite' ? '.sqlite' : '.dump';
    const prefix = `voidlark-${driver}-`;
    const entries = (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(extension))
        .map((entry) => entry.name)
        .sort()
        .reverse();
    for (const name of entries.slice(Math.max(1, retention))) {
        const backupPath = path.join(directory, name);
        await unlink(backupPath).catch(() => undefined);
        await unlink(checksumFile(backupPath)).catch(() => undefined);
    }
};

export const createDatabaseBackup = async (options: DatabaseBackupOptions = {}): Promise<DatabaseBackupResult> => {
    const driver = options.driver || (DB_DRIVER === 'postgres' ? 'postgres' : 'sqlite');
    const database = options.database || pool;
    const directory = path.resolve(options.directory || defaultBackupDirectory());
    const retention = options.retention || positiveInteger(process.env.DB_BACKUP_RETENTION, 14);
    const trigger = options.trigger || 'manual';
    await mkdir(directory, { recursive: true });

    const stamp = (options.now || new Date()).toISOString().replace(/[:.]/g, '-');
    const extension = driver === 'sqlite' ? 'sqlite' : 'dump';
    const finalPath = path.join(directory, `voidlark-${driver}-${stamp}-${randomUUID()}.${extension}`);
    const tempPath = `${finalPath}.tmp`;
    const runId = await createAuditRun(database, driver, trigger);
    try {
        if (driver === 'sqlite') await createSqliteFile(path.resolve(options.sqlitePath || defaultSqlitePath()), tempPath);
        else await createPostgresFile(options.databaseUrl || process.env.DATABASE_URL || '', tempPath);
        const result = await publishBackup(tempPath, finalPath);
        await completeAuditRun(database, runId, result);
        await enforceBackupRetention(directory, driver, retention);
        operationalMetrics.backupSuccess((options.now || new Date()).getTime());
        appLogger.info({ component: 'database-backup', driver, path: finalPath, sizeBytes: result.sizeBytes }, 'database_backup.succeeded');
        return result;
    } catch (error) {
        await rm(tempPath, { force: true }).catch(() => undefined);
        await rm(`${tempPath}.sha256`, { force: true }).catch(() => undefined);
        await rm(checksumFile(finalPath), { force: true }).catch(() => undefined);
        await failAuditRun(database, runId, error).catch(() => undefined);
        operationalMetrics.backupFailure(driver);
        appLogger.error({ component: 'database-backup', driver, err: error }, 'database_backup.failed');
        throw error;
    }
};

const readExpectedChecksum = async (backupPath: string, expected?: string) => {
    if (expected) return expected.trim().toLowerCase();
    const sidecar = await readFile(checksumFile(backupPath), 'utf8').catch(() => '');
    const checksum = sidecar.trim().split(/\s+/)[0];
    if (!/^[a-f0-9]{64}$/i.test(checksum)) throw new Error('Checksum backup tidak tersedia atau tidak valid.');
    return checksum.toLowerCase();
};

export const validateDatabaseBackup = async (backupPath: string, driver: BackupDriver, expectedChecksum?: string) => {
    const resolvedPath = path.resolve(backupPath);
    const expected = await readExpectedChecksum(resolvedPath, expectedChecksum);
    const actual = await sha256(resolvedPath);
    if (actual !== expected) throw new Error('Checksum backup tidak cocok; file rusak atau telah berubah.');

    if (driver === 'sqlite') {
        let database: DatabaseSync | null = null;
        try {
            database = new DatabaseSync(resolvedPath, { readOnly: true });
            const integrity = database.prepare('PRAGMA integrity_check').get() as Record<string, unknown>;
            if (String(Object.values(integrity)[0]).toLowerCase() !== 'ok') throw new Error('SQLite integrity check gagal.');
            database.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get();
        } catch (error) {
            throw new Error(`Backup SQLite tidak valid: ${safeError(error)}`);
        } finally {
            database?.close();
        }
    } else {
        await execFileAsync('pg_restore', ['--list', resolvedPath], { windowsHide: true });
    }
    return { path: resolvedPath, checksum: actual, valid: true as const };
};

export const runRestoreDrill = async (backupPath: string, options: { driver: BackupDriver; expectedChecksum?: string; databaseUrl?: string }) => {
    const validation = await validateDatabaseBackup(backupPath, options.driver, options.expectedChecksum);
    if (options.driver === 'sqlite') {
        const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'voidlark-restore-drill-'));
        const drillPath = path.join(directory, 'restored.sqlite');
        try {
            await copyFile(validation.path, drillPath);
            const restored = new DatabaseSync(drillPath);
            try {
                const tables = restored.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'").get() as { count: number };
                const integrity = restored.prepare('PRAGMA integrity_check').get() as Record<string, unknown>;
                if (String(Object.values(integrity)[0]).toLowerCase() !== 'ok') throw new Error('Restore drill integrity check gagal.');
                return { ...validation, restored: true as const, tableCount: Number(tables.count) };
            } finally {
                restored.close();
            }
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    }

    const databaseUrl = options.databaseUrl || process.env.DATABASE_URL || '';
    if (!databaseUrl) throw new Error('DATABASE_URL wajib untuk restore drill PostgreSQL.');
    const drillDatabase = `voidlark_restore_drill_${randomUUID().replace(/-/g, '')}`;
    const admin = new Client({ connectionString: databaseUrl.replace(/\/[^/?]*(?=[?]|$)/, '/postgres') });
    let databaseCreated = false;
    try {
        await admin.connect();
        await admin.query(`CREATE DATABASE "${drillDatabase}"`);
        databaseCreated = true;
        const drill = postgresConnection(databaseUrl, drillDatabase);
        await execFileAsync('pg_restore', ['--no-owner', '--no-privileges', '--exit-on-error', '--dbname', drillDatabase, validation.path], {
            env: drill.env,
            windowsHide: true,
            maxBuffer: 10 * 1024 * 1024,
        });
        const drillUrl = new URL(databaseUrl);
        drillUrl.pathname = `/${drillDatabase}`;
        const client = new Client({ connectionString: drillUrl.toString() });
        try {
            await client.connect();
            await client.query('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1');
        } finally {
            await client.end();
        }
        return { ...validation, restored: true as const };
    } finally {
        if (databaseCreated) await admin.query(`DROP DATABASE IF EXISTS "${drillDatabase}" WITH (FORCE)`).catch(() => undefined);
        await admin.end().catch(() => undefined);
    }
};

export const restoreSqliteBackup = async (backupPath: string, destinationPath: string, expectedChecksum?: string) => {
    const validation = await validateDatabaseBackup(backupPath, 'sqlite', expectedChecksum);
    const destination = path.resolve(destinationPath);
    const directory = path.dirname(destination);
    const tempPath = path.join(directory, `.${path.basename(destination)}.${randomUUID()}.restore.tmp`);
    const previousPath = path.join(directory, `.${path.basename(destination)}.${randomUUID()}.previous`);
    await mkdir(directory, { recursive: true });
    await copyFile(validation.path, tempPath);
    await validateDatabaseBackup(tempPath, 'sqlite', validation.checksum);
    const hadPrevious = fs.existsSync(destination);
    try {
        if (hadPrevious) await rename(destination, previousPath);
        await rename(tempPath, destination);
        await rm(previousPath, { force: true });
        return { path: destination, checksum: validation.checksum, restored: true as const };
    } catch (error) {
        await rm(tempPath, { force: true }).catch(() => undefined);
        if (hadPrevious && fs.existsSync(previousPath) && !fs.existsSync(destination)) {
            await rename(previousPath, destination).catch(() => undefined);
        }
        throw error;
    }
};

export const listBackupRuns = async (database: Database = pool, limit = 10) => (await database.query(
    'SELECT id, driver, trigger_type, status, backup_path, checksum_sha256, size_bytes, started_at, completed_at, error_message FROM backup_runs ORDER BY id DESC LIMIT $1',
    [limit],
)).rows;

export type DatabaseBackupScheduler = { stop: () => Promise<void> };

export const startDatabaseBackupScheduler = (options: DatabaseBackupOptions = {}): DatabaseBackupScheduler => {
    const intervalMinutes = positiveInteger(process.env.DB_BACKUP_INTERVAL_MINUTES, 1440);
    const enabled = (process.env.DB_BACKUP_ENABLED || 'true').toLowerCase() !== 'false';
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let currentRun: Promise<unknown> | null = null;

    const schedule = () => {
        if (stopped || !enabled) return;
        timer = setTimeout(run, intervalMinutes * 60_000);
        timer.unref?.();
    };
    const run = () => {
        if (stopped) return;
        currentRun = createDatabaseBackup({ ...options, trigger: 'scheduled' })
            .catch(() => undefined)
            .finally(() => {
                currentRun = null;
                schedule();
            });
    };

    if (enabled && (process.env.DB_BACKUP_RUN_ON_START || 'false').toLowerCase() === 'true') {
        currentRun = createDatabaseBackup({ ...options, trigger: 'startup' })
            .catch(() => undefined)
            .finally(() => {
                currentRun = null;
                schedule();
            });
    } else schedule();

    return {
        async stop() {
            stopped = true;
            if (timer) clearTimeout(timer);
            await currentRun;
        },
    };
};
