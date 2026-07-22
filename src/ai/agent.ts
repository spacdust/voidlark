import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { operationalMetrics } from '../operations/metrics.js';
import dotenv from 'dotenv';
import { checkShippingCost } from '../api/rajaongkir.js';
import { upsertLead } from '../chat/leads.js';
import { logHandoff, getAdminJid } from '../chat/handoff.js';
import { setChatState, upsertDraftOrder, confirmDraftOrder, type ChatStage } from '../chat/orders.js';
import { buildBusinessPrompt, getBusinessConfig } from '../config/business.js';
import { lookupProductReference } from './external-lookup.js';
import { buildResponsePlan } from './response-plan.js';
import { containsInternalMarkup, parseTextToolCalls, parseToolArguments, stripInternalMarkup } from './tool-markup.js';
import { containsUnexpectedCjk, sanitizeCustomerLanguage } from './language-guard.js';
import { resolveExternalLookupQuery } from './lookup-routing.js';
import { buildExternalLookupFallback } from './external-fallback.js';
import { loadCatalogSchemaRows } from './catalog-matcher.js';
import { buildExternalSearchQuery, resolveProductDomain } from './product-domain.js';
import { selectDomainMatcher } from './domain-matchers.js';
import { validateClaims } from './claim-validator.js';
import { retrieveKnowledge } from './knowledge.js';
import { withTransientRetry } from '../operations/retry.js';
import { validateToolArguments, type ToolName } from './tool-validation.js';
import { getCircuitBreaker } from './circuit-breaker.js';
import { getTokenLimiter, estimateTokenCount } from './token-limiter.js';

dotenv.config();

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

interface ClosingOrderConfig {
    enableShipping: boolean;
    handoffAfterPaymentSummary: boolean;
    paymentInstructions: string;
}

export const buildClosingOrderRule = (config: ClosingOrderConfig) => {
    const checkoutScope = `produk + checkout lengkap${config.enableShipping ? ' + ongkir/kurir' : ''}`;
    if (config.handoffAfterPaymentSummary) {
        return `CLOSING ORDER: Saat customer setuju order final (${checkoutScope}), WAJIB panggil tool konfirmasiPesanan. Lalu balas ringkasan pesanan saja. Jangan kirim instruksi pembayaran karena admin akan melanjutkan penanganan pembayaran. Jangan bilang lunas sebelum status paid.`;
    }
    return `CLOSING ORDER: Saat customer setuju order final (${checkoutScope}), WAJIB panggil tool konfirmasiPesanan. Lalu balas ringkasan pesanan dan instruksi pembayaran: ${config.paymentInstructions}. Jangan bilang lunas sebelum status paid.`;
};

const normalizeSearchText = (value: string) => value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const STOP_WORDS = new Set(['yang', 'dan', 'atau', 'untuk', 'dari', 'dengan', 'ini', 'itu', 'ada', 'apa', 'saya', 'aku', 'kak', 'mau', 'ingin', 'bisa', 'tidak', 'gak', 'ga', 'nya']);

const selectRelevantKnowledge = (knowledge: string, query: string, maxChars = 7_000) => {
    const indexed = retrieveKnowledge(query, { maxChars });
    if (indexed.text) return { text: indexed.text, citations: indexed.citations };
    if (knowledge.length <= maxChars) return { text: knowledge, citations: [] };
    return { text: knowledge.slice(0, maxChars), citations: [] };
};

export interface AgentResult {
    text: string;
    handoff?: { reason: string };
    orderConfirmed?: { orderId: number; summary: string };
    postPaymentHandoff?: { reason: string };
}

type CompatibleDelta = {
    role?: 'assistant';
    content?: string;
    reasoning_content?: string;
    tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
    }>;
};

