import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, type PoolClient, type QueryResult as PgQueryResult } from 'pg';
import dotenv from 'dotenv';
import { operationalMetrics } from '../operations/metrics.js';

dotenv.config();

export type QueryResult = { rows: any[]; rowCount: number };
export type Database = {
    query: (sql: string, params?: any[]) => Promise<QueryResult>;
    transaction: <T>(work: (database: Database) => Promise<T>) => Promise<T>;
    end: () => Promise<void>;
};

export const DB_DRIVER = (process.env.DB_DRIVER || 'sqlite').toLowerCase();

const parseJsonColumns = (row: any) => {
    for (const key of ['data', 'options', 'customer_data', 'metadata']) {
        if (typeof row[key] === 'string') {
            try {
                row[key] = JSON.parse(row[key]);
            } catch {
                // Keep original string when it is not JSON.
            }
        }
    }
    return row;
};

export const toSqliteSql = (sql: string) => sql
    .replace(/TRUNCATE TABLE\s+(\w+)/gi, 'DELETE FROM $1')
    .replace(/::\s*[a-z_][a-z0-9_]*(?:\[\])?/gi, '')
    .replace(/\$(\d+)/g, '?$1')
    .replace(/NOW\(\)/gi, 'CURRENT_TIMESTAMP');

const operationOf = (sql: string) => (sql.trim().match(/^(select|insert|update|delete)\b/i)?.[1]?.toLowerCase() || 'other');

const sqliteDatabase = (db: DatabaseSync): Database => {
    type TransactionContext = { active: boolean; savepoint: number; connection: Database };
    const transactionContext = new AsyncLocalStorage<TransactionContext>();
    let queue = Promise.resolve();
    let closing = false;
    let closed = false;

    const serialize = async <T>(work: () => Promise<T>): Promise<T> => {
        const previous = queue;
        let release!: () => void;
        queue = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        try {
            return await work();
        } finally {
            release();
        }
    };

    const executeQuery = async (sql: string, params: any[] = []): Promise<QueryResult> => {
        const started = process.hrtime.bigint();
        let outcome: 'success' | 'error' = 'success';
        try {
            const translated = toSqliteSql(sql).trim();
            if (translated.includes(';') && params.length === 0) {
                db.exec(translated);
                return { rows: [], rowCount: 0 };
            }

            const statement = db.prepare(translated);
            if (/^\s*(select|pragma)\b/i.test(translated) || /\breturning\b/i.test(translated)) {
                const rows = statement.all(...params).map(parseJsonColumns);
                return { rows, rowCount: rows.length };
            }

            const result = statement.run(...params);
            return { rows: [], rowCount: Number(result.changes || 0) };
        } catch (error) {
            outcome = 'error';
            throw error;
        } finally {
            operationalMetrics.db(operationOf(sql), outcome, Number(process.hrtime.bigint() - started) / 1e9);
        }
    };

    const database: Database = {
        async query(sql: string, params: any[] = []) {
            if (closing) throw new Error('Database is closing.');
            return serialize(() => executeQuery(sql, params));
        },
        async transaction<T>(work: (transaction: Database) => Promise<T>) {
            if (closing) throw new Error('Database is closing.');
            return serialize(async () => {
                const transaction: Database = {
                    query: executeQuery,
                    transaction: async (nestedWork) => {
                        const context = transactionContext.getStore();
                        if (!context?.active || context.connection !== transaction) {
                            throw new Error('Nested SQLite transaction escaped its transaction context.');
                        }
                        const savepoint = `voidlark_nested_${++context.savepoint}`;
                        db.exec(`SAVEPOINT ${savepoint}`);
                        try {
                            const result = await nestedWork(transaction);
                            db.exec(`RELEASE SAVEPOINT ${savepoint}`);
                            return result;
                        } catch (error) {
                            db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
                            db.exec(`RELEASE SAVEPOINT ${savepoint}`);
                            throw error;
                        }
                    },
                    end: async () => undefined,
                };
                const outerContext: TransactionContext = { active: true, savepoint: 0, connection: transaction };
                db.exec('BEGIN IMMEDIATE');
                try {
                    const result = await transactionContext.run(outerContext, () => work(transaction));
                    db.exec('COMMIT');
                    return result;
                } catch (error) {
                    db.exec('ROLLBACK');
                    throw error;
                } finally {
                    outerContext.active = false;
                }
            });
        },
        async end() {
            if (closed) return;
            closing = true;
            const pending = queue;
            await pending;
            db.close();
            closed = true;
        },
    };
    return database;
};

