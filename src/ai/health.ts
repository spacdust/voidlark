export type AiHealthStatus = 'ready' | 'slow' | 'missing' | 'unreachable' | 'unauthorized' | 'model_not_found' | 'error';

export type AiHealth = {
    status: AiHealthStatus;
    label: string;
    detail: string;
    endpoint: string;
    model: string;
    latencyMs: number | null;
    checkedAt: string;
};

const CACHE_MS = 5 * 60 * 1000;
const MODELS_TIMEOUT_MS = 5_000;
const INFERENCE_TIMEOUT_MS = 20_000;
let cached: AiHealth | null = null;
let cachedAt = 0;
let inFlight: Promise<AiHealth> | null = null;

const result = (
    status: AiHealthStatus,
    label: string,
    detail: string,
    endpoint: string,
    model: string,
    latencyMs: number | null,
): AiHealth => ({ status, label, detail, endpoint, model, latencyMs, checkedAt: new Date().toISOString() });

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
};

const classifyHttpError = async (response: Response, endpoint: string, model: string, latencyMs: number) => {
    const body = (await response.text()).slice(0, 500);
    if (response.status === 401 || response.status === 403) {
        return result('unauthorized', 'API key ditolak', `Provider menolak autentikasi (${response.status}).`, endpoint, model, latencyMs);
    }
    if (response.status === 404 || /model.*(not found|invalid|unknown|does not exist)/i.test(body)) {
        return result('model_not_found', 'Model tidak tersedia', `Model "${model}" tidak ditemukan oleh provider.`, endpoint, model, latencyMs);
    }
    if (response.status === 429) {
        return result('error', 'Limit tercapai', 'Provider menolak request karena rate limit atau kuota.', endpoint, model, latencyMs);
    }
    return result('error', 'Koneksi bermasalah', `Provider mengembalikan HTTP ${response.status}.`, endpoint, model, latencyMs);
};

const probe = async (): Promise<AiHealth> => {
    const endpoint = (process.env.AI_API_BASE_URL || 'http://localhost:20128/v1').replace(/\/$/, '');
    const apiKey = process.env.AI_API_KEY || process.env.OPENROUTER_API_KEY || '';
    const model = process.env.AI_MODEL || 'gemini/gemini-2.5-flash';
    if (!apiKey) return result('missing', 'Belum terhubung', 'API key AI belum diisi.', endpoint, model, null);

    const headers = {
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Voidlark Health Check',
    };
    const started = Date.now();
    let modelVerified = false;

    try {
        const modelsResponse = await fetchWithTimeout(`${endpoint}/models`, { headers }, MODELS_TIMEOUT_MS);
        const latencyMs = Date.now() - started;
        if (!modelsResponse.ok) return classifyHttpError(modelsResponse, endpoint, model, latencyMs);
        const body = await modelsResponse.json() as { data?: Array<{ id?: string }> };
        const ids = Array.isArray(body.data) ? body.data.map((entry) => String(entry.id || '')) : [];
        if (ids.length > 0 && !ids.includes(model)) {
            return result('model_not_found', 'Model tidak tersedia', `Endpoint aktif, tetapi model "${model}" tidak ada dalam daftar provider.`, endpoint, model, latencyMs);
        }
        modelVerified = ids.includes(model);
    } catch (error) {
        const timeout = error instanceof Error && error.name === 'AbortError';
        if (!timeout) {
            return result('unreachable', 'Endpoint tidak terjangkau', 'Alamat endpoint tidak dapat dihubungi.', endpoint, model, Date.now() - started);
        }
        // Beberapa gateway tidak menyediakan /models atau lambat. Lanjutkan ke inference nyata.
    }

    const inferenceStarted = Date.now();
    try {
        const response = await fetchWithTimeout(`${endpoint}/chat/completions`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: 'Reply OK.' }],
                max_tokens: 2,
                temperature: 0,
            }),
        }, INFERENCE_TIMEOUT_MS);
        const latencyMs = Date.now() - inferenceStarted;
        if (!response.ok) return classifyHttpError(response, endpoint, model, latencyMs);
        const slow = latencyMs > 5_000;
        return result(
            slow ? 'slow' : 'ready',
            slow ? 'Siap, respons lambat' : 'Siap',
            `${modelVerified ? 'Endpoint, API key, dan model valid' : 'Endpoint dan model berhasil digunakan'} dalam ${latencyMs} ms.`,
            endpoint,
            model,
            latencyMs,
        );
    } catch (error) {
        const latencyMs = Date.now() - inferenceStarted;
        const timeout = error instanceof Error && error.name === 'AbortError';
        if (timeout && modelVerified) {
            return result('slow', 'Terhubung, model lambat', 'Endpoint, API key, dan model valid, tetapi inference melebihi 20 detik.', endpoint, model, latencyMs);
        }
        return result(
            'unreachable',
            timeout ? 'Koneksi timeout' : 'Endpoint tidak terjangkau',
            timeout ? 'Endpoint terhubung tetapi inference tidak selesai dalam 20 detik.' : 'Alamat endpoint tidak dapat dihubungi.',
            endpoint,
            model,
            latencyMs,
        );
    }
};

export const checkAiHealth = async (force = false): Promise<AiHealth> => {
    if (!force && cached && Date.now() - cachedAt < CACHE_MS) return cached;
    if (!force && inFlight) return inFlight;
    inFlight = probe().then((health) => {
        cached = health;
        cachedAt = Date.now();
        return health;
    }).finally(() => {
        inFlight = null;
    });
    return inFlight;
};

export const invalidateAiHealth = () => {
    cached = null;
    cachedAt = 0;
};
