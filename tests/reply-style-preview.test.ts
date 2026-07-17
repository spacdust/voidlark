import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReplyStyleExample } from '../src/admin/reply-style-preview.js';

test('builds customer-facing preview instead of concatenating instructions', () => {
    const result = buildReplyStyleExample({ businessName: 'Aromatique', csName: 'Anin', preset: 'friendly' });
    assert.match(result, /Halo Kak|Anin|Aromatique/i);
    assert.doesNotMatch(result, /Gunakan|Jangan|Config|aturan/i);
});

test('adapts preview to concise and formal presets', () => {
    assert.match(buildReplyStyleExample({ businessName: 'Nova', csName: 'Nia', preset: 'concise' }), /singkat|langsung/i);
    assert.match(buildReplyStyleExample({ businessName: 'Nova', csName: 'Nia', preset: 'formal' }), /Selamat datang|dengan senang hati/i);
});
