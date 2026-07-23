export type QueueTask<T> = () => Promise<T>;

/** Serializes sends per WhatsApp number while allowing different numbers independently. */
export class PerNumberQueue {
    private readonly tails = new Map<string, Promise<void>>();
    private readonly depths = new Map<string, number>();
    private readonly lastStarted = new Map<string, number>();

    enqueue<T>(sessionId: string, delayMs: number, task: QueueTask<T>): Promise<T> {
        const previous = this.tails.get(sessionId) || Promise.resolve();
        this.depths.set(sessionId, (this.depths.get(sessionId) || 0) + 1);
        const run = previous.then(async () => {
            const waitMs = Math.max(0, (this.lastStarted.get(sessionId) || 0) + delayMs - Date.now());
            if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
            this.lastStarted.set(sessionId, Date.now());
            return task();
        });
        const tail = run.then(() => undefined, () => undefined).finally(() => {
            const depth = (this.depths.get(sessionId) || 1) - 1;
            if (depth <= 0) {
                this.depths.delete(sessionId);
                this.tails.delete(sessionId);
            } else this.depths.set(sessionId, depth);
        });
        this.tails.set(sessionId, tail);
        return run;
    }

    depth(sessionId: string) { return this.depths.get(sessionId) || 0; }
}