export const createSqliteDatabase = (sqlitePath: string, options: { busyTimeoutMs?: number } = {}): Database => {
    fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
    const db = new DatabaseSync(sqlitePath);
    const busyTimeoutMs = Number.isFinite(options.busyTimeoutMs) ? Math.max(0, Math.floor(options.busyTimeoutMs!)) : 5_000;
    db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = ${busyTimeoutMs};`);
    return sqliteDatabase(db);
};

const createDefaultSqliteDatabase = (): Database => {
    const defaultSqlitePath = path.resolve('data', 'voidlark.db');
    const legacySqlitePath = path.resolve('data', `auto${'cs'}.db`);
    if (!process.env.SQLITE_PATH && !fs.existsSync(defaultSqlitePath) && fs.existsSync(legacySqlitePath)) {
        fs.copyFileSync(legacySqlitePath, defaultSqlitePath);
    }
    const sqlitePath = process.env.SQLITE_PATH || defaultSqlitePath;
    return createSqliteDatabase(sqlitePath);
};

type PostgresPool = {
    query: (sql: string, params?: any[]) => Promise<PgQueryResult<any>>;
    connect: () => Promise<PoolClient>;
    end: () => Promise<void>;
};

export const createPostgresDatabase = (postgresPool: PostgresPool): Database => ({
    query: async (sql, params) => {
        const started = process.hrtime.bigint();
        try {
            const result = await postgresPool.query(sql, params);
            operationalMetrics.db(operationOf(sql), 'success', Number(process.hrtime.bigint() - started) / 1e9);
            return { rows: result.rows, rowCount: result.rowCount || 0 };
        } catch (error) {
            operationalMetrics.db(operationOf(sql), 'error', Number(process.hrtime.bigint() - started) / 1e9);
            throw error;
        }
    },
    async transaction<T>(work: (database: Database) => Promise<T>) {
        const client: PoolClient = await postgresPool.connect();
        let savepointSequence = 0;
        const transaction: Database = {
            query: async (sql, params) => {
                const result = await client.query(sql, params);
                return { rows: result.rows, rowCount: result.rowCount || 0 };
            },
            transaction: async (nestedWork) => {
                const savepoint = `voidlark_nested_${++savepointSequence}`;
                await client.query(`SAVEPOINT ${savepoint}`);
                try {
                    const result = await nestedWork(transaction);
                    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
                    return result;
                } catch (error) {
                    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
                    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
                    throw error;
                }
            },
            end: async () => undefined,
        };
        try {
            await client.query('BEGIN');
            const result = await work(transaction);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    },
    end: async () => postgresPool.end(),
});

let defaultDatabase: Database | undefined;
const getDefaultDatabase = () => defaultDatabase ??= DB_DRIVER === 'postgres'
    ? createPostgresDatabase(new Pool({ connectionString: process.env.DATABASE_URL }))
    : createDefaultSqliteDatabase();

export const pool: Database = {
    query: (sql, params) => getDefaultDatabase().query(sql, params),
    transaction: (work) => getDefaultDatabase().transaction(work),
    async end() {
        const database = defaultDatabase;
        defaultDatabase = undefined;
        await database?.end();
    },
};

export const connectDB = async () => {
    try {
        await pool.query('SELECT 1');
        console.log(`✅ Berhasil terhubung ke ${DB_DRIVER === 'postgres' ? 'PostgreSQL' : 'SQLite'}`);
    } catch (error) {
        console.error('❌ Gagal terhubung ke database:', error);
        process.exit(1);
    }
};
