import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DB_DRIVER = 'sqlite';

const setup = async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'voidlark-package-e-'));
    const knowledgeDir = path.join(directory, 'knowledge');
    await mkdir(knowledgeDir);
    const { createSqliteDatabase } = await import('../src/config/db.js');
    const { initSchema } = await import('../src/config/schema.js');
    const { KnowledgeStore } = await import('../src/ai/knowledge-store.js');
    const { KnowledgeIngestionWorker } = await import('../src/ai/knowledge-worker.js');
    const database = createSqliteDatabase(path.join(directory, 'test.db'));
    await initSchema(database);
    const store = new KnowledgeStore(database, 'sqlite');
    const worker = new KnowledgeIngestionWorker({ store, knowledgeDir, pollIntervalMs: 10_000 });
    return { directory, knowledgeDir, database, store, worker };
};

test('bounded chunking preserves ordered boundaries and overlap', async () => {
    const { chunkKnowledgeText } = await import('../src/ai/knowledge-chunking.js');
    const source = Array.from({ length: 80 }, (_, index) => `Sentence ${index} contains useful catalog detail.`).join(' ');
    const chunks = chunkKnowledgeText(source, { maxChars: 300, overlapChars: 40, minChars: 120 });
    assert.ok(chunks.length > 3);
    assert.ok(chunks.every((chunk) => chunk.content.length <= 300 && chunk.charEnd > chunk.charStart));
    assert.deepEqual(chunks.map((chunk) => chunk.index), chunks.map((_, index) => index));
    assert.ok(chunks.slice(1).every((chunk, index) => chunk.charStart < chunks[index].charEnd));
});

test('checksum dedupe stores one document for duplicate bytes', async () => {
    const context = await setup();
    try {
        await writeFile(path.join(context.knowledgeDir, 'a.txt'), 'identical catalog content');
        await writeFile(path.join(context.knowledgeDir, 'b.txt'), 'identical catalog content');
        const queued = await context.store.enqueue('test');
        await context.worker.runOnce();
        const completed = (await context.store.listJobs()).find((job) => job.id === queued.id)!;
        assert.equal(completed.status, 'succeeded', completed.last_error || undefined);
        assert.equal(Number((await context.database.query('SELECT COUNT(*) AS count FROM knowledge_documents')).rows[0].count), 1);
    } finally {
        context.worker.stop(); await context.database.end(); await rm(context.directory, { recursive: true, force: true });
    }
});

test('failed corpus does not activate and preserves previous version', async () => {
    const context = await setup();
    try {
        await writeFile(path.join(context.knowledgeDir, 'good.txt'), 'stable previous catalog price 100');
        const first = await context.store.enqueue('initial', 1);
        await context.worker.runOnce();
        assert.equal((await context.store.listJobs()).find((job) => job.id === first.id)?.status, 'succeeded');
        const before = await context.database.query('SELECT corpus_version_id FROM knowledge_active_corpus WHERE singleton_id = 1');
        await writeFile(path.join(context.knowledgeDir, 'broken.pdf'), 'not a pdf');
        const second = await context.store.enqueue('failure', 1);
        await context.worker.runOnce();
        assert.equal((await context.store.listJobs()).find((job) => job.id === second.id)?.status, 'failed');
        const after = await context.database.query('SELECT corpus_version_id FROM knowledge_active_corpus WHERE singleton_id = 1');
        assert.equal(Number(after.rows[0].corpus_version_id), Number(before.rows[0].corpus_version_id));
        assert.match(await context.store.getActiveKnowledgeBase(), /stable previous catalog/);
    } finally {
        context.worker.stop(); await context.database.end(); await rm(context.directory, { recursive: true, force: true });
    }
});

test('expired ingestion lease is recovered by a restarted worker', async () => {
    const context = await setup();
    try {
        await writeFile(path.join(context.knowledgeDir, 'restart.txt'), 'knowledge survives worker restart');
        const queued = await context.store.enqueue('restart', 1);
        const abandoned = await context.store.claim(-1);
        await new Promise((resolve) => setTimeout(resolve, 2));
        assert.equal(abandoned?.id, queued.id);
        assert.equal(abandoned?.status, 'processing');
        const restarted = new (await import('../src/ai/knowledge-worker.js')).KnowledgeIngestionWorker({
            store: context.store,
            knowledgeDir: context.knowledgeDir,
            pollIntervalMs: 10_000,
        });
        await restarted.runOnce();
        restarted.stop();
        assert.equal((await context.store.listJobs()).find((item) => item.id === queued.id)?.status, 'succeeded');
        assert.match(await context.store.getActiveKnowledgeBase(), /survives worker restart/);
    } finally {
        context.worker.stop(); await context.database.end(); await rm(context.directory, { recursive: true, force: true });
    }
});

