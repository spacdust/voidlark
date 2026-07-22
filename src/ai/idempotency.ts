// ============================================================================
// Idempotency Keys for AI Tool Mutations (Fase 8: AI Safety)
// ============================================================================

import { randomUUID } from 'node:crypto';
import { pool, type Database } from '../config/db.js';
import { appLogger } from '../config/logger.js';

export interface IdempotencyRecord {
    key: string;
    toolName: string;
    customerJid: string;
    result: unknown;
    createdAt: string;
    expiresAt: string;
}

/**
 * Idempotency key manager for AI tool mutations
 * Prevents duplicate execution of the same mutation
 */
export class IdempotencyManager {
    private database: Database;
    private defaultTtlSeconds: number;

    constructor(database: Database = pool, ttlSeconds: number = 86400) {
        this.database = database;
        this.defaultTtlSeconds = ttlSeconds; // Default: 24 hours
    }

    /**
     * Generate idempotency key from tool invocation
     */
    generateKey(toolName: string, customerJid: string, args: Record<string, unknown>): string {
        const normalized = JSON.stringify({ toolName, customerJid, args });
        return `idempotency:${toolName}:${Buffer.from(normalized).toString('base64url')}`;
    }

    /**
     * Check if operation was already executed
     */
    async check(key: string): Promise<IdempotencyRecord | null> {
        const result = await this.database.query(
            `SELECT key, tool_name, customer_jid, result, created_at, expires_at
             FROM idempotency_keys
             WHERE key = $1 AND expires_at > NOW()`,
            [key]
        );

        if (result.rows.length === 0) {
            return null;
        }

        const row = result.rows[0];
        return {
            key: row.key,
            toolName: row.tool_name,
            customerJid: row.customer_jid,
            result: row.result,
            createdAt: row.created_at,
            expiresAt: row.expires_at,
        };
    }

    /**
     * Store operation result with idempotency key
     */
    async store(
        key: string,
        toolName: string,
        customerJid: string,
        result: unknown,
        ttlSeconds?: number
    ): Promise<void> {
        const ttl = ttlSeconds || this.defaultTtlSeconds;
        const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

        await this.database.query(
            `INSERT INTO idempotency_keys (key, tool_name, customer_jid, result, expires_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (key) DO UPDATE
             SET result = EXCLUDED.result,
                 expires_at = EXCLUDED.expires_at`,
            [key, toolName, customerJid, JSON.stringify(result), expiresAt]
        );

        appLogger.debug(
            { component: 'idempotency', key, toolName, customerJid },
            'idempotency_key.stored'
        );
    }

    /**
     * Execute operation with idempotency protection
     */
    async execute<T>(
        toolName: string,
        customerJid: string,
        args: Record<string, unknown>,
        operation: () => Promise<T>,
        ttlSeconds?: number
    ): Promise<T> {
        const key = this.generateKey(toolName, customerJid, args);

        // Check if already executed
        const existing = await this.check(key);
        if (existing) {
            appLogger.info(
                { component: 'idempotency', key, toolName, customerJid },
                'idempotency_key.replay'
            );
            return existing.result as T;
        }

        // Execute operation
        const result = await operation();

        // Store result
        await this.store(key, toolName, customerJid, result, ttlSeconds);

        return result;
    }

    /**
     * Clean up expired idempotency keys
     */
    async cleanup(): Promise<number> {
        const result = await this.database.query(
            'DELETE FROM idempotency_keys WHERE expires_at < NOW()'
        );
        const deletedCount = result.rowCount || 0;

        if (deletedCount > 0) {
            appLogger.info({ component: 'idempotency', deletedCount }, 'idempotency_keys.cleaned');
        }

        return deletedCount;
    }
}

// Singleton instance
const idempotencyManager = new IdempotencyManager();

export const executeIdempotent = <T>(
    toolName: string,
    customerJid: string,
    args: Record<string, unknown>,
    operation: () => Promise<T>
): Promise<T> => {
    return idempotencyManager.execute(toolName, customerJid, args, operation);
};

export const cleanupExpiredKeys = (): Promise<number> => {
    return idempotencyManager.cleanup();
};
