import { createHash } from 'crypto';
import { pool } from '../config/db.js';
import { getKnowledgeBase } from './knowledge.js';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RESULTS = 5;
let braveKeyIndex = 0;
let tavilyKeyIndex = 0;

export type LookupProvider = 'brave' | 'tavily' | 'none';

const normalizeQuery = (query: string) => query.trim().toLowerCase().replace(/\s+/g, ' ');

const getApiKeys = (envName: 'BRAVE_SEARCH_API_KEY' | 'TAVILY_API_KEY') => (process.env[envName] || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);

const cacheKey = (query: string) => createHash('sha256').update(normalizeQuery(query)).digest('hex');

export const getLookupProvider = (): LookupProvider => {
    if (getApiKeys('BRAVE_SEARCH_API_KEY').length > 0) return 'brave';
    if (getApiKeys('TAVILY_API_KEY').length > 0) return 'tavily';
    return 'none';
};

export const isExternalLookupReady = () => getLookupProvider() !== 'none';

/** Heuristik: query punya cukup token unik yang muncul di KB. */
export const knowledgeCoversQuery = (query: string): boolean => {
    const kb = getKnowledgeBase().toLowerCase();
    if (!kb || kb.length < 40) return false;
    const tokens = normalizeQuery(query)
        .split(/[^a-z0-9\u00c0-\u024f]+/i)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3)
        .slice(0, 8);
    if (tokens.length === 0) return false;
    const hits = tokens.filter((token) => kb.includes(token)).length;
    return hits >= Math.min(2, tokens.length) && hits / tokens.length >= 0.5;
};

const getCached = async (query: string) => {
    const key = cacheKey(query);
    const { rows } = await pool.query(
        'SELECT result, created_at FROM lookup_cache WHERE query_hash = $1 LIMIT 1',
        [key]
    );
    const row = rows[0];
    if (!row) return null;
    const created = new Date(String(row.created_at).includes('T') || String(row.created_at).endsWith('Z')
        ? row.created_at
        : `${String(row.created_at).replace(' ', 'T')}Z`);
    if (Number.isNaN(created.getTime()) || Date.now() - created.getTime() > CACHE_TTL_MS) {
        await pool.query('DELETE FROM lookup_cache WHERE query_hash = $1', [key]);
        return null;
    }
    return String(row.result || '');
};

const setCached = async (query: string, result: string, provider: string) => {
    const key = cacheKey(query);
    await pool.query(
        `INSERT INTO lookup_cache (query_hash, query_text, result, provider)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (query_hash) DO UPDATE SET
           query_text = EXCLUDED.query_text,
           result = EXCLUDED.result,
           provider = EXCLUDED.provider,
           created_at = CURRENT_TIMESTAMP`,
        [key, normalizeQuery(query).slice(0, 500), result, provider]
    );
};

type SearchHit = { title: string; url: string; snippet: string };

const searchBrave = async (query: string, key: string): Promise<SearchHit[]> => {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(MAX_RESULTS));
    url.searchParams.set('search_lang', 'id');
    url.searchParams.set('country', 'ID');

    const response = await fetch(url, {
        headers: {
            Accept: 'application/json',
            'X-Subscription-Token': key,
        },
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Brave search gagal (${response.status}): ${body.slice(0, 180)}`);
    }
    const data = await response.json() as {
        web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    };
    return (data.web?.results || []).slice(0, MAX_RESULTS).map((item) => ({
        title: item.title || '',
        url: item.url || '',
        snippet: item.description || '',
    }));
};

const searchTavily = async (query: string, key: string): Promise<SearchHit[]> => {
    const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            api_key: key,
            query,
            search_depth: 'basic',
            max_results: MAX_RESULTS,
            include_answer: false,
        }),
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Tavily search gagal (${response.status}): ${body.slice(0, 180)}`);
    }
    const data = await response.json() as {
        results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return (data.results || []).slice(0, MAX_RESULTS).map((item) => ({
        title: item.title || '',
        url: item.url || '',
        snippet: item.content || '',
    }));
};

const isRotatableError = (error: unknown) => {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return /\((401|403|429)\)/.test(message)
        || message.includes('limit')
        || message.includes('quota')
        || message.includes('rate')
        || message.includes('invalid')
        || message.includes('unauthorized');
};

