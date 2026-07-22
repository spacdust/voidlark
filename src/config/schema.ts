import { createHash } from 'node:crypto';
import { DB_DRIVER, pool, type Database } from './db.js';

const addColumnIfMissing = async (database: Database, table: string, column: string, definition: string) => {
    if (DB_DRIVER === 'postgres') {
        await database.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
        return;
    }

    const { rows } = await database.query(`PRAGMA table_info(${table})`);
    if (!rows.some((row) => row.name === column)) {
        await database.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
};

const initSqliteSchema = async (database: Database) => {
    await database.query(`
        CREATE TABLE IF NOT EXISTS auth_keys (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chat_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            jid TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
            content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_chat_history_jid ON chat_history(jid);
        CREATE INDEX IF NOT EXISTS idx_chat_history_jid_created ON chat_history(jid, created_at DESC);

        CREATE TABLE IF NOT EXISTS leads (
            jid TEXT PRIMARY KEY,
            name TEXT,
            phone TEXT,
            address TEXT,
            preferences TEXT,
            status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'interested', 'checkout', 'paid', 'shipped', 'completed', 'lost')),
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS handoff_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            jid TEXT NOT NULL,
            reason TEXT NOT NULL,
            resolved INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS chat_state (
            jid TEXT PRIMARY KEY,
            stage TEXT NOT NULL DEFAULT 'consulting',
            data TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            jid TEXT NOT NULL,
            aroma TEXT,
            variant TEXT,
            quality TEXT,
            size_ml INTEGER,
            quantity INTEGER NOT NULL DEFAULT 1,
            product_price INTEGER,
            customer_name TEXT,
            phone TEXT,
            address TEXT,
            shipping_option TEXT,
            shipping_cost INTEGER,
            status TEXT NOT NULL DEFAULT 'draft',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            product_name TEXT,
            package_size TEXT,
            options TEXT NOT NULL DEFAULT '{}',
            customer_data TEXT NOT NULL DEFAULT '{}'
        );

        CREATE INDEX IF NOT EXISTS idx_orders_jid_status ON orders(jid, status);

        CREATE TABLE IF NOT EXISTS lookup_cache (
            query_hash TEXT PRIMARY KEY,
            query_text TEXT NOT NULL,
            result TEXT NOT NULL,
            provider TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS inbound_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider_message_id TEXT NOT NULL UNIQUE,
            jid TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'retry', 'completed', 'dead_letter')),
            attempts INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 5,
            available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            lease_until TEXT,
            lease_token TEXT,
            last_error TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            completed_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_inbound_messages_claim ON inbound_messages(status, available_at, lease_until, id);

        CREATE TABLE IF NOT EXISTS outbound_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dedupe_key TEXT UNIQUE,
            provider_message_id TEXT UNIQUE,
            jid TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'dead_letter')),
            attempts INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 5,
            available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            lease_until TEXT,
            lease_token TEXT,
            last_error TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            sent_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_outbound_messages_claim ON outbound_messages(status, available_at, lease_until, id);
    `);
    await addColumnIfMissing(database, 'orders', 'product_name', 'TEXT');
    await addColumnIfMissing(database, 'orders', 'package_size', 'TEXT');
    await addColumnIfMissing(database, 'orders', 'options', "TEXT NOT NULL DEFAULT '{}'");
    await addColumnIfMissing(database, 'orders', 'customer_data', "TEXT NOT NULL DEFAULT '{}'");
};

const initPostgresSchema = async (database: Database) => {
    await database.query(`
        CREATE TABLE IF NOT EXISTS auth_keys (
            id VARCHAR(255) PRIMARY KEY,
            data JSONB NOT NULL
        );

        CREATE TABLE IF NOT EXISTS chat_history (
            id SERIAL PRIMARY KEY,
            jid VARCHAR(100) NOT NULL,
            role VARCHAR(10) NOT NULL CHECK (role IN ('user', 'assistant')),
            content TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_chat_history_jid ON chat_history(jid);
        CREATE INDEX IF NOT EXISTS idx_chat_history_jid_created ON chat_history(jid, created_at DESC);

        CREATE TABLE IF NOT EXISTS leads (
            jid VARCHAR(100) PRIMARY KEY,
            name VARCHAR(255),
            phone VARCHAR(50),
            address TEXT,
            preferences TEXT,
            status VARCHAR(30) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'interested', 'checkout', 'paid', 'shipped', 'completed', 'lost')),
            notes TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS handoff_log (
            id SERIAL PRIMARY KEY,
            jid VARCHAR(100) NOT NULL,
            reason TEXT NOT NULL,
            resolved BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS chat_state (
            jid VARCHAR(100) PRIMARY KEY,
            stage VARCHAR(40) NOT NULL DEFAULT 'consulting',
            data JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            jid VARCHAR(100) NOT NULL,
            aroma VARCHAR(255),
            variant VARCHAR(30),
            quality VARCHAR(50),
            size_ml INTEGER,
            quantity INTEGER NOT NULL DEFAULT 1,
            product_price INTEGER,
            customer_name VARCHAR(255),
            phone VARCHAR(50),
            address TEXT,
            shipping_option TEXT,
            shipping_cost INTEGER,
            status VARCHAR(30) NOT NULL DEFAULT 'draft',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_orders_jid_status ON orders(jid, status);

        CREATE TABLE IF NOT EXISTS lookup_cache (
            query_hash VARCHAR(64) PRIMARY KEY,
            query_text TEXT NOT NULL,
            result TEXT NOT NULL,
            provider VARCHAR(40) NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS inbound_messages (
            id BIGSERIAL PRIMARY KEY,
            provider_message_id VARCHAR(255) NOT NULL UNIQUE,
            jid VARCHAR(100) NOT NULL,
            payload TEXT NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'retry', 'completed', 'dead_letter')),
            attempts INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 5,
            available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            lease_until TIMESTAMPTZ,
            lease_token VARCHAR(64),
            last_error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at TIMESTAMPTZ
        );

        CREATE INDEX IF NOT EXISTS idx_inbound_messages_claim ON inbound_messages(status, available_at, lease_until, id);

        CREATE TABLE IF NOT EXISTS outbound_messages (
            id BIGSERIAL PRIMARY KEY,
            dedupe_key VARCHAR(255) UNIQUE,
            provider_message_id VARCHAR(255) UNIQUE,
            jid VARCHAR(100) NOT NULL,
            payload TEXT NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'dead_letter')),
            attempts INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 5,
            available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            lease_until TIMESTAMPTZ,
            lease_token VARCHAR(64),
            last_error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            sent_at TIMESTAMPTZ
        );

        CREATE INDEX IF NOT EXISTS idx_outbound_messages_claim ON outbound_messages(status, available_at, lease_until, id);
    `);

    await addColumnIfMissing(database, 'orders', 'product_name', 'VARCHAR(255)');
    await addColumnIfMissing(database, 'orders', 'package_size', 'VARCHAR(50)');
    await addColumnIfMissing(database, 'orders', 'options', "JSONB NOT NULL DEFAULT '{}'::jsonb");
    await addColumnIfMissing(database, 'orders', 'customer_data', "JSONB NOT NULL DEFAULT '{}'::jsonb");
};

type Migration = {
    version: number;
    name: string;
    source: string;
    apply: (database: Database) => Promise<void>;
};

const lifecycleSqlite = `
    CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        aggregate_type TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        actor TEXT NOT NULL DEFAULT 'system',
        data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_audit_events_aggregate ON audit_events(aggregate_type, aggregate_id, id);
    CREATE TRIGGER IF NOT EXISTS audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;

    CREATE TABLE IF NOT EXISTS payment_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_event_id TEXT NOT NULL UNIQUE,
        order_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(order_id) REFERENCES orders(id)
    );
    CREATE INDEX IF NOT EXISTS idx_payment_events_order ON payment_events(order_id, id);
    CREATE TRIGGER IF NOT EXISTS payment_events_no_update BEFORE UPDATE ON payment_events BEGIN SELECT RAISE(ABORT, 'payment_events is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS payment_events_no_delete BEFORE DELETE ON payment_events BEGIN SELECT RAISE(ABORT, 'payment_events is append-only'); END;

    CREATE TABLE IF NOT EXISTS outbound_intents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dedupe_key TEXT NOT NULL UNIQUE,
        jid TEXT NOT NULL,
        intent_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
`;

const lifecyclePostgres = `
    CREATE TABLE IF NOT EXISTS audit_events (
        id BIGSERIAL PRIMARY KEY,
        event_type VARCHAR(80) NOT NULL,
        aggregate_type VARCHAR(80) NOT NULL,
        aggregate_id VARCHAR(255) NOT NULL,
        actor VARCHAR(100) NOT NULL DEFAULT 'system',
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_audit_events_aggregate ON audit_events(aggregate_type, aggregate_id, id);
    CREATE OR REPLACE FUNCTION reject_append_only_mutation() RETURNS trigger AS $$
    BEGIN
        RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
    END;
    $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS audit_events_no_mutation ON audit_events;
    CREATE TRIGGER audit_events_no_mutation BEFORE UPDATE OR DELETE ON audit_events
        FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
    CREATE TABLE IF NOT EXISTS payment_events (
        id BIGSERIAL PRIMARY KEY,
        provider_event_id VARCHAR(255) NOT NULL UNIQUE,
        order_id INTEGER NOT NULL REFERENCES orders(id),
        event_type VARCHAR(80) NOT NULL,
        status VARCHAR(40) NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_payment_events_order ON payment_events(order_id, id);
    DROP TRIGGER IF EXISTS payment_events_no_mutation ON payment_events;
    CREATE TRIGGER payment_events_no_mutation BEFORE UPDATE OR DELETE ON payment_events
        FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
    CREATE TABLE IF NOT EXISTS outbound_intents (
        id BIGSERIAL PRIMARY KEY,
        dedupe_key VARCHAR(255) NOT NULL UNIQUE,
        jid VARCHAR(100) NOT NULL,
        intent_type VARCHAR(80) NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
`;

const backupRunsSqlite = `
    CREATE TABLE IF NOT EXISTS backup_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        driver TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
        backup_path TEXT,
        checksum_sha256 TEXT,
        size_bytes INTEGER,
        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        error_message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_backup_runs_started ON backup_runs(started_at DESC, id DESC);
`;

const backupRunsPostgres = `
    CREATE TABLE IF NOT EXISTS backup_runs (
        id BIGSERIAL PRIMARY KEY,
        driver VARCHAR(20) NOT NULL,
        trigger_type VARCHAR(30) NOT NULL,
        status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
        backup_path TEXT,
        checksum_sha256 VARCHAR(64),
        size_bytes BIGINT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        error_message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_backup_runs_started ON backup_runs(started_at DESC, id DESC);
`;

const mediaInputSqlite = `
    CREATE TABLE IF NOT EXISTS inbound_media (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_message_id TEXT NOT NULL UNIQUE,
        jid TEXT NOT NULL,
        media_kind TEXT NOT NULL CHECK (media_kind IN ('image', 'document', 'voice')),
        purpose TEXT NOT NULL CHECK (purpose IN ('attachment', 'payment_proof', 'voice_note')),
        mime_type TEXT NOT NULL,
        original_file_name TEXT,
        size_bytes INTEGER,
        checksum_sha256 TEXT,
        storage_path TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'downloaded', 'transcribed', 'failed')),
        caption TEXT,
        transcription TEXT,
        error_code TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_inbound_media_jid_created ON inbound_media(jid, created_at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS inbound_media_failures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_message_id TEXT NOT NULL UNIQUE,
        jid TEXT NOT NULL,
        error_code TEXT NOT NULL,
        customer_response TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
`;

const mediaInputPostgres = `
    CREATE TABLE IF NOT EXISTS inbound_media (
        id BIGSERIAL PRIMARY KEY,
        provider_message_id VARCHAR(255) NOT NULL UNIQUE,
        jid VARCHAR(100) NOT NULL,
        media_kind VARCHAR(20) NOT NULL CHECK (media_kind IN ('image', 'document', 'voice')),
        purpose VARCHAR(30) NOT NULL CHECK (purpose IN ('attachment', 'payment_proof', 'voice_note')),
        mime_type VARCHAR(120) NOT NULL,
        original_file_name VARCHAR(255),
        size_bytes BIGINT,
        checksum_sha256 VARCHAR(64),
        storage_path TEXT,
        status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'downloaded', 'transcribed', 'failed')),
        caption TEXT,
        transcription TEXT,
        error_code VARCHAR(80),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_inbound_media_jid_created ON inbound_media(jid, created_at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS inbound_media_failures (
        id BIGSERIAL PRIMARY KEY,
        provider_message_id VARCHAR(255) NOT NULL UNIQUE,
        jid VARCHAR(100) NOT NULL,
        error_code VARCHAR(80) NOT NULL,
        customer_response TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
`;

const packageDSqlite = `
    CREATE TABLE IF NOT EXISTS communication_preferences (
        jid TEXT PRIMARY KEY,
        marketing_opt_in INTEGER NOT NULL DEFAULT 1,
        consented_at TEXT,
        opted_out_at TEXT,
        source TEXT NOT NULL DEFAULT 'inbound_keyword',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
`;

const packageDPostgres = `
    CREATE TABLE IF NOT EXISTS communication_preferences (
        jid VARCHAR(100) PRIMARY KEY,
        marketing_opt_in BOOLEAN NOT NULL DEFAULT TRUE,
        consented_at TIMESTAMPTZ,
        opted_out_at TIMESTAMPTZ,
        source VARCHAR(80) NOT NULL DEFAULT 'inbound_keyword',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
`;

const applyPackageD = async (database: Database) => {
    await database.query(DB_DRIVER === 'postgres' ? packageDPostgres : packageDSqlite);
    await addColumnIfMissing(database, 'handoff_log', 'status', "TEXT NOT NULL DEFAULT 'waiting'");
    await addColumnIfMissing(database, 'handoff_log', 'priority', "TEXT NOT NULL DEFAULT 'normal'");
    await addColumnIfMissing(database, 'handoff_log', 'assigned_operator', 'TEXT');
    await addColumnIfMissing(database, 'handoff_log', 'accepted_at', DB_DRIVER === 'postgres' ? 'TIMESTAMPTZ' : 'TEXT');
    await addColumnIfMissing(database, 'handoff_log', 'first_response_at', DB_DRIVER === 'postgres' ? 'TIMESTAMPTZ' : 'TEXT');
    await addColumnIfMissing(database, 'handoff_log', 'resolved_at', DB_DRIVER === 'postgres' ? 'TIMESTAMPTZ' : 'TEXT');
    await addColumnIfMissing(database, 'handoff_log', 'resolution_note', 'TEXT');
    await addColumnIfMissing(database, 'handoff_log', 'sla_due_at', DB_DRIVER === 'postgres' ? 'TIMESTAMPTZ' : 'TEXT');
    await addColumnIfMissing(database, 'handoff_log', 'updated_at', DB_DRIVER === 'postgres' ? 'TIMESTAMPTZ' : 'TEXT');
    await database.query('UPDATE handoff_log SET updated_at = created_at WHERE updated_at IS NULL');
    await database.query('CREATE INDEX IF NOT EXISTS idx_handoff_operational ON handoff_log(resolved, status, priority, sla_due_at, created_at)');
};

const packageEKnowledgeSqlite = `
    CREATE TABLE IF NOT EXISTS knowledge_corpus_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT NOT NULL CHECK (status IN ('building', 'active', 'failed', 'superseded')),
        source_checksum TEXT NOT NULL,
        document_count INTEGER NOT NULL DEFAULT 0,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        activated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS knowledge_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        corpus_version_id INTEGER NOT NULL REFERENCES knowledge_corpus_versions(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        media_type TEXT NOT NULL,
        checksum TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        content TEXT NOT NULL,
        extracted_chars INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}',
        UNIQUE(corpus_version_id, checksum)
    );
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        corpus_version_id INTEGER NOT NULL REFERENCES knowledge_corpus_versions(id) ON DELETE CASCADE,
        document_id INTEGER NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        char_start INTEGER NOT NULL,
        char_end INTEGER NOT NULL,
        token_count INTEGER NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        UNIQUE(document_id, chunk_index)
    );
    CREATE TABLE IF NOT EXISTS knowledge_ingestion_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'retry', 'succeeded', 'failed')),
        reason TEXT NOT NULL DEFAULT 'reload',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        lease_until TEXT,
        lease_token TEXT,
        corpus_version_id INTEGER REFERENCES knowledge_corpus_versions(id),
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS knowledge_active_corpus (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        corpus_version_id INTEGER NOT NULL REFERENCES knowledge_corpus_versions(id),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_claim ON knowledge_ingestion_jobs(status, available_at, lease_until, id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_corpus ON knowledge_chunks(corpus_version_id, document_id, chunk_index);
`;

const packageEKnowledgePostgres = `
    CREATE TABLE IF NOT EXISTS knowledge_corpus_versions (
        id BIGSERIAL PRIMARY KEY,
        status VARCHAR(20) NOT NULL CHECK (status IN ('building', 'active', 'failed', 'superseded')),
        source_checksum VARCHAR(64) NOT NULL,
        document_count INTEGER NOT NULL DEFAULT 0,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        activated_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS knowledge_documents (
        id BIGSERIAL PRIMARY KEY,
        corpus_version_id BIGINT NOT NULL REFERENCES knowledge_corpus_versions(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        media_type TEXT NOT NULL,
        checksum VARCHAR(64) NOT NULL,
        byte_size BIGINT NOT NULL,
        content TEXT NOT NULL,
        extracted_chars INTEGER NOT NULL DEFAULT 0,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        UNIQUE(corpus_version_id, checksum)
    );
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id BIGSERIAL PRIMARY KEY,
        corpus_version_id BIGINT NOT NULL REFERENCES knowledge_corpus_versions(id) ON DELETE CASCADE,
        document_id BIGINT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        char_start INTEGER NOT NULL,
        char_end INTEGER NOT NULL,
        token_count INTEGER NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        UNIQUE(document_id, chunk_index)
    );
    CREATE TABLE IF NOT EXISTS knowledge_ingestion_jobs (
        id BIGSERIAL PRIMARY KEY,
        status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'retry', 'succeeded', 'failed')),
        reason TEXT NOT NULL DEFAULT 'reload',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        lease_until TIMESTAMPTZ,
        lease_token VARCHAR(64),
        corpus_version_id BIGINT REFERENCES knowledge_corpus_versions(id),
        last_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS knowledge_active_corpus (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        corpus_version_id BIGINT NOT NULL REFERENCES knowledge_corpus_versions(id),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_claim ON knowledge_ingestion_jobs(status, available_at, lease_until, id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_corpus ON knowledge_chunks(corpus_version_id, document_id, chunk_index);
`;

const applyActiveHandoffInvariant = async (database: Database) => {
    const resolvedValue = DB_DRIVER === 'postgres' ? 'TRUE' : '1';
    await database.query(`UPDATE handoff_log SET resolved = ${resolvedValue}, status = 'resolved', resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
        WHERE id IN (
            SELECT id FROM (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY jid ORDER BY id DESC) AS active_rank
                FROM handoff_log WHERE ${DB_DRIVER === 'postgres' ? 'resolved = FALSE' : 'resolved = 0'}
            ) ranked WHERE active_rank > 1
        )`);
    await database.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_handoff_log_active_jid ON handoff_log(jid) WHERE ${DB_DRIVER === 'postgres' ? 'resolved = FALSE' : 'resolved = 0'}`);
};

const applyOutboundPostSendActions = async (database: Database) => {
    await addColumnIfMissing(database, 'outbound_messages', 'post_send_action', DB_DRIVER === 'postgres' ? 'JSONB' : 'TEXT');
    await addColumnIfMissing(database, 'outbound_messages', 'post_send_status', 'TEXT');
    await database.query('CREATE INDEX IF NOT EXISTS idx_outbound_post_send ON outbound_messages(post_send_status, sent_at, id)');
};

const migrations: Migration[] = [
    {
        version: 1,
        name: 'baseline_schema',
        source: 'baseline-schema-v1-auth-chat-leads-handoff-orders-cache-message-pipelines',
        apply: async (database) => DB_DRIVER === 'postgres' ? initPostgresSchema(database) : initSqliteSchema(database),
    },
    {
        version: 2,
        name: 'order_payment_lifecycle',
        source: DB_DRIVER === 'postgres' ? lifecyclePostgres : lifecycleSqlite,
        apply: async (database) => database.query(DB_DRIVER === 'postgres' ? lifecyclePostgres : lifecycleSqlite).then(() => undefined),
    },
    {
        version: 3,
        name: 'database_backup_audit',
        source: DB_DRIVER === 'postgres' ? backupRunsPostgres : backupRunsSqlite,
        apply: async (database) => database.query(DB_DRIVER === 'postgres' ? backupRunsPostgres : backupRunsSqlite).then(() => undefined),
    },
    {
        version: 4,
        name: 'media_input_foundation',
        source: DB_DRIVER === 'postgres' ? mediaInputPostgres : mediaInputSqlite,
        apply: async (database) => database.query(DB_DRIVER === 'postgres' ? mediaInputPostgres : mediaInputSqlite).then(() => undefined),
    },
    {
        version: 5,
        name: 'package_d_handoff_hours_consent',
        source: `${packageDSqlite}\n---postgres---\n${packageDPostgres}\n---handoff-columns-v1---`,
        apply: applyPackageD,
    },
    {
        version: 6,
        name: 'package_e_knowledge_corpus',
        source: `${packageEKnowledgeSqlite}\n---postgres---\n${packageEKnowledgePostgres}`,
        apply: async (database) => database.query(DB_DRIVER === 'postgres' ? packageEKnowledgePostgres : packageEKnowledgeSqlite).then(() => undefined),
    },
    {
        version: 7,
        name: 'active_handoff_invariant',
        source: 'deduplicate-active-handoffs-v1-and-partial-unique-index-on-jid',
        apply: applyActiveHandoffInvariant,
    },
    {
        version: 8,
        name: 'outbound_post_send_actions',
        source: 'outbound-post-send-action-and-status-v1',
        apply: applyOutboundPostSendActions,
    },
];

const checksum = (migration: Migration) => createHash('sha256')
    .update(`${migration.version}\n${migration.name}\n${migration.source}`)
    .digest('hex');

export const getMigrationChecksums = () => migrations.map((migration) => ({
    version: migration.version,
    name: migration.name,
    checksum: checksum(migration),
}));

export const initSchema = async (database: Database = pool) => {
    await database.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at ${DB_DRIVER === 'postgres' ? 'TIMESTAMPTZ' : 'TEXT'} NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

    for (const migration of migrations) {
        const expected = checksum(migration);
        const applied = await database.query('SELECT name, checksum FROM schema_migrations WHERE version = $1', [migration.version]);
        if (applied.rows[0]) {
            if (applied.rows[0].name !== migration.name || applied.rows[0].checksum !== expected) {
                throw new Error(`Migration ${migration.version} checksum mismatch; database=${applied.rows[0].checksum}, code=${expected}`);
            }
            continue;
        }

        await database.transaction(async (transaction) => {
            await migration.apply(transaction);
            await transaction.query(
                'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
                [migration.version, migration.name, expected],
            );
        });
    }
    // Backfill phone numbers for existing leads if empty
    await database.query(`
        UPDATE leads 
        SET phone = REPLACE(jid, '@s.whatsapp.net', '') 
        WHERE jid LIKE '%@s.whatsapp.net' 
          AND (phone IS NULL OR phone = '')
    `);
    // Clear invalid phone numbers derived from lid JIDs
    await database.query(`
        UPDATE leads 
        SET phone = NULL 
        WHERE jid LIKE '%@lid'
    `);
    console.log('✅ Schema database siap.');
};
