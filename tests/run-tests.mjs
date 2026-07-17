import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const testDirectory = fileURLToPath(new URL('.', import.meta.url));
const testFiles = readdirSync(testDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.ts'))
    .map((entry) => fileURLToPath(new URL(entry.name, import.meta.url)))
    .sort();

if (testFiles.length === 0) {
    console.error('No test files found.');
    process.exit(1);
}

const cwd = fileURLToPath(new URL('..', import.meta.url));
const timeout = Number(process.env.TEST_FILE_TIMEOUT_MS || 120_000);

for (const testFile of testFiles) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', testFile], {
        cwd,
        stdio: 'inherit',
        timeout,
        killSignal: 'SIGKILL',
    });
    if (result.error) {
        if (result.error.code === 'ETIMEDOUT') console.error(`Test file timed out after ${timeout}ms: ${testFile}`);
        else console.error(result.error);
        process.exit(1);
    }
    if (result.status !== 0) process.exit(result.status ?? 1);
}
