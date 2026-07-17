import type { WAMessage } from '@whiskeysockets/baileys';
import { messageStore, type MessageStore, type StoredMessage } from './message-store.js';
import type { CommunicationCategory } from '../chat/consent.js';
import { operationalMetrics } from '../operations/metrics.js';

export interface InboundEnvelope { message: WAMessage; receivedAt: string }
export type InboundHandler = (message: WAMessage) => Promise<void>;
export type OutboundHandler = (jid: string, payload: unknown) => Promise<string | null>;

export class PermanentInboundError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PermanentInboundError';
    }
}

interface WorkerOptions {
    store?: MessageStore;
    pollIntervalMs?: number;
    activePollMs?: number;
    postSendHandler?: (action: unknown) => Promise<void>;
    postSendPollMs?: number;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class DurableInboundWorker {
    private running = false;
    private active = 0;
    private stopped = false;
    private pollTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly activeJids = new Set<string>();
    private readonly store: MessageStore;
    private readonly pollIntervalMs: number;
    private readonly activePollMs: number;

    constructor(
        private readonly handler: InboundHandler,
        private readonly concurrency = Math.max(1, Number(process.env.INBOUND_CONCURRENCY || 3)),
        options: WorkerOptions = {},
    ) {
        this.store = options.store || messageStore;
        this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
        this.activePollMs = options.activePollMs ?? 80;
    }

    async enqueue(messages: WAMessage[]) {
        for (const message of messages) {
            const providerId = message.key.id;
            const jid = message.key.remoteJid;
            if (!providerId || !jid || !message.message || message.key.fromMe) continue;
            await this.store.enqueueInbound(providerId, jid, { message, receivedAt: new Date().toISOString() } satisfies InboundEnvelope);
        }
        this.wake();
    }

    wake() {
        if (this.running || this.stopped) return;
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this.pollTimer = null;
        this.running = true;
        void this.loop().finally(() => {
            this.running = false;
            if (!this.stopped) this.pollTimer = setTimeout(() => this.wake(), this.pollIntervalMs);
        });
    }

    stop() {
        this.stopped = true;
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this.pollTimer = null;
    }

    private async loop() {
        while (!this.stopped) {
            while (this.active < this.concurrency) {
                const stored = await this.store.claimInbound(2 * 60_000, [...this.activeJids]);
                if (!stored) break;
                this.active += 1;
                this.activeJids.add(stored.jid);
                void this.process(stored);
            }
            if (!this.active) return;
            await wait(this.activePollMs);
        }
    }

    private async process(stored: StoredMessage) {
        const started = process.hrtime.bigint();
        let failed = false;
        try {
            await this.handler((stored.payload as InboundEnvelope).message);
            await this.store.completeInbound(stored.id, stored.lease_token || undefined);
        } catch (error) {
            failed = true;
            const terminal = error instanceof PermanentInboundError;
            if (terminal) await this.store.deadLetterInbound(stored.id, error, stored.lease_token || undefined);
            else await this.store.failInbound(stored.id, error, stored.lease_token || undefined);
            operationalMetrics.queue('inbound', Number(process.hrtime.bigint() - started) / 1e9, true, terminal);
        } finally {
            if (!failed) operationalMetrics.queue('inbound', Number(process.hrtime.bigint() - started) / 1e9);
            this.active -= 1;
            this.activeJids.delete(stored.jid);
        }
    }
}

export class DurableOutboundWorker {
    private running = false;
    private stopped = false;
    private pollTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly store: MessageStore;
    private readonly pollIntervalMs: number;
    private readonly postSendHandler?: (action: unknown) => Promise<void>;
    private readonly postSendPollMs: number;

    constructor(private readonly handler: OutboundHandler, options: WorkerOptions = {}) {
        this.store = options.store || messageStore;
        this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
        this.postSendHandler = options.postSendHandler;
        this.postSendPollMs = options.postSendPollMs ?? 1_000;
    }

    async enqueue(jid: string, payload: unknown, dedupeKey?: string, category: CommunicationCategory = 'transactional', postSendAction?: unknown) {
        const result = await this.store.enqueueOutbound(jid, payload, { dedupeKey, category, postSendAction });
        this.wake();
        return result.message;
    }

    wake() {
        if (this.running || this.stopped) return;
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this.pollTimer = null;
        this.running = true;
        void this.loop().finally(() => {
            this.running = false;
            if (!this.stopped) this.pollTimer = setTimeout(() => this.wake(), this.pollIntervalMs);
        });
    }

    stop() {
        this.stopped = true;
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this.pollTimer = null;
    }

    private async loop() {
        while (!this.stopped) {
            const action = this.postSendHandler ? await this.store.claimPostSendAction() : null;
            if (action) {
                try {
                    await this.postSendHandler!(action.action);
                    await this.store.completePostSendAction(action.outboundMessageId);
                } catch (error) {
                    await this.store.retryPostSendAction(action.outboundMessageId, error);
                    await new Promise((resolve) => setTimeout(resolve, this.postSendPollMs));
                    return;
                }
                continue;
            }
            const stored = await this.store.claimOutbound(60_000);
            if (!stored) return;
            const started = process.hrtime.bigint();
            let processingFailed = false;
            try {
                const providerId = await this.handler(stored.jid, stored.payload);
                await this.store.markOutboundSent(stored.id, providerId || '', stored.lease_token || undefined);
            } catch (error) {
                processingFailed = true;
                const failed = await this.store.failOutbound(stored.id, error, stored.lease_token || undefined);
                operationalMetrics.queue('outbound', Number(process.hrtime.bigint() - started) / 1e9, true, failed?.status === 'dead_letter');
            } finally {
                if (!processingFailed) operationalMetrics.queue('outbound', Number(process.hrtime.bigint() - started) / 1e9);
            }
        }
    }
}
