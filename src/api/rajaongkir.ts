import dotenv from 'dotenv';
import { getBusinessConfig } from '../config/business.js';

dotenv.config();

const BASE_URL = 'https://rajaongkir.komerce.id/api/v1';
const DEFAULT_WEIGHT_GRAMS = 500;
const DEFAULT_COURIERS = 'jne,sicepat,ide,sap,ninja,jnt,tiki,wahana,pos,sentral,lion,rex';
const SAFE_WEIGHT_BY_SIZE_ML: Record<string, number> = {
    '30': 110,
    '50': 275,
    '100': 440,
};
let apiKeyIndex = 0;

interface DomesticDestination {
    id: number;
    label: string;
    city_name: string;
}

interface DomesticCost {
    name: string;
    code: string;
    service: string;
    description: string;
    cost: number;
    etd: string;
}

interface ShippingOption {
    courier: string;
    service: string;
    cost: number;
    etd: string;
}

const HIDDEN_SERVICE_PATTERN = /(cargo|kargo|truck|trucking|jtr|dangerous|valuable|bigpack|t15|t25|t60|idtruck|drg)/i;

const normalizeDestinationQuery = (query: string) => {
    const lines = query
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const locationLine = [...lines]
        .reverse()
        .find((line) => /\b(kec\.?|kecamatan|kel\.?|kelurahan|kota|kab\.?|kabupaten|desa)\b/i.test(line));
    const fromAfterKe = query.match(/\bke\s+(.+?)(?:\.|\n|$)/i)?.[1];
    const candidate = locationLine || fromAfterKe || query;
    return candidate
        .replace(/\b(kec\.?|kecamatan|kota|kab\.?|kabupaten)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
};

const getApiKeys = () => (process.env.RAJAONGKIR_API_KEY || '')
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);

const isRotatableError = (status: number, message: string) => {
    const normalized = message.toLowerCase();
    return status === 401
        || status === 403
        || status === 429
        || normalized.includes('limit')
        || normalized.includes('invalid api key')
        || normalized.includes('key not found');
};

const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const apiKeys = getApiKeys();
    if (apiKeys.length === 0) {
        throw new Error('RAJAONGKIR_API_KEY belum diisi.');
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < apiKeys.length; attempt++) {
        const keyIndex = apiKeyIndex % apiKeys.length;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        try {
            const response = await fetch(`${BASE_URL}${path}`, {
                ...init,
                signal: controller.signal,
                headers: {
                    key: apiKeys[keyIndex],
                    ...init.headers,
                },
            });
            const text = await response.text();
            const data = text ? JSON.parse(text) : {};
            const message = data?.meta?.message || `RajaOngkir HTTP ${response.status}`;

            if (response.ok) {
                return data;
            }

            lastError = new Error(message);
            if (!isRotatableError(response.status, message)) {
                throw lastError;
            }

            apiKeyIndex = (keyIndex + 1) % apiKeys.length;
            console.warn(`RajaOngkir API key #${keyIndex + 1} unavailable: ${message}. Rotating key.`);
        } finally {
            clearTimeout(timeout);
        }
    }

    throw lastError || new Error('Semua RAJAONGKIR_API_KEY tidak bisa dipakai.');
};

export const findDestination = async (query: string): Promise<DomesticDestination | null> => {
    const normalizedQuery = normalizeDestinationQuery(query);
    const data = await request<{ data?: DomesticDestination[] }>(
        `/destination/domestic-destination?search=${encodeURIComponent(normalizedQuery)}&limit=1&offset=0`
    );
    return data.data?.[0] || null;
};

export const getCities = async () => {
    const data = await request<{ data?: DomesticDestination[] }>(
        '/destination/domestic-destination?search=&limit=100&offset=0'
    );
    return data.data || [];
};

const parseFastestDay = (etd: string) => {
    const match = etd.match(/\d+/);
    return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
};

const formatShippingOptions = (destinationLabel: string, options: ShippingOption[]) => {
    const regularOptions = options
        .filter((option) => !HIDDEN_SERVICE_PATTERN.test(`${option.courier} ${option.service}`))
        .sort((a, b) => a.cost - b.cost);
    const visibleOptions = regularOptions.length > 0 ? regularOptions : [...options].sort((a, b) => a.cost - b.cost);
    const cheapest = visibleOptions.slice(0, 3);
    const fastest = visibleOptions
        .filter((option) => !cheapest.some((chosen) => chosen.courier === option.courier && chosen.service === option.service))
        .sort((a, b) => parseFastestDay(a.etd) - parseFastestDay(b.etd) || a.cost - b.cost)[0];
    const recommendations = fastest ? [...cheapest, fastest] : cheapest;

    const lines = recommendations.map((option, index) => {
        const price = option.cost.toLocaleString('id-ID');
        const etd = option.etd ? option.etd.replace(/\s*day\b/i, ' hari') : 'estimasi belum tersedia';
        return `${index + 1}. ${option.courier} ${option.service} - Rp${price} (${etd})`;
    });

    return `Ongkir ke ${destinationLabel}:\n${lines.join('\n')}\n\nPaling hemat: ${recommendations[0].courier} ${recommendations[0].service} Rp${recommendations[0].cost.toLocaleString('id-ID')}.\nKakak mau pakai yang mana?`;
};

