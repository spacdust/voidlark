import { acquireInstanceLock } from './config/instance-lock.js';
import { connectDB, pool } from './config/db.js';
import { initSchema } from './config/schema.js';
import { startWhatsAppConnection, stopWhatsAppConnection } from './whatsapp/connection.js';
import { initializeKnowledgeBase, stopKnowledgeWorker } from './ai/knowledge.js';
import { startAdminServer, stopAdminServer } from './admin/server.js';
import { assertProductionAdminPassword } from './admin/security.js';
import { appLogger } from './config/logger.js';
import { startDatabaseBackupScheduler, type DatabaseBackupScheduler } from './config/database-backup.js';

let backupScheduler: DatabaseBackupScheduler | null = null;
let releaseInstanceLock: (() => void) | null = null;
let shutdownPromise: Promise<void> | null = null;

const shutdown = (signal: string) => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
        appLogger.info({ component: 'bootstrap', signal }, 'application.stopping');
        await backupScheduler?.stop();
        stopKnowledgeWorker();
        await Promise.allSettled([stopWhatsAppConnection(), stopAdminServer()]);
        await pool.end();
        releaseInstanceLock?.();
    })();
    return shutdownPromise;
};

const init = async () => {
    process.env.NODE_ENV = import.meta.url.includes('/dist/') || import.meta.url.includes('\\dist\\')
        ? 'production'
        : 'development';
    if (process.env.NODE_ENV === 'production') assertProductionAdminPassword(process.env.ADMIN_PASSWORD || '');
    releaseInstanceLock = acquireInstanceLock();
    appLogger.info({ component: 'bootstrap', environment: process.env.NODE_ENV }, 'application.starting');

    // 1. Hubungkan ke Database & buat tabel
    await connectDB();
    await initSchema();
    await initializeKnowledgeBase();
    backupScheduler = startDatabaseBackupScheduler();

    // 2. Mulai WhatsApp Client
    await startAdminServer();
    await startWhatsAppConnection();
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => shutdown(signal).then(() => process.exit(0)).catch((error) => {
        appLogger.error({ component: 'bootstrap', err: error }, 'application.shutdown_failed');
        process.exit(1);
    }));
}

init().catch((error) => {
    appLogger.error({ component: 'bootstrap', err: error }, 'application.start_failed');
    return shutdown('startup-error').finally(() => { process.exitCode = 1; });
});
