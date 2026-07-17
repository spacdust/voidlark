export type TransientRetryOptions = {
    maxAttempts?: number;
    delayMs?: number;
    sleep?: (ms: number) => Promise<void>;
    isTransient: (error: unknown) => boolean;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const withTransientRetry = async <T>(operation: () => Promise<T>, options: TransientRetryOptions): Promise<T> => {
    const maxAttempts = Math.max(1, options.maxAttempts ?? 2);
    const delayMs = Math.max(0, options.delayMs ?? 0);
    const sleep = options.sleep || wait;
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            if (attempt >= maxAttempts || !options.isTransient(error)) throw error;
            await sleep(delayMs);
        }
    }
};
