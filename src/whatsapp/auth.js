import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
import { pool } from '../config/db.js';
const initDb = async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS auth_keys (
            id VARCHAR(255) PRIMARY KEY,
            data JSONB NOT NULL
        );
    `);
};
export const usePostgresAuthState = async () => {
    await initDb();
    const writeData = async (data, id) => {
        const json = JSON.stringify(data, BufferJSON.replacer);
        await pool.query('INSERT INTO auth_keys (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [id, json]);
    };
    const readData = async (id) => {
        const { rows } = await pool.query('SELECT data FROM auth_keys WHERE id = $1', [id]);
        if (rows.length > 0) {
            return JSON.parse(JSON.stringify(rows[0].data), BufferJSON.reviver);
        }
        return null;
    };
    const removeData = async (id) => {
        await pool.query('DELETE FROM auth_keys WHERE id = $1', [id]);
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
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        let value = await readData(`${type}-${id}`);
                        if (type === 'app-state-sync-key' && value) {
                            value = Buffer.from(value.b64, 'base64');
                        }
                        data[id] = value;
                    }));
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
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
