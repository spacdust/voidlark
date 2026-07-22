// ============================================================================
// Circuit Breaker for AI Provider (Fase 8: AI Safety)
// ============================================================================

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
    failureThreshold: number;      // Number of failures before opening
    successThreshold: number;       // Number of successes in HALF_OPEN before closing
    timeout: number;                // Time in ms before attempting HALF_OPEN
    monitoringWindow: number;       // Time window in ms for counting failures
}

export interface CircuitBreakerStats {
    state: CircuitState;
    failures: number;
    successes: number;
    lastFailureTime: number | null;
    lastStateChange: number;
    totalRequests: number;
    totalFailures: number;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60_000,         // 1 minute
    monitoringWindow: 120_000, // 2 minutes
};

export class CircuitBreaker {
    private state: CircuitState = 'CLOSED';
    private failures: number = 0;
    private successes: number = 0;
    private lastFailureTime: number | null = null;
    private lastStateChange: number = Date.now();
    private recentFailures: number[] = []; // Timestamps of recent failures
    private totalRequests: number = 0;
    private totalFailures: number = 0;
    
    constructor(
        private readonly name: string,
        private readonly config: CircuitBreakerConfig = DEFAULT_CONFIG
    ) {}

    /**
     * Execute a function with circuit breaker protection
     */
    async execute<T>(fn: () => Promise<T>): Promise<T> {
        this.totalRequests++;
        
        // Check if circuit is OPEN
        if (this.state === 'OPEN') {
            if (this.shouldAttemptReset()) {
                console.log(`[CircuitBreaker:${this.name}] Entering HALF_OPEN state`);
                this.state = 'HALF_OPEN';
                this.successes = 0;
                this.lastStateChange = Date.now();
            } else {
                throw new Error(`Circuit breaker is OPEN for "${this.name}". Service unavailable.`);
            }
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    private onSuccess(): void {
        this.failures = 0;
        
        if (this.state === 'HALF_OPEN') {
            this.successes++;
            
            if (this.successes >= this.config.successThreshold) {
                console.log(`[CircuitBreaker:${this.name}] Closing circuit after ${this.successes} successes`);
                this.state = 'CLOSED';
                this.successes = 0;
                this.lastStateChange = Date.now();
            }
        }
    }

    private onFailure(): void {
        this.totalFailures++;
        this.failures++;
        this.lastFailureTime = Date.now();
        this.recentFailures.push(Date.now());
        
        // Clean old failures outside monitoring window
        this.cleanOldFailures();
        
        if (this.state === 'HALF_OPEN') {
            console.log(`[CircuitBreaker:${this.name}] Failure in HALF_OPEN, reopening circuit`);
            this.state = 'OPEN';
            this.failures = 0;
            this.successes = 0;
            this.lastStateChange = Date.now();
            return;
        }
        
        if (this.state === 'CLOSED' && this.recentFailures.length >= this.config.failureThreshold) {
            console.log(`[CircuitBreaker:${this.name}] Opening circuit after ${this.recentFailures.length} failures`);
            this.state = 'OPEN';
            this.failures = 0;
            this.lastStateChange = Date.now();
        }
    }

    private shouldAttemptReset(): boolean {
        if (!this.lastFailureTime) return false;
        return Date.now() - this.lastFailureTime >= this.config.timeout;
    }

    private cleanOldFailures(): void {
        const cutoff = Date.now() - this.config.monitoringWindow;
        this.recentFailures = this.recentFailures.filter(ts => ts >= cutoff);
    }

    /**
     * Get current circuit breaker statistics
     */
    getStats(): CircuitBreakerStats {
        this.cleanOldFailures();
        
        return {
            state: this.state,
            failures: this.failures,
            successes: this.successes,
            lastFailureTime: this.lastFailureTime,
            lastStateChange: this.lastStateChange,
            totalRequests: this.totalRequests,
            totalFailures: this.totalFailures,
        };
    }

    /**
     * Manually reset the circuit breaker to CLOSED state
     */
    reset(): void {
        console.log(`[CircuitBreaker:${this.name}] Manual reset to CLOSED`);
        this.state = 'CLOSED';
        this.failures = 0;
        this.successes = 0;
        this.recentFailures = [];
        this.lastStateChange = Date.now();
    }

    /**
     * Check if the circuit is currently allowing requests
     */
    isAvailable(): boolean {
        if (this.state === 'CLOSED' || this.state === 'HALF_OPEN') {
            return true;
        }
        return this.shouldAttemptReset();
    }
}

// ============================================================================
// Global Circuit Breaker Registry
// ============================================================================

const CIRCUIT_BREAKERS = new Map<string, CircuitBreaker>();

export const getCircuitBreaker = (name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker => {
    if (!CIRCUIT_BREAKERS.has(name)) {
        CIRCUIT_BREAKERS.set(name, new CircuitBreaker(name, { ...DEFAULT_CONFIG, ...config }));
    }
    return CIRCUIT_BREAKERS.get(name)!;
};

export const getAllCircuitBreakers = (): Record<string, CircuitBreakerStats> => {
    const stats: Record<string, CircuitBreakerStats> = {};
    for (const [name, breaker] of CIRCUIT_BREAKERS.entries()) {
        stats[name] = breaker.getStats();
    }
    return stats;
};
