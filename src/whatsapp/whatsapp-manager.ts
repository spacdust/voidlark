import fs from 'fs';
import path from 'path';

export type RotationMode = 'round_robin' | 'least_busy' | 'random';
export type NumberStatus = 'online' | 'connecting' | 'resting' | 'disconnected';

export interface WhatsAppNumberSession {
    id: string; // E.g. 'CS Line 1'
    phone: string;
    status: NumberStatus;
    dailyLimit: number;
    todayLeadCount: number;
    todayMessageCount: number;
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

    constructor(config: Partial<WhatsAppManagerConfig> = {}, storagePath: string | null = STORAGE_PATH) {
        this.config = { ...DEFAULT_WA_MANAGER_CONFIG, ...config };
        this.storagePath = storagePath;
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
                this.isInitialized = true;
            }
        } catch {
            // Ignore load errors and fall back to in-memory defaults
        }
    }

    public saveToDisk() {
        if (!this.storagePath) return;
        try {
            const dir = path.dirname(this.storagePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const payload = {
                config: this.config,
                sessions: this.getSessions(),
            };
            fs.writeFileSync(this.storagePath, JSON.stringify(payload, null, 2), 'utf-8');
            this.isInitialized = true;
        } catch {
            // Ignore write errors
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
        this.sessions.set(session.phone, session);
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
        const deleted = this.sessions.delete(phone);
        if (deleted) this.saveToDisk();
        return deleted;
    }

    public getSessions(): WhatsAppNumberSession[] {
        return Array.from(this.sessions.values());
    }

    public getSession(phone: string): WhatsAppNumberSession | undefined {
        return this.sessions.get(phone);
    }

    public setSessionStatus(phone: string, status: NumberStatus) {
        const session = this.sessions.get(phone);
        if (session) {
            session.status = status;
        }
    }

    public recordMessageSent(phone: string) {
        const session = this.sessions.get(phone);
        if (session) {
            session.todayMessageCount++;
        }
    }

    // Assigns an active WhatsApp number session for an incoming customer (JID)
    public assignNumberForLead(customerJid: string): WhatsAppNumberSession | null {
        // 1. Sticky Session Check: Existing customer gets their previously assigned number
        if (this.config.enableStickyAssignment && this.stickyAssignments.has(customerJid)) {
            const assignedPhone = this.stickyAssignments.get(customerJid)!;
            const session = this.sessions.get(assignedPhone);
            // Return sticky session if active (even if resting daily limit, sticky customer stays!)
            if (session && session.status !== 'disconnected') {
                return session;
            }
        }

        // 2. Filter available numbers for NEW leads (Online, not reached daily limit)
        const availableSessions = this.getSessions().filter(
            (s) => s.status === 'online' && (s.dailyLimit <= 0 || s.todayLeadCount < s.dailyLimit)
        );

        if (availableSessions.length === 0) {
            // Fallback to any online session if all limits hit
            const anyOnline = this.getSessions().filter((s) => s.status === 'online');
            if (anyOnline.length === 0) return null;
            const fallback = anyOnline[0];
            if (this.config.enableStickyAssignment) this.stickyAssignments.set(customerJid, fallback.phone);
            return fallback;
        }

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
}

export const globalWhatsAppManager = new WhatsAppManager();
