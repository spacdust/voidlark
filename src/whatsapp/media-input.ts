import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { normalizeMessageContent, type WAMessage, type WAMessageContent } from '@whiskeysockets/baileys';

export type InboundKind = 'text' | 'image' | 'document' | 'location' | 'voice';
export type MediaPurpose = 'attachment' | 'payment_proof' | 'voice_note';
export type MediaStatus = 'pending' | 'downloaded' | 'transcribed' | 'failed';

export interface DownloadableInboundMedia {
    kind: 'image' | 'document' | 'voice';
    mimeType: string;
    declaredSize: number | null;
    originalFileName: string | null;
    message: Record<string, unknown>;
}

export interface InboundMediaMetadata {
    kind: DownloadableInboundMedia['kind'];
    purpose: MediaPurpose;
    mimeType: string;
    originalFileName: string | null;
    sizeBytes: number | null;
    checksumSha256: string | null;
    storagePath: string | null;
    status: MediaStatus;
    caption: string | null;
    transcription: string | null;
    errorCode: string | null;
}

export interface NormalizedInboundInput {
    kind: InboundKind;
    text: string;
    media?: InboundMediaMetadata;
    location?: { latitude: number; longitude: number; label: string | null };
}

export class PermanentMediaInputError extends Error {
    constructor(public readonly code: string, message: string) {
        super(message);
        this.name = 'PermanentMediaInputError';
    }
}

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DOCUMENT_MIMES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const AUDIO_MIMES = new Set(['audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/webm']);
const EXTENSIONS: Record<string, string> = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf',
    'audio/ogg': '.ogg', 'audio/opus': '.opus', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a',
    'audio/aac': '.aac', 'audio/wav': '.wav', 'audio/webm': '.webm',
};
const PAYMENT_PROOF = /\b(bukti|transfer|pembayaran|payment|paid|bayar|receipt|struk)\b/i;

const baseMime = (value: string | null | undefined) => String(value || '').split(';')[0].trim().toLowerCase();
const numericSize = (value: unknown): number | null => {
    if (value == null) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};
const safeFileName = (value: string | null | undefined) => {
    if (!value) return null;
    const name = path.basename(value.replace(/\\/g, '/')).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120);
    return name || null;
};
const mediaPurpose = (caption: string | null, kind: DownloadableInboundMedia['kind']): MediaPurpose => {
    if (kind === 'voice') return 'voice_note';
    return caption && PAYMENT_PROOF.test(caption) ? 'payment_proof' : 'attachment';
};

const contentOf = (message: WAMessage): WAMessageContent => normalizeMessageContent(message.message) || {};

export const extractInboundInput = async (message: WAMessage): Promise<NormalizedInboundInput> => {
    const content = contentOf(message);
    const text = content.conversation || content.extendedTextMessage?.text;
    if (text) return { kind: 'text', text };

    if (content.imageMessage) {
        const caption = content.imageMessage.caption?.trim() || null;
        return {
            kind: 'image', text: caption || 'Pelanggan mengirim gambar.',
            media: metadata('image', content.imageMessage as unknown as Record<string, unknown>, caption),
        };
    }
    if (content.documentMessage) {
        const caption = content.documentMessage.caption?.trim() || null;
        return {
            kind: 'document', text: caption || `Pelanggan mengirim dokumen${content.documentMessage.fileName ? `: ${safeFileName(content.documentMessage.fileName)}` : '.'}`,
            media: metadata('document', content.documentMessage as unknown as Record<string, unknown>, caption),
        };
    }
    if (content.audioMessage?.ptt) {
        return { kind: 'voice', text: '', media: metadata('voice', content.audioMessage as unknown as Record<string, unknown>, null) };
    }
    if (content.locationMessage) {
        const latitude = Number(content.locationMessage.degreesLatitude);
        const longitude = Number(content.locationMessage.degreesLongitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            throw new PermanentMediaInputError('INVALID_LOCATION', 'Koordinat lokasi tidak valid.');
        }
        const label = [content.locationMessage.name, content.locationMessage.address].filter(Boolean).join(' - ') || null;
        return { kind: 'location', text: `Lokasi: ${label ? `${label} ` : ''}(${latitude}, ${longitude})`, location: { latitude, longitude, label } };
    }
    throw new PermanentMediaInputError('UNSUPPORTED_MESSAGE', 'Jenis pesan ini belum didukung.');
};

const metadata = (kind: DownloadableInboundMedia['kind'], value: Record<string, unknown>, caption: string | null): InboundMediaMetadata => ({
    kind,
    purpose: mediaPurpose(caption, kind),
    mimeType: baseMime(value.mimetype as string),
    originalFileName: safeFileName(value.fileName as string),
    sizeBytes: numericSize(value.fileLength),
    checksumSha256: null,
    storagePath: null,
    status: 'pending',
    caption,
    transcription: null,
    errorCode: null,
});

