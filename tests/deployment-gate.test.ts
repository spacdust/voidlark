import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('deployment config keeps single-instance production safety gates', async () => {
    const compose = await readFile('compose.yml', 'utf8');
    const dockerfile = await readFile('Dockerfile', 'utf8');
    const packageJson = await readFile('package.json', 'utf8');
    assert.match(compose, /stop_grace_period:\s*60s/);
    assert.match(compose, /no-new-privileges:true/);
    assert.match(compose, /DB_BACKUP_ENABLED:/);
    assert.match(compose, /READINESS_MAX_OUTBOUND_DEPTH:/);
    assert.match(compose, /SHUTDOWN_DRAIN_TIMEOUT_MS:/);
    assert.match(dockerfile, /USER voidlark/);
    assert.match(dockerfile, /health\/live/);
    assert.match(packageJson, /"ops:smoke"/);
});

test('admin CSP uses per-response script nonce and no inline event handlers', async () => {
    const server = await readFile('src/admin/server.ts', 'utf8');
    const safety = await readFile('src/admin/safety-metrics.ts', 'utf8');
    assert.match(server, /cspNonce/);
    assert.match(server, /nonce-\$\{nonce\}/);
    assert.match(server, /frameAncestors:\s*\["'none'"\]/);
    assert.doesNotMatch(safety, /onclick\s*=/i);
});
