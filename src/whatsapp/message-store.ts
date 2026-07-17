import { randomUUID } from 'node:crypto';
import { DB_DRIVER, pool } from '../config/db.js';
import { canSendCommunication, type CommunicationCategory } from '../chat/consent.js';

type QueryResult = { rows: any[]; rowCount: number };
export type MessageStoreDatabase = {
    query: (sql: string, params?: any[]) => Promise<QueryResult>;
};

export type MessageStatus = 'queued' | 'processing' | 'retry' | 'completed' | 'dead_letter';
export type OutboundMessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'dead_letter';

export interface StoredMessage {
    id: number;
    provider_message_id: string | null;
    jid: string;
    payload: unknown;
    status: MessageStatus | OutboundMessageStatus;
    attempts: number;
    max_attempts: number;
    available_at: string;
    lease_until: string | null;
    lease_token: string | null;
    last_error: string | null;
    post_send_action?: unknown;
    post_send_status?: 'pending' | 'processing' | 'completed' | null;
}

export interface PostSendAction {
    outboundMessageId: number;
    action: unknown;
}

export interface MessageStoreOptions {
    database?: MessageStoreDatabase;
    driver?: string;
    now?: () => Date;
    random?: () => number;
    baseBackoffMs?: number;
    maxBackoffMs?: number;
    canSend?: (jid: string, category: CommunicationCategory) => Promise<boolean>;
}

const parseMessage = (row: any): StoredMessage | null => {
    if (!row) return null;
    let payload = row.payload;
    if (typeof payload === 'string') {
        try {
            payload = JSON.parse(payload);
        } catch {
            // Preserve non-JSON payloads written by older or external producers.
        }
    }
    return { ...row, id: Number(row.id), attempts: Number(row.attempts), max_attempts: Number(row.max_attempts), payload };
};

export class MessageStore {
    private readonly database: MessageStoreDatabase;
    private readonly driver: string;
    private readonly now: () => Date;
    private readonly random: () => number;
    private readonly baseBackoffMs: number;
    private readonly maxBackoffMs: number;
    private readonly canSend: (jid: string, category: CommunicationCategory) => Promise<boolean>;

    constructor(options: MessageStoreOptions = {}) {
        this.database = options.database || pool;
        this.driver = (options.driver || DB_DRIVER).toLowerCase();
        this.now = options.now || (() => new Date());
        this.random = options.random || Math.random;
        this.baseBackoffMs = options.baseBackoffMs ?? 1_000;
        this.maxBackoffMs = options.maxBackoffMs ?? 15 * 60_000;
        this.canSend = options.canSend || canSendCommunication;
    }

    async enqueueInbound(providerMessageId: string, jid: string, payload: unknown, maxAttempts = 5): Promise<{ message: StoredMessage; inserted: boolean }> {
        const result = await this.database.query(
            `INSERT INTO inbound_messages (provider_message_id, jid, payload, max_attempts)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (provider_message_id) DO NOTHING
             RETURNING *`,
            [providerMessageId, jid, JSON.stringify(payload), maxAttempts],
        );
        if (result.rows[0]) return { message: parseMessage(result.rows[0])!, inserted: true };
        const existing = await this.database.query('SELECT * FROM inbound_messages WHERE provider_message_id = $1', [providerMessageId]);
        return { message: parseMessage(existing.rows[0])!, inserted: false };
    }

    async claimInbound(leaseMs = 30_000, excludedJids: string[] = []): Promise<StoredMessage | null> {
        return this.claim('inbound_messages', 'processing', ['queued', 'retry', 'processing'], leaseMs, excludedJids);
    }

    async completeInbound(id: number, leaseToken?: string): Promise<boolean> {
        return this.finishLease('inbound_messages', id, 'completed', 'completed_at', leaseToken);
    }

    async failInbound(id: number, error: unknown, leaseToken?: string): Promise<StoredMessage | null> {
        const current = await this.getLeased('inbound_messages', id, leaseToken);
        if (!current) return null;
        const attempts = current.attempts + 1;
        const dead = attempts >= current.max_attempts;
        const availableAt = dead ? this.now() : new Date(this.now().getTime() + this.backoffMs(attempts));
        const result = await this.database.query(
            `UPDATE inbound_messages SET status = $1, attempts = $2, available_at = $3, lease_until = NULL,
             lease_token = NULL, last_error = $4, updated_at = $5 WHERE id = $6${leaseToken ? ' AND lease_token = $7' : ''} RETURNING *`,
            [dead ? 'dead_letter' : 'retry', attempts, availableAt.toISOString(), this.errorText(error), this.now().toISOString(), id, ...(leaseToken ? [leaseToken] : [])],
        );
        return parseMessage(result.rows[0]);
    }

