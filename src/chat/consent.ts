import { DB_DRIVER, pool, type Database } from '../config/db.js';
import { getBusinessConfig, type ConsentConfig } from '../config/business.js';

export type CommunicationCategory = 'transactional' | 'marketing' | 'proactive';
export type ConsentCommand = 'opt_out' | 'opt_in' | null;
const normalize = (text: string) => text.trim().toLocaleUpperCase('id-ID').replace(/[.!?]+$/g, '').trim();

export const detectConsentCommand = (text: string, config: ConsentConfig = getBusinessConfig().consent): ConsentCommand => {
    const value = normalize(text);
    if (config.optOutKeywords.some((keyword) => normalize(keyword) === value)) return 'opt_out';
    if (config.optInKeywords.some((keyword) => normalize(keyword) === value)) return 'opt_in';
    return null;
};

export class ConsentService {
    constructor(
        private readonly database: Database = pool,
        private readonly now: () => Date = () => new Date(),
        private readonly driver: 'sqlite' | 'postgres' = DB_DRIVER === 'postgres' ? 'postgres' : 'sqlite',
    ) {}
    async set(jid: string, optedIn: boolean, source = 'inbound_keyword') {
        const at = this.now().toISOString();
        await this.database.query(
            `INSERT INTO communication_preferences (jid, marketing_opt_in, consented_at, opted_out_at, source, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (jid) DO UPDATE SET marketing_opt_in = excluded.marketing_opt_in, consented_at = excluded.consented_at,
             opted_out_at = excluded.opted_out_at, source = excluded.source, updated_at = excluded.updated_at`,
            [jid, this.driver === 'postgres' ? optedIn : Number(optedIn), optedIn ? at : null, optedIn ? null : at, source, at],
        );
    }
    async canSend(jid: string, category: CommunicationCategory) {
        if (category === 'transactional') return true;
        const { rows } = await this.database.query('SELECT marketing_opt_in FROM communication_preferences WHERE jid = $1', [jid]);
        return !rows[0] || Boolean(rows[0].marketing_opt_in);
    }
}

export const consentService = new ConsentService();
export const canSendCommunication = (jid: string, category: CommunicationCategory) => consentService.canSend(jid, category);
