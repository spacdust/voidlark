import 'dotenv/config';
import { connectDB, DB_DRIVER, pool } from './db.js';
import { initSchema } from './schema.js';
import { createDatabaseBackup, runRestoreDrill, type BackupDriver } from './database-backup.js';

const main = async () => {
    const command = process.argv[2] || 'create';
    const driver = (DB_DRIVER === 'postgres' ? 'postgres' : 'sqlite') as BackupDriver;
    await connectDB();
    await initSchema();
    if (command === 'create') {
        console.log(JSON.stringify(await createDatabaseBackup({ driver }), null, 2));
    } else if (command === 'drill') {
        const backupPath = process.argv[3];
        if (!backupPath) throw new Error('Usage: npm run db:backup:drill -- <backup-file>');
        console.log(JSON.stringify(await runRestoreDrill(backupPath, { driver }), null, 2));
    } else {
        throw new Error(`Perintah backup tidak dikenal: ${command}`);
    }
};

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}).finally(() => pool.end());
