import { pool, type Database } from '../config/db.js';
import type { InboundMediaMetadata } from './media-input.js';

export interface PersistedMediaInput extends InboundMediaMetadata {
    providerMessageId: string;
    jid: string;
}

export class MediaInputStore {
    constructor(private readonly database: Database = pool) {}

    async save(input: PersistedMediaInput): Promise<{ inserted: boolean }> {
        const result = await this.database.query(
            `INSERT INTO inbound_media (provider_message_id, jid, media_kind, purpose, mime_type, original_file_name,
             size_bytes, checksum_sha256, storage_path, status, caption, transcription, error_code)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             ON CONFLICT (provider_message_id) DO NOTHING RETURNING id`,
            [input.providerMessageId, input.jid, input.kind, input.purpose, input.mimeType, input.originalFileName,
                input.sizeBytes, input.checksumSha256, input.storagePath, input.status, input.caption, input.transcription, input.errorCode],
        );
        return { inserted: result.rowCount === 1 };
    }

    async recordPermanentFailure(providerMessageId: string, jid: string, customerResponse: string, errorCode: string): Promise<{ inserted: boolean }> {
        const result = await this.database.query(
            `INSERT INTO inbound_media_failures (provider_message_id, jid, error_code, customer_response)
             VALUES ($1, $2, $3, $4) ON CONFLICT (provider_message_id) DO NOTHING RETURNING id`,
            [providerMessageId, jid, errorCode, customerResponse],
        );
        return { inserted: result.rowCount === 1 };
    }
}

export const mediaInputStore = new MediaInputStore();
