import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chunkKnowledgeText } from './knowledge-chunking.js';
import { extractKnowledgeFile } from './knowledge-extraction.js';
import { KnowledgeStore, knowledgeStore, type IngestedDocument, type KnowledgeJob } from './knowledge-store.js';
import { operationalMetrics } from '../operations/metrics.js';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const checksum = (buffer: Buffer | string) => createHash('sha256').update(buffer).digest('hex');
const isTemporaryKnowledgeFile = (name: string) => name.startsWith('~$') || name.startsWith('.') || /(?:\.tmp|\.temp|\.part|\.crdownload)$/i.test(name);

export interface KnowledgeWorkerOptions {
    store?: KnowledgeStore;
    knowledgeDir?: string;
    pollIntervalMs?: number;
    extractor?: typeof extractKnowledgeFile;
    onActivated?: () => Promise<void> | void;
}

export class KnowledgeIngestionWorker {
    private running = false;
    private stopped = false;
    private pollTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly store: KnowledgeStore;
    private readonly knowledgeDir: string;
    private readonly pollIntervalMs: number;
    private readonly extractor: typeof extractKnowledgeFile;

    constructor(private readonly options: KnowledgeWorkerOptions = {}) {
        this.store = options.store || knowledgeStore;
        this.knowledgeDir = options.knowledgeDir || path.resolve('knowledge_base');
        this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
        this.extractor = options.extractor || extractKnowledgeFile;
    }

    async enqueue(reason = 'reload') {
        const queued = await this.store.enqueue(reason);
        this.wake();
        return queued;
    }

    wake() {
        if (this.running || this.stopped) return;
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this.pollTimer = null;
        this.running = true;
        void this.loop().finally(() => {
            this.running = false;
            if (!this.stopped) this.pollTimer = setTimeout(() => this.wake(), this.pollIntervalMs);
        });
    }

    stop() {
        this.stopped = true;
        if (this.pollTimer) clearTimeout(this.pollTimer);
    }

    async runOnce() {
        const current = await this.store.claim();
        if (!current) return null;
        await this.process(current);
        return current.id;
    }

    async waitFor(jobId: number, timeoutMs = 120_000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const current = (await this.store.listJobs(100)).find((item) => item.id === jobId);
            if (current?.status === 'succeeded' || current?.status === 'failed') return current;
            await wait(50);
        }
        throw new Error(`Ingestion job ${jobId} melewati batas waktu.`);
    }

    private async loop() {
        while (!this.stopped && await this.runOnce() !== null) continue;
    }

    private async process(current: KnowledgeJob) {
        const started = process.hrtime.bigint();
        try {
            await fs.mkdir(this.knowledgeDir, { recursive: true });
            const names = (await fs.readdir(this.knowledgeDir)).sort((a, b) => a.localeCompare(b));
            const files: Array<{ name: string; path: string; buffer: Buffer; checksum: string }> = [];
            for (const name of names) {
                if (isTemporaryKnowledgeFile(name)) continue;
                const filePath = path.join(this.knowledgeDir, name);
                if (!(await fs.stat(filePath)).isFile()) continue;
                const buffer = await fs.readFile(filePath);
                if (!buffer.length) continue;
                files.push({ name, path: filePath, buffer, checksum: checksum(buffer) });
            }
            const sourceChecksum = checksum(files.map((file) => `${file.name}\0${file.checksum}`).join('\n'));
            if (sourceChecksum === await this.store.activeSourceChecksum()) {
                await this.store.completeDuplicate(current.id, current.lease_token || '');
                operationalMetrics.knowledge(Number(process.hrtime.bigint() - started) / 1e9, 'duplicate');
                return;
            }
            const versionId = await this.store.beginVersion(current.id, sourceChecksum);
            current.corpus_version_id = versionId;
            const documents: IngestedDocument[] = [];
            const seen = new Set<string>();
            for (const file of files) {
                if (seen.has(file.checksum)) continue;
                seen.add(file.checksum);
                const extracted = await this.extractor(file.path);
                const text = extracted.text.trim();
                if (!text) throw new Error(`${file.name}: tidak menghasilkan teks.`);
                documents.push({ fileName: file.name, mediaType: extracted.mediaType, checksum: file.checksum, byteSize: file.buffer.length, text, metadata: extracted.metadata, chunks: chunkKnowledgeText(text) });
            }
            await this.store.activate(current.id, current.lease_token || '', versionId, documents);
            await this.options.onActivated?.();
            operationalMetrics.knowledge(Number(process.hrtime.bigint() - started) / 1e9, 'success');
        } catch (error) {
            await this.store.fail(current, error);
            operationalMetrics.knowledge(Number(process.hrtime.bigint() - started) / 1e9, 'error');
        }
    }
}
