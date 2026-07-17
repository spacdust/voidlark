import assert from 'node:assert/strict';
import test from 'node:test';
import type { DestinationStream } from 'pino';
import { createAppLogger } from '../src/config/logger.js';

const captureLogs = () => {
    const lines: string[] = [];
    const destination: DestinationStream = {
        write(chunk) {
            lines.push(String(chunk));
        },
    };
    return { destination, records: () => lines.map((line) => JSON.parse(line)) as Record<string, unknown>[] };
};

test('redacts secrets and direct identifiers at every nesting level', () => {
    const capture = captureLogs();
    const logger = createAppLogger({ destination: capture.destination, level: 'info' });

    logger.info({
        jid: '628123456789@s.whatsapp.net',
        email: 'customer@example.com',
        authorization: 'Bearer super-secret-token',
        nested: { apiKey: 'sk-live-secret', phone: '+62 812 3456 7890' },
    }, 'received customer@example.com from 628123456789@s.whatsapp.net');

    const serialized = JSON.stringify(capture.records()[0]);
    assert.doesNotMatch(serialized, /628123456789|customer@example\.com|super-secret-token|sk-live-secret|812 3456/);
    assert.match(serialized, /\[REDACTED\]/);
});

test('never serializes message bodies or payload content', () => {
    const capture = captureLogs();
    const logger = createAppLogger({ destination: capture.destination, level: 'info' });

    logger.info({ text: 'private message body', payload: { conversation: 'another secret body' } }, 'message.received');

    const serialized = JSON.stringify(capture.records()[0]);
    assert.doesNotMatch(serialized, /private message body|another secret body/);
    assert.equal(capture.records()[0].event, 'message.received');
});

test('serializes errors without stacks or attached request data', () => {
    const capture = captureLogs();
    const logger = createAppLogger({ destination: capture.destination, level: 'info' });
    const error = Object.assign(new Error('request failed for customer@example.com'), {
        code: 'E_UPSTREAM',
        request: { headers: { authorization: 'Bearer secret' } },
    });

    logger.error({ err: error }, 'upstream.failed');

    const record = capture.records()[0];
    assert.deepEqual(record.err, { type: 'Error', message: 'request failed for [REDACTED]', code: 'E_UPSTREAM' });
    assert.equal('stack' in (record.err as Record<string, unknown>), false);
    assert.doesNotMatch(JSON.stringify(record), /Bearer secret/);
});

test('uses explicit log level and emits stable service metadata', () => {
    const capture = captureLogs();
    const logger = createAppLogger({ destination: capture.destination, level: 'warn' });

    logger.info('ignored');
    logger.warn({ component: 'security' }, 'config.ready');

    const records = capture.records();
    assert.equal(records.length, 1);
    assert.equal(records[0].service, 'voidlark');
    assert.equal(records[0].event, 'config.ready');
    assert.equal(records[0].component, 'security');
});
