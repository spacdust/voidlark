export class AiQueueLimiter {
    private maxConcurrency: number;
    private activeCount = 0;
    private queue: Array<() => void> = [];

    constructor(maxConcurrency = 3) {
        this.maxConcurrency = Math.max(1, maxConcurrency);
    }

    public setMaxConcurrency(limit: number) {
        this.maxConcurrency = Math.max(1, limit);
    }

    public getMaxConcurrency(): number {
        return this.maxConcurrency;
    }

    public getActiveCount(): number {
        return this.activeCount;
    }

    public getQueueLength(): number {
        return this.queue.length;
    }

    public async run<T>(fn: () => Promise<T>): Promise<T> {
        if (this.activeCount >= this.maxConcurrency) {
            await new Promise<void>((resolve) => this.queue.push(resolve));
        }

        this.activeCount++;
        try {
            return await fn();
        } finally {
            this.activeCount--;
            if (this.queue.length > 0) {
                const next = this.queue.shift();
                if (next) next();
            }
        }
    }
}

export const globalAiQueueLimiter = new AiQueueLimiter(3);
