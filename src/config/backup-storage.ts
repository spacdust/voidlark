// ============================================================================
// Off-host Backup Storage (Fase 9: Automated Backup & Recovery)
// ============================================================================

import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { appLogger } from './logger.js';
import path from 'node:path';

export interface BackupStorageConfig {
    provider: 'local' | 's3' | 'gcs' | 'azure';
    localPath?: string;
    s3Bucket?: string;
    s3Region?: string;
    s3AccessKeyId?: string;
    s3SecretAccessKey?: string;
    encryptionKey?: string;
}

export interface BackupMetadata {
    filename: string;
    size: number;
    checksum: string;
    encrypted: boolean;
    uploadedAt: string;
    expiresAt?: string;
}

/**
 * Abstract backup storage interface
 */
export interface BackupStorage {
    upload(localPath: string, remoteName: string, encrypt?: boolean): Promise<BackupMetadata>;
    download(remoteName: string, localPath: string, decrypt?: boolean): Promise<void>;
    list(): Promise<BackupMetadata[]>;
    delete(remoteName: string): Promise<void>;
}

/**
 * Local file system backup storage (for testing or same-host scenarios)
 */
export class LocalBackupStorage implements BackupStorage {
    private directory: string;
    private encryptionKey?: Buffer;

    constructor(directory: string, encryptionKey?: string) {
        this.directory = directory;
        if (encryptionKey) {
            this.encryptionKey = Buffer.from(encryptionKey, 'hex');
        }
    }

    async upload(localPath: string, remoteName: string, encrypt = false): Promise<BackupMetadata> {
        const remotePath = path.join(this.directory, remoteName);
        const stats = await stat(localPath);
        
        let checksum: string;
        
        if (encrypt && this.encryptionKey) {
            // Encrypt and upload
            const iv = randomBytes(16);
            const cipher = createCipheriv('aes-256-cbc', this.encryptionKey, iv);
            
            const input = createReadStream(localPath);
            const output = createWriteStream(remotePath);
            const hash = createHash('sha256');
            
            // Write IV first
            output.write(iv);
            
            await pipeline(
                input,
                cipher,
                (chunk) => {
                    hash.update(chunk);
                    return chunk;
                },
                output
            );
            
            checksum = hash.digest('hex');
        } else {
            // Direct copy
            const input = createReadStream(localPath);
            const output = createWriteStream(remotePath);
            const hash = createHash('sha256');
            
            await pipeline(
                input,
                (chunk) => {
                    hash.update(chunk);
                    return chunk;
                },
                output
            );
            
            checksum = hash.digest('hex');
        }

        appLogger.info(
            { component: 'backup-storage', remoteName, size: stats.size, encrypted: encrypt },
            'backup.uploaded'
        );

        return {
            filename: remoteName,
            size: stats.size,
            checksum,
            encrypted: encrypt,
            uploadedAt: new Date().toISOString(),
        };
    }

    async download(remoteName: string, localPath: string, decrypt = false): Promise<void> {
        const remotePath = path.join(this.directory, remoteName);
        
        if (decrypt && this.encryptionKey) {
            // Read IV and decrypt
            const input = createReadStream(remotePath);
            const output = createWriteStream(localPath);
            
            // Read first 16 bytes as IV
            const ivBuffer = await new Promise<Buffer>((resolve, reject) => {
                const chunks: Buffer[] = [];
                let totalLength = 0;
                
                input.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                    totalLength += chunk.length;
                    
                    if (totalLength >= 16) {
                        input.pause();
                        const combined = Buffer.concat(chunks);
                        const iv = combined.subarray(0, 16);
                        const remaining = combined.subarray(16);
                        
                        // Create decipher
                        const decipher = createDecipheriv('aes-256-cbc', this.encryptionKey!, iv);
                        
                        // Write remaining data through decipher
                        if (remaining.length > 0) {
                            output.write(decipher.update(remaining));
                        }
                        
                        input.on('data', (chunk: Buffer) => {
                            output.write(decipher.update(chunk));
                        });
                        
                        input.on('end', () => {
                            output.write(decipher.final());
                            output.end();
                        });
                        
                        input.resume();
                        resolve(iv);
                    }
                });
                
                input.on('error', reject);
            });
        } else {
            // Direct copy
            const input = createReadStream(remotePath);
            const output = createWriteStream(localPath);
            await pipeline(input, output);
        }

        appLogger.info(
            { component: 'backup-storage', remoteName, decrypted: decrypt },
            'backup.downloaded'
        );
    }

    async list(): Promise<BackupMetadata[]> {
        // Placeholder: would scan directory and return metadata
        return [];
    }

    async delete(remoteName: string): Promise<void> {
        const remotePath = path.join(this.directory, remoteName);
        await unlink(remotePath);
        appLogger.info({ component: 'backup-storage', remoteName }, 'backup.deleted');
    }
}

