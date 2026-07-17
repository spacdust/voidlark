import { appLogger } from '../config/logger.js';

type Labels = Record<string, string | number>;
type MetricType = 'counter' | 'gauge' | 'histogram';
type Definition = { name: string; help: string; type: MetricType; labels: string[]; buckets?: number[] };

const definitions: Definition[] = [
    { name: 'voidlark_http_requests_total', help: 'HTTP requests.', type: 'counter', labels: ['method', 'route', 'status_class'] },
    { name: 'voidlark_http_request_duration_seconds', help: 'HTTP request duration.', type: 'histogram', labels: ['method', 'route'], buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5] },
    { name: 'voidlark_db_queries_total', help: 'Database queries.', type: 'counter', labels: ['operation', 'result'] },
    { name: 'voidlark_db_query_duration_seconds', help: 'Database query duration.', type: 'histogram', labels: ['operation'], buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5] },
    { name: 'voidlark_queue_depth', help: 'Durable queue depth.', type: 'gauge', labels: ['direction', 'state'] },
    { name: 'voidlark_queue_processing_duration_seconds', help: 'Queue processing duration.', type: 'histogram', labels: ['direction'], buckets: [0.01, 0.1, 0.5, 1, 5, 15, 60, 300] },
    { name: 'voidlark_queue_failures_total', help: 'Queue processing failures.', type: 'counter', labels: ['direction', 'terminal'] },
    { name: 'voidlark_ai_calls_total', help: 'AI calls.', type: 'counter', labels: ['result'] },
    { name: 'voidlark_ai_call_duration_seconds', help: 'AI call duration.', type: 'histogram', labels: [], buckets: [0.1, 0.5, 1, 2.5, 5, 15, 30, 60, 120] },
    { name: 'voidlark_knowledge_ingestions_total', help: 'Knowledge ingestion jobs.', type: 'counter', labels: ['result'] },
    { name: 'voidlark_knowledge_ingestion_duration_seconds', help: 'Knowledge ingestion duration.', type: 'histogram', labels: [], buckets: [0.1, 1, 5, 15, 60, 300] },
    { name: 'voidlark_backup_age_seconds', help: 'Age of latest successful backup.', type: 'gauge', labels: [] },
    { name: 'voidlark_backup_failures_total', help: 'Database backup failures.', type: 'counter', labels: ['driver'] },
    { name: 'voidlark_wa_reconnects_total', help: 'WhatsApp reconnect attempts.', type: 'counter', labels: ['reason'] },
    { name: 'voidlark_slo_breaches_total', help: 'SLO breaches.', type: 'counter', labels: ['slo'] },
];

const allowed: Record<string, Set<string>> = {
    method: new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'OTHER']),
    status_class: new Set(['1xx', '2xx', '3xx', '4xx', '5xx']), operation: new Set(['select', 'insert', 'update', 'delete', 'transaction', 'other']),
    result: new Set(['success', 'error', 'duplicate']), direction: new Set(['inbound', 'outbound']), state: new Set(['ready', 'retry', 'processing', 'dead_letter']),
    terminal: new Set(['true', 'false']), driver: new Set(['sqlite', 'postgres']),
};
const series = new Map<string, { definition: Definition; labels: Record<string, string>; value: number; count: number; sum: number; buckets: number[] }>();
const escape = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');
const normalize = (key: string, value: unknown) => {
    const raw = String(value ?? 'unknown');
    if (key === 'route') return raw.startsWith('/admin') ? '/admin/*' : ['/metrics', '/health', '/health/live', '/health/ready', '/webhooks/payment', '/'].includes(raw) ? raw : 'other';
    if (key === 'reason') return ['logged_out', 'conflict', 'timeout', 'stream_restart', 'other'].includes(raw) ? raw : 'other';
    if (key === 'slo') return raw.replace(/[^a-z0-9_]/gi, '_').slice(0, 48) || 'unknown';
    return allowed[key]?.has(raw) ? raw : (allowed[key]?.has('OTHER') ? 'OTHER' : 'unknown');
};
const get = (name: string, labels: Labels = {}) => {
    const definition = definitions.find((item) => item.name === name);
    if (!definition) throw new Error(`Unknown metric: ${name}`);
    const normalized = Object.fromEntries(definition.labels.map((label) => [label, normalize(label, labels[label])]));
    const key = `${name}|${definition.labels.map((label) => normalized[label]).join('|')}`;
    let item = series.get(key);
    if (!item) {
        item = { definition, labels: normalized, value: 0, count: 0, sum: 0, buckets: (definition.buckets || []).map(() => 0) };
        series.set(key, item);
    }
    return item;
};
const labelText = (labels: Record<string, string>, extra: Record<string, string> = {}) => {
    const entries = Object.entries({ ...labels, ...extra });
    return entries.length ? `{${entries.map(([key, value]) => `${key}="${escape(value)}"`).join(',')}}` : '';
};

