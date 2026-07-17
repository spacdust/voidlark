import assert from 'node:assert/strict';
import test from 'node:test';
import { metricsRegistry, operationalMetrics, evaluateSLOsAndAlert } from '../src/operations/metrics.js';
import { liveness, readiness } from '../src/operations/health.js';
import { withTransientRetry } from '../src/operations/retry.js';

test('renders low-cardinality Prometheus metrics', () => {
    metricsRegistry.reset();
    operationalMetrics.http('GET', '/customer/123', 201, 0.025);
    operationalMetrics.http('TRACE', '/customer/456', 500, 0.5);
    const text = metricsRegistry.render();
    assert.match(text, /# TYPE voidlark_http_requests_total counter/);
    assert.match(text, /method="GET",route="other",status_class="2xx"/);
    assert.match(text, /method="OTHER",route="other",status_class="5xx"/);
    assert.match(text, /voidlark_http_request_duration_seconds_count\{method="GET",route="other"\} 1/);
    assert.doesNotMatch(text, /customer\/123/);
});

test('evaluates configured SLO values and emits breach metric', () => {
    metricsRegistry.reset();
    const alerts: string[] = [];
    const breaches = evaluateSLOsAndAlert({ inboundQueueDepth: 11 }, [{ name: 'inbound_backlog', metric: 'queue_depth', direction: 'inbound', threshold: 10 }], (rule) => alerts.push(rule.name));
    assert.equal(breaches.length, 1);
    assert.deepEqual(alerts, ['inbound_backlog']);
    assert.match(metricsRegistry.render(), /voidlark_slo_breaches_total\{slo="inbound_backlog"\} 1/);
});

test('liveness is process-only and readiness checks DB plus WhatsApp', async () => {
    assert.equal(liveness().status, 'ok');
    const result = await readiness({ query: async (sql) => ({ rows: sql.includes('COUNT') ? [{ count: 0 }] : [], rowCount: 0 }), transaction: async (work) => work({} as never), end: async () => undefined });
    assert.equal(result.ready, false);
    assert.equal(result.checks.database.status, 'ok');
});

test('readiness rejects excessive durable queue backlog at configured bounds', async () => {
    const database = {
        query: async (sql: string) => {
            if (sql.includes('inbound_messages')) return { rows: [{ count: 51 }], rowCount: 1 };
            if (sql.includes('outbound_messages')) return { rows: [{ count: 4 }], rowCount: 1 };
            if (sql.includes('backup_runs')) return { rows: [{ completed_at: '2030-01-01T00:00:00.000Z' }], rowCount: 1 };
            return { rows: [{ 1: 1 }], rowCount: 1 };
        },
        transaction: async <T>(work: (database: never) => Promise<T>) => work(database as never),
        end: async () => undefined,
    };
    const result = await readiness(database, {
        getWaStatus: () => ({ state: 'open', lastUpdate: '2030-01-01T00:00:00.000Z' }),
        maxInboundDepth: 50,
        maxOutboundDepth: 10,
        now: () => new Date('2030-01-01T00:00:01.000Z'),
    });
    assert.equal(result.ready, false);
    assert.equal(result.checks.queues?.status, 'backlogged');
    assert.deepEqual(result.checks.queues?.limits, { inbound: 50, outbound: 10 });
});

test('transient provider retry uses injected attempts and delay without network or wall-clock sleep', async () => {
    const delays: number[] = [];
    let attempts = 0;
    const result = await withTransientRetry(async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('provider connection error');
        return 'recovered';
    }, {
        maxAttempts: 3,
        delayMs: 800,
        sleep: async (ms) => { delays.push(ms); },
        isTransient: (error) => /connection error/.test(String(error)),
    });
    assert.equal(result, 'recovered');
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [800, 800]);
});

test('provider retry does not retry permanent failures', async () => {
    let attempts = 0;
    await assert.rejects(withTransientRetry(async () => {
        attempts += 1;
        throw new Error('401 invalid API key');
    }, {
        maxAttempts: 3,
        sleep: async () => assert.fail('permanent failure slept'),
        isTransient: (error) => /connection error/.test(String(error)),
    }), /401 invalid API key/);
    assert.equal(attempts, 1);
});
