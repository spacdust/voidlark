import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { pool, type Database } from '../config/db.js';
import { markOrderPaid } from '../chat/orders.js';

type PaymentWebhookPayload = {
    eventId?: string;
    event_id?: string;
    type?: string;
    status?: string;
    orderId?: number | string;
    order_id?: number | string;
    jid?: string;
};

const headerValue = (request: Request, name: string) => String(request.headers[name] || '').trim();

const validSignature = (request: Request, rawBody: Buffer, secret: string) => {
    const configuredHeader = (process.env.PAYMENT_WEBHOOK_SIGNATURE_HEADER || 'x-payment-signature').toLowerCase();
    const supplied = headerValue(request, configuredHeader).replace(/^sha256=/i, '');
    if (supplied) {
        const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
        const suppliedBuffer = Buffer.from(supplied, 'hex');
        const expectedBuffer = Buffer.from(expected, 'hex');
        return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
    }
    return headerValue(request, 'x-payment-webhook-secret') === secret;
};

export const processPaymentWebhook = async (
    payload: PaymentWebhookPayload,
    rawBody: Buffer,
    request: Request,
    database: Database = pool,
) => {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET || '';
    if (!secret) return { status: 503, body: { ok: false, error: 'Payment webhook is not configured.' } };
    if (!validSignature(request, rawBody, secret)) return { status: 401, body: { ok: false, error: 'Invalid webhook signature.' } };

    const providerEventId = String(payload.eventId || payload.event_id || '').trim();
    const eventType = String(payload.type || 'payment.updated').trim();
    const paymentStatus = String(payload.status || '').toLowerCase();
    const orderId = Number(payload.orderId || payload.order_id);
    if (!providerEventId || !Number.isInteger(orderId) || orderId <= 0 || !paymentStatus) {
        return { status: 400, body: { ok: false, error: 'eventId, orderId, and status are required.' } };
    }

    const existing = await database.query('SELECT order_id, status FROM payment_events WHERE provider_event_id = $1', [providerEventId]);
    if (existing.rows[0]) return { status: 200, body: { ok: true, replayed: true } };

    const orderResult = await database.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    const order = orderResult.rows[0];
    if (!order || (payload.jid && payload.jid !== order.jid)) return { status: 404, body: { ok: false, error: 'Order not found.' } };

    try {
        await database.transaction(async (transaction) => {
            await transaction.query(
                `INSERT INTO payment_events (provider_event_id, order_id, event_type, status, payload)
                 VALUES ($1, $2, $3, $4, $5::jsonb)`,
                [providerEventId, orderId, eventType, paymentStatus, JSON.stringify(payload)],
            );
            if (['paid', 'settled', 'success', 'succeeded'].includes(paymentStatus) && order.status !== 'paid') {
                const result = await markOrderPaid(order.jid, orderId, transaction, 'payment_webhook');
                if (!result.ok) throw new Error(result.error);
            }
        });
    } catch (error: any) {
        if (/unique|duplicate/i.test(String(error?.message))) return { status: 200, body: { ok: true, replayed: true } };
        throw error;
    }
    return { status: 200, body: { ok: true, replayed: false } };
};

export const paymentWebhookHandler = async (request: Request, response: Response) => {
    const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.from(JSON.stringify(request.body || {}));
    let payload: PaymentWebhookPayload;
    try {
        payload = Buffer.isBuffer(request.body) ? JSON.parse(rawBody.toString('utf8')) : request.body;
    } catch {
        response.status(400).json({ ok: false, error: 'Invalid JSON.' });
        return;
    }
    const result = await processPaymentWebhook(payload, rawBody, request);
    response.status(result.status).json(result.body);
};