const parseCompatibleCompletion = (raw: string): OpenAI.Chat.Completions.ChatCompletion => {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('data:')) return JSON.parse(trimmed) as OpenAI.Chat.Completions.ChatCompletion;
    let id = '';
    let model = '';
    let content = '';
    let finishReason: string | null = null;
    const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];
    for (const line of trimmed.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        const chunk = JSON.parse(data) as {
            id?: string;
            model?: string;
            choices?: Array<{ delta?: CompatibleDelta; finish_reason?: string | null }>;
        };
        id ||= chunk.id || '';
        model ||= chunk.model || '';
        const choice = chunk.choices?.[0];
        const delta = choice?.delta;
        if (delta?.content) content += delta.content;
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        for (const part of delta?.tool_calls || []) {
            const index = part.index ?? 0;
            toolCalls[index] ||= { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (part.id) toolCalls[index].id = part.id;
            if (part.function?.name) toolCalls[index].function.name += part.function.name;
            if (part.function?.arguments) toolCalls[index].function.arguments += part.function.arguments;
        }
    }
    return {
        id: id || `voidlark-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
            index: 0,
            finish_reason: (finishReason || 'stop') as any,
            logprobs: null,
            message: {
                role: 'assistant',
                content: content || null,
                refusal: null,
                ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
            },
        }],
    } as OpenAI.Chat.Completions.ChatCompletion;
};

const cleanAssistantMessage = (msg: any) => ({
    role: 'assistant' as const,
    content: msg.content ?? undefined,
    tool_calls: msg.tool_calls && msg.tool_calls.length > 0
        ? msg.tool_calls.map((tc: any) => ({
            id: tc.id,
            type: tc.type,
            function: {
                name: tc.function.name,
                arguments: tc.function.arguments,
            },
        }))
        : undefined,
});

const createCompatibleCompletion = async (
    client: OpenAI,
    params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
) => {
    const started = process.hrtime.bigint();
    
    // Initialize safety systems
    const circuitBreaker = getCircuitBreaker('ai-provider', {
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 60_000,
        monitoringWindow: 120_000,
    });
    const tokenLimiter = getTokenLimiter();
    const model = params.model || 'gemini/gemini-2.5-flash';
    
    // Estimate prompt tokens
    const promptText = params.messages.map(m => 
        typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    ).join('\n');
    const estimatedPromptTokens = estimateTokenCount(promptText);
    
    // Check token limits before making request
    const limitCheck = tokenLimiter.checkLimits(estimatedPromptTokens, model);
    if (!limitCheck.allowed) {
        console.error(`🚫 Token limit exceeded: ${limitCheck.reason}`);
        throw new Error(`Token/cost limit exceeded: ${limitCheck.reason}`);
    }
    
    try {
        // Execute with circuit breaker protection
        const result = await circuitBreaker.execute(async () => {
            const response = await fetch(`${String(client.baseURL).replace(/\/$/, '')}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${String(client.apiKey)}`,
                    'HTTP-Referer': 'http://localhost:3000',
                    'X-Title': 'Voidlark WhatsApp Bot',
                },
                body: JSON.stringify({ ...params, stream: false }),
                signal: AbortSignal.timeout(75_000), // 75s timeout
            });
            
            const body = await response.text();
            if (!response.ok) throw new Error(`${response.status} ${body.slice(0, 500)}`);
            
            return parseCompatibleCompletion(body);
        });
        
        // Record actual token usage
        const usage = result.usage;
        if (usage) {
            tokenLimiter.recordUsage(
                model,
                usage.prompt_tokens || estimatedPromptTokens,
                usage.completion_tokens || 0
            );
        }
        
        operationalMetrics.ai(Number(process.hrtime.bigint() - started) / 1e9);
        return result;
    } catch (error) {
        operationalMetrics.ai(Number(process.hrtime.bigint() - started) / 1e9, true);
        
        // Log circuit breaker state on error
        const stats = circuitBreaker.getStats();
        if (stats.state !== 'CLOSED') {
            console.error(`⚠️  Circuit breaker state: ${stats.state}, failures: ${stats.totalFailures}/${stats.totalRequests}`);
        }
        
        throw error;
    }
};

export const openai = new OpenAI({
    baseURL: process.env.AI_API_BASE_URL || 'http://localhost:20128/v1',
    apiKey: process.env.AI_API_KEY || 'dummy_key',
    defaultHeaders: {
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Voidlark WhatsApp Bot",
    }
});

const ALL_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
    {
        type: 'function',
        function: {
            name: 'cekOngkir',
            description: 'WAJIB gunakan tool ini jika pembeli meminta ongkir, memberikan kota/kecamatan/kelurahan tujuan, atau memberikan alamat lengkap untuk pengiriman. Jika alamat lengkap tersedia, kirim alamat/kelurahan/kecamatan/kota paling spesifik agar ongkir akurat.',
            parameters: {
                type: 'object',
                properties: {
                    cityName: { type: 'string', description: 'Tujuan pengiriman. Boleh kota, kecamatan, kelurahan, atau alamat lengkap. Sertakan ukuran/jumlah produk jika sudah ada agar berat ongkir akurat. Contoh: "Plamongan Sari, Pedurungan, Semarang; 1x 30ml"' }
                },
                required: ['cityName']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'simpanDataPelanggan',
            description: 'Simpan/update data pelanggan saat mereka memberikan info (nama, alamat, no HP, preferensi produk, dll). Panggil setiap kali ada info baru dari pelanggan. Status: new, interested, checkout, paid, shipped, completed, lost.',
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Nama asli pelanggan (HANYA jika pelanggan secara eksplisit menyebutkan nama. JANGAN mengisi dengan kalimat, keluhan, atau obrolan biasa. Jika tidak menyebutkan nama, biarkan kosong)' },
                    phone: { type: 'string', description: 'No HP pelanggan' },
                    address: { type: 'string', description: 'Alamat lengkap pengiriman' },
                    preferences: { type: 'string', description: 'Preferensi produk/kebutuhan pelanggan' },
                    status: { type: 'string', enum: ['new', 'interested', 'checkout', 'paid', 'shipped', 'completed', 'lost'], description: 'Status lead saat ini' },
                    notes: { type: 'string', description: 'Catatan tambahan' }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'simpanDraftPesanan',
            description: 'Simpan/update draft pesanan dan stage chat setiap kali customer memilih produk, varian/opsi, level/kualitas, ukuran/paket, qty, data checkout, atau ongkir. Panggil saat ada info pesanan baru.',
            parameters: {
                type: 'object',
                properties: {
                    stage: { type: 'string', enum: ['consulting', 'aroma_selected', 'variant_selected', 'quality_selected', 'checkout_data', 'shipping_selected', 'awaiting_payment', 'completed'], description: 'Stage alur chat. aroma_selected = produk/opsi utama sudah dipilih (legacy name, pakai untuk semua industri).' },
                    productName: { type: 'string', description: 'Nama produk utama' },
                    aroma: { type: 'string', description: 'Legacy field: nama item/produk terpilih (boleh diisi sama dengan productName)' },
                    variant: { type: 'string', description: 'Varian/opsi produk (bebas teks sesuai bisnis)' },
                    quality: { type: 'string', description: 'Level/kualitas/paket jika ada' },
                    sizeMl: { type: 'number', description: 'Ukuran numerik opsional jika relevan (legacy ml)' },
                    packageSize: { type: 'string', description: 'Ukuran/kemasan/paket, contoh 30ml, 1 akun, 1 paket, 1 bulan' },
                    quantity: { type: 'number', description: 'Jumlah item' },
                    productPrice: { type: 'number', description: 'Harga produk sebelum ongkir' },
                    options: { type: 'object', description: 'Pilihan produk tambahan sebagai JSON (plan, warna, durasi, dll)' },
                    customerData: { type: 'object', description: 'Data checkout generic sesuai business config' },
                    customerName: { type: 'string', description: 'Nama penerima' },
                    phone: { type: 'string', description: 'No HP/WhatsApp customer' },
                    address: { type: 'string', description: 'Alamat lengkap pengiriman' },
                    shippingOption: { type: 'string', description: 'Kurir/layanan ongkir pilihan customer' },
                    shippingCost: { type: 'number', description: 'Biaya ongkir pilihan customer' }
                },
                required: ['stage']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'konfirmasiPesanan',
            description: 'Kunci draft pesanan menjadi order final (status awaiting_payment) saat customer setuju checkout. WAJIB panggil setelah data produk + checkout lengkap (dan ongkir jika fisik). Setelah sukses, balas customer dengan ringkasan + instruksi pembayaran dari business config.',
            parameters: {
                type: 'object',
                properties: {
                    note: { type: 'string', description: 'Catatan opsional untuk admin' },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'cariReferensiProduk',
            description: 'Cari referensi eksternal (web) untuk produk/brand/spesifikasi yang TIDAK ada atau kurang jelas di knowledge base toko. Multi-bisnis, bukan khusus parfum. Hasil = referensi saja, bukan stok/harga toko. Jangan pakai jika info sudah jelas di knowledge base.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Nama produk, brand, model, atau spek yang dicari. Contoh: "Mykonos Monaco Royal notes", "iPhone 15 spesifikasi", "paket Canva Pro fitur"',
                    },
                    forceExternal: {
                        type: 'boolean',
                        description: 'true = paksa search web meski KB mungkin relevan. Default false (KB dulu).',
                    },
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'escalateToHuman',
            description: 'Eskalasi ke admin manusia. Gunakan HANYA jika: (1) Percakapan stuck/berputar-putar, (2) Pertanyaan di luar knowledge base, (3) Pelanggan marah/kecewa/sentimen sangat negatif, (4) Pelanggan secara eksplisit minta bicara dengan manusia.',
            parameters: {
                type: 'object',
                properties: {
                    reason: { type: 'string', description: 'Alasan eskalasi ke admin' }
                },
                required: ['reason']
            }
        }
    }
];

const getTools = () => {
    const config = getBusinessConfig();
    return ALL_TOOLS.filter((tool) => {
        if (tool.type !== 'function') return true;
        if (tool.function.name === 'cekOngkir' && !config.enableShipping) return false;
        if (tool.function.name === 'cariReferensiProduk' && !config.enableExternalProductLookup) return false;
        return true;
    });
};

const getPreviewTools = () => getTools().filter((tool) => tool.type !== 'function' || [
    'cekOngkir',
    'cariReferensiProduk',
].includes(tool.function.name));

const isContextLimitError = (message: string) => /reduce (?:the )?length|request too large|context length|tokens per minute|tpm|413/i.test(message);
const isTransientAiError = (error: unknown) => /timed out|timeout|connection error|econnreset|socket hang up/i.test(error instanceof Error ? error.message : String(error));

const looksTruncated = (content: string, finishReason: string | null) => {
    const trimmed = content.trim();
    if (!trimmed) return false;
    if (finishReason === 'length') return true;
    return /(?:\batau|\bdan|\byang|\buntuk|\bdengan|\blebih|\bkakak lebih|[,;:]|[-–—])$/i.test(trimmed);
};

const appendCompletion = async (
    createCompletion: (params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming) => Promise<OpenAI.Chat.Completions.ChatCompletion>,
    model: string,
    messages: any[],
    firstResponse: OpenAI.Chat.Completions.ChatCompletion,
) => {
    const firstChoice = firstResponse.choices[0];
    const firstContent = firstChoice.message.content || '';
    if (!looksTruncated(firstContent, firstChoice.finish_reason)) return firstContent;
    const continuationMessages = [
        ...messages.slice(0, 1),
        ...messages.slice(-4),
        { role: 'assistant', content: firstContent },
        { role: 'user', content: 'Lanjutkan tepat dari bagian terakhir sampai jawaban selesai. Jangan mengulang bagian sebelumnya. Akhiri dengan kalimat lengkap dan maksimal dua paragraf pendek.' },
    ];
    const continuation = await createCompletion({ model, messages: continuationMessages, temperature: 0.2, max_tokens: 1_500 });
    const nextContent = continuation.choices[0].message.content?.trim() || '';
    return nextContent ? `${firstContent.trim()} ${nextContent}` : firstContent;
};

const looksLikeShippingIssue = (text: string) => /\b(ongkir|ongkos kirim|pengiriman|kurir|rajaongkir)\b/i.test(text);

const sanitizeAgentText = (text: string) => sanitizeCustomerLanguage(stripInternalMarkup(text).replace(/\*/g, ''));
const SAFE_CUSTOMER_FALLBACK = 'Maaf Kak, aku belum bisa memastikan rekomendasi yang paling mirip dari katalog. Aku bantu teruskan ke admin ya.';

const enforceCatalogEvidence = async (
    text: string,
    evidence: string,
    model: string,
    createCompletion: (params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming) => Promise<OpenAI.Chat.Completions.ChatCompletion>,
) => {
    const validation = validateClaims(text, evidence);
    if (validation.valid) return text;
    const repaired = await createCompletion({
        model,
        messages: [
            { role: 'system', content: 'Kamu memperbaiki balasan CS. Gunakan Bahasa Indonesia. Jangan menambah fakta atau pilihan produk yang tidak tertulis pada bukti katalog.' },
            { role: 'user', content: `BUKTI KATALOG:\n${evidence.slice(0, 5_000)}\n\nBALASAN YANG SALAH:\n${text}\n\nHapus atau koreksi klaim tanpa bukti berikut: ${validation.unsupportedTypes.join(', ')}. Tulis ulang jawaban customer-facing saja.` },
        ],
        temperature: 0.1,
        max_tokens: 1_000,
    });
    const repairedText = sanitizeAgentText(repaired.choices[0].message.content || '');
    return validateClaims(repairedText, evidence).valid ? repairedText : SAFE_CUSTOMER_FALLBACK;
};

const extractLeadFromPrompt = (text: string) => {
    const phone = text.match(/(?:\+?62|0)\d[\d\s-]{7,16}\d/)?.[0]?.replace(/[^\d+]/g, '');
    const explicitName = text.match(/\b(?:nama|atas nama)\s*:?\s*([A-Za-z][A-Za-z\s.'-]{1,50})(?:\r?\n|$)/i)?.[1]?.trim();
    const keName = text.match(/\bke\s+([A-Za-z][A-Za-z\s.'-]{1,50})(?:\r?\n|$)/i)?.[1]?.trim();
    const name = explicitName || (keName && !/\b(kec\.?|kecamatan|kel\.?|kelurahan|kota|kab\.?|kabupaten|desa|jalan|jl\.?)\b|,/i.test(keName) ? keName : undefined);
    const address = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => /\b(kec\.?|kecamatan|kel\.?|kelurahan|kota|kab\.?|kabupaten|desa|jalan|jl\.?)\b/i.test(line));

    return {
        ...(name ? { name } : {}),
        ...(phone ? { phone } : {}),
        ...(address ? { address } : {}),
    };
};

const checkShippingBeforeHandoff = async (reason: string, prompt: string) => {
    const result = await checkShippingCost(`${reason}\n${prompt}`);
    if (result.includes('Ongkir ke ')) {
        return result;
    }
    return null;
};

// Handler untuk setiap tool call dengan validation (Fase 8: AI Safety)
const handleToolCall = async (
    name: string,
    args: any,
    jid: string,
    prompt: string,
): Promise<{ content: string; handoff?: { reason: string }; orderConfirmed?: { orderId: number; summary: string }; postPaymentHandoff?: { reason: string } }> => {
    // Validate tool arguments with Zod
    const validation = validateToolArguments(name as ToolName, args);
    if (!validation.success) {
        console.error(`❌ Tool validation failed for ${name}:`, validation.error);
        return {
            content: `Parameter tool tidak valid: ${validation.error}. Coba lagi dengan parameter yang benar.`,
        };
    }

    // Use validated data
    const validatedArgs = validation.data!;
    
    switch (name) {
        case 'cekOngkir': {
            console.log('🔧 Tool: cekOngkir untuk kota:', validatedArgs.cityName);
            const result = await checkShippingCost(validatedArgs.cityName);
            return { content: result };
        }
        case 'simpanDataPelanggan': {
            console.log('Tool: simpanDataPelanggan dipanggil (payload disembunyikan).');
            await upsertLead({ jid, ...validatedArgs });
            return { content: 'Data pelanggan berhasil disimpan/diupdate.' };
        }
        case 'simpanDraftPesanan': {
            console.log('Tool: simpanDraftPesanan dipanggil (payload disembunyikan).');
            await setChatState(jid, validatedArgs.stage as ChatStage, validatedArgs);
            await upsertDraftOrder({ jid, ...validatedArgs });
            return { content: 'Draft pesanan berhasil disimpan/diupdate.' };
        }
        case 'konfirmasiPesanan': {
            console.log('Tool: konfirmasiPesanan dipanggil (payload disembunyikan).');
            if (!jid) return { content: 'Gagal konfirmasi: JID customer kosong.' };
            const result = await confirmDraftOrder(jid, validatedArgs.note);
            if (!result.ok) return { content: `Gagal konfirmasi pesanan: ${result.error}` };
            const config = getBusinessConfig();
            const payment = config.paymentInstructions;
            const handoffReason = `Pesanan #${result.order.id} menunggu pembayaran; ringkasan dan instruksi pembayaran sudah dikirim`;
            return {
                content: `Pesanan #${result.order.id} dikunci (awaiting_payment).\n\nRINGKASAN:\n${result.summary}\n\nINSTRUKSI BAYAR:\n${payment}\n\nBalas customer dengan ringkasan + cara bayar. Jangan bilang sudah lunas.`,
                orderConfirmed: { orderId: result.order.id, summary: result.summary },
                ...(config.handoffAfterPaymentSummary ? { postPaymentHandoff: { reason: handoffReason } } : {}),
            };
        }
        case 'cariReferensiProduk': {
            console.log('Tool: cariReferensiProduk dipanggil (query disembunyikan).');
            if (!getBusinessConfig().enableExternalProductLookup) {
                return { content: 'Lookup eksternal nonaktif di Config. Pakai knowledge base toko saja.' };
            }
            const lookup = await lookupProductReference(String(validatedArgs.query || ''), {
                forceExternal: Boolean(validatedArgs.forceExternal),
            });
            console.log(`   lookup source: ${lookup.source}`);
            return { content: lookup.content };
        }
        case 'escalateToHuman': {
            console.log('🔧 Tool: escalateToHuman, alasan:', validatedArgs.reason);
            if (looksLikeShippingIssue(validatedArgs.reason || '')) {
                const shippingResult = await checkShippingBeforeHandoff(validatedArgs.reason || '', prompt);
                if (shippingResult) {
                    return { content: `Eskalasi dibatalkan karena cek ongkir berhasil.\n${shippingResult}` };
                }
            }
            await logHandoff(jid, validatedArgs.reason);
            return { content: 'Eskalasi ke admin berhasil dicatat.', handoff: { reason: validatedArgs.reason } };
        }
        default:
            return { content: `Tool "${name}" tidak dikenali.` };
    }
};

