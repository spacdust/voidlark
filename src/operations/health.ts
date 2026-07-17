import type { Database } from '../config/db.js';
import { getWaStatus } from '../whatsapp/status.js';
import { evaluateSLOsAndAlert, operationalMetrics } from './metrics.js';

export const liveness = () => ({ status: 'ok' as const, uptimeSeconds: Math.round(process.uptime()) });
export type ReadinessOptions = {
    getWaStatus?: typeof getWaStatus;
    maxInboundDepth?: number;
    maxOutboundDepth?: number;
    now?: () => Date;
};

const queueLimit = (value: number | undefined, environment: string) => {
    const configured = value ?? Number(process.env[environment] || 1_000);
    return Number.isFinite(configured) && configured >= 0 ? configured : 1_000;
};

export const readiness = async (database: Database, options: ReadinessOptions = {}) => {
    const started = Date.now();
    try {
        const [, inbound, outbound, latestBackup] = await Promise.all([
            database.query('SELECT 1'),
            database.query("SELECT COUNT(*) AS count FROM inbound_messages WHERE status IN ('queued', 'retry', 'processing')"),
            database.query("SELECT COUNT(*) AS count FROM outbound_messages WHERE status IN ('queued', 'failed', 'sending')"),
            database.query("SELECT completed_at FROM backup_runs WHERE status = 'succeeded' ORDER BY id DESC LIMIT 1"),
        ]);
        const inboundDepth = Number(inbound.rows[0]?.count || 0);
        const outboundDepth = Number(outbound.rows[0]?.count || 0);
        const completedAt = latestBackup.rows[0]?.completed_at ? new Date(latestBackup.rows[0].completed_at).getTime() : 0;
        const now = (options.now || (() => new Date()))().getTime();
        const backupAgeSeconds = completedAt ? Math.max(0, (now - completedAt) / 1000) : Number.POSITIVE_INFINITY;
        const limits = { inbound: queueLimit(options.maxInboundDepth, 'READINESS_MAX_INBOUND_DEPTH'), outbound: queueLimit(options.maxOutboundDepth, 'READINESS_MAX_OUTBOUND_DEPTH') };
        const queuesReady = inboundDepth <= limits.inbound && outboundDepth <= limits.outbound;
        operationalMetrics.queueDepth('inbound', 'ready', inboundDepth);
        operationalMetrics.queueDepth('outbound', 'ready', outboundDepth);
        if (Number.isFinite(backupAgeSeconds)) operationalMetrics.backupSuccess(completedAt);
        evaluateSLOsAndAlert({ inboundQueueDepth: inboundDepth, outboundQueueDepth: outboundDepth, backupAgeSeconds });
        const wa = (options.getWaStatus || getWaStatus)();
        const waReady = wa.state === 'open';
        const ready = waReady && queuesReady;
        return { ready, status: ready ? 'ready' as const : 'not_ready' as const, checks: { database: { status: 'ok', latencyMs: Date.now() - started }, whatsapp: { status: waReady ? 'ok' : 'not_ready', state: wa.state, lastUpdate: wa.lastUpdate }, queues: { status: queuesReady ? 'ok' as const : 'backlogged' as const, inboundDepth, outboundDepth, limits }, backup: { ageSeconds: Number.isFinite(backupAgeSeconds) ? Math.round(backupAgeSeconds) : null } } };
    } catch {
        return { ready: false, status: 'not_ready' as const, checks: { database: { status: 'error', latencyMs: Date.now() - started } } };
    }
};
