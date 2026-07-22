// ============================================================================
// Customer Data Export & Deletion (Fase 6: Privacy & GDPR Compliance)
// ============================================================================

import { pool, type Database } from '../config/db.js';
import { appLogger } from '../config/logger.js';
import { normalizeCustomerJid } from './server.js';

const resolveJid = (jid: string) => {
    const raw = String(jid || '').trim().toLowerCase();
    if (raw.endsWith('@lid')) return raw;
    return normalizeCustomerJid(jid);
};

export interface CustomerDataExport {
    customer: {
        jid: string;
        name: string | null;
        createdAt: string;
        lastSeenAt: string;
        consentStatus: string | null;
        consentedAt: string | null;
    };
    conversations: Array<{
        id: number;
        role: 'user' | 'assistant';
        content: string;
        timestamp: string;
    }>;
    orders: Array<{
        id: number;
        status: string;
        summary: string | null;
        createdAt: string;
        paidAt: string | null;
        totalAmount: number | null;
    }>;
    leads: Array<{
        id: number;
        type: string;
        data: Record<string, unknown>;
        createdAt: string;
    }>;
    handoffs: Array<{
        id: number;
        reason: string;
        status: string;
        createdAt: string;
        resolvedAt: string | null;
    }>;
    inboundMessages: Array<{
        id: number;
        providerId: string;
        status: string;
        receivedAt: string;
    }>;
    outboundMessages: Array<{
        id: number;
        providerId: string | null;
        status: string;
        sentAt: string | null;
    }>;
}

export interface CustomerDeletionResult {
    jid: string;
    deletedAt: string;
    recordsDeleted: {
        chatHistory: number;
        orders: number;
        leads: number;
        handoffs: number;
        inboundMessages: number;
        outboundMessages: number;
        draftOrders: number;
        customerState: number;
    };
    auditLogId: number;
}

/**
 * Export all customer data for GDPR/privacy compliance
 */
export const exportCustomerData = async (jid: string, database: Database = pool): Promise<CustomerDataExport> => {
    const normalizedJid = resolveJid(jid);

    const [customer, conversations, orders, leads, handoffs, inbound, outbound] = await Promise.all([
        // Customer profile
        database.query('SELECT jid, name, created_at, last_seen_at, consent_status, consented_at FROM customers WHERE jid = $1', [normalizedJid]).then((r) => r.rows[0]),
        
        // Chat history
        database.query(
            'SELECT id, role, content, timestamp FROM chat_history WHERE customer_jid = $1 ORDER BY timestamp ASC',
            [normalizedJid]
        ).then((r) => r.rows),
        
        // Orders
        database.query(
            'SELECT id, status, summary, created_at, paid_at, total_amount FROM orders WHERE customer_jid = $1 ORDER BY created_at DESC',
            [normalizedJid]
        ).then((r) => r.rows),
        
        // Leads
        database.query(
            'SELECT id, type, data, created_at FROM leads WHERE customer_jid = $1 ORDER BY created_at DESC',
            [normalizedJid]
        ).then((r) => r.rows),
        
        // Handoffs
        database.query(
            'SELECT id, reason, status, created_at, resolved_at FROM handoffs WHERE customer_jid = $1 ORDER BY created_at DESC',
            [normalizedJid]
        ).then((r) => r.rows),
        
        // Inbound messages
        database.query(
            'SELECT id, provider_message_id, status, received_at FROM inbound_messages WHERE customer_jid = $1 ORDER BY received_at DESC',
            [normalizedJid]
        ).then((r) => r.rows),
        
        // Outbound messages
        database.query(
            'SELECT id, provider_message_id, status, sent_at FROM outbound_messages WHERE customer_jid = $1 ORDER BY sent_at DESC',
            [normalizedJid]
        ).then((r) => r.rows),
    ]);

    if (!customer) {
        throw new Error('Customer tidak ditemukan.');
    }

    appLogger.info({ component: 'customer-data', jid: normalizedJid }, 'customer_data.exported');

    return {
        customer: {
            jid: customer.jid,
            name: customer.name,
            createdAt: customer.created_at,
            lastSeenAt: customer.last_seen_at,
            consentStatus: customer.consent_status,
            consentedAt: customer.consented_at,
        },
        conversations: conversations.map((row) => ({
            id: row.id,
            role: row.role,
            content: row.content,
            timestamp: row.timestamp,
        })),
        orders: orders.map((row) => ({
            id: row.id,
            status: row.status,
            summary: row.summary,
            createdAt: row.created_at,
            paidAt: row.paid_at,
            totalAmount: row.total_amount,
        })),
        leads: leads.map((row) => ({
            id: row.id,
            type: row.type,
            data: row.data,
            createdAt: row.created_at,
        })),
        handoffs: handoffs.map((row) => ({
            id: row.id,
            reason: row.reason,
            status: row.status,
            createdAt: row.created_at,
            resolvedAt: row.resolved_at,
        })),
        inboundMessages: inbound.map((row) => ({
            id: row.id,
            providerId: row.provider_message_id,
            status: row.status,
            receivedAt: row.received_at,
        })),
        outboundMessages: outbound.map((row) => ({
            id: row.id,
            providerId: row.provider_message_id,
            status: row.status,
            sentAt: row.sent_at,
        })),
    };
};