export const findCityId = async (cityName: string): Promise<string | null> => {
    const destination = await findDestination(cityName);
    return destination ? String(destination.id) : null;
};

const getOriginDestinationId = async (): Promise<string> => {
    const explicitOriginId = process.env.STORE_DESTINATION_ID || process.env.STORE_CITY_ID;
    if (explicitOriginId) {
        return explicitOriginId;
    }

    const originName = process.env.STORE_CITY_NAME || 'Bantul';
    const origin = await findDestination(originName);
    if (!origin) {
        throw new Error(`Lokasi toko "${originName}" tidak ditemukan.`);
    }
    return String(origin.id);
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const estimateConfiguredShippingWeightGrams = (text: string, configWeights: Record<string, number>, fallback: number) => {
    const configured = Object.entries(configWeights)
        .filter(([label, grams]) => label.trim() && Number.isFinite(grams) && grams > 0)
        .sort(([left], [right]) => right.length - left.length);
    const weights = configured.length ? configured : Object.entries(SAFE_WEIGHT_BY_SIZE_ML).map(([size, grams]) => [`${size}ml`, grams] as const);
    const labels = weights.map(([label]) => escapeRegex(label.trim()).replace(/\\\s+/g, '\\s*'));
    const pattern = new RegExp(`(?:(\\d+)\\s*(?:x|pcs?|botol)\\s*)?(${labels.join('|')})(?:\\s*(?:x|pcs?|botol)\\s*(\\d+))?`, 'gi');
    const byLabel = new Map(weights.map(([label, grams]) => [label.toLowerCase().replace(/\s+/g, ''), Number(grams)]));
    let total = 0;
    for (const match of text.matchAll(pattern)) {
        const quantity = Number(match[1] || match[3] || 1);
        total += quantity * (byLabel.get(String(match[2]).toLowerCase().replace(/\s+/g, '')) || 0);
    }
    return total || fallback;
};

export const estimateShippingWeightGrams = (text: string) => {
    const fallback = Number(process.env.SHIPPING_WEIGHT_GRAMS) || DEFAULT_WEIGHT_GRAMS;
    return estimateConfiguredShippingWeightGrams(text, getBusinessConfig().shippingWeights, fallback);
};

const calculateDomesticCost = async (origin: string, destination: string, couriers: string[], weight: number) => {
    const body = new URLSearchParams({
        origin,
        destination,
        weight: String(weight),
        courier: couriers.join(':'),
    });

    const data = await request<{ data?: DomesticCost[] }>('/calculate/domestic-cost', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
    });

    return data.data || [];
};

export const checkShippingCost = async (destinationCityName: string): Promise<string> => {
    try {
        const originId = await getOriginDestinationId();
        const destination = await findDestination(destinationCityName);
        const weight = estimateShippingWeightGrams(destinationCityName);

        if (!destination) {
            return `Maaf, tujuan "${destinationCityName}" tidak ditemukan. Coba tulis nama kota/kecamatan yang lebih spesifik ya kak.`;
        }

        const results: ShippingOption[] = [];
        const couriers = (process.env.SHIPPING_COURIERS || DEFAULT_COURIERS)
            .split(',')
            .map((courier) => courier.trim().toLowerCase())
            .filter(Boolean);

        try {
            const costs = await calculateDomesticCost(originId, String(destination.id), couriers, weight);
            for (const cost of costs) {
                results.push({
                    courier: cost.code.toUpperCase(),
                    service: cost.service,
                    cost: cost.cost,
                    etd: cost.etd,
                });
            }
        } catch (error) {
            console.warn('RajaOngkir multi-courier unavailable:', (error as Error).message);
        }

        if (results.length === 0 && couriers.length > 1) {
            for (const courier of couriers) {
                try {
                    const fallbackCosts = await calculateDomesticCost(originId, String(destination.id), [courier], weight);
                    for (const cost of fallbackCosts) {
                        results.push({
                            courier: cost.code.toUpperCase(),
                            service: cost.service,
                            cost: cost.cost,
                            etd: cost.etd,
                        });
                    }
                } catch (error) {
                    console.warn(`RajaOngkir courier ${courier} unavailable:`, (error as Error).message);
                }
            }
        }

        if (results.length === 0) {
            return `Maaf, belum ada layanan kurir tersedia ke ${destination.label}.`;
        }

        return formatShippingOptions(destination.label, results);
    } catch (error) {
        console.error('Error checking RajaOngkir cost:', error);
        return 'Maaf, sistem pengiriman (RajaOngkir) sedang gangguan.';
    }
};
