// ============================================================================
// Token Limiter & Cost Tracker (Fase 8: AI Safety)
// ============================================================================

export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUSD: number;
}

export interface TokenLimits {
    maxPromptTokens: number;
    maxCompletionTokens: number;
    maxTotalTokens: number;
    maxCostPerRequestUSD: number;
    maxCostPerHourUSD: number;
    maxCostPerDayUSD: number;
}

export interface CostStats {
    totalRequests: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    totalCostUSD: number;
    lastHourCostUSD: number;
    lastDayCostUSD: number;
}

const DEFAULT_LIMITS: TokenLimits = {
    maxPromptTokens: 12_000,
    maxCompletionTokens: 2_500,
    maxTotalTokens: 14_000,
    maxCostPerRequestUSD: 0.10,      // $0.10 per request
    maxCostPerHourUSD: 5.00,         // $5/hour
    maxCostPerDayUSD: 50.00,         // $50/day
};

// Model pricing per 1M tokens (adjust based on actual provider)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
    'gemini/gemini-2.5-flash': { input: 0.30, output: 1.20 },          // Gemini 2.5 Flash pricing
    'gemini/gemini-2.0-flash-exp': { input: 0.00, output: 0.00 },      // Free tier
    'gpt-4o': { input: 2.50, output: 10.00 },                          // GPT-4o pricing
    'gpt-4o-mini': { input: 0.15, output: 0.60 },                      // GPT-4o mini
    'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },      // Claude 3.5 Sonnet
    'default': { input: 0.50, output: 2.00 },                          // Conservative default
};

export class TokenLimiter {
    private usage: Array<{ timestamp: number; cost: number; tokens: number }> = [];
    private stats: CostStats = {
        totalRequests: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        totalCostUSD: 0,
        lastHourCostUSD: 0,
        lastDayCostUSD: 0,
    };

    constructor(
        private readonly limits: TokenLimits = DEFAULT_LIMITS
    ) {}

    /**
     * Calculate estimated cost based on model and token usage
     */
    private calculateCost(model: string, promptTokens: number, completionTokens: number): number {
        const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
        const inputCost = (promptTokens / 1_000_000) * pricing.input;
        const outputCost = (completionTokens / 1_000_000) * pricing.output;
        return inputCost + outputCost;
    }

    /**
     * Clean usage entries older than 24 hours
     */
    private cleanOldUsage(): void {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        this.usage = this.usage.filter(entry => entry.timestamp >= cutoff);
    }

    /**
     * Get cost for last N milliseconds
     */
    private getCostForWindow(windowMs: number): number {
        const cutoff = Date.now() - windowMs;
        return this.usage
            .filter(entry => entry.timestamp >= cutoff)
            .reduce((sum, entry) => sum + entry.cost, 0);
    }

    /**
     * Check if request would exceed limits (before making API call)
     */
    checkLimits(estimatedPromptTokens: number, model: string): {
        allowed: boolean;
        reason?: string;
    } {
        this.cleanOldUsage();

        // Check prompt token limit
        if (estimatedPromptTokens > this.limits.maxPromptTokens) {
            return {
                allowed: false,
                reason: `Prompt tokens (${estimatedPromptTokens}) exceed limit (${this.limits.maxPromptTokens})`,
            };
        }

        // Check hourly cost limit
        const lastHourCost = this.getCostForWindow(60 * 60 * 1000);
        if (lastHourCost >= this.limits.maxCostPerHourUSD) {
            return {
                allowed: false,
                reason: `Hourly cost limit ($${this.limits.maxCostPerHourUSD}) exceeded. Current: $${lastHourCost.toFixed(4)}`,
            };
        }

        // Check daily cost limit
        const lastDayCost = this.getCostForWindow(24 * 60 * 60 * 1000);
        if (lastDayCost >= this.limits.maxCostPerDayUSD) {
            return {
                allowed: false,
                reason: `Daily cost limit ($${this.limits.maxCostPerDayUSD}) exceeded. Current: $${lastDayCost.toFixed(4)}`,
            };
        }

        return { allowed: true };
    }

    /**
     * Record actual usage after API call completes
     */
    recordUsage(model: string, promptTokens: number, completionTokens: number): TokenUsage {
        const totalTokens = promptTokens + completionTokens;
        const estimatedCostUSD = this.calculateCost(model, promptTokens, completionTokens);

        // Record to history
        this.usage.push({
            timestamp: Date.now(),
            cost: estimatedCostUSD,
            tokens: totalTokens,
        });

        // Update stats
        this.stats.totalRequests++;
        this.stats.totalPromptTokens += promptTokens;
        this.stats.totalCompletionTokens += completionTokens;
        this.stats.totalTokens += totalTokens;
        this.stats.totalCostUSD += estimatedCostUSD;
        this.stats.lastHourCostUSD = this.getCostForWindow(60 * 60 * 1000);
        this.stats.lastDayCostUSD = this.getCostForWindow(24 * 60 * 60 * 1000);

        // Log warning if approaching limits
        if (estimatedCostUSD > this.limits.maxCostPerRequestUSD * 0.8) {
            console.warn(`⚠️  High cost request: $${estimatedCostUSD.toFixed(4)} (${totalTokens} tokens)`);
        }

        if (this.stats.lastHourCostUSD > this.limits.maxCostPerHourUSD * 0.8) {
            console.warn(`⚠️  Hourly cost approaching limit: $${this.stats.lastHourCostUSD.toFixed(4)}/$${this.limits.maxCostPerHourUSD}`);
        }

        return {
            promptTokens,
            completionTokens,
            totalTokens,
            estimatedCostUSD,
        };
    }

    /**
     * Get current cost statistics
     */
    getStats(): CostStats {
        this.cleanOldUsage();
        this.stats.lastHourCostUSD = this.getCostForWindow(60 * 60 * 1000);
        this.stats.lastDayCostUSD = this.getCostForWindow(24 * 60 * 60 * 1000);
        return { ...this.stats };
    }

    /**
     * Reset all statistics (for testing or new period)
     */
    reset(): void {
        this.usage = [];
        this.stats = {
            totalRequests: 0,
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            totalTokens: 0,
            totalCostUSD: 0,
            lastHourCostUSD: 0,
            lastDayCostUSD: 0,
        };
    }
}

// ============================================================================
// Global Token Limiter Instance
// ============================================================================

let globalLimiter: TokenLimiter | null = null;

export const getTokenLimiter = (limits?: Partial<TokenLimits>): TokenLimiter => {
    if (!globalLimiter) {
        globalLimiter = new TokenLimiter(limits ? { ...DEFAULT_LIMITS, ...limits } : DEFAULT_LIMITS);
    }
    return globalLimiter;
};

/**
 * Estimate token count (rough approximation: 1 token ≈ 4 chars for English, 1.5 chars for Indonesian)
 */
export const estimateTokenCount = (text: string): number => {
    const charCount = text.length;
    const avgCharsPerToken = 2.5; // Conservative estimate for mixed language
    return Math.ceil(charCount / avgCharsPerToken);
};
