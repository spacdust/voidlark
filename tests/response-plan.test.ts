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

test('keeps numbered list items together', () => {
    const answer = `Dari katalog Aromatique, ada beberapa kandidat:

1. Agnes Monica New Agnes – karakter Musky Pea. Aroma floral dengan sentuhan musk yang lembut, cocok buat Kakak yang suka kesan fresh dan elegan.

2. Bacarat La Rose – karakter Clive Five. Lebih glamour dan floral dengan sentuhan mewah, cocok buat yang suka aroma bunga yang berani.

3. Bodyshop White Musk – karakter Suddenly. Aroma musk yang creamy dan feminin, mirip dengan dasar musk dari Monaco Royale.`;

    const result = buildResponsePlan(answer);
    
    // Each numbered item should be in its own bubble (intro + 3 items)
    assert.ok(result.bubbles.length >= 3);
    
    // No bubble should end with a number and period (indicating cut-off)
    for (const bubble of result.bubbles) {
        const endsWithCutoff = /\d+\.\s*$/.test(bubble.trim());
        assert.ok(!endsWithCutoff, `Bubble should not be cut off mid-item: "${bubble.slice(-50)}"`);
    }
    
    // Each numbered item description should be complete in one bubble
    const hasCompleteItems = result.bubbles.some(b => b.includes('Agnes Monica') && b.includes('fresh dan elegan'));
    assert.ok(hasCompleteItems, 'Item 1 description should not be split');
});

test('keeps bullet list items together', () => {
    const answer = `Berikut pilihan yang cocok:

- Secret Garden: Aroma fresh dan floral yang ringan, cocok untuk sehari-hari.
- Chanel Coco: Lebih bold dengan sentuhan oriental yang mewah.
- Dior Poison: Karakter spicy dan sensual yang memorable.`;

    const result = buildResponsePlan(answer);
    
    // No bullet item should be cut mid-description
    for (const bubble of result.bubbles) {
        const text = bubble.trim();
        if (text.startsWith('-')) {
            assert.ok(text.includes('.') || text.includes('!') || text.includes('?'), 
                'Bullet item should be complete');
        }
    }
});

test('merges orphaned list marker with following content', () => {
    // Kasus: intro text yang diakhiri "tersebut: 1." lalu konten di paragraf berikutnya
    const answer = `Di katalog Aromatique, ada beberapa kandidat yang cukup mendekati profil aroma tersebut: 1.

Agnes Monica New Agnes dengan varian Musky Pea — ini fresh floral dengan sentuhan musky yang ringan, cocok buat kesan segar kayak Monaco Royale.

2. Bacarat La Rose dengan varian Clive Five — ini lebih ke arah floral glamour yang elegan.`;

    const result = buildResponsePlan(answer);
    
    // List marker should not be orphaned at end of bubble
    for (const bubble of result.bubbles) {
        const endsWithOrphanMarker = /:\s*\d+\.\s*$/.test(bubble.trim());
        assert.ok(!endsWithOrphanMarker, `Bubble should not end with orphaned marker: "${bubble.slice(-50)}"`);
    }
    
    // Item 1 should be complete
    const hasCompleteItem1 = result.bubbles.some(b => 
        b.includes('1.') && b.includes('Agnes Monica') && b.includes('Monaco Royale')
    );
    assert.ok(hasCompleteItem1, 'Item 1 with marker and full description should be in one bubble');
});

test('separates intro ending with colon from numbered list items', () => {
    // Kasus yang diinginkan user: intro dengan ":" terpisah dari list items
    const answer = `Ada beberapa kandidat yang cukup mendekati profil aroma tersebut:

1. Agnes Monica New Agnes dengan varian Musky Pea — ini fresh floral dengan sentuhan musky yang ringan, cocok buat kesan segar kayak Monaco Royale.

2. Bacarat La Rose dengan varian Clive Five — ini lebih ke arah floral glamour yang elegan.`;

    const result = buildResponsePlan(answer);
    
    // Should have exactly 3 bubbles: intro + 2 list items
    assert.equal(result.bubbles.length, 3, 'Should have 3 bubbles: intro + 2 items');
    
    // Bubble 1: intro ending with colon (without "1.")
    assert.equal(result.bubbles[0], 'Ada beberapa kandidat yang cukup mendekati profil aroma tersebut:', 
        'First bubble should be intro ending with colon only');
    
    // Bubble 2: first list item starting with "1."
    assert.match(result.bubbles[1], /^1\.\s+Agnes Monica/, 
        'Second bubble should start with "1. Agnes Monica"');
    
    // Bubble 3: second list item starting with "2."
    assert.match(result.bubbles[2], /^2\.\s+Bacarat La Rose/, 
        'Third bubble should start with "2. Bacarat La Rose"');
});
