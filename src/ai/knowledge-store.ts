import { randomUUID } from 'node:crypto';
import { DB_DRIVER, pool, type Database } from '../config/db.js';
import type { KnowledgeChunk } from './knowledge-chunking.js';
import type { RetrievalChunk } from './knowledge-retrieval.js';

export type KnowledgeJobStatus = 'queued' | 'processing' | 'retry' | 'succeeded' | 'failed';
export interface KnowledgeJob {
    id: number;
    status: KnowledgeJobStatus;
    reason: string;
    attempts: number;
    max_attempts: number;
    lease_token: string | null;
    corpus_version_id: number | null;
    last_error: string | null;
    created_at: string;
    updated_at: string;
}

export interface IngestedDocument {
    fileName: string;
    mediaType: string;
    checksum: string;
    byteSize: number;
    text: string;
    metadata: Record<string, unknown>;
    chunks: KnowledgeChunk[];
}

const job = (row: any): KnowledgeJob | null => row ? {
    ...row,
    id: Number(row.id),
    attempts: Number(row.attempts),
    max_attempts: Number(row.max_attempts),
    corpus_version_id: row.corpus_version_id === null ? null : Number(row.corpus_version_id),
    lease_token: row.lease_token || null,
} : null;

export class KnowledgeStore {
    constructor(private readonly database: Database = pool, private readonly driver = DB_DRIVER, private readonly now = () => new Date()) {}

    async enqueue(reason = 'reload', maxAttempts = 3) {
        const result = await this.database.query(
            'INSERT INTO knowledge_ingestion_jobs (reason, max_attempts) VALUES ($1, $2) RETURNING *',
            [reason, maxAttempts],
        );
        return job(result.rows[0])!;
    }

    async claim(leaseMs = 10 * 60_000): Promise<KnowledgeJob | null> {
        return this.database.transaction(async (transaction) => {
            const now = this.now();
            const candidate = await transaction.query(
                `SELECT * FROM knowledge_ingestion_jobs
                 WHERE status IN ('queued', 'retry', 'processing') AND available_at <= $1
                   AND (status != 'processing' OR lease_until IS NULL OR lease_until <= $1)
                 ORDER BY id LIMIT 1${this.driver === 'postgres' ? ' FOR UPDATE SKIP LOCKED' : ''}`,
                [now.toISOString()],
            );
            if (!candidate.rows[0]) return null;
            const leaseToken = randomUUID();
            const result = await transaction.query(
                `UPDATE knowledge_ingestion_jobs SET status = 'processing', lease_token = $1, lease_until = $2, updated_at = $3
                 WHERE id = $4 RETURNING *`,
                [leaseToken, new Date(now.getTime() + leaseMs).toISOString(), now.toISOString(), candidate.rows[0].id],
            );
            return job(result.rows[0]);
        });
    }

    async beginVersion(jobId: number, sourceChecksum: string) {
        const result = await this.database.query(
            `INSERT INTO knowledge_corpus_versions (status, source_checksum) VALUES ('building', $1) RETURNING id`,
            [sourceChecksum],
        );
        const versionId = Number(result.rows[0].id);
        await this.database.query('UPDATE knowledge_ingestion_jobs SET corpus_version_id = $1 WHERE id = $2', [versionId, jobId]);
        return versionId;
    }

    async activeSourceChecksum() {
        const result = await this.database.query(
            `SELECT version.source_checksum FROM knowledge_active_corpus active
             JOIN knowledge_corpus_versions version ON version.id = active.corpus_version_id WHERE active.singleton_id = 1`,
        );
        return result.rows[0]?.source_checksum as string | undefined;
    }

