import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const findJavaScript = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
        const fullPath = path.join(directory, entry.name);
        return entry.isDirectory() ? findJavaScript(fullPath) : /\.(?:c|m)?js$/i.test(entry.name) ? [fullPath] : [];
    }));
    return nested.flat();
};

test('application source contains TypeScript only', async () => {
    const files = await findJavaScript(path.resolve('src'));
    assert.deepEqual(files, [], `JavaScript source belongs in generated dist/, not src/: ${files.join(', ')}`);
});
