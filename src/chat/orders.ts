import { pool, type Database } from '../config/db.js';
import { getBusinessConfig, type BusinessConfig } from '../config/business.js';
import { readProductCatalog, resolveCatalogOffer, type ProductCatalog } from '../catalog/product-catalog.js';

export type ChatStage =
    | 'consulting'
    | 'aroma_selected'
    | 'variant_selected'
    | 'quality_selected'
    | 'checkout_data'
    | 'shipping_selected'
    | 'awaiting_payment'
    | 'completed';

export interface DraftOrder {
    jid: string;
    productName?: string;
    aroma?: string;
    variant?: string;
    quality?: string;
    sizeMl?: number;
    packageSize?: string;
    quantity?: number;
    productPrice?: number;
    options?: Record<string, unknown>;
    customerData?: Record<string, unknown>;
    customerName?: string;
    phone?: string;
    address?: string;
    shippingOption?: string;
    shippingCost?: number;
    status?: string;
}

export type OrderRow = Record<string, any>;
export type OrderStatus = 'draft' | 'confirmed' | 'awaiting_payment' | 'paid' | 'shipped' | 'completed' | 'cancelled';

const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
    draft: ['confirmed', 'awaiting_payment', 'cancelled'],
    confirmed: ['awaiting_payment', 'paid', 'cancelled'],
    awaiting_payment: ['paid', 'cancelled'],
    paid: ['shipped'],
    shipped: ['completed'],
    completed: [],
    cancelled: [],
};

export class InvalidOrderTransitionError extends Error {
    constructor(from: string, to: string) {
        super(`Order transition ${from} -> ${to} is not allowed`);
        this.name = 'InvalidOrderTransitionError';
    }
}

export const assertOrderTransition = (from: string, to: string) => {
    if (!(ORDER_TRANSITIONS[from as OrderStatus] || []).includes(to as OrderStatus)) {
        throw new InvalidOrderTransitionError(from, to);
    }
};

export const transitionOrder = async (database: Database, order: OrderRow, status: OrderStatus) => {
    assertOrderTransition(String(order.status), status);
    const result = await database.query(
        'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 AND status = $3',
        [status, order.id, order.status],
    );
    if (result.rowCount !== 1) throw new Error(`Order ${order.id} changed concurrently`);
};

const appendAuditEvent = async (
    database: Database,
    eventType: string,
    order: OrderRow,
    actor: string,
    data: Record<string, unknown>,
) => database.query(
    `INSERT INTO audit_events (event_type, aggregate_type, aggregate_id, actor, data)
     VALUES ($1, 'order', $2, $3, $4::jsonb)`,
    [eventType, String(order.id), actor, JSON.stringify(data)],
);

const appendOutboundIntent = async (
    database: Database,
    dedupeKey: string,
    jid: string,
    intentType: string,
    payload: Record<string, unknown>,
) => database.query(
    `INSERT INTO outbound_intents (dedupe_key, jid, intent_type, payload) VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [dedupeKey, jid, intentType, JSON.stringify(payload)],
);

const formatRp = (value: unknown) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return `Rp${n.toLocaleString('id-ID')}`;
};

export const buildOrderSummary = (order: OrderRow) => {
    const product = order.product_name || order.aroma || 'Produk';
    const lines = [
        `ID: #${order.id}`,
        `Produk: ${product}`,
        order.variant ? `Varian: ${order.variant}` : '',
        order.quality ? `Level: ${order.quality}` : '',
        order.package_size || order.size_ml ? `Ukuran: ${order.package_size || `${order.size_ml}ml`}` : '',
        order.quantity ? `Qty: ${order.quantity}` : '',
        formatRp(order.product_price) ? `Harga produk: ${formatRp(order.product_price)}` : '',
        order.shipping_option ? `Kurir: ${order.shipping_option}` : '',
        formatRp(order.shipping_cost) ? `Ongkir: ${formatRp(order.shipping_cost)}` : '',
        order.customer_name ? `Nama: ${order.customer_name}` : '',
        order.phone ? `HP: ${order.phone}` : '',
        order.address ? `Alamat: ${order.address}` : '',
        order.status ? `Status: ${order.status}` : '',
    ].filter(Boolean);

    const productPrice = (Number(order.product_price) || 0) * Math.max(1, Number(order.quantity) || 1);
    const shippingCost = Number(order.shipping_cost) || 0;
    if (productPrice || shippingCost) {
        lines.push(`Total: ${formatRp(productPrice + shippingCost)}`);
    }
    return lines.join('\n');
};

const recordValue = (value: unknown): Record<string, unknown> => {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value !== 'string') return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
};

