import { createHash } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { pool, type Database } from '../config/db.js';
import { normalizeCustomerJid } from './server.js';

const resolveJid = (jid: string) => {
    const raw = String(jid || '').trim().toLowerCase();
    return raw.endsWith('@lid') ? raw : normalizeCustomerJid(raw);
};

const anonymousJid = (jid: string) => `deleted:${createHash('sha256').update(jid).digest('hex').slice(0, 24)}`;

export interface CustomerDataExport {
    exportedAt: string;
    jid: string;
    lead: Record<string, unknown> | null;
    chatHistory: Record<string, unknown>[];
    orders: Record<string, unknown>[];
    handoffs: Record<string, unknown>[];
    inboundMessages: Record<string, unknown>[];
    outboundMessages: Record<string, unknown>[];
    media: Record<string, unknown>[];
    communicationPreference: Record<string, unknown> | null;
}

export interface CustomerDeletionResult {
    jid: string;
    anonymousJid: string;
    deletedAt: string;
    retainedOrders: number;
    recordsDeleted: Record<string, number>;
}

export const exportCustomerData = async (jid: string, database: Database = pool): Promise<CustomerDataExport> => {
    const normalized = resolveJid(jid);
    const [lead, chat, orders, handoffs, inbound, outbound, media, preference] = await Promise.all([
        database.query('SELECT * FROM leads WHERE jid = $1', [normalized]),
        database.query('SELECT * FROM chat_history WHERE jid = $1 ORDER BY created_at, id', [normalized]),
        database.query('SELECT * FROM orders WHERE jid = $1 ORDER BY created_at, id', [normalized]),
        database.query('SELECT * FROM handoff_log WHERE jid = $1 ORDER BY created_at, id', [normalized]),
        database.query('SELECT id, provider_message_id, jid, status, attempts, last_error, created_at, updated_at, completed_at FROM inbound_messages WHERE jid = $1 ORDER BY id', [normalized]),
        database.query('SELECT id, provider_message_id, jid, status, attempts, last_error, created_at, updated_at, sent_at FROM outbound_messages WHERE jid = $1 ORDER BY id', [normalized]),
        database.query('SELECT id, provider_message_id, jid, media_kind, purpose, mime_type, original_file_name, size_bytes, status, caption, transcription, error_code, created_at FROM inbound_media WHERE jid = $1 ORDER BY id', [normalized]),
        database.query('SELECT * FROM communication_preferences WHERE jid = $1', [normalized]),
    ]);
    if (!lead.rows[0] && !chat.rows[0] && !orders.rows[0] && !handoffs.rows[0]) throw new Error('Customer tidak ditemukan.');
    return {
        exportedAt: new Date().toISOString(),
        jid: normalized,
        lead: lead.rows[0] || null,
        chatHistory: chat.rows,
        orders: orders.rows,
        handoffs: handoffs.rows,
        inboundMessages: inbound.rows,
        outboundMessages: outbound.rows,
        media: media.rows,
        communicationPreference: preference.rows[0] || null,
    };
};

export const deleteCustomerData = async (
    jid: string,
    options: { retainFinancial?: boolean } = {},
    database: Database = pool,
): Promise<CustomerDeletionResult> => {
    const normalized = resolveJid(jid);
    const replacement = anonymousJid(normalized);
    const retainFinancial = options.retainFinancial !== false;
    const deletedAt = new Date().toISOString();
    const result = await database.transaction(async (transaction) => {
        const exists = await transaction.query(
            `SELECT jid FROM leads WHERE jid = $1 UNION SELECT jid FROM chat_history WHERE jid = $1 UNION SELECT jid FROM orders WHERE jid = $1 LIMIT 1`,
            [normalized],
        );
        if (!exists.rows[0]) throw new Error('Customer tidak ditemukan.');
        const recordsDeleted: Record<string, number> = {};
        const remove = async (key: string, table: string) => {
            const result = await transaction.query(`DELETE FROM ${table} WHERE jid = $1`, [normalized]);
            recordsDeleted[key] = result.rowCount || 0;
        };
        await remove('chatHistory', 'chat_history');
        await remove('handoffs', 'handoff_log');
        await remove('chatState', 'chat_state');
        await remove('inboundMessages', 'inbound_messages');
        await remove('outboundMessages', 'outbound_messages');
        await remove('inboundMediaFailures', 'inbound_media_failures');
        await remove('communicationPreferences', 'communication_preferences');
        await remove('outboundIntents', 'outbound_intents');
        const media = await transaction.query('DELETE FROM inbound_media WHERE jid = $1 RETURNING storage_path', [normalized]);
        recordsDeleted.inboundMedia = media.rowCount || 0;
        let retainedOrders = 0;
        if (retainFinancial) {
            const result = await transaction.query(
                `UPDATE orders SET jid = $1, customer_name = NULL, phone = NULL, address = NULL,
                 customer_data = $2::jsonb, updated_at = NOW() WHERE jid = $3`,
                [replacement, JSON.stringify({ anonymizedAt: deletedAt }), normalized],
            );
            retainedOrders = result.rowCount || 0;
        } else {
            const result = await transaction.query('DELETE FROM orders WHERE jid = $1', [normalized]);
            recordsDeleted.orders = result.rowCount || 0;
        }
        await remove('leads', 'leads');
        await transaction.query(
            `INSERT INTO audit_events (event_type, aggregate_type, aggregate_id, actor, data)
             VALUES ('customer.deleted', 'customer', $1, 'admin', $2::jsonb)`,
            [replacement, JSON.stringify({ retainedOrders, recordsDeleted, deletedAt })],
        );
        return { jid: normalized, anonymousJid: replacement, deletedAt, retainedOrders, recordsDeleted, mediaPaths: media.rows.map((row: any) => row.storage_path).filter(Boolean) as string[] };
    });
    const root = path.resolve(process.env.INBOUND_MEDIA_ROOT || 'data/inbound-media');
    for (const relative of result.mediaPaths) {
        const target = path.resolve(root, relative);
        if (target !== root && target.startsWith(`${root}${path.sep}`)) {
            try { await unlink(target); } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
        }
    }
    const { mediaPaths: _mediaPaths, ...publicResult } = result;
    return publicResult;
};