/**
 * Delete or anonymize customer data
 * Financial records are retained per legal requirements
 */
export const deleteCustomerData = async (
    jid: string,
    options: { anonymize?: boolean; retainFinancial?: boolean } = {},
    database: Database = pool
): Promise<CustomerDeletionResult> => {
    const normalizedJid = resolveJid(jid);
    const { anonymize = false, retainFinancial = true } = options;
    const deletedAt = new Date().toISOString();

    const result = await database.transaction(async (transaction) => {
        // Check if customer exists
        const customer = await transaction.query('SELECT id FROM customers WHERE jid = $1', [normalizedJid]);
        if (customer.rows.length === 0) {
            throw new Error('Customer tidak ditemukan.');
        }

        const recordsDeleted = {
            chatHistory: 0,
            orders: 0,
            leads: 0,
            handoffs: 0,
            inboundMessages: 0,
            outboundMessages: 0,
            draftOrders: 0,
            customerState: 0,
        };

        if (anonymize) {
            // Anonymize instead of delete
            await transaction.query(
                `UPDATE customers 
                 SET name = 'Anonymized', 
                     consent_status = 'deleted',
                     consented_at = $1
                 WHERE jid = $2`,
                [deletedAt, normalizedJid]
            );

            await transaction.query(
                'UPDATE chat_history SET content = \'[Deleted]\' WHERE customer_jid = $1',
                [normalizedJid]
            );
            recordsDeleted.chatHistory = 1; // Mark as processed
        } else {
            // Hard delete
            const deleteChatHistory = await transaction.query('DELETE FROM chat_history WHERE customer_jid = $1', [normalizedJid]);
            recordsDeleted.chatHistory = deleteChatHistory.rowCount || 0;

            const deleteLeads = await transaction.query('DELETE FROM leads WHERE customer_jid = $1', [normalizedJid]);
            recordsDeleted.leads = deleteLeads.rowCount || 0;

            const deleteHandoffs = await transaction.query('DELETE FROM handoffs WHERE customer_jid = $1', [normalizedJid]);
            recordsDeleted.handoffs = deleteHandoffs.rowCount || 0;

            const deleteInbound = await transaction.query('DELETE FROM inbound_messages WHERE customer_jid = $1', [normalizedJid]);
            recordsDeleted.inboundMessages = deleteInbound.rowCount || 0;

            const deleteOutbound = await transaction.query('DELETE FROM outbound_messages WHERE customer_jid = $1', [normalizedJid]);
            recordsDeleted.outboundMessages = deleteOutbound.rowCount || 0;

            const deleteDrafts = await transaction.query('DELETE FROM draft_orders WHERE customer_jid = $1', [normalizedJid]);
            recordsDeleted.draftOrders = deleteDrafts.rowCount || 0;

            const deleteState = await transaction.query('DELETE FROM customer_state WHERE customer_jid = $1', [normalizedJid]);
            recordsDeleted.customerState = deleteState.rowCount || 0;
        }

        // Handle orders based on financial retention policy
        if (retainFinancial) {
            // Anonymize orders but keep financial records
            const updateOrders = await transaction.query(
                `UPDATE orders 
                 SET summary = '[Anonymized]'
                 WHERE customer_jid = $1`,
                [normalizedJid]
            );
            recordsDeleted.orders = updateOrders.rowCount || 0;
        } else {
            // Delete all orders (only if legally permitted)
            const deleteOrders = await transaction.query('DELETE FROM orders WHERE customer_jid = $1', [normalizedJid]);
            recordsDeleted.orders = deleteOrders.rowCount || 0;
        }

        // Audit log entry
        const auditResult = await transaction.query(
            `INSERT INTO audit_events (event_type, actor, entity_type, entity_id, details, timestamp)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [
                anonymize ? 'customer_anonymized' : 'customer_deleted',
                'admin',
                'customer',
                normalizedJid,
                JSON.stringify({ recordsDeleted, retainFinancial }),
                deletedAt,
            ]
        );

        appLogger.warn(
            { 
                component: 'customer-data', 
                jid: normalizedJid, 
                anonymize, 
                retainFinancial, 
                recordsDeleted 
            },
            anonymize ? 'customer_data.anonymized' : 'customer_data.deleted'
        );

        return {
            jid: normalizedJid,
            deletedAt,
            recordsDeleted,
            auditLogId: auditResult.rows[0].id,
        };
    });

    return result;
};
