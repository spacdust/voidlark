import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DB_DRIVER = 'sqlite';

test('WhatsApp auth state is isolated per phone namespace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'voidlark-wa-auth-'));
    process.env.SQLITE_PATH = path.join(root, 'auth.db');
    const { pool } = await import('../src/config/db.js');
    const { initSchema } = await import('../src/config/schema.js');
    const { aliasAuthState, clearAuthState, renameAuthState, usePostgresAuthState } = await import('../src/whatsapp/auth.js');
    try {
        await initSchema(pool);
        await usePostgresAuthState('628111');
        await usePostgresAuthState('628222');
        assert.equal(Number((await pool.query("SELECT COUNT(*) count FROM auth_keys WHERE id LIKE 'wa:628111:%'")).rows[0].count), 1);
        assert.equal(Number((await pool.query("SELECT COUNT(*) count FROM auth_keys WHERE id LIKE 'wa:628222:%'")).rows[0].count), 1);

        const pending = await usePostgresAuthState('pending');
        await renameAuthState('pending', '628333');
        aliasAuthState('pending', '628333');
        pending.state.creds.me = { id: '628333:1@s.whatsapp.net', name: 'CS 3' };
        await pending.saveCreds();
        assert.equal((await pool.query("SELECT data FROM auth_keys WHERE id = 'wa:628333:creds'")).rows[0].data.me.id, '628333:1@s.whatsapp.net');
        assert.equal(Number((await pool.query("SELECT COUNT(*) count FROM auth_keys WHERE id LIKE 'wa:pending:%'")).rows[0].count), 0);
        await clearAuthState('628111');
        assert.equal(Number((await pool.query("SELECT COUNT(*) count FROM auth_keys WHERE id LIKE 'wa:628111:%'")).rows[0].count), 0);
        assert.equal(Number((await pool.query("SELECT COUNT(*) count FROM auth_keys WHERE id LIKE 'wa:628222:%'")).rows[0].count), 1);
    } finally {
        await pool.end();
        await rm(root, { recursive: true, force: true });
    }
});
