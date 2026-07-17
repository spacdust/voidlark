import { pool } from '../config/db.js';

export interface Lead {
    jid: string;
    name?: string;
    phone?: string;
    address?: string;
    preferences?: string;
    status?: string;
    notes?: string;
}

export const upsertLead = async (lead: Lead) => {
    const fields: string[] = [];
    const values: any[] = [lead.jid];
    let idx = 2;

    if (lead.name) { fields.push(`name = $${idx++}`); values.push(lead.name); }
    if (lead.phone) { fields.push(`phone = $${idx++}`); values.push(lead.phone); }
    if (lead.address) { fields.push(`address = $${idx++}`); values.push(lead.address); }
    if (lead.preferences) { fields.push(`preferences = $${idx++}`); values.push(lead.preferences); }
    if (lead.status) { fields.push(`status = $${idx++}`); values.push(lead.status); }
    if (lead.notes) { fields.push(`notes = $${idx++}`); values.push(lead.notes); }

    // Selalu touch updated_at (termasuk chat jid-only) biar list leads/chat gak "stuck" di first-seen.
    fields.push('updated_at = NOW()');

    const colNames = ['jid'];
    const insertPlaceholders = ['$1'];
    let j = 2;
    if (lead.name) { colNames.push('name'); insertPlaceholders.push(`$${j++}`); }
    if (lead.phone) { colNames.push('phone'); insertPlaceholders.push(`$${j++}`); }
    if (lead.address) { colNames.push('address'); insertPlaceholders.push(`$${j++}`); }
    if (lead.preferences) { colNames.push('preferences'); insertPlaceholders.push(`$${j++}`); }
    if (lead.status) { colNames.push('status'); insertPlaceholders.push(`$${j++}`); }
    if (lead.notes) { colNames.push('notes'); insertPlaceholders.push(`$${j++}`); }

    const sql = `INSERT INTO leads (${colNames.join(', ')}) VALUES (${insertPlaceholders.join(', ')})
        ON CONFLICT (jid) DO UPDATE SET ${fields.join(', ')}`;

    await pool.query(sql, values);
};

export const getLead = async (jid: string): Promise<Lead | null> => {
    const { rows } = await pool.query('SELECT * FROM leads WHERE jid = $1', [jid]);
    return rows[0] || null;
};
