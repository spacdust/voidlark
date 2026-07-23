import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
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

test('dashboard renders setup before urgent actions and WhatsApp page has no seeded demo sessions', async () => {
    const source = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');
    const dashboardStart = source.indexOf("res.send(page('Ringkasan'");
    const dashboardEnd = source.indexOf("app.get('/admin/config'", dashboardStart);
    const dashboard = source.slice(dashboardStart, dashboardEnd);
    assert.ok(dashboard.indexOf('data-setup-shell') < dashboard.indexOf('Perlu dilakukan sekarang'));
    const whatsappStart = source.indexOf("app.get('/admin/whatsapp'");
    const whatsappEnd = source.indexOf("app.get('/admin/whatsapp/status'", whatsappStart);
    const whatsapp = source.slice(whatsappStart, whatsappEnd);
    assert.doesNotMatch(whatsapp, /CS Line 1 \(Utama\)|CS Line 2 \(Cadangan\)|6281234567890|6289876543210/);
});

test('WhatsApp Admin routes use isolated per-number socket lifecycle', async () => {
    const source = await readFile(path.resolve('src/admin/server.ts'), 'utf8');
    assert.match(source, /startWhatsAppConnection\(phone\)/);
    assert.match(source, /stopWhatsAppSession\(phone, true\)/);
    assert.doesNotMatch(source, /DELETE FROM auth_keys WHERE phone/);
    assert.match(source, /getWaSessionStatus\(s\.phone\)/);
    assert.match(source, /status: 'connecting'/);
    assert.match(source, /data\.state === 'open'/);
    assert.match(source, /Buka modal Tambah Nomor untuk membuat QR/);
    assert.match(source, /data\.state === 'error' \|\| data\.state === 'close'/);
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

test('admin and login share one native semantic product UI layer', async () => {
    const [server, login, styles] = await Promise.all([
        readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8'),
        readFile(new URL('../src/admin/login-page.ts', import.meta.url), 'utf8'),
        readFile(new URL('../src/admin/admin-styles.ts', import.meta.url), 'utf8'),
    ]);

    assert.match(server, /href="\/admin\/assets\/admin\.css\?v=[^"]+"/);
    assert.match(login, /href="\/admin\/assets\/admin\.css\?v=[^"]+"/);
    assert.match(server, /app\.get\('\/admin\/assets\/admin\.css'/);
    assert.match(server, /<body class="admin-app">/);
    assert.match(login, /<body class="login-app">/);

    for (const token of [
        '--canvas', '--surface', '--surface-raised', '--surface-subtle',
        '--text', '--text-muted', '--border', '--border-strong',
        '--accent', '--accent-hover', '--accent-soft', '--success',
        '--warning', '--danger', '--info', '--focus-ring',
    ]) assert.match(styles, new RegExp(token));

    assert.match(styles, /html\[data-theme="dark"\]/);
    assert.match(styles, /@font-face[\s\S]*font-family: "Inter"[\s\S]*InterVariable\.woff2/);
    assert.match(styles, /font-family: "IBM Plex Mono"[\s\S]*IBMPlexMono-Regular\.woff2/);
    assert.match(server, /app\.get\('\/admin\/assets\/fonts\/:file'/);
    assert.match(server, /max-age=31536000, immutable/);
    assert.doesNotMatch(`${server}\n${login}\n${styles}`, /IBM Plex Sans/);
    assert.match(styles, /prefers-reduced-motion: reduce/);
    assert.match(styles, /safe-area-inset-bottom/);
    assert.doesNotMatch(styles, /transition:\s*all/i);
    assert.doesNotMatch(styles, /linear-gradient|radial-gradient|drop-shadow|text-shadow/i);
    assert.doesNotMatch(styles, /#00e5ff|#00f5d4/i);
    assert.match(styles, /select:not\(\[multiple\]\)[\s\S]*border-radius: var\(--radius-control\)/);
    assert.match(styles, /select:not\(\[multiple\]\)[\s\S]*appearance: none/);
    assert.match(styles, /select\.badge-pill[\s\S]*border-radius: 999px/);
    assert.match(styles, /html\[data-theme="dark"\] \.admin-app select:not\(\[multiple\]\)/);
    assert.match(styles, /html\[data-theme="dark"\] \.admin-app select:not\(\[multiple\]\)[\s\S]*background-repeat: no-repeat/);
    assert.doesNotMatch(styles, /html\[data-theme="dark"\] \.admin-app select \{ background:/);
    assert.doesNotMatch(server, /<select[^>]+style=/);
    assert.match(styles, /\.reply-style-advanced-shell > summary::after \{ content: "\+"/);
    assert.match(styles, /\.reply-style-advanced-shell\[open\] > summary::after \{ content: "−"/);
    assert.match(styles, /\.filter-tabs \{[\s\S]*gap: 6px[\s\S]*border-radius: var\(--radius-surface\)/);
    assert.match(styles, /\.filter-tab\.active \{[\s\S]*background: var\(--surface\)/);
    assert.match(styles, /html\[data-theme="dark"\] \.admin-app \.filter-tab\.active \{ background: var\(--surface\)/);
    assert.match(styles, /\.filter-tab \.count \{[\s\S]*border-radius: 999px/);
    assert.match(styles, /\.file-picker \{[\s\S]*border-radius: var\(--radius-control\)/);
    assert.match(styles, /\.file-picker:focus-within/);
    assert.match(server, /data-file-picker data-has-file="false"/);
    assert.match(server, /data-file-name>Belum ada file dipilih/);
    assert.match(server, /accept="application\/json,\.json"/);
    assert.match(styles, /\.backup-restore-form \{ display: grid; gap: 12px/);
    assert.match(server, /class="backup-restore-form"/);
    assert.match(server, /\['Ongkir', 'Handoff'\]/);
    assert.match(server, /\['Lookup eksternal', 'Database'\]/);
});

test('SSR Admin host keeps legacy page rendering available', async () => {
    const server = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');
    assert.match(server, /app\.get\('\/admin\/login'/);
    assert.match(server, /res\.send\(renderLoginPage\(\)\)/);
    assert.doesNotMatch(server, /reactIndex|React Admin host|dist[\\/]admin-ui|express\.static\([^\n]*admin-ui/);
});

test('core configuration routes remain server-rendered', async () => {
    const server = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');
    assert.match(server, /app\.get\('\/admin\/config'/);
    assert.match(server, /app\.get\('\/admin\/prompt'/);
    assert.match(server, /app\.get\('\/admin\/settings'/);
    assert.doesNotMatch(server, /React Admin host/);
});

test('dense admin layouts stay bounded without removing controls', async () => {
    const server = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');

    assert.match(server, /class="env-grid env-grid-single"/);
    assert.match(server, /class="ai-env-fields"/);
    assert.match(server, /\['AI_API_BASE_URL', 'AI_API_KEY', 'AI_MODEL', 'OPENROUTER_API_KEY'\]/);
    assert.match(server, /\.ai-env-fields \{ grid-template-columns: 1fr; \}/);
    assert.match(server, /settings-zone-head settings-zone-head-primary/);
    assert.match(server, /\.simulator-toolbar \{[^}]*justify-content: flex-end/);
    assert.doesNotMatch(server, /data-simulator-cs-name|sandboxCsName|requestedCsName/);
    assert.match(server, /dialog#waQrModal > \.wa-qr-modal-body \{[^}]*overflow-y: auto/);
    assert.match(server, /max-height: calc\(100dvh - 24px\)/);
    assert.match(server, /id="liveQrImage"/);
    assert.match(server, /name="csNameOverride"/);
    assert.match(server, /name="phone"[^>]*required readonly/);
    assert.match(server, /Simpan & Aktifkan CS/);
});

test('admin setup uses progressive disclosure without removing existing configuration fields', async () => {
    const [server, styles] = await Promise.all([
        readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8'),
        readFile(new URL('../src/admin/admin-styles.ts', import.meta.url), 'utf8'),
    ]);
    assert.match(server, /data-config-mode-button="basic"/);
    assert.match(server, /data-config-mode-button="advanced"/);
    assert.match(server, /data-business-preset="physical"/);
    assert.match(server, /data-business-preset="digital"/);
    assert.match(server, /data-config-advanced/);
    assert.match(server, /Selesaikan setup utama/);
    assert.match(server, /nextSetupStep/);
    assert.match(server, /getWaSessionStatus\(session\.phone\)\.state === 'open'/);
    assert.match(server, /name="businessName"/);
    assert.match(server, /name="checkoutFields"/);
    assert.match(server, /name="paymentInstructions"/);
    assert.match(server, /name="businessHoursEnabled"/);
    assert.match(server, /name="optOutKeywords"/);
    assert.match(styles, /\[data-config-mode="basic"\] \[data-config-advanced\]/);
});