export const askAgent = async (prompt: string, context: string = '', history: ChatMessage[] = [], jid: string = ''): Promise<AgentResult> => {
    console.log('Menghubungi AI dengan model:', process.env.AI_MODEL || 'gemini/gemini-2.5-flash');

    try {
        const businessConfig = getBusinessConfig();

        if (jid) {
            await upsertLead({ jid, ...extractLeadFromPrompt(prompt) });
        }

        if (businessConfig.enableShipping && looksLikeShippingIssue(prompt)) {
            const shippingResult = await checkShippingCost(prompt);
            if (shippingResult.includes('Ongkir ke ')) {
                return { text: sanitizeAgentText(shippingResult) };
            }
        }

        let basePrompt = '';
        const promptPath = path.resolve('config', 'system-prompt.txt');
        if (fs.existsSync(promptPath)) {
            basePrompt = fs.readFileSync(promptPath, 'utf-8');
        } else {
            basePrompt = 'Kamu adalah Customer Service yang ramah dan siap membantu.';
        }

        const productType = businessConfig.productType;
        const checkoutRule = productType === 'digital'
            ? "Karena produk ini bersifat DIGITAL, pada Tahap 2 (Closing) JANGAN meminta alamat rumah/fisik. Cukup minta Nama dan Alamat Email/No WA untuk pengiriman akses/file."
            : "Karena produk ini bersifat FISIK (non-digital), pada Tahap 2 (Closing) WAJIB meminta data pengiriman lengkap (Nama, No HP, Alamat Lengkap) untuk kurir.";

        const adminJid = getAdminJid();
        const handoffInstruction = adminJid
            ? "\n\nESKALASI KE ADMIN: Jika percakapan stuck, di luar knowledge base, atau pelanggan marah/minta bicara manusia, gunakan tool escalateToHuman."
            : "";

        const shippingRule = businessConfig.enableShipping
            ? 'Jika pelanggan memberikan alamat/kecamatan/kelurahan/kota tujuan atau meminta cek ongkir, WAJIB panggil tool cekOngkir pada turn yang sama. Gunakan tujuan paling spesifik, misalnya "Plamongan Sari, Pedurungan, Semarang", bukan hanya "Semarang".'
            : 'Shipping/ongkir nonaktif untuk bisnis ini. Jangan meminta alamat fisik untuk ongkir dan jangan membahas cek ongkir.';
        const orderRule = buildClosingOrderRule(businessConfig);
        const recentHistory = history.slice(-12);
        const retrievalQuery = [...recentHistory.map((message) => message.content), prompt].join('\n');
        const relevantContext = selectRelevantKnowledge(context, retrievalQuery);
        const fullSystemPrompt = `${buildBusinessPrompt()}\n\n${basePrompt}\n\nATURAN PENGIRIMAN (DARI SISTEM):\n${checkoutRule}${handoffInstruction}\n\nPENTING: Setiap kali pelanggan memberikan info (nama, alamat, preferensi, dsb), SELALU panggil tool simpanDataPelanggan.\nSetiap customer memilih produk, varian/opsi, level/kualitas, ukuran/paket, qty, data checkout, atau ongkir, SELALU panggil tool simpanDraftPesanan.\n${shippingRule} Jika pelanggan juga memberikan data diri, panggil simpanDataPelanggan sekaligus.\nJangan minta data checkout sebelum produk/opsi utama (dan field order wajib dari config) cukup jelas. Jangan ringkasan pesanan akhir sebelum checkout lengkap.\n${orderRule}\n\nKNOWLEDGE RELEVAN (KATALOG / FAQ PRODUK):\n${relevantContext || 'Belum ada data katalog yang relevan.'}`;

        const messages: any[] = [
            { role: 'system', content: fullSystemPrompt },
            ...recentHistory.map(m => ({ role: m.role, content: m.content.slice(0, 4_000) })),
            { role: 'user', content: prompt }
        ];

        const model = process.env.AI_MODEL || 'gemini/gemini-2.5-flash';
        let handoffResult: { reason: string } | undefined;
        let orderConfirmed: { orderId: number; summary: string } | undefined;
        let postPaymentHandoff: { reason: string } | undefined;
        let directShippingResult: string | undefined;

        // Tool call loop — max 5 round-trips
        for (let i = 0; i < 5; i++) {
            const response = await createCompatibleCompletion(openai, {
                model,
                messages,
                temperature: 0.7,
                tools: getTools(),
                tool_choice: 'auto',
                max_tokens: 600,
            });

            const msg = response.choices[0].message;

            if (!msg.tool_calls || msg.tool_calls.length === 0) {
                return { text: sanitizeAgentText(msg.content || 'Maaf, saya tidak bisa membalas saat ini.'), handoff: handoffResult, orderConfirmed, postPaymentHandoff };
            }

            // Ada tool calls — proses semua
            messages.push(cleanAssistantMessage(msg));
            for (const tc of msg.tool_calls) {
                if (tc.type !== 'function') continue;
                const args = JSON.parse(tc.function.arguments);
                const result = await handleToolCall(tc.function.name, args, jid, prompt);
                if (result.handoff) handoffResult = result.handoff;
                if (result.orderConfirmed) orderConfirmed = result.orderConfirmed;
                if (result.postPaymentHandoff) postPaymentHandoff = result.postPaymentHandoff;
                if (result.content.includes('Ongkir ke ')) {
                    directShippingResult = result.content.replace('Eskalasi dibatalkan karena cek ongkir berhasil.\n', '');
                }
                messages.push({ tool_call_id: tc.id, role: 'tool' as const, content: result.content });
            }
            if (directShippingResult) {
                return { text: sanitizeAgentText(directShippingResult), orderConfirmed, postPaymentHandoff };
            }
        }

        // Fallback jika loop habis
        const final = await createCompatibleCompletion(openai, { model, messages, temperature: 0.7, max_tokens: 600 });
        return { text: sanitizeAgentText(final.choices[0].message.content || 'Maaf, saya tidak bisa membalas saat ini.'), handoff: handoffResult, orderConfirmed, postPaymentHandoff };
    } catch (error) {
        console.error('❌ Error saat menghubungi AI:', error);
        return { text: 'Maaf, terjadi kesalahan pada sistem AI kami.' };
    }
};

