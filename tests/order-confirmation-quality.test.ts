import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDraftOrderForConfirmation } from '../src/chat/orders.js';
import type { BusinessConfig } from '../src/config/business.js';

const config = (physical: boolean): BusinessConfig => ({
    businessName: 'Toko', csName: 'Nia', productType: physical ? 'physical' : 'digital', enableShipping: physical,
    enableExternalProductLookup: false, salesFlow: 'consultative', checkoutFields: physical ? ['name', 'phone', 'address'] : ['name', 'phone', 'email'],
    orderFields: ['productName', 'quantity'], paymentInstructions: 'Bayar', handoffAfterPaymentSummary: false,
    businessHours: { enabled: false, timezone: 'Asia/Jakarta', weekly: { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] }, holidays: [], outOfHoursResponse: '', responseEstimate: '', handoffPolicy: 'none', slaMinutes: { low: 1, normal: 1, high: 1, urgent: 1 } },
    consent: { optOutKeywords: [], optInKeywords: [], optOutResponse: '', optInResponse: '' },
});

const catalog = {
    version: 3 as const,
    schemes: [{ id: 'plan', name: 'Paket', aliases: ['paket'], variations: [{ id: 'tier', name: 'Tier', values: ['Pro'] }], options: [{ values: { tier: 'Pro' }, price: 50_000 }] }],
};

const complete = { product_name: 'Studio', variant: 'Paket', options: { Tier: 'Pro' }, quantity: 1, product_price: 50_000, customer_name: 'Dina', phone: '08123456789', address: 'Bandung', shipping_option: 'REG', shipping_cost: 10_000 };

test('order confirmation fails closed until catalog, checkout, and shipping data are complete', () => {
    assert.equal(validateDraftOrderForConfirmation({ ...complete, quantity: undefined }, config(true), catalog).valid, false);
    assert.equal(validateDraftOrderForConfirmation({ ...complete, options: {} }, config(true), catalog).valid, false);
    assert.equal(validateDraftOrderForConfirmation({ ...complete, product_price: 45_000 }, config(true), catalog).valid, false);
    assert.equal(validateDraftOrderForConfirmation({ ...complete, phone: undefined }, config(true), catalog).valid, false);
    assert.equal(validateDraftOrderForConfirmation({ ...complete, shipping_option: undefined }, config(true), catalog).valid, false);
    assert.equal(validateDraftOrderForConfirmation(complete, config(true), catalog).valid, true);
});

test('digital checkout uses configured fields and does not require shipping', () => {
    const digital = { ...complete, address: undefined, shipping_option: undefined, shipping_cost: undefined, customer_data: { email: 'dina@example.com' } };
    assert.equal(validateDraftOrderForConfirmation(digital, config(false), catalog).valid, true);
});
