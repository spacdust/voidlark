import assert from 'node:assert/strict';
import test from 'node:test';
import { buildResponsePlan } from '../src/ai/response-plan.js';

test('keeps a short answer in one bubble', () => {
    assert.deepEqual(buildResponsePlan('Secret Garden harganya Rp120.000, Kak.'), {
        bubbles: ['Secret Garden harganya Rp120.000, Kak.'],
    });
});

test('uses semantic paragraphs as separate bubbles', () => {
    const answer = [
        'Mykonos Monaco Royale punya karakter fruity-floral yang segar.',
        'Di katalog kami, Secret Garden adalah kandidat yang paling mendekati.',
        'Mau aku jelaskan perbedaannya, Kak?',
    ].join('\n\n');

    assert.deepEqual(buildResponsePlan(answer), { bubbles: answer.split('\n\n') });
});

test('splits a long paragraph only at sentence boundaries', () => {
    const sentence = 'Aroma ini memiliki nuansa fruity-floral yang segar dan lembut.';
    const result = buildResponsePlan(`${sentence} ${sentence} ${sentence} ${sentence}`, { maxBubbleChars: 140 });

    assert.ok(result.bubbles.length > 1);
    assert.ok(result.bubbles.length <= 3);
    assert.ok(result.bubbles.every((bubble) => /[.!?]$/.test(bubble)));
});

test('never returns more than three non-empty bubbles', () => {
    const answer = ['Satu.', 'Dua.', 'Tiga.', 'Empat.', 'Lima.'].join('\n\n');
    const result = buildResponsePlan(answer);

    assert.equal(result.bubbles.length, 3);
    assert.ok(result.bubbles.every(Boolean));
    assert.match(result.bubbles[2], /Lima\.$/);
});

test('uses a safe fallback for empty model output', () => {
    assert.deepEqual(buildResponsePlan('  '), {
        bubbles: ['Maaf Kak, aku belum bisa menyusun jawaban. Aku bantu teruskan ke admin ya.'],
    });
});
