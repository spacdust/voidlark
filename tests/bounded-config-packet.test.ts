import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { estimateConfiguredShippingWeightGrams } from '../src/api/rajaongkir.js';
import { buildClosingOrderRule, buildOrderConfirmationInstruction } from '../src/ai/agent.js';
import { validateBusinessHoursConfig } from '../src/chat/business-hours.js';

test('runtime shipping parsing honors arbitrary configured labels', () => {
    assert.equal(estimateConfiguredShippingWeightGrams('2 x 60ml dan 1 paket besar', { '60ml': 140, 'paket besar': 500 }, 900), 780);
    assert.equal(estimateConfiguredShippingWeightGrams('barang tanpa ukuran', { '60ml': 140 }, 900), 900);
});

test('post-order handoff controls whether payment instructions are sent', () => {
    const baseConfig = {
        enableShipping: false,
        paymentInstructions: 'Transfer ke rekening toko.',
    };

    const handoffRule = buildClosingOrderRule({ ...baseConfig, handoffAfterPaymentSummary: true });
    assert.match(handoffRule, /ringkasan pesanan saja/i);
    assert.match(handoffRule, /jangan kirim instruksi pembayaran/i);
    assert.doesNotMatch(handoffRule, /Transfer ke rekening toko/);

    const automaticRule = buildClosingOrderRule({ ...baseConfig, handoffAfterPaymentSummary: false });
    assert.match(automaticRule, /ringkasan pesanan dan instruksi pembayaran/i);
    assert.match(automaticRule, /Transfer ke rekening toko/);

    const handoffResult = buildOrderConfirmationInstruction({ ...baseConfig, handoffAfterPaymentSummary: true });
    assert.match(handoffResult, /ringkasan saja/i);
    assert.match(handoffResult, /admin akan melanjutkan/i);
    assert.doesNotMatch(handoffResult, /Transfer ke rekening toko/);

    const automaticResult = buildOrderConfirmationInstruction({ ...baseConfig, handoffAfterPaymentSummary: false });
    assert.match(automaticResult, /Transfer ke rekening toko/);

    const emptyPaymentRule = buildClosingOrderRule({ ...baseConfig, paymentInstructions: '', handoffAfterPaymentSummary: false });
    assert.match(emptyPaymentRule, /Instruksi pembayaran belum diatur/i);
    assert.doesNotMatch(emptyPaymentRule, /INSTRUKSI BAYAR:/i);
    const emptyPaymentResult = buildOrderConfirmationInstruction({ ...baseConfig, paymentInstructions: '', handoffAfterPaymentSummary: false });
    assert.match(emptyPaymentResult, /jangan membuat cara bayar sendiri/i);
    assert.doesNotMatch(emptyPaymentResult, /INSTRUKSI BAYAR:/i);
});

test('business-hours validation rejects values that can break inbound processing', () => {
    const valid = {
        enabled: true,
        timezone: 'Asia/Jakarta',
        weekly: { monday: ['09:00-17:00'], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] },
        holidays: ['2026-12-25'],
        outOfHoursResponse: 'Tutup', responseEstimate: 'Besok', handoffPolicy: 'create',
        slaMinutes: { low: 240, normal: 120, high: 60, urgent: 15 },
    } as const;
    assert.doesNotThrow(() => validateBusinessHoursConfig(valid as any));
    assert.throws(() => validateBusinessHoursConfig({ ...valid, timezone: 'Invalid/Zone' } as any), /timezone/i);
    assert.throws(() => validateBusinessHoursConfig({ ...valid, weekly: { ...valid.weekly, monday: ['25:00-17:00'] } } as any), /jam operasional/i);
    assert.throws(() => validateBusinessHoursConfig({ ...valid, slaMinutes: { ...valid.slaMinutes, high: 0 } } as any), /SLA/i);
});

test('config UI preserves hidden sales flow and exposes friendly operational controls', async () => {
    const source = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');
    const routeStart = source.indexOf("app.get('/admin/config'");
    const routeEnd = source.indexOf("app.get('/admin/prompt'", routeStart);
    const routes = source.slice(routeStart, routeEnd);

    assert.doesNotMatch(routes, /name="salesFlow"/);
    assert.match(routes, /salesFlow: previous\.salesFlow/);
    assert.doesNotMatch(routes, /name="shippingWeightLabel"|name="shippingWeightGrams"|data-add-weight/);
    assert.doesNotMatch(routes, /name="orderFields"|name="orderFieldsCustom"/);
    assert.match(routes, /Nama produk, seluruh variasi, harga, dan berat pengiriman mengikuti Produk & Harga/);
    assert.match(source, /Berat pengiriman \(gram\)/);
    assert.match(routes, /name="handoffAfterPaymentSummary"/);
    assert.match(source, /name="externalReferenceRules"/);
    assert.match(routes, /name="businessTimezone"/);
    assert.match(routes, /name="optOutKeywords"/);
    assert.doesNotMatch(routes, /name="businessHoursJson"|name="consentJson"/);
});

test('payment handoff is opt-in and happens after order confirmation', async () => {
    const source = await readFile(new URL('../src/ai/agent.ts', import.meta.url), 'utf8');
    const confirmation = source.slice(source.indexOf("case 'konfirmasiPesanan'"), source.indexOf("case 'cariReferensiProduk'"));
    assert.match(confirmation, /config\.handoffAfterPaymentSummary/);
    assert.ok(confirmation.indexOf('confirmDraftOrder') < confirmation.indexOf('postPaymentHandoff'));
    assert.match(confirmation, /orderConfirmed:/);
    assert.match(confirmation, /postPaymentHandoff:/);

    const outbound = await readFile(new URL('../src/whatsapp/connection.ts', import.meta.url), 'utf8');
    assert.ok(outbound.indexOf('outboundWorker.enqueue(jid, { text: result.text }') < outbound.indexOf('if (result.postPaymentHandoff)'));
});

test('dashboard stat row uses at most four columns and AI detail wraps compactly', async () => {
    const source = await readFile(new URL('../src/admin/server.ts', import.meta.url), 'utf8');
    assert.ok(source.includes('.grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));'));
    assert.ok(source.includes('.grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }'));
    assert.ok(source.includes('.grid { grid-template-columns: 1fr; }'));
    assert.match(source, /status-detail-wrap/);
    assert.match(source, /Pesan perlu retry/);
});
