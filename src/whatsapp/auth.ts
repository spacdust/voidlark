import { initAuthCreds, BufferJSON, AuthenticationState, SignalDataTypeMap } from '@whiskeysockets/baileys';
import { pool } from '../config/db.js';

const namespace = (sessionId: string, id: string) => sessionId === 'legacy' ? id : `wa:${sessionId}:${id}`;
const sessionAliases = new Map<string, string>();
const resolveSessionId = (sessionId: string) => sessionAliases.get(sessionId) || sessionId;

export const aliasAuthState = (fromSessionId: string, toSessionId: string) => {
    sessionAliases.set(fromSessionId, toSessionId);
};

export const clearAuthAlias = (sessionId: string) => {
    sessionAliases.delete(sessionId);
};

export const clearAuthState = async (sessionId: string) => {
    if (sessionId === 'legacy') await pool.query("DELETE FROM auth_keys WHERE id NOT LIKE 'wa:%'");
    else await pool.query('DELETE FROM auth_keys WHERE id LIKE $1', [`wa:${sessionId}:%`]);
};

export const renameAuthState = async (fromSessionId: string, toSessionId: string) => {
    const fromPrefix = fromSessionId === 'legacy' ? '' : `wa:${fromSessionId}:`;
    const toPrefix = toSessionId === 'legacy' ? '' : `wa:${toSessionId}:`;
    await pool.transaction(async (transaction) => {
        const rows = await transaction.query(fromSessionId === 'legacy' ? "SELECT id, data FROM auth_keys WHERE id NOT LIKE 'wa:%'" : 'SELECT id, data FROM auth_keys WHERE id LIKE $1', [fromSessionId === 'legacy' ? undefined : `${fromPrefix}%`].filter((value) => value !== undefined));
        for (const row of rows.rows) {
            const id = fromSessionId === 'legacy' ? row.id : String(row.id).slice(fromPrefix.length);
            await transaction.query('INSERT INTO auth_keys (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [`${toPrefix}${id}`, JSON.stringify(row.data)]);
        }
        await transaction.query(fromSessionId === 'legacy' ? "DELETE FROM auth_keys WHERE id NOT LIKE 'wa:%'" : 'DELETE FROM auth_keys WHERE id LIKE $1', [fromSessionId === 'legacy' ? undefined : `${fromPrefix}%`].filter((value) => value !== undefined));
    });
};

export const hasAuthState = async (sessionId: string) => {
    const result = await pool.query('SELECT data FROM auth_keys WHERE id = $1', [namespace(sessionId, 'creds')]);
    const data = result.rows[0]?.data;
    return Boolean(data?.me?.id);
};

export const claimLegacyAuthState = async (sessionId: string) => {
    if (await hasAuthState(sessionId)) return true;
    const legacy = await pool.query("SELECT data FROM auth_keys WHERE id = 'creds'");
    const me = String(legacy.rows[0]?.data?.me?.id || '').split(':')[0].split('@')[0];
    if (!me || me !== sessionId) return false;
    await pool.transaction(async (transaction) => {
        const keys = await transaction.query("SELECT id, data FROM auth_keys WHERE id NOT LIKE 'wa:%'");
        for (const row of keys.rows) await transaction.query(
            'INSERT INTO auth_keys (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
            [namespace(sessionId, row.id), JSON.stringify(row.data)],
        );
        await transaction.query("DELETE FROM auth_keys WHERE id NOT LIKE 'wa:%'");
    });
    return true;
};

export const usePostgresAuthState = async (sessionId = 'legacy'): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> => {

    const writeData = async (data: any, id: string) => {
        const json = JSON.stringify(data, BufferJSON.replacer);
        await pool.query(
            'INSERT INTO auth_keys (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
            [namespace(resolveSessionId(sessionId), id), json]
        );
    };

    const readData = async (id: string) => {
        const { rows } = await pool.query('SELECT data FROM auth_keys WHERE id = $1', [namespace(resolveSessionId(sessionId), id)]);
        if (rows.length > 0) {
            return JSON.parse(JSON.stringify(rows[0].data), BufferJSON.reviver);
        }
        return null;
    };

    const removeData = async (id: string) => {
        await pool.query('DELETE FROM auth_keys WHERE id = $1', [namespace(resolveSessionId(sessionId), id)]);
    };

    let creds = await readData('creds');
    if (!creds) {
        creds = initAuthCreds();
        await writeData(creds, 'creds');
    }

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data: { [_: string]: SignalDataTypeMap[typeof type] } = {};
                    await Promise.all(
                        ids.map(async id => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = Buffer.from(value.b64, 'base64');
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks: Promise<void>[] = [];
                    for (const category in data) {
                        for (const id in data[category as keyof typeof data]) {
                            const value = data[category as keyof typeof data]![id];
                            const key = `${category}-${id}`;
                            tasks.push(value ? writeData(value, key) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds')
    };
};
