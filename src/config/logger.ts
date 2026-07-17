import pino, { type DestinationStream, type LevelWithSilent, type Logger } from 'pino';

const REDACTED = '[REDACTED]';
const LOG_LEVELS = new Set<LevelWithSilent>(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);
const SENSITIVE_KEYS = /^(?:authorization|cookie|set-cookie|password|passwd|secret|token|api[-_]?key|access[-_]?key|private[-_]?key|session|sessionid|csrf|jid|remotejid|phone|email)$/i;
const CONTENT_KEYS = /^(?:text|body|message|messages|payload|conversation|caption|content|prompt|response)$/i;

const sanitizeString = (value: string) => value
    .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
    .replace(/\b(?:sk|pk)-[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REDACTED)
    .replace(/\b\d{6,}@(?:s\.whatsapp\.net|g\.us|broadcast|lid)\b/gi, REDACTED)
    .replace(/(?<![\w-])\+?\d[\d .()-]{7,}\d(?![\w-])/g, REDACTED);

const sanitizeError = (error: Error & { code?: unknown }) => ({
    type: error.name || 'Error',
    message: sanitizeString(error.message),
    ...(typeof error.code === 'string' || typeof error.code === 'number' ? { code: error.code } : {}),
});

const sanitizeValue = (value: unknown, seen: WeakSet<object>): unknown => {
    if (typeof value === 'string') return sanitizeString(value);
    if (value === null || typeof value !== 'object') return value;
    if (value instanceof Error) return sanitizeError(value);
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, seen));

    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
        if (SENSITIVE_KEYS.test(key) || CONTENT_KEYS.test(key)) return [key, REDACTED];
        return [key, sanitizeValue(item, seen)];
    }));
};

const sanitizeRecord = (value: unknown) => sanitizeValue(value, new WeakSet<object>());

export const resolveLogLevel = (configured: string | undefined, environment = process.env.NODE_ENV): LevelWithSilent => {
    const normalized = configured?.trim().toLowerCase() as LevelWithSilent | undefined;
    if (normalized && LOG_LEVELS.has(normalized)) return normalized;
    return environment === 'development' ? 'debug' : 'info';
};

interface LoggerOptions {
    destination?: DestinationStream;
    level?: LevelWithSilent;
}

export const createAppLogger = ({ destination, level }: LoggerOptions = {}): Logger => pino({
    level: level || resolveLogLevel(process.env.LOG_LEVEL),
    base: { service: 'voidlark' },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { err: (value) => value },
    hooks: {
        logMethod(args, method) {
            const values = [...args];
            const eventIndex = typeof values.at(-1) === 'string' ? values.length - 1 : -1;
            const event = eventIndex >= 0 ? sanitizeString(String(values[eventIndex])) : undefined;
            if (eventIndex >= 0) values.splice(eventIndex, 1);

            const first = values[0];
            const fields = first && typeof first === 'object' ? sanitizeRecord(first) : {};
            method.apply(this, [{ ...(fields as Record<string, unknown>), ...(event ? { event } : {}) }]);
        },
    },
}, destination);

export const appLogger = createAppLogger();
