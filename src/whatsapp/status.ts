export type WaConnectionState = 'connecting' | 'open' | 'close' | 'qr' | 'logged_out' | 'error' | 'unknown';

export type WaStatus = {
    state: WaConnectionState;
    lastUpdate: string;
    detail?: string;
    qr?: string;
    qrUrl?: string;
    phone?: string;
    reconnectCount?: number;
    connectedAt?: string;
    disconnectedAt?: string;
    lastError?: string;
    outboundQueueDepth?: number;
};

let status: WaStatus = {
    state: 'unknown',
    lastUpdate: new Date().toISOString(),
    detail: 'Belum inisialisasi',
};
const sessionStatuses = new Map<string, WaStatus>();

export const setWaStatus = (next: Partial<WaStatus>) => {
    status = {
        ...status,
        ...next,
        lastUpdate: new Date().toISOString(),
    };
};

export const getWaStatus = (): WaStatus => ({ ...status });

export const setWaSessionStatus = (sessionId: string, next: Partial<WaStatus>) => {
    const current = sessionStatuses.get(sessionId) || { state: 'unknown' as const, lastUpdate: new Date().toISOString() };
    const now = new Date().toISOString();
    const reconnectCount = next.state === 'connecting' && current.state !== 'connecting' ? (current.reconnectCount || 0) + 1 : current.reconnectCount;
    sessionStatuses.set(sessionId, { ...current, ...next, ...(reconnectCount === undefined ? {} : { reconnectCount }), ...(next.state === 'open' ? { connectedAt: now } : {}), ...(next.state === 'close' || next.state === 'error' ? { disconnectedAt: now } : {}), ...(next.state === 'error' && next.detail ? { lastError: next.detail } : {}), lastUpdate: now });
    const values = [...sessionStatuses.values()];
    const aggregate = values.find((item) => item.state === 'open') || values.find((item) => item.state === 'qr') || values.find((item) => item.state === 'connecting') || values[0];
    if (aggregate) setWaStatus(aggregate);
};

export const getWaSessionStatus = (sessionId: string): WaStatus => ({ ...(sessionStatuses.get(sessionId) || { state: 'unknown', lastUpdate: new Date().toISOString(), detail: 'Belum dimulai' }) });
export const getWaSessionStatuses = () => Object.fromEntries([...sessionStatuses].map(([id, value]) => [id, { ...value }]));
export const removeWaSessionStatus = (sessionId: string) => sessionStatuses.delete(sessionId);
export const isWaSessionStaleConnecting = (value: WaStatus, maxAgeMs = 60_000) => value.state === 'connecting' && Date.now() - Date.parse(value.lastUpdate) > maxAgeMs;
