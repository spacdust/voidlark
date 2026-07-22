// ============================================================================
// WhatsApp Session Backup (Fase 9: Automated Backup & Recovery)
// ============================================================================

import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import path from 'node:path';
import { appLogger } from '../config/logger.js';
import { getBackupStorage } from '../config/backup-storage.js';

export interface SessionBackupResult {
    sessionId: string;
    files: string[];
    totalSize: number;
    checksum: string;
    encrypted: boolean;
    timestamp: string;
}

/**
 * Backup WhatsApp session directory
 * WARNING: Session contains authentication credentials
 */
export const backupWhatsAppSession = async (
    sessionDir: string,
    options: {
        encrypt?: boolean;
        encryptionKey?: string;
        outputDir?: string;
    } = {}
): Promise<SessionBackupResult> => {
    const { encrypt = true, encryptionKey, outputDir = './backups' } = options;
    
    if (!encryptionKey && encrypt) {
        throw new Error('Encryption key required for session backup');
    }

    // List session files
    const files = await readdir(sessionDir);
    const sessionFiles = files.filter(
        (file) => file.endsWith('.json') || file === 'creds.json'
    );

    if (sessionFiles.length === 0) {
        throw new Error('No session files found');
    }

    // Create backup bundle
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sessionId = path.basename(sessionDir);
    const backupName = `wa-session-${sessionId}-${timestamp}.json`;
    
    const bundle: Record<string, string> = {};
    let totalSize = 0;

    for (const file of sessionFiles) {
        const filePath = path.join(sessionDir, file);
        const content = await readFile(filePath, 'utf-8');
        const fileStats = await stat(filePath);
        
        bundle[file] = content;
        totalSize += fileStats.size;
    }

    const bundleJson = JSON.stringify(bundle, null, 2);
    const checksum = createHash('sha256').update(bundleJson).digest('hex');

    // Encrypt if requested
    let finalContent: Buffer;
    if (encrypt && encryptionKey) {
        const key = Buffer.from(encryptionKey, 'hex');
        const iv = randomBytes(16);
        const cipher = createCipheriv('aes-256-cbc', key, iv);
        
        const encrypted = Buffer.concat([
            iv,
            cipher.update(bundleJson, 'utf-8'),
            cipher.final(),
        ]);
        
        finalContent = encrypted;
    } else {
        finalContent = Buffer.from(bundleJson, 'utf-8');
    }

    // Save to backup directory
    await mkdir(outputDir, { recursive: true });
    const backupPath = path.join(outputDir, backupName);
    await writeFile(backupPath, finalContent);

    // Upload to off-host storage if configured
    try {
        const storage = getBackupStorage();
        await storage.upload(backupPath, backupName, encrypt);
    } catch (error) {
        appLogger.warn(
            { component: 'session-backup', error: error instanceof Error ? error.message : String(error) },
            'session_backup.offhost_failed'
        );
    }

    appLogger.info(
        { component: 'session-backup', sessionId, filesCount: sessionFiles.length, totalSize, encrypted: encrypt },
        'session_backup.completed'
    );

    return {
        sessionId,
        files: sessionFiles,
        totalSize,
        checksum,
        encrypted: encrypt,
        timestamp,
    };
};

/**
 * Restore WhatsApp session from backup
 */
export const restoreWhatsAppSession = async (
    backupPath: string,
    sessionDir: string,
    options: {
        decrypt?: boolean;
        decryptionKey?: string;
    } = {}
): Promise<void> => {
    const { decrypt = true, decryptionKey } = options;

    if (decrypt && !decryptionKey) {
        throw new Error('Decryption key required for session restore');
    }

    // Read backup file
    const backupData = await readFile(backupPath);
    
    let bundleJson: string;
    if (decrypt && decryptionKey) {
        const key = Buffer.from(decryptionKey, 'hex');
        const iv = backupData.subarray(0, 16);
        const encrypted = backupData.subarray(16);
        
        const decipher = createDecipheriv('aes-256-cbc', key, iv);
        bundleJson = Buffer.concat([
            decipher.update(encrypted),
            decipher.final(),
        ]).toString('utf-8');
    } else {
        bundleJson = backupData.toString('utf-8');
    }

    const bundle: Record<string, string> = JSON.parse(bundleJson);

    // Restore files
    await mkdir(sessionDir, { recursive: true });
    
    for (const [filename, content] of Object.entries(bundle)) {
        const filePath = path.join(sessionDir, filename);
        await writeFile(filePath, content, 'utf-8');
    }

    appLogger.info(
        { component: 'session-backup', sessionDir, filesRestored: Object.keys(bundle).length },
        'session_backup.restored'
    );
};

/**
 * Verify session backup integrity
 */
export const verifySessionBackup = async (
    backupPath: string,
    options: {
        decrypt?: boolean;
        decryptionKey?: string;
        expectedChecksum?: string;
    } = {}
): Promise<boolean> => {
    try {
        const { decrypt = true, decryptionKey, expectedChecksum } = options;

        const backupData = await readFile(backupPath);
        
        let bundleJson: string;
        if (decrypt && decryptionKey) {
            const key = Buffer.from(decryptionKey, 'hex');
            const iv = backupData.subarray(0, 16);
            const encrypted = backupData.subarray(16);
            
            const decipher = createDecipheriv('aes-256-cbc', key, iv);
            bundleJson = Buffer.concat([
                decipher.update(encrypted),
                decipher.final(),
            ]).toString('utf-8');
        } else {
            bundleJson = backupData.toString('utf-8');
        }

        // Verify JSON structure
        const bundle = JSON.parse(bundleJson);
        
        if (typeof bundle !== 'object' || bundle === null) {
            return false;
        }

        // Verify checksum if provided
        if (expectedChecksum) {
            const actualChecksum = createHash('sha256').update(bundleJson).digest('hex');
            if (actualChecksum !== expectedChecksum) {
                appLogger.warn(
                    { component: 'session-backup', expectedChecksum, actualChecksum },
                    'session_backup.checksum_mismatch'
                );
                return false;
            }
        }

        return true;
    } catch (error) {
        appLogger.error(
            { component: 'session-backup', error: error instanceof Error ? error.message : String(error) },
            'session_backup.verification_failed'
        );
        return false;
    }
};
