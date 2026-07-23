import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LocalBackupStorage, S3BackupStorage } from '../src/config/backup-storage.js';

test('local backup lists files and rejects traversal', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'voidlark-backup-'));
    try {
        const source = path.join(root, 'source.db');
        await writeFile(source, 'backup-data');
        const storage = new LocalBackupStorage(path.join(root, 'backups'));
        const metadata = await storage.upload(source, 'daily.db');
        assert.equal(metadata.filename, 'daily.db');
        assert.equal((await storage.list()).length, 1);
        await assert.rejects(storage.upload(source, '../escape.db'), /Invalid backup name/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('unsupported S3 provider fails closed', async () => {
    const storage = new S3BackupStorage({ provider: 's3', s3Bucket: 'bucket', s3Region: 'region', s3AccessKeyId: 'key', s3SecretAccessKey: 'secret' });
    await assert.rejects(storage.list(), /not implemented/);
});
