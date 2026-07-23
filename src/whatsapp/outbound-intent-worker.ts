import { pool, type Database } from '../config/db.js';
import { buildOrderSummary } from '../chat/orders.js';

type Intent = { id: number; dedupe_key: string; jid: string; intent_type: string; payload: any };

const parsePayload = (value: unknown) => {
    if (typeof value !== 'string') return value || {};
    try { return JSON.parse(value); } catch { return {}; }
};

export const projectOutboundIntents = async (database: Database = pool, limit = 50) => {
    const result = await database.query(
        'SELECT * FROM outbound_intents WHERE processed_at IS NULL ORDER BY id LIMIT $1',
        [limit],
    );
    let projected = 0;
    for (const raw of result.rows as Intent[]) {
        const intent = { ...raw, payload: parsePayload(raw.payload) };
        try {
            const orderId = Number(intent.payload?.orderId);
            const order = Number.isInteger(orderId) ? (await database.query('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0] : null;
            const text = intent.intent_type === 'order.paid'
                ? `Pembayaran pesanan #${orderId} sudah diterima. Terima kasih, pesanan akan segera diproses.`
                : intent.intent_type === 'order.shipped'
                    ? `Pesanan #${orderId} sudah dikirim.${intent.payload?.trackingNumber ? ` Nomor resi: ${intent.payload.trackingNumber}.` : ''}`
                    : intent.intent_type === 'order.completed'
                        ? `Pesanan #${orderId} telah selesai. Terima kasih sudah berbelanja.`
                        : order ? `Pesanan sudah dikonfirmasi.\n${buildOrderSummary(order)}` : `Status pesanan #${orderId} diperbarui.`;
            await database.transaction(async (transaction) => {
                await transaction.query(
                    `INSERT INTO outbound_messages (dedupe_key, jid, payload, max_attempts)
                     VALUES ($1, $2, $3, 5) ON CONFLICT (dedupe_key) DO NOTHING`,
                    [`intent:${intent.dedupe_key}`, intent.jid, JSON.stringify({ text })],
                );
                await transaction.query('UPDATE outbound_intents SET processed_at = NOW(), last_error = NULL WHERE id = $1 AND processed_at IS NULL', [intent.id]);
            });
            projected += 1;
        } catch (error) {
            await database.query('UPDATE outbound_intents SET last_error = $1 WHERE id = $2', [error instanceof Error ? error.message : String(error), intent.id]);
        }
    }
    return projected;
};

export class OutboundIntentWorker {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private stopped = false;
    constructor(private readonly intervalMs = 1_000, private readonly database: Database = pool) {}
    start() { this.stopped = false; void this.tick(); }
    stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null; }
    private async tick() {
        if (this.stopped) return;
        await projectOutboundIntents(this.database).catch(() => 0);
        this.timer = setTimeout(() => void this.tick(), this.intervalMs);
    }
}