    async deadLetterInbound(id: number, error: unknown, leaseToken?: string): Promise<StoredMessage | null> {
        const now = this.now().toISOString();
        const result = await this.database.query(
            `UPDATE inbound_messages SET status = 'dead_letter', attempts = max_attempts, lease_until = NULL,
             lease_token = NULL, last_error = $1, updated_at = $2
             WHERE id = $3 AND status = 'processing'${leaseToken ? ' AND lease_token = $4' : ''} RETURNING *`,
            [this.errorText(error), now, id, ...(leaseToken ? [leaseToken] : [])],
        );
        return parseMessage(result.rows[0]);
    }

    async listInboundFailures(limit = 100): Promise<StoredMessage[]> {
        const result = await this.database.query(
            `SELECT * FROM inbound_messages WHERE status IN ('retry', 'dead_letter') ORDER BY updated_at DESC, id DESC LIMIT $1`,
            [limit],
        );
        return result.rows.map(parseMessage) as StoredMessage[];
    }

    async listOutboundFailures(limit = 100): Promise<StoredMessage[]> {
        const result = await this.database.query(
            `SELECT * FROM outbound_messages WHERE status IN ('failed', 'dead_letter') ORDER BY updated_at DESC, id DESC LIMIT $1`,
            [limit],
        );
        return result.rows.map(parseMessage) as StoredMessage[];
    }

    async retryOutboundFailure(id: number, replacementJid?: string): Promise<boolean> {
        const missingOperatorTarget = 'ADMIN_WA_JID';
        const target = replacementJid?.trim() || null;
        const current = await this.database.query(
            `SELECT * FROM outbound_messages WHERE id = $1 AND status IN ('failed', 'dead_letter')`,
            [id],
        );
        const message = parseMessage(current.rows[0]);
        if (!message || (message.jid === missingOperatorTarget && !target)) return false;
        const jid = message.jid === missingOperatorTarget ? target! : message.jid;
        const result = await this.database.query(
            `UPDATE outbound_messages SET status = 'queued', attempts = 0, available_at = $1, lease_until = NULL,
             lease_token = NULL, last_error = NULL, updated_at = $2, jid = $3
             WHERE id = $4 AND status IN ('failed', 'dead_letter')`,
            [this.now().toISOString(), this.now().toISOString(), jid, id],
        );
        return result.rowCount > 0;
    }

    async retryInboundFailure(id: number): Promise<boolean> {
        const result = await this.database.query(
            `UPDATE inbound_messages SET status = 'queued', attempts = 0, available_at = $1, lease_until = NULL,
             lease_token = NULL, last_error = NULL, updated_at = $2
             WHERE id = $3 AND status IN ('retry', 'dead_letter')`,
            [this.now().toISOString(), this.now().toISOString(), id],
        );
        return result.rowCount === 1;
    }

    async enqueueOutbound(jid: string, payload: unknown, options: { dedupeKey?: string; maxAttempts?: number; category?: CommunicationCategory; postSendAction?: unknown } = {}): Promise<{ message: StoredMessage; inserted: boolean }> {
        if (!await this.canSend(jid, options.category || 'transactional')) {
            throw new SuppressedCommunicationError(jid, options.category || 'transactional');
        }
        const dedupeKey = options.dedupeKey || null;
        const result = await this.database.query(
            `INSERT INTO outbound_messages (dedupe_key, jid, payload, max_attempts, post_send_action, post_send_status)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (dedupe_key) DO NOTHING RETURNING *`,
            [dedupeKey, jid, JSON.stringify(payload), options.maxAttempts ?? 5,
                options.postSendAction === undefined ? null : JSON.stringify(options.postSendAction),
                options.postSendAction === undefined ? null : 'pending'],
        );
        if (result.rows[0]) return { message: parseMessage(result.rows[0])!, inserted: true };
        const existing = await this.database.query('SELECT * FROM outbound_messages WHERE dedupe_key = $1', [dedupeKey]);
        return { message: parseMessage(existing.rows[0])!, inserted: false };
    }