export const validateDraftOrderForConfirmation = (
    draft: OrderRow,
    config: BusinessConfig = getBusinessConfig(),
    catalog: ProductCatalog = readProductCatalog(),
) => {
    const product = String(draft.product_name || draft.aroma || '').trim();
    if (!product) return { valid: false as const, error: 'Draft belum punya produk.' };
    const quantity = Number(draft.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) return { valid: false as const, error: 'Jumlah produk belum dipilih.' };

    const options = recordValue(draft.options);
    if (catalog.schemes.length) {
        const offer = resolveCatalogOffer({
            classification: String(draft.variant || ''),
            attributes: Object.keys(options).length ? Object.fromEntries(Object.entries(options).map(([key, value]) => [key, String(value)])) : undefined,
            quality: draft.quality ? String(draft.quality) : undefined,
            sizeMl: Number(draft.size_ml) || undefined,
            quantity,
        }, catalog);
        if (!offer.valid) return { valid: false as const, error: `Pilihan produk belum lengkap: ${offer.error}` };
        if (Number(draft.product_price) !== offer.unitPrice) return { valid: false as const, error: 'Harga draft belum cocok dengan katalog aktif.' };
    } else if (!Number.isFinite(Number(draft.product_price)) || Number(draft.product_price) < 0) {
        return { valid: false as const, error: 'Harga produk belum terverifikasi.' };
    }

    const customerData = recordValue(draft.customer_data);
    const checkoutValues: Record<string, unknown> = {
        ...customerData,
        name: draft.customer_name ?? customerData.name,
        phone: draft.phone ?? customerData.phone,
        address: draft.address ?? customerData.address,
    };
    const missingCheckout = config.checkoutFields.filter((field) => !String(checkoutValues[field] ?? '').trim());
    if (missingCheckout.length) return { valid: false as const, error: `Data checkout masih kurang: ${missingCheckout.join(', ')}.` };
    if (config.enableShipping) {
        if (!String(draft.address || checkoutValues.address || '').trim()) return { valid: false as const, error: 'Alamat pengiriman belum lengkap.' };
        if (!String(draft.shipping_option || '').trim() || !Number.isFinite(Number(draft.shipping_cost))) {
            return { valid: false as const, error: 'Pilihan kurir dan ongkir belum dikunci.' };
        }
    }
    return { valid: true as const };
};

export const confirmDraftOrder = async (jid: string, note?: string, database: Database = pool) => {
    const draft = await getDraftOrder(jid, database);
    if (!draft) {
        return { ok: false as const, error: 'Belum ada draft pesanan untuk customer ini.' };
    }

    const validation = validateDraftOrderForConfirmation(draft);
    if (!validation.valid) return { ok: false as const, error: validation.error };

    await database.transaction(async (transaction) => {
        await transitionOrder(transaction, draft, 'awaiting_payment');
        const confirmedAt = new Date().toISOString();
        await setChatState(jid, 'awaiting_payment', { orderId: draft.id, note: note || '', confirmedAt }, transaction);
        await appendAuditEvent(transaction, 'order.awaiting_payment', draft, 'customer', { from: draft.status, to: 'awaiting_payment', note: note || '' });
        await appendOutboundIntent(transaction, `order:${draft.id}:awaiting_payment`, jid, 'order.awaiting_payment', { orderId: draft.id });
    });

    const { rows } = await database.query('SELECT * FROM orders WHERE id = $1', [draft.id]);
    const order = rows[0];
    return {
        ok: true as const,
        order,
        summary: buildOrderSummary(order),
    };
};

export const markOrderPaid = async (jid: string, orderId?: number, database: Database = pool, actor = 'admin') => {
    const target = orderId
        ? await database.query('SELECT * FROM orders WHERE id = $1 AND jid = $2', [orderId, jid])
        : await database.query(
            "SELECT * FROM orders WHERE jid = $1 AND status IN ('awaiting_payment', 'confirmed') ORDER BY updated_at DESC LIMIT 1",
            [jid]
        );
    if (!target.rows[0]) {
        return { ok: false as const, error: 'Order menunggu pembayaran tidak ditemukan.' };
    }
    const order = target.rows[0];
    await database.transaction(async (transaction) => {
        await transitionOrder(transaction, order, 'paid');
        const paidAt = new Date().toISOString();
        await setChatState(jid, 'completed', { orderId: order.id, paidAt }, transaction);
        await appendAuditEvent(transaction, 'order.paid', order, actor, { from: order.status, to: 'paid' });
        await appendOutboundIntent(transaction, `order:${order.id}:paid`, jid, 'order.paid', { orderId: order.id });
    });
    const { rows } = await database.query('SELECT * FROM orders WHERE id = $1', [order.id]);
    return { ok: true as const, order: rows[0], summary: buildOrderSummary(rows[0]) };
};

