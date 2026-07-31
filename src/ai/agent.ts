import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { operationalMetrics } from '../operations/metrics.js';
import dotenv from 'dotenv';
import { checkShippingCost } from '../api/rajaongkir.js';
import { upsertLead } from '../chat/leads.js';
import { logHandoff, getAdminJid } from '../chat/handoff.js';
import { clearDraftProductName, getChatState, setChatState, upsertDraftOrder, confirmDraftOrder, type ChatStage } from '../chat/orders.js';
import { buildBusinessPrompt, getBusinessConfig } from '../config/business.js';
import { lookupProductReference } from './external-lookup.js';
import { buildResponsePlan } from './response-plan.js';
import { applyCustomerReplyStyle } from './reply-style-boundary.js';
import { containsInternalMarkup, parseTextToolCalls, parseToolArguments, stripInternalMarkup } from './tool-markup.js';
import { containsUnexpectedCjk, sanitizeCustomerLanguage } from './language-guard.js';
import { resolveExternalLookupQuery } from './lookup-routing.js';
import { buildExternalLookupFallback } from './external-fallback.js';
import { buildCatalogFragranceDetailReply, buildCatalogFragranceRelationReply, buildCatalogFragranceSuitabilityReply, buildExternalFragranceIntroductionReply, buildVerifiedExternalFragranceMatch, buildVerifiedFragranceConsultationReply, buildVerifiedFragranceRecommendation, loadCatalogSchemaRows, resolveCatalogFragranceProduct, selectFragranceBudgetOption } from './catalog-matcher.js';
import { buildExternalSearchQuery, resolveProductDomain } from './product-domain.js';
import { selectDomainMatcher } from './domain-matchers.js';
import { removeUnsupportedClaimSentences, validateClaims } from './claim-validator.js';
import { retrieveKnowledge } from './knowledge.js';
import { withTransientRetry } from '../operations/retry.js';
import { validateToolArguments, type ToolName } from './tool-validation.js';
import { getCircuitBreaker } from './circuit-breaker.js';
import { getTokenLimiter, estimateTokenCount } from './token-limiter.js';
import { buildCatalogBudgetContext, buildCatalogClassificationReply, buildCatalogComparisonAdvice, buildCatalogEvidence, buildCatalogSelectionAcknowledgement, buildDeterministicPriceReply, hasCatalogSelectionLanguage, inferCatalogOfferFromText, inferCatalogOrdinalReference, inferCatalogPartialSelectionFromText, inferCatalogRecommendationFromText, inferCatalogSelectionUpdateFromText, inferLatestCatalogClassificationFromText, inferOrdinalProductName, isCatalogVariationValue, parseCatalogBudget, resolveCatalogOffer } from '../catalog/product-catalog.js';
import { annotateShippingDeadline, buildCheckoutSafeFallback, buildConsultationPolicy, buildPersistedConversationState, buildPreviewStateEvidence, buildRecommendationConfirmationReply, buildUnsupportedDurabilityReply, buildUnsupportedSafetyReply, buildUnsupportedStockNote, enforceSingleQuestion, mergePreviewState, normalizePreviewState, requestsHumanHandoff, type PreviewConversationState } from './conversation-policy.js';
import { formatWhatsAppReply } from './whatsapp-format.js';

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
        return `CLOSING ORDER: Saat customer setuju order final (${checkoutScope}), WAJIB panggil tool konfirmasiPesanan. Lalu balas ringkasan pesanan saja dan beri tahu bahwa admin akan melanjutkan. Jangan kirim instruksi pembayaran. Sistem membuat handoff hanya setelah ringkasan berhasil dikirim. Jangan bilang lunas sebelum status paid.`;
    }
    if (!config.paymentInstructions.trim()) return `CLOSING ORDER: Saat customer setuju order final (${checkoutScope}), WAJIB panggil tool konfirmasiPesanan. Balas ringkasan pesanan saja. Instruksi pembayaran belum diatur; jangan membuat cara bayar sendiri. Jangan bilang lunas sebelum status paid.`;
    return `CLOSING ORDER: Saat customer setuju order final (${checkoutScope}), WAJIB panggil tool konfirmasiPesanan. Lalu balas ringkasan pesanan dan instruksi pembayaran: ${config.paymentInstructions}. Jangan bilang lunas sebelum status paid.`;
};