    async enqueuePermanentOutboundFailure(
        jid: string,
        payload: unknown,
        error: unknown,
        options: { dedupeKey?: string } = {},
    ): Promise<{ message: StoredMessage; inserted: boolean }> {
        const dedupeKey = options.dedupeKey || null;
        const result = await this.database.query(
            `INSERT INTO outbound_messages (dedupe_key, jid, payload, status, attempts, max_attempts, last_error)
             VALUES ($1, $2, $3, 'dead_letter', 1, 1, $4)
             ON CONFLICT (dedupe_key) DO NOTHING RETURNING *`,
            [dedupeKey, jid, JSON.stringify(payload), this.errorText(error)],
        );
        if (result.rows[0]) return { message: parseMessage(result.rows[0])!, inserted: true };
        const existing = await this.database.query('SELECT * FROM outbound_messages WHERE dedupe_key = $1', [dedupeKey]);
        return { message: parseMessage(existing.rows[0])!, inserted: false };
    }

    async claimOutbound(leaseMs = 30_000): Promise<StoredMessage | null> {
        return this.claim('outbound_messages', 'sending', ['queued', 'failed', 'sending'], leaseMs);
    }

    async markOutboundSent(id: number, providerMessageId: string, leaseToken?: string): Promise<StoredMessage | null> {
        const now = this.now().toISOString();
        const result = await this.database.query(
            `UPDATE outbound_messages SET status = 'sent', provider_message_id = $1, lease_until = NULL,
             lease_token = NULL, last_error = NULL, sent_at = $2, updated_at = $3
             WHERE id = $4 AND status = 'sending'${leaseToken ? ' AND lease_token = $5' : ''} RETURNING *`,
            [providerMessageId, now, now, id, ...(leaseToken ? [leaseToken] : [])],
        );
        return parseMessage(result.rows[0]);
    }

    async claimPostSendAction(): Promise<PostSendAction | null> {
        const now = this.now().toISOString();
        const result = await this.database.query(
            `UPDATE outbound_messages SET post_send_status = 'processing', updated_at = $1
             WHERE id = (SELECT id FROM outbound_messages
                 WHERE status IN ('sent', 'delivered', 'read') AND post_send_action IS NOT NULL
                 AND post_send_status = 'pending' ORDER BY sent_at, id LIMIT 1)
             AND post_send_status = 'pending' RETURNING id, post_send_action`,
            [now],
        );
        const row = result.rows[0];
        if (!row) return null;
        let action = row.post_send_action;
        if (typeof action === 'string') action = JSON.parse(action);
        return { outboundMessageId: Number(row.id), action };
    }

    async completePostSendAction(outboundMessageId: number): Promise<boolean> {
        const result = await this.database.query(
            `UPDATE outbound_messages SET post_send_status = 'completed', updated_at = $1
             WHERE id = $2 AND post_send_status = 'processing'`,
            [this.now().toISOString(), outboundMessageId],
        );
        return result.rowCount === 1;
    }

    async retryPostSendAction(outboundMessageId: number, error: unknown): Promise<boolean> {
        const result = await this.database.query(
            `UPDATE outbound_messages SET post_send_status = 'pending', last_error = $1, updated_at = $2
             WHERE id = $3 AND post_send_status = 'processing'`,
            [this.errorText(error), this.now().toISOString(), outboundMessageId],
        );
        return result.rowCount === 1;
    }

    async getPostSendActionStatus(outboundMessageId: number): Promise<string | null> {
        const result = await this.database.query('SELECT post_send_status FROM outbound_messages WHERE id = $1', [outboundMessageId]);
        return result.rows[0]?.post_send_status || null;
    }

    async failOutbound(id: number, error: unknown, leaseToken?: string): Promise<StoredMessage | null> {
        const current = await this.getLeased('outbound_messages', id, leaseToken);
        if (!current) return null;
        const attempts = current.attempts + 1;
        const dead = attempts >= current.max_attempts;
        const now = this.now();
        const availableAt = dead ? now : new Date(now.getTime() + this.backoffMs(attempts));
        const result = await this.database.query(
            `UPDATE outbound_messages SET status = $1, attempts = $2, available_at = $3, lease_until = NULL,
             lease_token = NULL, last_error = $4, updated_at = $5 WHERE id = $6${leaseToken ? ' AND lease_token = $7' : ''} RETURNING *`,
            [dead ? 'dead_letter' : 'failed', attempts, availableAt.toISOString(), this.errorText(error), now.toISOString(), id, ...(leaseToken ? [leaseToken] : [])],
        );
        return parseMessage(result.rows[0]);
    }

