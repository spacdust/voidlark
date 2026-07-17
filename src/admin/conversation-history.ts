export type ConversationDatabase = {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>;
};

export interface ConversationSummary {
    jid: string;
    customerName: string;
    phone: string;
    firstAt: unknown;
    lastAt: unknown;
    messageCount: number;
}

export interface TranscriptMessage {
    id: number;
    role: 'user' | 'assistant';
    content: string;
    created_at: unknown;
}

const escapeHtml = (value: unknown) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const parseDbDate = (value: unknown): Date | null => {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
        ? `${raw.replace(' ', 'T')}Z`
        : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw) ? `${raw}Z` : raw;
    const date = new Date(sqliteUtc);
    return Number.isNaN(date.getTime()) ? null : date;
};

const phoneVariants = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 6) return [];
    const variants = new Set([digits]);
    if (digits.startsWith('0')) variants.add(`62${digits.slice(1)}`);
    else if (digits.startsWith('62')) variants.add(`0${digits.slice(2)}`);
    else if (digits.startsWith('8')) {
        variants.add(`62${digits}`);
        variants.add(`0${digits}`);
    }
    return [...variants].map((candidate) => `%${candidate}%`);
};

export const buildConversationSearch = (value: unknown) => {
    const raw = String(value ?? '').trim();
    return {
        textPattern: `%${raw.toLocaleLowerCase('id-ID')}%`,
        digitPatterns: phoneVariants(raw),
    };
};

const mapSummary = (row: any): ConversationSummary => ({
    jid: String(row.jid || ''),
    customerName: String(row.customer_name || '').trim(),
    phone: (() => {
        const leadPhone = String(row.lead_phone || '').trim();
        if (leadPhone && !leadPhone.toLowerCase().includes('@lid')) return leadPhone.endsWith('@s.whatsapp.net') ? leadPhone.slice(0, -'@s.whatsapp.net'.length).replace(/\D/g, '') : leadPhone;
        return String(row.jid || '').endsWith('@s.whatsapp.net') ? String(row.jid).slice(0, -'@s.whatsapp.net'.length).replace(/\D/g, '') : '';
    })(),
    firstAt: row.first_at,
    lastAt: row.last_at,
    messageCount: Number(row.msg_count || 0),
});

const conversationAggregateSql = `
    SELECT history.jid, leads.name AS customer_name, leads.phone AS lead_phone,
           history.first_at, history.last_at, history.last_id, history.msg_count
    FROM (
        SELECT jid, MIN(created_at) AS first_at, MAX(created_at) AS last_at, MAX(id) AS last_id, COUNT(*) AS msg_count
        FROM chat_history
        GROUP BY jid
    ) AS history
    LEFT JOIN leads ON leads.jid = history.jid`;

export const listConversationSummaries = async (database: ConversationDatabase, search: unknown = '', limit = 40): Promise<ConversationSummary[]> => {
    const raw = String(search ?? '').trim();
    const normalized = buildConversationSearch(raw);
    const params: unknown[] = [];
    const filters: string[] = [];
    if (raw) {
        params.push(normalized.textPattern);
        filters.push(`(LOWER(COALESCE(leads.name, '')) LIKE $1 OR LOWER(history.jid) LIKE $1)`);
        const normalizedLeadPhone = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(leads.phone, ''), '+', ''), '-', ''), ' ', ''), '(', ''), ')', '')";
        for (const pattern of normalized.digitPatterns) {
            params.push(pattern);
            filters.push(`(history.jid LIKE $${params.length} OR ${normalizedLeadPhone} LIKE $${params.length})`);
        }
    }
    params.push(Math.min(100, Math.max(1, Math.floor(limit))));
    const where = filters.length ? ` WHERE ${filters.join(' OR ')}` : '';
    const result = await database.query(
        `${conversationAggregateSql}${where} ORDER BY history.last_at DESC, history.last_id DESC LIMIT $${params.length}`,
        params,
    );
    return result.rows.map(mapSummary);
};

export const getConversationSummary = async (database: ConversationDatabase, jid: string): Promise<ConversationSummary | null> => {
    const result = await database.query(`${conversationAggregateSql} WHERE history.jid = $1 LIMIT 1`, [jid]);
    return result.rows[0] ? mapSummary(result.rows[0]) : null;
};

const dateParts = (date: Date, timeZone?: string) => new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
}).format(date);

const localTime = (date: Date, timeZone?: string) => new Intl.DateTimeFormat('id-ID', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
}).format(date).replace(':', '.');

const localDate = (date: Date, timeZone?: string) => new Intl.DateTimeFormat('id-ID', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
}).format(date);

export const renderTranscript = (messages: TranscriptMessage[], options: { timeZone?: string } = {}) => {
    let previousDay = '';
    return messages.map((message) => {
        const date = parseDbDate(message.created_at);
        const day = date ? dateParts(date, options.timeZone) : String(message.created_at ?? '');
        const separator = day !== previousDay
            ? `<div class="chat-date-separator"><span>${escapeHtml(date ? localDate(date, options.timeZone) : day)}</span></div>`
            : '';
        previousDay = day;
        const time = date ? localTime(date, options.timeZone) : '—';
        const iso = date ? date.toISOString() : '';
        return `${separator}<div class="chat-bubble ${escapeHtml(message.role)}">
          <div class="meta"><span>${message.role === 'user' ? 'Pelanggan' : 'Bot'}</span><time datetime="${escapeHtml(iso)}">${escapeHtml(time)}</time></div>
          <div class="body">${escapeHtml(message.content)}</div>
        </div>`;
    }).join('');
};
