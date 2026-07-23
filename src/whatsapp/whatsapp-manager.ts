import fs from 'fs';
import path from 'path';

export type RotationMode = 'round_robin' | 'least_busy' | 'random';
export type NumberStatus = 'online' | 'connecting' | 'resting' | 'disconnected';

export interface WhatsAppNumberSession {
    id: string; // E.g. 'CS Line 1'
    csNameOverride?: string;
    phone: string;
    status: NumberStatus;
    dailyLimit: number;
    todayLeadCount: number;
    todayMessageCount: number;
    counterDate?: string;
}

export interface WhatsAppManagerConfig {
    rotationMode: RotationMode;
    minDelaySeconds: number;
    maxDelaySeconds: number;
    maxConcurrency: number;
    enableStickyAssignment: boolean;
}

export const DEFAULT_WA_MANAGER_CONFIG: WhatsAppManagerConfig = {
    rotationMode: 'round_robin',
    minDelaySeconds: 3,
    maxDelaySeconds: 5,
    maxConcurrency: 3,
    enableStickyAssignment: true,
};

const STORAGE_PATH = path.resolve('config', 'whatsapp-sessions.json');

export class WhatsAppManager {
    private sessions: Map<string, WhatsAppNumberSession> = new Map();
    private stickyAssignments: Map<string, string> = new Map(); // customerJid -> sessionPhone
    private roundRobinIndex = 0;
    private config: WhatsAppManagerConfig;
    private isInitialized = false;
    private storagePath: string | null = STORAGE_PATH;
    private readonly today: () => string;

    constructor(config: Partial<WhatsAppManagerConfig> = {}, storagePath: string | null = STORAGE_PATH, today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())) {
        this.config = { ...DEFAULT_WA_MANAGER_CONFIG, ...config };
        this.storagePath = storagePath;
        this.today = today;
        if (this.storagePath) {
            this.loadFromDisk();
        }
    }

    public loadFromDisk() {
        if (!this.storagePath) return;
        try {
            if (fs.existsSync(this.storagePath)) {
                const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf-8'));
                if (data.config) this.config = { ...DEFAULT_WA_MANAGER_CONFIG, ...data.config };
                if (Array.isArray(data.sessions)) {
                    this.sessions.clear();
                    for (const s of data.sessions) {
                        this.sessions.set(s.phone, s);
                    }
                }
                if (data.stickyAssignments && typeof data.stickyAssignments === 'object') {
                    this.stickyAssignments = new Map(Object.entries(data.stickyAssignments));
                }
                this.isInitialized = true;
            }
        } catch {
            // Ignore load errors and fall back to in-memory defaults
        }
    }

    public saveToDisk(): boolean {
        if (!this.storagePath) return true;
        try {
            const dir = path.dirname(this.storagePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const payload = {
                config: this.config,
                sessions: this.getSessions(),
                stickyAssignments: Object.fromEntries(this.stickyAssignments),
            };
            fs.writeFileSync(this.storagePath, JSON.stringify(payload, null, 2), 'utf-8');
            this.isInitialized = true;
            return true;
        } catch {
            return false;
        }
    }

    public isPersistedInitialized(): boolean {
        return this.isInitialized;
    }

    public updateConfig(newConfig: Partial<WhatsAppManagerConfig>) {
        this.config = { ...this.config, ...newConfig };
        this.saveToDisk();
    }

    public getConfig(): WhatsAppManagerConfig {
        return { ...this.config };
    }

    public registerSession(session: WhatsAppNumberSession) {
        this.sessions.set(session.phone, { ...session, counterDate: session.counterDate || this.today() });
        this.saveToDisk();
    }

    public updateSession(phone: string, updates: Partial<WhatsAppNumberSession>): boolean {
        const session = this.sessions.get(phone);
        if (!session) return false;
        Object.assign(session, updates);
        this.saveToDisk();
        return true;
    }

    public removeSession(phone: string): boolean {
        const session = this.sessions.get(phone);
        if (!session) return false;
        this.sessions.delete(phone);
        if (!this.saveToDisk()) {
            this.sessions.set(phone, session);
            return false;
        }
        for (const [customerJid, assignedPhone] of this.stickyAssignments) {
            if (assignedPhone === phone) this.stickyAssignments.delete(customerJid);
        }
        return true;
    }

    public getSessions(): WhatsAppNumberSession[] {
        this.resetDailyCounters();
        return Array.from(this.sessions.values());
    }

    public getSession(phone: string): WhatsAppNumberSession | undefined {
        return this.sessions.get(phone);
    }

    public getEffectiveCsName(phone: string, defaultName: string): string {
        return this.sessions.get(phone)?.csNameOverride?.trim() || defaultName;
    }

    public setSessionStatus(phone: string, status: NumberStatus) {
        const session = this.sessions.get(phone);
        if (session) {
            session.status = status;
            this.saveToDisk();
        }
    }

    public recordMessageSent(phone: string) {
        this.resetDailyCounters();
        const session = this.sessions.get(phone);
        if (session) {
            session.todayMessageCount++;
            this.saveToDisk();
        }
    }

    // Assigns an active WhatsApp number session for an incoming customer (JID)
    public assignNumberForLead(customerJid: string): WhatsAppNumberSession | null {
        this.resetDailyCounters();
        // 1. Sticky Session Check: Existing customer gets their previously assigned number
        if (this.config.enableStickyAssignment && this.stickyAssignments.has(customerJid)) {
            const assignedPhone = this.stickyAssignments.get(customerJid)!;
            const session = this.sessions.get(assignedPhone);
            if (session && session.status === 'online') {
                return session;
            }
        }

        // 2. Filter available numbers for NEW leads (Online, not reached daily limit)
        const availableSessions = this.getSessions().filter(
            (s) => s.status === 'online' && (s.dailyLimit <= 0 || s.todayLeadCount < s.dailyLimit)
        );

        if (availableSessions.length === 0) return null;

        let selected: WhatsAppNumberSession;

        if (this.config.rotationMode === 'random') {
            const randomIndex = Math.floor(Math.random() * availableSessions.length);
            selected = availableSessions[randomIndex];
        } else if (this.config.rotationMode === 'least_busy') {
            selected = [...availableSessions].sort((a, b) => a.todayLeadCount - b.todayLeadCount)[0];
        } else {
            // Default Round Robin
            const index = this.roundRobinIndex % availableSessions.length;
            selected = availableSessions[index];
            this.roundRobinIndex = (index + 1) % availableSessions.length;
        }

        selected.todayLeadCount++;
        if (this.config.enableStickyAssignment) {
            this.stickyAssignments.set(customerJid, selected.phone);
        }

        return selected;
    }

    public getStickyAssignment(customerJid: string): string | undefined {
        return this.stickyAssignments.get(customerJid);
    }

    public setStickyAssignment(customerJid: string, phone: string) {
        if (this.sessions.has(phone) && this.stickyAssignments.get(customerJid) !== phone) {
            this.stickyAssignments.set(customerJid, phone);
            this.saveToDisk();
        }
    }

    private resetDailyCounters() {
        const date = this.today();
        let changed = false;
        for (const session of this.sessions.values()) {
            if (session.counterDate === date) continue;
            session.todayLeadCount = 0;
            session.todayMessageCount = 0;
            session.counterDate = date;
            changed = true;
        }
        if (changed) this.saveToDisk();
    }
}

export const globalWhatsAppManager = new WhatsAppManager();
