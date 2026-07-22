import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { resolveLeadSort } from '../src/admin/server.js';

test('lead sorting accepts only the public allowlist', () => {
    assert.deepEqual(resolveLeadSort('created', 'asc'), {
        key: 'created',
        direction: 'asc',
        orderBy: 'created_at ASC',
    });
    assert.deepEqual(resolveLeadSort('updated', 'desc'), {
        key: 'updated',
        direction: 'desc',
        orderBy: 'updated_at DESC',
    });
    assert.deepEqual(resolveLeadSort('updated_at; DROP TABLE leads; --', 'asc'), {
        key: 'updated',
        direction: 'desc',
        orderBy: 'updated_at DESC',
    });
    assert.deepEqual(resolveLeadSort('name', 'sideways'), {
        key: 'updated',
        direction: 'desc',
        orderBy: 'updated_at DESC',
    });
});

test('admin knowledge copy uses plain Indonesian while internal ingestion names remain intact', async () => {
    const source = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');
    const uiStart = source.indexOf('const knowledgeJobsTable');
    const uiEnd = source.indexOf("app.get('/admin/leads'", uiStart);
    const adminKnowledgeUi = source.slice(uiStart, uiEnd);

    assert.doesNotMatch(adminKnowledgeUi, />[^<]*ingestion[^<]*</i);
    assert.match(adminKnowledgeUi, /Riwayat pemrosesan informasi/);
    assert.match(adminKnowledgeUi, /Proses informasi #/);

    const store = await readFile(new URL('../src/ai/knowledge-store.ts', import.meta.url), 'utf8');
    assert.match(store, /knowledge_ingestion_jobs/);
    assert.doesNotMatch(store, /throw new Error\([^)]*ingestion/i);
});

test('all admin collapse controls persist their latest state across navigation', async () => {
    const source = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');
    const details = [...source.matchAll(/<details\b([^>]*)>/g)];

    assert.ok(details.length > 0);
    for (const [, attributes] of details) {
        assert.match(attributes, /data-persist-collapse="[^"]+"/);
    }
    assert.match(source, /querySelectorAll\('\[data-persist-collapse\]'\)/);
    assert.match(source, /addEventListener\('toggle'/);
    assert.match(source, /localStorage\.setItem\(collapseStorageKey/);
});

test('lead table exposes explicit created and updated timestamps plus server sort controls', async () => {
    const source = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');
    const tableStart = source.indexOf('const leadSortControls');
    const tableEnd = source.indexOf('const ordersTable', tableStart);
    const leadUi = source.slice(tableStart, tableEnd);

    assert.match(leadUi, /Dibuat/);
    assert.match(leadUi, /Diperbarui/);
    assert.match(leadUi, /fmtDateTime\(row\.created_at\)/);
    assert.match(leadUi, /fmtDateTime\(row\.updated_at\)/);
    assert.match(leadUi, /name="sort"/);
    assert.match(leadUi, /name="direction"/);

    const routeStart = source.indexOf("app.get('/admin/leads'");
    const routeEnd = source.indexOf("app.get('/admin/orders'", routeStart);
    const route = source.slice(routeStart, routeEnd);
    assert.match(route, /resolveLeadSort\(req\.query\.sort, req\.query\.direction\)/);
    assert.match(route, /ORDER BY \$\{sort\.orderBy\}/);
    assert.doesNotMatch(route, /ORDER BY \$\{req\.query/);
});