export const metricsRegistry = {
    increment(name: string, labels: Labels = {}, value = 1) { get(name, labels).value += value; },
    set(name: string, labels: Labels = {}, value = 0) { get(name, labels).value = Number.isFinite(value) ? value : 0; },
    observe(name: string, labels: Labels = {}, value = 0) {
        const item = get(name, labels); item.count += 1; item.sum += value;
        item.definition.buckets?.forEach((bucket, index) => { if (value <= bucket) item.buckets[index] += 1; });
    },
    render() {
        const lines: string[] = [];
        for (const definition of definitions) {
            lines.push(`# HELP ${definition.name} ${definition.help}`, `# TYPE ${definition.name} ${definition.type}`);
            for (const item of [...series.values()].filter((entry) => entry.definition === definition)) {
                if (definition.type !== 'histogram') lines.push(`${definition.name}${labelText(item.labels)} ${item.value}`);
                else {
                    definition.buckets!.forEach((bucket, index) => lines.push(`${definition.name}_bucket${labelText(item.labels, { le: String(bucket) })} ${item.buckets[index]}`));
                    lines.push(`${definition.name}_bucket${labelText(item.labels, { le: '+Inf' })} ${item.count}`, `${definition.name}_sum${labelText(item.labels)} ${item.sum}`, `${definition.name}_count${labelText(item.labels)} ${item.count}`);
                }
            }
        }
        return `${lines.join('\n')}\n`;
    },
    reset() { series.clear(); },
};

export const operationalMetrics = {
    http(method: string, route: string, status: number, seconds: number) { metricsRegistry.increment('voidlark_http_requests_total', { method: method.toUpperCase(), route, status_class: `${Math.floor(status / 100)}xx` }); metricsRegistry.observe('voidlark_http_request_duration_seconds', { method: method.toUpperCase(), route }, seconds); },
    db(operation: string, result: 'success' | 'error', seconds: number) { metricsRegistry.increment('voidlark_db_queries_total', { operation, result }); metricsRegistry.observe('voidlark_db_query_duration_seconds', { operation }, seconds); },
    queueDepth(direction: string, state: string, depth: number) { metricsRegistry.set('voidlark_queue_depth', { direction, state }, depth); },
    queue(direction: string, seconds: number, failed = false, terminal = false) { metricsRegistry.observe('voidlark_queue_processing_duration_seconds', { direction }, seconds); if (failed) metricsRegistry.increment('voidlark_queue_failures_total', { direction, terminal: String(terminal) }); },
    ai(seconds: number, error = false) { metricsRegistry.increment('voidlark_ai_calls_total', { result: error ? 'error' : 'success' }); metricsRegistry.observe('voidlark_ai_call_duration_seconds', {}, seconds); },
    knowledge(seconds: number, result: 'success' | 'error' | 'duplicate') { metricsRegistry.increment('voidlark_knowledge_ingestions_total', { result }); metricsRegistry.observe('voidlark_knowledge_ingestion_duration_seconds', {}, seconds); },
    backupSuccess(completedAt = Date.now()) { metricsRegistry.set('voidlark_backup_age_seconds', {}, Math.max(0, (Date.now() - completedAt) / 1000)); },
    backupFailure(driver: string) { metricsRegistry.increment('voidlark_backup_failures_total', { driver }); },
    waReconnect(reason: string) { metricsRegistry.increment('voidlark_wa_reconnects_total', { reason }); },
};

export type SloRule = { name: string; metric: 'backup_age_seconds' | 'queue_depth'; threshold: number; direction?: 'inbound' | 'outbound' };
export const configuredSloRules = (): SloRule[] => {
    try { return JSON.parse(process.env.SLO_RULES_JSON || '[]') as SloRule[]; } catch { return []; }
};
const defaultAlert = (rule: SloRule, value: number) => {
    appLogger.warn({ component: 'slo', slo: rule.name, value, threshold: rule.threshold }, 'slo.breached');
    const hook = process.env.ALERT_LOG_HOOK_FILE;
    if (hook) import('node:fs').then(({ appendFile }) => appendFile(hook, `${JSON.stringify({ timestamp: new Date().toISOString(), event: 'slo.breached', slo: rule.name, value, threshold: rule.threshold })}\n`, () => undefined)).catch(() => undefined);
};
export const evaluateSLOsAndAlert = (values: { backupAgeSeconds?: number; inboundQueueDepth?: number; outboundQueueDepth?: number }, rules = configuredSloRules(), alert = defaultAlert) => rules.filter((rule) => {
    const value = rule.metric === 'backup_age_seconds' ? values.backupAgeSeconds : rule.direction === 'outbound' ? values.outboundQueueDepth : values.inboundQueueDepth;
    const breached = Number.isFinite(value) && Number(value) > rule.threshold;
    if (breached) {
        metricsRegistry.increment('voidlark_slo_breaches_total', { slo: rule.name });
        alert(rule, Number(value));
    }
    return breached;
});
