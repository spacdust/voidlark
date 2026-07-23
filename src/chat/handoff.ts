import { DB_DRIVER, pool, type Database } from '../config/db.js';
import { getBusinessConfig } from '../config/business.js';

const ADMIN_JID = process.env.ADMIN_WA_JID || '';
export type HandoffPriority = 'low' | 'normal' | 'high' | 'urgent';
export type HandoffStatus = 'waiting' | 'assigned' | 'handling' | 'resolved';
type DatabaseDriver = 'sqlite' | 'postgres';

export const unresolvedHandoffPredicate = (driver: string = DB_DRIVER) => driver === 'postgres' ? 'resolved = FALSE' : 'resolved = 0';
const resolvedHandoffValue = (driver: string) => driver === 'postgres' ? 'TRUE' : '1';

const jsonParam = (value: unknown) => JSON.stringify(value);
const appendAudit = (database: Database, eventType: string, id: number, actor: string, data: Record<string, unknown>) => database.query(
    `INSERT INTO audit_events (event_type, aggregate_type, aggregate_id, actor, data)
     VALUES ($1, 'handoff', $2, $3, $4::jsonb)`,
    [eventType, String(id), actor, jsonParam(data)],
);

export class HandoffRepository {
    constructor(
        private readonly database: Database = pool,
        private readonly now: () => Date = () => new Date(),
        private readonly driver: DatabaseDriver = DB_DRIVER === 'postgres' ? 'postgres' : 'sqlite',
    ) {}

    private get unresolved() { return unresolvedHandoffPredicate(this.driver); }

    async create(jid: string, reason: string, priority: HandoffPriority = 'normal') {
        return this.database.transaction(async (transaction) => {
            const minutes = Number(getBusinessConfig().businessHours.slaMinutes[priority] || 120);
            const due = new Date(this.now().getTime() + Math.max(1, minutes) * 60_000).toISOString();
            const inserted = await transaction.query(
                `INSERT INTO handoff_log (jid, reason, status, priority, sla_due_at, updated_at)
                 VALUES ($1, $2, 'waiting', $3, $4, $5) ON CONFLICT DO NOTHING RETURNING *`,
                [jid, reason, priority, due, this.now().toISOString()],
            );
            const handoff = inserted.rows[0];
            if (!handoff) {
                const active = await transaction.query(`SELECT * FROM handoff_log WHERE jid = $1 AND ${this.unresolved} ORDER BY id DESC LIMIT 1`, [jid]);
                if (!active.rows[0]) throw new Error(`Active handoff conflict for ${jid} could not be resolved.`);
                return { handoff: active.rows[0], created: false };
            }
            await appendAudit(transaction, 'handoff.created', Number(handoff.id), 'system', { jid, reason, priority, slaDueAt: due });
            return { handoff, created: true };
        });
    }

    async assign(id: number, operator: string, actor = operator) {
        return this.database.transaction(async (transaction) => {
            const at = this.now().toISOString();
            const result = await transaction.query(
                `UPDATE handoff_log SET assigned_operator = $1, status = 'assigned', accepted_at = COALESCE(accepted_at, $2), updated_at = $3
                 WHERE id = $4 AND ${this.unresolved} AND assigned_operator IS NULL RETURNING *`,
                [operator, at, at, id],
            );
            if (!result.rows[0]) return null;
            await appendAudit(transaction, 'handoff.assigned', id, actor, { operator });
            return result.rows[0];
        });
    }

    async reassign(id: number, operator: string, actor: string) {
        return this.database.transaction(async (transaction) => {
            const current = await transaction.query(`SELECT * FROM handoff_log WHERE id = $1 AND ${this.unresolved}`, [id]);
            if (!current.rows[0]) return null;
            const at = this.now().toISOString();
            const result = await transaction.query("UPDATE handoff_log SET assigned_operator = $1, status = 'assigned', accepted_at = $2, updated_at = $3 WHERE id = $4 RETURNING *", [operator, at, at, id]);
            await appendAudit(transaction, 'handoff.reassigned', id, actor, { from: current.rows[0].assigned_operator, to: operator });
            return result.rows[0];
        });
    }

    async startHandling(id: number, operator: string) {
        const at = this.now().toISOString();
        const result = await this.database.query(
            `UPDATE handoff_log SET status = 'handling', first_response_at = COALESCE(first_response_at, $1), updated_at = $2
             WHERE id = $3 AND assigned_operator = $4 AND status IN ('assigned', 'handling') AND ${this.unresolved} RETURNING *`,
            [at, at, id, operator],
        );
        if (result.rows[0]) await appendAudit(this.database, 'handoff.handling', id, operator, {});
        return result.rows[0] || null;
    }

    async resolveById(id: number, actor: string, note = '') {
        return this.database.transaction(async (transaction) => {
            const current = await transaction.query(`SELECT * FROM handoff_log WHERE id = $1 AND ${this.unresolved}`, [id]);
            if (!current.rows[0]) return null;
            const at = this.now().toISOString();
            const result = await transaction.query(
                `UPDATE handoff_log SET resolved = ${resolvedHandoffValue(this.driver)}, status = 'resolved', resolved_at = $1, resolution_note = $2, updated_at = $3 WHERE id = $4 RETURNING *`,
                [at, note, at, id],
            );
            await appendAudit(transaction, 'handoff.resolved', id, actor, { note, operator: current.rows[0].assigned_operator });
            return result.rows[0];
        });
    }

    async resolveByJid(jid: string, actor = 'admin', note = '') {
        const current = await this.database.query(`SELECT id FROM handoff_log WHERE jid = $1 AND ${this.unresolved} ORDER BY id DESC LIMIT 1`, [jid]);
        return current.rows[0] ? this.resolveById(Number(current.rows[0].id), actor, note) : null;
    }

    async listActive(limit = 100) {
        const result = await this.database.query(
            `SELECT h.*, 
                    (SELECT c.content FROM chat_history c WHERE c.jid = h.jid AND c.role = 'user' ORDER BY c.created_at DESC, c.id DESC LIMIT 1) AS last_message,
                    CASE WHEN h.sla_due_at IS NOT NULL AND h.sla_due_at <= $1 THEN 1 ELSE 0 END AS sla_breached
             FROM handoff_log h WHERE ${this.unresolved}
             ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, sla_due_at, created_at LIMIT $2`,
            [this.now().toISOString(), limit],
        );
        return result.rows;
    }
}

export const handoffRepository = new HandoffRepository();
export const logHandoff = async (jid: string, reason: string, priority: HandoffPriority = 'normal') => handoffRepository.create(jid, reason, priority);
export const isHandoffActive = async (jid: string): Promise<boolean> => (await pool.query(`SELECT 1 FROM handoff_log WHERE jid = $1 AND ${unresolvedHandoffPredicate()} LIMIT 1`, [jid])).rows.length > 0;
export const resolveHandoff = async (jid: string, actor = 'admin', note = '') => handoffRepository.resolveByJid(jid, actor, note);
export const getAdminJid = () => process.env.ADMIN_WA_JID || ADMIN_JID;