export const advanceOrderStatus = async (orderId: number, status: 'shipped' | 'completed' | 'cancelled', actor = 'admin', details: Record<string, unknown> = {}, database: Database = pool) => {
    const current = await database.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    const order = current.rows[0];
    if (!order) return { ok: false as const, error: 'Pesanan tidak ditemukan.' };
    const trackingNumber = String(details.trackingNumber || '').trim();
    const shippingCarrier = String(details.shippingCarrier || '').trim();
    const cancellationReason = String(details.cancellationReason || '').trim();
    if (status === 'shipped' && !trackingNumber) return { ok: false as const, error: 'Nomor resi wajib diisi.' };
    await database.transaction(async (transaction) => {
        await transitionOrder(transaction, order, status);
        if (status === 'shipped') await transaction.query(
            'UPDATE orders SET tracking_number = $1, shipping_carrier = $2, shipped_at = NOW() WHERE id = $3',
            [trackingNumber, shippingCarrier || null, order.id],
        );
        if (status === 'completed') await transaction.query('UPDATE orders SET completed_at = NOW() WHERE id = $1', [order.id]);
        if (status === 'cancelled') await transaction.query(
            'UPDATE orders SET cancelled_at = NOW(), cancellation_reason = $1 WHERE id = $2',
            [cancellationReason || null, order.id],
        );
        await appendAuditEvent(transaction, `order.${status}`, order, actor, { from: order.status, to: status, ...details });
        await appendOutboundIntent(transaction, `order:${order.id}:${status}`, order.jid, `order.${status}`, { orderId: order.id, ...details });
    });
    return { ok: true as const, order: (await database.query('SELECT * FROM orders WHERE id = $1', [orderId])).rows[0] };
};

const toSnake = (order: DraftOrder) => ({
    product_name: order.productName,
    aroma: order.aroma,
    variant: order.variant,
    quality: order.quality,
    size_ml: order.sizeMl,
    package_size: order.packageSize,
    quantity: order.quantity,
    product_price: order.productPrice,
    options: order.options ? JSON.stringify(order.options) : undefined,
    customer_data: order.customerData ? JSON.stringify(order.customerData) : undefined,
    customer_name: order.customerName,
    phone: order.phone,
    address: order.address,
    shipping_option: order.shippingOption,
    shipping_cost: order.shippingCost,
    status: order.status,
});

export const getChatState = async (jid: string): Promise<{ stage: ChatStage; data: Record<string, unknown> }> => {
    const { rows } = await pool.query('SELECT stage, data FROM chat_state WHERE jid = $1', [jid]);
    return rows[0] || { stage: 'consulting', data: {} };
};

export const setChatState = async (jid: string, stage: ChatStage, data: Record<string, unknown> = {}, database: Database = pool) => {
    const current = await database.query('SELECT data FROM chat_state WHERE jid = $1', [jid]);
    const previous = current.rows[0]?.data;
    const merged = {
        ...(previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}),
        ...data,
    };
    await database.query(
        `INSERT INTO chat_state (jid, stage, data) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (jid) DO UPDATE SET stage = EXCLUDED.stage, data = EXCLUDED.data, updated_at = NOW()`,
        [jid, stage, JSON.stringify(merged)]
    );
};

export const upsertDraftOrder = async (order: DraftOrder) => {
    const fields = Object.entries(toSnake(order)).filter(([, value]) => value !== undefined && value !== null && value !== '');
    const existing = await pool.query(
        "SELECT id FROM orders WHERE jid = $1 AND status = 'draft' ORDER BY updated_at DESC LIMIT 1",
        [order.jid]
    );

    if (fields.length === 0) {
        if (existing.rows.length === 0) {
            await pool.query('INSERT INTO orders (jid) VALUES ($1)', [order.jid]);
        }
        return;
    }

    if (existing.rows.length === 0) {
        const columns = ['jid', ...fields.map(([key]) => key)];
        const values = [order.jid, ...fields.map(([, value]) => value)];
        const placeholders = values.map((_, index) => `$${index + 1}`);
        await pool.query(`INSERT INTO orders (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`, values);
        return;
    }

    const values = fields.map(([, value]) => value);
    const assignments = fields.map(([key], index) => {
        const placeholder = `$${index + 1}`;
        return key === 'options' || key === 'customer_data'
            ? `${key} = ${placeholder}::jsonb`
            : `${key} = ${placeholder}`;
    });
    await pool.query(
        `UPDATE orders SET ${assignments.join(', ')}, updated_at = NOW() WHERE id = $${values.length + 1}`,
        [...values, existing.rows[0].id]
    );
};

export const getDraftOrder = async (jid: string, database: Database = pool) => {
    const { rows } = await database.query(
        "SELECT * FROM orders WHERE jid = $1 AND status = 'draft' ORDER BY updated_at DESC LIMIT 1",
        [jid]
    );
    return rows[0] || null;
};

export const clearDraftProductName = async (jid: string, database: Database = pool) => {
    await database.query(
        "UPDATE orders SET product_name = NULL, aroma = NULL, updated_at = NOW() WHERE jid = $1 AND status = 'draft'",
        [jid],
    );
};

export const clearOrderState = async (jid: string) => {
    await pool.query('DELETE FROM chat_state WHERE jid = $1', [jid]);
    await pool.query("DELETE FROM orders WHERE jid = $1 AND status = 'draft'", [jid]);
};

export const getOrderById = async (id: number) => {
    const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [id]);
    return rows[0] || null;
};