    async getOutboundStatusByProviderId(providerMessageId: string): Promise<StoredMessage | null> {
        const result = await this.database.query('SELECT * FROM outbound_messages WHERE provider_message_id = $1', [providerMessageId]);
        return parseMessage(result.rows[0]);
    }

    async updateOutboundReceipt(providerMessageId: string, status: 'delivered' | 'read'): Promise<boolean> {
        const eligibleStatuses = status === 'read' ? "('sent', 'delivered')" : "('sent')";
        const result = await this.database.query(
            `UPDATE outbound_messages SET status = $1, updated_at = $2 WHERE provider_message_id = $3
             AND status IN ${eligibleStatuses}`,
            [status, this.now().toISOString(), providerMessageId],
        );
        return result.rowCount > 0;
    }

    private async claim(table: 'inbound_messages' | 'outbound_messages', status: string, eligible: string[], leaseMs: number, excludedJids: string[] = []): Promise<StoredMessage | null> {
        const now = this.now();
        const leaseToken = randomUUID();
        const placeholders = eligible.map((_, index) => `$${index + 5}`).join(', ');
        const availableParam = eligible.length + 5;
        const innerLeaseParam = eligible.length + 6;
        const excludedStart = eligible.length + 7;
        const outerLeaseParam = excludedStart + excludedJids.length;
        const jidFilter = excludedJids.length ? ` AND jid NOT IN (${excludedJids.map((_, index) => `$${excludedStart + index}`).join(', ')})` : '';
        const result = await this.database.query(
            `UPDATE ${table} SET status = $1, lease_until = $2, lease_token = $3, updated_at = $4
             WHERE id = (SELECT id FROM ${table} WHERE status IN (${placeholders}) AND available_at <= $${availableParam}
             AND (lease_until IS NULL OR lease_until <= $${innerLeaseParam})${jidFilter} ORDER BY available_at, id LIMIT 1)
             AND (lease_until IS NULL OR lease_until <= $${outerLeaseParam}) RETURNING *`,
            [status, new Date(now.getTime() + leaseMs).toISOString(), leaseToken, now.toISOString(), ...eligible,
                now.toISOString(), now.toISOString(), ...excludedJids, now.toISOString()],
        );
        return parseMessage(result.rows[0]);
    }

    private async finishLease(table: string, id: number, status: string, finishedColumn: string, leaseToken?: string): Promise<boolean> {
        const now = this.now().toISOString();
        const result = await this.database.query(
            `UPDATE ${table} SET status = $1, lease_until = NULL, lease_token = NULL, last_error = NULL,
             ${finishedColumn} = $2, updated_at = $3 WHERE id = $4 AND status IN ('processing', 'sending')${leaseToken ? ' AND lease_token = $5' : ''}`,
            [status, now, now, id, ...(leaseToken ? [leaseToken] : [])],
        );
        return result.rowCount === 1;
    }

    private async getLeased(table: string, id: number, leaseToken?: string): Promise<StoredMessage | null> {
        const result = await this.database.query(
            `SELECT * FROM ${table} WHERE id = $1${leaseToken ? ' AND lease_token = $2' : ''}`,
            [id, ...(leaseToken ? [leaseToken] : [])],
        );
        return parseMessage(result.rows[0]);
    }

    private backoffMs(attempts: number): number {
        const exponential = Math.min(this.maxBackoffMs, this.baseBackoffMs * (2 ** Math.max(0, attempts - 1)));
        return Math.round(exponential * (0.5 + this.random()));
    }

    private errorText(error: unknown): string {
        return (error instanceof Error ? error.message : String(error)).slice(0, 4_000);
    }
}

export class SuppressedCommunicationError extends Error {
    constructor(jid: string, category: CommunicationCategory) {
        super(`${category} communication suppressed for ${jid}`);
        this.name = 'SuppressedCommunicationError';
    }
}

export const messageStore = new MessageStore();