export const previewAgentReply = async (prompt: string, context: string = '', history: ChatMessage[] = []) => {
    const apiKey = process.env.AI_API_KEY || process.env.OPENROUTER_API_KEY || '';
    const baseURL = process.env.AI_API_BASE_URL || 'http://localhost:20128/v1';
    if (!apiKey) throw new Error('API key AI belum diisi. Buka Koneksi Sistem untuk menghubungkan AI.');
    const previewClient = new OpenAI({
        baseURL,
        apiKey,
        timeout: 75_000,
        maxRetries: 0,
        defaultHeaders: {
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'Voidlark Reply Simulator',
        },
    });
    const businessConfig = getBusinessConfig();
    const basePrompt = fs.existsSync(path.resolve('config', 'system-prompt.txt'))
        ? fs.readFileSync(path.resolve('config', 'system-prompt.txt'), 'utf-8')
        : 'Kamu adalah Customer Service yang ramah dan siap membantu.';
    const retrievalQuery = [...history.map((message) => message.content), prompt].join('\n');
    const { text: relevantContext, citations } = selectRelevantKnowledge(context, retrievalQuery, 5_000);
    const productDomain = resolveProductDomain(basePrompt, relevantContext);
    const externalLookupQuery = businessConfig.enableExternalProductLookup
        ? resolveExternalLookupQuery(prompt, history)
        : null;
    const externalReference = externalLookupQuery
        ? await lookupProductReference(buildExternalSearchQuery(externalLookupQuery, productDomain), { forceExternal: true })
        : null;
    const compactExternalReference = externalReference?.content.slice(0, 4_500) || 'Tidak diperlukan pada turn ini.';
    const domainMatcher = selectDomainMatcher(productDomain, await loadCatalogSchemaRows());
    const domainMatch = await domainMatcher.match(externalReference?.content || '');
    const externalSafeFallback = externalReference && externalLookupQuery
        ? buildExternalLookupFallback(externalLookupQuery, externalReference.content, businessConfig.businessName)
        : SAFE_CUSTOMER_FALLBACK;
    const domainPolicy = `STRATEGI DOMAIN AKTIF (${domainMatcher.id}):\n${domainMatch.policy}`;
    const systemPrompt = `${buildBusinessPrompt()}\n\n${basePrompt}\n\nCORE OUTPUT POLICY:\nGunakan Bahasa Indonesia natural saja. Jangan gunakan aksara China. Jangan pernah menampilkan DSML, XML, environment_details, JSON tool call, workspace path, metadata sistem, atau proses berpikir kepada customer. Jika referensi web sudah tersedia, jangan panggil tool pencarian lagi. Jangan menciptakan produk, pilihan, spesifikasi, harga, atau ketersediaan yang tidak ada pada evidence.\n\n${domainPolicy}\n\nMODE PREVIEW ADMIN:\nJangan menyimpan data, draft, pesanan, atau handoff. Jawab sebagai simulasi percakapan saja. WAJIB baca seluruh RIWAYAT CHAT yang diberikan. Jangan mengulang sapaan/perkenalan setelah turn pertama. Jangan menanyakan ulang konteks yang sudah disebut customer. Saat customer memakai rujukan seperti "yang paling mirip", hubungkan dengan topik pada riwayat terdekat. Jangan langsung handoff jika evidence cukup untuk memberi jawaban berguna.\nShipping ${businessConfig.enableShipping ? 'aktif' : 'nonaktif'}.\n\nDOMAIN AKTIF: ${domainMatcher.id}\n\nREFERENSI WEB TERVERIFIKASI:\n${compactExternalReference}\n\nPROFIL DOMAIN TERVERIFIKASI:\n${domainMatch.profileEvidence}\n\nKANDIDAT KATALOG TERVERIFIKASI:\n${domainMatch.candidateEvidence}\n\nKNOWLEDGE RELEVAN:\n${relevantContext || 'Belum ada data katalog yang relevan.'}`;
    const model = process.env.AI_MODEL || 'gemini/gemini-2.5-flash';
    const messages: any[] = [
        { role: 'system', content: systemPrompt },
        ...history.map((message) => ({ role: message.role, content: message.content.slice(0, 4_000) })),
        { role: 'user', content: prompt },
    ];
    const usedTools: string[] = [];
    if (externalReference) usedTools.push(`external:${externalReference.source}`);
    const createCompletion = async (params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming): Promise<OpenAI.Chat.Completions.ChatCompletion> => {
        try {
            return await createCompatibleCompletion(previewClient, params);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (isContextLimitError(message)) {
                const compactMessages = params.messages.map((entry, index) => {
                    if (index !== 0 || entry.role !== 'system' || typeof entry.content !== 'string') return entry;
                    const marker = '\n\nKNOWLEDGE RELEVAN:\n';
                    const markerIndex = entry.content.indexOf(marker);
                    if (markerIndex < 0) return { ...entry, content: entry.content.slice(0, 12_000) };
                    return { ...entry, content: `${entry.content.slice(0, markerIndex)}${marker}${entry.content.slice(markerIndex + marker.length, markerIndex + marker.length + 2_500)}` };
                });
                return createCompatibleCompletion(previewClient, { ...params, messages: compactMessages, max_tokens: 500 });
            }
            if (!isTransientAiError(error)) throw error;
            console.warn('Preview AI transient error, retrying once:', message);
            return withTransientRetry(() => createCompatibleCompletion(previewClient, params), {
                maxAttempts: 2,
                delayMs: 800,
                isTransient: isTransientAiError,
            });
        }
    };

    for (let round = 0; round < 3; round++) {
        const response = await createCompletion({
            model,
            messages,
            temperature: 0.7,
            tools: externalReference ? undefined : getPreviewTools(),
            tool_choice: externalReference ? undefined : 'auto',
            max_tokens: 600,
        });
        const message = response.choices[0].message;
        const textToolCalls = message.content ? parseTextToolCalls(message.content) : [];
        if (!message.tool_calls?.length && textToolCalls.length) {
            messages.push({ role: 'assistant', content: 'Aku akan memeriksa referensi produk yang relevan.' });
            for (const textToolCall of textToolCalls) {
                usedTools.push(textToolCall.name);
                let content = 'Tool tidak tersedia dalam mode preview.';
                if (textToolCall.name === 'cekOngkir') content = await checkShippingCost(String(textToolCall.arguments.cityName || ''));
                if (textToolCall.name === 'cariReferensiProduk') {
                    content = (await lookupProductReference(String(textToolCall.arguments.query || ''), { forceExternal: Boolean(textToolCall.arguments.forceExternal) })).content;
                }
                messages.push({ role: 'user', content: `HASIL TOOL ${textToolCall.name}:\n${content}\n\nSusun jawaban final untuk customer. Jangan tampilkan markup tool, XML, DSML, JSON, atau proses berpikir.` });
            }
            continue;
        }
        if (!message.tool_calls?.length && message.content && containsInternalMarkup(message.content)) {
            const cleaned = stripInternalMarkup(message.content);
            if (cleaned) {
                const text = sanitizeAgentText(cleaned);
                return { text, plan: buildResponsePlan(text), usedTools, citations };
            }
            messages.push({ role: 'user', content: 'Markup internal tidak boleh dikirim ke customer. Berikan jawaban final Bahasa Indonesia saja, tanpa DSML, XML, environment details, JSON, atau proses berpikir.' });
            continue;
        }
        if (!message.tool_calls?.length) {
            if (message.content?.trim()) {
                const completeContent = await appendCompletion(createCompletion, model, messages, response);
                const text = sanitizeAgentText(completeContent);
                if (containsUnexpectedCjk(completeContent)) {
                    messages.push({ role: 'assistant', content: text });
                    messages.push({ role: 'user', content: 'Tulis ulang jawaban terakhir sepenuhnya dalam Bahasa Indonesia natural. Jangan gunakan aksara China, bahasa asing yang tidak perlu, markup internal, atau proses berpikir.' });
                    const repaired = await createCompletion({ model, messages: messages.slice(-6), temperature: 0.2, max_tokens: 1_200 });
                    const repairedText = sanitizeAgentText(repaired.choices[0].message.content || text);
                    const guardedText = await enforceCatalogEvidence(repairedText, relevantContext, model, createCompletion);
                    return { text: guardedText, plan: buildResponsePlan(guardedText), usedTools, citations };
                }
                const guardedText = await enforceCatalogEvidence(text, relevantContext, model, createCompletion);
                return { text: guardedText, plan: buildResponsePlan(guardedText), usedTools, citations };
            }
            const compactMessages = messages.slice(-4);
            const systemMessage = messages[0];
            if (systemMessage?.role === 'system' && typeof systemMessage.content === 'string') {
                const marker = '\n\nKNOWLEDGE RELEVAN:\n';
                const markerIndex = systemMessage.content.indexOf(marker);
                const compactSystem = markerIndex < 0
                    ? systemMessage.content.slice(0, 10_000)
                    : `${systemMessage.content.slice(0, markerIndex)}${marker}${systemMessage.content.slice(markerIndex + marker.length, markerIndex + marker.length + 2_500)}`;
                compactMessages.unshift({ role: 'system', content: compactSystem });
            }
            compactMessages.push({ role: 'user', content: 'Berikan jawaban final singkat untuk pesan customer terakhir. Tulis hanya jawaban yang akan dikirim, tanpa proses berpikir.' });
            const retry = await createCompletion({ model, messages: compactMessages, temperature: 0.2, max_tokens: 2_500 });
            const text = sanitizeAgentText(retry.choices[0].message.content || '') || externalSafeFallback;
            const guardedText = await enforceCatalogEvidence(text, relevantContext, model, createCompletion);
            return { text: guardedText, plan: buildResponsePlan(guardedText), usedTools, citations };
        }
        messages.push(cleanAssistantMessage(message));
        for (const toolCall of message.tool_calls) {
            if (toolCall.type !== 'function') continue;
            const args = parseToolArguments(toolCall.function.arguments);
            usedTools.push(toolCall.function.name);
            let content = 'Tool tidak tersedia dalam mode preview.';
            if (toolCall.function.name === 'cekOngkir') content = await checkShippingCost(String(args.cityName || ''));
            if (toolCall.function.name === 'cariReferensiProduk') {
                content = (await lookupProductReference(String(args.query || ''), { forceExternal: Boolean(args.forceExternal) })).content;
            }
            messages.push({ tool_call_id: toolCall.id, role: 'tool', content });
        }
    }
    const fallback = await createCompletion({ model, messages, temperature: 0.7, max_tokens: 600 });
    const text = sanitizeAgentText(fallback.choices[0].message.content || '') || externalSafeFallback;
    const guardedText = await enforceCatalogEvidence(text, relevantContext, model, createCompletion);
    return { text: guardedText, plan: buildResponsePlan(guardedText), usedTools };
};