const searchWithRotation = async (
    provider: 'brave' | 'tavily',
    query: string,
): Promise<SearchHit[]> => {
    const envName = provider === 'brave' ? 'BRAVE_SEARCH_API_KEY' : 'TAVILY_API_KEY';
    const keys = getApiKeys(envName);
    if (keys.length === 0) throw new Error(`${envName} belum diisi.`);

    let index = provider === 'brave' ? braveKeyIndex : tavilyKeyIndex;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < keys.length; attempt++) {
        const keyIndex = index % keys.length;
        try {
            const hits = provider === 'brave'
                ? await searchBrave(query, keys[keyIndex])
                : await searchTavily(query, keys[keyIndex]);
            if (provider === 'brave') braveKeyIndex = keyIndex;
            else tavilyKeyIndex = keyIndex;
            return hits;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (!isRotatableError(lastError)) throw lastError;
            index = (keyIndex + 1) % keys.length;
            if (provider === 'brave') braveKeyIndex = index;
            else tavilyKeyIndex = index;
            console.warn(`${provider} API key #${keyIndex + 1} unavailable. Rotating key.`);
        }
    }
    throw lastError || new Error(`Semua ${envName} tidak bisa dipakai.`);
};

const searchExternal = async (query: string): Promise<{ hits: SearchHit[]; provider: 'brave' | 'tavily' }> => {
    const providers: Array<'brave' | 'tavily'> = [];
    if (getApiKeys('BRAVE_SEARCH_API_KEY').length > 0) providers.push('brave');
    if (getApiKeys('TAVILY_API_KEY').length > 0) providers.push('tavily');

    let lastError: Error | null = null;
    for (const provider of providers) {
        try {
            return { hits: await searchWithRotation(provider, query), provider };
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            console.warn(`${provider} lookup unavailable, trying next provider: ${lastError.message}`);
        }
    }
    throw lastError || new Error('Tidak ada provider lookup eksternal yang aktif.');
};

const formatHits = (query: string, hits: SearchHit[], provider: string) => {
    if (hits.length === 0) {
        return `Referensi eksternal tidak menemukan hasil untuk: "${query}".\nSumber: ${provider}\nPakai knowledge base toko saja, atau tanya klarifikasi ke customer.`;
    }
    const lines = hits.map((hit, index) => {
        const snippet = hit.snippet.replace(/\s+/g, ' ').trim().slice(0, 280);
        return `${index + 1}. ${hit.title}\n   ${snippet}\n   ${hit.url}`;
    });
    return [
        `REFERENSI EKSTERNAL (bukan stok/harga toko) untuk: "${query}"`,
        `Sumber: ${provider}`,
        'Pakai ini hanya untuk memahami produk/brand/spec yang disebut customer, lalu arahkan ke katalog toko di knowledge base.',
        'Jangan mengklaim toko menjual brand luar kecuali ada di knowledge base.',
        '',
        ...lines,
    ].join('\n');
};

/**
 * Cari referensi produk/brand/spec di luar KB.
 * - Cek cache dulu
 * - Opsional skip search jika KB sudah cover
 * - Brave (prioritas) atau Tavily
 */
export const lookupProductReference = async (
    query: string,
    options: { forceExternal?: boolean } = {},
): Promise<{ content: string; source: 'kb' | 'cache' | 'brave' | 'tavily' | 'error' }> => {
    const q = query.trim();
    if (!q) return { content: 'Query kosong.', source: 'error' };

    if (!options.forceExternal && knowledgeCoversQuery(q)) {
        return {
            content: `Knowledge base toko sudah memuat info relevan untuk "${q}". Pakai knowledge base, jangan andalkan web. Jangan klaim stok/harga dari luar.`,
            source: 'kb',
        };
    }

    const cached = await getCached(q);
    if (cached) return { content: cached, source: 'cache' };

    const provider = getLookupProvider();
    if (provider === 'none') {
        return {
            content: 'Lookup eksternal nonaktif: isi BRAVE_SEARCH_API_KEY atau TAVILY_API_KEY di Settings. Sementara pakai knowledge base + tanya klarifikasi customer.',
            source: 'error',
        };
    }

    try {
        const result = await searchExternal(q);
        const content = formatHits(q, result.hits, result.provider);
        await setCached(q, content, result.provider);
        return { content, source: result.provider };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('External lookup gagal:', message);
        return {
            content: `Gagal lookup eksternal: ${message}\nPakai knowledge base toko dan tanya klarifikasi ke customer.`,
            source: 'error',
        };
    }
};
