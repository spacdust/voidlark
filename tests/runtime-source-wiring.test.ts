import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { loadCatalogAromas } from '../src/ai/catalog-matcher.js';
import { readProductCatalog } from '../src/catalog/product-catalog.js';
import { getBusinessConfig } from '../src/config/business.js';
import { getReplyStyleConfig } from '../src/config/reply-style.js';

test('runtime product facts come from Knowledge and Products & Prices files', async () => {
    const source = fs.readFileSync('src/ai/catalog-matcher.ts', 'utf8');
    const aromas = await loadCatalogAromas();
    const catalog = readProductCatalog();
    assert.ok(aromas.length > 100);
    assert.ok(catalog.schemes.length > 0);
    for (const product of ['Annasui flight funcy', 'Bodyshop Oceanus', 'Beneton United Woman', 'Axe Anarki', 'Bacarat Rouge', 'Beneton Hot']) {
        assert.ok(aromas.some((item) => item.inspired === product));
        assert.ok(!source.includes(`'${product}'`) && !source.includes(`\`${product}\``));
    }
    for (const scheme of catalog.schemes) assert.ok(!source.includes(`'${scheme.name}'`) && !source.includes(`\`${scheme.name}\``));
    for (const scheme of catalog.schemes) {
        for (const axis of scheme.variations) {
            for (const value of axis.values) assert.ok(!source.includes(`'${value}'`) && !source.includes(`\`${value}\``));
        }
    }
    assert.ok(catalog.schemes.some((scheme) => scheme.domainRole === 'reference'));
    assert.ok(catalog.schemes.some((scheme) => scheme.domainRole === 'modified'));
    assert.doesNotMatch(source, /ExcelJS|readFileSync\([^)]*knowledge_base|for \(const start of \[0, 6, 13\]\)/);
    assert.match(source, /getKnowledgeBase\(\)/);
});

test('runtime flow and reply style come from admin-managed config files', () => {
    const business = JSON.parse(fs.readFileSync('business.config.json', 'utf8'));
    const promptBuilder = JSON.parse(fs.readFileSync('prompt.builder.json', 'utf8'));
    const activeBusiness = getBusinessConfig();
    const activeStyle = getReplyStyleConfig();
    assert.equal(activeBusiness.salesFlow, business.salesFlow);
    assert.equal(activeBusiness.enableExternalProductLookup, business.enableExternalProductLookup);
    assert.equal(activeBusiness.enableShipping, business.productType === 'physical' && business.enableShipping);
    assert.equal(activeBusiness.paymentInstructions, business.paymentInstructions);
    assert.equal(activeStyle.salutation, promptBuilder.salutation);
    assert.equal(activeStyle.replyLength, promptBuilder.replyLength);
    assert.match(fs.readFileSync('config/system-prompt.txt', 'utf8'), new RegExp(promptBuilder.salutation, 'i'));
});