/**
 * S3-compatible backup storage (AWS S3, MinIO, DigitalOcean Spaces, etc.)
 */
export class S3BackupStorage implements BackupStorage {
    private bucket: string;
    private region: string;
    private accessKeyId: string;
    private secretAccessKey: string;
    private encryptionKey?: Buffer;

    constructor(config: BackupStorageConfig) {
        if (!config.s3Bucket || !config.s3Region || !config.s3AccessKeyId || !config.s3SecretAccessKey) {
            throw new Error('S3 configuration incomplete');
        }
        this.bucket = config.s3Bucket;
        this.region = config.s3Region;
        this.accessKeyId = config.s3AccessKeyId;
        this.secretAccessKey = config.s3SecretAccessKey;
        if (config.encryptionKey) {
            this.encryptionKey = Buffer.from(config.encryptionKey, 'hex');
        }
    }

    async upload(localPath: string, remoteName: string, encrypt = false): Promise<BackupMetadata> {
        // Placeholder: would use AWS SDK or MinIO client
        // For now, just log the intent
        appLogger.warn(
            { component: 'backup-storage', provider: 's3', remoteName },
            'backup.s3_not_implemented'
        );
        
        const stats = await stat(localPath);
        return {
            filename: remoteName,
            size: stats.size,
            checksum: 'placeholder',
            encrypted: encrypt,
            uploadedAt: new Date().toISOString(),
        };
    }

    async download(remoteName: string, localPath: string, decrypt = false): Promise<void> {
        appLogger.warn(
            { component: 'backup-storage', provider: 's3', remoteName },
            'backup.s3_not_implemented'
        );
    }

    async list(): Promise<BackupMetadata[]> {
        return [];
    }

    async delete(remoteName: string): Promise<void> {
        appLogger.warn(
            { component: 'backup-storage', provider: 's3', remoteName },
            'backup.s3_not_implemented'
        );
    }
}

/**
 * Factory function to create backup storage
 */
export const createBackupStorage = (config: BackupStorageConfig): BackupStorage => {
    switch (config.provider) {
        case 'local':
            return new LocalBackupStorage(
                config.localPath || './backups',
                config.encryptionKey
            );
        case 's3':
            return new S3BackupStorage(config);
        default:
            throw new Error(`Unsupported backup storage provider: ${config.provider}`);
    }
};

/**
 * Get backup storage from environment
 */
export const getBackupStorage = (): BackupStorage => {
    const provider = (process.env.BACKUP_PROVIDER || 'local') as BackupStorageConfig['provider'];
    
    const config: BackupStorageConfig = {
        provider,
        localPath: process.env.BACKUP_LOCAL_PATH || './backups',
        s3Bucket: process.env.BACKUP_S3_BUCKET,
        s3Region: process.env.BACKUP_S3_REGION,
        s3AccessKeyId: process.env.BACKUP_S3_ACCESS_KEY_ID,
        s3SecretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY,
        encryptionKey: process.env.BACKUP_ENCRYPTION_KEY,
    };
    
    return createBackupStorage(config);
};
