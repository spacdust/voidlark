import { initAuthCreds, BufferJSON, AuthenticationState, SignalDataTypeMap } from '@whiskeysockets/baileys';
import { pool } from '../config/db.js';

export const usePostgresAuthState = async (): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> => {

    const writeData = async (data: any, id: string) => {
        const json = JSON.stringify(data, BufferJSON.replacer);
        await pool.query(
            'INSERT INTO auth_keys (id, data) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
            [id, json]
        );
    };

    const readData = async (id: string) => {
        const { rows } = await pool.query('SELECT data FROM auth_keys WHERE id = $1', [id]);
        if (rows.length > 0) {
            return JSON.parse(JSON.stringify(rows[0].data), BufferJSON.reviver);
        }
        return null;
    };

    const removeData = async (id: string) => {
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