test('mid-activation database failure rolls back documents and keeps prior corpus active', async () => {
    const context = await setup();
    try {
        await writeFile(path.join(context.knowledgeDir, 'stable.txt'), 'stable active corpus');
        await context.store.enqueue('initial', 1);
        await context.worker.runOnce();
        const activeBefore = Number((await context.database.query('SELECT corpus_version_id FROM knowledge_active_corpus WHERE singleton_id = 1')).rows[0].corpus_version_id);
        await writeFile(path.join(context.knowledgeDir, 'new.txt'), 'new corpus that must not partially activate');
        let injected = false;
        const failingDatabase = {
            query: async (sql: string, params?: unknown[]) => context.database.query(sql, params),
            transaction: async <T>(work: (database: typeof failingDatabase) => Promise<T>) => context.database.transaction(async (transaction) => work({
                query: async (sql: string, params?: unknown[]) => {
                    if (!injected && sql.includes('INSERT INTO knowledge_chunks')) {
                        injected = true;
                        throw new Error('injected chunk write failure');
                    }
                    return transaction.query(sql, params);
                },
                transaction: async <U>(nested: (database: typeof failingDatabase) => Promise<U>) => nested(failingDatabase),
                end: async () => undefined,
            } as never)),
            end: async () => undefined,
        };
        const { KnowledgeStore } = await import('../src/ai/knowledge-store.js');
        const { KnowledgeIngestionWorker } = await import('../src/ai/knowledge-worker.js');
        const failingStore = new KnowledgeStore(failingDatabase as never, 'sqlite');
        const failingWorker = new KnowledgeIngestionWorker({ store: failingStore, knowledgeDir: context.knowledgeDir, pollIntervalMs: 10_000 });
        const queued = await failingStore.enqueue('atomic-failure', 1);
        await failingWorker.runOnce();
        failingWorker.stop();
        const failed = (await failingStore.listJobs()).find((item) => item.id === queued.id)!;
        assert.equal(failed.status, 'failed');
        assert.match(failed.last_error || '', /injected chunk write failure/);
        assert.equal(Number((await context.database.query('SELECT corpus_version_id FROM knowledge_active_corpus WHERE singleton_id = 1')).rows[0].corpus_version_id), activeBefore);
        assert.equal(Number((await context.database.query('SELECT COUNT(*) AS count FROM knowledge_documents WHERE corpus_version_id = $1', [failed.corpus_version_id])).rows[0].count), 0);
        assert.equal(Number((await context.database.query('SELECT COUNT(*) AS count FROM knowledge_chunks WHERE corpus_version_id = $1', [failed.corpus_version_id])).rows[0].count), 0);
    } finally {
        context.worker.stop(); await context.database.end(); await rm(context.directory, { recursive: true, force: true });
    }
});

test('lexical retrieval is relevant, stable, and returns citations', async () => {
    const { retrieveFromChunks } = await import('../src/ai/knowledge-retrieval.js');
    const chunks = [
        { id: 1, documentId: 1, fileName: 'general.txt', chunkIndex: 0, content: 'Shipping and generic store information.' },
        { id: 2, documentId: 2, fileName: 'perfume.txt', chunkIndex: 0, content: 'Vanilla amber perfume has warm vanilla aroma and long lasting character.' },
        { id: 3, documentId: 2, fileName: 'perfume.txt', chunkIndex: 1, content: 'Citrus perfume has a fresh lemon aroma.' },
    ];
    const first = retrieveFromChunks(chunks, 'warm vanilla perfume');
    const second = retrieveFromChunks(chunks, 'warm vanilla perfume');
    assert.deepEqual(first, second);
    assert.equal(first.citations[0].chunkId, 2);
    assert.match(first.text, /Vanilla amber/);
    assert.ok(first.evidence[0].score > first.evidence[1].score);
});
