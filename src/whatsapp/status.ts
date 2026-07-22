export type WaConnectionState = 'connecting' | 'open' | 'close' | 'qr' | 'logged_out' | 'unknown';

export type WaStatus = {
    state: WaConnectionState;
    lastUpdate: string;
    detail?: string;
    qr?: string;
    qrUrl?: string;
    phone?: string;
};

let status: WaStatus = {
    state: 'unknown',
    lastUpdate: new Date().toISOString(),
    detail: 'Belum inisialisasi',
};

export const setWaStatus = (next: Partial<WaStatus>) => {
    status = {
        ...status,
        ...next,
        lastUpdate: new Date().toISOString(),
    };
};

export const getWaStatus = (): WaStatus => ({ ...status });
