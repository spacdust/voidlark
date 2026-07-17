import { pool } from '../config/db.js';

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

const MAX_HISTORY = 20; // jumlah pesan terakhir yang dikirim ke AI

export const saveMessage = async (jid: string, role: 'user' | 'assistant', content: string) => {
    await pool.query(
        'INSERT INTO chat_history (jid, role, content) VALUES ($1, $2, $3)',
        [jid, role, content]
    );
};

export const getChatHistory = async (jid: string): Promise<ChatMessage[]> => {
    const { rows } = await pool.query(
        'SELECT role, content FROM chat_history WHERE jid = $1 ORDER BY created_at DESC, id DESC LIMIT $2',
        [jid, MAX_HISTORY]
    );
    // DB returns newest-first, reverse ke chronological
    return rows.reverse();
};

export const getFullChatHistory = async (jid: string, limit = 200) => {
    const { rows } = await pool.query(
        'SELECT id, role, content, created_at FROM chat_history WHERE jid = $1 ORDER BY created_at DESC, id DESC LIMIT $2',
        [jid, limit]
    );
    return rows.reverse();
};

export const clearChatHistory = async (jid: string) => {
    await pool.query('DELETE FROM chat_history WHERE jid = $1', [jid]);
};