    async activate(jobId: number, leaseToken: string, versionId: number, documents: IngestedDocument[]) {
        await this.database.transaction(async (transaction) => {
            let chunkCount = 0;
            for (const document of documents) {
                const inserted = await transaction.query(
                    `INSERT INTO knowledge_documents
                     (corpus_version_id, file_name, media_type, checksum, byte_size, content, extracted_chars, metadata)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
                    [versionId, document.fileName, document.mediaType, document.checksum, document.byteSize, document.text, document.text.length, JSON.stringify(document.metadata)],
                );
                const documentId = Number(inserted.rows[0].id);
                for (const chunk of document.chunks) {
                    await transaction.query(
                        `INSERT INTO knowledge_chunks
                         (corpus_version_id, document_id, chunk_index, content, char_start, char_end, token_count, metadata)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                        [versionId, documentId, chunk.index, chunk.content, chunk.charStart, chunk.charEnd, chunk.tokenCount, JSON.stringify(chunk.metadata)],
                    );
                    chunkCount += 1;
                }
            }
            const now = this.now().toISOString();
            await transaction.query("UPDATE knowledge_corpus_versions SET status = 'superseded' WHERE status = 'active' AND id != $1", [versionId]);
            await transaction.query(
                "UPDATE knowledge_corpus_versions SET status = 'active', document_count = $1, chunk_count = $2, activated_at = $3 WHERE id = $4",
                [documents.length, chunkCount, now, versionId],
            );
            await transaction.query(
                `INSERT INTO knowledge_active_corpus (singleton_id, corpus_version_id, updated_at) VALUES (1, $1, $2)
                 ON CONFLICT (singleton_id) DO UPDATE SET corpus_version_id = $3, updated_at = $4`,
                [versionId, now, versionId, now],
            );
            const completed = await transaction.query(
                `UPDATE knowledge_ingestion_jobs SET status = 'succeeded', lease_until = NULL, lease_token = NULL,
                 last_error = NULL, completed_at = $1, updated_at = $2 WHERE id = $3 AND lease_token = $4`,
                [now, now, jobId, leaseToken],
            );
            if (completed.rowCount !== 1) throw new Error('Proses informasi tidak lagi memiliki izin aktif.');
        });
    }

    async completeDuplicate(jobId: number, leaseToken: string) {
        const now = this.now().toISOString();
        await this.database.query(
            `UPDATE knowledge_ingestion_jobs SET status = 'succeeded', lease_until = NULL, lease_token = NULL,
             last_error = NULL, completed_at = $1, updated_at = $2 WHERE id = $3 AND lease_token = $4`,
            [now, now, jobId, leaseToken],
        );
    }

    async fail(current: KnowledgeJob, error: unknown) {
        const attempts = current.attempts + 1;
        const terminal = attempts >= current.max_attempts;
        const now = this.now();
        const message = error instanceof Error ? error.message : String(error);
        const availableAt = new Date(now.getTime() + Math.min(60_000, 1_000 * (2 ** attempts)));
        await this.database.transaction(async (transaction) => {
            if (current.corpus_version_id) {
                await transaction.query(
                    "UPDATE knowledge_corpus_versions SET status = 'failed', error_message = $1 WHERE id = $2 AND status = 'building'",
                    [message.slice(0, 2_000), current.corpus_version_id],
                );
            }
            await transaction.query(
                `UPDATE knowledge_ingestion_jobs SET status = $1, attempts = $2, available_at = $3, lease_until = NULL,
                 lease_token = NULL, last_error = $4, updated_at = $5 WHERE id = $6`,
                [terminal ? 'failed' : 'retry', attempts, availableAt.toISOString(), message.slice(0, 2_000), now.toISOString(), current.id],
            );
        });
    }

    async retry(id: number) {
        const result = await this.database.query(
            `UPDATE knowledge_ingestion_jobs SET status = 'queued', attempts = 0, available_at = $1, lease_until = NULL,
             lease_token = NULL, last_error = NULL, updated_at = $2 WHERE id = $3 AND status IN ('retry', 'failed')`,
            [this.now().toISOString(), this.now().toISOString(), id],
        );
        return result.rowCount === 1;
    }

    async listJobs(limit = 20) {
        const result = await this.database.query('SELECT * FROM knowledge_ingestion_jobs ORDER BY id DESC LIMIT $1', [limit]);
        return result.rows.map(job) as KnowledgeJob[];
    }

    async getActiveChunks(): Promise<RetrievalChunk[]> {
        const result = await this.database.query(
            `SELECT chunk.id, chunk.document_id, document.file_name, chunk.chunk_index, chunk.content
             FROM knowledge_active_corpus active
             JOIN knowledge_chunks chunk ON chunk.corpus_version_id = active.corpus_version_id
             JOIN knowledge_documents document ON document.id = chunk.document_id
             WHERE active.singleton_id = 1 ORDER BY document.file_name, chunk.chunk_index`,
        );
        return result.rows.map((row) => ({ id: Number(row.id), documentId: Number(row.document_id), fileName: row.file_name, chunkIndex: Number(row.chunk_index), content: row.content }));
    }

    async getActiveKnowledgeBase() {
        const result = await this.database.query(
            `SELECT document.file_name, document.content FROM knowledge_active_corpus active
             JOIN knowledge_documents document ON document.corpus_version_id = active.corpus_version_id
             WHERE active.singleton_id = 1 ORDER BY document.file_name`,
        );
        return result.rows.map((row) => `--- Referensi dari ${row.file_name} ---\n${row.content}`).join('\n\n');
    }
}

export const knowledgeStore = new KnowledgeStore();
