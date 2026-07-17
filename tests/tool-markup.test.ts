import assert from 'node:assert/strict';
import test from 'node:test';
import { containsInternalMarkup, parseTextToolCalls, parseToolArguments, stripInternalMarkup } from '../src/ai/tool-markup.js';

test('parses DeepSeek DSML tool markup', () => {
    const input = `<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="cariReferensiProduk">
<｜｜DSML｜｜parameter name="query" string="true">Monaco Royale Mykonos pear melon cedarwood caramel musk aroma parfum</｜｜DSML｜｜parameter>
<｜｜DSML｜｜parameter name="forceExternal" string="false">true</｜｜DSML｜｜parameter>
</｜｜DSML｜｜invoke>
</｜｜DSML｜｜tool_calls>`;

    assert.deepEqual(parseTextToolCalls(input), [{
        name: 'cariReferensiProduk',
        arguments: {
            query: 'Monaco Royale Mykonos pear melon cedarwood caramel musk aroma parfum',
            forceExternal: true,
        },
    }]);
});

test('ignores normal customer-facing text', () => {
    assert.deepEqual(parseTextToolCalls('Di katalog kami ada Secret Garden, Kak.'), []);
});

test('recovers usable fields from malformed tool JSON', () => {
    assert.deepEqual(parseToolArguments('{"query":"Monaco Royale","forceExternal":true trailing}'), {
        query: 'Monaco Royale',
        forceExternal: true,
    });
});

test('parses compact DSML and ignores appended environment details', () => {
    const input = '<｜｜DSML｜｜tool_calls> <｜｜DSML｜｜invoke name="cariReferensiProduk"> <｜｜DSML｜｜parameter name="query" string="true">Mykonos Monaco Royale similar perfume</｜｜DSML｜｜parameter> </｜｜DSML｜｜invoke> </｜｜DSML｜｜tool_calls><environment_details>secret workspace data</environment_details>';
    assert.equal(parseTextToolCalls(input)[0]?.arguments.query, 'Mykonos Monaco Royale similar perfume');
    assert.equal(stripInternalMarkup(input), '');
    assert.equal(containsInternalMarkup(input), true);
});

test('strips internal environment block from otherwise valid answer', () => {
    assert.equal(stripInternalMarkup('Jawaban aman.<environment_details>private</environment_details>'), 'Jawaban aman.');
});

test('strips unclosed environment block through end of output', () => {
    assert.equal(stripInternalMarkup('Jawaban aman.<environment_details>private workspace data'), 'Jawaban aman.');
});

test('strips environment block regardless of tag case or surrounding whitespace', () => {
    assert.equal(stripInternalMarkup('Jawaban aman.\n <ENVIRONMENT_DETAILS>private\n</ENVIRONMENT_DETAILS>'), 'Jawaban aman.');
});