export const buildOrderConfirmationInstruction = (config: ClosingOrderConfig) => config.handoffAfterPaymentSummary
    ? 'Balas customer dengan ringkasan saja dan beri tahu bahwa admin akan melanjutkan. Jangan tampilkan instruksi pembayaran.'
    : config.paymentInstructions.trim()
        ? `INSTRUKSI BAYAR:\n${config.paymentInstructions}\n\nBalas customer dengan ringkasan + cara bayar. Jangan bilang sudah lunas.`
        : 'Balas customer dengan ringkasan pesanan saja. Instruksi pembayaran belum diatur; jangan membuat cara bayar sendiri. Jangan bilang sudah lunas.';

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
            description: 'WAJIB gunakan tool ini jika pembeli meminta ongkir atau memberikan tujuan pengiriman. Kirim tujuan secara bersih dan sertakan kelompok, seluruh atribut variasi, serta jumlah yang sudah dipilih agar berat diambil dari Produk & Harga.',
            parameters: {
                type: 'object',
                properties: {
                    cityName: { type: 'string', description: 'Tujuan pengiriman saja. Boleh kota, kecamatan, kelurahan, atau alamat lengkap.' },
                    classification: { type: 'string', description: 'Nama kelompok atau klasifikasi harga produk jika sudah diketahui' },
                    attributes: { type: 'object', additionalProperties: { type: 'string' }, description: 'Seluruh pilihan variasi berdasarkan nama atribut, contoh {"Ukuran":"30ml","Tingkat aroma":"Premium"}' },
                    quality: { type: 'string', description: 'Kualitas produk yang dipilih jika sudah diketahui' },
                    sizeMl: { type: 'number', description: 'Ukuran produk yang dipilih jika sudah diketahui' },
                    quantity: { type: 'number', description: 'Jumlah produk, default 1' }
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

const getTools = (options: { allowExternalLookup?: boolean; allowHandoff?: boolean } = {}) => {
    const config = getBusinessConfig();
    return ALL_TOOLS.filter((tool) => {
        if (tool.type !== 'function') return true;
        if (tool.function.name === 'cekOngkir' && !config.enableShipping) return false;
        if (tool.function.name === 'cariReferensiProduk' && (!config.enableExternalProductLookup || !options.allowExternalLookup)) return false;
        if (tool.function.name === 'escalateToHuman' && !options.allowHandoff) return false;
        return true;
    });
};

const getPreviewTools = (options: { allowExternalLookup?: boolean; allowHandoff?: boolean } = {}) => getTools(options).filter((tool) => tool.type !== 'function' || [
    'cekOngkir',
    'cariReferensiProduk',
    'simpanDataPelanggan',
    'simpanDraftPesanan',
    'escalateToHuman',
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

const sanitizeAgentText = (text: string) => enforceSingleQuestion(formatWhatsAppReply(sanitizeCustomerLanguage(stripInternalMarkup(text).replace(/\*/g, ''))
    .replace(/Rp\s*(\d+)\.\s+(\d{3})\b/g, 'Rp$1.$2')
    .replace(/Rp\s*(\d+)\.\s*\n+\s*(\d{3})\b/g, 'Rp$1.$2')));
export const isInternalRepairText = (text: string) => /^(?:customer\b|harga\s+(?:belum|sudah)|variasi\s+(?:belum|sudah)|rekomendasi:|balasan:|hapus|koreksi|perbaiki|hilangkan|klaim|balasan\s+(?:yang\s+)?salah|unsupported(?:\s+types?)?|tidak ada bukti|bukti katalog|customer-facing)\b/i.test(text.trim())
    || /\b(?:unsupportedTypes|validateClaims|system prompt|proses berpikir|instruksi internal|\[sebut\b|balasan awal tidak disertakan|balasan cs yang ingin diperbaiki|tidak bisa memproses permintaan ini)\b/i.test(text);
const SAFE_CUSTOMER_FALLBACK = 'Maaf Kak, aku belum bisa memastikan rekomendasi yang paling mirip dari katalog. Aku bantu teruskan ke admin ya.';
const externalReferenceTokens = (value: string) => normalizeSearchText(value).split(' ').filter((token) => token.length >= 4 && !STOP_WORDS.has(token));
export const containsExternalProductCommerceClaim = (text: string, externalProduct: string) => {
    const tokens = externalReferenceTokens(externalProduct);
    if (!tokens.length) return false;
    return text.split(/(?<=[.!?])\s+|\n+/).some((sentence) => {
        const normalized = normalizeSearchText(sentence);
        return tokens.some((token) => normalized.includes(token))
            && /\b(?:kami punya|tersedia|ready|stok|harga|rp\s*\d|ambil|beli|checkout|pesan|ukuran|kualitas|varian)\b/i.test(sentence);
    });
};
const verifiedInternalCandidateNames = (evidence: string) => [...evidence.matchAll(/Produk internal yang boleh direkomendasikan dan dijual:\s*([^|\n]+)/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);
export const containsUnverifiedExternalRecommendation = (text: string, internalCandidateEvidence: string) => {
    if (!/\b(?:rekomendasi|kandidat|alternatif|padanan|paling (?:mirip|mendekati|cocok)|produk (?:kami|internal)|di toko kami|kami punya|tersedia|ready|ambil|beli|checkout|pesan|harga|variasi|ukuran|paket|kualitas)\b/i.test(text)) return false;
    const candidates = verifiedInternalCandidateNames(internalCandidateEvidence);
    if (!candidates.length) return true;
    const normalizedText = normalizeSearchText(text);
    return !candidates.some((candidate) => normalizedText.includes(normalizeSearchText(candidate)));
};

const enforceExternalReferenceBoundary = async (
    text: string,
    externalProduct: string | null,
    internalCandidateEvidence: string,
    model: string,
    completion: (params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming) => Promise<OpenAI.Chat.Completions.ChatCompletion>,
    fallback: string,
) => {
    if (!externalProduct || (!containsExternalProductCommerceClaim(text, externalProduct) && !containsUnverifiedExternalRecommendation(text, internalCandidateEvidence))) return text;
    const response = await completion({
        model,
        temperature: 0.1,
        max_tokens: 600,
        messages: [
            { role: 'system', content: 'Perbaiki balasan CS. Produk referensi luar hanya boleh dijelaskan sebagai pembanding dan tidak boleh ditawarkan, diberi harga, atau dimasukkan ke transaksi. Rekomendasikan hanya produk internal yang tercantum pada kandidat internal. Jika kandidat internal kosong, jujur belum menemukan alternatif. Pertahankan fakta lain dan gunakan Bahasa Indonesia natural.' },
            { role: 'user', content: `PRODUK REFERENSI LUAR:\n${externalProduct}\n\nKANDIDAT INTERNAL TERVERIFIKASI:\n${internalCandidateEvidence}\n\nBALASAN YANG HARUS DIPERBAIKI:\n${text}` },
        ],
    });
    const repaired = sanitizeAgentText(response.choices[0].message.content || '');
    return repaired
        && !containsExternalProductCommerceClaim(repaired, externalProduct)
        && !containsUnverifiedExternalRecommendation(repaired, internalCandidateEvidence)
        ? repaired
        : fallback;
};
const evidenceFallback = (unsupportedTypes: string[], answer = '', evidence = '') => {
    const structured = evidence.match(/KELOMPOK HARGA TERSTRUKTUR[\s\S]*?\nATURAN:/i)?.[0] || '';
    const variationValues = [...structured.matchAll(/Variasi:[^\n]+/gi)]
        .flatMap((match) => [...match[0].matchAll(/\[([^\]]+)\]/g)].flatMap((values) => values[1].split(',').map((value) => value.trim())))
        .filter((value) => value && answer.toLowerCase().includes(value.toLowerCase()));
    const groups = [...structured.matchAll(/^Kelompok ([^;\n]+)/gim)].map((match) => match[1].trim())
        .filter((value) => answer.toLowerCase().includes(value.toLowerCase()));
    const mentioned = [...new Set(variationValues.length >= 2 ? variationValues : groups.length >= 2 ? groups : [])];
    if (mentioned.length >= 2 && unsupportedTypes.some((type) => ['duration', 'usage', 'comparison'].includes(type))) {
        return `Aku bantu, Kak. Supaya pilihannya nggak asal, ceritakan dulu kebutuhan pemakaian, karakter yang disukai, dan budgetnya. Setelah itu aku pilihkan satu opsi dari katalog yang paling sesuai, lengkap dengan alasan dan harga yang tersedia.`;
    }
    return unsupportedTypes.includes('price')
    ? 'Maaf Kak, harga produk itu belum tercantum pada katalog yang aku pegang. Aku bantu konfirmasi ke admin dulu ya.'
    : unsupportedTypes.includes('duration')
        ? 'Maaf Kak, data durasi pemakaian belum tercantum di informasi produk. Hasil aktual juga dapat berbeda tergantung kondisi dan cara penggunaan.'
        : SAFE_CUSTOMER_FALLBACK;
};

const enforceCatalogEvidence = async (
    text: string,
    evidence: string,
    model: string,
    createCompletion: (params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming) => Promise<OpenAI.Chat.Completions.ChatCompletion>,
    verifiedPriceFallback?: string,
) => {
    const validation = validateClaims(text, evidence);
    const brokenCustomerText = /\batau(?:\s+yang)?\s*\?|\b(?:dan|tapi|karena|atau)\s*[.!?]?\s*$|\baku tunggu\s*$/i.test(text.trim());
    if (validation.valid && !brokenCustomerText) return text;
    const withoutUnsupportedSentences = removeUnsupportedClaimSentences(text, evidence);
    const readableCleanup = !/(?:^|\n)[^\n]{1,60}\s[—–-]\s*(?:[,.!?])?(?:\n|$)|\b(?:bisa|dapat|karena|dan|serta|dengan)\s*[,.;]/im.test(withoutUnsupportedSentences);
    const safeToTrimPhrases = validation.unsupportedTypes.every((type) => type === 'stock');
    if (safeToTrimPhrases && withoutUnsupportedSentences && withoutUnsupportedSentences !== text && readableCleanup && validateClaims(withoutUnsupportedSentences, evidence).valid) {
        return sanitizeAgentText(withoutUnsupportedSentences);
    }
    let repairedText = '';
    for (let attempt = 0; attempt < 2; attempt++) {
        const repaired = await createCompletion({
            model,
            messages: [
                { role: 'system', content: 'Kamu memperbaiki balasan CS. Gunakan Bahasa Indonesia natural dan kalimat lengkap. Pertahankan fakta yang didukung bukti serta format daftar. Hapus klaim tanpa bukti. Jangan menambah fakta, harga, berat, manfaat, bonus, ketersediaan, atau pilihan produk yang tidak ada pada balasan awal.' },
                { role: 'user', content: `BUKTI KATALOG:\n${evidence.slice(0, 5_000)}\n\nBALASAN AWAL:\n${text}\n\n${attempt ? `HASIL SEBELUMNYA MASIH SALAH:\n${repairedText}\n\n` : ''}Hapus atau koreksi klaim tanpa bukti berikut: ${validation.unsupportedTypes.join(', ') || 'tidak ada; rapikan kalimat yang terpotong'}. Tulis ulang jawaban customer-facing saja. Jangan tambahkan nominal harga atau berat jika balasan awal tidak memuatnya.` },
            ],
            temperature: 0.1,
            max_tokens: 1_000,
        });
        repairedText = sanitizeAgentText(repaired.choices[0].message.content || '');
        const addedPrice = !/(?:rp\s*\d|\d+\s*(?:ribu|rb|juta|jt))/i.test(text) && /(?:rp\s*\d|\d+\s*(?:ribu|rb|juta|jt))/i.test(repairedText);
        const addedWeight = !/\b\d+\s*(?:g|kg)\b/i.test(text) && /\b\d+\s*(?:g|kg)\b/i.test(repairedText);
        if (repairedText && !addedPrice && !addedWeight && !isInternalRepairText(repairedText) && validateClaims(repairedText, evidence).valid) return repairedText;
    }
    // Model kadang mengulang instruksi validator sebagai jawaban. Jangan kirim metadata internal.
    const fallback = validation.unsupportedTypes.includes('price') && verifiedPriceFallback
        ? verifiedPriceFallback
        : evidenceFallback(validation.unsupportedTypes, text, evidence);
    if (!repairedText || isInternalRepairText(repairedText)) return fallback;
    return fallback;
};

const extractLeadFromPrompt = (text: string) => {
    const phoneMatch = text.match(/(?:\+?62|0)\d[\d\s-]{7,16}\d/);
    const phone = phoneMatch?.[0]?.replace(/[^\d+]/g, '');
    const explicitName = text.match(/\b(?:nama|atas nama)\s*:?\s*([A-Za-z][A-Za-z\s.'-]{1,50}?)(?=\s*[,;]?\s*(?:\+?62|0)\d|\r?\n|$)/i)?.[1]?.trim();
    const checkoutName = phoneMatch?.index !== undefined
        ? text.slice(0, phoneMatch.index).match(/(?:bungkus|ambil|pesan|order)(?:\s+\w+){0,3}[.,]?\s+([A-Za-z][A-Za-z.'-]{1,30})\s*$/i)?.[1]
        : undefined;
    const keName = text.match(/\bke\s+([A-Za-z][A-Za-z\s.'-]{1,50})(?:\r?\n|$)/i)?.[1]?.trim();
    const name = explicitName || checkoutName || (keName && !/\b(kec\.?|kecamatan|kel\.?|kelurahan|kota|kab\.?|kabupaten|desa|jalan|jl\.?)\b|,/i.test(keName) ? keName : undefined);
    const lineAddress = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => /\b(kec\.?|kecamatan|kel\.?|kelurahan|kota|kab\.?|kabupaten|desa|jalan|jl\.?)\b/i.test(line));
    const inlineAddress = phoneMatch?.index !== undefined
        ? text.slice(phoneMatch.index + phoneMatch[0].length).replace(/^[\s,;.-]+/, '').trim()
        : '';
    const address = (lineAddress || (inlineAddress.length >= 4 ? inlineAddress : undefined))?.replace(/^kirim\s+ke\s+/i, '').trim();

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
            const currentState = jid ? await getChatState(jid) : { stage: 'consulting', data: {} };
            const currentData = currentState.data as Record<string, unknown>;
            const checkoutOffer = resolveCatalogOffer({
                classification: String(currentData.variant || currentData.classification || validatedArgs.classification || ''),
                attributes: (currentData.options || currentData.attributes || validatedArgs.attributes || {}) as Record<string, string>,
                quantity: Number(currentData.quantity || validatedArgs.quantity) || 1,
            });
            if (!String(currentData.productName || currentData.aroma || '').trim() || !checkoutOffer.valid) {
                return { content: 'Ongkir belum boleh dihitung. Pastikan nama produk dan seluruh variasi katalog sudah dipilih customer terlebih dahulu.' };
            }
            console.log('🔧 Tool: cekOngkir untuk kota:', validatedArgs.cityName);
            const weightContext = [validatedArgs.quantity && validatedArgs.quantity > 1 ? `${validatedArgs.quantity}x` : '', validatedArgs.classification, ...Object.values(validatedArgs.attributes || {}), validatedArgs.quality, validatedArgs.sizeMl ? `${validatedArgs.sizeMl}ml` : ''].filter(Boolean).join(' ');
            const result = await checkShippingCost(validatedArgs.cityName, weightContext || validatedArgs.cityName);
            return { content: result };
        }
        case 'simpanDataPelanggan': {
            console.log('Tool: simpanDataPelanggan dipanggil (payload disembunyikan).');
            await upsertLead({ jid, ...validatedArgs });
            return { content: 'Data pelanggan berhasil disimpan/diupdate.' };
        }
        case 'simpanDraftPesanan': {
            console.log('Tool: simpanDraftPesanan dipanggil (payload disembunyikan).');
            const mayChangeSelection = hasCatalogSelectionLanguage(prompt) || Boolean(inferCatalogOfferFromText(prompt));
            const safeArgs = mayChangeSelection ? validatedArgs : {
                stage: validatedArgs.stage,
                customerName: validatedArgs.customerName,
                phone: validatedArgs.phone,
                address: validatedArgs.address,
            };
            const requestedProductName = String(safeArgs.productName || safeArgs.aroma || '').trim();
            const currentState = jid ? await getChatState(jid) : { stage: 'consulting', data: {} };
            const currentData = currentState.data as Record<string, unknown>;
            const trustedNames = [currentData.productName, currentData.aroma, currentData.recommendedProductName]
                .map((value) => normalizeSearchText(String(value || '')))
                .filter(Boolean);
            const normalizedRequestedProduct = normalizeSearchText(requestedProductName);
            const productName = requestedProductName && (normalizeSearchText(prompt).includes(normalizedRequestedProduct) || trustedNames.includes(normalizedRequestedProduct))
                ? requestedProductName
                : undefined;
            const selectedAttributes = safeArgs.options && typeof safeArgs.options === 'object'
                ? Object.fromEntries(Object.entries(validatedArgs.options).map(([key, value]) => [key, String(value)]))
                : undefined;
            const offer = selectedAttributes || safeArgs.quality || safeArgs.sizeMl
                ? resolveCatalogOffer({ classification: safeArgs.variant, attributes: selectedAttributes, quality: safeArgs.quality, sizeMl: safeArgs.sizeMl, quantity: safeArgs.quantity })
                : null;
            const lockedArgs = offer?.valid
                ? { ...safeArgs, productName, aroma: undefined, productPrice: offer.unitPrice }
                : { ...safeArgs, productName, aroma: undefined };
            await setChatState(jid, lockedArgs.stage as ChatStage, lockedArgs);
            await upsertDraftOrder({ jid, ...lockedArgs });
            return { content: offer?.valid ? `Draft pesanan disimpan. Harga katalog terkunci Rp${offer.unitPrice.toLocaleString('id-ID')}.` : 'Draft pesanan berhasil disimpan/diupdate.' };
        }
        case 'konfirmasiPesanan': {
            console.log('Tool: konfirmasiPesanan dipanggil (payload disembunyikan).');
            if (!jid) return { content: 'Gagal konfirmasi: JID customer kosong.' };
            const result = await confirmDraftOrder(jid, validatedArgs.note);
            if (!result.ok) return { content: `Gagal konfirmasi pesanan: ${result.error}` };
            const config = getBusinessConfig();
            const payment = config.paymentInstructions;
            const handoffReason = `Pesanan #${result.order.id} menunggu pembayaran; ringkasan sudah dikirim dan pembayaran perlu dilanjutkan admin`;
            const completionInstruction = buildOrderConfirmationInstruction({ ...config, paymentInstructions: payment });
            return {
                content: `Pesanan #${result.order.id} dikunci (awaiting_payment).\n\nRINGKASAN:\n${result.summary}\n\n${completionInstruction}`,
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

const askAgentRaw = async (prompt: string, context: string = '', history: ChatMessage[] = [], jid: string = '', csNameOverride?: string, persisted?: { chatState?: unknown; draftOrder?: unknown }): Promise<AgentResult> => {
    console.log('Menghubungi AI dengan model:', process.env.AI_MODEL || 'gemini/gemini-2.5-flash');

    try {
        const businessConfig = getBusinessConfig();
        let liveState = buildPersistedConversationState(persisted?.chatState, persisted?.draftOrder);
        const latestBudget = parseCatalogBudget(prompt);
        if (latestBudget) {
            liveState = { ...liveState, maxBudget: latestBudget };
            if (jid) await setChatState(jid, (liveState.stage || 'consulting') as ChatStage, { maxBudget: latestBudget });
        }
        const latestPartialSelection = inferCatalogPartialSelectionFromText(prompt);
        if (latestPartialSelection) liveState = {
            ...liveState,
            classification: latestPartialSelection.classification,
            attributes: { ...(liveState.classification === latestPartialSelection.classification ? liveState.attributes : {}), ...latestPartialSelection.attributes },
        };

        if (jid) {
            await upsertLead({ jid, ...extractLeadFromPrompt(prompt) });
        }

        if (businessConfig.enableShipping && looksLikeShippingIssue(prompt)) {
            const weightContext = [liveState.quantity && liveState.quantity > 1 ? `${liveState.quantity}x` : '', liveState.classification, ...Object.values(liveState.attributes || {})].filter(Boolean).join(' ');
            const shippingResult = await checkShippingCost(prompt, weightContext || prompt);
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
        if (adminJid && jid && requestsHumanHandoff(prompt)) {
            const reason = `Customer meminta admin: ${prompt.slice(0, 300)}`;
            await logHandoff(jid, reason, /\b(?:marah|kecewa|komplain|tukar|refund)\b/i.test(prompt) ? 'high' : 'normal');
            return { text: 'Baik, Kak. Aku hubungkan ke admin sekarang. Pesan Kakak sudah diteruskan dan admin akan melanjutkan di chat ini.', handoff: { reason } };
        }
        const handoffInstruction = adminJid
            ? "\n\nESKALASI KE ADMIN: Jika percakapan stuck, di luar knowledge base, atau pelanggan marah/minta bicara manusia, gunakan tool escalateToHuman."
            : "";

        const shippingRule = businessConfig.enableShipping
            ? 'Jika pelanggan memberikan alamat/kecamatan/kelurahan/kota tujuan atau meminta cek ongkir, WAJIB panggil tool cekOngkir pada turn yang sama. Kirim tujuan paling spesifik pada cityName. Sertakan classification, attributes, dan quantity yang sudah dipilih agar berat berasal dari Produk & Harga.'
            : 'Shipping/ongkir nonaktif untuk bisnis ini. Jangan meminta alamat fisik untuk ongkir dan jangan membahas cek ongkir.';
        const orderRule = buildClosingOrderRule(businessConfig);
        const recentHistory = history.slice(-12);
        const retrievalQuery = [...recentHistory.map((message) => message.content), prompt].join('\n');
        const customerNeedQuery = [...recentHistory.filter((message) => message.role === 'user').map((message) => message.content), prompt].join('\n');
        const ordinalContext = /\byang (?:pertama|kedua|ketiga|terakhir)\b/i.test(prompt) ? recentHistory.filter((message) => message.role === 'assistant').at(-1)?.content : '';
        const customerPriceContext = [...recentHistory.filter((message) => message.role === 'user').map((message) => message.content), ordinalContext || '', prompt].filter(Boolean).join('\n');
        const relevantContext = selectRelevantKnowledge(context, retrievalQuery);
        const budgetContext = buildCatalogBudgetContext(liveState.maxBudget ? `budget ${liveState.maxBudget}` : customerNeedQuery);
        const catalogEvidence = `${buildCatalogEvidence(retrievalQuery)}\n\n${budgetContext?.evidence || ''}\n\n${relevantContext.text}`;
        const consultationReply = resolveProductDomain(basePrompt, relevantContext.text) === 'fragrance'
            ? buildVerifiedFragranceConsultationReply(prompt, customerNeedQuery, context)
            : null;
        if (consultationReply) {
            const selection = inferCatalogPartialSelectionFromText(consultationReply);
            if (jid && selection) await setChatState(jid, 'consulting', { recommendedClassification: selection.classification, recommendedAttributes: selection.attributes, maxBudget: liveState.maxBudget });
            return { text: sanitizeAgentText(consultationReply) };
        }
        const durabilityReply = buildUnsupportedDurabilityReply(prompt, relevantContext.text);
        if (durabilityReply) return { text: durabilityReply };
        const safetyReply = buildUnsupportedSafetyReply(prompt, relevantContext.text);
        if (safetyReply) return { text: safetyReply };
        const stockReply = buildUnsupportedStockNote(prompt, relevantContext.text);
        if (stockReply && !/\b(?:harga|berapa|berapaan|total)\b/i.test(prompt)) return { text: sanitizeAgentText(stockReply) };
        const namedProduct = await resolveCatalogFragranceProduct(prompt, liveState.classification || '');
        if (namedProduct && !namedProduct.requestedRelation) liveState = {
            ...liveState,
            productName: namedProduct.productName,
            classification: namedProduct.classification,
        };
        const relationProduct = inferOrdinalProductName(prompt, recentHistory.filter((message) => message.role === 'assistant').map((message) => message.content));
        const relation = await buildCatalogFragranceRelationReply(prompt, relationProduct || liveState.productName || recentHistory.filter((message) => message.role === 'user').map((message) => message.content).join('\n'), liveState.classification || '');
        if (relation?.switchSelection) liveState = { ...liveState, productName: relation.productName, classification: relation.classification, attributes: {} };
        const stateOffer = liveState.classification && liveState.attributes
            ? resolveCatalogOffer({ classification: liveState.classification, attributes: liveState.attributes, quantity: liveState.quantity })
            : null;
        const previousOffer = (stateOffer?.valid ? stateOffer : null) || [...recentHistory].reverse().filter((message) => message.role === 'user').map((message) => inferCatalogOfferFromText(message.content)).find(Boolean) || null;
        const recommendedSelection = inferCatalogRecommendationFromText(recentHistory.filter((message) => message.role === 'assistant').map((message) => message.content).join('\n'));
        const ordinalSelection = inferCatalogOrdinalReference(prompt, recentHistory.filter((message) => message.role === 'assistant').map((message) => message.content));
        const ordinalProductName = inferOrdinalProductName(prompt, recentHistory.filter((message) => message.role === 'assistant').map((message) => message.content));
        const productOrdinalWins = Boolean(ordinalProductName && !isCatalogVariationValue(ordinalProductName));
        const explicitSelection = inferCatalogSelectionUpdateFromText(prompt, {
            classification: liveState.classification || previousOffer?.scheme.name,
            attributes: liveState.attributes || previousOffer?.option.values,
        });
        const hasCheckoutData = /(?:\+?62|0)\d[\d\s-]{7,16}\d|\b(?:nama|atas nama|alamat|kirim ke|email)\b/i.test(prompt);
        if (hasCheckoutData && hasCatalogSelectionLanguage(prompt) && previousOffer && liveState.classification && previousOffer.scheme.name !== liveState.classification) {
            liveState = {
                ...liveState,
                productName: undefined,
                classification: previousOffer.scheme.name,
                attributes: { ...previousOffer.option.values },
                quantity: previousOffer.quantity,
                unitPrice: previousOffer.unitPrice,
                subtotal: previousOffer.subtotal,
            };
            if (jid) {
                await clearDraftProductName(jid);
                await setChatState(jid, 'quality_selected', { variant: previousOffer.scheme.name, options: previousOffer.option.values, quantity: previousOffer.quantity, productPrice: previousOffer.unitPrice, maxBudget: liveState.maxBudget });
                await upsertDraftOrder({ jid, variant: previousOffer.scheme.name, options: previousOffer.option.values, quantity: previousOffer.quantity, productPrice: previousOffer.unitPrice });
            }
        }
        const recommendationConfirmation = buildRecommendationConfirmationReply(prompt, liveState);
        if (recommendationConfirmation) return { text: sanitizeAgentText(recommendationConfirmation) };
        const classificationReply = buildCatalogClassificationReply(prompt, liveState.classification || recommendedSelection?.classification || '', liveState.productName || '');
        if (classificationReply) return { text: sanitizeAgentText(classificationReply) };
        if (/\bkalau\b[\s\S]{0,70}\b(?:admin|manusia|cs|customer service)\b/i.test(prompt) && previousOffer) {
            return { text: sanitizeAgentText(`Iya, Kak. Biar nggak muter: ${previousOffer.scheme.name} ${Object.values(previousOffer.option.values).join(' ')} harganya Rp${previousOffer.unitPrice.toLocaleString('id-ID')} per item.`) };
        }
        if (explicitSelection && hasCatalogSelectionLanguage(prompt) && !hasCheckoutData && !/\?/.test(prompt)) {
            if (jid) {
                await setChatState(jid, 'quality_selected', { productName: liveState.productName, variant: explicitSelection.scheme.name, options: explicitSelection.option.values, quantity: explicitSelection.quantity, productPrice: explicitSelection.unitPrice, maxBudget: liveState.maxBudget });
                await upsertDraftOrder({ jid, productName: liveState.productName, variant: explicitSelection.scheme.name, options: explicitSelection.option.values, quantity: explicitSelection.quantity, productPrice: explicitSelection.unitPrice });
            }
            return { text: buildCatalogSelectionAcknowledgement(explicitSelection, liveState.productName) };
        }
        const promptOffer = inferCatalogOfferFromText(prompt);
        const bareBudgetNeedsConsultation = Boolean(latestBudget && !liveState.productName && !liveState.classification);
        const directPriceReply = bareBudgetNeedsConsultation || ordinalProductName && !ordinalSelection && !recommendedSelection
            ? null
            : buildDeterministicPriceReply(prompt, customerPriceContext, previousOffer || recommendedSelection || (productOrdinalWins ? undefined : ordinalSelection) || (liveState.classification ? { classification: liveState.classification, attributes: liveState.attributes } : undefined));
        if (directPriceReply) {
            const selected = inferCatalogSelectionUpdateFromText(prompt, {
                classification: liveState.classification || previousOffer?.scheme.name,
                attributes: liveState.attributes || previousOffer?.option.values,
            });
            if (jid && selected && hasCatalogSelectionLanguage(prompt)) {
                const classificationChanged = Boolean(liveState.classification && liveState.classification !== selected.scheme.name);
                const productName = classificationChanged ? undefined : liveState.productName;
                if (classificationChanged) await clearDraftProductName(jid);
                const draft = {
                    jid,
                    stage: 'quality_selected' as const,
                    productName,
                    variant: selected.scheme.name,
                    options: { ...selected.option.values },
                    quantity: selected.quantity,
                    productPrice: selected.unitPrice,
                };
                await setChatState(jid, draft.stage, { productName: draft.productName, variant: draft.variant, options: draft.options, quantity: draft.quantity, productPrice: draft.productPrice, maxBudget: liveState.maxBudget });
                await upsertDraftOrder(draft);
            }
            const transition = promptOffer && liveState.productName && liveState.classification && promptOffer.scheme.name !== liveState.classification
                ? `${Object.values(promptOffer.option.values).join(' ')} masuk kelompok ${promptOffer.scheme.name}, jadi berbeda dari ${liveState.productName} di ${liveState.classification} yang tadi direkomendasikan.\n\n`
                : '';
            const stockNote = buildUnsupportedStockNote(prompt, catalogEvidence);
            return { text: sanitizeAgentText(`${relation ? `${relation.text}\n\n` : ''}${transition}${directPriceReply}${stockNote ? `\n\n${stockNote}` : ''}`) };
        }
        if (relation) return { text: sanitizeAgentText(relation.text) };
        const comparisonAdvice = buildCatalogComparisonAdvice(
            prompt,
            recentHistory.filter((message) => message.role === 'user').at(-1)?.content || '',
            liveState.classification ? { classification: liveState.classification, attributes: liveState.attributes } : recommendedSelection || previousOffer ? {
                classification: recommendedSelection?.classification || previousOffer?.scheme.name,
                attributes: recommendedSelection?.attributes || previousOffer?.option.values,
            } : undefined,
        );
        if (comparisonAdvice) return { text: sanitizeAgentText(comparisonAdvice) };
        const affordableClassifications = [...new Set(budgetContext?.options.map(({ scheme }) => scheme.name) || [])];
        const budgetClassification = affordableClassifications.length === 1 ? affordableClassifications[0] : '';
        const catalogNotesLookup = businessConfig.enableExternalProductLookup
            ? async (inspiredName: string) => lookupProductReference(buildExternalSearchQuery(inspiredName, 'fragrance'), { forceExternal: true })
            : undefined;
        const fragranceDetail = resolveProductDomain(basePrompt, relevantContext.text) === 'fragrance'
            ? await buildCatalogFragranceDetailReply(`${liveState.productName || ''} ${prompt}`, liveState.classification || '', catalogNotesLookup, recentHistory.filter((message) => message.role === 'assistant').map((message) => message.content).join('\n'))
            : null;
        if (fragranceDetail) return { text: sanitizeAgentText(fragranceDetail.text) };
        const suitability = resolveProductDomain(basePrompt, relevantContext.text) === 'fragrance'
            ? await buildCatalogFragranceSuitabilityReply(prompt, liveState.productName || '', liveState.classification || '', catalogNotesLookup)
            : null;
        if (suitability) return { text: sanitizeAgentText(suitability.text) };
        const verifiedRecommendation = resolveProductDomain(basePrompt, relevantContext.text) === 'fragrance'
            ? await buildVerifiedFragranceRecommendation(prompt, customerNeedQuery, budgetClassification || recommendedSelection?.classification || liveState.classification || inferLatestCatalogClassificationFromText(recentHistory.filter((message) => message.role === 'assistant').map((message) => message.content).join('\n')) || previousOffer?.scheme.name || '', catalogNotesLookup)
            : null;
        if (verifiedRecommendation) {
            const priced = selectFragranceBudgetOption(budgetContext?.options.filter(({ scheme }) => scheme.name === verifiedRecommendation.classification) || [], customerNeedQuery);
            const suffix = priced ? ` Pilihan yang paling pas dan masih sesuai budget: ${Object.values(priced.option.values).join(' ')} seharga Rp${priced.option.price.toLocaleString('id-ID')}.` : '';
            if (jid) await setChatState(jid, 'consulting', {
                recommendedProductName: verifiedRecommendation.productNames.length === 1 ? verifiedRecommendation.productNames[0] : undefined,
                recommendedClassification: verifiedRecommendation.classification,
                maxBudget: liveState.maxBudget,
            });
            return { text: sanitizeAgentText(`${verifiedRecommendation.text}${suffix}`) };
        }
        const checkoutOffer = liveState.classification
            ? resolveCatalogOffer({ classification: liveState.classification, attributes: liveState.attributes || {}, quantity: liveState.quantity })
            : null;
        if (hasCheckoutData && liveState.productName && !checkoutOffer?.valid) {
            const axes = checkoutOffer?.scheme?.variations.map((axis) => axis.name.toLowerCase()).join(' dan ') || 'variasi produk';
            return { text: `Produk ${liveState.productName} sudah tercatat, Kak. Pilihan ${axes} belum lengkap, jadi aku belum hitung ongkir. Pilihan yang mau dipakai yang mana?` };
        }
        const externalLookupQuery = businessConfig.enableExternalProductLookup ? resolveExternalLookupQuery(prompt, recentHistory) : null;
        if (externalLookupQuery && catalogNotesLookup && resolveProductDomain(basePrompt, relevantContext.text) === 'fragrance') {
            const externalReference = await lookupProductReference(buildExternalSearchQuery(externalLookupQuery, 'fragrance'), { forceExternal: true });
            const asksForAlternatives = /\b(?:mirip|paling dekat|nuansa(?:nya)? paling dekat|alternatif|padanan|satu pilihan|pilih(?:kan)? satu)\b/i.test(prompt)
                || /^(?:iya|ya|boleh|mau|oke|ok|lanjut|gas)(?:\s+(?:kak|dong|deh|aja|saja))?[.!?]*$/i.test(prompt.trim());
            if (!asksForAlternatives) {
                const internal = await resolveCatalogFragranceProduct(externalLookupQuery, '');
                const text = internal
                    ? `${internal.productName} tercantum pada katalog ${internal.classification}, Kak.`
                    : buildExternalFragranceIntroductionReply(externalLookupQuery, externalReference.content)
                        || `${externalLookupQuery} belum ada di katalog kami, Kak. Detail notes yang cukup jelas belum ditemukan, jadi aku belum bisa mencocokkannya dengan produk toko tanpa berisiko salah.`;
                return { text: sanitizeAgentText(text) };
            }
            const matched = await buildVerifiedExternalFragranceMatch(externalLookupQuery, externalReference.content, catalogNotesLookup, prompt);
            if (matched) {
                if (jid && matched.productName) await setChatState(jid, 'consulting', { recommendedProductName: matched.productName, recommendedClassification: matched.classification, maxBudget: liveState.maxBudget });
                return { text: sanitizeAgentText(matched.text) };
            }
            return { text: sanitizeAgentText(`Aku sudah membandingkan aroma ${externalLookupQuery} dengan pilihan toko, Kak. Belum ada kesamaan notes yang cukup kuat untuk menyebut satu produk sebagai pilihan terdekat, jadi aku tidak mau asal merekomendasikan.`) };
        }
        const allowModelHandoff = /\b(?:marah|kecewa|penipu|parah|keterlaluan)\b/i.test(prompt);
        const fullSystemPrompt = `${buildBusinessPrompt(csNameOverride)}\n\n${basePrompt}\n\nATURAN PENGIRIMAN (DARI SISTEM):\n${checkoutRule}${handoffInstruction}\n\nPENTING: Setiap kali pelanggan memberikan info (nama, alamat, preferensi, dsb), SELALU panggil tool simpanDataPelanggan.\nSetiap customer memilih produk, varian/opsi, level/kualitas, ukuran/paket, qty, data checkout, atau ongkir, SELALU panggil tool simpanDraftPesanan.\n${shippingRule} Jika pelanggan juga memberikan data diri, panggil simpanDataPelanggan sekaligus.\nJangan minta data checkout sebelum produk/opsi utama (dan field order wajib dari config) cukup jelas. Jangan ringkasan pesanan akhir sebelum checkout lengkap.\n${orderRule}${ordinalProductName ? `\nRUJUKAN PRODUK TERVERIFIKASI: Pilihan ordinal customer adalah ${ordinalProductName}. Pertahankan produk ini, tentukan kelompok harganya dari Knowledge, dan jangan menanyakan nama produk lagi.` : ''}\n\n${buildPreviewStateEvidence(liveState)}\n\nKNOWLEDGE RELEVAN (KATALOG / FAQ PRODUK):\n${catalogEvidence || 'Belum ada data katalog yang relevan.'}`;

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
        let externalProductName: string | null = null;
        let externalCandidateEvidence = 'Tidak ada kandidat internal terverifikasi.';
        const enforceLiveExternalBoundary = async (text: string) => enforceExternalReferenceBoundary(
            text,
            externalProductName,
            externalCandidateEvidence,
            model,
            (params) => createCompatibleCompletion(openai, params),
            externalProductName ? buildExternalLookupFallback(externalProductName, '', businessConfig.businessName) : SAFE_CUSTOMER_FALLBACK,
        );

        // Tool call loop — max 5 round-trips
        for (let i = 0; i < 5; i++) {
            const response = await createCompatibleCompletion(openai, {
                model,
                messages,
                temperature: 0.7,
                tools: getTools({ allowExternalLookup: Boolean(externalLookupQuery), allowHandoff: allowModelHandoff }),
                tool_choice: 'auto',
                max_tokens: 600,
            });

            const msg = response.choices[0].message;

            if (!msg.tool_calls || msg.tool_calls.length === 0) {
                const sanitized = sanitizeAgentText(msg.content || 'Maaf, saya tidak bisa membalas saat ini.');
                const bounded = await enforceLiveExternalBoundary(sanitized);
                const guarded = await enforceCatalogEvidence(bounded, catalogEvidence, model, (params) => createCompatibleCompletion(openai, params), budgetContext?.fallback);
                return { text: sanitizeAgentText(guarded), handoff: handoffResult, orderConfirmed, postPaymentHandoff };
            }

            // Ada tool calls — proses semua
            messages.push(cleanAssistantMessage(msg));
            for (const tc of msg.tool_calls) {
                if (tc.type !== 'function') continue;
                const args = JSON.parse(tc.function.arguments);
                const result = await handleToolCall(tc.function.name, args, jid, prompt);
                if (tc.function.name === 'cariReferensiProduk') {
                    externalProductName = String(args.query || '').trim() || null;
                    const domain = resolveProductDomain(basePrompt, result.content);
                    const match = await selectDomainMatcher(domain, await loadCatalogSchemaRows()).match(result.content);
                    externalCandidateEvidence = match.candidateEvidence;
                    result.content += `\n\nBATAS TRANSAKSI REFERENSI LUAR:\n${match.policy}\n\nKANDIDAT INTERNAL TERVERIFIKASI:\n${match.candidateEvidence}`;
                }
                if (result.handoff) handoffResult = result.handoff;
                if (result.orderConfirmed) orderConfirmed = result.orderConfirmed;
                if (result.postPaymentHandoff) postPaymentHandoff = result.postPaymentHandoff;
                if (result.content.includes('Ongkir ke ')) {
                    directShippingResult = result.content.replace('Eskalasi dibatalkan karena cek ongkir berhasil.\n', '');
                }
                messages.push({ tool_call_id: tc.id, role: 'tool' as const, content: result.content });
            }
            if (directShippingResult) {
                return { text: sanitizeAgentText(annotateShippingDeadline(directShippingResult, `${recentHistory.map((message) => message.content).join('\n')}\n${prompt}`)), orderConfirmed, postPaymentHandoff };
            }
        }

        // Fallback jika loop habis
        const final = await createCompatibleCompletion(openai, { model, messages, temperature: 0.7, max_tokens: 600 });
        const sanitized = sanitizeAgentText(final.choices[0].message.content || 'Maaf, saya tidak bisa membalas saat ini.');
        const bounded = await enforceLiveExternalBoundary(sanitized);
        const guarded = await enforceCatalogEvidence(bounded, catalogEvidence, model, (params) => createCompatibleCompletion(openai, params), budgetContext?.fallback);
        return { text: sanitizeAgentText(guarded), handoff: handoffResult, orderConfirmed, postPaymentHandoff };
    } catch (error) {
        console.error('❌ Error saat menghubungi AI:', error);
        return { text: 'Maaf, terjadi kesalahan pada sistem AI kami.' };
    }
};

const previewAgentReplyRaw = async (prompt: string, context: string = '', history: ChatMessage[] = [], csNameOverride?: string, initialState: PreviewConversationState = {}) => {
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
    const ordinalContext = /\byang (?:pertama|kedua|ketiga|terakhir)\b/i.test(prompt) ? history.filter((message) => message.role === 'assistant').at(-1)?.content : '';
    const customerPriceContext = [...history.filter((message) => message.role === 'user').map((message) => message.content), ordinalContext || '', prompt].filter(Boolean).join('\n');
    const { text: relevantContext, citations } = selectRelevantKnowledge(context, retrievalQuery, 5_000);
    let previewState = normalizePreviewState(initialState);
    const latestBudget = parseCatalogBudget(prompt);
    if (latestBudget) previewState = { ...previewState, maxBudget: latestBudget };
    const latestPartialSelection = inferCatalogPartialSelectionFromText(prompt);
    if (latestPartialSelection) previewState = {
        ...previewState,
        classification: latestPartialSelection.classification,
        attributes: { ...(previewState.classification === latestPartialSelection.classification ? previewState.attributes : {}), ...latestPartialSelection.attributes },
    };
    const budgetContext = buildCatalogBudgetContext(previewState.maxBudget ? `budget ${previewState.maxBudget}` : retrievalQuery);
    const catalogEvidence = `${buildCatalogEvidence(retrievalQuery)}\n\n${budgetContext?.evidence || ''}\n\n${relevantContext}`;
    const consultationReply = resolveProductDomain(basePrompt, relevantContext) === 'fragrance'
        ? buildVerifiedFragranceConsultationReply(prompt, [...history.filter((message) => message.role === 'user').map((message) => message.content), prompt].join('\n'), context)
        : null;
    if (consultationReply) {
        const text = sanitizeAgentText(consultationReply);
        const selection = inferCatalogPartialSelectionFromText(text);
        if (selection) previewState = {
            ...previewState,
            classification: selection.classification,
            attributes: { ...(previewState.classification === selection.classification ? previewState.attributes : {}), ...selection.attributes },
        };
        return { text, plan: buildResponsePlan(text), usedTools: [], citations, state: previewState };
    }
    const durabilityReply = buildUnsupportedDurabilityReply(prompt, relevantContext);
    if (durabilityReply) return { text: durabilityReply, plan: buildResponsePlan(durabilityReply), usedTools: [], citations, state: previewState };
    const safetyReply = buildUnsupportedSafetyReply(prompt, relevantContext);
    if (safetyReply) return { text: safetyReply, plan: buildResponsePlan(safetyReply), usedTools: [], citations, state: previewState };
    const stockReply = buildUnsupportedStockNote(prompt, relevantContext);
    if (stockReply && !/\b(?:harga|berapa|berapaan|total)\b/i.test(prompt)) {
        const text = sanitizeAgentText(stockReply);
        return { text, plan: buildResponsePlan(text), usedTools: [], citations, state: previewState };
    }
    const namedProduct = await resolveCatalogFragranceProduct(prompt, previewState.classification || '');
    if (namedProduct && !namedProduct.requestedRelation) previewState = {
        ...previewState,
        productName: namedProduct.productName,
        classification: namedProduct.classification,
    };
    const relationProduct = inferOrdinalProductName(prompt, history.filter((message) => message.role === 'assistant').map((message) => message.content));
    const relation = await buildCatalogFragranceRelationReply(prompt, relationProduct || previewState.productName || history.filter((message) => message.role === 'user').map((message) => message.content).join('\n'), previewState.classification || '');
    if (relation?.switchSelection) previewState = { ...previewState, productName: relation.productName, classification: relation.classification, attributes: {} };
    const previousOffer = [...history].reverse().filter((message) => message.role === 'user').map((message) => inferCatalogOfferFromText(message.content)).find(Boolean) || null;
    const recommendedSelection = inferCatalogRecommendationFromText(history.filter((message) => message.role === 'assistant').map((message) => message.content).join('\n'));
    const ordinalSelection = inferCatalogOrdinalReference(prompt, history.filter((message) => message.role === 'assistant').map((message) => message.content));
    const ordinalProductName = inferOrdinalProductName(prompt, history.filter((message) => message.role === 'assistant').map((message) => message.content));
    const productOrdinalWins = Boolean(ordinalProductName && !isCatalogVariationValue(ordinalProductName));
    if (productOrdinalWins && ordinalProductName) previewState = { ...previewState, productName: ordinalProductName };
    const promptCustomer = extractLeadFromPrompt(prompt);
    if (Object.keys(promptCustomer).length) previewState = mergePreviewState(previewState, promptCustomer);
    const inferredSelection = recommendedSelection || (productOrdinalWins ? null : ordinalSelection);
    if (!previewState.classification && inferredSelection) previewState = {
        ...previewState,
        classification: inferredSelection.classification,
        attributes: { ...inferredSelection.attributes },
    };
    const bareBudgetNeedsConsultation = Boolean(latestBudget && !previewState.productName && !previewState.classification);
    const directPriceReply = bareBudgetNeedsConsultation || ordinalProductName && !ordinalSelection && !recommendedSelection && !previewState.classification ? null : buildDeterministicPriceReply(prompt, customerPriceContext, {
        unitPrice: previewState.unitPrice || previousOffer?.unitPrice,
        attributes: recommendedSelection?.attributes || (productOrdinalWins ? undefined : ordinalSelection?.attributes) || previewState.attributes || previousOffer?.option.values,
        classification: recommendedSelection?.classification || (productOrdinalWins ? undefined : ordinalSelection?.classification) || previewState.classification || previousOffer?.scheme.name,
    });
    if (directPriceReply) {
        const promptOffer = inferCatalogOfferFromText(prompt);
        const directOffer = inferCatalogSelectionUpdateFromText(prompt, previewState);
        if (directOffer && hasCatalogSelectionLanguage(prompt)) {
            const classificationChanged = previewState.classification && previewState.classification !== directOffer.scheme.name;
            const { productName: _staleProductName, ...stateWithoutProduct } = previewState;
            previewState = {
            ...(classificationChanged ? stateWithoutProduct : previewState),
            classification: directOffer.scheme.name,
            attributes: { ...directOffer.option.values },
            quantity: directOffer.quantity,
            unitPrice: directOffer.unitPrice,
            subtotal: directOffer.subtotal,
            };
        }
        const labeledReply = ordinalProductName && !directPriceReply.toLowerCase().includes(ordinalProductName.toLowerCase())
            ? `${ordinalProductName}\n\n${directPriceReply}`
            : directPriceReply;
        const transition = promptOffer && previewState.productName && previewState.classification && promptOffer.scheme.name !== previewState.classification
            ? `${Object.values(promptOffer.option.values).join(' ')} masuk kelompok ${promptOffer.scheme.name}, jadi berbeda dari ${previewState.productName} di ${previewState.classification} yang tadi direkomendasikan.\n\n`
            : '';
        const stockNote = buildUnsupportedStockNote(prompt, catalogEvidence);
        const text = sanitizeAgentText(`${relation ? `${relation.text}\n\n` : ''}${transition}${labeledReply}${stockNote ? `\n\n${stockNote}` : ''}`);
        return { text, plan: buildResponsePlan(text), usedTools: [], citations, state: previewState };
    }
    if (relation) {
        const text = sanitizeAgentText(relation.text);
        return { text, plan: buildResponsePlan(text), usedTools: [], citations, state: previewState };
    }
    const comparisonAdvice = buildCatalogComparisonAdvice(
        prompt,
        history.filter((message) => message.role === 'user').at(-1)?.content || '',
        previewState.classification ? { classification: previewState.classification, attributes: previewState.attributes } : recommendedSelection || previousOffer ? {
            classification: recommendedSelection?.classification || previousOffer?.scheme.name,
            attributes: recommendedSelection?.attributes || previousOffer?.option.values,
        } : undefined,
    );
    if (comparisonAdvice) {
        const text = sanitizeAgentText(comparisonAdvice);
        return { text, plan: buildResponsePlan(text), usedTools: [], citations, state: previewState };
    }
    let trustedEvidence = `${catalogEvidence}\n\n${buildPreviewStateEvidence(previewState)}`;
    const inferredOffer = inferCatalogSelectionUpdateFromText(prompt, {
        classification: previewState.classification || previousOffer?.scheme.name,
        attributes: previewState.attributes || previousOffer?.option.values,
    });
    if (inferredOffer) {
        previewState = {
            ...previewState,
            classification: inferredOffer.scheme.name,
            attributes: { ...inferredOffer.option.values },
            quantity: inferredOffer.quantity,
            unitPrice: inferredOffer.unitPrice,
            subtotal: inferredOffer.subtotal,
        };
        trustedEvidence += `\n\nHARGA PILIHAN TERVERIFIKASI: ${inferredOffer.scheme.name}; ${Object.values(inferredOffer.option.values).join('; ')}; harga satuan Rp${inferredOffer.unitPrice.toLocaleString('id-ID')}; jumlah ${inferredOffer.quantity}; subtotal Rp${inferredOffer.subtotal.toLocaleString('id-ID')}.`;
    }
    const hasCheckoutData = /(?:\+?62|0)\d[\d\s-]{7,16}\d|\b(?:nama|atas nama|alamat|kirim ke|email)\b/i.test(prompt);
    if (hasCheckoutData && hasCatalogSelectionLanguage(prompt) && previousOffer && previewState.classification && previousOffer.scheme.name !== previewState.classification) {
        const { productName: _oldProduct, ...withoutProduct } = previewState;
        previewState = {
            ...withoutProduct,
            classification: previousOffer.scheme.name,
            attributes: { ...previousOffer.option.values },
            quantity: previousOffer.quantity,
            unitPrice: previousOffer.unitPrice,
            subtotal: previousOffer.subtotal,
        };
    }
    const recommendationConfirmation = buildRecommendationConfirmationReply(prompt, previewState);
    if (recommendationConfirmation) {
        const text = sanitizeAgentText(recommendationConfirmation);
        return { text, plan: buildResponsePlan(text), usedTools: [], citations, state: previewState };
    }
    const classificationReply = buildCatalogClassificationReply(prompt, previewState.classification || recommendedSelection?.classification || '', previewState.productName || '');
    if (classificationReply) {
        const text = sanitizeAgentText(classificationReply);
        return { text, plan: buildResponsePlan(text), usedTools: [], citations, state: previewState };
    }
    if (/\bkalau\b[\s\S]{0,70}\b(?:admin|manusia|cs|customer service)\b/i.test(prompt) && previousOffer) {
        const text = sanitizeAgentText(`Iya, Kak. Biar nggak muter: ${previousOffer.scheme.name} ${Object.values(previousOffer.option.values).join(' ')} harganya Rp${previousOffer.unitPrice.toLocaleString('id-ID')} per item.`);
        return { text, plan: buildResponsePlan(text), usedTools: [], citations, state: previewState };
    }
    if (inferredOffer && hasCatalogSelectionLanguage(prompt) && !hasCheckoutData && !/\?/.test(prompt)) {
        const text = buildCatalogSelectionAcknowledgement(inferredOffer, previewState.productName);
        return { text, plan: buildResponsePlan(text), usedTools: [], citations, state: previewState };
    }
    const verifiedPriceFallback = inferredOffer
        ? `Untuk ${inferredOffer.scheme.name} dengan pilihan ${Object.values(inferredOffer.option.values).join(', ')}, harganya Rp${inferredOffer.unitPrice.toLocaleString('id-ID')} per item${inferredOffer.quantity > 1 ? `. Jumlah ${inferredOffer.quantity}, jadi subtotalnya Rp${inferredOffer.subtotal.toLocaleString('id-ID')}` : ''}, Kak.`
        : budgetContext?.fallback;
    const checkoutSafeFallback = buildCheckoutSafeFallback(previewState, prompt);
    const productDomain = resolveProductDomain(basePrompt, relevantContext);
    const affordableClassifications = [...new Set(budgetContext?.options.map(({ scheme }) => scheme.name) || [])];
    const budgetClassification = affordableClassifications.length === 1 ? affordableClassifications[0] : '';
    const catalogNotesLookup = businessConfig.enableExternalProductLookup
        ? async (inspiredName: string) => lookupProductReference(buildExternalSearchQuery(inspiredName, 'fragrance'), { forceExternal: true })
        : undefined;
    const fragranceDetail = productDomain === 'fragrance'
        ? await buildCatalogFragranceDetailReply(`${previewState.productName || ''} ${prompt}`, previewState.classification || '', catalogNotesLookup, history.filter((message) => message.role === 'assistant').slice(-12).map((message) => message.content).join('\n'))
        : null;
    if (fragranceDetail) {
        previewState = { ...previewState, productName: fragranceDetail.productName, classification: fragranceDetail.classification };
        const text = sanitizeAgentText(fragranceDetail.text);
        return { text, plan: buildResponsePlan(text), usedTools: fragranceDetail.lookupSource ? [`external:${fragranceDetail.lookupSource}`] : [], citations, state: previewState };
    }
    const suitability = productDomain === 'fragrance'
        ? await buildCatalogFragranceSuitabilityReply(prompt, previewState.productName || '', previewState.classification || '', catalogNotesLookup)
        : null;
    if (suitability) {
        const text = sanitizeAgentText(suitability.text);
        return { text, plan: buildResponsePlan(text), usedTools: suitability.lookupSource ? [`external:${suitability.lookupSource}`] : [], citations, state: previewState };
    }
    const verifiedRecommendation = productDomain === 'fragrance'
        ? await buildVerifiedFragranceRecommendation(prompt, [...history.filter((message) => message.role === 'user').map((message) => message.content), prompt].join('\n'), budgetClassification || recommendedSelection?.classification || previewState.classification || inferLatestCatalogClassificationFromText(history.filter((message) => message.role === 'assistant').map((message) => message.content).join('\n')) || '', catalogNotesLookup)
        : null;
    if (hasCheckoutData && !previewState.productName && productDomain === 'fragrance') {
        const checkoutRecommendation = await buildVerifiedFragranceRecommendation('pilih satu yang paling cocok', [...history.filter((message) => message.role === 'user').map((message) => message.content), prompt].join('\n'), previewState.classification || budgetClassification);
        if (checkoutRecommendation?.productNames[0]) {
            previewState = { ...previewState, productName: checkoutRecommendation.productNames[0], classification: checkoutRecommendation.classification };
            const selectedVariation = [previewState.classification, ...Object.values(previewState.attributes || {})].filter(Boolean).join(' ');
            const selectedPrice = previewState.unitPrice ? ` seharga Rp${previewState.unitPrice.toLocaleString('id-ID')}` : '';
            const text = `Oke, berarti pilihannya lanjut ke ${selectedVariation || previewState.classification}${selectedPrice}, Kak. Untuk kebutuhan yang tadi, produk yang paling dekat adalah ${checkoutRecommendation.productNames[0]}.\n\nSebelum aku hitung ongkir, pastikan pilihan produk ini cocok ya, Kak.`;
            return { text, plan: buildResponsePlan(text), usedTools: [], citations, state: previewState };
        }
        const text = 'Pilihan kualitas dan ukurannya sudah jelas, Kak. Nama produknya belum dipilih, jadi aku belum lanjut ke ongkir supaya pesanan tidak salah. Produk mana yang mau dipakai?';
        return { text, plan: buildResponsePlan(text), usedTools: [], citations, state: previewState };
    }
    const previewCheckoutOffer = previewState.classification
        ? resolveCatalogOffer({ classification: previewState.classification, attributes: previewState.attributes || {}, quantity: previewState.quantity })
        : null;
    if (hasCheckoutData && previewState.productName && !previewCheckoutOffer?.valid) {
        const axes = previewCheckoutOffer?.scheme?.variations.map((axis) => axis.name.toLowerCase()).join(' dan ') || 'variasi produk';
        const text = `Produk ${previewState.productName} sudah tercatat, Kak. Pilihan ${axes} belum lengkap, jadi aku belum hitung ongkir. Pilihan yang mau dipakai yang mana?`;
        return { text, plan: buildResponsePlan(text), usedTools: [], citations, state: previewState };
    }
    if (verifiedRecommendation) {
        const comparedValues = history.filter((message) => message.role === 'user').at(-1)?.content.match(/\b(?:beda|selisih|sama|atau)\b/i)
            ? history.filter((message) => message.role === 'user').at(-1)?.content || ''
            : '';
        const affordable = budgetContext?.options.filter(({ scheme }) => scheme.name === verifiedRecommendation.classification) || [];
        const comparedAffordable = affordable.filter(({ option }) => Object.values(option.values).some((value) => comparedValues.toLowerCase().includes(value.toLowerCase())));
        const priced = comparedAffordable.length
            ? [...comparedAffordable].sort((left, right) => left.option.price - right.option.price)[0]
            : selectFragranceBudgetOption(affordable, [...history.filter((message) => message.role === 'user').map((message) => message.content), prompt].join('\n'));
        previewState = {
            ...previewState,
            classification: verifiedRecommendation.classification,
            ...(verifiedRecommendation.productNames.length === 1 ? { productName: verifiedRecommendation.productNames[0] } : {}),
            ...(priced ? { attributes: { ...priced.option.values }, unitPrice: priced.option.price, subtotal: priced.option.price * Math.max(1, previewState.quantity || 1) } : {}),
        };
        const suffix = priced
            ? comparedAffordable.length
                ? ` Dari pilihan yang dibandingkan, ${Object.values(priced.option.values).join(' ')} masih sesuai budget dengan harga Rp${priced.option.price.toLocaleString('id-ID')}.`
                : ` Pilihan yang paling pas dan masih sesuai budget: ${Object.values(priced.option.values).join(' ')} seharga Rp${priced.option.price.toLocaleString('id-ID')}.`
            : '';
        const text = sanitizeAgentText(`${verifiedRecommendation.text}${suffix}`);
        return { text, plan: buildResponsePlan(text), usedTools: verifiedRecommendation.lookupSources.map((source) => `external:${source}`), citations, state: previewState };
    }
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
        : checkoutSafeFallback || SAFE_CUSTOMER_FALLBACK;
    if (requestsHumanHandoff(prompt)) {
        previewState = { ...previewState, handoffReason: `Customer meminta admin: ${prompt.slice(0, 300)}` };
        const text = 'Baik, Kak. Aku hubungkan ke admin sekarang. Pesan Kakak sudah diteruskan dan admin akan melanjutkan di chat ini.';
        return { text, plan: buildResponsePlan(text), usedTools: ['escalateToHuman'], citations, state: previewState };
    }
    if (externalLookupQuery && externalReference && productDomain === 'fragrance'
        && !/\b(?:mirip|paling dekat|nuansa(?:nya)? paling dekat|alternatif|padanan|satu pilihan)\b/i.test(prompt)) {
        const internal = await resolveCatalogFragranceProduct(externalLookupQuery, '');
        const text = internal
            ? `${internal.productName} tercantum pada katalog ${internal.classification}, Kak.`
            : buildExternalFragranceIntroductionReply(externalLookupQuery, externalReference.content)
                || `${externalLookupQuery} belum ada di katalog kami, Kak. Detail notes yang cukup jelas belum ditemukan, jadi aku belum bisa mencocokkannya dengan produk toko tanpa berisiko salah.`;
        const clean = sanitizeAgentText(text);
        return { text: clean, plan: buildResponsePlan(clean), usedTools: [`external:${externalReference.source}`], citations, state: previewState };
    }
    if (externalLookupQuery && externalReference && productDomain === 'fragrance' && catalogNotesLookup
        && /\b(?:paling (?:mirip|dekat)|nuansa(?:nya)? paling dekat|satu pilihan)\b/i.test(prompt)) {
        const matched = await buildVerifiedExternalFragranceMatch(externalLookupQuery, externalReference.content, catalogNotesLookup, prompt);
        if (matched) {
            previewState = { ...previewState, productName: matched.productName, classification: matched.classification, attributes: {} };
            const text = sanitizeAgentText(matched.text);
            const sources = [externalReference.source, ...matched.lookupSources].filter(Boolean).map((source) => `external:${source}`);
            return { text, plan: buildResponsePlan(text), usedTools: [...new Set(sources)], citations, state: previewState };
        }
        const text = sanitizeAgentText(`Aku sudah membandingkan aroma ${externalLookupQuery} dengan pilihan yang ada di toko, Kak. Sayangnya, belum ada kemiripan notes yang cukup kuat untuk menyebut satu varian sebagai pilihan terdekat. Daripada asal memilih dan bikin Kakak kecewa, aku belum mau mengarahkan ke satu produk tertentu.`);
        return { text, plan: buildResponsePlan(text), usedTools: [`external:${externalReference.source}`], citations, state: previewState };
    }
    const domainPolicy = `STRATEGI DOMAIN AKTIF (${domainMatcher.id}):\n${domainMatch.policy}`;
    const systemPrompt = `${buildBusinessPrompt(csNameOverride)}\n\n${basePrompt}\n\nCORE OUTPUT POLICY:\nGunakan Bahasa Indonesia natural saja. Jangan gunakan aksara China. Jangan pernah menampilkan DSML, XML, environment_details, JSON tool call, workspace path, metadata sistem, atau proses berpikir kepada customer. Jika referensi web sudah tersedia, jangan panggil tool pencarian lagi. Jangan menciptakan produk, pilihan, spesifikasi, harga, atau ketersediaan yang tidak ada pada evidence.\n\n${domainPolicy}\n\nMODE PREVIEW ADMIN:\nJangan membuat data bisnis permanen, order nyata, atau handoff nyata. Gunakan tool simpan sementara agar pilihan tetap konsisten selama simulasi. WAJIB baca seluruh RIWAYAT CHAT yang diberikan. Jangan mengulang sapaan/perkenalan setelah turn pertama. Jangan menanyakan ulang konteks yang sudah disebut customer. Saat customer memakai rujukan seperti "yang paling mirip", hubungkan dengan topik pada riwayat terdekat. Jangan langsung handoff jika evidence cukup untuk memberi jawaban berguna.\nShipping ${businessConfig.enableShipping ? 'aktif' : 'nonaktif'}.\n\nDOMAIN AKTIF: ${domainMatcher.id}\n\nREFERENSI WEB TERVERIFIKASI:\n${compactExternalReference}\n\nPROFIL DOMAIN TERVERIFIKASI:\n${domainMatch.profileEvidence}\n\nKANDIDAT KATALOG TERVERIFIKASI:\n${domainMatch.candidateEvidence}\n\nKNOWLEDGE RELEVAN:\n${catalogEvidence || 'Belum ada data katalog yang relevan.'}${ordinalProductName ? `\n\nRUJUKAN PRODUK TERVERIFIKASI: Pilihan ordinal customer adalah ${ordinalProductName}. Pertahankan produk ini, klasifikasikan dari Knowledge, dan jangan menanyakan produk yang sama lagi.` : ''}`;
    const model = process.env.AI_MODEL || 'gemini/gemini-2.5-flash';
    const messages: any[] = [
        { role: 'system', content: systemPrompt },
        { role: 'system', content: buildPreviewStateEvidence(previewState) },
        ...history.map((message) => ({ role: message.role, content: message.content.slice(0, 4_000) })),
        { role: 'user', content: prompt },
    ];
    const usedTools: string[] = [];
    let directPreviewShipping: string | undefined;
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
    const enforceConsultationPacing = async (text: string) => {
        const asksPrice = /\b(?:harga|berapa|biaya|total|budget|ongkir|diskon|promo)\b/i.test(prompt);
        if (asksPrice || !/(?:rp\.?\s*\d|\b\d+[.]?\d*\s*(?:ribu|rb|juta|jt)\b)/i.test(text)) return text;
        const repaired = await createCompletion({
            model,
            messages: [
                { role: 'system', content: 'Perbaiki ritme balasan CS secara domain-netral. Customer belum meminta harga dan belum menyelesaikan pilihan variasi. Pertahankan rekomendasi serta penjelasan manfaat/fitur yang relevan, hapus daftar harga, lalu ajukan maksimal satu pertanyaan natural. Jangan menambah fakta.' },
                { role: 'user', content: `PESAN CUSTOMER:\n${prompt}\n\nBALASAN:\n${text}` },
            ],
            temperature: 0.1,
            max_tokens: 700,
        });
        const cleaned = sanitizeAgentText(repaired.choices[0].message.content || '');
        return cleaned && !isInternalRepairText(cleaned) && !/(?:rp\.?\s*\d|\b\d+[.]?\d*\s*(?:ribu|rb|juta|jt)\b)/i.test(cleaned) ? cleaned : text;
    };
    const enforceSingleRecommendation = async (text: string) => {
        if (!/\b(?:pilih mana|enaknya mana|paling cocok|pilih satu|paling aman)\b/i.test(prompt)) return text;
        if (!/(?:^|\n)\s*(?:\d+\.|[^\n]+Rp)/m.test(text) && !/\b(?:atau|pilihan)\b/i.test(text)) return text;
        const repaired = await createCompletion({
            model,
            messages: [
                { role: 'system', content: 'Pilih tepat satu opsi terbaik untuk kebutuhan customer dari bukti yang diberikan. Jawab nama produk/kelompok, seluruh variasi wajib, harga jika tersedia, dan satu alasan singkat. Jangan memberi daftar, alternatif, atau pertanyaan balik. Jangan menambah fakta.' },
                { role: 'user', content: `PESAN CUSTOMER:\n${prompt}\n\nBUKTI:\n${trustedEvidence.slice(0, 6_000)}\n\nBALASAN YANG TERLALU BANYAK PILIHAN:\n${text}` },
            ],
            temperature: 0.1,
            max_tokens: 350,
        });
        const cleaned = sanitizeAgentText(repaired.choices[0].message.content || '');
        return cleaned && !isInternalRepairText(cleaned) ? cleaned : text;
    };
    const runPreviewTool = async (name: string, rawArgs: Record<string, any>) => {
        const validation = validateToolArguments(name, rawArgs);
        if (!validation.success) return validation.error || 'Argumen tool tidak valid.';
        const args = validation.data as Record<string, any>;
        if (name === 'simpanDataPelanggan') {
            previewState = mergePreviewState(previewState, args);
            return 'Data customer disimpan sementara untuk simulasi ini.';
        }
        if (name === 'simpanDraftPesanan') {
            const mayChangeSelection = hasCatalogSelectionLanguage(prompt) || Boolean(inferCatalogOfferFromText(prompt));
            const requestedProduct = String(args.productName || args.aroma || '').trim();
            const trustedProduct = !requestedProduct
                || normalizeSearchText(prompt).includes(normalizeSearchText(requestedProduct))
                || normalizeSearchText(previewState.productName || '') === normalizeSearchText(requestedProduct);
            const safeArgs = trustedProduct ? args : { ...args, productName: undefined, aroma: undefined };
            previewState = mergePreviewState(previewState, mayChangeSelection ? safeArgs : {
                stage: args.stage,
                customerName: args.customerName,
                phone: args.phone,
                address: args.address,
            });
            const offer = resolveCatalogOffer({
                classification: previewState.classification,
                attributes: previewState.attributes,
                quality: args.quality,
                sizeMl: args.sizeMl,
                quantity: previewState.quantity,
            });
            if (offer.valid) previewState = {
                ...previewState,
                unitPrice: offer.unitPrice,
                subtotal: offer.subtotal,
                classification: offer.scheme.name,
                attributes: { ...offer.option.values },
            };
            trustedEvidence += offer.valid
                ? `\n\n${buildPreviewStateEvidence(previewState)}\nHARGA TURUNAN TERVERIFIKASI: Harga satuan Rp${offer.unitPrice.toLocaleString('id-ID')}; jumlah ${offer.quantity}; subtotal Rp${offer.subtotal.toLocaleString('id-ID')}.`
                : `\n\n${buildPreviewStateEvidence(previewState)}`;
            return offer.valid
                ? `Draft simulasi diperbarui. Harga satuan Rp${offer.unitPrice.toLocaleString('id-ID')}; subtotal Rp${offer.subtotal.toLocaleString('id-ID')}.`
                : `Draft simulasi diperbarui. ${offer.error}`;
        }
        if (name === 'cekOngkir') {
            const offer = resolveCatalogOffer({
                classification: previewState.classification,
                attributes: previewState.attributes,
                quantity: previewState.quantity,
            });
            if (!previewState.productName || !offer.valid) {
                return 'Ongkir belum boleh dihitung. Pastikan nama produk dan seluruh variasi katalog sudah dipilih customer terlebih dahulu.';
            }
            const weightContext = [Number(args.quantity) > 1 ? `${args.quantity}x` : '', args.classification, ...Object.values(args.attributes || {}), args.quality, args.sizeMl ? `${args.sizeMl}ml` : ''].filter(Boolean).join(' ');
            const rawContent = await checkShippingCost(String(args.cityName || ''), weightContext || String(args.cityName || ''));
            const content = annotateShippingDeadline(rawContent, `${history.map((message) => message.content).join('\n')}\n${prompt}`);
            previewState = { ...previewState, shippingEvidence: content };
            directPreviewShipping = content;
            trustedEvidence += `\n\nHASIL ONGKIR TERVERIFIKASI:\n${content}`;
            return content;
        }
        if (name === 'cariReferensiProduk') return (await lookupProductReference(String(args.query || ''), { forceExternal: Boolean(args.forceExternal) })).content;
        if (name === 'escalateToHuman') {
            previewState = { ...previewState, handoffReason: String(args.reason || '') };
            return 'Handoff simulasi ditandai. Jelaskan singkat bahwa admin akan melanjutkan.';
        }
        return 'Tool tidak tersedia dalam mode preview.';
    };

    for (let round = 0; round < 3; round++) {
        const response = await createCompletion({
            model,
            messages,
            temperature: 0.7,
            tools: getPreviewTools({ allowExternalLookup: Boolean(externalLookupQuery), allowHandoff: /\b(?:marah|kecewa|penipu|parah|keterlaluan)\b/i.test(prompt) }),
            tool_choice: 'auto',
            max_tokens: 600,
        });
        const message = response.choices[0].message;
        const textToolCalls = message.content ? parseTextToolCalls(message.content) : [];
        if (!message.tool_calls?.length && textToolCalls.length) {
            messages.push({ role: 'assistant', content: 'Aku akan memeriksa referensi produk yang relevan.' });
            for (const textToolCall of textToolCalls) {
                usedTools.push(textToolCall.name);
                const content = await runPreviewTool(textToolCall.name, textToolCall.arguments);
                messages.push({ role: 'user', content: `HASIL TOOL ${textToolCall.name}:\n${content}\n\nSusun jawaban final untuk customer. Jangan tampilkan markup tool, XML, DSML, JSON, atau proses berpikir.` });
            }
            if (directPreviewShipping) return { text: sanitizeAgentText(directPreviewShipping), plan: buildResponsePlan(sanitizeAgentText(directPreviewShipping)), usedTools, citations, state: previewState };
            continue;
        }
        if (!message.tool_calls?.length && message.content && containsInternalMarkup(message.content)) {
            const cleaned = stripInternalMarkup(message.content);
            if (cleaned) {
                const text = sanitizeAgentText(cleaned);
                return { text, plan: buildResponsePlan(text), usedTools, citations, state: previewState };
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
                    const pacedText = await enforceSingleRecommendation(await enforceConsultationPacing(repairedText));
                    const boundedText = await enforceExternalReferenceBoundary(pacedText, externalLookupQuery, domainMatch.candidateEvidence, model, createCompletion, externalSafeFallback);
                    const guardedText = await enforceCatalogEvidence(boundedText, trustedEvidence, model, createCompletion, verifiedPriceFallback);
                    const finalText = sanitizeAgentText(guardedText);
                    return { text: finalText, plan: buildResponsePlan(finalText), usedTools, citations, state: previewState };
                }
                const pacedText = await enforceSingleRecommendation(await enforceConsultationPacing(text));
                const boundedText = await enforceExternalReferenceBoundary(pacedText, externalLookupQuery, domainMatch.candidateEvidence, model, createCompletion, externalSafeFallback);
                const guardedText = await enforceCatalogEvidence(boundedText, trustedEvidence, model, createCompletion, verifiedPriceFallback);
                const finalText = sanitizeAgentText(guardedText);
                return { text: finalText, plan: buildResponsePlan(finalText), usedTools, citations, state: previewState };
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
            const pacedText = await enforceSingleRecommendation(await enforceConsultationPacing(text));
            const boundedText = await enforceExternalReferenceBoundary(pacedText, externalLookupQuery, domainMatch.candidateEvidence, model, createCompletion, externalSafeFallback);
            const guardedText = await enforceCatalogEvidence(boundedText, trustedEvidence, model, createCompletion, verifiedPriceFallback);
            const finalText = sanitizeAgentText(guardedText);
            return { text: finalText, plan: buildResponsePlan(finalText), usedTools, citations, state: previewState };
        }
        messages.push(cleanAssistantMessage(message));
        for (const toolCall of message.tool_calls) {
            if (toolCall.type !== 'function') continue;
            const args = parseToolArguments(toolCall.function.arguments);
            usedTools.push(toolCall.function.name);
            const content = await runPreviewTool(toolCall.function.name, args);
            messages.push({ tool_call_id: toolCall.id, role: 'tool', content });
        }
        if (directPreviewShipping) {
            const text = sanitizeAgentText(directPreviewShipping);
            return { text, plan: buildResponsePlan(text), usedTools, citations, state: previewState };
        }
    }
    const fallback = await createCompletion({ model, messages, temperature: 0.7, max_tokens: 600 });
    const text = sanitizeAgentText(fallback.choices[0].message.content || '') || externalSafeFallback;
    const pacedText = await enforceSingleRecommendation(await enforceConsultationPacing(text));
    const boundedText = await enforceExternalReferenceBoundary(pacedText, externalLookupQuery, domainMatch.candidateEvidence, model, createCompletion, externalSafeFallback);
    const guardedText = await enforceCatalogEvidence(boundedText, trustedEvidence, model, createCompletion, verifiedPriceFallback);
    const finalText = sanitizeAgentText(guardedText);
    return { text: finalText, plan: buildResponsePlan(finalText), usedTools, state: previewState };
};

export const askAgent = async (...args: Parameters<typeof askAgentRaw>): Promise<AgentResult> => {
    const result = await askAgentRaw(...args);
    return { ...result, text: applyCustomerReplyStyle(result.text) };
};

export const previewAgentReply = async (...args: Parameters<typeof previewAgentReplyRaw>) => {
    const result = await previewAgentReplyRaw(...args);
    const text = applyCustomerReplyStyle(result.text);
    let state = normalizePreviewState(result.state);
    const inferred = inferCatalogPartialSelectionFromText(text);
    if (inferred) state = {
        ...state,
        classification: inferred.classification,
        attributes: { ...(state.classification === inferred.classification ? state.attributes : {}), ...inferred.attributes },
    };
    const product = /\b(?:pasangan|nama\s+(?:karakter|asli|inspired)|aslinya|acuannya)\b/i.test(text)
        ? null
        : await resolveCatalogFragranceProduct(text, state.classification || '');
    if (product && !product.requestedRelation && !state.productName && !/^\s*2\.\s/m.test(text)) {
        state = { ...state, productName: product.productName, classification: product.classification };
    }
    const offer = state.classification ? resolveCatalogOffer({ classification: state.classification, attributes: state.attributes || {}, quantity: state.quantity }) : null;
    if (offer?.valid) state = { ...state, attributes: { ...offer.option.values }, quantity: offer.quantity, unitPrice: offer.unitPrice, subtotal: offer.subtotal };
    return { ...result, state, text, plan: buildResponsePlan(text) };
};
