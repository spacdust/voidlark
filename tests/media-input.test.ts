import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { WAMessage } from '@whiskeysockets/baileys';

const waMessage = (id: string, message: Record<string, unknown>) => ({
    key: { id, remoteJid: 'buyer@s.whatsapp.net', fromMe: false },
    message,
} as WAMessage);

test('normalizes text, captions, payment proof metadata, and location labels', async () => {
    const { extractInboundInput } = await import('../src/whatsapp/media-input.js');
    const text = await extractInboundInput(waMessage('text-1', { conversation: 'hello' }));
    assert.equal(text.text, 'hello');
    assert.equal(text.kind, 'text');

    const image = await extractInboundInput(waMessage('image-1', {
        imageMessage: { caption: 'bukti transfer order 12', mimetype: 'image/jpeg', fileLength: 20 },
    }));
    assert.equal(image.text, 'bukti transfer order 12');
    assert.equal(image.kind, 'image');
    assert.equal(image.media?.purpose, 'payment_proof');
    assert.equal(image.media?.mimeType, 'image/jpeg');

    const document = await extractInboundInput(waMessage('doc-1', {
        documentMessage: { caption: 'invoice', fileName: '../../invoice.pdf', mimetype: 'application/pdf', fileLength: 20 },
    }));
    assert.equal(document.media?.originalFileName, 'invoice.pdf');
    assert.equal(document.media?.purpose, 'attachment');

    const location = await extractInboundInput(waMessage('loc-1', {
        locationMessage: { degreesLatitude: -6.2, degreesLongitude: 106.8, name: 'Toko', address: 'Jakarta' },
    }));
    assert.equal(location.kind, 'location');
    assert.equal(location.text, 'Lokasi: Toko - Jakarta (-6.2, 106.8)');
    assert.deepEqual(location.location, { latitude: -6.2, longitude: 106.8, label: 'Toko - Jakarta' });
});

test('bounded download rejects MIME and declared or streamed oversize payloads', async () => {
    const { downloadBoundedMedia, PermanentMediaInputError } = await import('../src/whatsapp/media-input.js');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'voidlark-media-security-'));
    try {
        await assert.rejects(() => downloadBoundedMedia({
            kind: 'document', mimeType: 'application/x-msdownload', declaredSize: 1, originalFileName: 'bad.exe', message: {},
        }, async () => Readable.from([Buffer.from('x')]), { rootDirectory: directory, maxBytes: 10 }), PermanentMediaInputError);
        await assert.rejects(() => downloadBoundedMedia({
            kind: 'image', mimeType: 'image/jpeg', declaredSize: 11, originalFileName: null, message: {},
        }, async () => Readable.from([Buffer.alloc(1)]), { rootDirectory: directory, maxBytes: 10 }), /terlalu besar/i);
        await assert.rejects(() => downloadBoundedMedia({
            kind: 'image', mimeType: 'image/jpeg', declaredSize: null, originalFileName: null, message: {},
        }, async () => Readable.from([Buffer.alloc(6), Buffer.alloc(6)]), { rootDirectory: directory, maxBytes: 10 }), /terlalu besar/i);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('download uses a controlled checksum path and voice transcription becomes normalized text', async () => {
    const { materializeInboundMedia } = await import('../src/whatsapp/media-input.js');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'voidlark-media-download-'));
    const bytes = Buffer.from('voice bytes');
    try {
        const result = await materializeInboundMedia(waMessage('voice-1', {
            audioMessage: { mimetype: 'audio/ogg; codecs=opus', fileLength: bytes.length, ptt: true },
        }), {
            rootDirectory: directory,
            download: async () => Readable.from([bytes]),
            transcribe: async (buffer, mimeType) => {
                assert.deepEqual(buffer, bytes);
                assert.match(mimeType, /^audio\/ogg/);
                return 'tolong cek pesanan saya';
            },
        });
        assert.equal(result.text, 'tolong cek pesanan saya');
        assert.equal(result.kind, 'voice');
        assert.equal(result.media?.status, 'transcribed');
        assert.equal(result.media?.checksumSha256, createHash('sha256').update(bytes).digest('hex'));
        assert.ok(result.media?.storagePath.startsWith('voice/'));
        assert.equal(path.isAbsolute(result.media?.storagePath || ''), false);
        assert.deepEqual(await readFile(path.join(directory, result.media!.storagePath!)), bytes);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('media records persist metadata without binary blobs and deduplicate failures', async () => {
    process.env.DB_DRIVER = 'sqlite';
    const directory = await mkdtemp(path.join(os.tmpdir(), 'voidlark-media-store-'));
    const { createSqliteDatabase } = await import('../src/config/db.js');
    const { initSchema } = await import('../src/config/schema.js');
    const { MediaInputStore } = await import('../src/whatsapp/media-input-store.js');
    const database = createSqliteDatabase(path.join(directory, 'test.db'));
    try {
        await initSchema(database);
        const store = new MediaInputStore(database);
        const record = {
            providerMessageId: 'media-1', jid: 'buyer@s.whatsapp.net', kind: 'image' as const,
            mimeType: 'image/jpeg', originalFileName: null, sizeBytes: 10, checksumSha256: 'a'.repeat(64),
            storagePath: 'image/aa/hash.jpg', status: 'downloaded' as const, purpose: 'payment_proof' as const,
            caption: 'bukti transfer', transcription: null, errorCode: null,
        };
        assert.equal((await store.save(record)).inserted, true);
        assert.equal((await store.save(record)).inserted, false);
        const rows = await database.query('SELECT * FROM inbound_media WHERE provider_message_id = $1', ['media-1']);
        assert.equal(rows.rowCount, 1);
        assert.equal(rows.rows[0].storage_path, 'image/aa/hash.jpg');
        assert.equal('data' in rows.rows[0], false);

        assert.equal((await store.recordPermanentFailure('media-1', 'buyer@s.whatsapp.net', 'unsupported', 'UNSUPPORTED_MIME')).inserted, true);
        const failures = await database.query('SELECT * FROM inbound_media_failures WHERE provider_message_id = $1', ['media-1']);
        assert.equal(failures.rowCount, 1);
        assert.equal((await store.recordPermanentFailure('media-1', 'buyer@s.whatsapp.net', 'unsupported', 'UNSUPPORTED_MIME')).inserted, false);
    } finally {
        await database.end();
        await rm(directory, { recursive: true, force: true });
    }
});
