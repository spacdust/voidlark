export interface AntiBanDelayConfig {
    minDelaySeconds: number;
    maxDelaySeconds: number;
    typingSpeedMsPerChar: number;
}

export const DEFAULT_ANTI_BAN_CONFIG: AntiBanDelayConfig = {
    minDelaySeconds: 3,
    maxDelaySeconds: 5,
    typingSpeedMsPerChar: 8,
};

export const calculateRandomDelayMs = (config: AntiBanDelayConfig): number => {
    const minMs = Math.max(0, config.minDelaySeconds * 1000);
    const maxMs = Math.max(minMs, config.maxDelaySeconds * 1000);
    if (minMs === maxMs) return minMs;
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
};

export const calculateTypingDurationMs = (textLength: number, config: AntiBanDelayConfig): number => {
    const baseDuration = textLength * config.typingSpeedMsPerChar;
    // Bound typing duration between 650ms and 4500ms for realistic feel
    return Math.min(4_500, Math.max(650, baseDuration));
};