const assertAllowed = (media: DownloadableInboundMedia, maxBytes: number) => {
    const allowed = media.kind === 'image' ? IMAGE_MIMES : media.kind === 'document' ? DOCUMENT_MIMES : AUDIO_MIMES;
    if (!media.mimeType || !allowed.has(media.mimeType)) throw new PermanentMediaInputError('UNSUPPORTED_MIME', 'Format media tidak didukung.');
    if (media.declaredSize != null && media.declaredSize > maxBytes) throw new PermanentMediaInputError('MEDIA_TOO_LARGE', 'Ukuran media terlalu besar.');
};

export const downloadBoundedMedia = async (
    media: DownloadableInboundMedia,
    download: (media: DownloadableInboundMedia) => Promise<Readable>,
    options: { rootDirectory: string; maxBytes?: number },
) => {
    const maxBytes = options.maxBytes ?? Number(process.env.INBOUND_MEDIA_MAX_BYTES || 10 * 1024 * 1024);
    assertAllowed(media, maxBytes);
    const root = path.resolve(options.rootDirectory);
    const temporaryDirectory = path.join(root, '.tmp');
    await mkdir(temporaryDirectory, { recursive: true });
    const temporaryPath = path.join(temporaryDirectory, `${Date.now()}-${Math.random().toString(16).slice(2)}.part`);
    let sizeBytes = 0;
    const checksum = createHash('sha256');
    const source = await download(media);
    source.on('data', (chunk: Buffer) => {
        sizeBytes += chunk.length;
        if (sizeBytes > maxBytes) source.destroy(new PermanentMediaInputError('MEDIA_TOO_LARGE', 'Ukuran media terlalu besar.'));
        else checksum.update(chunk);
    });
    try {
        await pipeline(source, createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }));
        const checksumSha256 = checksum.digest('hex');
        const extension = EXTENSIONS[media.mimeType] || '';
        const relativePath = path.posix.join(media.kind, checksumSha256.slice(0, 2), `${checksumSha256}${extension}`);
        const destination = path.resolve(root, ...relativePath.split('/'));
        if (!destination.startsWith(`${root}${path.sep}`)) throw new PermanentMediaInputError('INVALID_MEDIA_PATH', 'Lokasi penyimpanan media tidak valid.');
        await mkdir(path.dirname(destination), { recursive: true });
        try { await rename(temporaryPath, destination); } catch (error: any) {
            if (error?.code !== 'EEXIST') throw error;
            await rm(temporaryPath, { force: true });
        }
        return { sizeBytes, checksumSha256, storagePath: relativePath };
    } catch (error) {
        await rm(temporaryPath, { force: true });
        throw error;
    }
};

export const materializeInboundMedia = async (message: WAMessage, dependencies: {
    rootDirectory: string;
    download: (media: DownloadableInboundMedia) => Promise<Readable>;
    transcribe?: (buffer: Buffer, mimeType: string, fileName: string) => Promise<string>;
    maxBytes?: number;
}): Promise<NormalizedInboundInput> => {
    const input = await extractInboundInput(message);
    if (!input.media) return input;
    const content = contentOf(message);
    const raw = input.kind === 'image' ? content.imageMessage : input.kind === 'document' ? content.documentMessage : content.audioMessage;
    const downloadable: DownloadableInboundMedia = {
        kind: input.media.kind, mimeType: input.media.mimeType, declaredSize: input.media.sizeBytes,
        originalFileName: input.media.originalFileName, message: raw as unknown as Record<string, unknown>,
    };
    const downloaded = await downloadBoundedMedia(downloadable, dependencies.download, {
        rootDirectory: dependencies.rootDirectory, maxBytes: dependencies.maxBytes,
    });
    Object.assign(input.media, downloaded, { status: 'downloaded' as const });
    if (input.kind !== 'voice') return input;
    if (!dependencies.transcribe) throw new PermanentMediaInputError('TRANSCRIPTION_UNAVAILABLE', 'Transkripsi voice note belum tersedia.');
    const absolutePath = path.join(path.resolve(dependencies.rootDirectory), ...downloaded.storagePath.split('/'));
    const transcription = (await dependencies.transcribe(await readFile(absolutePath), input.media.mimeType, path.basename(absolutePath))).trim();
    if (!transcription) throw new PermanentMediaInputError('EMPTY_TRANSCRIPTION', 'Voice note tidak dapat ditranskripsikan.');
    input.text = transcription;
    input.media.transcription = transcription;
    input.media.status = 'transcribed';
    return input;
};

export const permanentMediaCustomerResponse = 'Maaf Kak, media tersebut belum dapat kami proses. Pesan sudah diteruskan ke admin.';
