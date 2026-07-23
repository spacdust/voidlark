import express from 'express';
import multer from 'multer';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import fs from 'fs';
import path from 'path';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import { pool } from '../config/db.js';
import { clearChatHistory, getFullChatHistory } from '../chat/history.js';
import { clearOrderState, getOrderById, markOrderPaid, buildOrderSummary, advanceOrderStatus } from '../chat/orders.js';
import { getKnowledgeBase, knowledgeWorker, loadKnowledgeBase } from '../ai/knowledge.js';
import { knowledgeStore, type KnowledgeJob } from '../ai/knowledge-store.js';
import { previewAgentReply } from '../ai/agent.js';
import { stripInternalMarkup } from '../ai/tool-markup.js';
import { sanitizeCustomerLanguage } from '../ai/language-guard.js';
import { buildReplyStyleExample } from './reply-style-preview.js';
import { adminEntryPath, assertProductionAdminPassword, createAdminSecurity, csrfTokenFromRequest, parseCookies, shouldRejectCrossSite } from './security.js';
import { messageStore } from '../whatsapp/message-store.js';
import { renderLoginPage } from './login-page.js';
import { getConversationSummary, listConversationSummaries, renderTranscript } from './conversation-history.js';
import { checkAiHealth, invalidateAiHealth, type AiHealth } from '../ai/health.js';
import { handoffRepository, resolveHandoff, unresolvedHandoffPredicate } from '../chat/handoff.js';
import { getWaSessionStatus, getWaStatus, isWaSessionStaleConnecting, setWaSessionStatus } from '../whatsapp/status.js';
import { adoptPendingWhatsAppSession, startWhatsAppConnection, stopWhatsAppSession } from '../whatsapp/connection.js';
import { VOIDLARK_LOGO_SVG } from './logo.js';
import QRCode from 'qrcode';
import { getBusinessConfig, type BusinessConfig } from '../config/business.js';
import { validateBusinessHoursConfig } from '../chat/business-hours.js';
import { paymentWebhookHandler } from '../payments/webhook.js';
import { listBackupRuns } from '../config/database-backup.js';
import { exportCustomerData, deleteCustomerData } from './customer-data.js';
import type { Server } from 'node:http';
import { metricsRegistry, operationalMetrics } from '../operations/metrics.js';
import { globalWhatsAppManager, type RotationMode } from '../whatsapp/whatsapp-manager.js';
import { globalAiQueueLimiter } from '../ai/ai-queue-limiter.js';
import { liveness, readiness } from '../operations/health.js';
import { appLogger } from '../config/logger.js';
import { ADMIN_STYLES } from './admin-styles.js';

const KNOWLEDGE_DIR = path.resolve('knowledge_base');
const CONFIG_PATH = path.resolve('business.config.json');
const ENV_PATH = path.resolve('.env');
const PROMPT_PATH = path.resolve('config', 'system-prompt.txt');
const PROMPT_BUILDER_PATH = path.resolve('prompt.builder.json');
const BACKUP_FILES = ['business.config.json', 'config/system-prompt.txt', 'prompt.builder.json'] as const;
const LEGACY_BACKUP_FILE_ALIASES: Record<string, typeof BACKUP_FILES[number]> = {
    'system_prompt.txt': 'config/system-prompt.txt',
    'system-prompt.txt': 'config/system-prompt.txt',
};
const SAFE_OPERATIONAL_ENV_KEYS = [
    'DB_DRIVER', 'SQLITE_PATH', 'AI_API_BASE_URL', 'AI_MODEL', 'AI_TRANSCRIPTION_MODEL',
    'STORE_DESTINATION_ID', 'STORE_CITY_NAME', 'SHIPPING_COURIERS', 'SHIPPING_WEIGHT_GRAMS',
    'ADMIN_WA_JID', 'HOST', 'PORT', 'LOG_LEVEL', 'SLO_RULES_JSON',
    'INBOUND_CONCURRENCY', 'INBOUND_MEDIA_ROOT', 'INBOUND_MEDIA_MAX_BYTES',
    'DB_BACKUP_ENABLED', 'DB_BACKUP_DIR', 'DB_BACKUP_RETENTION', 'DB_BACKUP_INTERVAL_MINUTES', 'DB_BACKUP_RUN_ON_START',
    'PAYMENT_WEBHOOK_SIGNATURE_HEADER',
] as const;
const backupPreviewCache = new Map<string, { payload: BackupPayload; expiresAt: number }>();
let activeAdminServer: Server | null = null;
const PHOSPHOR_SVG_DIR = path.resolve('node_modules/@phosphor-icons/core/assets/regular');
const ALLOWED_EXT = new Set(['.txt', '.md', '.pdf', '.docx', '.xlsx', '.csv', '.png', '.jpg', '.jpeg']);
const ENV_GROUPS = [
    {
        title: 'Database',
        fields: [
            { key: 'DB_DRIVER', label: 'Database driver', type: 'select', options: ['sqlite', 'postgres'], help: 'Pilih sqlite untuk setup paling mudah di device lokal. Pilih postgres kalau pakai server database sendiri.' },
            { key: 'SQLITE_PATH', label: 'SQLite file path', type: 'text', placeholder: './data/voidlark.db', help: 'Boleh dikosongkan. Jika kosong, Voidlark pakai ./data/voidlark.db otomatis.' },
            { key: 'DATABASE_URL', label: 'PostgreSQL URL', type: 'password', placeholder: 'postgres://user:pass@localhost:5432/db', help: 'Hanya dipakai kalau Database driver = postgres. Kalau pakai sqlite, boleh kosong.' },
        ],
    },
    {
        title: 'AI',
        fields: [
            { key: 'AI_API_BASE_URL', label: 'AI API base URL', type: 'url', placeholder: 'http://localhost:20128/v1', help: 'Alamat endpoint AI. Kalau pakai proxy lokal biarkan seperti default. Kalau pakai provider lain, isi base URL provider.' },
            { key: 'AI_API_KEY', label: 'AI API key', type: 'password', placeholder: 'sk-...', help: 'Wajib diisi supaya bot bisa menghubungi AI. Jangan dibagikan ke orang lain.' },
            { key: 'AI_MODEL', label: 'ID model AI', type: 'text', placeholder: 'groq/llama-3.1-8b-instant', help: 'Masukkan ID model persis seperti yang tercantum di provider atau gateway, misalnya groq/llama-3.1-8b-instant, oc/deepseek-v4-flash-free, atau gemini/gemini-2.5-flash. Voidlark mendukung endpoint OpenAI-compatible dan menyesuaikan respons JSON maupun streaming SSE. Model kecil lebih hemat, tetapi kualitas konsultasi dan tool calling dapat berbeda.' },
            { key: 'OPENROUTER_API_KEY', label: 'OpenRouter API key legacy', type: 'password', placeholder: 'opsional', help: 'Opsional untuk kompatibilitas env lama. Kalau AI_API_KEY sudah dipakai, ini boleh kosong.' },
        ],
    },
    {
        title: 'Ongkir',
        fields: [
            { key: 'RAJAONGKIR_API_KEY', label: 'RajaOngkir API keys', type: 'textarea', placeholder: 'Masukkan API key RajaOngkir', help: 'Tambahkan satu key per baris. Urutan pertama menjadi key utama; key berikutnya dipakai otomatis saat limit atau tidak valid.', docsUrl: 'https://collaborator.komerce.id/settings', docsLabel: 'Dapatkan API key Komerce', docsHelp: 'Buka Settings Komerce, lalu salin API key RajaOngkir ke kolom ini.' },
            { key: 'STORE_DESTINATION_ID', label: 'Kode lokasi toko', type: 'text', placeholder: 'opsional, contoh: 57', help: 'Opsional. Ini kode lokasi dari RajaOngkir/Komerce. Kalau tidak tahu, kosongkan saja dan isi Nama kota / kecamatan toko.' },
            { key: 'STORE_CITY_NAME', label: 'Nama kota / kecamatan toko', type: 'text', placeholder: 'contoh: Bantul', help: 'Lokasi asal pengiriman. Dipakai otomatis kalau Kode lokasi toko kosong.' },
            { key: 'SHIPPING_COURIERS', label: 'Kurir aktif', type: 'textarea', placeholder: 'jne,sicepat,ide,sap,ninja,jnt,tiki,wahana,pos,sentral,lion,rex', help: 'Kode kurir yang dicek. Biarkan default kalau belum yakin.' },
            { key: 'SHIPPING_WEIGHT_GRAMS', label: 'Berat fallback gram', type: 'number', placeholder: '500', help: 'Berat default kalau ukuran produk belum terbaca.' },
        ],
    },
    {
        title: 'Handoff',
        fields: [
            { key: 'ADMIN_WA_JID', label: 'Nomor WhatsApp admin', type: 'text', placeholder: '081234567890', help: 'Nomor yang menerima notifikasi ketika bot membutuhkan bantuan. Format WhatsApp dibuat otomatis.' },
        ],
    },
    {
        title: 'Lookup eksternal',
        fields: [
            { key: 'TAVILY_API_KEY', label: 'Tavily API keys', type: 'textarea', placeholder: 'Masukkan API key Tavily', help: 'Free tier menyediakan 1.000 credit per bulan tanpa kartu kredit. Tambahkan key cadangan untuk auto-rotate saat limit.', docsUrl: 'https://app.tavily.com', docsLabel: 'Dapatkan API key Tavily', docsHelp: 'Daftar paket Researcher gratis, lalu salin API key ke kolom ini.' },
        ],
    },
] as const;
const KNOWN_ENV_KEYS: Set<string> = new Set(ENV_GROUPS.flatMap((group) => group.fields.map((field) => field.key)));
const SALES_FLOW_OPTIONS = [
    { value: 'consultative', label: 'Consultative', description: 'Bot tanya kebutuhan dulu, lalu rekomendasi dan closing.' },
    { value: 'direct', label: 'Direct Sales', description: 'Bot lebih cepat arahkan customer ke pilihan produk dan checkout.' },
    { value: 'support', label: 'Support / FAQ', description: 'Bot fokus jawab pertanyaan, belum agresif menjual.' },
];
const CHECKOUT_FIELD_OPTIONS = [
    { value: 'name', label: 'Nama' },
    { value: 'phone', label: 'No HP / WA' },
    { value: 'address', label: 'Alamat' },
    { value: 'email', label: 'Email' },
    { value: 'notes', label: 'Catatan' },
];
const ORDER_FIELD_OPTIONS = [
    { value: 'productName', label: 'Nama produk' },
    { value: 'variant', label: 'Varian' },
    { value: 'quality', label: 'Level / kualitas' },
    { value: 'packageSize', label: 'Ukuran / paket' },
    { value: 'quantity', label: 'Jumlah' },
    { value: 'productPrice', label: 'Harga produk' },
    { value: 'shippingOption', label: 'Kurir' },
    { value: 'shippingCost', label: 'Ongkir' },
];
const PRODUCT_TYPE_OPTIONS = [
    { value: 'physical', label: 'Produk fisik', description: 'Produk dikirim ke alamat pelanggan. Bot dapat meminta alamat dan memeriksa ongkir.' },
    { value: 'digital', label: 'Produk digital', description: 'Produk dikirim melalui chat atau email. Bot tidak meminta alamat dan ongkir otomatis nonaktif.' },
];
const PROMPT_PRESETS = {
    friendly: {
        label: 'Ramah santai',
        description: 'Chat terasa hangat, natural, dan tidak kaku.',
        role: 'CS virtual toko yang ramah, natural, seperti teman, dan jujur soal identitas virtual.',
        style: 'Ramah, natural, santai seperti teman, sapaan Kak, tidak kaku, tidak korporat.',
    },
    concise: {
        label: 'Cepat singkat',
        description: 'Jawaban lebih pendek, jelas, dan langsung ke inti.',
        role: 'CS virtual toko yang cepat, jelas, dan fokus bantu sampai order.',
        style: 'Singkat, ramah, jelas, satu fokus per balasan.',
    },
    support: {
        label: 'Support formal',
        description: 'Lebih tenang dan rapi untuk FAQ atau support.',
        role: 'CS virtual support yang menjawab berdasarkan knowledge base.',
        style: 'Tenang, jelas, membantu, tidak agresif menjual.',
    },
    consultative: {
        label: 'Konsultatif',
        description: 'Menggali kebutuhan lalu memberi pilihan paling relevan.',
        role: 'CS virtual konsultatif yang memahami kebutuhan sebelum merekomendasikan produk.',
        style: 'Hangat, terarah, membantu memilih, dan tidak membanjiri customer dengan pilihan.',
    },
} as const;
const DEFAULT_PROMPT_BUILDER = {
    preset: 'friendly',
    role: PROMPT_PRESETS.friendly.role,
    style: PROMPT_PRESETS.friendly.style,
    replyLength: 'balanced',
    sellingStyle: 'balanced',
    salutation: 'Kak',
    emojiLevel: 'light',
    greeting: 'Sapaan Kak. Perkenalkan nama CS virtual dari Config. Emoji secukupnya. Jangan bilang "Ada yang bisa [nama bisnis] bantu?".',
    identityRules: [
        'Perkenalkan diri memakai nama CS virtual dan nama bisnis dari Profil & Alur.',
        'Jika ditanya apakah bot, jawab jujur dan singkat lalu lanjut membantu.',
        'Jangan mengaku sebagai manusia dan jangan menjelaskan identitas virtual terlalu panjang.',
    ].join('\n'),
    consultationRules: [
        'Lakukan konsultasi secara bertahap dan satu balasan hanya memiliki satu fokus.',
        'Jangan membanjiri customer dengan kategori, varian, spesifikasi, pilihan, dan harga sekaligus.',
        'Jika customer bingung, tanyakan satu kebutuhan paling penting per balasan sesuai jenis bisnis dan data pada Knowledge.',
        'Jika kebutuhan sudah jelas, berikan 2-3 rekomendasi saja.',
        'Gunakan riwayat dan CUSTOMER STATE. Jangan menanyakan ulang informasi yang sudah disebut customer.',
        'Pahami rujukan seperti "yang tadi", "itu", dan "yang paling mirip" dari konteks percakapan terdekat.',
    ].join('\n'),
    productRules: [
        'Gunakan Knowledge sebagai sumber utama untuk nama produk, kategori, varian, spesifikasi, pilihan, harga, dan ketersediaan.',
        'Jangan mengarang produk, kategori, varian, harga, stok, atau detail yang tidak ditemukan pada Knowledge.',
        'Baca hubungan kolom, header tabel, tanda panah, dan pasangan data sesuai arah yang tertulis pada sumber Knowledge. Jangan membalik relasi.',
        'Jika satu produk memiliki beberapa pilihan, tampilkan hanya pilihan yang relevan dengan pertanyaan atau pilihan customer.',
        'Jika data produk atau harga ambigu, tanyakan klarifikasi singkat atau jelaskan bahwa data belum tersedia.',
        'Aturan khusus bisnis dan pengecualian produk harus ditulis di Knowledge, bukan di system prompt.',
    ].join('\n'),
    checkoutRules: [
        'Setelah field pesanan wajib dari Profil & Alur sudah dipilih, buat rekap sementara sebelum meminta data customer.',
        'Minta hanya data checkout yang belum tersedia sesuai Profil & Alur.',
        'Setelah data lengkap, buat ringkasan akhir berdasarkan field pesanan dan checkout yang dikonfigurasi.',
        'Setiap customer memberikan atau mengubah field pesanan, data checkout, atau pengiriman, simpan/update dengan tool simpanDraftPesanan.',
    ].join('\n'),
    shippingRules: [
        'Gunakan aturan bobot yang dikonfigurasi pada Profil & Alur; jangan membuat bobot produk sendiri.',
        'Saat memanggil cekOngkir, sertakan alamat tujuan, jumlah, dan pilihan ukuran/paket jika tersedia.',
        'Jika pengiriman nonaktif, jangan meminta alamat untuk ongkir dan jangan memanggil cekOngkir.',
    ].join('\n'),
    escalationRules: [
        'Eskalasi ke admin jika customer marah, minta admin manusia, pertanyaan di luar knowledge base, atau sistem tool gagal berulang.',
        'Jika eskalasi, jelaskan singkat bahwa admin akan bantu lanjutkan.',
    ].join('\n'),
    formattingRules: [
        'Jangan gunakan tanda bintang (*) sama sekali.',
        'Jangan gunakan strip (-) di awal kalimat sebagai bullet.',
        'Jawaban WhatsApp maksimal 1-2 kalimat pembuka.',
        'Gunakan angka untuk daftar singkat.',
        'Jangan membuat list panjang jika customer belum meminta detail.',
        'Satu balasan satu pertanyaan lanjutan saja.',
        'Akhiri dengan satu pertanyaan pilihan yang jelas.',
    ].join('\n'),
    extraRules: 'Jika customer menyebut produk referensi di luar katalog, cek Knowledge terlebih dahulu. Jika tidak tersedia, jujur bahwa data belum ada dan tawarkan alternatif relevan hanya jika didukung Knowledge.',
};

const escapeHtml = (value: unknown) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** SQLite CURRENT_TIMESTAMP = UTC tanpa zona. Tanpa 'Z', JS sering parse sebagai lokal → offset WIB (~7 jam). */
const parseDbDate = (value: unknown): Date | null => {
    if (value == null || value === '') return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'number') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    const raw = String(value).trim();
    // "2026-07-14 04:31:00" atau "2026-07-14 04:31:00.123" (SQLite UTC)
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw)) {
        const date = new Date(raw.replace(' ', 'T') + 'Z');
        return Number.isNaN(date.getTime()) ? null : date;
    }
    // ISO tanpa zona → anggap UTC (konsisten dengan SQLite)
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw)) {
        const date = new Date(`${raw}Z`);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
};

const fmtTime = (value: unknown) => {
    if (!value) return '—';
    const date = parseDbDate(value);
    if (!date) return escapeHtml(value);
    const diffMs = Date.now() - date.getTime();
    const abs = Math.abs(diffMs);
    const absLabel = (() => {
        if (abs < 45_000) return 'baru saja';
        if (abs < 3_600_000) return `${Math.round(abs / 60_000)} mnt lalu`;
        if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)} jam lalu`;
        if (abs < 7 * 86_400_000) return `${Math.round(abs / 86_400_000)} hr lalu`;
        return date.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
    })();
    const exact = date.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
    return `<time datetime="${escapeHtml(date.toISOString())}" title="${escapeHtml(exact)}">${escapeHtml(absLabel)}</time>`;
};

const fmtDateTime = (value: unknown) => {
    if (!value) return '—';
    const date = parseDbDate(value);
    if (!date) return escapeHtml(value);
    const exact = date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    return `<time datetime="${escapeHtml(date.toISOString())}">${escapeHtml(exact)}</time>`;
};

const shortJid = (jid: unknown) => {
    const raw = String(jid || '');
    return escapeHtml(raw.replace(/@.+$/, '') || raw || '—');
};

const whatsappNumber = (jid: unknown) => {
    const raw = String(jid || '').trim().toLowerCase();
    if (!raw.endsWith('@s.whatsapp.net')) return '';
    return raw.replace(/@.+$/, '').replace(/\D/g, '');
};

const normalizeAdminJid = (value: unknown) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.includes('@')) return raw;
    let digits = raw.replace(/\D/g, '');
    if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
    return digits ? `${digits}@s.whatsapp.net` : '';
};

export const normalizeCustomerJid = (value: unknown) => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) throw new Error('Masukkan nomor WhatsApp atau JID pelanggan.');
    if (/(?:^|\d)@lid(?::|$)/.test(raw) || raw.includes('@lid')) throw new Error('JID @lid tidak dapat digunakan. Masukkan nomor WhatsApp pelanggan.');
    if (raw.includes('@') && !raw.endsWith('@s.whatsapp.net')) throw new Error('Format JID tidak didukung. Gunakan nomor WhatsApp atau JID @s.whatsapp.net.');
    const localPart = raw.replace(/@s\.whatsapp\.net$/, '');
    if (!/^\+?[0-9][0-9\s().-]*$/.test(localPart)) throw new Error('Nomor WhatsApp tidak valid.');
    let digits = localPart.replace(/\D/g, '');
    if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
    if (!/^\d{8,15}$/.test(digits)) throw new Error('Nomor WhatsApp tidak valid.');
    return `${digits}@s.whatsapp.net`;
};

const displayAdminNumber = (value: unknown) => String(value || '').replace(/@.+$/, '');

const formatMoney = (value: unknown) => `Rp${(Number(value) || 0).toLocaleString('id-ID')}`;

const safeJsonObject = (value: unknown): Record<string, unknown> => {
    if (!value) return {};
    if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    try {
        const parsed = JSON.parse(String(value));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
};

const badge = (label: unknown, tone: 'neutral' | 'ok' | 'warn' | 'danger' | 'info' = 'neutral') =>
    `<span class="badge-pill tone-${tone}">${escapeHtml(label || '—')}</span>`;

const ICON_NAMES: Record<string, string> = {
    dashboard: 'squares-four',
    alert: 'warning-circle',
    payment: 'credit-card',
    users: 'users-three',
    orders: 'package',
    settings: 'sliders-horizontal',
    prompt: 'waveform',
    knowledge: 'books',
    chat: 'chats-circle',
    check: 'check',
    empty: 'check-circle',
    sun: 'sun',
    moon: 'moon',
    desktop: 'desktop',
    send: 'paper-plane-right',
    retry: 'arrows-clockwise',
    logout: 'sign-out',
};

const ICON_SVGS = Object.fromEntries(Object.entries(ICON_NAMES).map(([key, fileName]) => {
    const source = fs.readFileSync(path.join(PHOSPHOR_SVG_DIR, `${fileName}.svg`), 'utf8');
    const inner = source.match(/<svg[^>]*>([\s\S]*?)<\/svg>/)?.[1] || '';
    return [key, inner];
}));

const icon = (name: string, className = 'ui-icon') =>
    `<svg class="${className}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true" focusable="false">${ICON_SVGS[name] || ICON_SVGS.dashboard}</svg>`;

const pageHeader = (title: string, subtitle: string, code: string) => `<section class="page-title">
  <span class="coordinate">${escapeHtml(code)}</span>
  <div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div>
</section>`;

const statusTone = (status: unknown): 'neutral' | 'ok' | 'warn' | 'danger' | 'info' => {
    const value = String(status || '').toLowerCase();
    if (['open', 'paid', 'shipped', 'completed', 'interested', 'confirmed'].includes(value)) return 'ok';
    if (['checkout', 'draft', 'qr', 'connecting', 'new', 'awaiting_payment'].includes(value)) return 'warn';
    if (['close', 'lost', 'logged_out', 'error'].includes(value)) return 'danger';
    if (['handoff', 'active'].includes(value)) return 'danger';
    return 'info';
};

const STATUS_LABELS: Record<string, string> = {
    new: 'Baru',
    interested: 'Tertarik',
    checkout: 'Mengisi data',
    draft: 'Draft',
    awaiting_payment: 'Menunggu pembayaran',
    paid: 'Lunas',
    shipped: 'Dikirim',
    completed: 'Selesai',
    lost: 'Tidak dilanjutkan',
    active: 'Aktif',
    open: 'Terhubung',
};

const statusLabel = (status: unknown) => STATUS_LABELS[String(status || '').toLowerCase()] || String(status || 'Belum diketahui');

const aiHealthTone = (health: AiHealth): 'ok' | 'warn' | 'danger' => health.status === 'ready'
    ? 'ok'
    : ['missing', 'slow'].includes(health.status) ? 'warn' : 'danger';

const aiHealthReady = (health: AiHealth) => health.status === 'ready' || health.status === 'slow';

const emptyState = (title: string, text: string, href: string, cta: string) => `
<section class="empty-state">
  <span class="empty-state-icon">${icon('empty')}</span>
  <strong>${escapeHtml(title)}</strong>
  <p class="muted">${escapeHtml(text)}</p>
  <a class="button-link" href="${href}">${escapeHtml(cta)}</a>
</section>`;

const toastFromQuery = (query: Record<string, unknown>) => {
    const msg = String(query.msg || '');
    const type = String(query.type || 'ok');
    if (!msg) return '';
    const role = type === 'error' ? 'alert' : 'status';
    return `<div class="toast tone-${escapeHtml(type)}" role="${role}" data-toast>${escapeHtml(msg)}</div>`;
};

const redirectWithMsg = (res: express.Response, pathName: string, msg: string, type: 'ok' | 'warn' | 'error' = 'ok') => {
    const url = new URL(pathName, 'http://local');
    url.searchParams.set('msg', msg);
    url.searchParams.set('type', type);
    res.redirect(`${url.pathname}${url.search}`);
};

const page = (title: string, body: string, active: string, options: { refreshSeconds?: number; toastHtml?: string } = {}) => `<!doctype html>
<html lang="id">
<head>
    <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${options.refreshSeconds ? `<meta http-equiv="refresh" content="${options.refreshSeconds}">` : ''}
  <title>${escapeHtml(title)}</title>
  <script>
     (() => {
       const mode = localStorage.getItem('voidlark-theme') || 'system';
       const dark = mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
       document.documentElement.dataset.theme = dark ? 'dark' : 'light';
       document.documentElement.dataset.themeMode = mode;
     })();
  </script>
  <style>
    :root {
      color-scheme: light;
        font-family: "Inter", "Segoe UI", system-ui, sans-serif;
      --canvas: #f3f6f7;
      --surface: #ffffff;
      --surface-raised: #ffffff;
      --surface-subtle: #e9eff0;
      --text: #172326;
      --text-muted: #5d6c70;
      --border: #d7e0e1;
      --border-strong: #b7c6c8;
      --accent: #087f83;
      --accent-hover: #06686b;
      --accent-soft: #dceff0;
      --bg: var(--canvas);
      --panel: var(--surface);
      --ink: var(--text);
      --muted: var(--text-muted);
      --line: var(--border);
      --soft: var(--surface-subtle);
      --primary: var(--accent);
      --primary-hover: var(--accent-hover);
      --primary-weak: var(--accent-soft);
      --success: #10b981;
      --danger: #ef4444;
      --warn: #f59e0b;
      --focus-ring: 0 0 0 3px rgba(8, 127, 131, .2);
      --shadow-raised: 0 16px 36px rgba(21, 43, 46, .14);
      --shadow: none;
      --sidebar: 224px;
      --radius: 12px;
      --radius-sm: 8px;
      --space: 26px;
      --space-sm: 18px;
      --space-lg: 38px;
      --text: 15px;
      --text-sm: 14px;
      --text-xs: 12px;
      --control-h: 44px;
      --label: #334155;
    }
    html[data-theme="dark"] {
      color-scheme: dark;
      --canvas: #172123;
      --surface: #202c2e;
      --surface-raised: #283638;
      --surface-subtle: #263335;
      --text: #edf4f3;
      --text-muted: #a9b9b8;
      --border: #3b4b4d;
      --border-strong: #607476;
      --accent: #72c8c1;
      --accent-hover: #94ddd6;
      --accent-soft: #294a4a;
      --bg: var(--canvas);
      --panel: var(--surface);
      --ink: var(--text);
      --muted: var(--text-muted);
      --line: var(--border);
      --soft: var(--surface-subtle);
      --primary: var(--accent);
      --primary-hover: var(--accent-hover);
      --primary-weak: var(--accent-soft);
      --success: #10b981;
      --danger: #ef4444;
      --warn: #f59e0b;
      --focus-ring: 0 0 0 3px rgba(114, 200, 193, .25);
      --shadow-raised: 0 18px 44px rgba(0, 0, 0, .28);
      --shadow: none;
      --label: #e2e8f0;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--ink); line-height: 1.55; font-size: var(--text); text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }
    header {
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      width: var(--sidebar);
      z-index: 10;
      background: var(--panel);
      border-right: 1px solid var(--line);
    }
    .topbar { height: 100%; min-height: 0; padding: 24px 18px; display: flex; flex-direction: column; gap: 20px; overflow: hidden; }
    .brand { display: flex; flex-direction: column; gap: 8px; padding: 0 8px 20px; border-bottom: 1px solid var(--line); }
    .brand-header { display: flex; align-items: center; gap: 10px; }
    .brand-logo-svg { width: 32px; height: 32px; flex-shrink: 0; }
    .brand-title { display: flex; flex-direction: column; gap: 1px; }
    .brand-title strong { color: var(--ink); font-family: "IBM Plex Mono", monospace; font-size: 16px; letter-spacing: .04em; font-weight: 700; text-transform: uppercase; line-height: 1.1; }
    .brand-sub { color: var(--primary); font-family: "IBM Plex Mono", monospace; font-size: 9px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
    .badge { width: max-content; color: var(--muted); background: transparent; border: 0; border-radius: var(--radius-sm); padding: 2px 0; font-family: "IBM Plex Mono", monospace; font-size: 10px; font-weight: 500; letter-spacing: .06em; text-transform: uppercase; }
    .theme-panel { flex: 0 0 auto; display: grid; gap: 10px; padding: 14px 8px 0; border-top: 1px solid var(--line); }
    .logout-form { margin: 12px 8px 0; }
    .logout-button { width: 100%; min-height: 40px; display: inline-flex; align-items: center; justify-content: flex-start; gap: 10px; padding: 9px 11px; border: 1px solid var(--line); border-radius: var(--radius); background: transparent; color: var(--muted); font: 600 13px "Inter", "Segoe UI", system-ui, sans-serif; cursor: pointer; }
    .logout-button:hover { border-color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, transparent); color: var(--danger); }
    .logout-button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .theme-label { color: var(--muted); font-family: "IBM Plex Mono", monospace; font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; }
    .theme-options { position: relative; display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; padding: 3px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--soft); overflow: hidden; }
    .theme-options::before { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: calc(100% / 3); border-radius: var(--radius-sm); background: var(--primary); box-shadow: none; transform: translateX(calc(var(--theme-index, 2) * 100%)); transition: transform .16s ease; }
    .theme-options button { position: relative; z-index: 1; min-height: 38px; padding: 8px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); font-size: var(--text-xs); font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
    .theme-options button:hover { background: var(--soft); color: var(--ink); box-shadow: none; transform: none; }
    .theme-options button:focus-visible { background: transparent; color: var(--ink); box-shadow: inset 0 0 0 2px var(--primary); outline: none; transform: none; }
    .theme-options button[aria-pressed="true"] { color: #fff; }
    .theme-options button[aria-pressed="true"]:hover,
    .theme-options button[aria-pressed="true"]:focus-visible { background: transparent; }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--line); border-radius: var(--radius-sm); }
    ::-webkit-scrollbar-corner { background: transparent; }
    nav { flex: 1 1 auto; min-height: 0; display: grid; align-content: start; gap: 4px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--line) transparent; padding-right: 4px; }
    nav::-webkit-scrollbar { width: 5px; }
    nav::-webkit-scrollbar-thumb { background: var(--line); }
    nav a {
      color: var(--muted);
      text-decoration: none;
      font-size: var(--text-sm);
      font-weight: 600;
      padding: 12px 14px;
      border-radius: var(--radius-sm);
      border: 1px solid transparent;
      transition: background-color .15s ease, border-color .15s ease, color .15s ease;
    }
    nav a:hover, nav a:focus-visible { background: var(--soft); color: var(--ink); outline: none; border-color: var(--line); transform: translateX(3px); }
    nav a.active { background: var(--soft); color: var(--ink); border-color: var(--line); box-shadow: inset 4px 0 0 var(--primary); }
    nav a.active:hover, nav a.active:focus-visible { background: var(--soft); color: var(--ink); }
    main { margin-left: var(--sidebar); padding: 44px 52px 72px; max-width: 1320px; }
    .panel, form.surface-form, form[data-unsaved], form.advanced, form.upload-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: var(--space);
      margin-bottom: var(--space);
      box-shadow: 
        0 0 0 5px var(--soft),
        0 0 0 6px var(--line),
        var(--shadow);
      transition: background-color .15s ease, border-color .15s ease, box-shadow .15s ease;
    }
    form > p:last-child { margin-top: 20px; margin-bottom: 0; }
    .sticky-actions { position: sticky; bottom: 12px; z-index: 6; display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: 26px -1px -1px; padding: 12px 14px; border: 1px solid var(--line); background: color-mix(in srgb, var(--panel) 94%, transparent); backdrop-filter: blur(10px); }
    .save-state { display: inline-flex; align-items: center; gap: 8px; color: var(--muted); font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; }
    .save-state::before { content: ""; width: 7px; height: 7px; background: var(--muted); }
    form[data-dirty="true"] .save-state { color: var(--warn); }
    form[data-dirty="true"] .save-state::before { background: var(--warn); }
    .page-title { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 18px; align-items: start; padding: 0 0 22px; margin-bottom: 28px; border-bottom: 1px solid var(--ink); }
    .coordinate { padding-top: 7px; color: var(--primary); font-family: "IBM Plex Mono", monospace; font-size: 11px; font-weight: 600; letter-spacing: .08em; }
    .page-title h1 { margin-bottom: 3px; }
    .page-title p { margin: 0; color: var(--muted); }
    .ui-icon { display: block; width: 18px; height: 18px; flex: 0 0 auto; }
    .section-head { padding: 8px 0 4px; margin: 8px 0 20px; }
    .section-head.with-action { display: flex; align-items: end; justify-content: space-between; gap: 18px; flex-wrap: wrap; }
    .knowledge-intro { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; margin-bottom: 26px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--line); overflow: hidden; }
    .knowledge-step { padding: 18px; background: var(--panel); }
    .knowledge-step span { display: block; margin-bottom: 8px; color: var(--primary); font-family: "IBM Plex Mono", monospace; font-size: 11px; font-weight: 700; }
    .knowledge-step p { margin: 0; color: var(--muted); font-size: var(--text-sm); }
    .sort-form { display: flex; align-items: end; gap: 10px; flex-wrap: wrap; padding: 14px 18px; margin-bottom: 14px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--soft); }
    .sort-form label { display: grid; gap: 5px; color: var(--muted); font-size: var(--text-xs); font-weight: 700; }
    .sort-form select { min-width: 170px; }
    .date-stack { display: grid; gap: 7px; min-width: 165px; }
    .date-stack span { display: grid; gap: 1px; }
    .date-stack small { color: var(--muted); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
    h1, h2, h3 { margin: 0 0 12px; line-height: 1.25; letter-spacing: -.02em; }
    h1 { font-family: "Inter", "Segoe UI", system-ui, sans-serif; font-size: 36px; font-weight: 680; letter-spacing: -.035em; line-height: 1.15; }
    h2 { font-size: 20px; font-weight: 600; letter-spacing: -.03em; }
    h3 { font-size: 16px; font-weight: 600; letter-spacing: -.02em; }
    p { margin: 0 0 14px; }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 28px; border: 0; }
    .stat { 
      display: grid; 
      grid-template-columns: 32px minmax(0, 1fr); 
      gap: 12px; 
      align-items: center; 
      color: inherit; 
      text-decoration: none; 
      background: var(--panel); 
      border: 1px solid var(--line); 
      border-radius: var(--radius); 
      padding: var(--space-sm) var(--space-sm); 
      box-shadow: 
        0 0 0 4px var(--soft), 
        0 0 0 5px var(--line), 
        var(--shadow); 
      transition: background-color .15s ease, border-color .15s ease, transform .15s ease;
    }
    .stat:hover, .stat:focus-visible { 
      background: var(--primary-weak); 
      border-color: var(--primary); 
      outline: none; 
      transform: translateY(-2px); 
      box-shadow: 
        0 0 0 4px var(--soft), 
        0 0 0 5px var(--primary), 
        var(--shadow);
    }
    .stat-icon { width: 28px; height: 28px; display: grid; place-items: center; border-radius: var(--radius-sm); background: transparent; color: var(--primary); }
    .stat-icon .ui-icon { width: 22px; height: 22px; }
    .stat-copy { min-width: 0; }
    .stat span { display: block; color: var(--muted); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; }
    .stat strong { display: block; margin-top: 5px; font-family: "IBM Plex Mono", monospace; font-size: 30px; letter-spacing: -.03em; line-height: 1; font-weight: 500; }
    .stat.urgent { 
      border-color: var(--danger); 
      box-shadow: 
        0 0 0 4px color-mix(in srgb, var(--danger) 8%, var(--soft)), 
        0 0 0 5px var(--danger), 
        var(--shadow);
    }
    .stat.urgent strong { color: var(--danger); }
    .stat.urgent .stat-icon { background: transparent; color: var(--danger); }
    .stat.urgent .stat-copy > span::after { content: " / aksi"; color: var(--danger); font-weight: 700; }
    .table-shell { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden; }
    .table-tools { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 18px 20px; border-bottom: 1px solid var(--line); background: var(--soft); }
    .table-tools input { max-width: 360px; }
    .table-count { color: var(--muted); font-size: var(--text-sm); font-weight: 600; }
    .table-wrap { overflow-x: auto; background: var(--panel); }
    table { width: 100%; border-collapse: collapse; min-width: 760px; }
    th, td { border-bottom: 1px solid var(--line); padding: 16px 18px; text-align: left; vertical-align: top; font-size: var(--text-sm); line-height: 1.5; }
    th { position: sticky; top: 0; background: var(--soft); color: var(--muted); font-size: var(--text-xs); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    tr:hover td { background: var(--primary-weak); }
    input, textarea, button, select { font: inherit; }
    input, textarea, select {
      width: 100%;
      min-height: var(--control-h);
      padding: 12px 16px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: var(--panel);
      color: var(--ink);
      transition: border-color .15s ease, box-shadow .15s ease, background-color .15s ease;
    }
    input::placeholder, textarea::placeholder { color: var(--muted); opacity: .85; }
    input:focus-visible, textarea:focus-visible, select:focus-visible { 
      outline: none; 
      border-color: var(--primary); 
      box-shadow: 0 0 0 4px var(--primary-weak); 
    }
    input[type="file"] { cursor: pointer; }
    input[type="checkbox"] { width: auto; accent-color: var(--primary); }
    textarea { min-height: 112px; border-radius: var(--radius-sm) !important; font-family: "Inter", "Segoe UI", system-ui, sans-serif; font-size: var(--text-sm); line-height: 1.6; }
    .prompt-editor { min-height: 68vh; font-family: "JetBrains Mono", Consolas, monospace; font-size: var(--text-sm); line-height: 1.7; }
    button {
      border: 0;
      background: var(--primary);
      color: white;
      min-height: var(--control-h);
      padding: 12px 20px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-weight: 600;
      white-space: nowrap;
      transition: background-color .15s ease, box-shadow .15s ease, transform .15s ease;
    }
    button:hover, button:focus-visible { 
      background: var(--primary-hover); 
      box-shadow: 0 0 0 4px var(--primary-weak); 
      outline: none; 
      transform: translateY(-1px); 
    }
    button:active, .button-link:active, .ghost-btn:active { transform: scale(.98); }
    button:disabled { cursor: not-allowed; opacity: .48; box-shadow: none; transform: none; }
    button:disabled:hover { background: var(--primary); box-shadow: none; transform: none; }
    .secondary-button { background: var(--soft); color: var(--ink); border: 1px solid var(--line); }
    .secondary-button:hover, .secondary-button:focus-visible { background: var(--primary-weak); border-color: color-mix(in srgb, var(--primary) 35%, var(--line)); box-shadow: 0 0 0 4px var(--primary-weak); }
    .danger { background: var(--danger); }
    .danger:hover, .danger:focus-visible { background: color-mix(in srgb, var(--danger) 88%, #000); box-shadow: 0 0 0 4px color-mix(in srgb, var(--danger) 18%, transparent); }
    .muted { color: var(--muted); font-size: var(--text-sm); line-height: 1.65; }
    .row { display: grid; grid-template-columns: minmax(0, 1fr) max-content; gap: 16px; align-items: end; }
    .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 22px; }
    .config-layout { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; align-items: start; }
    .config-column { display: grid; gap: 24px; align-content: start; }
    .config-full { margin-top: 24px; display: grid; gap: 24px; }
    .field { display: grid; gap: 10px; align-content: start; }
    .field label { font-size: var(--text-sm); font-weight: 600; color: var(--label); }
    .checkline { display: flex; gap: 12px; align-items: center; min-height: var(--control-h); }
    .switchline { display: flex; align-items: center; gap: 12px; min-height: var(--control-h); cursor: pointer; user-select: none; }
    .switchbox { min-height: var(--control-h); display: flex; align-items: center; padding: 0 0; }
    .switchline input { position: absolute; opacity: 0; pointer-events: none; }
    .switch-track { position: relative; width: 48px; height: 28px; flex: 0 0 auto; border-radius: 999px; background: #c5cdd8; transition: background .18s ease, box-shadow .18s ease; }
    .switch-track::after { content: ""; position: absolute; top: 4px; left: 4px; width: 20px; height: 20px; border-radius: 999px; background: #fff; box-shadow: 0 2px 6px rgba(15,23,42,.18); transition: transform .18s ease; }
    .switchline input:checked + .switch-track { background: var(--primary); }
    .switchline input:checked + .switch-track::after { transform: translateX(20px); }
    .switchline input:focus-visible + .switch-track { box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary) 22%, transparent); }
    .switch-label { font-size: var(--text-sm); font-weight: 600; color: var(--label); }
    .choice-grid { display: flex; flex-wrap: wrap; gap: 12px; }
    .choice-pill { display: inline-flex; align-items: center; gap: 8px; min-height: 42px; padding: 10px 14px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel); cursor: pointer; font-size: var(--text-sm); font-weight: 600; color: var(--label); transition: border-color .18s ease, background .18s ease, color .18s ease; }
    .choice-pill input { width: auto; min-height: 0; accent-color: var(--primary); }
    .choice-pill:has(input:checked) { background: var(--primary-weak); border-color: color-mix(in srgb, var(--primary) 45%, var(--line)); color: var(--primary); }
    .repeat-list { display: grid; gap: 10px; }
    .repeat-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(120px, .35fr) auto; gap: 12px; align-items: end; padding: 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--soft); }
    .repeat-row label { display: grid; gap: 6px; }
    .repeat-row label span { color: var(--muted); font-size: 11px; font-weight: 700; }
    .weekday-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .upload-card { display: grid; gap: 16px; }
    .upload-head { display: flex; justify-content: space-between; gap: 18px; align-items: start; }
    .upload-meta { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    .mini-pill { display: inline-flex; align-items: center; min-height: 28px; padding: 5px 10px; border-radius: 999px; background: #eef4ff; color: #1d3fb8; font-size: 12px; font-weight: 800; }
    .upload-zone {
      position: relative;
      display: grid;
      place-items: center;
      min-height: 188px;
      padding: 24px;
      border: 1.5px dashed #b8c5dc;
      border-radius: var(--radius);
      background: var(--soft);
      cursor: pointer;
      text-align: center;
      transition: border-color .18s ease, background .18s ease, box-shadow .18s ease, transform .18s ease;
    }
    .upload-zone:hover,
    .upload-zone:focus-within,
    .upload-zone.dragover {
      border-color: var(--primary);
      background: var(--panel);
      box-shadow: 0 2px 8px rgba(37,41,35,.04);
      transform: translateY(-1px);
    }
    .upload-input { position: absolute; inset: 0; width: 100%; height: 100%; min-height: 0; opacity: 0; cursor: pointer; }
    .upload-copy { display: grid; gap: 8px; pointer-events: none; }
    .upload-copy strong { font-size: 17px; font-weight: 850; color: var(--ink); }
    .upload-copy span { color: var(--muted); font-size: 13px; }
    .upload-actions { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
    .upload-list { display: grid; gap: 8px; }
    .upload-list:empty { display: none; }
    .upload-file {
      display: grid;
      grid-template-columns: minmax(0, 1fr) max-content;
      gap: 12px;
      align-items: center;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: var(--soft);
    }
    .upload-file strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
    .upload-file span { color: var(--muted); font-size: 12px; font-weight: 800; }
    .flow-list { display: grid; gap: 8px; margin-top: 4px; }
    .flow-item { padding: 11px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); color: var(--muted); font-size: 13px; }
    .flow-item strong { display: block; color: var(--ink); margin-bottom: 3px; }
    .flow-item.active { border-color: #9db4ff; background: var(--primary-weak); color: var(--ink); }
    .prompt-builder { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(360px, .95fr); gap: 18px; align-items: start; }
    .prompt-stack { display: grid; gap: 16px; }
    .prompt-card { background: var(--soft); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px; }
    .prompt-card textarea, textarea[data-prompt-field] { min-height: 64px; resize: vertical; font-family: "Inter", "Segoe UI", system-ui, sans-serif; font-size: 14px; line-height: 1.55; }
    .prompt-card .compact-area, textarea.compact-area[data-prompt-field] { min-height: 42px; }
    .textarea-sm { min-height: 60px; resize: vertical; }
    .textarea-md { min-height: 72px; resize: vertical; }
    .textarea-lg { min-height: 96px; resize: vertical; }
    .preset-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
    .preset-card { position: relative; display: grid; gap: 6px; padding: 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); cursor: pointer; transition: border-color .18s ease, background .18s ease, box-shadow .18s ease; }
    .preset-card:hover, .preset-card:focus-within { border-color: var(--primary); box-shadow: 0 2px 8px rgba(37,41,35,.04); }
    .preset-card input { position: absolute; opacity: 0; pointer-events: none; }
    .preset-card strong { font-size: 13px; color: var(--ink); }
    .preset-card span { color: var(--muted); font-size: 12px; line-height: 1.45; }
    .preset-card:has(input:checked) { background: var(--primary-weak); border-color: var(--primary); }
    .builder-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .prompt-preview-shell { position: sticky; top: 24px; display: grid; gap: 14px; }
    .prompt-preview { max-height: 620px; overflow: auto; padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: #0f172a; color: #e2e8f0; }
    .reply-style-intro { margin-bottom: 18px; padding: 18px 20px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--soft); }
    .reply-style-intro h2 { margin: 0 0 5px; font-size: 16px; }
    .reply-style-intro p { margin: 0; color: var(--muted); font-size: 13px; }
    .reply-style-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(330px, .78fr); gap: 20px; align-items: start; }
    .reply-style-sections { display: grid; gap: 12px; }
    .reply-style-section { margin: 0; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); overflow: hidden; }
    .reply-style-section > summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 13px; padding: 17px 18px; }
    .reply-style-section > summary::-webkit-details-marker { display: none; }
    .reply-style-section > summary::after { content: "+"; margin-left: auto; color: var(--muted); font-size: 20px; }
    .reply-style-section[open] > summary::after { content: "−"; }
    .reply-style-section[open] > summary { border-bottom: 1px solid var(--line); background: var(--soft); }
    .reply-step { display: grid; place-items: center; flex: 0 0 28px; width: 28px; height: 28px; border-radius: 999px; background: var(--primary-weak); color: var(--primary-strong); font-size: 12px; font-weight: 800; }
    .reply-style-section-title { min-width: 0; }
    .reply-style-section-title strong { display: block; font-size: 14px; }
    .reply-style-section-title small { display: block; margin-top: 2px; color: var(--muted); font-size: 12px; font-weight: 500; }
    .reply-style-body { display: grid; gap: 18px; padding: 20px; }
    .reply-style-advanced { margin-top: 4px; border-top: 1px dashed var(--line); padding-top: 14px; }
    .reply-style-advanced > summary { cursor: pointer; color: var(--muted); font-size: 13px; font-weight: 700; }
    .reply-style-preview { position: sticky; top: 18px; display: grid; gap: 12px; }
    .reply-style-preview .prompt-preview { max-height: min(62vh, 560px); }
    .reply-style-preview-actions { display: flex; justify-content: flex-end; }
    .reply-style-preview-actions a { color: var(--primary); font-size: 13px; font-weight: 700; text-decoration: none; }
    .reply-example { display: grid; gap: 9px; margin-top: 14px; padding: 14px; border-radius: 12px; background: #e9f0e8; }
    .reply-example-user, .reply-example-bot { max-width: 92%; padding: 9px 11px; border-radius: 12px; font-size: 13px; line-height: 1.45; }
    .reply-example-user { justify-self: end; background: #d9fdd3; color: #17311e; border-bottom-right-radius: 4px; }
    .reply-example-bot { justify-self: start; background: #fff; color: #1f2922; border-bottom-left-radius: 4px; }
    .prompt-guide { display: grid; gap: 12px; }
    .prompt-summary { display: grid; border-top: 1px solid var(--line); }
    .prompt-summary-row { display: grid; gap: 3px; padding: 11px 0; border-bottom: 1px solid var(--line); }
    .prompt-summary-row span { color: var(--muted); font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: .05em; text-transform: uppercase; }
    .prompt-summary-row strong { font-size: 13px; font-weight: 600; }
    .prompt-next { display: grid; gap: 8px; padding-top: 4px; }
    .prompt-next .button-link { justify-self: start; }
    .developer-lab { margin-top: 30px; border-top: 1px solid var(--ink); }
    .developer-lab > summary { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 52px; cursor: pointer; font-weight: 700; }
    .developer-lab > summary::after { content: "+"; color: var(--muted); font-size: 20px; }
    .developer-lab[open] > summary::after { content: "−"; }
    .developer-intro { max-width: 760px; margin: 0 0 20px; color: var(--muted); }
    .developer-compare { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
    .developer-pane { min-width: 0; border: 1px solid var(--line); background: var(--panel); }
    .developer-pane-head { min-height: 78px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
    .developer-pane-head strong, .developer-pane-head span { display: block; }
    .developer-pane-head span { margin-top: 4px; color: var(--muted); font-size: 12px; }
    .developer-tag { display: inline-flex !important; width: max-content; margin-bottom: 7px; padding: 2px 6px; border: 1px solid var(--line); color: var(--primary) !important; font-family: "IBM Plex Mono", monospace; font-size: 9px !important; letter-spacing: .06em; }
    .developer-pane .prompt-preview { max-height: 520px; margin: 0; border: 0; border-radius: var(--radius); }
    .developer-pane form { margin: 0; padding: 0; background: transparent; border: 0; }
    .developer-pane .prompt-editor { min-height: 420px; border: 0; border-radius: var(--radius); }
    .developer-pane-actions { display: flex; justify-content: flex-end; padding: 12px 14px; border-top: 1px solid var(--line); }
    .prompt-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
    .prompt-ai-status { color: var(--muted); font-size: 13px; font-weight: 700; }
    .prompt-ai-status.ok { color: var(--success); }
    .prompt-ai-status.error { color: var(--danger); }
    .prompt-ai-updated { animation: prompt-ai-updated 1.8s ease-out; }
    @keyframes prompt-ai-updated { 0% { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-weak); background: var(--primary-weak); } 100% { border-color: var(--line); box-shadow: none; background: var(--panel); } }
    .validator-list { display: grid; gap: 8px; margin-top: 10px; }
    .validator-item { display: flex; gap: 9px; align-items: start; color: var(--muted); font-size: 13px; }
    .validator-item::before { content: ""; width: 9px; height: 9px; margin-top: 6px; border-radius: 999px; background: #cbd5e1; flex: 0 0 auto; }
    .validator-item.ok { color: #166534; }
    .validator-item.ok::before { background: #22c55e; }
    .validator-item.warn { color: #92400e; }
    .validator-item.warn::before { background: #f59e0b; }
    .full { grid-column: 1 / -1; }
    .actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
    .actions form { display: grid; align-content: start; gap: 10px; }
    .settings-stack { display: grid; gap: 32px; }
    .settings-zone { display: grid; gap: 14px; }
    .settings-zone-head { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 18px; align-items: baseline; padding-bottom: 10px; border-bottom: 1px solid var(--ink); }
    .settings-zone-head span { color: var(--primary); font-family: "IBM Plex Mono", monospace; font-size: 10px; font-weight: 600; letter-spacing: .08em; }
    .settings-zone-head h2 { margin: 0; font-size: 15px; text-transform: uppercase; letter-spacing: .04em; }
    .settings-zone-head-primary { display: block; }
    .settings-zone-head-primary h2 { font-size: 17px; text-transform: none; letter-spacing: 0; }
    .env-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; align-items: start; }
    .env-grid-single { grid-template-columns: minmax(0, 1fr); }
    .env-column { display: grid; align-content: start; gap: 20px; min-width: 0; }
    .env-card { min-width: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 24px; box-shadow: 0 4px 24px rgba(0,0,0,0.03); margin: 0; }
    .env-grid > .env-card { margin-top: 0; }
    .env-column .env-card:first-child { margin-top: 0; }
    .env-card h2 { margin-top: 0; margin-bottom: 24px; font-family: "IBM Plex Mono", monospace; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--ink); border-bottom: 1px solid var(--line); padding-bottom: 14px; }
    .env-card .field { margin-bottom: 20px; }
    .env-card .field:last-child { margin-bottom: 0; }
    .ai-env-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 28px; align-items: start; }
    .ai-env-fields .field { min-width: 0; }
    .env-card label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 8px; color: var(--ink); }
    .env-card input:not([type="hidden"]), .env-card select, .env-card textarea { width: 100%; box-sizing: border-box; height: 42px; border-radius: 8px; padding: 0 14px; font-size: 14px; border: 1px solid var(--line); background: var(--soft); color: var(--ink); transition: border-color .15s ease, box-shadow .15s ease, background-color .15s ease; outline: none; }
    .env-card input:focus, .env-card select:focus, .env-card textarea:focus { border-color: var(--primary); background: var(--panel); box-shadow: 0 0 0 3px var(--primary-weak); }
    .env-card .muted { margin-top: 8px; font-size: 12.5px; line-height: 1.5; }
    .env-card .connection-test { margin-top: 12px; }
    .field-resource { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 8px; color: var(--muted); font-size: var(--text-xs); }
    .field-resource a { color: var(--primary); font-weight: 700; text-decoration: none; }
    .field-resource a:hover, .field-resource a:focus-visible { text-decoration: underline; outline: none; }
    .key-editor { display: grid; gap: 14px; margin-top: 4px; }
    .key-editor-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .key-count { color: var(--muted); font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: .06em; text-transform: uppercase; }
    .key-list { display: grid; gap: 10px; }
    .key-row { display: grid; grid-template-columns: 48px minmax(0, 1fr) auto; gap: 12px; align-items: center; min-width: 0; padding: 14px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel); }
    .key-index { color: var(--muted); font-family: "IBM Plex Mono", monospace; font-size: 10px; letter-spacing: .05em; }
    .key-input { min-width: 0; height: 42px; font-family: "IBM Plex Mono", monospace; font-size: 12px; }
    .key-actions { display: flex; gap: 8px; align-items: center; }
    .key-actions button { min-width: 40px; min-height: 40px; padding: 7px 10px; border: 0; background: var(--soft); color: var(--muted); box-shadow: none; }
    .key-actions button:hover, .key-actions button:focus-visible { border-color: var(--primary); background: var(--primary-weak); color: var(--ink); box-shadow: none; transform: none; }
    .key-actions button:disabled { opacity: .35; cursor: not-allowed; }
    .key-actions .key-remove { color: var(--danger); }
    .key-confirm { grid-column: 2 / -1; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 10px; padding-top: 12px; border-top: 1px solid var(--line); }
    .key-confirm span { margin-right: auto; color: var(--danger); font-size: 12px; }
    .key-confirm button { min-height: 40px; }
    .key-empty { padding: 20px 0; color: var(--muted); font-size: 12px; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    .key-editor-error { margin: 0; color: var(--danger); font-size: 12px; }
    .key-add { justify-self: start; }
    .connection-test { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--line); }
    .connection-test .muted { margin: 0; }
    .key-editor-head .connection-test, .field > .row .connection-test { flex: 0 0 auto; margin: 0; padding: 0; border: 0; }
    .key-editor-head .connection-test .muted, .field > .row .connection-test .muted { display: none; }
    .detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--ink); }
    .detail-row { display: grid; grid-template-columns: minmax(120px, .7fr) minmax(0, 1.3fr); gap: 14px; padding: 13px 0; border-bottom: 1px solid var(--line); }
    .detail-row:nth-child(odd) { padding-right: 22px; border-right: 1px solid var(--line); }
    .detail-row:nth-child(even) { padding-left: 22px; }
    .detail-row span { color: var(--muted); font-size: 12px; }
    .detail-row strong { overflow-wrap: anywhere; }
    .simulator-page-head { display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; gap: 18px; align-items: center; padding: 0 0 22px; margin-bottom: 28px; border-bottom: 1px solid var(--ink); }
    .simulator-page-copy h1 { margin-bottom: 3px; }
    .simulator-page-copy p { margin: 0; color: var(--muted); }
    .simulator-contact { display: flex; align-items: center; gap: 10px; min-width: 0; padding-left: 18px; border-left: 1px solid var(--line); }
    .simulator-avatar { width: 38px; height: 38px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 50%; background: var(--primary-weak); color: var(--primary); font-family: "IBM Plex Mono", monospace; font-weight: 700; }
    .simulator-contact-copy { min-width: 0; }
    .simulator-contact-copy strong, .simulator-contact-copy span { display: block; }
    .simulator-contact-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .simulator-contact-copy span { color: var(--muted); font-size: 11px; }
    .simulator-shell { max-width: 920px; margin: 0 auto; border: 1px solid var(--line); border-radius: var(--radius); background: #e7e2d8; overflow: hidden; }
    .simulator-chat { min-height: 420px; display: flex; flex-direction: column; justify-content: flex-end; gap: 10px; padding: 28px 24px; background: #e5ddd5; }
    .sim-message { max-width: min(76%, 680px); padding: 9px 12px 7px; color: #111; border-radius: 7px; box-shadow: 0 1px 1px rgba(0,0,0,.08); }
    .sim-message.customer { align-self: flex-end; background: #dcf8c6; border-top-right-radius: 2px; }
    .sim-message.bot { align-self: flex-start; background: #fff; border-top-left-radius: 2px; }
    .sim-message.error { align-self: center; max-width: 90%; background: #fff4df; border: 1px solid #d6a64c; }
    .sim-message p { margin: 0; white-space: pre-wrap; }
    .sim-time { display: block; margin-top: 4px; color: #6f7775; font-size: 9px; text-align: right; }
    .sim-typing { display: inline-flex; align-items: center; gap: 4px; min-width: 48px; min-height: 20px; }
    .sim-typing span { width: 6px; height: 6px; border-radius: 50%; background: #7f8986; animation: typing-dot 1.15s infinite ease-in-out; }
    .sim-typing span:nth-child(2) { animation-delay: .15s; }
    .sim-typing span:nth-child(3) { animation-delay: .3s; }
    @keyframes typing-dot { 0%, 60%, 100% { transform: translateY(0); opacity: .45; } 30% { transform: translateY(-4px); opacity: 1; } }
    .simulator-compose { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: end; padding: 12px; background: #f0f0f0; }
    .simulator-compose textarea { min-height: 46px; max-height: 130px; resize: vertical; border-radius: 22px; background: #fff; padding: 12px 16px; }
    .simulator-send { width: 46px; min-width: 46px; height: 46px; min-height: 46px; padding: 0; display: grid; place-items: center; border-radius: 50%; background: #128c7e; }
    .simulator-send .ui-icon { width: 20px; height: 20px; }
    .simulator-send:disabled { opacity: .55; cursor: wait; }
    .simulator-foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px 16px; padding: 10px 14px; border-top: 1px solid #d2d2d2; background: #f7f7f7; color: #656b69; font-size: 11px; }
    .simulator-reset { min-height: auto; padding: 0; border: 0; background: transparent; color: inherit; font-size: 11px; font-weight: 700; box-shadow: none; }
    .simulator-reset:hover, .simulator-reset:focus-visible { background: transparent; color: var(--primary); box-shadow: none; transform: none; text-decoration: underline; }
    .simulator-toolbar { max-width: 920px; display: flex; justify-content: flex-end; margin: 0 auto 10px; }
    .simulator-toolbar .simulator-reset { min-height: 40px; padding: 8px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel); color: var(--ink); font-size: 12px; }
    .simulator-toolbar .simulator-reset:hover, .simulator-toolbar .simulator-reset:focus-visible { background: var(--primary-weak); border-color: var(--primary); text-decoration: none; }
    html[data-theme="dark"] .simulator-shell { border-color: #34413e; }
    html[data-theme="dark"] .simulator-chat { background: #17201e; }
    html[data-theme="dark"] .simulator-compose, html[data-theme="dark"] .simulator-foot { background: #202826; border-color: #34413e; color: #aeb9b5; }
    html[data-theme="dark"] .simulator-compose textarea { background: #2a3331; color: #f0f4f2; border-color: #3d4946; }
    html[data-theme="dark"] .sim-message.bot { background: #26312e; color: #eef2ef; }
    html[data-theme="dark"] .sim-message.customer { background: #16443b; color: #eef6f2; }
    dialog::backdrop {
      background: rgba(0, 0, 0, 0.6) !important;
      backdrop-filter: blur(6px) !important;
    }
    dialog {
      background: var(--panel) !important;
      color: var(--ink) !important;
      border: 1px solid var(--line) !important;
      border-radius: var(--radius-md) !important;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.35) !important;
    }
    dialog#waQrModal {
      border: 1px solid var(--line) !important;
      border-radius: 28px !important;
      padding: 0 !important;
      max-width: 500px !important;
      width: 90% !important;
      max-height: calc(100dvh - 24px) !important;
      background: var(--panel) !important;
      color: var(--ink) !important;
      box-shadow: 0 30px 70px -15px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05) !important;
      overflow: hidden !important;
      margin: auto !important;
      outline: none !important;
    }
    dialog#waQrModal > .wa-qr-modal-body { max-height: calc(100dvh - 24px); overflow-y: auto; overscroll-behavior: contain; }
    dialog#waQrModal::backdrop {
      background: rgba(15, 23, 20, 0.75) !important;
      backdrop-filter: blur(8px) !important;
      -webkit-backdrop-filter: blur(8px) !important;
    }
    .sandbox-citations { align-self: flex-start; display: flex; flex-direction: column; gap: 4px; margin: -2px 0 6px; font-size: 11px; }
    .sandbox-citations-title { color: var(--muted); font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
    .citation-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .citation-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: var(--radius-sm); background: var(--panel); border: 1px solid var(--line); color: var(--muted); font-family: "IBM Plex Mono", monospace; font-size: 10px; font-weight: 500; }
    .backup-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .maintenance-layout { display: grid; gap: 32px; margin-top: 28px; }
    .maintenance-block { border-top: 1px solid var(--ink); }
    .maintenance-heading { display: grid; grid-template-columns: 44px minmax(0,1fr); gap: 14px; padding: 16px 0 18px; }
    .maintenance-index { color: var(--primary); font-family: "IBM Plex Mono", monospace; font-size: 10px; font-weight: 600; letter-spacing: .08em; }
    .maintenance-heading h2 { margin: 0 0 5px; font-size: 17px; }
    .maintenance-heading p { margin: 0; }
    .maintenance-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 14px; }
    .maintenance-card { min-width: 0; padding: 18px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); overflow: hidden; }
    .maintenance-card h3 { margin: 0 0 6px; font-size: 14px; }
    .maintenance-card p { min-height: 40px; margin: 0 0 16px; }
    .maintenance-card .row { align-items: stretch; gap: 8px; }
    .maintenance-card input { min-width: 0; flex: 1 1 180px; }
    .maintenance-card button { flex: 0 0 auto; }
    .maintenance-card.danger-zone { border-left: 3px solid var(--danger); }
    .backup-grid { display: grid; grid-template-columns: minmax(0,.8fr) minmax(0,1.2fr); gap: 14px; }
    .backup-card { display: flex; min-width: 0; flex-direction: column; align-items: flex-start; padding: 20px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); }
    .backup-card h3 { margin: 0 0 6px; font-size: 15px; }
    .backup-card p { margin: 0 0 18px; color: var(--muted); font-size: 13px; line-height: 1.55; }
    .backup-card form { width: 100%; }
    .backup-card input[type="file"] { width: 100%; min-width: 0; margin-bottom: 10px; padding: 10px; border: 1px dashed var(--line); border-radius: var(--radius-sm); background: var(--soft); }
    .backup-card .button-link { margin-top: auto; }
    .safe-note { display: flex; gap: 10px; align-items: flex-start; margin-top: 14px; padding: 12px 14px; border-left: 3px solid var(--primary); border-radius: var(--radius-sm); background: var(--primary-weak); color: var(--muted); font-size: 12px; line-height: 1.5; }
    .session-transition { position: fixed; inset: 0; z-index: 120; display: grid; place-items: center; padding: 20px; background: color-mix(in srgb,var(--bg) 92%,transparent); opacity: 0; visibility: hidden; transition: opacity .18s ease,visibility .18s ease; }
    .session-transition.active { opacity: 1; visibility: visible; }
    .session-transition-card { display: grid; justify-items: center; gap: 12px; text-align: center; }
    .session-spinner { width: 28px; height: 28px; border: 2px solid var(--line); border-top-color: var(--primary); border-radius: 50%; animation: session-spin .7s linear infinite; }
    @keyframes session-spin { to { transform: rotate(360deg); } }
    .health-list { display: grid; border-top: 1px solid var(--line); }
    .health-item { display: grid; grid-template-columns: minmax(120px, .6fr) minmax(0, 1fr) auto; gap: 14px; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--line); }
    .config-section { margin-top: 24px; border: 1px solid var(--line); border-radius: var(--radius); background: transparent; overflow: hidden; }
    .config-section > summary { cursor: pointer; list-style: none; display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 20px 22px; color: var(--ink); font-size: 15px; font-weight: 700; }
    .config-section > summary::-webkit-details-marker { display: none; }
    .config-section > summary::after { content: "+"; color: var(--muted); font-size: 21px; line-height: 1; font-weight: 500; }
    .config-section[open] > summary { border-bottom: 1px solid var(--line); background: var(--soft); }
    .config-section[open] > summary::after { content: "−"; }
    .config-section-body { display: grid; gap: 24px; padding: 24px; }
    .config-section-copy { display: block; margin-top: 3px; color: var(--muted); font-size: var(--text-xs); font-weight: 500; }
    .password-field { position: relative; display: grid; }
    .password-field input { padding-right: 88px; }
    .password-toggle { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); min-height: 32px; padding: 6px 10px; border: 0; border-radius: 8px; background: var(--soft); color: var(--muted); font-size: 12px; font-weight: 800; box-shadow: none; }
    .password-toggle:hover, .password-toggle:focus-visible { background: var(--primary-weak); color: var(--ink); transform: translateY(-50%); box-shadow: none; }
    button[data-loading="1"] { position: relative; color: transparent !important; pointer-events: none; }
    button[data-loading="1"]::after { content: ""; position: absolute; inset: 0; margin: auto; width: 16px; height: 16px; border-radius: 999px; border: 2px solid rgba(255,255,255,.35); border-top-color: #fff; animation: spin .7s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .filter-tabs { display: flex; flex-wrap: wrap; gap: 0; margin: 0 0 16px; border-bottom: 1px solid var(--line); }
    .filter-tab { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 8px 16px; border-radius: var(--radius-sm); border: 1px solid transparent; background: transparent; color: var(--muted); text-decoration: none; font-family: "IBM Plex Mono", monospace; font-size: 11px; font-weight: 600; margin-right: 4px; }
    .filter-tab:hover, .filter-tab:focus-visible { border-color: var(--primary); color: var(--ink); outline: 3px solid color-mix(in srgb, var(--primary) 16%, transparent); }
    .filter-tab.active { background: transparent; color: var(--ink); box-shadow: inset 0 -3px 0 var(--primary); }
    .filter-tab .count { min-width: 20px; text-align: center; opacity: .85; }
    .chat-head { position: sticky; top: 0; z-index: 5; display: flex; justify-content: space-between; gap: 14px; align-items: start; flex-wrap: wrap; padding: 14px 0 12px; margin-bottom: 12px; background: var(--bg); border-bottom: 1px solid var(--line); }
    .mobile-cards { display: none; }
    .mobile-card { display: grid; gap: 8px; padding: 16px 0; border-bottom: 1px solid var(--line); background: transparent; }
    .mobile-card .card-title { font-weight: 800; font-size: 14px; }
    .mobile-card .card-meta { color: var(--muted); font-size: 12px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .env-card summary { cursor: pointer; color: var(--ink); font-size: 16px; font-weight: 800; margin-bottom: 12px; }
    .env-card h2 { margin-bottom: 12px; }
    .notice { background: #ecfeff; border: 1px solid #bae6fd; color: #155e75; border-radius: 12px; padding: 13px 15px; margin-bottom: 18px; font-size: 13px; }
    .guide { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; margin-bottom: 20px; box-shadow: var(--shadow); }
    .guide strong { display: block; margin-bottom: 6px; font-size: 14px; }
    form.advanced { padding: 0; overflow: hidden; }
    details.advanced { padding: 0; overflow: hidden; }
    details.advanced summary { cursor: pointer; padding: 18px 22px; font-weight: 800; }
    details.advanced textarea { border-radius: var(--radius-sm); border-left: 0; border-right: 0; }
    details.advanced p { padding: 0 20px 14px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; font-family: "JetBrains Mono", Consolas, monospace; font-size: 12px; line-height: 1.55; }
    html[data-theme="dark"] header { background: #121719; border-right-color: var(--line); }
    html[data-theme="dark"] .brand { border-bottom-color: var(--line); }
    html[data-theme="dark"] .theme-panel { border-top-color: var(--line); }
    html[data-theme="dark"] .theme-options { background: transparent; border-color: var(--line); }
    html[data-theme="dark"] .theme-options button { color: var(--muted); }
    html[data-theme="dark"] .theme-options button:hover { background: rgba(255,255,255,.05); }
    html[data-theme="dark"] .theme-options button:focus-visible { background: transparent; }
    html[data-theme="dark"] .panel,
    html[data-theme="dark"] form,
    html[data-theme="dark"] .stat,
    html[data-theme="dark"] .table-shell,
    html[data-theme="dark"] .guide,
    html[data-theme="dark"] .guide-card,
    html[data-theme="dark"] .env-card {
      background: var(--panel);
      border-color: var(--line);
    }
    html[data-theme="dark"] .hero { border-bottom-color: var(--line); }
    html[data-theme="dark"] .table-tools,
    html[data-theme="dark"] th { background: var(--soft); color: #cbd3cd; }
    html[data-theme="dark"] td,
    html[data-theme="dark"] th { border-bottom-color: var(--line); }
    html[data-theme="dark"] tr:hover td { background: #29322c; }
    html[data-theme="dark"] input,
    html[data-theme="dark"] textarea,
    html[data-theme="dark"] select {
      background: #171b18;
      border-color: #3b443d;
      color: var(--ink);
    }
    html[data-theme="dark"] input::placeholder,
    html[data-theme="dark"] textarea::placeholder { color: #778179; }
    html[data-theme="dark"] .field label,
    html[data-theme="dark"] .switch-label,
    html[data-theme="dark"] .flow-item strong,
    html[data-theme="dark"] .guide strong,
    html[data-theme="dark"] .env-card summary { color: var(--ink); }
    html[data-theme="dark"] .flow-item,
    html[data-theme="dark"] .choice-pill,
    html[data-theme="dark"] .prompt-card,
    html[data-theme="dark"] .preset-card { background: #191d1a; border-color: #3b443d; color: #cbd3cd; }
    html[data-theme="dark"] .preset-card strong { color: var(--ink); }
    html[data-theme="dark"] .flow-item.active,
    html[data-theme="dark"] .choice-pill:has(input:checked),
    html[data-theme="dark"] .preset-card:has(input:checked) { background: #293d34; border-color: #6f9f8d; color: #dcebe3; }
    html[data-theme="dark"] .secondary-button { background: var(--soft); color: var(--ink); }
    html[data-theme="dark"] .secondary-button:hover,
    html[data-theme="dark"] .secondary-button:focus-visible { background: var(--primary-weak); }
    html[data-theme="dark"] .validator-item.ok { color: #86efac; }
    html[data-theme="dark"] .validator-item.warn { color: #fcd34d; }
    html[data-theme="dark"] .mini-pill { background: #293d34; color: #dcebe3; }
    html[data-theme="dark"] .upload-zone { border-color: var(--line); background: var(--soft); }
    html[data-theme="dark"] .upload-zone:hover,
    html[data-theme="dark"] .upload-zone:focus-within,
    html[data-theme="dark"] .upload-zone.dragover {
      border-color: var(--primary);
      background: var(--panel);
    }
    html[data-theme="dark"] .upload-file { background: var(--soft); border-color: var(--line); }
    html[data-theme="dark"] .notice { background: #0f2830; border-color: #155e75; color: #a5f3fc; }
    html[data-theme="dark"] .switch-track { background: #475569; }
    html[data-theme="dark"] form.advanced { background: var(--panel); border-color: var(--line); }
    .skip-link { position: absolute; left: -999px; top: 8px; z-index: 100; background: var(--primary); color: #fff; padding: 10px 14px; border-radius: 10px; }
    .skip-link:focus { left: 12px; }
    .sr-only { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important; }
    .nav-icon { width: 18px; height: 18px; flex: 0 0 auto; opacity: .9; font-size: 18px; }
    nav a { display: flex; align-items: center; gap: 10px; }
    .menu-toggle { display: none; border: 1px solid #465046; background: transparent; color: #eef1ec; min-height: 44px; padding: 8px 12px; border-radius: var(--radius-sm); font-weight: 700; }
    .badge-pill { display: inline-flex; align-items: center; min-height: 22px; padding: 2px 7px; border-radius: 2px; font-family: "IBM Plex Mono", monospace; font-size: 10px; font-weight: 600; letter-spacing: .04em; border: 1px solid transparent; white-space: nowrap; text-transform: uppercase; }
    .tone-neutral { background: #ecece7; color: #555d54; border-color: #d9dad3; }
    .tone-ok { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
    .tone-warn { background: #fffbeb; color: #b45309; border-color: #fde68a; }
    .tone-danger { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }
    .tone-info { background: #e9efec; color: #315f4d; border-color: #cbdad2; }
    .chat-thread { display: grid; gap: 10px; max-height: 70vh; overflow: auto; padding: 4px; }
    .chat-bubble { max-width: min(720px, 92%); padding: 12px 14px; border-radius: 14px; border: 1px solid var(--line); background: var(--soft); }
    .chat-bubble.user { justify-self: start; border-color: #d8d9d2; background: #f0eee8; }
    .chat-bubble.assistant { justify-self: end; border-color: #cbdad2; background: #e8f0eb; }
    .chat-bubble .meta { display: flex; gap: 10px; align-items: center; margin-bottom: 6px; font-size: 11px; font-weight: 800; color: var(--muted); text-transform: uppercase; }
    .chat-bubble .body { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.55; }
    .chat-date-separator { display: flex; align-items: center; gap: 12px; color: var(--muted); font-size: 11px; font-weight: 700; text-transform: capitalize; }
    .chat-date-separator::before, .chat-date-separator::after { content: ""; height: 1px; flex: 1; background: var(--line); }
    .chat-date-separator span { padding: 4px 9px; border: 1px solid var(--line); border-radius: 999px; background: var(--panel); }
    html[data-theme="dark"] .chat-bubble.user { background: #262b26; border-color: #3a413a; }
    html[data-theme="dark"] .chat-bubble.assistant { background: #26362e; border-color: #3d584a; }
    .status-grid { 
      display: grid; 
      grid-template-columns: repeat(3, minmax(0, 1fr)); 
      gap: 16px; 
      margin-bottom: 24px; 
      border: 0; 
      background: transparent; 
      border-radius: 0; 
      overflow: visible; 
      box-shadow: none; 
    }
    .status-card { 
      display: grid; 
      grid-template-columns: auto minmax(0, 1fr); 
      column-gap: 12px; 
      align-items: center; 
      padding: var(--space-sm) var(--space); 
      border: 1px solid var(--line); 
      border-radius: var(--radius); 
      background: var(--panel); 
      box-shadow: 
        0 0 0 4px var(--soft), 
        0 0 0 5px var(--line), 
        var(--shadow); 
      transition: background-color .15s ease, border-color .15s ease, transform .15s ease;
    }
    .status-card:hover {
      transform: translateY(-2px);
      box-shadow: 
        0 0 0 4px var(--soft), 
        0 0 0 5px var(--primary-weak), 
        var(--shadow); 
    }
    .status-card .label { color: var(--muted); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .status-card .value { margin-top: 2px; font-size: 15px; font-weight: 700; }
    .status-card .muted { grid-column: 2; margin: 2px 0 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .status-card .status-detail-wrap { max-width: 100%; white-space: normal; overflow-wrap: anywhere; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-height: 1.35; }
    .status-dot { width: 10px; height: 10px; border-radius: 999px; background: #94a3b8; box-shadow: 0 0 0 4px rgba(148,163,184,.15); }
    .status-dot.ok { background: #10b981; box-shadow: 0 0 0 4px rgba(16,185,129,.16); }
    .status-dot.warn { background: #f59e0b; box-shadow: 0 0 0 4px rgba(245,158,11,.16); }
    .status-dot.danger { background: #ef4444; box-shadow: 0 0 0 4px rgba(239,68,68,.16); animation: pulse 1.4s ease infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .55; } }
    .split-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
    .ops-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(300px, .85fr); gap: 18px; align-items: stretch; }
    .panel-head { display: flex; justify-content: space-between; align-items: center; gap: 14px; margin-bottom: 12px; }
    .panel-head h2 { margin: 0; }
    .panel-link { color: var(--primary); font-size: 12px; font-weight: 700; text-decoration: none; }
    .panel-link:hover, .panel-link:focus-visible { text-decoration: underline; outline: none; }
    .timeline { position: relative; display: grid; }
    .timeline-item { position: relative; display: grid; grid-template-columns: 14px minmax(0, 1fr); gap: 12px; padding: 10px 0; }
    .timeline-item:not(:last-child)::after { content: ""; position: absolute; top: 25px; bottom: -10px; left: 5px; width: 1px; background: var(--line); }
    .timeline-dot { width: 11px; height: 11px; margin-top: 5px; border-radius: 50%; background: var(--primary); box-shadow: 0 0 0 4px var(--primary-weak); }
    .timeline-dot.danger { background: var(--danger); box-shadow: 0 0 0 4px color-mix(in srgb, var(--danger) 10%, var(--panel)); }
    .timeline-copy { min-width: 0; }
    .timeline-copy strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .timeline-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 3px; color: var(--muted); font-size: 12px; }
    .distribution { display: grid; gap: 16px; }
    .order-total { display: flex; align-items: end; justify-content: space-between; gap: 16px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
    .order-total span { color: var(--muted); font-family: "IBM Plex Mono", monospace; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
    .order-total strong { font-family: "IBM Plex Mono", monospace; font-size: 30px; font-weight: 500; line-height: 1; }
    .order-bars { display: grid; gap: 13px; }
    .order-bar { display: grid; grid-template-columns: 94px minmax(80px, 1fr) 28px; gap: 10px; align-items: center; font-size: 12px; }
    .order-bar > span:first-child { color: var(--muted); }
    .bar-track { height: 5px; background: var(--soft); overflow: hidden; }
    .bar-fill { height: 100%; background: var(--primary); }
    .bar-fill.warn { background: var(--warn); }
    .bar-fill.danger { background: var(--danger); }
    .bar-fill.success { background: var(--success); }
    .order-bar strong { font-family: "IBM Plex Mono", monospace; font-size: 12px; text-align: right; }
    .legend { display: grid; gap: 10px; }
    .legend-item { display: grid; grid-template-columns: 9px minmax(0, 1fr) auto; gap: 9px; align-items: center; color: var(--muted); font-size: 12px; }
    .legend-item strong { color: var(--ink); }
    .legend-swatch { width: 9px; height: 9px; border-radius: 3px; background: var(--muted); }
    .legend-swatch.draft { background: var(--warn); }
    .legend-swatch.waiting { background: var(--danger); }
    .legend-swatch.paid { background: var(--success); }
    .setup-progress { display: grid; gap: 9px; padding-top: 16px; border-top: 1px solid var(--line); }
    .progress-head { display: flex; justify-content: space-between; gap: 12px; color: var(--muted); font-size: 12px; }
    .progress-head strong { color: var(--ink); }
    .progress-track { height: 7px; overflow: hidden; border-radius: 4px; background: var(--soft); }
    .progress-fill { height: 100%; border-radius: inherit; background: var(--primary); }
    .attention-panel { margin-bottom: 28px; border-bottom: 1px solid var(--line); }
    .attention-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 13px 0; }
    .attention-head h2 { margin: 0; font-size: 15px; }
    .attention-head span { color: var(--muted); font-family: "IBM Plex Mono", monospace; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
    .attention-list { display: grid; }
    .attention-item { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 14px 0; border-top: 1px solid var(--line); }
    .attention-index { color: var(--primary); font-family: "IBM Plex Mono", monospace; font-size: 10px; }
    .attention-copy strong { display: block; }
    .attention-copy span { display: block; margin-top: 2px; color: var(--muted); font-size: 12px; }
    .setup-shell { margin-bottom: 28px; }
    .setup-shell[hidden] { display: none; }
    .setup-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 12px; }
    .setup-heading .section-head { margin: 0; }
    .setup-toggle { flex: 0 0 auto; }
    .setup-reveal { display: none; margin-bottom: 28px; }
    .setup-reveal.visible { display: inline-flex; }
    .setup-list { display: grid; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; background: var(--panel); }
    .setup-step { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 13px 15px; border-bottom: 1px solid var(--line); }
    .setup-step:last-child { border-bottom: 0; }
    .setup-mark { width: 20px; height: 20px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 4px; color: var(--muted); font-family: "IBM Plex Mono", monospace; font-size: 10px; }
    .setup-step.done .setup-mark { border-color: var(--success); color: var(--success); }
    .setup-mark .ui-icon { width: 14px; height: 14px; }
    .setup-step strong { display: block; font-size: 13px; }
    .setup-step span { display: block; color: var(--muted); font-size: 12px; }
    .recent-list { display: grid; gap: 10px; }
    .recent-item { display: grid; gap: 4px; padding: 13px 0; border-bottom: 1px solid var(--line); background: transparent; }
    .recent-item:last-child { border-bottom: 0; }
    .recent-item strong { font-size: 13px; }
    .recent-meta { color: var(--muted); font-size: 12px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .panel-action { margin: 18px 0 0; }
    .inline-form-end { display: flex; justify-content: flex-end; }
    .chat-title { margin: 0 0 6px; }
    .chat-jid { margin: 0; }
    .chat-count { margin: 6px 0 0; }
    .conversation-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .conversation-card { display: grid; gap: 12px; padding: 16px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); box-shadow: var(--shadow); }
    .conversation-card-head, .conversation-card-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .conversation-card strong { display: block; overflow-wrap: anywhere; }
    .conversation-phone { margin-top: 3px; color: var(--muted); font-family: "IBM Plex Mono", monospace; font-size: 12px; }
    .conversation-metadata { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .conversation-metadata span { display: grid; gap: 3px; color: var(--muted); font-size: 11px; }
    .conversation-metadata small { font-family: "IBM Plex Mono", monospace; font-size: 9px; letter-spacing: .07em; text-transform: uppercase; }
    .empty-state { display: grid; gap: 10px; place-items: start; min-width: 0; max-width: 100%; padding: 28px 22px; background: var(--panel); border: 1px dashed var(--line); border-radius: 14px; overflow: hidden; }
    .empty-state p { max-width: 64ch; margin: 0; overflow-wrap: anywhere; }
    .empty-state-icon { display: grid; place-items: center; width: 38px; height: 38px; color: var(--success); }
    .empty-state-icon .ui-icon { width: 28px; height: 28px; }
    .button-link, a.button-link { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 10px 16px; border-radius: var(--radius-sm); background: var(--primary); color: #fff; text-decoration: none; font-weight: 700; }
    .button-link:hover, .button-link:focus-visible { background: var(--primary-hover); outline: 3px solid color-mix(in srgb, var(--primary) 18%, transparent); }
    .row-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .row-actions form { margin: 0; padding: 0; border: 0; box-shadow: none; background: transparent; }
    .row-actions button, .ghost-btn, a.ghost-btn { min-height: 40px; padding: 8px 11px; border-radius: var(--radius-sm); font-size: 12px; }
    .ghost-btn, a.ghost-btn { background: var(--soft); color: var(--ink); border: 1px solid var(--line); cursor: pointer; font-weight: 700; text-decoration: none; display: inline-flex; align-items: center; }
    .ghost-btn:hover, a.ghost-btn:hover, .ghost-btn:focus-visible, a.ghost-btn:focus-visible { background: var(--primary-weak); border-color: var(--primary); outline: 3px solid color-mix(in srgb, var(--primary) 14%, transparent); }
    .toast { position: fixed; top: 18px; right: 18px; z-index: 50; min-width: 240px; max-width: min(420px, calc(100vw - 32px)); padding: 12px 14px; border-radius: 12px; border: 1px solid transparent; box-shadow: 0 16px 40px rgba(15,23,42,.16); font-size: 13px; font-weight: 700; animation: toast-in .2s ease; }
    .toast.tone-ok { background: #ecfdf5; color: #065f46; border-color: #a7f3d0; }
    .toast.tone-warn { background: #fffbeb; color: #92400e; border-color: #fde68a; }
    .toast.tone-error { background: #fef2f2; color: #991b1b; border-color: #fecaca; }
    @keyframes toast-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
    .modal-backdrop { position: fixed; inset: 0; z-index: 60; display: none; place-items: center; padding: 18px; background: rgba(15,23,42,.48); }
    .modal-backdrop.open { display: grid; }
    .modal { width: min(440px, 100%); background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: 16px; padding: 20px; box-shadow: 0 24px 60px rgba(0,0,0,.28); }
    .modal h3 { margin: 0 0 8px; }
    .modal p { margin: 0 0 16px; color: var(--muted); }
    .modal-actions { display: flex; justify-content: flex-end; gap: 10px; }
    .cell-muted { color: var(--muted); font-size: 12px; }
    td:nth-last-child(1) { white-space: nowrap; }
    .mono { font-family: Consolas, "JetBrains Mono", monospace; font-size: 12px; }
    html[data-theme="dark"] .tone-neutral { background: #30342f; color: #d8ddd9; border-color: #454b46; }
    html[data-theme="dark"] .tone-ok { background: #19372b; color: #92d5b3; border-color: #32684f; }
    html[data-theme="dark"] .tone-warn { background: #3d321f; color: #e7c78f; border-color: #715c35; }
    html[data-theme="dark"] .tone-danger { background: #442626; color: #efb0b0; border-color: #784545; }
    html[data-theme="dark"] .tone-info { background: #253633; color: #a9d6ce; border-color: #45655f; }
    html[data-theme="dark"] .ghost-btn, html[data-theme="dark"] a.ghost-btn { background: var(--soft); color: var(--ink); }
    html[data-theme="dark"] .ghost-btn:hover, html[data-theme="dark"] a.ghost-btn:hover { background: var(--primary-weak); }
    html[data-theme="dark"] .stat.urgent { background: color-mix(in srgb, var(--danger) 9%, var(--panel)); border-color: #704848; }
    html[data-theme="dark"] .password-toggle { background: #242925; color: #cbd3cd; }
    html[data-theme="dark"] .filter-tab { background: transparent; }
    html[data-theme="dark"] .filter-tab.active { background: transparent; color: var(--ink); }
    html[data-theme="dark"] .choice-pill { background: var(--soft); border-color: var(--line); color: var(--ink); }
    html[data-theme="dark"] .choice-pill:has(input:checked) { background: #293d34; border-color: #6f9f8d; color: #dcebe3; }
    html[data-theme="dark"] .table-tools,
    html[data-theme="dark"] th { background: var(--soft); }
    html[data-theme="dark"] .hero { border-bottom-color: var(--line); }
    html[data-theme="dark"] .upload-zone,
    html[data-theme="dark"] .prompt-card,
    html[data-theme="dark"] .env-card,
    html[data-theme="dark"] .flow-item,
    html[data-theme="dark"] .choice-pill,
    html[data-theme="dark"] .preset-card,
    html[data-theme="dark"] .recent-item { background: transparent; border-color: var(--line); }
    html[data-theme="dark"] .table-tools { background: var(--soft); }
    html[data-theme="dark"] .config-section { background: transparent; border-color: var(--line); }
    html[data-theme="dark"] .config-section > summary { color: var(--ink); }
    /* Operational UI refresh: semantic tokens above keep legacy components compatible. */
    body { min-height: 100dvh; }
    header { background: var(--surface); border-color: var(--border); }
    .topbar { padding: 20px 14px 16px; gap: 16px; }
    .brand { padding-inline: 10px; }
    nav { gap: 2px; padding-right: 0; }
    .nav-group { display: grid; gap: 2px; }
    .nav-group + .nav-group { margin-top: 14px; }
    .nav-group-label { padding: 0 12px 5px; color: var(--text-muted); font-size: 11px; font-weight: 600; }
    nav a { min-height: 42px; display: flex; align-items: center; gap: 10px; padding: 9px 12px; transition: background-color .15s ease, color .15s ease, border-color .15s ease; }
    nav a:hover, nav a:focus-visible { transform: none; border-color: transparent; }
    nav a.active { color: var(--text); border-color: transparent; box-shadow: inset 3px 0 0 var(--accent); }
    .theme-options::before { background: var(--accent); }
    .theme-options button[aria-pressed="true"] { color: #fff; }
    html[data-theme="dark"] .theme-options button[aria-pressed="true"] { color: #102426; }
    main { width: min(calc(100% - var(--sidebar)), 1440px); max-width: none; padding: 36px 40px 64px; }
    .page-title { grid-template-columns: 1fr; gap: 0; padding-bottom: 18px; margin-bottom: 24px; border-bottom-color: var(--border-strong); }
    .coordinate { display: none; }
    .simulator-page-head { grid-template-columns: minmax(0, 1fr) auto; }
    h1 { font-size: 30px; letter-spacing: -.035em; }
    h2 { font-size: 20px; }
    .panel, form.surface-form, form[data-unsaved], form.advanced, form.upload-card { border-color: var(--border); box-shadow: none; }
    .grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .stat { padding: 16px; border-color: var(--border); box-shadow: none; transition: background-color .15s ease, border-color .15s ease, transform .15s ease; }
    .stat:hover, .stat:focus-visible { box-shadow: none; transform: translateY(-1px); }
    .stat.urgent { border-color: var(--border); border-left: 3px solid var(--danger); box-shadow: none; }
    .stat span { text-transform: none; letter-spacing: 0; font-size: 12px; }
    .stat strong { font-size: 28px; }
    .status-card, .attention-panel, .setup-shell { box-shadow: none; }
    .table-shell { border-color: var(--border); box-shadow: none; }
    .table-tools, th { background: var(--surface-subtle); }
    th { text-transform: none; letter-spacing: 0; }
    th, td { padding: 13px 16px; }
    tr:hover td { background: var(--accent-soft); }
    input, textarea, select { background: var(--surface); border-color: var(--border-strong); transition: border-color .15s ease, box-shadow .15s ease, background-color .15s ease; }
    input:focus-visible, textarea:focus-visible, select:focus-visible { box-shadow: var(--focus-ring); }
    textarea { min-height: 112px; font-family: "Inter", "Segoe UI", system-ui, sans-serif; }
    textarea[data-prompt-field], .compact-area { min-height: 192px; }
    .prompt-editor, textarea[name="rawPrompt"], textarea[name="prompt"] { min-height: 60vh; font-family: Consolas, "JetBrains Mono", monospace; }
    button, .button-link, .ghost-btn { transition: background-color .15s ease, border-color .15s ease, color .15s ease, transform .15s ease, box-shadow .15s ease; }
    button:focus-visible, .button-link:focus-visible, .ghost-btn:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .sticky-actions { padding-bottom: calc(12px + env(safe-area-inset-bottom)); border-radius: var(--radius); box-shadow: var(--shadow-raised); }
    .toast, .modal, dialog { background: var(--surface-raised); box-shadow: var(--shadow-raised); }
    .modal { border-radius: var(--radius); }
    html[data-theme="dark"] header,
    html[data-theme="dark"] .panel,
    html[data-theme="dark"] form,
    html[data-theme="dark"] .stat,
    html[data-theme="dark"] .table-shell,
    html[data-theme="dark"] .guide,
    html[data-theme="dark"] .guide-card,
    html[data-theme="dark"] .env-card { background: var(--surface); border-color: var(--border); }
    html[data-theme="dark"] input,
    html[data-theme="dark"] textarea,
    html[data-theme="dark"] select { background: var(--surface); border-color: var(--border-strong); color: var(--text); }
    html[data-theme="dark"] tr:hover td { background: var(--accent-soft); }
    @media (max-width: 920px) {
      .menu-toggle { display: inline-flex; align-items: center; gap: 8px; }
      header { position: sticky; width: auto; height: auto; border-right: 0; border-bottom: 1px solid var(--border); }
      .topbar { height: auto; padding: 12px 14px; display: block; }
      .brand-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
      .brand { padding: 0; border: 0; }
      nav { position: fixed; inset: 69px 0 0 auto; z-index: 20; width: min(340px, 88vw); margin: 0; padding: 18px; display: none; align-content: start; overflow-y: auto; background: var(--surface); border-left: 1px solid var(--border); box-shadow: var(--shadow-raised); }
      header.nav-open nav { display: grid; }
      header.nav-open::after { content: ""; position: fixed; inset: 69px 0 0; z-index: 19; background: rgba(10, 24, 26, .45); }
      .nav-group + .nav-group { margin-top: 12px; }
      nav a { min-height: 44px; padding: 10px 12px; }
      .theme-panel { margin-top: 12px; }
      .theme-options { max-width: 280px; }
      main { width: 100%; margin-left: 0; padding: 28px 18px 44px; }
      .grid, .actions, .form-grid, .config-layout, .env-grid, .guide, .prompt-builder, .builder-grid, .preset-grid, .status-grid, .split-grid, .maintenance-grid, .backup-grid, .knowledge-intro { grid-template-columns: 1fr; }
      .ai-env-fields { grid-template-columns: 1fr; }
      .settings-zone-head { grid-template-columns: 48px minmax(0, 1fr); gap: 12px; }
      .env-grid > .env-card + .env-card { border-top: 1px solid var(--line); padding-top: 22px; }
      .key-row { grid-template-columns: 40px minmax(0, 1fr); padding: 14px 12px; }
      .key-actions { grid-column: 2; justify-content: flex-end; }
      .key-confirm { grid-column: 1 / -1; }
      .detail-grid { grid-template-columns: 1fr; }
      .detail-row:nth-child(odd), .detail-row:nth-child(even) { padding-inline: 0; border-right: 0; }
      .health-item { grid-template-columns: minmax(100px, .7fr) minmax(0, 1fr); }
      .health-item > :last-child { grid-column: 2; }
      .simulator-chat { min-height: 360px; padding: 20px 12px; }
      .conversation-list { grid-template-columns: 1fr; }
      .sim-message { max-width: 88%; }
      .simulator-page-head { grid-template-columns: 1fr; gap: 12px; align-items: start; }
      .simulator-contact { grid-column: 1; padding: 12px 0 0; border-left: 0; border-top: 1px solid var(--line); }
      .simulator-toolbar .simulator-reset { width: auto; }
      .ops-grid { grid-template-columns: 1fr; }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .repeat-row, .weekday-grid { grid-template-columns: 1fr; }
      .stat:nth-child(2) { border-right: 0; }
      .stat:nth-child(-n+2) { border-bottom: 1px solid var(--line); }
      .status-card { border-right: 0; border-bottom: 1px solid var(--line); }
      .status-card:last-child { border-bottom: 0; }
      .attention-item, .setup-step { grid-template-columns: 24px minmax(0, 1fr); }
      .attention-item .ghost-btn, .setup-step .ghost-btn { grid-column: 2; justify-self: start; }
      .prompt-preview-shell { position: static; }
      .reply-style-layout { grid-template-columns: 1fr; }
      .reply-style-preview { position: static; }
      .reply-style-intro { padding: 16px; }
      .developer-compare { grid-template-columns: 1fr; }
      .row { grid-template-columns: 1fr; }
      .table-tools { display: grid; }
      .table-tools input { max-width: none; }
      .upload-head, .upload-actions { display: grid; }
      .upload-meta { justify-content: flex-start; }
      h1 { font-size: 32px; }
      input, textarea, select { font-size: 16px; }
      .row-actions button, .ghost-btn, a.ghost-btn { min-height: 44px; }
      .sticky-actions { bottom: 8px; margin-inline: 0; }
      .toast { left: 14px; right: 14px; top: 12px; }
      .desktop-only { display: none !important; }
      .mobile-cards { display: grid !important; gap: 12px; padding: 12px; }
      .table-wrap { -webkit-overflow-scrolling: touch; }
      table { min-width: 0; }
    }
    @media (min-width: 921px) and (max-width: 1180px) {
      main { padding: 36px 30px 56px; }
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .env-grid, .prompt-builder { grid-template-columns: 1fr; }
      .prompt-preview-shell { position: static; }
      .reply-style-layout { grid-template-columns: 1fr; }
      .reply-style-preview { position: static; }
    }
    @media (max-height: 760px) {
      dialog#waQrModal > .wa-qr-modal-body { padding: 18px !important; }
      #liveQrContainer { min-height: 176px !important; }
      #liveQrImage { width: 168px !important; height: 168px !important; }
    }
    @media (min-width: 921px) {
      .mobile-cards { display: none !important; }
    }
    @media (max-width: 640px) {
      main { padding: 22px 14px 40px; }
      .grid { grid-template-columns: 1fr; }
      h1 { font-size: 27px; }
      .panel, form.surface-form, form[data-unsaved], form.advanced, form.upload-card { padding: 18px; }
      .sticky-actions { align-items: stretch; flex-direction: column; }
      .sticky-actions button { width: 100%; }
      .table-wrap > table:not(.desktop-only), .table-shell > table:not(.desktop-only) { display: block; }
      .table-wrap > table:not(.desktop-only) thead, .table-shell > table:not(.desktop-only) thead { display: none; }
      .table-wrap > table:not(.desktop-only) tbody, .table-shell > table:not(.desktop-only) tbody { display: grid; gap: 12px; padding: 12px; }
      .table-wrap > table:not(.desktop-only) tr, .table-shell > table:not(.desktop-only) tr { display: grid; gap: 8px; padding: 14px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
      .table-wrap > table:not(.desktop-only) td, .table-shell > table:not(.desktop-only) td { display: block; padding: 0; border: 0; white-space: normal; }
      .table-wrap > table:not(.desktop-only) td + td, .table-shell > table:not(.desktop-only) td + td { padding-top: 8px; border-top: 1px solid var(--border); }
      .row-actions { align-items: stretch; flex-direction: column; }
      .row-actions > *, .row-actions form, .row-actions button, .row-actions a { width: 100%; }
    }
    @media (prefers-reduced-motion: reduce) {
      * { transition: none !important; scroll-behavior: auto !important; animation: none !important; }
      .session-spinner { animation: none !important; border-color: var(--primary); }
    }
  </style>
  <link rel="stylesheet" href="/admin/assets/admin.css?v=20260723-3">
</head>
<body class="admin-app">
  <a class="skip-link" href="#main">Lewati ke konten utama</a>
  <header>
    <div class="topbar">
      <div class="brand-row">
        <div class="brand">
          <div class="brand-header">
            ${VOIDLARK_LOGO_SVG}
            <div class="brand-title">
              <strong>Voidlark</strong>
            </div>
          </div>
          <span class="badge">Customer Sales Support</span>
        </div>
        <button type="button" class="menu-toggle" data-menu-toggle aria-expanded="false" aria-controls="admin-nav">Menu</button>
      </div>
      <nav id="admin-nav">
        ${[
            ['Operasional', [
                ['dashboard', '/admin', 'Ringkasan', 'dashboard'],
                ['handoff', '/admin/handoff', 'Perlu Ditangani', 'alert'],
                ['leads', '/admin/leads', 'Pelanggan & Chat', 'users'],
                ['orders', '/admin/orders', 'Pesanan', 'orders'],
            ]],
            ['Bot', [
                ['config', '/admin/config', 'Profil & Alur', 'settings'],
                ['prompt', '/admin/prompt', 'Gaya Balasan', 'prompt'],
                ['knowledge', '/admin/knowledge', 'Katalog & Informasi', 'knowledge'],
                ['sandbox', '/admin/sandbox', 'Simulasi Percakapan', 'chat'],
            ]],
            ['Sistem', [
                ['whatsapp', '/admin/whatsapp', 'Manajemen WA', 'chat'],
                ['settings', '/admin/settings', 'Koneksi Sistem', 'settings'],
            ]],
        ].map(([group, items]) => `<section class="nav-group" aria-labelledby="nav-${String(group).toLowerCase()}"><span class="nav-group-label" id="nav-${String(group).toLowerCase()}">${group}</span>${(items as string[][]).map(([key, href, label, iconName]) => `<a href="${href}" class="${active === key ? 'active' : ''}" ${active === key ? 'aria-current="page"' : ''}>${icon(iconName, 'nav-icon')}${label}</a>`).join('')}</section>`).join('')}
      </nav>
      <div class="theme-panel">
        <span class="theme-label">Tampilan</span>
        <div class="theme-options" role="group" aria-label="Mode tampilan">
          <button type="button" data-theme-mode-button="light" aria-label="Terang">
            ${icon('sun')}
          </button>
          <button type="button" data-theme-mode-button="dark" aria-label="Gelap">
            ${icon('moon')}
          </button>
          <button type="button" data-theme-mode-button="system" aria-label="Ikuti sistem">
            ${icon('desktop')}
          </button>
        </div>
      </div>
      <form method="post" action="/admin/logout" class="logout-form" data-confirm="Keluar dari dashboard admin?">
        <button type="submit" class="logout-button">${icon('logout', 'nav-icon')}Keluar</button>
      </form>
    </div>
  </header>
  <main id="main" tabindex="-1">${options.toastHtml || ''}${body}</main>
  <div class="session-transition" data-session-transition aria-live="polite"><div class="session-transition-card"><span class="session-spinner"></span><strong data-session-title>Memproses…</strong><span class="muted" data-session-copy>Mohon tunggu sebentar.</span></div></div>
  <div class="modal-backdrop" data-confirm-modal hidden>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <h3 id="confirm-title">Konfirmasi</h3>
      <p data-confirm-text>Yakin lanjut?</p>
      <div class="modal-actions">
        <button type="button" class="secondary-button" data-confirm-cancel>Batal</button>
        <button type="button" class="danger" data-confirm-ok>Ya, lanjut</button>
      </div>
    </div>
  </div>
  <script>
    const autoResize = (el) => {
      el.style.height = 'auto';
      if (el.scrollHeight > 0) el.style.height = el.scrollHeight + 'px';
    };
    document.querySelectorAll('textarea[data-prompt-field], textarea.compact-area').forEach((el) => {
      el.addEventListener('input', () => autoResize(el));
      requestAnimationFrame(() => autoResize(el));
    });
    document.querySelectorAll('[data-file-picker]').forEach((picker) => {
      const input = picker.querySelector('input[type="file"]');
      const name = picker.querySelector('[data-file-name]');
      input?.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        if (name) name.textContent = files.length ? files.map((file) => file.name).join(', ') : 'Belum ada file dipilih';
        picker.dataset.hasFile = String(files.length > 0);
      });
    });
    document.addEventListener('toggle', (e) => {
      if (e.target.tagName === 'DETAILS' && e.target.open) {
        e.target.querySelectorAll('textarea[data-prompt-field], textarea.compact-area').forEach(autoResize);
      }
    }, true);
    for (const shell of document.querySelectorAll('[data-table-shell]')) {
      const input = shell.querySelector('[data-table-filter]');
      const count = shell.querySelector('[data-table-count]');
      const rows = [...shell.querySelectorAll('tbody tr')];
      input?.addEventListener('input', () => {
        const query = input.value.trim().toLowerCase();
        let visible = 0;
        for (const row of rows) {
          const match = row.textContent.toLowerCase().includes(query);
          row.hidden = !match;
          if (match) visible++;
        }
        if (count) count.textContent = visible + ' data';
      });
    }
    const salesFlow = document.querySelector('[data-sales-flow]');
    const flowDescription = document.querySelector('[data-flow-description]');
    const syncFlowHelp = () => {
      const selected = salesFlow?.selectedOptions?.[0];
      if (flowDescription && selected) flowDescription.textContent = selected.dataset.description || '';
    };
    salesFlow?.addEventListener('change', syncFlowHelp);
    syncFlowHelp();
    const productType = document.querySelector('[data-product-type]');
    const productDescription = document.querySelector('[data-product-description]');
    const shippingState = document.querySelector('[data-shipping-state]');
    const syncProductHelp = () => {
      const selected = productType?.selectedOptions?.[0];
      if (productDescription && selected) productDescription.textContent = selected.dataset.description || '';
      if (shippingState) {
        const physical = productType?.value !== 'digital';
        shippingState.textContent = physical ? 'Aktif otomatis' : 'Nonaktif otomatis';
        shippingState.classList.toggle('tone-ok', physical);
        shippingState.classList.toggle('tone-neutral', !physical);
      }
    };
    productType?.addEventListener('change', syncProductHelp);
    syncProductHelp();
    const configForm = document.querySelector('[data-config-form]');
    const configScope = document.querySelector('[data-config-scope]');
    const configModeButtons = [...document.querySelectorAll('[data-config-mode-button]')];
    const configModeKey = 'voidlark-config-mode';
    const applyConfigMode = (mode) => {
      const selected = mode === 'advanced' ? 'advanced' : 'basic';
      configForm?.setAttribute('data-config-mode', selected);
      configScope?.setAttribute('data-config-mode', selected);
      document.body.setAttribute('data-config-mode', selected);
      localStorage.setItem(configModeKey, selected);
      for (const button of configModeButtons) button.setAttribute('aria-pressed', String(button.dataset.configModeButton === selected));
    };
    for (const button of configModeButtons) button.addEventListener('click', () => applyConfigMode(button.dataset.configModeButton));
    applyConfigMode(localStorage.getItem(configModeKey) || 'basic');
    const applyBusinessPreset = (preset) => {
      if (!configForm) return;
      const physical = preset === 'physical';
      const productTypeInput = configForm.querySelector('[name="productType"]');
      if (productTypeInput) {
        productTypeInput.value = physical ? 'physical' : 'digital';
        productTypeInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const checkoutDefaults = physical ? ['name', 'phone', 'address'] : ['name', 'phone', 'email'];
      const orderDefaults = physical ? ['productName', 'variant', 'quantity'] : ['productName', 'variant', 'quantity'];
      for (const input of configForm.querySelectorAll('input[name="checkoutFields"]')) input.checked = checkoutDefaults.includes(input.value);
      for (const input of configForm.querySelectorAll('input[name="orderFields"]')) input.checked = orderDefaults.includes(input.value);
      const checkoutCustom = configForm.querySelector('[name="checkoutFieldsCustom"]');
      const orderCustom = configForm.querySelector('[name="orderFieldsCustom"]');
      if (checkoutCustom) checkoutCustom.value = '';
      if (orderCustom) orderCustom.value = '';
      configForm.dispatchEvent(new Event('input', { bubbles: true }));
      configForm.querySelector('[name="businessName"]')?.focus();
    };
    document.querySelectorAll('[data-business-preset]').forEach((button) => button.addEventListener('click', () => applyBusinessPreset(button.dataset.businessPreset)));
    const weightList = document.querySelector('[data-weight-list]');
    const addWeight = document.querySelector('[data-add-weight]');
    const bindWeightRemove = (button) => button?.addEventListener('click', () => {
      const rows = weightList?.querySelectorAll('[data-weight-row]') || [];
      const row = button.closest('[data-weight-row]');
      if (rows.length > 1) row?.remove();
      else row?.querySelectorAll('input').forEach((input) => input.value = '');
    });
    weightList?.querySelectorAll('[data-remove-weight]').forEach(bindWeightRemove);
    addWeight?.addEventListener('click', () => {
      const row = document.createElement('div');
      row.className = 'repeat-row';
      row.dataset.weightRow = '';
      row.innerHTML = '<label><span>Label pilihan</span><input name="shippingWeightLabel" placeholder="contoh: 30ml"></label><label><span>Berat (gram)</span><input name="shippingWeightGrams" type="number" min="1" step="1" placeholder="110"></label><button type="button" class="secondary-button" data-remove-weight>Hapus</button>';
      weightList?.append(row);
      bindWeightRemove(row.querySelector('[data-remove-weight]'));
      row.querySelector('input')?.focus();
    });
    const setupShell = document.querySelector('[data-setup-shell]');
    const setupHide = document.querySelector('[data-setup-hide]');
    const setupReveal = document.querySelector('[data-setup-reveal]');
    const setupKey = 'voidlark-hide-setup';
    const setSetupHidden = (hidden) => {
      if (setupShell) setupShell.hidden = hidden;
      setupReveal?.classList.toggle('visible', hidden);
      localStorage.setItem(setupKey, hidden ? '1' : '0');
    };
    setupHide?.addEventListener('click', () => setSetupHidden(true));
    setupReveal?.addEventListener('click', () => setSetupHidden(false));
    setSetupHidden(localStorage.getItem(setupKey) === '1');
    const uploadZone = document.querySelector('[data-upload-zone]');
    const uploadInput = document.querySelector('#knowledgeFiles');
    const uploadList = document.querySelector('[data-upload-list]');
    const uploadSummary = document.querySelector('[data-upload-summary]');
    const uploadSubmit = document.querySelector('[data-upload-submit]');
    const formatBytes = (bytes) => {
      if (!bytes) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB'];
      const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
      return (bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1) + ' ' + units[index];
    };
    const renderUploadFiles = () => {
      const files = uploadInput?.files ? [...uploadInput.files] : [];
      if (uploadList) uploadList.replaceChildren();
      for (const file of files) {
        const item = document.createElement('div');
        const name = document.createElement('strong');
        const size = document.createElement('span');
        item.className = 'upload-file';
        name.textContent = file.name;
        size.textContent = formatBytes(file.size);
        item.append(name, size);
        uploadList?.append(item);
      }
      const total = files.reduce((sum, file) => sum + file.size, 0);
      if (uploadSummary) uploadSummary.textContent = files.length
        ? files.length + ' file siap diupload, total ' + formatBytes(total) + '.'
        : 'Belum ada file dipilih.';
      if (uploadSubmit) uploadSubmit.disabled = files.length === 0;
    };
    uploadInput?.addEventListener('change', renderUploadFiles);
    if (uploadZone && uploadInput) {
      for (const eventName of ['dragenter', 'dragover']) {
        uploadZone.addEventListener(eventName, (event) => {
          event.preventDefault();
          uploadZone.classList.add('dragover');
        });
      }
      for (const eventName of ['dragleave', 'drop']) {
        uploadZone.addEventListener(eventName, () => uploadZone.classList.remove('dragover'));
      }
      uploadZone.addEventListener('drop', (event) => {
        event.preventDefault();
        if (!event.dataTransfer?.files?.length) return;
        uploadInput.files = event.dataTransfer.files;
        uploadInput.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    const promptForm = document.querySelector('[data-prompt-builder]');
    const promptPreview = document.querySelector('[data-prompt-preview]');
    const promptDeveloperPreview = document.querySelector('[data-prompt-developer-preview]');
    const promptSummaryRole = document.querySelector('[data-prompt-summary-role]');
    const promptSummaryStyle = document.querySelector('[data-prompt-summary-style]');
    const promptSummaryGreeting = document.querySelector('[data-prompt-summary-greeting]');
    const promptExampleBot = document.querySelector('[data-prompt-example-bot]');
    const promptValidator = document.querySelector('[data-prompt-validator]');
    const promptValue = (name) => promptForm?.querySelector('[name="' + name + '"]')?.value.trim() || '';
    const checkedPromptValue = (name) => promptForm?.querySelector('[name="' + name + '"]:checked')?.value || promptValue(name);
    const promptLines = (value) => {
      const rawLines = String(value || '').split(/\\r?\\n/);
      const items = [];
      for (const line of rawLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split(/\\.\\s+/);
        for (let i = 0; i < parts.length; i++) {
          let part = parts[i].trim();
          if (!part) continue;
          if (i < parts.length - 1 || trimmed.endsWith('.')) {
            if (!part.endsWith('.')) part += '.';
          }
          items.push(part);
        }
      }
      return items.map((line, index) => (index + 1) + '. ' + line).join('\\n');
    };
    const promptConfig = window.promptConfigValues || {};
    const buildPromptPreview = () => [
      'Kamu adalah ' + (promptConfig.csName || 'Anin') + ', ' + promptValue('role'),
      '',
      'KONTEKS BISNIS DARI PROFIL & ALUR',
      promptLines(promptConfig.context || ''),
      '',
      'GAYA BAHASA',
      promptValue('style'),
      promptValue('greeting'),
      'Panjang: ' + checkedPromptValue('replyLength') + '. Cara menjual: ' + checkedPromptValue('sellingStyle') + '. Sapaan: ' + promptValue('salutation') + '. Emoji: ' + promptValue('emojiLevel') + '.',
      '',
      'ATURAN IDENTITAS',
      promptLines(promptValue('identityRules')),
      '',
      'ALUR KONSULTASI',
      promptLines(promptValue('consultationRules')),
      '',
      'ATURAN PRODUK DAN HARGA DARI KNOWLEDGE',
      promptLines(promptValue('productRules')),
      '',
      'ATURAN CHECKOUT DAN PENYIMPANAN DRAFT',
      promptLines(promptValue('checkoutRules')),
      '',
      'ATURAN BERAT DAN CEK ONGKIR',
      promptLines(promptValue('shippingRules')),
      '',
      'ATURAN ESKALASI ADMIN',
      promptLines(promptValue('escalationRules')),
      '',
      'ATURAN FORMATTING WHATSAPP',
      promptLines(promptValue('formattingRules')),
      '',
      'ATURAN TAMBAHAN',
      promptValue('extraRules')
    ].join('\\n').trim();
    const renderPromptValidator = () => {
      if (!promptValidator || !promptPreview) return;
      const promptText = buildPromptPreview();
      const checks = [
        { ok: Boolean(promptConfig.businessName), text: 'Nama bisnis / produk diambil dari Config.' },
        { ok: Boolean(promptConfig.salesFlow), text: 'Sales flow diambil dari Config.' },
        { ok: Boolean(promptConfig.checkout), text: 'Field checkout diambil dari Config.' },
        { ok: /eskalasi|admin|handoff/i.test(promptValue('escalationRules')), text: 'Aturan handoff admin tersedia.' },
        { ok: promptValue('formattingRules').includes('*'), text: 'Aturan larangan tanda bintang tersedia.' },
        { ok: promptText.length < 12000, text: 'Prompt masih cukup ringkas untuk diproses.' }
      ];
      promptValidator.replaceChildren();
      for (const check of checks) {
        const item = document.createElement('div');
        item.className = 'validator-item ' + (check.ok ? 'ok' : 'warn');
        item.textContent = (check.ok ? 'OK: ' : 'Cek: ') + check.text;
        promptValidator.append(item);
      }
      promptPreview.textContent = promptText;
      if (promptDeveloperPreview) promptDeveloperPreview.textContent = promptText;
      const preset = checkedPromptValue('preset') || 'friendly';
      if (promptSummaryRole) promptSummaryRole.textContent = window.promptPresetValues?.[preset]?.label || preset;
      if (promptSummaryStyle) promptSummaryStyle.textContent = checkedPromptValue('replyLength') + ' · ' + checkedPromptValue('sellingStyle');
      if (promptSummaryGreeting) promptSummaryGreeting.textContent = (promptValue('salutation') || 'Kak') + ' · emoji ' + promptValue('emojiLevel');
      if (promptExampleBot) {
        const name = promptConfig.csName || 'Anin';
        const business = promptConfig.businessName || 'bisnis kami';
        const salutation = promptValue('salutation') || 'Kak';
        const suffix = promptValue('emojiLevel') === 'expressive' ? ' 🙂' : '';
        promptExampleBot.textContent = preset === 'support'
          ? 'Halo ' + salutation + ', saya ' + name + ' dari ' + business + '. Ceritakan kendalanya, nanti saya bantu cek satu per satu.' + suffix
          : preset === 'concise'
            ? 'Halo ' + salutation + ', saya ' + name + ' dari ' + business + '. Sampaikan kebutuhannya, nanti saya bantu langsung.' + suffix
            : preset === 'consultative'
              ? 'Halo ' + salutation + ', aku ' + name + ' dari ' + business + '. Boleh ceritakan kebutuhan utamanya? Nanti aku bantu pilihkan yang paling sesuai.' + suffix
              : 'Halo ' + salutation + ', aku ' + name + ' dari ' + business + '. Ceritakan yang dicari, nanti aku bantu pilihkan.' + suffix;
      }
    };
    if (promptForm) {
      const replySections = [...promptForm.querySelectorAll('.reply-style-section')];
      for (const section of replySections) section.addEventListener('toggle', () => {
        if (!section.open) return;
        for (const other of replySections) if (other !== section) other.open = false;
      });
      const promptAiButton = promptForm.querySelector('[data-prompt-ai]');
      const promptAiStatus = promptForm.querySelector('[data-prompt-ai-status]');
      const promptFieldNames = ['preset', 'replyLength', 'sellingStyle', 'salutation', 'emojiLevel', 'role', 'style', 'greeting', 'identityRules', 'consultationRules', 'productRules', 'checkoutRules', 'shippingRules', 'escalationRules', 'formattingRules', 'extraRules'];
      const collectPromptBuilder = () => Object.fromEntries(promptFieldNames.map((name) => {
        const field = promptForm.querySelector('[name="' + name + '"]:checked') || promptForm.querySelector('[name="' + name + '"]');
        return [name, field?.value || ''];
      }));
      const applyPromptBuilder = (builder) => {
        let changedFields = 0;
        for (const [name, value] of Object.entries(builder || {})) {
          const radio = promptForm.querySelector('[name="' + name + '"][value="' + CSS.escape(String(value)) + '"]');
          const field = radio || promptForm.querySelector('[name="' + name + '"]');
          if (!field) continue;
          if (field.type === 'radio') {
            if (!field.checked) changedFields += 1;
            field.checked = true;
          } else {
            const nextValue = value ?? '';
            if (field.value !== nextValue) {
              field.value = nextValue;
              changedFields += 1;
              field.classList.remove('prompt-ai-updated');
              void field.offsetWidth;
              field.classList.add('prompt-ai-updated');
            }
          }
        }
        renderPromptValidator();
        return changedFields;
      };
      promptForm.addEventListener('input', renderPromptValidator);
      promptForm.addEventListener('change', renderPromptValidator);
      for (const presetInput of promptForm.querySelectorAll('[data-prompt-preset]')) {
        presetInput.addEventListener('change', () => {
          const preset = window.promptPresetValues?.[presetInput.value];
          if (!preset || !presetInput.checked) return;
          const role = promptForm.querySelector('[name="role"]');
          const style = promptForm.querySelector('[name="style"]');
          if (role) role.value = preset.role || role.value;
          if (style) style.value = preset.style || style.value;
          renderPromptValidator();
        });
      }
      promptAiButton?.addEventListener('click', async () => {
        if (!promptAiStatus || !promptAiButton) return;
        promptAiButton.disabled = true;
        promptAiStatus.className = 'prompt-ai-status';
        promptAiStatus.textContent = 'Menghubungi AI...';
        try {
          const response = await fetch('/admin/prompt/assist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(collectPromptBuilder())
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'AI assist gagal.');
          const changedFields = applyPromptBuilder(data.builder);
          promptAiStatus.className = 'prompt-ai-status ok';
          promptAiStatus.textContent = changedFields
            ? '1 form diperbarui. Bagian yang berubah sudah ditandai. Tinjau hasilnya lalu klik Simpan gaya balasan.'
            : 'Form sudah rapi. AI tidak menemukan perubahan yang perlu diterapkan.';
        } catch (error) {
          promptAiStatus.className = 'prompt-ai-status error';
          promptAiStatus.textContent = error.message || 'AI assist gagal.';
        } finally {
          promptAiButton.disabled = false;
        }
      });
      renderPromptValidator();
    }
    const themeKey = 'voidlark-theme';
    const themeButtons = [...document.querySelectorAll('[data-theme-mode-button]')];
    const systemDark = matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = (mode) => {
      const selected = mode || localStorage.getItem(themeKey) || 'system';
      const dark = selected === 'dark' || (selected === 'system' && systemDark.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.documentElement.dataset.themeMode = selected;
      localStorage.setItem(themeKey, selected);
      document.querySelector('.theme-options')?.style.setProperty('--theme-index', String(['light', 'dark', 'system'].indexOf(selected)));
      for (const button of themeButtons) {
        button.setAttribute('aria-pressed', String(button.dataset.themeModeButton === selected));
      }
    };
    for (const button of themeButtons) {
      button.addEventListener('click', () => applyTheme(button.dataset.themeModeButton));
    }
    systemDark.addEventListener('change', () => {
      if ((localStorage.getItem(themeKey) || 'system') === 'system') applyTheme('system');
    });
    applyTheme(document.documentElement.dataset.themeMode || 'system');
    document.querySelectorAll('[data-persist-collapse]').forEach((details) => {
      const collapseId = details.dataset.persistCollapse;
      if (!collapseId) return;
      const collapseStorageKey = 'voidlark-collapse-' + collapseId;
      const storedState = localStorage.getItem(collapseStorageKey);
      if (storedState === 'open' || storedState === 'closed') details.open = storedState === 'open';
      details.addEventListener('toggle', () => {
        localStorage.setItem(collapseStorageKey, details.open ? 'open' : 'closed');
      });
    });

    const menuToggle = document.querySelector('[data-menu-toggle]');
    const headerEl = document.querySelector('header');
    const closeMenu = () => {
      headerEl?.classList.remove('nav-open');
      menuToggle?.setAttribute('aria-expanded', 'false');
    };
    menuToggle?.addEventListener('click', () => {
      const open = headerEl?.classList.toggle('nav-open');
      menuToggle.setAttribute('aria-expanded', String(Boolean(open)));
      if (open) headerEl?.querySelector('nav a')?.focus();
    });
    headerEl?.querySelectorAll('nav a').forEach((link) => link.addEventListener('click', closeMenu));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && headerEl?.classList.contains('nav-open')) {
        closeMenu();
        menuToggle?.focus();
        return;
      }
      if (event.key === 'Tab' && headerEl?.classList.contains('nav-open')) {
        const focusable = [...headerEl.querySelectorAll('button:not([disabled]), a[href], input:not([disabled])')];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });

    const toast = document.querySelector('[data-toast]');
    if (toast) setTimeout(() => toast.remove(), 3200);

    const simulatorForm = document.querySelector('[data-simulator-form]');
    if (simulatorForm) {
      const chat = document.querySelector('[data-simulator-chat]');
      const input = simulatorForm.querySelector('textarea[name="message"]');
      const send = simulatorForm.querySelector('button[type="submit"]');
      const status = document.querySelector('[data-simulator-status]');
      const reset = document.querySelector('[data-simulator-reset]');
      const simulatorHistoryKey = 'voidlark-simulator-history';
      let history = [];
      try {
        const saved = JSON.parse(sessionStorage.getItem(simulatorHistoryKey) || '[]');
        if (Array.isArray(saved)) history = saved.filter((entry) => ['user', 'assistant'].includes(entry?.role) && typeof entry?.content === 'string').slice(-20);
      } catch {}
      const timeLabel = () => new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      const addMessage = (kind, text) => {
        const bubble = document.createElement('div');
        bubble.className = 'sim-message ' + kind;
        const copy = document.createElement('p');
        copy.textContent = text;
        const time = document.createElement('span');
        time.className = 'sim-time';
        time.textContent = timeLabel();
        bubble.append(copy, time);
        chat?.append(bubble);
        chat?.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
        return bubble;
      };
      const saveHistory = () => sessionStorage.setItem(simulatorHistoryKey, JSON.stringify(history.slice(-20)));
      let responseGeneration = 0;
      let activeRequest = null;
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const addTyping = () => {
        const bubble = document.createElement('div');
        bubble.className = 'sim-message bot';
        bubble.setAttribute('aria-label', 'Bot sedang mengetik');
        const typing = document.createElement('span');
        typing.className = 'sim-typing';
        typing.innerHTML = '<span></span><span></span><span></span>';
        bubble.append(typing);
        chat?.append(bubble);
        chat?.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
        return bubble;
      };
      if (history.length > 0) {
        chat?.replaceChildren();
        for (const entry of history) addMessage(entry.role === 'user' ? 'customer' : 'bot', entry.content);
      }
      reset?.addEventListener('click', () => {
        responseGeneration += 1;
        activeRequest?.abort();
        history = [];
        sessionStorage.removeItem(simulatorHistoryKey);
        chat?.replaceChildren();
        addMessage('bot', 'Chat simulasi dimulai ulang. Silakan kirim pesan pertama sebagai customer.');
        if (status) status.textContent = 'Riwayat simulasi dibersihkan';
        input?.focus();
      });
      simulatorForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const message = String(input?.value || '').trim();
        if (!message || send?.disabled) return;
        responseGeneration += 1;
        const generation = responseGeneration;
        activeRequest?.abort();
        activeRequest = new AbortController();
        addMessage('customer', message);
        const priorHistory = history.slice(-20);
        history.push({ role: 'user', content: message });
        saveHistory();
        input.value = '';
        input.focus();
        send.disabled = true;
        if (status) status.textContent = 'Bot sedang mengetik...';
        const typing = addTyping();
        const typingStartedAt = Date.now();
        const slowNotice = setTimeout(() => {
          if (status) status.textContent = 'Bot sedang mencari jawaban terbaik...';
        }, 8_000);
        const verySlowNotice = setTimeout(() => {
          if (status) status.textContent = 'Model sedang sibuk, mohon tunggu sebentar...';
        }, 25_000);
        try {
          const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
          const response = await fetch('/admin/sandbox/reply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrfToken },
            body: JSON.stringify({ message, history: priorHistory }),
            signal: activeRequest.signal,
          });
          const raw = await response.text();
          let data;
          try { data = JSON.parse(raw); } catch { data = { error: raw || ('Simulasi gagal (' + response.status + ').') }; }
          await wait(Math.max(0, 650 - (Date.now() - typingStartedAt)));
          typing.remove();
          if (!response.ok) throw new Error(data.error || 'Simulasi gagal.');
          const bubbles = Array.isArray(data.bubbles) && data.bubbles.length ? data.bubbles : [data.reply || 'Maaf, belum ada balasan.'];
          send.disabled = false;
          const delivered = [];
          for (const bubble of bubbles.slice(0, 3)) {
            if (generation !== responseGeneration) break;
            if (delivered.length) {
              if (status) status.textContent = 'Bot sedang mengetik balasan berikutnya...';
              const nextTyping = addTyping();
              await wait(Math.min(1400, Math.max(550, String(bubble).length * 8)));
              nextTyping.remove();
              if (generation !== responseGeneration) break;
            }
            addMessage('bot', String(bubble));
            delivered.push(String(bubble));
          }
          if (Array.isArray(data.citations) && data.citations.length) {
            const citeBox = document.createElement('div');
            citeBox.className = 'sandbox-citations';
            const title = document.createElement('span');
            title.className = 'sandbox-citations-title';
            title.textContent = '📄 Sumber Rujukan Internal (Knowledge Citations):';
            citeBox.appendChild(title);
            const chips = document.createElement('div');
            chips.className = 'citation-chips';
            for (const cite of data.citations) {
              const chip = document.createElement('span');
              chip.className = 'citation-chip';
              chip.textContent = cite.fileName + ' [Chunk #' + cite.chunkIndex + ']' + (cite.relevancePercent ? ' · ' + cite.relevancePercent + '%' : '');
              chips.appendChild(chip);
            }
            citeBox.appendChild(chips);
            chat.appendChild(citeBox);
            chat.scrollTop = chat.scrollHeight;
          }
          if (delivered.length) history.push({ role: 'assistant', content: delivered.join('\\n\\n') });
          saveHistory();
          if (generation === responseGeneration && status) status.textContent = data.usedTools?.length ? 'Layanan: ' + data.usedTools.join(', ') : 'Balasan selesai';
        } catch (error) {
          typing.remove();
          if (error.name === 'AbortError') return;
          addMessage('error', error.message || 'Simulasi gagal.');
          if (status) status.textContent = 'Gagal memproses balasan';
        } finally {
          clearTimeout(slowNotice);
          clearTimeout(verySlowNotice);
          if (generation === responseGeneration) send.disabled = false;
          input.focus();
        }
      });
      input?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          simulatorForm.requestSubmit();
        }
      });
    }

    const modal = document.querySelector('[data-confirm-modal]');
    const confirmText = document.querySelector('[data-confirm-text]');
    const confirmOk = document.querySelector('[data-confirm-ok]');
    const confirmCancel = document.querySelector('[data-confirm-cancel]');
    let pendingForm = null;
    let modalTrigger = null;
    const closeModal = () => {
      pendingForm = null;
      modal?.classList.remove('open');
      modal?.setAttribute('hidden', '');
      document.querySelector('main')?.removeAttribute('inert');
      document.querySelector('header')?.removeAttribute('inert');
      modalTrigger?.focus();
      modalTrigger = null;
    };
    confirmCancel?.addEventListener('click', closeModal);
    modal?.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });
    confirmOk?.addEventListener('click', () => {
      const form = pendingForm;
      if (form?.action?.endsWith('/admin/logout')) {
        const transition = document.querySelector('[data-session-transition]');
        const title = document.querySelector('[data-session-title]');
        const copy = document.querySelector('[data-session-copy]');
        if (title) title.textContent = 'Keluar dari dashboard';
        if (copy) copy.textContent = 'Mengakhiri sesi admin dengan aman…';
        transition?.classList.add('active');
      }
      closeModal();
      form?.submit();
    });
    for (const form of document.querySelectorAll('form[data-confirm]')) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        pendingForm = form;
        modalTrigger = event.submitter || document.activeElement;
        if (confirmText) confirmText.textContent = form.getAttribute('data-confirm') || 'Yakin lanjut?';
        modal?.classList.add('open');
        modal?.removeAttribute('hidden');
        document.querySelector('main')?.setAttribute('inert', '');
        document.querySelector('header')?.setAttribute('inert', '');
        confirmCancel?.focus();
      });
    }
    modal?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...modal.querySelectorAll('button:not([disabled]), a[href], input:not([disabled])')];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    for (const button of document.querySelectorAll('[data-copy]')) {
      button.addEventListener('click', async () => {
        const value = button.getAttribute('data-copy') || '';
        try {
          await navigator.clipboard.writeText(value);
          button.textContent = 'Copied';
          setTimeout(() => { button.textContent = 'Copy JID'; }, 1200);
        } catch {
          button.textContent = 'Gagal menyalin';
          setTimeout(() => { button.textContent = 'Copy JID'; }, 1600);
        }
      });
    }

    document.addEventListener('submit', (event) => {
      const submitter = event.submitter;
      if (!(submitter instanceof HTMLButtonElement) || !submitter.dataset.connectionKind) return;
      const form = submitter.form;
      if (!form) return;
      let intent = form.querySelector('input[data-connection-intent]');
      if (!intent) {
        intent = document.createElement('input');
        intent.type = 'hidden';
        intent.name = 'connectionKind';
        intent.dataset.connectionIntent = '';
        form.append(intent);
      }
      intent.value = submitter.dataset.connectionKind;
    }, true);

    for (const form of document.querySelectorAll('form[method="post"]:not([data-simulator-form])')) {
      form.addEventListener('submit', (event) => {
        const submit = event.submitter || form.querySelector('button:not([type]), button[type="submit"]');
        if (submit && !form.hasAttribute('data-confirm')) {
          submit.dataset.loading = '1';
          queueMicrotask(() => { submit.disabled = true; });
        }
      });
    }

    for (const toggle of document.querySelectorAll('[data-password-toggle]')) {
      toggle.addEventListener('click', () => {
        const wrap = toggle.closest('.password-field');
        const input = wrap?.querySelector('input');
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        toggle.textContent = show ? 'Sembunyi' : 'Lihat';
        toggle.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
      });
    }

    for (const editor of document.querySelectorAll('[data-key-editor]')) {
      const storage = editor.querySelector('[data-key-storage]');
      const list = editor.querySelector('[data-key-list]');
      const count = editor.querySelector('[data-key-count]');
      const error = editor.querySelector('[data-key-error]');
      const add = editor.querySelector('[data-key-add]');
      let keys = String(storage?.value || '').split(',').map((key) => key.trim()).filter(Boolean);

      const commit = () => {
        if (storage) {
          storage.value = keys.join(',');
          storage.dispatchEvent(new Event('input', { bubbles: true }));
        }
      };
      const validate = () => {
        const normalized = keys.map((key) => key.trim()).filter(Boolean);
        const duplicates = normalized.filter((key, index) => normalized.indexOf(key) !== index);
        if (error) error.textContent = duplicates.length ? 'Ada API key duplikat. Hapus salah satunya sebelum menyimpan.' : '';
        return duplicates.length === 0;
      };
      const render = () => {
        list?.replaceChildren();
        if (count) count.textContent = keys.length + ' key aktif';
        if (keys.length === 0 && list) {
          const empty = document.createElement('div');
          empty.className = 'key-empty';
          empty.textContent = 'Belum ada API key. Tambahkan untuk mengaktifkan provider ini.';
          list.append(empty);
        }
        keys.forEach((key, index) => {
          const row = document.createElement('div');
          row.className = 'key-row';
          const label = document.createElement('span');
          label.className = 'key-index';
          label.textContent = index === 0 ? 'UTAMA' : String(index + 1).padStart(2, '0');
          const input = document.createElement('input');
          input.className = 'key-input';
          input.type = 'password';
          input.value = key;
          input.autocomplete = 'off';
          input.setAttribute('aria-label', 'API key ' + (index + 1));
          input.placeholder = editor.dataset.keyPlaceholder || 'Masukkan API key';
          input.addEventListener('input', () => {
            keys[index] = input.value.trim();
            commit();
            validate();
          });
          const actions = document.createElement('div');
          actions.className = 'key-actions';
          const toggle = document.createElement('button');
          toggle.type = 'button';
          toggle.textContent = 'Lihat';
          toggle.setAttribute('aria-label', 'Tampilkan API key ' + (index + 1));
          toggle.addEventListener('click', () => {
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            toggle.textContent = show ? 'Tutup' : 'Lihat';
          });
          const copy = document.createElement('button');
          copy.type = 'button';
          copy.textContent = 'Salin';
          copy.setAttribute('aria-label', 'Salin API key ' + (index + 1));
          copy.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(input.value);
              copy.textContent = 'Disalin';
              setTimeout(() => { copy.textContent = 'Salin'; }, 1200);
            } catch {
              copy.textContent = 'Gagal';
              setTimeout(() => { copy.textContent = 'Salin'; }, 1200);
            }
          });
          const up = document.createElement('button');
          up.type = 'button';
          up.textContent = '↑';
          up.disabled = index === 0;
          up.setAttribute('aria-label', 'Naikkan API key ' + (index + 1));
          up.addEventListener('click', () => {
            [keys[index - 1], keys[index]] = [keys[index], keys[index - 1]];
            commit(); render();
          });
          const down = document.createElement('button');
          down.type = 'button';
          down.textContent = '↓';
          down.disabled = index === keys.length - 1;
          down.setAttribute('aria-label', 'Turunkan API key ' + (index + 1));
          down.addEventListener('click', () => {
            [keys[index], keys[index + 1]] = [keys[index + 1], keys[index]];
            commit(); render();
          });
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.textContent = 'Hapus';
          remove.className = 'key-remove';
          remove.setAttribute('aria-label', 'Hapus API key ' + (index + 1));
          remove.addEventListener('click', () => {
            if (row.querySelector('.key-confirm')) return;
            const confirm = document.createElement('div');
            confirm.className = 'key-confirm';
            const message = document.createElement('span');
            message.textContent = 'Hapus key ' + (index === 0 ? 'utama' : 'cadangan ' + (index + 1)) + '?';
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'secondary-button';
            cancel.textContent = 'Batal';
            cancel.addEventListener('click', () => {
              confirm.remove();
              remove.focus();
            });
            const approve = document.createElement('button');
            approve.type = 'button';
            approve.className = 'danger';
            approve.textContent = 'Ya, hapus';
            approve.addEventListener('click', () => {
              keys.splice(index, 1);
              commit(); render();
            });
            confirm.append(message, cancel, approve);
            row.append(confirm);
            cancel.focus();
          });
          actions.append(toggle, copy, up, down, remove);
          row.append(label, input, actions);
          list?.append(row);
        });
        validate();
      };
      add?.addEventListener('click', () => {
        keys.push('');
        commit();
        render();
        list?.querySelector('.key-row:last-child input')?.focus();
      });
      editor.closest('form')?.addEventListener('submit', (event) => {
        keys = keys.map((key) => key.trim()).filter(Boolean);
        commit();
        if (!validate()) event.preventDefault();
      });
      render();
    }

    for (const form of document.querySelectorAll('form[data-unsaved]')) {
      let dirty = false;
      const markDirty = () => { dirty = true; form.dataset.dirty = 'true'; };
      form.addEventListener('input', markDirty);
      form.addEventListener('change', markDirty);
      form.addEventListener('submit', () => { dirty = false; form.dataset.dirty = 'false'; });
      window.addEventListener('beforeunload', (event) => {
        if (!dirty) return;
        event.preventDefault();
        event.returnValue = '';
      });
    }

    const chatThread = document.querySelector('[data-chat-thread]');
    if (chatThread) chatThread.scrollTop = chatThread.scrollHeight;
  </script>
</body>
</html>`;

const tableShell = (count: number, body: string, emptyHtml: string) => {
    if (count === 0) return emptyHtml;
    return `<section class="table-shell" data-table-shell>
<div class="table-tools">
  <input data-table-filter placeholder="Cari data..." aria-label="Cari data tabel" autocomplete="off">
  <span class="table-count" data-table-count aria-live="polite">${count} data</span>
</div>
<div class="table-wrap">${body}</div></section>`;
};

const table = (rows: any[], emptyHtml = emptyState('Belum ada data', 'Data masih kosong.', '/admin', 'Ke Dashboard')) => {
    if (rows.length === 0) return emptyHtml;
    const columns = Object.keys(rows[0]);
    return tableShell(rows.length, `<table><thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>
${rows.map((row) => `<tr>${columns.map((column) => `<td><pre>${escapeHtml(typeof row[column] === 'object' ? JSON.stringify(row[column], null, 2) : row[column])}</pre></td>`).join('')}</tr>`).join('')}
</tbody></table>`, emptyHtml);
};

const leadActions = (row: any) => `
  <div class="row-actions">
    <button type="button" class="ghost-btn" data-edit-customer="${escapeHtml(JSON.stringify(row))}">Edit</button>
    <a class="ghost-btn" href="/admin/chat?jid=${encodeURIComponent(String(row.jid || ''))}">Lihat percakapan</a>
    <a class="ghost-btn" href="/admin/customer/export?jid=${encodeURIComponent(String(row.jid || ''))}">Ekspor data</a>
    <form method="post" action="/admin/customer/clear" data-confirm="Hapus semua data customer ini (chat, lead, order draft, handoff)?">
      <input type="hidden" name="jid" value="${escapeHtml(row.jid)}">
      <button class="danger" type="submit">Hapus data</button>
    </form>
  </div>`;

const orderActions = (row: any) => {
    const awaiting = String(row.status || '') === 'awaiting_payment';
    return `<div class="row-actions">
    <a class="ghost-btn" href="/admin/chat?jid=${encodeURIComponent(String(row.jid || ''))}">Lihat percakapan</a>
    ${awaiting ? `<form method="post" action="/admin/orders/paid" data-confirm="Tandai pesanan #${escapeHtml(row.id)} sebagai lunas setelah pembayaran diperiksa?">
      <input type="hidden" name="jid" value="${escapeHtml(row.jid)}">
      <input type="hidden" name="orderId" value="${escapeHtml(row.id)}">
      <button type="submit">Tandai lunas</button>
    </form>` : ''}
  </div>`;
};

type LeadSortKey = 'updated' | 'created' | 'name' | 'status';
type LeadSortDirection = 'asc' | 'desc';

const LEAD_SORT_COLUMNS: Record<LeadSortKey, string> = {
    updated: 'updated_at',
    created: 'created_at',
    name: 'name',
    status: 'status',
};

export const resolveLeadSort = (key: unknown, direction: unknown): {
    key: LeadSortKey;
    direction: LeadSortDirection;
    orderBy: string;
} => {
    const normalizedKey = String(key || '').toLowerCase() as LeadSortKey;
    const normalizedDirection = String(direction || '').toLowerCase() as LeadSortDirection;
    if (!(normalizedKey in LEAD_SORT_COLUMNS) || !['asc', 'desc'].includes(normalizedDirection)) {
        return { key: 'updated', direction: 'desc', orderBy: 'updated_at DESC' };
    }
    return {
        key: normalizedKey,
        direction: normalizedDirection,
        orderBy: `${LEAD_SORT_COLUMNS[normalizedKey]} ${normalizedDirection.toUpperCase()}`,
    };
};

const leadSortControls = (sort: ReturnType<typeof resolveLeadSort>, search: string) => `<form class="sort-form" method="get" action="/admin/leads">
  <label for="leadSearch" style="flex-grow: 1;">Cari pelanggan
    <input id="leadSearch" name="q" value="${escapeHtml(search)}" placeholder="Nama, nomor, atau preferensi..." autocomplete="off">
  </label>
  <label>Urutkan berdasarkan
    <select name="sort">
      <option value="updated" ${sort.key === 'updated' ? 'selected' : ''}>Terakhir diperbarui</option>
      <option value="created" ${sort.key === 'created' ? 'selected' : ''}>Tanggal dibuat</option>
      <option value="name" ${sort.key === 'name' ? 'selected' : ''}>Nama</option>
      <option value="status" ${sort.key === 'status' ? 'selected' : ''}>Status</option>
    </select>
  </label>
  <label>Arah
    <select name="direction">
      <option value="desc" ${sort.direction === 'desc' ? 'selected' : ''}>Terbaru / Z–A</option>
      <option value="asc" ${sort.direction === 'asc' ? 'selected' : ''}>Terlama / A–Z</option>
    </select>
  </label>
  <button class="secondary-button" type="submit">Terapkan</button>
</form>`;

const statusDropdown = (row: any) => {
    const s = row.status || 'new';
    const tone = statusTone(s);
    return `<form method="post" action="/admin/customer/update-status" style="margin: 0; display: inline-block;">
      <input type="hidden" name="jid" value="${escapeHtml(row.jid)}">
      <select name="status" data-auto-submit class="badge-pill tone-${tone}">
        <option value="new" class="tone-${statusTone('new')}" ${s === 'new' ? 'selected' : ''}>Baru</option>
        <option value="interested" class="tone-${statusTone('interested')}" ${s === 'interested' ? 'selected' : ''}>Tertarik</option>
        <option value="checkout" class="tone-${statusTone('checkout')}" ${s === 'checkout' ? 'selected' : ''}>Checkout</option>
        <option value="paid" class="tone-${statusTone('paid')}" ${s === 'paid' ? 'selected' : ''}>Lunas</option>
        <option value="shipped" class="tone-${statusTone('shipped')}" ${s === 'shipped' ? 'selected' : ''}>Dikirim</option>
        <option value="completed" class="tone-${statusTone('completed')}" ${s === 'completed' ? 'selected' : ''}>Selesai</option>
        <option value="lost" class="tone-${statusTone('lost')}" ${s === 'lost' ? 'selected' : ''}>Batal</option>
      </select>
    </form>`;
};

const leadsTable = (rows: any[], sort: ReturnType<typeof resolveLeadSort>, search: string) => `${leadSortControls(sort, search)}${tableShell(
    rows.length,
    `<table class="responsive-table desktop-only">
      <caption class="sr-only">Daftar lead customer terbaru</caption>
      <thead><tr><th scope="col">Pelanggan</th><th scope="col">Status</th><th scope="col">Preferensi</th><th scope="col">Pesan</th><th scope="col">Waktu</th><th scope="col">Aksi</th></tr></thead>
      <tbody>
      ${rows.map((row) => {
        const phoneVal = String(row.phone || '').trim();
        const shortVal = shortJid(row.jid);
        const displayPhone = phoneVal && phoneVal !== '—' ? phoneVal : shortVal;
        const hasDiffSubtitle = phoneVal && phoneVal !== '—' && phoneVal !== shortVal;
        return `<tr>
        <td>
          <strong>${escapeHtml(row.name || 'Belum ada nama')}</strong>
          <div class="cell-muted mono">${escapeHtml(displayPhone)}</div>
          ${hasDiffSubtitle ? `<div class="cell-muted mono"><small>JID: ${escapeHtml(shortVal)}</small></div>` : ''}
        </td>
        <td>${statusDropdown(row)}</td>
        <td>${escapeHtml(row.preferences || '—')}</td>
        <td>${row.msg_count ? badge(`${row.msg_count} pesan`, 'info') : '<span class="muted">—</span>'}</td>
        <td class="cell-muted"><div class="date-stack"><span><small>Dibuat</small>${fmtDateTime(row.created_at)}</span><span><small>Diperbarui</small>${fmtDateTime(row.updated_at)}</span></div></td>
        <td>${leadActions(row)}</td>
      </tr>`;
      }).join('')}
      </tbody>
    </table>
    <div class="mobile-cards">
      ${rows.map((row) => {
        const phoneVal = String(row.phone || '').trim();
        const shortVal = shortJid(row.jid);
        const displayPhone = phoneVal && phoneVal !== '—' ? phoneVal : shortVal;
        return `<article class="mobile-card">
        <div class="card-title">${escapeHtml(row.name || 'Belum ada nama')}</div>
        <div class="card-meta">${statusDropdown(row)}${row.msg_count ? badge(`${row.msg_count} pesan`, 'info') : ''}<span class="mono">${escapeHtml(displayPhone)}</span></div>
        <div class="cell-muted">${escapeHtml(row.preferences || '—')}</div>
        <div class="date-stack"><span><small>Dibuat</small>${fmtDateTime(row.created_at)}</span><span><small>Diperbarui</small>${fmtDateTime(row.updated_at)}</span></div>
        ${leadActions(row)}
      </article>`;
      }).join('')}
    </div>
    <style>
      dialog#customerModal::backdrop {
        background: rgba(0, 0, 0, 0.2);
        backdrop-filter: blur(2px);
      }
      dialog#customerModal {
        width: 100%;
        max-width: 760px;
        padding: 40px;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: var(--bg);
        box-shadow: 0 12px 32px rgba(0,0,0,0.05);
        margin: auto;
      }
      @media (max-width: 768px) {
        dialog#customerModal { padding: 24px; border-radius: 12px; margin: 16px; max-height: calc(100vh - 32px); width: calc(100% - 32px); }
      }
      .modal-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px;
      }
      .modal-col-full { grid-column: 1 / -1; }
      @media (max-width: 600px) {
        .modal-grid { grid-template-columns: 1fr; gap: 16px; }
      }
      dialog#customerModal h2 {
        margin-top: 0;
        margin-bottom: 32px;
        font-weight: 500;
        letter-spacing: -0.02em;
      }
      dialog#customerModal textarea {
        resize: vertical;
        min-height: 60px;
        max-height: 240px;
      }
    </style>
    <dialog id="customerModal">
      <h2 style="margin-top: 0; margin-bottom: 24px;">Edit Data Pelanggan</h2>
      <form method="post" action="/admin/customer/update" class="modal-grid">
        <input type="hidden" name="jid" id="modalJid">
        <label>
          Nama
          <input type="text" name="name" id="modalName" placeholder="Nama lengkap">
        </label>
        <label>
          Nomor WA
          <input type="text" name="phone" id="modalPhone" placeholder="081234...">
        </label>
        <label>
          Status
          <select name="status" id="modalStatus">
            <option value="new">Baru</option>
            <option value="interested">Tertarik</option>
            <option value="checkout">Checkout</option>
            <option value="paid">Lunas</option>
            <option value="shipped">Dikirim</option>
            <option value="completed">Selesai</option>
            <option value="lost">Batal</option>
          </select>
        </label>
        <label>
          Preferensi
          <input type="text" name="preferences" id="modalPreferences" placeholder="Spesifikasi, varian, atau kebutuhan khusus...">
        </label>
        <label class="modal-col-full">
          Alamat
          <textarea name="address" id="modalAddress" placeholder="Jalan..."></textarea>
        </label>
        <label class="modal-col-full">
          Catatan
          <textarea name="notes" id="modalNotes" placeholder="Catatan admin..."></textarea>
        </label>
        <div class="row-actions modal-col-full" style="justify-content: flex-end; margin-top: 16px;">
          <button type="button" class="ghost-btn" data-modal-close>Batal</button>
          <button type="submit" class="primary">Simpan Perubahan</button>
        </div>
      </form>
    </dialog>
    <script>
      document.addEventListener('change', (e) => {
        if (e.target.matches('[data-auto-submit]')) {
          e.target.form.submit();
        }
      });
      let waPollInterval = null;
      window.startWaStatusPolling = function startWaStatusPolling() {
        return;
        /* legacy global QR poller disabled; per-number poller below owns this modal.
        if (waPollInterval) return;
        const updateStatus = async () => {
          try {
            const res = await fetch('/admin/whatsapp/status');
            if (!res.ok) return;
            const data = await res.json();
            const qrImg = document.getElementById('liveQrImage');
            const statusTxt = document.getElementById('liveQrStatus');
            const connBadge = document.getElementById('scanConnectedBadge');

            if (data.state === 'open') {
              if (qrImg) qrImg.style.display = 'none';
              if (statusTxt) statusTxt.style.display = 'none';
              if (connBadge) connBadge.style.display = 'block';
            } else if (data.qrUrl || data.qr) {
              if (connBadge) connBadge.style.display = 'none';
              if (statusTxt) {
                statusTxt.style.display = 'block';
                statusTxt.textContent = '📸 Buka WA di HP > Perangkat Tertaut > Scan QR ini:';
              }
              if (qrImg) {
                qrImg.src = data.qrUrl || ('https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(data.qr));
                qrImg.style.display = 'block';
              }
            } else {
              if (connBadge) connBadge.style.display = 'none';
              if (statusTxt) {
                statusTxt.style.display = 'block';
                statusTxt.textContent = '🔄 Menyiapkan QR Code WhatsApp (' + (data.detail || data.state) + ')...';
              }
              if (qrImg) qrImg.style.display = 'none';
            }
          } catch {}
        };
        updateStatus();
        waPollInterval = setInterval(updateStatus, 2000);
        */
      }

      document.addEventListener('click', (e) => {
        const openModalBtn = e.target.closest('[data-open-modal]');
        if (openModalBtn) {
          const modalId = openModalBtn.getAttribute('data-open-modal');
          const modal = document.getElementById(modalId);
          if (modal) {
            modal.showModal();
          }
          return;
        }

        const addBtn = e.target.closest('[data-toggle-add-panel]');
        if (addBtn) {
          const panel = document.getElementById('add-number-panel');
          if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
          return;
        }

        const editBtn = e.target.closest('[data-toggle-edit]');
        if (editBtn) {
          const phone = editBtn.getAttribute('data-toggle-edit');
          const form = document.getElementById('edit-form-' + phone);
          if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
          return;
        }

        const closeBtn = e.target.closest('[data-modal-close]');
        if (closeBtn) {
          closeBtn.closest('dialog')?.close();
          return;
        }

        const btn = e.target.closest('[data-edit-customer]');
        if (!btn) return;
        try {
          const data = JSON.parse(btn.dataset.editCustomer);
          document.getElementById('modalJid').value = data.jid || '';
          document.getElementById('modalName').value = data.name || '';
          document.getElementById('modalPhone').value = data.phone || '';
          document.getElementById('modalStatus').value = data.status || 'new';
          document.getElementById('modalPreferences').value = data.preferences || '';
          document.getElementById('modalAddress').value = data.address || '';
          document.getElementById('modalNotes').value = data.notes || '';
          document.getElementById('customerModal').showModal();
        } catch (err) {
          console.error('Gagal memuat data pelanggan', err);
        }
      });
    </script>`,
    emptyState(search ? 'Pelanggan tidak ditemukan' : 'Belum ada calon pelanggan', search ? 'Coba cari dengan kata kunci lain.' : 'Data akan muncul setelah seseorang menghubungi WhatsApp bot.', '/admin', 'Cek kesiapan bot'),
)}`;

const ordersTable = (rows: any[]) => tableShell(
    rows.length,
    `<table class="responsive-table desktop-only">
      <caption class="sr-only">Daftar order customer</caption>
      <thead><tr><th scope="col">Order</th><th scope="col">Customer</th><th scope="col">Status</th><th scope="col">Harga</th><th scope="col">Update</th><th scope="col">Aksi</th></tr></thead>
      <tbody>
      ${rows.map((row) => {
        const product = row.product_name || row.aroma || 'Draft';
        const detail = [row.variant, row.quality, row.package_size || (row.size_ml ? `${row.size_ml}ml` : ''), row.quantity ? `x${row.quantity}` : '']
            .filter(Boolean).join(' · ');
        return `<tr>
          <td>
          <a class="panel-link" href="/admin/orders/${escapeHtml(row.id)}"><strong>#${escapeHtml(row.id)} · ${escapeHtml(product)}</strong></a>
            <div class="cell-muted">${escapeHtml(detail || 'Belum lengkap')}</div>
          </td>
          <td>
            <div>${escapeHtml(row.customer_name || '—')}</div>
            <div class="cell-muted mono">${shortJid(row.jid)}</div>
          </td>
          <td>${badge(statusLabel(row.status || 'draft'), statusTone(row.status))}</td>
          <td>${row.product_price != null ? escapeHtml(`Rp${Number(row.product_price).toLocaleString('id-ID')}`) : '—'}</td>
          <td class="cell-muted">${fmtTime(row.updated_at)}</td>
          <td>${orderActions(row)}</td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>
    <div class="mobile-cards">
      ${rows.map((row) => {
        const product = row.product_name || row.aroma || 'Draft';
        return `<article class="mobile-card">
          <div class="card-title">#${escapeHtml(row.id)} · ${escapeHtml(product)}</div>
          <div class="card-meta">${badge(statusLabel(row.status || 'draft'), statusTone(row.status))}<span>${escapeHtml(row.customer_name || shortJid(row.jid))}</span><span>${fmtTime(row.updated_at)}</span></div>
          <div class="cell-muted">${row.product_price != null ? escapeHtml(`Rp${Number(row.product_price).toLocaleString('id-ID')}`) : '—'}</div>
          ${orderActions(row)}
        </article>`;
      }).join('')}
    </div>`,
    emptyState('Belum ada pesanan', 'Pesanan akan muncul setelah pelanggan memilih produk dan memberikan data yang dibutuhkan.', '/admin/config', 'Atur alur bisnis'),
);

const orderFilterTabs = (active: string, counts: Record<string, number>) => {
    const tabs = [
        { key: 'all', label: 'Semua' },
        { key: 'draft', label: 'Draft' },
        { key: 'awaiting_payment', label: 'Menunggu bayar' },
        { key: 'paid', label: 'Lunas' },
    ];
    return `<nav class="filter-tabs" aria-label="Filter status order">
      ${tabs.map((tab) => {
        const href = tab.key === 'all' ? '/admin/orders' : `/admin/orders?status=${tab.key}`;
        const count = counts[tab.key] ?? 0;
        return `<a class="filter-tab ${active === tab.key ? 'active' : ''}" href="${href}" ${active === tab.key ? 'aria-current="page"' : ''}>${tab.label}<span class="count">${count}</span></a>`;
      }).join('')}
    </nav>`;
};

const handoffTable = (rows: any[]) => tableShell(
    rows.length,
    `<table>
      <caption class="sr-only">Daftar customer dengan handoff aktif</caption>
      <thead><tr><th scope="col">Customer</th><th scope="col">Alasan & Pesan Terakhir</th><th scope="col">Prioritas / SLA</th><th scope="col">Lama Menunggu</th><th scope="col">Aksi</th></tr></thead>
      <tbody>
      ${rows.map((row) => `<tr>
        <td>
          <a class="ghost-btn mono" href="/admin/chat?jid=${encodeURIComponent(String(row.jid || ''))}">${shortJid(row.jid)}</a>
        </td>
        <td>
          <div style="font-weight: 600; margin-bottom: 4px;">${escapeHtml(row.reason || 'Perlu bantuan admin')}</div>
          ${row.last_message ? `<div style="font-size: 13px; color: var(--muted); max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-left: 2px solid var(--line); padding-left: 8px;">"${escapeHtml(row.last_message)}"</div>` : ''}
        </td>
        <td>${badge(String(row.priority || 'normal'), row.sla_breached ? 'danger' : 'neutral')}<div class="cell-muted" style="margin-top: 4px;">${row.sla_breached ? 'SLA terlewati' : `Due ${fmtTime(row.sla_due_at)}`}</div></td>
        <td>
          <div style="font-weight: 600;">${fmtTime(row.created_at)}</div>
          <div class="cell-muted" style="font-size: 11px; margin-top: 2px;">Sejak ${(() => { const date = parseDbDate(row.created_at); return date ? date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '—'; })()}</div>
        </td>
        <td>
          <div class="cell-muted">${row.assigned_operator ? `Operator: ${escapeHtml(row.assigned_operator)}` : 'Belum diambil'}</div>
          <div class="row-actions">
            ${whatsappNumber(row.jid) ? `<a class="ghost-btn" href="https://wa.me/${whatsappNumber(row.jid)}" target="_blank" rel="noreferrer">Hubungi di WhatsApp</a>` : ''}
            ${row.assigned_operator ? `<form method="post" action="/admin/handoff/handling"><input type="hidden" name="id" value="${escapeHtml(row.id)}"><button type="submit">Mulai tangani</button></form>` : `<form method="post" action="/admin/handoff/assign"><input type="hidden" name="id" value="${escapeHtml(row.id)}"><button type="submit">Ambil</button></form>`}
            <form method="post" action="/admin/handoff/resolve" data-confirm="Kembalikan customer ini ke bot auto-reply?">
              <input type="hidden" name="id" value="${escapeHtml(row.id)}">
              <input type="hidden" name="jid" value="${escapeHtml(row.jid)}">
              <button type="submit">Selesai — aktifkan bot</button>
            </form>
          </div>
        </td>
      </tr>`).join('')}
      </tbody>
    </table>`,
    emptyState('Tidak ada pelanggan menunggu', 'Pelanggan akan muncul ketika bot membutuhkan bantuan admin.', '/admin', 'Kembali ke Ringkasan'),
);

const knowledgeTable = (files: Array<{ name: string; size: number; updated: string }>) => tableShell(
    files.length,
    `<table class="responsive-table desktop-only">
      <caption class="sr-only">Daftar file knowledge bot</caption>
      <thead><tr><th scope="col">File</th><th scope="col">Ukuran</th><th scope="col">Update</th><th scope="col">Aksi</th></tr></thead>
      <tbody>
      ${files.map((file) => `<tr>
        <td><strong>${escapeHtml(file.name)}</strong></td>
        <td class="cell-muted">${escapeHtml((file.size / 1024).toFixed(file.size < 1024 ? 0 : 1))} KB</td>
        <td class="cell-muted">${fmtTime(file.updated)}</td>
        <td>
          <div class="row-actions">
            <form method="post" action="/admin/knowledge/delete" data-confirm="Hapus file ${escapeHtml(file.name)}? Knowledge perlu reload setelah hapus.">
              <input type="hidden" name="name" value="${escapeHtml(file.name)}">
              <button class="danger" type="submit">Hapus</button>
            </form>
          </div>
        </td>
      </tr>`).join('')}
      </tbody>
    </table>
    <div class="mobile-cards">
      ${files.map((file) => `<article class="mobile-card">
        <div class="card-title">${escapeHtml(file.name)}</div>
        <div class="card-meta"><span>${escapeHtml((file.size / 1024).toFixed(file.size < 1024 ? 0 : 1))} KB</span><span>${fmtTime(file.updated)}</span></div>
        <form method="post" action="/admin/knowledge/delete" data-confirm="Hapus file ${escapeHtml(file.name)}?">
          <input type="hidden" name="name" value="${escapeHtml(file.name)}">
          <button class="danger" type="submit">Hapus</button>
        </form>
      </article>`).join('')}
    </div>`,
    emptyState('Katalog masih kosong', 'Unggah katalog, FAQ, atau daftar harga agar bot memiliki sumber jawaban.', '/admin/knowledge', 'Unggah file'),
);

const knowledgeJobsTable = (jobs: KnowledgeJob[]) => tableShell(
    jobs.length,
    `<table class="responsive-table"><caption class="sr-only">Riwayat pemrosesan informasi</caption>
      <thead><tr><th>Proses</th><th>Status</th><th>Percobaan</th><th>Kendala</th><th>Aksi</th></tr></thead><tbody>
      ${jobs.map((job) => `<tr><td>Proses informasi #${job.id}<div class="cell-muted">${escapeHtml(job.reason === 'upload' ? 'Unggah file' : job.reason === 'reload' ? 'Muat ulang file' : job.reason)}</div></td><td>${badge(job.status, job.status === 'succeeded' ? 'ok' : job.status === 'failed' ? 'danger' : 'warn')}</td><td>${job.attempts} / ${job.max_attempts}</td><td>${escapeHtml(job.last_error || '—')}</td><td>${job.status === 'failed' || job.status === 'retry' ? `<form method="post" action="/admin/knowledge/jobs/${job.id}/retry"><button class="secondary-button">Coba lagi</button></form>` : '—'}</td></tr>`).join('')}
      </tbody></table>`,
    emptyState('Belum ada riwayat pemrosesan', 'Unggah atau muat ulang informasi untuk memulai pemrosesan.', '/admin/knowledge', 'Kembali'),
);

const waDotClass = (state: string) => {
    if (state === 'open') return 'ok';
    if (state === 'qr' || state === 'connecting') return 'warn';
    if (state === 'close' || state === 'logged_out') return 'danger';
    return '';
};

const waLabel = (state: string) => {
    const map: Record<string, string> = {
        open: 'Terhubung',
        qr: 'Perlu scan QR',
        connecting: 'Menghubungkan',
        close: 'Terputus',
        logged_out: 'Sesi berakhir',
        unknown: 'Belum diketahui',
    };
    return map[state] || state;
};

const waRuntimeLabel = (runtime: ReturnType<typeof getWaSessionStatus>) => {
    if (isWaSessionStaleConnecting(runtime)) return 'Menghubungkan terlalu lama';
    return waLabel(runtime.state);
};

const parseList = (value: unknown) => String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const parseFieldSelection = (selected: unknown, custom: unknown) => {
    const chosen = Array.isArray(selected) ? selected.map(String) : selected ? [String(selected)] : [];
    return [...new Set([...chosen, ...parseList(custom)])];
};

const renderFieldChoices = (name: string, selected: string[], options: Array<{ value: string; label: string }>) => {
    const selectedSet = new Set(selected);
    return `<div class="choice-grid">
${options.map((option) => `<label class="choice-pill">
  <input type="checkbox" name="${name}" value="${option.value}" ${selectedSet.has(option.value) ? 'checked' : ''}>
  <span>${escapeHtml(option.label)}</span>
</label>`).join('')}
</div>`;
};

export const parseWeightRows = (labels: unknown, grams: unknown) => {
    const weights: Record<string, number> = {};
    const labelValues = Array.isArray(labels) ? labels : labels === undefined ? [] : [labels];
    const gramValues = Array.isArray(grams) ? grams : grams === undefined ? [] : [grams];
    for (let index = 0; index < labelValues.length; index++) {
        const label = String(labelValues[index] || '').trim();
        const value = Number(gramValues[index]);
        if (label && Number.isFinite(value) && value > 0) weights[label] = Math.round(value);
    }
    return weights;
};

const stripInlineComment = (value: string) => value.replace(/\s+#.*$/, '').trim();

const readEnvValues = () => {
    const values: Record<string, string> = {};
    if (!fs.existsSync(ENV_PATH)) return values;

    for (const line of fs.readFileSync(ENV_PATH, 'utf-8').split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (match) values[match[1]] = stripInlineComment(match[2] || '');
    }
    if (!('STORE_DESTINATION_ID' in values) && values.STORE_CITY_ID) {
        values.STORE_DESTINATION_ID = values.STORE_CITY_ID;
    }
    return values;
};

const writeEnvValues = (updates: Record<string, string>) => {
    const current = readEnvValues();
    const next = { ...current, ...updates };
    if ('STORE_DESTINATION_ID' in updates) {
        delete next.STORE_CITY_ID;
    }
    const lines: string[] = [];

    for (const group of ENV_GROUPS) {
        lines.push(`# ${group.title}`);
        for (const field of group.fields) {
            lines.push(`${field.key}=${String(next[field.key] || '').replace(/\r?\n/g, '').trim()}`);
        }
        lines.push('');
    }

    const unknownKeys = Object.keys(next).filter((key) => !KNOWN_ENV_KEYS.has(key)).sort();
    if (unknownKeys.length > 0) {
        lines.push('# Other');
        for (const key of unknownKeys) lines.push(`${key}=${next[key]}`);
        lines.push('');
    }

    fs.writeFileSync(ENV_PATH, `${lines.join('\n').trim()}\n`);
    dotenv.config({ path: ENV_PATH, override: true });
    if (!('STORE_CITY_ID' in next)) {
        delete process.env.STORE_CITY_ID;
    }
};

const renderEnvField = (field: typeof ENV_GROUPS[number]['fields'][number], values: Record<string, string>) => {
    const value = field.key === 'ADMIN_WA_JID' ? displayAdminNumber(values[field.key]) : values[field.key] || '';
    const essentialHelp = new Set(['DATABASE_URL', 'AI_API_KEY', 'ADMIN_WA_JID', 'RAJAONGKIR_API_KEY', 'TAVILY_API_KEY']);
    const help = essentialHelp.has(field.key) && 'help' in field && field.help
        ? `<p class="muted">${escapeHtml(field.help)}</p>`
        : '';
    const resource = 'docsUrl' in field && field.docsUrl
        ? `<div class="field-resource"><a href="${escapeHtml(field.docsUrl)}" target="_blank" rel="noreferrer">${escapeHtml(field.docsLabel)}</a><span>${escapeHtml(field.docsHelp)}</span></div>`
        : '';
    if (field.key === 'RAJAONGKIR_API_KEY' || field.key === 'TAVILY_API_KEY') {
        const provider = field.key === 'TAVILY_API_KEY' ? 'Tavily' : 'RajaOngkir';
        const test = renderConnectionTest(field.key === 'TAVILY_API_KEY' ? 'lookup' : 'shipping');
        return `<div class="key-editor" data-key-editor data-key-placeholder="${escapeHtml(field.placeholder || 'Masukkan API key')}">
  <input type="hidden" id="${field.key}" name="${field.key}" value="${escapeHtml(value)}" data-key-storage>
  <div class="key-editor-head"><span class="key-count" data-key-count></span><div class="row-actions"><button type="button" class="secondary-button key-add" data-key-add>+ Tambah key</button>${test}</div></div>
  <div class="key-list" data-key-list aria-label="Daftar API key ${provider}"></div>
  <p class="key-editor-error" data-key-error role="alert"></p>
</div>${help}${resource}`;
    }
    if (field.type === 'select') {
        return `<select id="${field.key}" name="${field.key}">
${field.options.map((option) => `<option value="${option}" ${value === option ? 'selected' : ''}>${option}</option>`).join('')}
</select>${help}${resource}`;
    }
    if (field.type === 'textarea') {
        return `<textarea id="${field.key}" name="${field.key}" class="textarea-sm" placeholder="${escapeHtml(field.placeholder || '')}">${escapeHtml(value)}</textarea>${help}${resource}`;
    }
    if (field.type === 'password') {
        const test = field.key === 'AI_API_KEY' ? renderConnectionTest('ai') : '';
        return `<div class="row"><div class="password-field">
  <input id="${field.key}" name="${field.key}" type="password" value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder || '')}" autocomplete="off">
  <button type="button" class="password-toggle" data-password-toggle aria-label="Tampilkan password">Lihat</button>
</div>${test}</div>${help}${resource}`;
    }
    return `<input id="${field.key}" name="${field.key}" type="${field.type}" value="${escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder || '')}">${help}${resource}`;
};

const renderEnvGroup = (group: typeof ENV_GROUPS[number], values: Record<string, string>) => `
  <section class="env-card">
    <h2>${escapeHtml(group.title)}</h2>
    ${group.fields.map((field) => `
      <div class="field">
        <label for="${field.key}">${escapeHtml(field.label)}</label>
        ${renderEnvField(field, values)}
      </div>
    `).join('')}
  </section>`;

const renderAiEnvGroup = (values: Record<string, string>) => {
    const group = ENV_GROUPS.find((candidate) => candidate.title === 'AI');
    if (!group) return '';
    const fieldOrder = ['AI_API_BASE_URL', 'AI_API_KEY', 'AI_MODEL', 'OPENROUTER_API_KEY'];
    const fields = fieldOrder.map((key) => group.fields.find((field) => field.key === key)).filter((field): field is typeof group.fields[number] => Boolean(field));
    return `<section class="env-card env-card-ai"><div class="ai-env-fields">${fields.map((field) => `<div class="field"><label for="${field.key}">${escapeHtml(field.label)}</label>${renderEnvField(field, values)}</div>`).join('')}</div></section>`;
};

const renderConnectionTest = (kind: 'ai' | 'shipping' | 'lookup') => {
    const labels = {
        ai: ['Tes koneksi AI', 'Pastikan API key dan model dapat digunakan.'],
        shipping: ['Tes koneksi ongkir', 'Pastikan API key Komerce dapat diakses.'],
        lookup: ['Tes koneksi Tavily', 'Pastikan pencarian referensi web aktif.'],
    } as const;
    const [label, help] = labels[kind];
    return `<div class="connection-test"><button type="submit" class="secondary-button" formmethod="post" formaction="/admin/settings/test" data-connection-kind="${kind}" name="kind" value="${kind}">${label}</button><span class="muted">${help}</span></div>`;
};

const orderDetailHtml = (order: any) => {
    const quantity = Math.max(1, Number(order.quantity) || 1);
    const unitPrice = Number(order.product_price) || 0;
    const subtotal = unitPrice * quantity;
    const shipping = Number(order.shipping_cost) || 0;
    const options = safeJsonObject(order.options);
    const customerData = safeJsonObject(order.customer_data);
    const detailRows = [
        ['Produk', order.product_name || order.aroma || 'Belum diisi'],
        ['Varian', order.variant || order.quality || '—'],
        ['Ukuran / paket', order.package_size || (order.size_ml ? `${order.size_ml}ml` : '—')],
        ['Jumlah', quantity],
        ['Harga satuan', formatMoney(unitPrice)],
        ['Subtotal', formatMoney(subtotal)],
        ['Pengiriman', order.shipping_option || '—'],
        ['Ongkir', formatMoney(shipping)],
        ['Total', formatMoney(subtotal + shipping)],
        ['Status', statusLabel(order.status)],
        ['Nama pelanggan', order.customer_name || '—'],
        ['Nomor WhatsApp', order.phone || whatsappNumber(order.jid) || '—'],
        ['Alamat', order.address || '—'],
    ];
    const extraRows = [...Object.entries(options), ...Object.entries(customerData)];
    return `<section class="order-detail"><div class="detail-grid">${detailRows.map(([label, value]) => `<div class="detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}${extraRows.map(([label, value]) => `<div class="detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(typeof value === 'object' ? JSON.stringify(value) : value)}</strong></div>`).join('')}</div><pre class="sr-only">${escapeHtml(buildOrderSummary(order))}</pre></section>`;
};

const sandboxHtml = (options: { message?: string; reply?: string; error?: string; usedTools?: string[]; aiHealth?: AiHealth; csName?: string } = {}) => {
    const health = options.aiHealth;
    const configured = health ? aiHealthReady(health) : Boolean(process.env.AI_API_KEY || process.env.OPENROUTER_API_KEY);
    const csName = options.csName || getBusinessConfig().csName || 'CS Virtual';
    const now = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    return `<section class="simulator-page-head"><span class="coordinate">TS-05</span><div class="simulator-page-copy"><h1>Simulasi Percakapan</h1><p>Coba pengalaman customer tanpa mengirim WhatsApp atau menyimpan data.</p></div><div class="simulator-contact"><span class="simulator-avatar">${escapeHtml(csName.charAt(0).toUpperCase())}</span><div class="simulator-contact-copy"><strong>${escapeHtml(csName)}</strong><span>${configured ? 'siap membalas simulasi' : escapeHtml(health?.label || 'AI belum terhubung')}</span></div></div></section>
<div class="simulator-toolbar"><button type="button" class="simulator-reset" data-simulator-reset>Mulai ulang percakapan</button></div>
<section class="simulator-shell" aria-label="Simulator percakapan WhatsApp">
  <div class="simulator-chat" data-simulator-chat aria-live="polite">
    ${options.message ? `<div class="sim-message customer"><p>${escapeHtml(options.message)}</p><span class="sim-time">${now}</span></div>` : `<div class="sim-message bot"><p>Halo Kak. Tulis pesan contoh di bawah untuk melihat bagaimana bot akan membalas customer.</p><span class="sim-time">${now}</span></div>`}
    ${options.reply ? `<div class="sim-message bot"><p>${escapeHtml(options.reply)}</p><span class="sim-time">${now}</span></div>` : ''}
    ${options.error ? `<div class="sim-message error"><p>${escapeHtml(options.error)}</p><span class="sim-time">Periksa Koneksi Sistem</span></div>` : ''}
  </div>
  <form method="post" action="/admin/sandbox" class="simulator-compose" data-simulator-form>
    <label class="sr-only" for="sandboxMessage">Pesan contoh pelanggan</label>
    <textarea id="sandboxMessage" name="message" required autocomplete="off" placeholder="Ketik pesan sebagai customer..."></textarea>
    <button type="submit" class="simulator-send" aria-label="Kirim pesan simulasi">${icon('send')}</button>
  </form>
  <footer class="simulator-foot"><span>Preview aman — riwayat hanya tersimpan di tab browser ini.</span><span data-simulator-status>${options.usedTools?.length ? `Layanan: ${escapeHtml([...new Set(options.usedTools)].join(', '))}` : `Model: ${escapeHtml(process.env.AI_MODEL || 'default')}`}</span></footer>
</section>`;
};

export const renderSandboxPage = () => page('Simulasi Percakapan', sandboxHtml(), 'sandbox');

type PromptBuilder = Record<keyof typeof DEFAULT_PROMPT_BUILDER, string>;

const readBusinessConfig = () => {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, any>;
};

const readPromptBuilder = (): PromptBuilder => {
    if (!fs.existsSync(PROMPT_BUILDER_PATH)) {
        fs.writeFileSync(PROMPT_BUILDER_PATH, `${JSON.stringify(DEFAULT_PROMPT_BUILDER, null, 2)}\n`);
        return { ...DEFAULT_PROMPT_BUILDER };
    }
    const saved = JSON.parse(fs.readFileSync(PROMPT_BUILDER_PATH, 'utf-8'));
    return { ...DEFAULT_PROMPT_BUILDER, ...saved, preset: saved.preset === 'consultative' ? 'friendly' : saved.preset };
};

const renderPromptLines = (value: string) => {
    const rawLines = String(value || '').split(/\r?\n/);
    const items: string[] = [];
    for (const line of rawLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split(/\.\s+/);
        for (let i = 0; i < parts.length; i++) {
            let part = parts[i].trim();
            if (!part) continue;
            if (i < parts.length - 1 || trimmed.endsWith('.')) {
                if (!part.endsWith('.')) part += '.';
            }
            items.push(part);
        }
    }
    return items.map((line, index) => `${index + 1}. ${line}`).join('\n');
};

const labelFromOptions = (value: string, options: Array<{ value: string; label: string }>) =>
    options.find((option) => option.value === value)?.label || value;

const labelsFromValues = (values: string[] = [], options: Array<{ value: string; label: string }>) =>
    values.map((value) => labelFromOptions(value, options)).filter(Boolean).join('\n');

const promptPreferenceRules = (builder: PromptBuilder) => {
    const length = builder.replyLength === 'concise'
        ? 'Balasan ringkas, umumnya 1-2 kalimat, kecuali customer meminta detail.'
        : builder.replyLength === 'detailed'
            ? 'Berikan detail yang membantu, tetapi tetap bertahap dan jangan membanjiri customer.'
            : 'Balasan seimbang, umumnya 2-4 kalimat dan satu fokus utama.';
    const selling = builder.sellingStyle === 'soft'
        ? 'Utamakan membantu. Tawarkan produk hanya setelah kebutuhan customer cukup jelas.'
        : builder.sellingStyle === 'proactive'
            ? 'Aktif arahkan customer ke pilihan dan langkah pembelian tanpa memaksa.'
            : 'Konsultasi singkat lalu arahkan ke pembelian ketika kebutuhan sudah jelas.';
    const emoji = builder.emojiLevel === 'none'
        ? 'Jangan gunakan emoji.'
        : builder.emojiLevel === 'expressive'
            ? 'Emoji boleh digunakan secara ekspresif, tetapi tetap relevan dan tidak memenuhi balasan.'
            : 'Gunakan emoji sedikit dan hanya jika membantu nada percakapan.';
    return `${length}\n${selling}\nSapa customer dengan "${builder.salutation || 'Kak'}".\n${emoji}`;
};

const buildPromptConfigData = () => {
    const config = readBusinessConfig();
    const productType = String(config.productType || 'physical');
    const checkout = labelsFromValues(config.checkoutFields || [], CHECKOUT_FIELD_OPTIONS) || (productType === 'digital' ? 'Nama\nNo HP / WA\nEmail' : 'Nama\nNo HP / WA\nAlamat');
    const orderFields = labelsFromValues(config.orderFields || [], ORDER_FIELD_OPTIONS) || 'Nama produk\nJumlah';
    const csName = String(config.csName || 'Anin').trim() || 'Anin';
    const businessName = String(config.businessName || 'Voidlark');
    return {
        businessName,
        csName,
        productType: labelFromOptions(productType, PRODUCT_TYPE_OPTIONS),
        salesFlow: labelFromOptions(String(config.salesFlow || 'consultative'), SALES_FLOW_OPTIONS),
        enableShipping: Boolean(config.enableShipping),
        checkout,
        orderFields,
        context: [
            `Nama bisnis / produk: ${businessName}.`,
            `Nama CS virtual: ${csName}.`,
            `Tipe produk: ${labelFromOptions(productType, PRODUCT_TYPE_OPTIONS)}.`,
            `Cara melayani customer: ${labelFromOptions(String(config.salesFlow || 'consultative'), SALES_FLOW_OPTIONS)}.`,
            `Data checkout wajib: ${checkout.replace(/\n/g, ', ')}.`,
            `Field pesanan wajib: ${orderFields.replace(/\n/g, ', ')}.`,
            `Pengiriman: ${config.enableShipping ? 'aktif' : 'nonaktif'}.`,
        ].join('\n'),
    };
};

const buildSystemPrompt = (builder: PromptBuilder) => {
    const configData = buildPromptConfigData();
    return `Kamu adalah ${configData.csName}, ${builder.role}

KONTEKS BISNIS DARI PROFIL & ALUR
${renderPromptLines(configData.context)}

GAYA BAHASA
${builder.style}
${builder.greeting}
${promptPreferenceRules(builder)}

ATURAN IDENTITAS
${renderPromptLines(builder.identityRules)}

ALUR KONSULTASI
${renderPromptLines(builder.consultationRules)}

ATURAN PRODUK DAN HARGA DARI KNOWLEDGE
${renderPromptLines(builder.productRules)}

ATURAN CHECKOUT DAN PENYIMPANAN DRAFT
${renderPromptLines(builder.checkoutRules)}

ATURAN BERAT DAN CEK ONGKIR
${renderPromptLines(builder.shippingRules)}

ATURAN ESKALASI ADMIN
${renderPromptLines(builder.escalationRules)}

ATURAN FORMATTING WHATSAPP
${renderPromptLines(builder.formattingRules)}

ATURAN TAMBAHAN
${builder.extraRules}`.trim();
};

const promptBuilderFromBody = (body: Record<string, unknown>): PromptBuilder => ({
    preset: Object.hasOwn(PROMPT_PRESETS, String(body.preset || '')) ? String(body.preset) : DEFAULT_PROMPT_BUILDER.preset,
    role: String(body.role || DEFAULT_PROMPT_BUILDER.role).trim(),
    style: String(body.style || DEFAULT_PROMPT_BUILDER.style).trim(),
    replyLength: ['concise', 'balanced', 'detailed'].includes(String(body.replyLength)) ? String(body.replyLength) : DEFAULT_PROMPT_BUILDER.replyLength,
    sellingStyle: ['soft', 'balanced', 'proactive'].includes(String(body.sellingStyle)) ? String(body.sellingStyle) : DEFAULT_PROMPT_BUILDER.sellingStyle,
    salutation: String(body.salutation || DEFAULT_PROMPT_BUILDER.salutation).replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 24) || DEFAULT_PROMPT_BUILDER.salutation,
    emojiLevel: ['none', 'light', 'expressive'].includes(String(body.emojiLevel)) ? String(body.emojiLevel) : DEFAULT_PROMPT_BUILDER.emojiLevel,
    greeting: String(body.greeting || DEFAULT_PROMPT_BUILDER.greeting).trim(),
    identityRules: String(body.identityRules || DEFAULT_PROMPT_BUILDER.identityRules).trim(),
    consultationRules: String(body.consultationRules || DEFAULT_PROMPT_BUILDER.consultationRules).trim(),
    productRules: String(body.productRules || DEFAULT_PROMPT_BUILDER.productRules).trim(),
    checkoutRules: String(body.checkoutRules || DEFAULT_PROMPT_BUILDER.checkoutRules).trim(),
    shippingRules: String(body.shippingRules || DEFAULT_PROMPT_BUILDER.shippingRules).trim(),
    escalationRules: String(body.escalationRules || DEFAULT_PROMPT_BUILDER.escalationRules).trim(),
    formattingRules: String(body.formattingRules || DEFAULT_PROMPT_BUILDER.formattingRules).trim(),
    extraRules: String(body.extraRules || '').trim(),
});

const extractJsonObject = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
    const match = trimmed.match(/\{[\s\S]*\}/);
    return match ? match[0] : '';
};

type ChatCompletionPayload = {
    choices?: Array<{
        message?: { content?: string };
        delta?: { content?: string };
    }>;
};

const readChatCompletionContent = (rawBody: string) => {
    const trimmed = rawBody.trim();
    if (!trimmed) throw new Error('Provider AI mengembalikan respons kosong.');

    if (!trimmed.startsWith('data:')) {
        const payload = JSON.parse(trimmed) as ChatCompletionPayload;
        return payload.choices?.[0]?.message?.content || payload.choices?.[0]?.delta?.content || '';
    }

    const chunks: string[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        const payload = JSON.parse(data) as ChatCompletionPayload;
        const content = payload.choices?.[0]?.delta?.content || payload.choices?.[0]?.message?.content || '';
        if (content) chunks.push(content);
    }
    return chunks.join('');
};

const improvePromptBuilderWithAi = async (builder: PromptBuilder): Promise<PromptBuilder> => {
    const baseUrl = (process.env.AI_API_BASE_URL || 'http://localhost:20128/v1').replace(/\/$/, '');
    const apiKey = process.env.AI_API_KEY || process.env.OPENROUTER_API_KEY || '';
    const model = process.env.AI_MODEL || 'gemini/gemini-2.5-flash';
    if (!apiKey) throw new Error('AI_API_KEY belum diisi.');

    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'Voidlark Prompt Builder',
        },
        body: JSON.stringify({
            model,
            temperature: 0.1,
            stream: false,
            messages: [
                {
                    role: 'system',
                    content: `Kamu adalah copy editor instruksi sistem berbahasa Indonesia untuk bot WhatsApp CS.

TUGAS WAJIB:
1. Sunting SETIAP value string yang diberikan, termasuk role, style, greeting, identityRules, consultationRules, productRules, checkoutRules, shippingRules, escalationRules, formattingRules, dan extraRules.
2. Perbaiki semua typo, ejaan tidak baku, kapitalisasi, tanda baca, kata sambung, dan kalimat yang rancu.
3. Susun ulang kalimat agar ringkas, tegas, tidak berulang, dan mudah dijalankan AI.
4. Untuk field aturan multiline, tulis satu aturan utuh per baris tanpa nomor manual. Gabungkan aturan yang duplikat, tetapi jangan menghapus requirement unik.
5. Pertahankan seluruh fakta bisnis, nama produk, nama kolom, relasi, contoh, larangan, tool, dan maksud pengguna. Jangan membuat fakta atau aturan bisnis baru.
6. Jangan mengubah istilah teknis yang bermakna, seperti Knowledge, CUSTOMER STATE, simpanDraftPesanan, lookup external, nama item, atau karakter, kecuali hanya memperbaiki kapitalisasinya.
7. preset adalah identifier; kembalikan nilainya tanpa perubahan.

OUTPUT:
- Balas tepat satu JSON object valid tanpa markdown, komentar, atau teks pembuka.
- Wajib memiliki semua key berikut tepat satu kali: ${Object.keys(DEFAULT_PROMPT_BUILDER).join(', ')}.
- Semua value wajib string.
- Jangan mengembalikan teks input mentah jika masih memiliki typo atau struktur yang buruk.`,
                },
                {
                    role: 'user',
                    content: JSON.stringify(builder, null, 2),
                },
            ],
        }),
    });

    if (!response.ok) {
        const message = await response.text();
        throw new Error(message.slice(0, 240) || `AI error ${response.status}`);
    }

    const content = readChatCompletionContent(await response.text());
    const jsonText = extractJsonObject(content);
    if (!jsonText) throw new Error('AI tidak mengembalikan JSON builder.');
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    const expectedKeys = Object.keys(DEFAULT_PROMPT_BUILDER);
    const missingKeys = expectedKeys.filter((key) => typeof parsed[key] !== 'string');
    if (missingKeys.length) throw new Error(`Hasil AI tidak lengkap: ${missingKeys.join(', ')}.`);
    return promptBuilderFromBody(parsed);
};

const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
            fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
            cb(null, KNOWLEDGE_DIR);
        },
        filename: (_req, file, cb) => {
            const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._ -]/g, '_');
            const target = path.join(KNOWLEDGE_DIR, safeName);
            if (!fs.existsSync(target)) {
                cb(null, safeName);
                return;
            }
            const ext = path.extname(safeName);
            const base = path.basename(safeName, ext);
            cb(null, `${base}-${Date.now()}${ext}`);
        },
    }),
    fileFilter: (_req, file, cb) => cb(null, ALLOWED_EXT.has(path.extname(file.originalname).toLowerCase())),
    limits: { fileSize: 10 * 1024 * 1024, files: 30 },
});

const backupUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

type BackupPayload = {
    version: 1 | 2;
    createdAt: string;
    files: Record<string, string>;
    knowledge: Array<{ name: string; contentBase64: string }>;
    operationalSettings?: Record<string, string>;
};

export const createBackupPayload = (): BackupPayload => ({
    version: 2,
    createdAt: new Date().toISOString(),
    files: Object.fromEntries(BACKUP_FILES.filter((name) => fs.existsSync(path.resolve(name))).map((name) => [name, fs.readFileSync(path.resolve(name), 'utf8')])),
    knowledge: fs.existsSync(KNOWLEDGE_DIR)
        ? fs.readdirSync(KNOWLEDGE_DIR).filter((name) => fs.statSync(path.join(KNOWLEDGE_DIR, name)).isFile()).map((name) => ({ name, contentBase64: fs.readFileSync(path.join(KNOWLEDGE_DIR, name)).toString('base64') }))
        : [],
    operationalSettings: Object.fromEntries(SAFE_OPERATIONAL_ENV_KEYS.map((key) => [key, process.env[key]?.trim() || ''] as const)),
});

export const parseBackupPayload = (buffer: Buffer): BackupPayload => {
    const input = JSON.parse(buffer.toString('utf8')) as BackupPayload;
    if (!input || typeof input !== 'object' || ![1, 2].includes(input.version) || !input.files || typeof input.files !== 'object' || Array.isArray(input.files) || !Array.isArray(input.knowledge)) throw new Error('Format backup tidak didukung.');
    if (typeof input.createdAt !== 'string' || Number.isNaN(Date.parse(input.createdAt))) throw new Error('Tanggal backup tidak valid.');
    const files: Record<string, string> = {};
    for (const [rawName, content] of Object.entries(input.files)) {
        const name = LEGACY_BACKUP_FILE_ALIASES[rawName] || rawName;
        if (!BACKUP_FILES.includes(name as typeof BACKUP_FILES[number])) throw new Error(`File backup tidak diizinkan: ${rawName}`);
        if (typeof content !== 'string') throw new Error(`Isi file backup tidak valid: ${rawName}`);
        if (name in files) throw new Error(`File backup duplikat: ${name}`);
        files[name] = content;
    }
    if (files['business.config.json']) JSON.parse(files['business.config.json']);
    if (files['prompt.builder.json']) JSON.parse(files['prompt.builder.json']);
    const seenKnowledge = new Set<string>();
    const knowledge = input.knowledge.map((file) => {
        if (!file || typeof file.name !== 'string' || path.basename(file.name) !== file.name || !ALLOWED_EXT.has(path.extname(file.name).toLowerCase())) throw new Error(`Nama file Katalog & Informasi tidak valid: ${String(file?.name)}`);
        if (seenKnowledge.has(file.name.toLowerCase())) throw new Error(`File Katalog & Informasi duplikat: ${file.name}`);
        if (typeof file.contentBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.contentBase64)) throw new Error(`Konten base64 tidak valid: ${file.name}`);
        seenKnowledge.add(file.name.toLowerCase());
        return { name: file.name, contentBase64: file.contentBase64 };
    });
    const operationalSettings: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.operationalSettings || {})) {
        if (!SAFE_OPERATIONAL_ENV_KEYS.includes(key as typeof SAFE_OPERATIONAL_ENV_KEYS[number]) || typeof value !== 'string') throw new Error(`Pengaturan operasional tidak diizinkan: ${key}`);
        operationalSettings[key] = value;
    }
    return { version: input.version, createdAt: input.createdAt, files, knowledge, ...(input.operationalSettings ? { operationalSettings } : {}) };
};

const updateEnvText = (source: string, settings: Record<string, string>, clearMissing: boolean) => {
    const updates = new Map<string, string | undefined>(SAFE_OPERATIONAL_ENV_KEYS.map((key) => [key, clearMissing ? (settings[key] ?? '') : settings[key]]));
    const seen = new Set<string>();
    const lines = source.split(/\r?\n/).map((line) => {
        const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
        const key = match?.[1];
        if (!key || !updates.has(key) || updates.get(key) === undefined) return line;
        seen.add(key);
        return `${key}=${String(updates.get(key) || '').replace(/\r?\n/g, '').trim()}`;
    });
    for (const [key, value] of updates) if (value !== undefined && !seen.has(key)) lines.push(`${key}=${String(value).replace(/\r?\n/g, '').trim()}`);
    return `${lines.join('\n').replace(/\n+$/, '')}\n`;
};

type RestoreOptions = { rootDirectory?: string; activateKnowledge?: () => Promise<void> };
export const restoreBackupPayload = async (payload: BackupPayload, options: RestoreOptions = {}) => {
    const root = path.resolve(options.rootDirectory || '.');
    const stage = fs.mkdtempSync(path.join(path.dirname(root), '.voidlark-restore-'));
    const snapshot = path.join(stage, 'snapshot');
    const staged = path.join(stage, 'staged');
    fs.mkdirSync(snapshot, { recursive: true });
    fs.mkdirSync(staged, { recursive: true });
    const relativeTargets = [...BACKUP_FILES, '.env', 'knowledge_base'];
    const existed = new Set<string>();
    const displaced = new Map<string, string>();
    try {
        for (const relative of relativeTargets) {
            const source = path.join(root, relative);
            if (!fs.existsSync(source)) continue;
            existed.add(relative);
            const target = path.join(snapshot, relative);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.cpSync(source, target, { recursive: true });
        }
        for (const [relative, content] of Object.entries(payload.files)) {
            const target = path.join(staged, relative);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, content);
        }
        const stagedKnowledge = path.join(staged, 'knowledge_base');
        fs.mkdirSync(stagedKnowledge, { recursive: true });
        for (const file of payload.knowledge) fs.writeFileSync(path.join(stagedKnowledge, file.name), Buffer.from(file.contentBase64, 'base64'));
        if (payload.operationalSettings) {
            const currentEnv = fs.existsSync(path.join(root, '.env')) ? fs.readFileSync(path.join(root, '.env'), 'utf8') : '';
            fs.writeFileSync(path.join(staged, '.env'), updateEnvText(currentEnv, payload.operationalSettings, payload.version === 2));
        }

        const swap = (relative: string, source: string) => {
            const target = path.join(root, relative);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            if (fs.existsSync(target)) {
                const previous = `${target}.restore-${path.basename(stage)}`;
                fs.renameSync(target, previous);
                displaced.set(relative, previous);
            }
            fs.renameSync(source, target);
        };
        for (const relative of BACKUP_FILES) {
            const source = path.join(staged, relative);
            if (!fs.existsSync(source)) continue;
            swap(relative, source);
        }
        swap('knowledge_base', stagedKnowledge);
        if (payload.operationalSettings) swap('.env', path.join(staged, '.env'));
        await (options.activateKnowledge || loadKnowledgeBase)();
        for (const previous of displaced.values()) fs.rmSync(previous, { recursive: true, force: true });
    } catch (error) {
        for (const [relative, previous] of displaced) {
            fs.rmSync(path.join(root, relative), { recursive: true, force: true });
            if (fs.existsSync(previous)) fs.renameSync(previous, path.join(root, relative));
        }
        for (const relative of relativeTargets) {
            if (displaced.has(relative)) continue;
            const target = path.join(root, relative);
            fs.rmSync(target, { recursive: true, force: true });
            const saved = path.join(snapshot, relative);
            if (existed.has(relative) && fs.existsSync(saved)) {
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.cpSync(saved, target, { recursive: true });
            }
        }
        throw error;
    } finally {
        fs.rmSync(stage, { recursive: true, force: true });
    }
};

const listenOnAvailablePort = (app: express.Express, startPort = 3000, maxAttempts = 100, host = '127.0.0.1') => new Promise<{ port: number; server: Server }>((resolve, reject) => {
    let port = startPort;
    let attempts = 0;

    const listen = () => {
        const server = app.listen(port, host);
        server.once('listening', () => resolve({ port, server }));
        server.once('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'EADDRINUSE' && attempts < maxAttempts - 1) {
                attempts += 1;
                port += 1;
                listen();
                return;
            }
            reject(error);
        });
    };

    listen();
});

export const startAdminServer = async () => {
    const app = express();
    const adminPassword = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'admin-dev-only');
    if (process.env.NODE_ENV === 'production') assertProductionAdminPassword(adminPassword);
    const adminSecurity = createAdminSecurity({ password: adminPassword, secureCookie: process.env.NODE_ENV === 'production' });
    const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: true, legacyHeaders: false, message: 'Terlalu banyak percobaan login. Coba lagi nanti.' });
    const apiLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });
    app.disable('x-powered-by');
    app.use((req, res, next) => {
        res.locals.cspNonce = randomBytes(16).toString('base64');
        const nonce = String(res.locals.cspNonce);
        helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", `'nonce-${nonce}'`], styleSrc: ["'self'", "'unsafe-inline'"], fontSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"] } } })(req, res, next);
    });
    app.use((req, res, next) => {
        const started = process.hrtime.bigint();
        res.once('finish', () => operationalMetrics.http(req.method, req.path, res.statusCode, Number(process.hrtime.bigint() - started) / 1e9));
        next();
    });
    app.post('/webhooks/payment', express.raw({ type: 'application/json', limit: '256kb' }), paymentWebhookHandler);
    app.use(express.urlencoded({ extended: true, limit: '2mb' }));
    app.use(express.json({ limit: '2mb' }));
    app.use((req, res, next) => {
        res.locals.requestId = Math.random().toString(36).slice(2, 10).toUpperCase();
        if (req.path.startsWith('/admin')) res.setHeader('Cache-Control', 'no-store, max-age=0');
        next();
    });

    app.get('/admin/assets/admin.css', (_req, res) => {
        res.setHeader('Cache-Control', 'no-cache, max-age=0, must-revalidate');
        res.type('text/css; charset=utf-8').send(ADMIN_STYLES);
    });
    app.get('/admin/assets/fonts/:file', (req, res) => {
        const allowedFonts = new Set(['InterVariable.woff2', 'IBMPlexMono-Regular.woff2', 'IBMPlexMono-SemiBold.woff2']);
        const file = String(req.params.file || '');
        if (!allowedFonts.has(file)) {
            res.sendStatus(404);
            return;
        }
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.type('font/woff2').sendFile(path.resolve('docs', 'assets', 'fonts', file));
    });
    app.get('/admin/assets/voidlark-logo-clean.svg', (_req, res) => {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.type('image/svg+xml').sendFile(path.resolve('docs', 'assets', 'voidlark-logo-clean.svg'));
    });
    app.get('/admin/assets/voidlark-logo.svg', (_req, res) => {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.type('image/svg+xml').send(VOIDLARK_LOGO_SVG
            .replace('class="brand-logo-svg"', 'width="40" height="40" aria-label="Voidlark" role="img"')
            .replaceAll('fill="currentColor"', 'fill="#172022"'));
    });

    app.get('/', (req, res) => {
        const sessionId = parseCookies(req.headers.cookie)[adminSecurity.cookieName] || '';
        res.redirect(adminEntryPath(adminSecurity.isAuthenticated(sessionId)));
    });

    app.get('/admin/login', (_req, res) => {
        res.send(renderLoginPage());
    });
    app.post('/admin/login', loginLimiter, (req, res) => {
        const login = adminSecurity.login(String(req.body.password || ''));
        if (!login.ok || !login.session) return res.status(401).send(renderLoginPage('Password tidak valid.'));
        res.cookie(adminSecurity.cookieName, login.session.id, adminSecurity.cookieOptions);
        return res.redirect('/admin?msg=Login+berhasil.+Selamat+datang.&type=ok');
    });

    app.use('/admin', apiLimiter, (req, res, next) => {
        if (req.path === '/login') return next();
        const sessionId = parseCookies(req.headers.cookie)[adminSecurity.cookieName] || '';
        if (!adminSecurity.isAuthenticated(sessionId)) return req.method === 'GET' ? res.redirect('/admin/login') : res.status(401).send('Unauthorized');
        res.locals.adminSessionId = sessionId;
        res.locals.csrfToken = adminSecurity.getCsrfToken(sessionId);
        const originalSend = res.send.bind(res);
        res.send = ((body: unknown) => {
            if (typeof body !== 'string' || !body.includes('<html')) return originalSend(body);
            const token = escapeHtml(res.locals.csrfToken);
            const nonce = escapeHtml(res.locals.cspNonce);
            const csrfQuery = `_csrf=${encodeURIComponent(res.locals.csrfToken)}`;
            const secured = body
                .replace(/<script(?![^>]*\bnonce=)/gi, `<script nonce="${nonce}"`)
                .replace(/<form(?=[^>]*method="post")(?=[^>]*enctype="multipart\/form-data")([^>]*)action="([^"]+)"([^>]*)>/gi, (_match, before, action, after) => `<form${before}action="${action}${action.includes('?') ? '&' : '?'}${csrfQuery}"${after}>`)
                .replace(/<form([^>]*method="post"[^>]*)>/gi, `<form$1><input type="hidden" name="_csrf" value="${token}">`)
                .replace('</head>', `<meta name="csrf-token" content="${token}"><script>document.addEventListener('DOMContentLoaded',()=>{const t=document.querySelector('meta[name="csrf-token"]')?.content;const f=window.fetch;window.fetch=(u,o={})=>f(u,{...o,headers:{...(o.headers||{}),'X-CSRF-Token':t||''}})});</script></head>`);
            return originalSend(secured);
        }) as typeof res.send;
        if (req.method === 'GET' || req.method === 'HEAD') return next();
        if (shouldRejectCrossSite(req.get('sec-fetch-site'))) {
            return res.status(403).send(page('Permintaan Ditolak', `${pageHeader('Permintaan Ditolak', 'Sumber permintaan tidak dikenali.', 'SC-03')}<section class="panel"><h2>Tidak dapat menyimpan perubahan</h2><p>Sesi atau alamat halaman berubah. Muat ulang halaman admin, lalu coba simpan kembali.</p><a class="button-link" href="${escapeHtml(req.get('referer') || '/admin')}">Kembali ke halaman sebelumnya</a></section>`, '', {}));
        }
        const csrf = csrfTokenFromRequest({ body: req.body, query: req.query as Record<string, unknown>, headers: req.headers });
        if (!adminSecurity.verifyCsrf(sessionId, csrf)) return res.status(403).send('Invalid CSRF token');
        return next();
    });

    app.post('/admin/logout', (req, res) => {
        adminSecurity.logout(res.locals.adminSessionId || '');
        res.clearCookie(adminSecurity.cookieName, adminSecurity.cookieOptions);
        res.redirect('/admin/login');
    });

    app.get('/metrics', (_req, res) => res.type('text/plain; version=0.0.4; charset=utf-8').send(metricsRegistry.render()));
    app.get('/health/live', (_req, res) => res.json(liveness()));
    app.get('/health/ready', async (_req, res) => {
        const [result, ai] = await Promise.all([readiness(pool), checkAiHealth()]);
        const ready = result.ready && aiHealthReady(ai);
        res.status(ready ? 200 : 503).json({ ...result, ready, status: ready ? 'ready' : 'not_ready', checks: { ...result.checks, ai } });
    });
    app.get('/health', async (_req, res) => {
        const started = Date.now();
        try {
            const [, aiHealth] = await Promise.all([pool.query('SELECT 1'), checkAiHealth()]);
            const wa = getWaStatus();
            const degraded = wa.state !== 'open' || !aiHealthReady(aiHealth);
            res.json({
                status: degraded ? 'degraded' : 'ok',
                uptimeSeconds: Math.round(process.uptime()),
                checks: {
                    database: { status: 'ok', latencyMs: Date.now() - started },
                    whatsapp: { status: wa.state === 'open' ? 'ok' : 'degraded', state: wa.state, lastUpdate: wa.lastUpdate },
                    ai: aiHealth,
                    shipping: { status: process.env.RAJAONGKIR_API_KEY ? 'configured' : 'optional' },
                    lookup: { status: process.env.TAVILY_API_KEY ? 'configured' : 'optional' },
                },
            });
        } catch (error) {
            res.status(503).json({ status: 'error', checks: { database: { status: 'error' } } });
        }
    });

    app.get('/admin/backup/export', (_req, res) => {
        const payload = createBackupPayload();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="voidlark-backup-${new Date().toISOString().slice(0, 10)}.json"`);
        res.send(JSON.stringify(payload, null, 2));
    });

    app.post('/admin/backup/preview', backupUpload.single('backup'), (req, res) => {
        try {
            if (!req.file) throw new Error('Pilih file cadangan terlebih dahulu.');
            const payload = parseBackupPayload(req.file.buffer);
            const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
            backupPreviewCache.set(token, { payload, expiresAt: Date.now() + 15 * 60 * 1000 });
            for (const [key, cached] of backupPreviewCache) if (cached.expiresAt < Date.now()) backupPreviewCache.delete(key);
            res.send(page('Periksa Cadangan', `${pageHeader('Periksa Cadangan', 'Pastikan isi cadangan benar sebelum dipulihkan.', 'BK-10')}<section class="panel"><div class="detail-grid"><div class="detail-row"><span>Dibuat</span><strong>${escapeHtml(payload.createdAt)}</strong></div><div class="detail-row"><span>File pengaturan</span><strong>${Object.keys(payload.files).length}</strong></div><div class="detail-row"><span>File Katalog & Informasi</span><strong>${payload.knowledge.length}</strong></div><div class="detail-row"><span>API key & sesi WA</span><strong>Tidak disertakan</strong></div></div><form method="post" action="/admin/backup/restore" data-confirm="Pulihkan pengaturan dan Katalog & Informasi dari cadangan ini? File lama akan diganti secara atomik."><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">Pulihkan cadangan</button></form></section>`, 'settings'));
        } catch (error) {
            redirectWithMsg(res, '/admin/settings', `Cadangan tidak dapat dibaca: ${error instanceof Error ? error.message : 'format tidak valid'}`, 'error');
        }
    });

    app.post('/admin/backup/restore', async (req, res) => {
        try {
            const token = String(req.body.token || '');
            const cached = backupPreviewCache.get(token);
            if (!cached || cached.expiresAt < Date.now()) throw new Error('Preview backup sudah kedaluwarsa. Unggah ulang file backup.');
            const payload = cached.payload;
            backupPreviewCache.delete(token);
            await restoreBackupPayload(payload);
            if (payload.operationalSettings) {
                dotenv.config({ path: ENV_PATH, override: true });
                for (const key of SAFE_OPERATIONAL_ENV_KEYS) {
                    if (payload.version === 2 && !(key in payload.operationalSettings)) delete process.env[key];
                }
                invalidateAiHealth();
            }
            redirectWithMsg(res, '/admin/settings', 'Backup berhasil dipulihkan. API key dan sesi WhatsApp tidak berubah.');
        } catch (error) {
            redirectWithMsg(res, '/admin/settings', `Pemulihan gagal: ${error instanceof Error ? error.message : 'format tidak valid'}`, 'error');
        }
    });

    app.get('/admin/api/dashboard', async (_req, res) => {
        fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
        const wa = getWaStatus();
        const env = readEnvValues();
        const aiHealth = await checkAiHealth();
        const aiReady = aiHealthReady(aiHealth);
        const [leads, orders, draftOrders, awaitingPayment, paidOrders, handoffs, recentHandoffs, inboundFailures, outboundFailures] = await Promise.all([
            pool.query('SELECT COUNT(*) AS count FROM leads'),
            pool.query('SELECT COUNT(*) AS count FROM orders'),
            pool.query("SELECT COUNT(*) AS count FROM orders WHERE status = 'draft'"),
            pool.query("SELECT COUNT(*) AS count FROM orders WHERE status = 'awaiting_payment'"),
            pool.query("SELECT COUNT(*) AS count FROM orders WHERE status = 'paid'"),
            pool.query(`SELECT COUNT(*) AS count FROM handoff_log WHERE ${unresolvedHandoffPredicate()}`),
            pool.query(`SELECT jid, reason, created_at FROM handoff_log WHERE ${unresolvedHandoffPredicate()} ORDER BY created_at ASC LIMIT 4`),
            messageStore.listInboundFailures(20),
            messageStore.listOutboundFailures(20),
        ]);
        const knowledgeCount = fs.readdirSync(KNOWLEDGE_DIR).length;
        const businessConfig = getBusinessConfig();
        const profileReady = businessConfig.businessName.trim().length > 1 && businessConfig.csName.trim().length > 1;
        const handoffCount = Number(handoffs.rows[0]?.count || 0);
        const orderCount = Number(orders.rows[0]?.count || 0);
        const draftCount = Number(draftOrders.rows[0]?.count || 0);
        const waitingCount = Number(awaitingPayment.rows[0]?.count || 0);
        const paidCount = Number(paidOrders.rows[0]?.count || 0);
        const pipelineCount = inboundFailures.length + outboundFailures.length;
        const configReady = fs.existsSync(CONFIG_PATH);
        const setupSteps = [
            { done: configReady, title: 'Isi profil dan alur bisnis', text: 'Nama bisnis, tipe produk, pembayaran, dan data pelanggan.', href: '/admin/config' },
            { done: aiReady, title: 'Hubungkan layanan AI', text: 'Bot membutuhkan koneksi AI untuk menulis balasan.', href: '/admin/settings' },
            { done: knowledgeCount > 0, title: 'Unggah katalog atau FAQ', text: 'Sumber informasi produk, harga, dan pertanyaan umum.', href: '/admin/knowledge' },
            { done: wa.state === 'open', title: 'Hubungkan WhatsApp', text: 'Scan QR hingga status menjadi terhubung.', href: '/admin/whatsapp' },
        ];
        const attention = [
            handoffCount > 0 ? { title: `${handoffCount} pelanggan menunggu admin`, text: 'Tangani percakapan yang dialihkan oleh bot.', href: '/admin/handoff', action: 'Tangani sekarang' } : null,
            waitingCount > 0 ? { title: `${waitingCount} pembayaran perlu diperiksa`, text: 'Pastikan transfer diterima sebelum menandai pesanan lunas.', href: '/admin/orders?status=awaiting_payment', action: 'Periksa pembayaran' } : null,
            !aiReady ? { title: `Layanan AI: ${aiHealth.label}`, text: aiHealth.detail, href: '/admin/settings', action: 'Periksa koneksi' } : null,
            knowledgeCount === 0 ? { title: 'Katalog dan informasi masih kosong', text: 'Unggah sumber informasi agar jawaban bot sesuai bisnis.', href: '/admin/knowledge', action: 'Unggah informasi' } : null,
            wa.state !== 'open' ? { title: 'WhatsApp belum terhubung', text: 'Hubungkan nomor agar bot dapat menerima pesan.', href: '/admin/whatsapp', action: 'Kelola WhatsApp' } : null,
        ].filter(Boolean);
        const sessions = globalWhatsAppManager.getSessions();
        const online = sessions.filter(session => session.status === 'online').length;
        res.json({
            metrics: [
                { label: 'Perlu ditangani', value: handoffCount, href: '/admin/handoff', tone: handoffCount ? 'danger' : 'neutral', icon: 'alert' },
                { label: 'Verifikasi bayar', value: waitingCount, href: '/admin/orders?status=awaiting_payment', tone: waitingCount ? 'warn' : 'neutral', icon: 'payment' },
                { label: 'Calon pelanggan', value: Number(leads.rows[0]?.count || 0), href: '/admin/leads', tone: 'neutral', icon: 'users' },
                { label: 'Total pesanan', value: orderCount, href: '/admin/orders', tone: 'neutral', icon: 'orders' },
                ...(pipelineCount ? [{ label: 'Pesan perlu retry', value: pipelineCount, href: '/admin/handoff#pipeline-failures', tone: 'danger', icon: 'retry' }] : []),
            ],
            setup: { done: setupSteps.filter(step => step.done).length, total: setupSteps.length, steps: setupSteps },
            attention,
            services: [
                { label: 'WhatsApp', value: online ? `${online} / ${Math.max(sessions.length, 1)} online` : waLabel(wa.state), detail: `Rotasi ${globalWhatsAppManager.getConfig().rotationMode}`, tone: online || wa.state === 'open' ? 'ok' : 'warn' },
                { label: 'AI engine', value: aiHealth.label, detail: aiHealth.detail, tone: aiReady ? 'ok' : 'danger' },
                { label: 'Ongkir', value: env.RAJAONGKIR_API_KEY ? 'Siap' : 'Belum dikonfigurasi', detail: env.STORE_CITY_NAME || 'Lokasi toko belum diisi', tone: env.RAJAONGKIR_API_KEY ? 'ok' : 'warn' },
            ],
            recentHandoffs: recentHandoffs.rows.map((row: any) => ({ jid: shortJid(row.jid), reason: row.reason || 'Perlu admin', time: fmtTime(row.created_at) })),
            orders: { total: orderCount, draft: draftCount, waiting: waitingCount, paid: paidCount },
        });
    });

    app.get('/admin/api/leads', async (req, res) => {
        const sort = resolveLeadSort(req.query.sort, req.query.direction);
        const search = String(req.query.q || '').trim();
        let sql = `SELECT leads.*, COALESCE(chat_stats.msg_count, 0) AS msg_count FROM leads LEFT JOIN (SELECT jid, COUNT(*) AS msg_count FROM chat_history GROUP BY jid) AS chat_stats ON chat_stats.jid = leads.jid`;
        const params: any[] = [];
        if (search) { params.push(`%${search.toLowerCase()}%`); sql += ` WHERE LOWER(leads.name) LIKE $1 OR LOWER(leads.phone) LIKE $1 OR LOWER(leads.jid) LIKE $1 OR LOWER(leads.preferences) LIKE $1`; }
        sql += ` ORDER BY ${sort.orderBy} LIMIT 100`;
        const result = await pool.query(sql, params);
        res.json({ rows: result.rows, sort, search });
    });

    app.get('/admin/api/orders', async (req, res) => {
        const requested = String(req.query.status || 'all').toLowerCase();
        const active = new Set(['all', 'draft', 'awaiting_payment', 'paid']).has(requested) ? requested : 'all';
        const [rows, all, draft, awaiting, paid] = await Promise.all([
            active === 'all' ? pool.query('SELECT * FROM orders ORDER BY updated_at DESC LIMIT 100') : pool.query('SELECT * FROM orders WHERE status = $1 ORDER BY updated_at DESC LIMIT 100', [active]),
            pool.query('SELECT COUNT(*) AS count FROM orders'), pool.query("SELECT COUNT(*) AS count FROM orders WHERE status = 'draft'"), pool.query("SELECT COUNT(*) AS count FROM orders WHERE status = 'awaiting_payment'"), pool.query("SELECT COUNT(*) AS count FROM orders WHERE status = 'paid'"),
        ]);
        res.json({ rows: rows.rows, active, counts: { all: Number(all.rows[0]?.count || 0), draft: Number(draft.rows[0]?.count || 0), awaiting_payment: Number(awaiting.rows[0]?.count || 0), paid: Number(paid.rows[0]?.count || 0) } });
    });

    app.get('/admin/api/handoff', async (_req, res) => {
        const [rows, inbound, outbound] = await Promise.all([handoffRepository.listActive(100), messageStore.listInboundFailures(20), messageStore.listOutboundFailures(20)]);
        res.json({ rows, failures: [...inbound.map(item => ({ ...item, direction: 'Masuk', route: 'inbound' })), ...outbound.map(item => ({ ...item, direction: 'Keluar', route: 'outbound' }))] });
    });

    app.get('/admin/api/knowledge', async (_req, res) => {
        fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
        const files = fs.readdirSync(KNOWLEDGE_DIR).map(name => { const stat = fs.statSync(path.join(KNOWLEDGE_DIR, name)); return { name, size: stat.size, updated: stat.mtime.toISOString() }; });
        res.json({ files, jobs: await knowledgeStore.listJobs(20) });
    });

    app.get('/admin', async (req, res) => {
        fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
        const wa = getWaStatus();
        const env = readEnvValues();
        const aiHealth = await checkAiHealth();
        const aiReady = aiHealthReady(aiHealth);
        const shippingReady = Boolean(env.RAJAONGKIR_API_KEY);
        const [leads, orders, draftOrders, awaitingPayment, paidOrders, handoffs, recentHandoffs, recentOrders, recentErrors, inboundFailures, outboundFailures] = await Promise.all([
            pool.query('SELECT COUNT(*) AS count FROM leads'),
            pool.query('SELECT COUNT(*) AS count FROM orders'),
            pool.query("SELECT COUNT(*) AS count FROM orders WHERE status = 'draft'"),
            pool.query("SELECT COUNT(*) AS count FROM orders WHERE status = 'awaiting_payment'"),
            pool.query("SELECT COUNT(*) AS count FROM orders WHERE status = 'paid'"),
            pool.query(`SELECT COUNT(*) AS count FROM handoff_log WHERE ${unresolvedHandoffPredicate()}`),
            pool.query(`SELECT jid, reason, created_at FROM handoff_log WHERE ${unresolvedHandoffPredicate()} ORDER BY created_at ASC LIMIT 4`),
            pool.query('SELECT jid, product_name, aroma, status, customer_name, updated_at FROM orders ORDER BY updated_at DESC LIMIT 4'),
            pool.query("SELECT COUNT(*) AS count FROM lookup_cache WHERE result LIKE '%Error%' OR result LIKE '%gagal%'"),
            messageStore.listInboundFailures(20),
            messageStore.listOutboundFailures(20),
        ]);
        const knowledgeCount = fs.readdirSync(KNOWLEDGE_DIR).length;
        const dashboardConfig = getBusinessConfig();
        const profileReady = dashboardConfig.businessName.trim().length > 1 && dashboardConfig.csName.trim().length > 1;
        const handoffCount = Number(handoffs.rows[0]?.count || 0);
        const orderCount = Number(orders.rows[0]?.count || 0);
        const draftOrderCount = Number(draftOrders.rows[0]?.count || 0);
        const awaitingPaymentCount = Number(awaitingPayment.rows[0]?.count || 0);
        const paidOrderCount = Number(paidOrders.rows[0]?.count || 0);
        const errorCount = Number(recentErrors.rows[0]?.count || 0);
        const pipelineFailureCount = inboundFailures.length + outboundFailures.length;
        const chartTotal = Math.max(draftOrderCount + awaitingPaymentCount + paidOrderCount, 1);
        const visibleBarPercent = (count: number) => count > 0 ? Math.max(8, Math.round((count / chartTotal) * 100)) : 0;
        const draftPercent = visibleBarPercent(draftOrderCount);
        const waitingPercent = visibleBarPercent(awaitingPaymentCount);
        const paidPercent = visibleBarPercent(paidOrderCount);
        const waSessions = globalWhatsAppManager.getSessions();
        const onlineWaCount = waSessions.filter((session) => getWaSessionStatus(session.phone).state === 'open').length;
        const whatsappReady = onlineWaCount > 0 || wa.state === 'open';
        const setupChecks = [profileReady, knowledgeCount > 0, aiReady, whatsappReady];
        const setupDone = setupChecks.filter(Boolean).length;
        const setupPercent = Math.round((setupDone / setupChecks.length) * 100);
        const attentionItems = [
            handoffCount > 0 ? { title: `${handoffCount} pelanggan menunggu admin`, text: 'Tangani percakapan yang dialihkan oleh bot.', href: '/admin/handoff', action: 'Tangani sekarang' } : null,
            awaitingPaymentCount > 0 ? { title: `${awaitingPaymentCount} pembayaran perlu diperiksa`, text: 'Pastikan transfer diterima sebelum menandai pesanan lunas.', href: '/admin/orders?status=awaiting_payment', action: 'Periksa pembayaran' } : null,
            !aiReady ? { title: `Layanan AI: ${aiHealth.label}`, text: aiHealth.detail, href: '/admin/settings', action: 'Periksa koneksi' } : null,
            knowledgeCount === 0 ? { title: 'Katalog dan informasi masih kosong', text: 'Unggah sumber informasi agar jawaban bot sesuai bisnis.', href: '/admin/knowledge', action: 'Unggah informasi' } : null,
            !whatsappReady ? { title: 'WhatsApp belum terhubung', text: 'Scan QR untuk mulai menerima pesan customer.', href: '/admin/whatsapp', action: 'Hubungkan WhatsApp' } : null,
        ].filter(Boolean) as Array<{ title: string; text: string; href: string; action: string }>;
        const setupSteps = [
            { done: profileReady, title: 'Isi profil bisnis', text: 'Nama bisnis, nama CS, tipe produk, dan data pesanan.', href: '/admin/config' },
            { done: knowledgeCount > 0, title: 'Unggah katalog atau FAQ', text: 'Sumber informasi produk, harga, dan pertanyaan umum.', href: '/admin/knowledge' },
            { done: aiReady, title: 'Hubungkan layanan AI', text: 'Bot membutuhkan koneksi AI untuk menulis balasan.', href: '/admin/settings' },
            { done: whatsappReady, title: 'Hubungkan WhatsApp', text: 'Scan QR hingga satu nomor berstatus terhubung.', href: '/admin/whatsapp' },
        ];
        const nextSetupStep = setupSteps.find((step) => !step.done);
        const totalWaCount = waSessions.length || 1;
        res.send(page('Ringkasan', `
${pageHeader('Ringkasan', 'Lihat kesiapan bot dan pekerjaan yang perlu diselesaikan.', 'OP-01')}
<section class="guided-setup" aria-labelledby="guided-setup-title">
  <div><h2 id="guided-setup-title">${setupDone === setupChecks.length ? 'Bot siap diuji' : 'Selesaikan setup utama'}</h2><p class="muted">${setupDone === setupChecks.length ? 'Semua koneksi utama siap. Jalankan simulasi sebelum menerima chat customer.' : 'Ikuti satu langkah berikutnya. Pengaturan teknis dapat disesuaikan nanti.'}</p></div>
  <div class="guided-next"><div class="guided-next-copy"><span>${setupDone} dari ${setupChecks.length} selesai</span><strong>${escapeHtml(nextSetupStep?.title || 'Tes percakapan bot')}</strong></div><a class="button-link" href="${nextSetupStep?.href || '/admin/sandbox'}">${nextSetupStep ? 'Lanjutkan setup' : 'Buka simulasi'}</a></div>
</section>
<button type="button" class="ghost-btn setup-reveal" data-setup-reveal>Lihat kesiapan bot</button>
<div class="setup-shell" data-setup-shell>
  <div class="setup-heading"><section class="section-head"><div><h2>Kesiapan bot</h2><p class="muted">${setupDone} dari ${setupChecks.length} langkah utama selesai.</p></div></section><button type="button" class="ghost-btn setup-toggle" data-setup-hide>Tutup</button></div>
  <div class="setup-list">${setupSteps.map((step) => `<div class="setup-step ${step.done ? 'done' : ''}"><span class="setup-mark">${step.done ? icon('check') : '—'}</span><div><strong>${escapeHtml(step.title)}</strong><span>${escapeHtml(step.text)}</span></div><a class="ghost-btn" href="${step.href}">${step.done ? 'Periksa' : 'Atur sekarang'}</a></div>`).join('')}</div>
</div>
${attentionItems.length > 0 ? `<section class="attention-panel"><div class="attention-head"><h2>Perlu dilakukan sekarang</h2><span>${attentionItems.length} tindakan</span></div><div class="attention-list">${attentionItems.map((item, index) => `<div class="attention-item"><span class="attention-index">${String(index + 1).padStart(2, '0')}</span><div class="attention-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.text)}</span></div><a class="ghost-btn" href="${item.href}">${escapeHtml(item.action)}</a></div>`).join('')}</div></section>` : ''}
<div class="grid" aria-label="Ringkasan operasional">
  <a class="stat ${handoffCount > 0 ? 'urgent' : ''}" href="/admin/handoff"><span class="stat-icon">${icon('alert')}</span><span class="stat-copy"><span>Perlu ditangani</span><strong>${escapeHtml(handoffCount)}</strong></span></a>
  <a class="stat ${awaitingPaymentCount > 0 ? 'urgent' : ''}" href="/admin/orders?status=awaiting_payment"><span class="stat-icon">${icon('payment')}</span><span class="stat-copy"><span>Verifikasi bayar</span><strong>${escapeHtml(awaitingPaymentCount)}</strong></span></a>
  <a class="stat" href="/admin/leads"><span class="stat-icon">${icon('users')}</span><span class="stat-copy"><span>Calon pelanggan</span><strong>${escapeHtml(leads.rows[0]?.count || 0)}</strong></span></a>
  <a class="stat" href="/admin/orders"><span class="stat-icon">${icon('orders')}</span><span class="stat-copy"><span>Total pesanan</span><strong>${escapeHtml(orderCount)}</strong></span></a>
  <a class="stat ${pipelineFailureCount > 0 ? 'urgent' : ''}" href="/admin/handoff#pipeline-failures"><span class="stat-icon">${icon('retry')}</span><span class="stat-copy"><span>Pesan perlu retry</span><strong>${escapeHtml(pipelineFailureCount)}</strong></span></a>
</div>
<div class="status-grid">
  <div class="status-card">
    <span class="status-dot ${onlineWaCount > 0 || wa.state === 'open' ? 'ok' : 'warn'}"></span><div><div class="label">WhatsApp Engine</div><div class="value">${onlineWaCount > 0 ? `${onlineWaCount} / ${totalWaCount} Online` : escapeHtml(waLabel(wa.state))}</div></div>
    <p class="muted">Rotasi: ${escapeHtml(globalWhatsAppManager.getConfig().rotationMode.toUpperCase())} · <a href="/admin/whatsapp" style="color:inherit; text-decoration:underline;">Kelola WhatsApp</a></p>
  </div>
  <div class="status-card">
    <span class="status-dot ${aiHealthTone(aiHealth)}"></span><div><div class="label">AI engine</div><div class="value">${escapeHtml(aiHealth.label)}</div></div>
    <p class="muted status-detail-wrap">${escapeHtml(aiHealth.detail)} · ${fmtTime(aiHealth.checkedAt)}</p>
  </div>
  <div class="status-card">
    <span class="status-dot ${shippingReady ? 'ok' : 'warn'}"></span><div><div class="label">Ongkir</div><div class="value">${shippingReady ? 'Siap' : 'Belum dikonfigurasi'}</div></div>
    <p class="muted">${escapeHtml(env.STORE_CITY_NAME || 'Lokasi toko belum diisi')}</p>
  </div>
</div>
${errorCount > 0 ? `<p class="muted">Monitoring mencatat ${errorCount} hasil lookup yang perlu diperiksa.</p>` : ''}
<div class="ops-grid">
  <section class="panel">
    <div class="panel-head"><h2>Pelanggan menunggu</h2><a class="panel-link" href="/admin/handoff">Buka daftar</a></div>
    ${recentHandoffs.rows.length === 0
        ? emptyState('Aman', 'Tidak ada pelanggan yang membutuhkan bantuan admin.', '/admin/handoff', 'Lihat daftar')
        : `<div class="timeline">${recentHandoffs.rows.map((row: any) => `
            <div class="timeline-item"><span class="timeline-dot danger"></span><div class="timeline-copy">
              <strong class="mono">${shortJid(row.jid)}</strong>
              <div class="timeline-meta"><span>${escapeHtml(row.reason || 'Perlu admin')}</span><span>${fmtTime(row.created_at)}</span></div>
            </div></div>`).join('')}</div>`}
  </section>
  <section class="panel">
    <div class="panel-head"><h2>Ringkasan pesanan</h2><a class="panel-link" href="/admin/orders">Lihat pesanan</a></div>
    <div class="distribution">
      <div class="order-total"><span>jumlah pesanan</span><strong>${orderCount}</strong></div>
      <div class="order-bars">
        <div class="order-bar"><span>Draft</span><div class="bar-track"><div class="bar-fill warn" style="width:${draftPercent}%"></div></div><strong>${draftOrderCount}</strong></div>
        <div class="order-bar"><span>Menunggu</span><div class="bar-track"><div class="bar-fill danger" style="width:${waitingPercent}%"></div></div><strong>${awaitingPaymentCount}</strong></div>
        <div class="order-bar"><span>Lunas</span><div class="bar-track"><div class="bar-fill success" style="width:${paidPercent}%"></div></div><strong>${paidOrderCount}</strong></div>
      </div>
      <div class="setup-progress"><div class="progress-head"><span>Kesiapan workspace</span><strong>${setupDone}/${setupChecks.length}</strong></div><div class="progress-track" role="progressbar" aria-label="Kesiapan workspace" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${setupPercent}"><div class="progress-fill" style="width:${setupPercent}%"></div></div><span class="muted">WA, AI, Config, dan ${knowledgeCount} file knowledge.</span></div>
    </div>
  </section>
</div>`, 'dashboard', { refreshSeconds: 30, toastHtml: toastFromQuery(req.query as Record<string, unknown>) }));
    });

    app.get('/admin/config', (req, res) => {
        const configText = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, 'utf-8') : '{}';
        const config = JSON.parse(configText);
        const checkoutFields = config.checkoutFields || [];
        const orderFields = config.orderFields || [];
        const customCheckoutFields = checkoutFields.filter((field: string) => !CHECKOUT_FIELD_OPTIONS.some((option) => option.value === field)).join(', ');
        const customOrderFields = orderFields.filter((field: string) => !ORDER_FIELD_OPTIONS.some((option) => option.value === field)).join(', ');
        const operationalConfig = getBusinessConfig();
        const weekdayLabels: Record<string, string> = { monday: 'Senin', tuesday: 'Selasa', wednesday: 'Rabu', thursday: 'Kamis', friday: 'Jumat', saturday: 'Sabtu', sunday: 'Minggu' };
        const shippingWeightRows = Object.entries(config.shippingWeights || {});
        res.send(page('Config', `
${pageHeader('Profil & Alur Bisnis', 'Atur kebutuhan utama dulu. Detail teknis tetap tersedia saat dibutuhkan.', 'CF-02')}
<div class="config-mode-bar"><div class="config-mode-copy"><strong>Tingkat pengaturan</strong><span>Mode Dasar menampilkan hal yang dibutuhkan agar bot cepat siap.</span></div><div class="segmented-control" aria-label="Tingkat pengaturan"><button type="button" data-config-mode-button="basic" aria-pressed="true">Dasar</button><button type="button" data-config-mode-button="advanced" aria-pressed="false">Lanjutan</button></div></div>
<div class="config-preset-bar"><div class="config-preset-copy"><strong>Mulai dengan preset</strong><span>Preset mengisi field umum. Periksa hasil sebelum menyimpan.</span></div><div class="preset-actions"><button type="button" class="secondary-button" data-business-preset="physical">Produk fisik</button><button type="button" class="secondary-button" data-business-preset="digital">Produk digital</button></div></div>
<div data-config-scope data-config-mode="basic">
<form method="post" action="/admin/config" data-unsaved data-config-form data-config-mode="basic">
  <p class="basic-note">Empat bagian teknis disembunyikan. Pilih Lanjutan jika perlu mengatur referensi web, bobot ongkir, jam kerja, SLA, atau consent.</p>
  <details class="config-section" data-persist-collapse="config-business-identity" open>
    <summary><span>1. Identitas & alur<span class="config-section-copy">Pengaturan dasar yang menentukan cara bot melayani customer.</span></span></summary>
    <div class="config-section-body config-layout">
    <div class="config-column">
      <div class="field">
        <label for="businessName">Nama Bisnis / Produk</label>
        <input id="businessName" name="businessName" value="${escapeHtml(config.businessName || '')}" placeholder="contoh: NamaToko, BrandX, Kelas Online">
      </div>
      <div class="field">
        <label for="csName">Nama CS virtual</label>
        <input id="csName" name="csName" value="${escapeHtml(config.csName || 'Anin')}" placeholder="contoh: Anin, Rara, Dinda">
      </div>
    </div>
    <div class="config-column">
      <div class="field">
        <label for="productType">Jenis produk</label>
        <select id="productType" name="productType" data-product-type>
          ${PRODUCT_TYPE_OPTIONS.map((option) => `<option value="${option.value}" data-description="${escapeHtml(option.description)}" ${config.productType === option.value ? 'selected' : ''}>${option.label}</option>`).join('')}
        </select>
        <p class="muted" data-product-description>${escapeHtml(PRODUCT_TYPE_OPTIONS.find((option) => option.value === config.productType)?.description || PRODUCT_TYPE_OPTIONS[0].description)}</p>
      </div>
      <div class="field">
        <label>Pengiriman</label>
        <div><span class="badge-pill ${config.productType === 'digital' ? 'tone-neutral' : 'tone-ok'}" data-shipping-state>${config.productType === 'digital' ? 'Nonaktif otomatis' : 'Aktif otomatis'}</span></div>
        <p class="muted">Mengikuti tipe produk: otomatis aktif untuk fisik dan nonaktif untuk digital. API key, lokasi toko, dan kurir diatur di Settings.</p>
      </div>
      <div class="field" data-config-advanced>
        <label>Pencarian referensi web</label>
        <div class="switchbox">
          <label class="switchline">
            <input type="checkbox" name="enableExternalProductLookup" value="true" ${config.enableExternalProductLookup ? 'checked' : ''}>
            <span class="switch-track" aria-hidden="true"></span>
            <span class="switch-label">Cari referensi web</span>
          </label>
        </div>
        <p class="muted">Cari referensi produk di web melalui Tavily saat Knowledge belum cukup. Hasil web hanya referensi dan bukan informasi stok toko.</p>
      </div>
    </div>
    </div>
  </details>
  <details class="config-section" data-persist-collapse="config-product-checkout" open>
    <summary><span>2. Data checkout & order<span class="config-section-copy">Pilih informasi yang wajib lengkap sebelum bot mengunci pesanan.</span></span></summary>
    <div class="config-section-body">
    <div class="field full">
      <label>Data pelanggan yang perlu dikumpulkan</label>
      ${renderFieldChoices('checkoutFields', checkoutFields, CHECKOUT_FIELD_OPTIONS)}
      <label class="sr-only" for="checkoutFieldsCustom">Field checkout tambahan</label>
      <input id="checkoutFieldsCustom" name="checkoutFieldsCustom" value="${escapeHtml(customCheckoutFields)}" placeholder="Field tambahan, pisahkan koma">
      <p class="muted">Produk fisik umum: Nama, No HP / WA, Alamat. Produk digital umum: Nama, No HP / WA, Email.</p>
    </div>
    <div class="field full">
      <label>Detail pesanan yang perlu dicatat</label>
      ${renderFieldChoices('orderFields', orderFields, ORDER_FIELD_OPTIONS)}
      <label class="sr-only" for="orderFieldsCustom">Field order tambahan</label>
      <input id="orderFieldsCustom" name="orderFieldsCustom" value="${escapeHtml(customOrderFields)}" placeholder="Field tambahan, pisahkan koma">
      <p class="muted">Pakai default kalau belum yakin. Ini membantu bot membuat ringkasan order yang lengkap.</p>
    </div>
    </div>
  </details>
  <details class="config-section" data-persist-collapse="config-payments" open>
    <summary><span>3. Pengiriman & pembayaran<span class="config-section-copy">Pengaturan lanjutan untuk estimasi berat dan instruksi bayar.</span></span></summary>
    <div class="config-section-body">
    <div class="field full" data-config-advanced>
      <label>Bobot ongkir per pilihan produk</label>
      <div class="repeat-list" data-weight-list>
        ${(shippingWeightRows.length ? shippingWeightRows : [['', '']]).map(([label, grams]) => `<div class="repeat-row" data-weight-row><label><span>Label pilihan</span><input name="shippingWeightLabel" value="${escapeHtml(label)}" placeholder="contoh: 30ml"></label><label><span>Berat (gram)</span><input name="shippingWeightGrams" type="number" min="1" step="1" value="${escapeHtml(grams)}" placeholder="110"></label><button type="button" class="secondary-button" data-remove-weight>Hapus</button></div>`).join('')}
      </div>
      <button type="button" class="secondary-button" data-add-weight>Tambah pilihan bobot</button>
      <p class="muted">Baris kosong atau berat yang tidak valid akan diabaikan saat disimpan.</p>
    </div>
    <div class="field full">
      <label for="paymentInstructions">Instruksi pembayaran</label>
      <textarea id="paymentInstructions" name="paymentInstructions" class="textarea-md">${escapeHtml(config.paymentInstructions || '')}</textarea>
      <p class="muted">Dikirim kepada pelanggan ketika pesanan masuk tahap menunggu pembayaran. Isi rekening, QR, atau cara bayar.</p>
    </div>
    <div class="field full">
      <div class="switchbox"><label class="switchline"><input type="checkbox" name="handoffAfterPaymentSummary" value="true" ${operationalConfig.handoffAfterPaymentSummary ? 'checked' : ''}><span class="switch-track" aria-hidden="true"></span><span class="switch-label">Alihkan ke admin setelah ringkasan pesanan dikirim</span></label></div>
      <p class="muted">Aktif: bot hanya mengirim ringkasan pesanan, lalu menghentikan balasan otomatis agar admin menangani pembayaran. Nonaktif: bot mengirim ringkasan pesanan beserta instruksi pembayaran.</p>
    </div>
    </div>
  </details>
  <details class="config-section" data-persist-collapse="config-operations" data-config-advanced>
    <summary><span>4. Jam operasional & consent<span class="config-section-copy">Atur timezone, jadwal, hari libur, SLA, dan keyword opt-out.</span></span></summary>
    <div class="config-section-body">
      <div class="field full">
        <div class="switchbox"><label class="switchline"><input type="checkbox" name="businessHoursEnabled" value="true" ${operationalConfig.businessHours.enabled ? 'checked' : ''}><span class="switch-track" aria-hidden="true"></span><span class="switch-label">Batasi balasan otomatis sesuai jam kerja</span></label></div>
        <p class="muted">Jika nonaktif, perilaku auto-reply lama tetap berjalan 24 jam.</p>
      </div>
      <div class="config-layout">
        <div class="field"><label for="businessTimezone">Zona waktu</label><input id="businessTimezone" name="businessTimezone" value="${escapeHtml(operationalConfig.businessHours.timezone)}" placeholder="Asia/Jakarta"></div>
        <div class="field"><label for="businessHandoffPolicy">Pesan di luar jam kerja</label><select id="businessHandoffPolicy" name="businessHandoffPolicy"><option value="create" ${operationalConfig.businessHours.handoffPolicy === 'create' ? 'selected' : ''}>Catat untuk ditangani admin</option><option value="none" ${operationalConfig.businessHours.handoffPolicy === 'none' ? 'selected' : ''}>Balas otomatis saja</option></select></div>
      </div>
      <div class="field full"><label>Jadwal mingguan</label><div class="weekday-grid">${Object.entries(weekdayLabels).map(([day, label]) => `<label><span>${label}</span><input name="hours_${day}" value="${escapeHtml(operationalConfig.businessHours.weekly[day as keyof typeof operationalConfig.businessHours.weekly].join(', '))}" placeholder="09:00-17:00, 19:00-21:00"></label>`).join('')}</div><p class="muted">Pisahkan beberapa sesi dengan koma. Kosongkan hari libur.</p></div>
      <div class="field full"><label for="businessHolidays">Tanggal libur khusus</label><input id="businessHolidays" name="businessHolidays" value="${escapeHtml(operationalConfig.businessHours.holidays.join(', '))}" placeholder="2026-08-17, 2026-12-25"></div>
      <div class="config-layout">
        <div class="field"><label for="outOfHoursResponse">Balasan di luar jam kerja</label><textarea id="outOfHoursResponse" name="outOfHoursResponse" class="textarea-sm">${escapeHtml(operationalConfig.businessHours.outOfHoursResponse)}</textarea></div>
        <div class="field"><label for="responseEstimate">Perkiraan balasan</label><textarea id="responseEstimate" name="responseEstimate" class="textarea-sm">${escapeHtml(operationalConfig.businessHours.responseEstimate)}</textarea></div>
      </div>
      <div class="field full"><label>SLA handoff (menit)</label><div class="config-layout">${(['low', 'normal', 'high', 'urgent'] as const).map((priority) => `<label><span>${priority === 'low' ? 'Rendah' : priority === 'normal' ? 'Normal' : priority === 'high' ? 'Tinggi' : 'Mendesak'}</span><input type="number" min="1" name="sla_${priority}" value="${operationalConfig.businessHours.slaMinutes[priority]}"></label>`).join('')}</div></div>
      <div class="field full"><label>Kontrol izin pesan promosi</label><p class="muted">Keyword tidak memengaruhi balasan layanan; hanya komunikasi marketing dan proaktif.</p></div>
      <div class="config-layout">
        <div class="field"><label for="optOutKeywords">Keyword berhenti</label><input id="optOutKeywords" name="optOutKeywords" value="${escapeHtml(operationalConfig.consent.optOutKeywords.join(', '))}"><label for="optOutResponse">Balasan setelah berhenti</label><textarea id="optOutResponse" name="optOutResponse" class="textarea-sm">${escapeHtml(operationalConfig.consent.optOutResponse)}</textarea></div>
        <div class="field"><label for="optInKeywords">Keyword mulai lagi</label><input id="optInKeywords" name="optInKeywords" value="${escapeHtml(operationalConfig.consent.optInKeywords.join(', '))}"><label for="optInResponse">Balasan setelah mulai lagi</label><textarea id="optInResponse" name="optInResponse" class="textarea-sm">${escapeHtml(operationalConfig.consent.optInResponse)}</textarea></div>
      </div>
    </div>
  </details>
  <div class="sticky-actions"><span class="save-state">Tersimpan</span><button>Simpan Config</button></div>
</form>
<form class="advanced" method="post" action="/admin/config/raw" data-config-advanced>
<details class="advanced" data-persist-collapse="config-advanced-json">
  <summary>Pengaturan teknis untuk developer</summary>
  <p class="muted">Editor JSON dapat merusak konfigurasi jika formatnya salah. Gunakan hanya jika memahami struktur data.</p>
  <label class="sr-only" for="rawConfig">JSON konfigurasi mentah</label>
  <textarea id="rawConfig" name="config" spellcheck="false">${escapeHtml(configText)}</textarea>
  <p><button>Simpan JSON Mentah</button></p>
  </details>
</form>
</div>`, 'config', { toastHtml: toastFromQuery(req.query as Record<string, unknown>) }));
    });

    app.post('/admin/config', (req, res) => {
        const productType = String(req.body.productType || 'physical');
        const previous = getBusinessConfig();
        const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
        const weekly = Object.fromEntries(weekdays.map((day) => [day, parseList(req.body[`hours_${day}`])])) as BusinessConfig['businessHours']['weekly'];
        const config = {
            businessName: String(req.body.businessName || 'Voidlark'),
            csName: String(req.body.csName || 'Anin').trim() || 'Anin',
            productType,
            enableShipping: productType === 'physical',
            enableExternalProductLookup: req.body.enableExternalProductLookup === 'true',
            salesFlow: previous.salesFlow,
            checkoutFields: parseFieldSelection(req.body.checkoutFields, req.body.checkoutFieldsCustom),
            orderFields: parseFieldSelection(req.body.orderFields, req.body.orderFieldsCustom),
            shippingWeights: parseWeightRows(req.body.shippingWeightLabel, req.body.shippingWeightGrams),
            paymentInstructions: String(req.body.paymentInstructions || '').trim(),
            handoffAfterPaymentSummary: req.body.handoffAfterPaymentSummary === 'true',
            businessHours: validateBusinessHoursConfig({
                ...previous.businessHours,
                enabled: req.body.businessHoursEnabled === 'true',
                timezone: String(req.body.businessTimezone || previous.businessHours.timezone).trim(),
                weekly,
                holidays: parseList(req.body.businessHolidays),
                outOfHoursResponse: String(req.body.outOfHoursResponse || '').trim(),
                responseEstimate: String(req.body.responseEstimate || '').trim(),
                handoffPolicy: req.body.businessHandoffPolicy === 'none' ? 'none' : 'create',
                slaMinutes: { low: Number(req.body.sla_low), normal: Number(req.body.sla_normal), high: Number(req.body.sla_high), urgent: Number(req.body.sla_urgent) },
            }),
            consent: {
                optOutKeywords: parseList(req.body.optOutKeywords),
                optInKeywords: parseList(req.body.optInKeywords),
                optOutResponse: String(req.body.optOutResponse || '').trim(),
                optInResponse: String(req.body.optInResponse || '').trim(),
            },
        };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
        redirectWithMsg(res, '/admin/config', 'Profil dan alur bisnis berhasil disimpan.');
    });

    app.post('/admin/config/raw', (req, res) => {
        const config = String(req.body.config || '');
        JSON.parse(config);
        fs.writeFileSync(CONFIG_PATH, config.trim() + '\n');
        redirectWithMsg(res, '/admin/config', 'JSON config tersimpan.');
    });

    app.get('/admin/prompt', (req, res) => {
        const builder = readPromptBuilder();
        const generatedPrompt = buildSystemPrompt(builder);
        const presetJson = JSON.stringify(PROMPT_PRESETS).replaceAll('<', '\\u003c');
        const configData = buildPromptConfigData();
        const replyStyleExample = buildReplyStyleExample({ businessName: configData.businessName, csName: configData.csName, preset: builder.preset });
        const configJson = JSON.stringify(configData).replaceAll('<', '\\u003c');
        res.send(page('Prompt', `
${pageHeader('Gaya Balasan Bot', 'Pilih karakter dan cara bot berbicara kepada pelanggan.', 'PR-03')}
<form method="post" action="/admin/prompt/builder" data-prompt-builder data-unsaved>
  <div class="reply-style-intro"><h2>Atur dari yang paling penting</h2><p>Pilih gaya dasar, sesuaikan cara bicara, lalu periksa hasilnya sebelum disimpan.</p></div>
  <div class="reply-style-layout">
    <div class="reply-style-sections">
      <details class="reply-style-section" data-persist-collapse="prompt-response-style" open>
        <summary><span class="reply-step">1</span><span class="reply-style-section-title"><strong>Preferensi balasan</strong><small>Lima pilihan ini cukup untuk mengatur cara bot berbicara.</small></span></summary><div class="reply-style-body">
        <div class="field full"><label>Karakter CS</label>
        <div class="preset-grid">
          ${Object.entries(PROMPT_PRESETS).map(([key, preset]) => `<label class="preset-card">
            <input type="radio" name="preset" value="${escapeHtml(key)}" ${builder.preset === key ? 'checked' : ''} data-prompt-preset>
            <strong>${escapeHtml(preset.label)}</strong>
            <span>${escapeHtml(preset.description)}</span>
          </label>`).join('')}
        </div>
        </div>
        <div class="simple-style-grid">
          <fieldset class="simple-style-group"><legend>Panjang balasan</legend>
            <label><input type="radio" name="replyLength" value="concise" ${builder.replyLength === 'concise' ? 'checked' : ''}><span><strong>Ringkas</strong><small>Umumnya 1-2 kalimat</small></span></label>
            <label><input type="radio" name="replyLength" value="balanced" ${builder.replyLength === 'balanced' ? 'checked' : ''}><span><strong>Seimbang</strong><small>Umumnya 2-4 kalimat</small></span></label>
            <label><input type="radio" name="replyLength" value="detailed" ${builder.replyLength === 'detailed' ? 'checked' : ''}><span><strong>Detail</strong><small>Lebih lengkap saat dibutuhkan</small></span></label>
          </fieldset>
          <fieldset class="simple-style-group"><legend>Cara menjual</legend>
            <label><input type="radio" name="sellingStyle" value="soft" ${builder.sellingStyle === 'soft' ? 'checked' : ''}><span><strong>Lembut</strong><small>Membantu sebelum menawarkan</small></span></label>
            <label><input type="radio" name="sellingStyle" value="balanced" ${builder.sellingStyle === 'balanced' ? 'checked' : ''}><span><strong>Seimbang</strong><small>Konsultasi lalu arahkan order</small></span></label>
            <label><input type="radio" name="sellingStyle" value="proactive" ${builder.sellingStyle === 'proactive' ? 'checked' : ''}><span><strong>Proaktif</strong><small>Aktif membantu closing</small></span></label>
          </fieldset>
        </div>
        <div class="simple-style-grid compact">
          <div class="field"><label for="promptSalutation">Sapaan customer</label><input id="promptSalutation" name="salutation" maxlength="24" value="${escapeHtml(builder.salutation)}" placeholder="Kak"></div>
          <div class="field"><label for="promptEmojiLevel">Penggunaan emoji</label><select id="promptEmojiLevel" name="emojiLevel"><option value="none" ${builder.emojiLevel === 'none' ? 'selected' : ''}>Tidak digunakan</option><option value="light" ${builder.emojiLevel === 'light' ? 'selected' : ''}>Sedikit</option><option value="expressive" ${builder.emojiLevel === 'expressive' ? 'selected' : ''}>Ekspresif</option></select></div>
        </div>
        </div>
      </details>
      <details class="reply-style-advanced-shell" data-persist-collapse="prompt-advanced-settings">
        <summary><span>Pengaturan bahasa lanjutan</span><small>Editor aturan lama untuk kebutuhan khusus. Intelligence inti tetap dijaga sistem.</small></summary>
        <div class="reply-style-advanced-body">
      <details class="reply-style-section" data-persist-collapse="prompt-speaking-guidelines">
        <summary><span class="reply-step">2</span><span class="reply-style-section-title"><strong>Karakter dan gaya bahasa</strong><small>Tentukan identitas, nada bicara, dan sapaan.</small></span></summary><div class="reply-style-body">
        <div class="builder-grid">
          <div class="field full">
            <label for="promptRole">Karakter Bot</label>
            <input id="promptRole" name="role" value="${escapeHtml(builder.role)}" data-prompt-field>
          </div>
          <div class="field full">
            <label for="promptStyle">Gaya Bahasa</label>
            <textarea id="promptStyle" class="compact-area" name="style" data-prompt-field>${escapeHtml(builder.style)}</textarea>
          </div>
          <div class="field full">
            <label for="promptGreeting">Sapaan</label>
            <textarea id="promptGreeting" class="compact-area" name="greeting" data-prompt-field>${escapeHtml(builder.greeting)}</textarea>
          </div>
        </div>
        </div>
      </details>
      <details class="reply-style-section" data-persist-collapse="prompt-greeting">
        <summary><span>Alur Percakapan<span class="config-section-copy">Identitas bot, konsultasi bertahap, dan cara menjaga konteks chat.</span></span></summary>
        <div class="config-section-body builder-grid">
          <div class="field full"><label for="promptIdentityRules">Identitas dan kejujuran bot</label><textarea id="promptIdentityRules" name="identityRules" data-prompt-field>${escapeHtml(builder.identityRules)}</textarea></div>
          <div class="field full"><label for="promptConsultationRules">Urutan konsultasi customer</label><textarea id="promptConsultationRules" name="consultationRules" data-prompt-field>${escapeHtml(builder.consultationRules)}</textarea></div>
        </div>
      </details>
      <details class="reply-style-section" data-persist-collapse="prompt-preferred-words">
        <summary><span>Aturan Produk & Harga<span class="config-section-copy">Cara bot menggunakan katalog dan informasi produk dari Knowledge.</span></span></summary>
        <div class="config-section-body builder-grid">
          <div class="field full"><label for="promptProductRules">Cara membaca data produk</label><textarea id="promptProductRules" name="productRules" data-prompt-field>${escapeHtml(builder.productRules)}</textarea><p class="muted">Nama produk, kategori, varian, harga, dan aturan khusus dikelola melalui Katalog & Informasi agar dapat digunakan untuk bisnis apa pun.</p></div>
        </div>
      </details>
      <details class="reply-style-section" data-persist-collapse="prompt-response-example">
        <summary><span>Checkout & Pengiriman<span class="config-section-copy">Rekap pesanan, penyimpanan draft, berat paket, dan cek ongkir.</span></span></summary>
        <div class="config-section-body builder-grid">
          <div class="field full"><label for="promptCheckoutRules">Urutan checkout dan draft</label><textarea id="promptCheckoutRules" name="checkoutRules" data-prompt-field>${escapeHtml(builder.checkoutRules)}</textarea></div>
          <div class="field full"><label for="promptShippingRules">Berat dan cek ongkir</label><textarea id="promptShippingRules" name="shippingRules" data-prompt-field>${escapeHtml(builder.shippingRules)}</textarea></div>
        </div>
      </details>
      <details class="reply-style-section" data-persist-collapse="prompt-extra-instructions">
        <summary><span>Aturan Saat Membalas<span class="config-section-copy">Kapan bot menyerahkan chat ke admin dan bagaimana balasan ditulis.</span></span></summary>
        <div class="config-section-body">
        <div class="builder-grid">
          <div class="field full">
            <label for="promptEscalationRules">Kapan perlu bantuan admin</label>
            <textarea id="promptEscalationRules" name="escalationRules" data-prompt-field>${escapeHtml(builder.escalationRules)}</textarea>
          </div>
          <div class="field full">
            <label for="promptFormattingRules">Cara menulis di WhatsApp</label>
            <textarea id="promptFormattingRules" name="formattingRules" data-prompt-field>${escapeHtml(builder.formattingRules)}</textarea>
          </div>
          <div class="field full">
            <label for="promptExtraRules">Kebiasaan tambahan bot</label>
            <textarea id="promptExtraRules" class="compact-area" name="extraRules" data-prompt-field>${escapeHtml(builder.extraRules)}</textarea>
          </div>
        </div>
        </div>
      </details>
        </div>
      </details>
      <div class="prompt-actions sticky-actions">
        <span class="save-state">Tersimpan</span>
        <button>Simpan gaya balasan</button>
        <button class="secondary-button" type="button" data-prompt-ai>Rapikan dengan AI</button>
        <span class="prompt-ai-status" data-prompt-ai-status></span>
      </div>
    </div>
    <aside class="reply-style-preview">
      <section class="prompt-card">
        <h2>Ringkasan Gaya Aktif</h2>
        <div class="prompt-summary">
          <div class="prompt-summary-row"><span>Karakter</span><strong data-prompt-summary-role>${escapeHtml(PROMPT_PRESETS[builder.preset as keyof typeof PROMPT_PRESETS]?.label || 'Ramah santai')}</strong></div>
          <div class="prompt-summary-row"><span>Panjang dan penjualan</span><strong data-prompt-summary-style>${escapeHtml(builder.replyLength)} · ${escapeHtml(builder.sellingStyle)}</strong></div>
          <div class="prompt-summary-row"><span>Sapaan dan emoji</span><strong data-prompt-summary-greeting>${escapeHtml(builder.salutation)} · ${escapeHtml(builder.emojiLevel)}</strong></div>
        </div>
        <div class="reply-example"><div class="reply-example-user">Kak, bisa bantu rekomendasikan yang cocok?</div><div class="reply-example-bot" data-prompt-example-bot>${escapeHtml(replyStyleExample)}</div></div>
        <div class="prompt-next"><span class="muted">Setelah menyimpan, uji hasilnya sebagai customer.</span><a class="button-link" href="/admin/sandbox">Buka Simulasi Percakapan</a></div>
      </section>
      <section class="prompt-card">
        <h2>Pemeriksaan Otomatis</h2>
        <div class="validator-list" data-prompt-validator></div>
      </section>
    </aside>
  </div>
  <pre class="sr-only" data-prompt-preview>${escapeHtml(generatedPrompt)}</pre>
</form>
<details class="developer-lab" data-persist-collapse="prompt-developer-lab">
  <summary>Lihat system prompt aktif</summary>
  <p class="developer-intro">System prompt aktif disimpan terpisah. Membuka halaman ini tidak akan mengubah isinya.</p>
  <section class="developer-pane"><div class="developer-pane-head"><span class="developer-tag">AKTIF · READ ONLY</span><strong>config/system-prompt.txt</strong><span>Berubah hanya saat Gaya Balasan disimpan.</span></div><pre class="prompt-preview" data-prompt-developer-preview>${escapeHtml(fs.existsSync(PROMPT_PATH) ? fs.readFileSync(PROMPT_PATH, 'utf8') : generatedPrompt)}</pre></section>
</details>
<script>window.promptPresetValues = ${presetJson}; window.promptConfigValues = ${configJson};</script>`, 'prompt', { toastHtml: toastFromQuery(req.query as Record<string, unknown>) }));
    });

    app.post('/admin/prompt/builder', (req, res) => {
        const builder = promptBuilderFromBody(req.body);
        const promptText = buildSystemPrompt(builder);
        if (!promptText) {
            redirectWithMsg(res, '/admin/prompt', 'Prompt tidak boleh kosong.', 'error');
            return;
        }
        fs.writeFileSync(PROMPT_BUILDER_PATH, `${JSON.stringify(builder, null, 2)}\n`);
        fs.mkdirSync(path.dirname(PROMPT_PATH), { recursive: true });
        fs.writeFileSync(PROMPT_PATH, `${promptText}\n`);
        redirectWithMsg(res, '/admin/prompt', 'Prompt tersimpan.');
    });

    app.post('/admin/prompt/assist', async (req, res) => {
        try {
            const builder = promptBuilderFromBody(req.body);
            const improved = await improvePromptBuilderWithAi(builder);
            res.json({ builder: improved });
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : 'AI assist gagal.' });
        }
    });

    app.get('/admin/settings', async (req, res) => {
        const envValues = readEnvValues();
        const aiHealth = await checkAiHealth();
        const backupRuns = await listBackupRuns(pool, 5);
        res.send(page('Settings', `
${pageHeader('Koneksi Sistem', 'Hubungkan layanan yang digunakan bot.', 'ST-04')}
<form method="post" action="/admin/settings/env" data-unsaved>
  <div class="settings-stack">
    <section class="settings-zone">
      <div class="settings-zone-head settings-zone-head-primary"><h2>Hubungkan AI</h2></div>
      <div class="env-grid env-grid-single">
        ${renderAiEnvGroup(envValues)}
      </div>
    </section>
    <details class="config-section" data-persist-collapse="settings-advanced-services">
      <summary><span>Pengaturan koneksi lanjutan<span class="config-section-copy">Database, ongkir, referensi web, dan notifikasi admin.</span></span></summary>
      <div class="config-section-body"><div class="env-grid">
        <div class="env-column">${['Ongkir', 'Handoff'].map((title) => ENV_GROUPS.find((group) => group.title === title)).filter((group): group is typeof ENV_GROUPS[number] => Boolean(group)).map((group) => renderEnvGroup(group, envValues)).join('')}</div>
        <div class="env-column">${['Lookup eksternal', 'Database'].map((title) => ENV_GROUPS.find((group) => group.title === title)).filter((group): group is typeof ENV_GROUPS[number] => Boolean(group)).map((group) => renderEnvGroup(group, envValues)).join('')}</div>
      </div></div>
    </details>
  </div>
  <div class="sticky-actions"><span class="save-state">Tersimpan</span><button>Simpan Settings</button></div>
</form>
<div class="maintenance-layout">
  <section class="maintenance-block"><div class="maintenance-heading"><span class="maintenance-index">02</span><div><h2>Backup & pemulihan</h2><p class="muted">Pindahkan konfigurasi dan katalog tanpa membawa credential atau data pelanggan.</p></div></div>
    <div class="backup-grid"><article class="backup-card"><h3>Unduh backup terbaru</h3><p>Simpan Profil & Alur, Gaya Balasan, dan seluruh file Katalog & Informasi.</p><a class="button-link" href="/admin/backup/export">Unduh file backup</a></article><article class="backup-card"><h3>Periksa sebelum memulihkan</h3><p>Pilih file JSON. Isi backup ditampilkan untuk ditinjau sebelum diterapkan.</p><form class="backup-restore-form" method="post" action="/admin/backup/preview" enctype="multipart/form-data"><label class="sr-only" for="backupFile">Pilih file backup JSON</label><div class="file-picker" data-file-picker data-has-file="false"><span class="file-picker-action" aria-hidden="true">Pilih file JSON</span><span class="file-picker-name" id="backupFileName" data-file-name>Belum ada file dipilih</span><input id="backupFile" type="file" name="backup" accept="application/json,.json" aria-describedby="backupFileName" required></div><button type="submit" class="secondary-button">Periksa file backup</button></form></article></div>
    <div class="safe-note"><strong>Aman:</strong><span>API key, sesi WhatsApp, dan database pelanggan tidak disertakan dalam file backup.</span></div>
    <div class="health-list">${backupRuns.length ? backupRuns.map((run) => `<div class="health-item"><strong>Database ${escapeHtml(run.trigger_type)}</strong><span>${escapeHtml(run.completed_at || run.started_at)} · ${run.size_bytes ? `${Math.ceil(Number(run.size_bytes) / 1024)} KB` : escapeHtml(run.error_message || 'berjalan')}</span>${badge(run.status, run.status === 'succeeded' ? 'ok' : run.status === 'failed' ? 'danger' : 'warn')}</div>`).join('') : '<div class="health-item"><strong>Backup database</strong><span>Belum ada proses backup tercatat.</span></div>'}</div>
  </section>
</div>
<section class="section-head"><div><h2>Status layanan</h2><p class="muted">Ringkasan cepat koneksi internal.</p></div><a class="ghost-btn" href="/health" target="_blank" rel="noreferrer">Buka health JSON</a></section>
<div class="health-list"><div class="health-item"><strong>Database</strong><span>${escapeHtml(process.env.DB_DRIVER || 'sqlite')}</span>${badge('Aktif', 'ok')}</div><div class="health-item"><strong>WhatsApp</strong><span>${escapeHtml(waLabel(getWaStatus().state))}</span>${badge(getWaStatus().state === 'open' ? 'Siap' : 'Periksa', getWaStatus().state === 'open' ? 'ok' : 'warn')}</div><div class="health-item"><strong>AI</strong><span>${escapeHtml(aiHealth.detail)} · ${fmtTime(aiHealth.checkedAt)}</span>${badge(aiHealth.label, aiHealthTone(aiHealth))}</div></div>
`, 'settings', { toastHtml: toastFromQuery(req.query as Record<string, unknown>) }));
    });

    app.post('/admin/settings/env', (req, res) => {
        const updates: Record<string, string> = {};
        for (const group of ENV_GROUPS) {
            for (const field of group.fields) {
                updates[field.key] = field.key === 'ADMIN_WA_JID'
                    ? normalizeAdminJid(req.body[field.key])
                    : String(req.body[field.key] || '').trim();
            }
        }
        writeEnvValues(updates);
        Object.assign(process.env, updates);
        invalidateAiHealth();
        redirectWithMsg(res, '/admin/settings', 'Koneksi sistem berhasil disimpan.');
    });

    app.post('/admin/pipeline/:direction/:id/retry', async (req, res) => {
        const id = Number(req.params.id);
        const ok = Number.isInteger(id) && id > 0 && (req.params.direction === 'inbound'
            ? await messageStore.retryInboundFailure(id)
            : req.params.direction === 'outbound' && await messageStore.retryOutboundFailure(id, process.env.ADMIN_WA_JID));
        redirectWithMsg(res, '/admin/handoff#pipeline-failures', ok ? 'Pesan dijadwalkan untuk retry.' : 'Pesan gagal tidak ditemukan.', ok ? 'ok' : 'error');
    });

    app.post('/admin/settings/test', async (req, res) => {
        const rawKind = req.body.connectionKind || req.body.kind;
        const kind = String(Array.isArray(rawKind) ? rawKind.at(-1) : rawKind || '');
        
        // Save submitted form values so they don't get reset on redirect
        const updates: Record<string, string> = {};
        for (const group of ENV_GROUPS) {
            for (const field of group.fields) {
                if (req.body[field.key] !== undefined) {
                    updates[field.key] = field.key === 'ADMIN_WA_JID'
                        ? normalizeAdminJid(req.body[field.key])
                        : String(req.body[field.key] || '').trim();
                }
            }
        }
        if (Object.keys(updates).length > 0) {
            writeEnvValues(updates);
            Object.assign(process.env, updates);
        }
        invalidateAiHealth();

        try {
            if (kind === 'ai') {
                const health = await checkAiHealth(true);
                redirectWithMsg(res, '/admin/settings', `${health.label}: ${health.detail}`, aiHealthReady(health) ? 'ok' : 'error');
                return;
            }
            if (kind === 'shipping') {
                const ready = Boolean(process.env.RAJAONGKIR_API_KEY?.trim());
                redirectWithMsg(res, '/admin/settings', ready ? 'API key ongkir tersedia. Uji tarif dilakukan ketika pelanggan memberi tujuan.' : 'API key ongkir belum diisi.', ready ? 'ok' : 'error');
                return;
            }
            if (kind === 'lookup') {
                const ready = Boolean(process.env.TAVILY_API_KEY?.trim());
                redirectWithMsg(res, '/admin/settings', ready ? 'API key Tavily tersedia dan lookup siap digunakan.' : 'API key Tavily belum diisi.', ready ? 'ok' : 'error');
                return;
            }
            redirectWithMsg(res, '/admin/settings', 'Jenis tes koneksi tidak dikenali.', 'error');
        } catch (error) {
            redirectWithMsg(res, '/admin/settings', `Tes koneksi gagal: ${error instanceof Error ? error.message : 'kesalahan tidak diketahui'}`, 'error');
        }
    });

    app.get('/admin/whatsapp', async (req, res) => {
        const waConfig = globalWhatsAppManager.getConfig();
        const sessions = globalWhatsAppManager.getSessions();
        const mainWaStatus = getWaStatus();

        const formattedRotationLabel = waConfig.rotationMode === 'round_robin'
            ? 'Round Robin'
            : waConfig.rotationMode === 'least_busy'
            ? 'Least Busy'
            : 'Random';

        const shortWaStatus = mainWaStatus.state === 'open'
            ? 'Terhubung'
            : mainWaStatus.state === 'connecting'
            ? 'Connecting'
            : 'Scan QR';

        const content = `
${pageHeader('Manajemen WhatsApp', 'Kelola nomor terhubung, rotasi CS, jeda anti-ban, dan antrean AI terpusat.', 'WA-01')}
<div class="grid" aria-label="Status WhatsApp Engine">
  <div class="stat"><span class="stat-icon">${icon('chat')}</span><span class="stat-copy"><span>Total Nomor Terhubung</span><strong style="font-size: 20px;">${sessions.length} Nomor</strong></span></div>
  <div class="stat"><span class="stat-icon">${icon('check')}</span><span class="stat-copy"><span>Status Sesi Utama</span><strong style="font-size: 20px;">${escapeHtml(shortWaStatus)}</strong></span></div>
  <div class="stat"><span class="stat-icon">${icon('users')}</span><span class="stat-copy"><span>Mode Rotasi Lead</span><strong style="font-size: 20px;">${formattedRotationLabel}</strong></span></div>
  <div class="stat"><span class="stat-icon">${icon('alert')}</span><span class="stat-copy"><span>Jeda Anti-Ban</span><strong style="font-size: 20px;">${waConfig.minDelaySeconds}s – ${waConfig.maxDelaySeconds}s</strong></span></div>
</div>

<dialog id="waQrModal">
  <div class="wa-qr-modal-body" style="padding:28px; background:var(--panel); border-radius:28px; border:1px solid var(--line);">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; border-bottom:1px solid var(--line); padding-bottom:14px;">
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="font-size:22px;">📱</span>
        <div>
          <h2 style="margin:0; font-size:18px; font-weight:700;">Hubungkan WhatsApp</h2>
          <p class="muted" style="margin:2px 0 0; font-size:12px;">Scan QR Code untuk registrasi nomor CS baru</p>
        </div>
      </div>
      <button type="button" id="closeWaModalX" style="border:none; outline:none; background:var(--soft); color:var(--muted); border-radius:50%; width:34px; height:34px; font-size:16px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; transition:background-color .15s ease,color .15s ease,transform .15s ease;">✕</button>
    </div>

    <div style="text-align:center; background:var(--soft); padding:20px; border-radius:18px; border:1px solid var(--line); margin-bottom:20px;">
      <div id="liveQrContainer" style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:230px;">
        <div id="liveQrStatus" style="font-size:13px; font-weight:600; color:var(--ink); margin-bottom:12px;">
          🔄 Menyiapkan QR Code WhatsApp...
        </div>
        <img id="liveQrImage" src="" alt="WhatsApp QR Code" style="width:220px; height:220px; border-radius:14px; border:1px solid var(--line); display:none; background:#fff; padding:8px; box-shadow:0 8px 24px rgba(0,0,0,0.06);" />
        <div id="scanConnectedBadge" style="display:none; padding:16px; font-weight:700; color:var(--ok); font-size:16px;">
          🎉 WhatsApp Berhasil Terhubung!
          <p style="font-size:12px; color:var(--muted); font-weight:normal; margin-top:4px;">Sesi WhatsApp aktif & siap digunakan dalam rotasi CS.</p>
        </div>
      </div>
    </div>

    <form method="post" action="/admin/whatsapp/numbers/add" style="display:flex; flex-direction:column; gap:14px;">
      <div class="field">
        <label for="modalCsId" style="font-size:12px; font-weight:600;">Label internal nomor</label>
        <input id="modalCsId" type="text" name="id" placeholder="contoh: CS Line 3 - Fast Response" required style="height:40px; border-radius:10px;">
        <small class="muted">Hanya terlihat oleh admin.</small>
      </div>
      <div class="field">
        <label for="modalCsName" style="font-size:12px; font-weight:600;">Nama CS ke customer <span class="muted">(opsional)</span></label>
        <input id="modalCsName" type="text" name="csNameOverride" maxlength="60" placeholder="Kosong = gunakan ${escapeHtml(getBusinessConfig().csName)}" style="height:40px; border-radius:10px;">
        <small class="muted">Isi hanya jika nomor ini memakai persona berbeda.</small>
      </div>
      <div class="field">
        <label for="modalCsPhone" style="font-size:12px; font-weight:600;">Nomor WhatsApp terdeteksi</label>
        <input id="modalCsPhone" type="text" name="phone" placeholder="Scan QR untuk mendeteksi nomor" required readonly inputmode="numeric" style="height:40px; border-radius:10px;">
        <small class="muted">Nomor diisi otomatis dari akun WhatsApp yang memindai QR.</small>
      </div>
      <div class="field">
        <label for="modalCsDailyLimit" style="font-size:12px; font-weight:600;">Kuota Lead Harian (Maksimal)</label>
        <input id="modalCsDailyLimit" type="number" name="dailyLimit" value="300" min="10" max="5000" required style="height:40px; border-radius:10px;">
      </div>

      <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:14px; padding-top:14px; border-top:1px solid var(--line);">
        <button type="button" class="ghost-btn" id="closeWaModalCancel" style="height:38px; padding:0 18px; border-radius:10px;">Batal</button>
        <button type="submit" class="primary-button" style="height:38px; padding:0 22px; border-radius:10px;">Simpan & Aktifkan CS</button>
      </div>
    </form>
  </div>
</dialog>

<div class="ops-grid" style="margin-top: 24px;">
  <section class="panel">
    <div class="panel-head" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
      <div><h2>Daftar Nomor WhatsApp Active</h2><p class="muted">Status dan kuota pembalasan per nomor untuk rotasi anti-ban.</p></div>
      <button type="button" class="primary-button" id="openWaModalBtn" style="height:34px; padding:0 16px; font-size:12px; border-radius:10px;">+ Tambah Nomor</button>
    </div>

    <div class="health-list">
      ${sessions.length === 0 ? `
        <div class="empty-state" style="padding: 40px 20px; text-align: center;">
          <div style="width: 48px; height: 48px; border-radius: 50%; background: var(--primary-weak); color: var(--primary); display: grid; place-items: center; margin: 0 auto 16px;">
            ${icon('check')}
          </div>
          <strong style="display: block; font-size: 16px; margin-bottom: 6px;">Belum Ada Nomor WhatsApp</strong>
          <p class="muted" style="margin: 0 0 20px; font-size: 13px;">Belum ada nomor WA didaftarkan. Klik tombol + Tambah Nomor untuk memindai QR & mendaftarkan nomor.</p>
          <button type="button" class="primary-button" id="openWaModalBtnBottom" style="height:36px; padding:0 20px; border-radius:10px;">Tambah Nomor Baru</button>
        </div>
      ` : sessions.map((s) => {
        const runtime = getWaSessionStatus(s.phone);
        const runtimeOnline = runtime.state === 'open';
        return `
        <div class="health-item" style="padding: 14px 16px; flex-direction: column; align-items: stretch; gap: 8px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
            <div>
              <strong style="font-size:14px;">${escapeHtml(s.id)}</strong>
              <div style="display:flex; gap:8px; align-items:center; margin-top:4px;">
                <span class="mono" style="font-size:12px; color:var(--ink); font-weight:600;">+${escapeHtml(s.phone)}</span>
                ${badge(runtimeOnline ? 'Online' : waRuntimeLabel(runtime), runtimeOnline ? 'ok' : runtime.state === 'close' || runtime.state === 'logged_out' || runtime.state === 'error' ? 'danger' : 'warn')}
              </div>
              <div class="muted" style="font-size:11px; margin-top:4px;">Lead Hari Ini: ${s.todayLeadCount} / ${s.dailyLimit || '∞'} · Pesan Dikirim: ${s.todayMessageCount}</div>
              <div class="muted" style="font-size:11px; margin-top:3px;">Nama ke customer: <strong>${escapeHtml(s.csNameOverride?.trim() || getBusinessConfig().csName)}</strong>${s.csNameOverride?.trim() ? '' : ' (default)'}</div>
            </div>
            <div style="display:flex; gap:6px; align-items:center; margin-top:2px;">
              <button type="button" class="ghost-btn edit-session-btn" data-phone="${escapeHtml(s.phone)}" style="padding:4px 8px; font-size:11px; height:28px;">Edit</button>
              ${runtimeOnline ? '' : `<button type="button" class="ghost-btn connect-session-btn" data-phone="${escapeHtml(s.phone)}" style="padding:4px 8px; font-size:11px; height:28px;">Hubungkan</button>`}
              <form method="post" action="/admin/auth/clear" style="margin:0;" data-confirm="Reset sesi WhatsApp +${escapeHtml(s.phone)}?">
                <input type="hidden" name="phone" value="${escapeHtml(s.phone)}">
                <input type="hidden" name="redirectUrl" value="/admin/whatsapp">
                <button type="submit" class="ghost-btn" style="padding:4px 8px; font-size:11px; height:28px;">Reset Sesi</button>
              </form>
              <form method="post" action="/admin/whatsapp/numbers/delete" style="margin:0;" data-confirm="Hapus nomor +${escapeHtml(s.phone)} dari daftar rotasi?">
                <input type="hidden" name="phone" value="${escapeHtml(s.phone)}">
                <button type="submit" class="ghost-btn" style="color:var(--danger); padding:4px 8px; font-size:11px; height:28px;">Hapus</button>
              </form>
            </div>
          </div>
          <form id="edit-form-${escapeHtml(s.phone)}" method="post" action="/admin/whatsapp/numbers/update" style="display:none; padding:16px; background:var(--soft); border-radius:14px; margin-top:12px;">
            <input type="hidden" name="phone" value="${escapeHtml(s.phone)}">
            <div style="display:flex; flex-direction:column; gap:12px;">
              <div class="field" style="margin:0;">
                <label style="font-size:12px; font-weight:600; margin-bottom:6px; display:block;">Label internal nomor</label>
                <input type="text" name="id" value="${escapeHtml(s.id)}" required style="height:40px; font-size:13px; border-radius:10px; border:1px solid var(--line); width:100%; padding:0 12px; background:var(--panel); outline:none;">
              </div>
              <div class="field" style="margin:0;">
                <label style="font-size:12px; font-weight:600; margin-bottom:6px; display:block;">Nama CS ke customer <span class="muted">(opsional)</span></label>
                <input type="text" name="csNameOverride" maxlength="60" value="${escapeHtml(s.csNameOverride || '')}" placeholder="Kosong = gunakan ${escapeHtml(getBusinessConfig().csName)}" style="height:40px; font-size:13px; border-radius:10px; border:1px solid var(--line); width:100%; padding:0 12px; background:var(--panel); outline:none;">
              </div>
              <div class="field" style="margin:0;">
                <label style="font-size:12px; font-weight:600; margin-bottom:6px; display:block;">Kuota Lead Harian (Maksimal)</label>
                <input type="number" name="dailyLimit" value="${s.dailyLimit || 300}" min="10" max="5000" required style="height:40px; font-size:13px; border-radius:10px; border:1px solid var(--line); width:100%; padding:0 12px; background:var(--panel); outline:none;">
              </div>
              <div style="display:flex; justify-content:flex-end; margin-top:4px;">
                <button type="submit" class="primary-button" style="height:36px; padding:0 20px; font-size:13px; border-radius:10px;">Simpan Perubahan</button>
              </div>
            </div>
          </form>
        </div>`;
      }).join('')}
    </div>
  </section>

  <form class="panel" method="post" action="/admin/whatsapp/config">
    <div class="panel-head">
      <div><h2>Pengaturan Rotasi & Anti-Ban Scaling</h2><p class="muted">Konfigurasi alokasi lead, batas kuota, dan jeda waktu acak balasan.</p></div>
    </div>
    <div style="padding: 16px 20px; display: flex; flex-direction: column; gap: 16px;">
      <div class="field">
        <label for="rotationMode">Mode Rotasi Lead Baru</label>
        <select id="rotationMode" name="rotationMode">
          <option value="round_robin" ${waConfig.rotationMode === 'round_robin' ? 'selected' : ''}>Round Robin (Bergiliran Seimbang)</option>
          <option value="least_busy" ${waConfig.rotationMode === 'least_busy' ? 'selected' : ''}>Least Busy (Utamakan Nomor Paling Sedikit Chat)</option>
          <option value="random" ${waConfig.rotationMode === 'random' ? 'selected' : ''}>Acak (Random Weighted)</option>
        </select>
        <p class="muted">Metode pembagian lead baru ke nomor-nomor WA yang aktif.</p>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="field">
          <label for="minDelaySeconds">Min Jeda (Detik)</label>
          <input id="minDelaySeconds" type="number" name="minDelaySeconds" value="${waConfig.minDelaySeconds}" min="0" max="300" required>
          <p class="muted">Jeda minimal sebelum AI membalas.</p>
        </div>
        <div class="field">
          <label for="maxDelaySeconds">Max Jeda (Detik)</label>
          <input id="maxDelaySeconds" type="number" name="maxDelaySeconds" value="${waConfig.maxDelaySeconds}" min="1" max="600" required>
          <p class="muted">Jeda maksimal pola balasan.</p>
        </div>
      </div>

      <div class="field">
        <label for="maxConcurrency">Batasan AI Paralel (Antrean AI)</label>
        <input id="maxConcurrency" type="number" name="maxConcurrency" value="${globalAiQueueLimiter.getMaxConcurrency()}" min="1" max="10" required>
        <p class="muted">Membatasi jumlah balasan AI yang diproses bersamaan.</p>
      </div>

      <div class="field">
        <label>Sticky Session Pelanggan</label>
        <div class="switchbox">
          <label class="switchline">
            <input type="checkbox" name="enableStickyAssignment" value="true" ${waConfig.enableStickyAssignment ? 'checked' : ''}>
            <span class="switch-track" aria-hidden="true"></span>
            <span class="switch-label">Aktifkan Sticky Lead Assignment</span>
          </label>
        </div>
        <p class="muted">Pelanggan lama tetap dilayani oleh nomor awal yang sama.</p>
      </div>
    </div>

    <div class="sticky-actions">
      <span class="save-state">Tersimpan</span>
      <button type="submit">Simpan Pengaturan</button>
    </div>
  </form>
</div>

<script>
  (() => {
    const modal = document.getElementById('waQrModal');
    const openBtn = document.getElementById('openWaModalBtn');
    const openBtnBottom = document.getElementById('openWaModalBtnBottom');
    const closeBtnX = document.getElementById('closeWaModalX');
    const closeBtnCancel = document.getElementById('closeWaModalCancel');

    let pollInterval = null;
    let selectedPhone = new URLSearchParams(location.search).get('connect') || '';
    const fetchWaStatus = async () => {
      if (!selectedPhone) {
        const statusTxt = document.getElementById('liveQrStatus');
        const qrImg = document.getElementById('liveQrImage');
        const connBadge = document.getElementById('scanConnectedBadge');
        if (qrImg) qrImg.style.display = 'none';
        if (connBadge) connBadge.style.display = 'none';
        if (statusTxt) {
          statusTxt.style.display = 'block';
          statusTxt.textContent = 'Isi nomor baru lalu klik Simpan & Aktifkan CS untuk membuat QR.';
        }
        return;
      }
      try {
        const res = await fetch('/admin/whatsapp/status' + (selectedPhone ? '?phone=' + encodeURIComponent(selectedPhone) : ''));
        if (!res.ok) return;
        const data = await res.json();
        const qrImg = document.getElementById('liveQrImage');
        const statusTxt = document.getElementById('liveQrStatus');
        const connBadge = document.getElementById('scanConnectedBadge');

        if (data.state === 'open' && (selectedPhone === 'pending' || !selectedPhone || String(data.phone || '') === selectedPhone)) {
          if (qrImg) qrImg.style.display = 'none';
          if (statusTxt) statusTxt.style.display = 'none';
          if (connBadge) connBadge.style.display = 'block';
          if (data.phone) {
            const phoneInput = document.getElementById('modalCsPhone');
            if (phoneInput) {
              phoneInput.value = data.phone;
            }
          }
        } else if (data.qrUrl || data.qr) {
          if (connBadge) connBadge.style.display = 'none';
          if (statusTxt) {
            statusTxt.style.display = 'block';
            statusTxt.textContent = '📸 Buka WA di HP > Perangkat Tertaut > Scan QR Code ini:';
          }
          if (qrImg) {
            qrImg.src = data.qrUrl || ('https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(data.qr));
            qrImg.style.display = 'block';
          }
        } else if (data.state === 'error' || data.state === 'close' || data.state === 'logged_out') {
          if (connBadge) connBadge.style.display = 'none';
          if (qrImg) qrImg.style.display = 'none';
          if (statusTxt) {
            statusTxt.style.display = 'block';
            statusTxt.textContent = data.detail || 'Gagal menyiapkan sesi. Tutup lalu coba hubungkan lagi.';
          }
        } else {
          if (connBadge) connBadge.style.display = 'none';
          if (qrImg) qrImg.style.display = 'none';
          if (statusTxt) {
            statusTxt.style.display = 'block';
            statusTxt.textContent = '🔄 Menyiapkan QR Code WhatsApp...';
          }
        }
      } catch {}
    };

    const startPolling = () => {
      fetchWaStatus();
      if (!pollInterval) pollInterval = setInterval(fetchWaStatus, 2000);
    };

    const openModal = async (phone = 'pending') => {
      selectedPhone = phone;
      if (modal) {
        if (typeof modal.showModal === 'function') {
          modal.showModal();
        } else {
          modal.setAttribute('open', '');
        }
        try { await fetch('/admin/whatsapp/qr/generate', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({phone:selectedPhone === 'pending' ? '' : selectedPhone}) }); } catch {}
        startPolling();
      }
    };

    if (openBtn) openBtn.addEventListener('click', () => openModal('pending'));
    if (openBtnBottom) openBtnBottom.addEventListener('click', () => openModal('pending'));
    document.querySelectorAll('.connect-session-btn').forEach(btn => btn.addEventListener('click', () => openModal(btn.getAttribute('data-phone') || '')));
    if (selectedPhone) openModal(selectedPhone);

    const closeModal = () => {
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = null;
      if (modal) {
        if (typeof modal.close === 'function') modal.close();
        else modal.removeAttribute('open');
      }
    };

    if (closeBtnX) closeBtnX.addEventListener('click', closeModal);
    if (closeBtnCancel) closeBtnCancel.addEventListener('click', closeModal);

    document.querySelectorAll('.edit-session-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const phone = e.currentTarget.getAttribute('data-phone');
        const form = document.getElementById('edit-form-' + phone);
        if (form) {
          form.style.display = form.style.display === 'none' ? 'block' : 'none';
        }
      });
    });
  })();
</script>
`;
        res.send(page('Manajemen WhatsApp', content, 'whatsapp', { toastHtml: toastFromQuery(req.query as Record<string, unknown>) }));
    });

    app.get('/admin/whatsapp/status', async (_req, res) => {
        const rawPhone = String(_req.query.phone || '');
        const phone = rawPhone === 'pending' ? 'pending' : rawPhone.replace(/[^0-9]/g, '');
        if (!phone) {
            res.json({ state: 'unknown', detail: 'Buka modal Tambah Nomor untuk membuat QR.', qr: null, qrUrl: null, phone: null, sessions: globalWhatsAppManager.getSessions() });
            return;
        }
        let wa = getWaSessionStatus(phone);
        if (phone === 'pending' && (isWaSessionStaleConnecting(wa) || (!wa.qr && wa.state !== 'open' && wa.state !== 'connecting'))) {
            startWhatsAppConnection(phone).catch(() => {});
            wa = getWaSessionStatus(phone);
        }
        let qrUrl = wa.qrUrl || null;
        if (wa.qr && (!qrUrl || !qrUrl.startsWith('data:image/'))) {
            try {
                qrUrl = await QRCode.toDataURL(wa.qr, { margin: 1, width: 260 });
            } catch {}
        }
        const sessions = globalWhatsAppManager.getSessions();
        res.json({
            state: wa.state,
            detail: wa.detail,
            qr: wa.qr || null,
            qrUrl: qrUrl || (wa.qr ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(wa.qr)}` : null),
            phone: wa.phone || null,
            sessions,
        });
    });

    app.get('/admin/api/whatsapp', async (_req, res) => {
        const config = globalWhatsAppManager.getConfig();
        res.json({ config, sessions: globalWhatsAppManager.getSessions(), mainStatus: getWaStatus() });
    });

    app.get('/admin/api/config', (_req, res) => res.json({ config: getBusinessConfig(), raw: fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, 'utf8') : '{}' }));
    app.get('/admin/api/prompt', (_req, res) => { const builder = readPromptBuilder(); res.json({ builder, presets: PROMPT_PRESETS, generated: buildSystemPrompt(builder), config: buildPromptConfigData() }); });
    app.get('/admin/api/settings', async (_req, res) => res.json({ env: readEnvValues(), aiHealth: await checkAiHealth(), backups: await listBackupRuns(pool, 5) }));

    app.post('/admin/whatsapp/qr/generate', async (_req, res) => {
        const phone = String(_req.body.phone || '').replace(/[^0-9]/g, '');
        if (!phone) {
            try { await startWhatsAppConnection('pending'); } catch {}
            const wa = getWaSessionStatus('pending');
            res.json({ ok: true, qrUrl: wa.qrUrl || null });
            return;
        }
        if (!globalWhatsAppManager.getSession(phone)) return res.status(400).json({ ok: false, error: 'Nomor belum terdaftar.' });
        try {
            await startWhatsAppConnection(phone);
        } catch {}
        let wa = getWaSessionStatus(phone);
        let qrUrl = wa.qrUrl || null;
        if (wa.qr && (!qrUrl || !qrUrl.startsWith('data:image/'))) {
            try {
                qrUrl = await QRCode.toDataURL(wa.qr, { margin: 1, width: 260 });
            } catch {}
        }
        res.json({
            ok: true,
            qrUrl: qrUrl || (wa.qr ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(wa.qr)}` : null),
        });
    });

    app.post('/admin/whatsapp/numbers/add', async (req, res) => {
        const id = String(req.body.id || '').trim();
        const csNameOverride = String(req.body.csNameOverride || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        const pendingStatus = getWaSessionStatus('pending');
        const phone = String(pendingStatus.state === 'open' ? pendingStatus.phone || '' : '').replace(/[^0-9]/g, '').trim();
        const dailyLimit = Math.max(10, parseInt(req.body.dailyLimit || '300', 10));

        if (!id || !phone) {
            redirectWithMsg(res, '/admin/whatsapp', 'Scan QR sampai nomor WhatsApp terdeteksi, lalu isi nama CS.', 'error');
            return;
        }

        if (globalWhatsAppManager.getSession(phone)) {
            redirectWithMsg(res, '/admin/whatsapp', `Nomor WhatsApp +${phone} sudah terdaftar.`, 'error');
            return;
        }
        globalWhatsAppManager.registerSession({
            id,
            ...(csNameOverride ? { csNameOverride } : {}),
            phone,
            status: 'connecting',
            dailyLimit,
            todayLeadCount: 0,
            todayMessageCount: 0,
        });
        const adopted = adoptPendingWhatsAppSession(phone);
        setWaSessionStatus(phone, adopted && pendingStatus.state === 'open'
            ? { ...pendingStatus, state: 'open', phone }
            : { state: 'connecting', detail: 'Menyiapkan sesi nomor ini', phone: undefined, qr: undefined, qrUrl: undefined });
        redirectWithMsg(res, `/admin/whatsapp?connect=${encodeURIComponent(phone)}`, `Nomor WhatsApp ${id} berhasil disimpan.`, 'ok');
    });

    app.post('/admin/whatsapp/numbers/update', async (req, res) => {
        const phone = String(req.body.phone || '').trim();
        const id = String(req.body.id || '').trim();
        const csNameOverride = String(req.body.csNameOverride || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        const dailyLimit = Math.max(10, parseInt(req.body.dailyLimit || '300', 10));

        if (!id || !phone) {
            redirectWithMsg(res, '/admin/whatsapp', 'ID dan Nomor WhatsApp wajib diisi untuk diupdate.', 'error');
            return;
        }

        const session = globalWhatsAppManager.getSession(phone);
        if (!session) {
            redirectWithMsg(res, '/admin/whatsapp', 'Nomor WhatsApp tidak ditemukan.', 'error');
            return;
        }

        globalWhatsAppManager.updateSession(phone, {
            id,
            csNameOverride: csNameOverride || undefined,
            dailyLimit,
        });

        redirectWithMsg(res, '/admin/whatsapp', `Sesi +${phone} berhasil diupdate.`, 'ok');
    });

    app.post('/admin/whatsapp/numbers/delete', async (req, res) => {
        const phone = String(req.body.phone || '').replace(/[^0-9]/g, '').trim();
        if (!phone) return redirectWithMsg(res, '/admin/whatsapp', 'Nomor WhatsApp tidak valid.', 'error');
        await stopWhatsAppSession(phone, true);
        const deleted = globalWhatsAppManager.removeSession(phone);
        redirectWithMsg(
            res,
            '/admin/whatsapp',
            deleted ? `Nomor WhatsApp +${phone} berhasil dihapus.` : `Nomor WhatsApp +${phone} tidak ditemukan atau gagal disimpan.`,
            deleted ? 'ok' : 'error',
        );
    });

    app.post('/admin/whatsapp/config', async (req, res) => {
        const rawRotationMode = String(req.body.rotationMode || 'round_robin');
        if (!(['round_robin', 'least_busy', 'random'] as string[]).includes(rawRotationMode)) {
            redirectWithMsg(res, '/admin/whatsapp', 'Mode rotasi tidak valid.', 'error');
            return;
        }
        const rotationMode = rawRotationMode as RotationMode;
        const minDelaySeconds = Math.max(0, parseInt(req.body.minDelaySeconds || '3', 10));
        const maxDelaySeconds = Math.max(minDelaySeconds, parseInt(req.body.maxDelaySeconds || '5', 10));
        const maxConcurrency = Math.max(1, parseInt(req.body.maxConcurrency || '3', 10));
        const enableStickyAssignment = req.body.enableStickyAssignment === 'true';

        globalWhatsAppManager.updateConfig({
            rotationMode,
            minDelaySeconds,
            maxDelaySeconds,
            maxConcurrency,
            enableStickyAssignment,
        });

        globalAiQueueLimiter.setMaxConcurrency(maxConcurrency);

        redirectWithMsg(res, '/admin/whatsapp', 'Pengaturan WhatsApp & Anti-Ban berhasil disimpan.', 'ok');
    });

    app.get('/admin/sandbox', async (_req, res) => {
        const aiHealth = await checkAiHealth();
        res.send(page('Simulasi Percakapan', sandboxHtml({ aiHealth }), 'sandbox'));
    });

    app.post('/admin/sandbox', async (req, res) => {
        const message = String(req.body.message || '').trim();
        if (!message) {
            redirectWithMsg(res, '/admin/sandbox', 'Masukkan pesan contoh terlebih dahulu.', 'error');
            return;
        }
        try {
            const aiHealth = await checkAiHealth();
            if (!aiHealthReady(aiHealth)) {
                res.status(503).send(page('Simulasi Percakapan', sandboxHtml({ message, error: `${aiHealth.label}: ${aiHealth.detail}`, aiHealth }), 'sandbox'));
                return;
            }
            const result = await previewAgentReply(message, getKnowledgeBase());
            res.send(page('Simulasi Percakapan', sandboxHtml({ message, reply: result.text, usedTools: result.usedTools, aiHealth }), 'sandbox'));
        } catch (error) {
            const detail = error instanceof Error ? error.message : 'Kesalahan tidak diketahui.';
            const friendly = /connection|connect|fetch failed|econnrefused/i.test(detail)
                ? `Layanan AI tidak dapat dihubungi di ${process.env.AI_API_BASE_URL || 'alamat yang dikonfigurasi'}. Jalankan layanan AI atau perbarui koneksinya di Koneksi Sistem.`
                : `Simulasi gagal: ${detail}`;
            invalidateAiHealth();
            const aiHealth = await checkAiHealth(true);
            res.status(503).send(page('Simulasi Percakapan', sandboxHtml({ message, error: friendly, aiHealth }), 'sandbox'));
        }
    });

    app.post('/admin/sandbox/reply', async (req, res) => {
        const message = String(req.body.message || '').trim();
        if (!message) {
            res.status(400).json({ error: 'Pesan tidak boleh kosong.' });
            return;
        }
        try {
            const history = Array.isArray(req.body.history)
                ? req.body.history
                    .filter((entry: any) => ['user', 'assistant'].includes(entry?.role) && typeof entry?.content === 'string')
                    .slice(-20)
                    .map((entry: any) => ({ role: entry.role as 'user' | 'assistant', content: String(entry.content).slice(0, 4000) }))
                : [];
            const aiHealth = await checkAiHealth();
            if (!aiHealthReady(aiHealth)) {
                res.status(503).json({ error: `${aiHealth.label}: ${aiHealth.detail}` });
                return;
            }
            const result = await previewAgentReply(message, getKnowledgeBase(), history);
            const reply = sanitizeCustomerLanguage(stripInternalMarkup(result.text));
            const safeReply = reply || 'Maaf Kak, balasan belum dapat diproses dengan aman.';
            const bubbles = result.plan.bubbles
                .map((bubble) => sanitizeCustomerLanguage(stripInternalMarkup(bubble)))
                .filter(Boolean)
                .slice(0, 3);
            res.json({ reply: safeReply, bubbles: bubbles.length ? bubbles : [safeReply], usedTools: [...new Set(result.usedTools)], citations: result.citations || [] });
        } catch (error) {
            invalidateAiHealth();
            const detail = error instanceof Error ? error.message : 'Kesalahan tidak diketahui.';
            res.status(503).json({ error: /connection|connect|fetch failed|econnrefused/i.test(detail)
                ? 'Layanan AI tidak dapat dihubungi. Periksa Koneksi Sistem.'
                : `Simulasi gagal: ${detail}` });
        }
    });

    app.get('/admin/knowledge', async (req, res) => {
        fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
        const files = fs.readdirSync(KNOWLEDGE_DIR).map((name) => {
            const stat = fs.statSync(path.join(KNOWLEDGE_DIR, name));
            return { name, size: stat.size, updated: stat.mtime.toISOString() };
        });
        const jobs = await knowledgeStore.listJobs(20);
        res.send(page('Knowledge', `
${pageHeader('Katalog & Informasi', 'Kelola sumber jawaban produk, harga, dan FAQ bot.', 'KB-05')}
<section class="knowledge-intro" aria-label="Alur pengelolaan informasi">
  <article class="knowledge-step"><span>01 · Unggah</span><h2>Tambahkan sumber</h2><p>Pilih katalog, daftar harga, FAQ, dokumen, atau gambar yang menjadi acuan bot.</p></article>
  <article class="knowledge-step"><span>02 · Periksa</span><h2>Lihat file tersimpan</h2><p>Pastikan nama, ukuran, dan waktu pembaruan file sudah sesuai.</p></article>
  <article class="knowledge-step"><span>03 · Pantau</span><h2>Cek pemrosesan</h2><p>Versi informasi aktif diperbarui hanya setelah seluruh file berhasil diproses.</p></article>
</section>
<section class="section-head"><div><h2>1. Tambahkan informasi</h2><p class="muted">Unggah satu atau beberapa file untuk memperbarui sumber jawaban bot.</p></div></section>
<form class="upload-card" method="post" action="/admin/knowledge/upload" enctype="multipart/form-data">
  <div class="upload-head"><h2>Unggah informasi bot</h2></div>
  <label class="upload-zone" data-upload-zone>
    <input id="knowledgeFiles" class="upload-input" type="file" name="files" multiple required accept=".txt,.md,.pdf,.docx,.xlsx,.csv,.png,.jpg,.jpeg">
    <span class="upload-copy">
      <strong>Pilih file atau tarik ke sini</strong>
      <span>TXT, MD, PDF, DOCX, XLSX, CSV, atau gambar.</span>
    </span>
  </label>
  <div class="upload-list" data-upload-list aria-live="polite"></div>
  <div class="upload-actions">
    <p class="muted" data-upload-summary>Belum ada file dipilih.</p>
    <button data-upload-submit disabled>Unggah dan terapkan</button>
  </div>
</form>
<section class="section-head with-action"><div><h2>2. File tersimpan</h2><p class="muted">Tinjau sumber yang saat ini tersedia untuk bot.</p></div><form method="post" action="/admin/knowledge/reload"><button class="secondary-button">Muat ulang semua file</button></form></section>
${knowledgeTable(files)}
`, 'knowledge', { toastHtml: toastFromQuery(req.query as Record<string, unknown>) }));
    });

    app.post('/admin/knowledge/upload', upload.array('files', 30), async (req, res) => {
        const count = Array.isArray(req.files) ? req.files.length : 0;
        const job = await knowledgeWorker.enqueue('upload');
        redirectWithMsg(res, '/admin/knowledge', `${count} file diunggah. Proses informasi #${job.id} sedang berjalan.`);
    });

    app.post('/admin/knowledge/reload', async (_req, res) => {
        const job = await knowledgeWorker.enqueue('reload');
        redirectWithMsg(res, '/admin/knowledge', `Reload dijadwalkan sebagai job #${job.id}.`);
    });

    app.post('/admin/knowledge/jobs/:id/retry', async (req, res) => {
        const id = Number(req.params.id);
        const retried = Number.isFinite(id) && await knowledgeStore.retry(id);
        if (retried) knowledgeWorker.wake();
        redirectWithMsg(res, '/admin/knowledge', retried ? `Proses informasi #${id} dijadwalkan ulang.` : 'Proses yang gagal tidak ditemukan.', retried ? 'ok' : 'error');
    });

    app.post('/admin/knowledge/delete', async (req, res) => {
        const name = path.basename(String(req.body.name || '').trim());
        if (!name || name === '.' || name === '..') {
            redirectWithMsg(res, '/admin/knowledge', 'Nama file tidak valid.', 'error');
            return;
        }
        const target = path.join(KNOWLEDGE_DIR, name);
        if (!target.startsWith(KNOWLEDGE_DIR) || !fs.existsSync(target)) {
            redirectWithMsg(res, '/admin/knowledge', 'File tidak ditemukan.', 'error');
            return;
        }
        fs.unlinkSync(target);
        await loadKnowledgeBase();
        redirectWithMsg(res, '/admin/knowledge', `File ${name} dihapus dan informasi bot diperbarui.`);
    });

    app.get('/admin/leads', async (req, res) => {
        const sort = resolveLeadSort(req.query.sort, req.query.direction);
        const search = String(req.query.q || '').trim();

        let querySql = `
            SELECT leads.*, 
                   COALESCE(chat_stats.msg_count, 0) AS msg_count
            FROM leads
            LEFT JOIN (
                SELECT jid, COUNT(*) AS msg_count
                FROM chat_history
                GROUP BY jid
            ) AS chat_stats ON chat_stats.jid = leads.jid
        `;
        const params: any[] = [];
        if (search) {
            params.push(`%${search.toLowerCase()}%`);
            querySql += `
                WHERE LOWER(leads.name) LIKE $1 
                   OR LOWER(leads.phone) LIKE $1 
                   OR LOWER(leads.jid) LIKE $1
                   OR LOWER(leads.preferences) LIKE $1
            `;
        }

        querySql += ` ORDER BY ${sort.orderBy} LIMIT 100`;
        const { rows } = await pool.query(querySql, params);
        res.send(page('Pelanggan & Chat', `${pageHeader('Pelanggan & Chat', 'Lihat data pelanggan dan riwayat percakapan bot.', 'LD-06')}${leadsTable(rows, sort, search)}`, 'leads', { toastHtml: toastFromQuery(req.query as Record<string, unknown>) }));
    });

    app.get('/admin/orders', async (req, res) => {
        const statusFilter = String(req.query.status || 'all').toLowerCase();
        const allowed = new Set(['all', 'draft', 'awaiting_payment', 'paid']);
        const active = allowed.has(statusFilter) ? statusFilter : 'all';
        const [rowsResult, allC, draftC, awaitC, paidC] = await Promise.all([
            active === 'all'
                ? pool.query('SELECT * FROM orders ORDER BY updated_at DESC LIMIT 100')
                : pool.query('SELECT * FROM orders WHERE status = $1 ORDER BY updated_at DESC LIMIT 100', [active]),
            pool.query('SELECT COUNT(*) AS count FROM orders'),
            pool.query("SELECT COUNT(*) AS count FROM orders WHERE status = 'draft'"),
            pool.query("SELECT COUNT(*) AS count FROM orders WHERE status = 'awaiting_payment'"),
            pool.query("SELECT COUNT(*) AS count FROM orders WHERE status = 'paid'"),
        ]);
        const counts = {
            all: Number(allC.rows[0]?.count || 0),
            draft: Number(draftC.rows[0]?.count || 0),
            awaiting_payment: Number(awaitC.rows[0]?.count || 0),
            paid: Number(paidC.rows[0]?.count || 0),
        };

        res.send(page('Pesanan', `
${pageHeader('Pesanan', 'Periksa pesanan dan pembayaran pelanggan.', 'OR-07')}
${orderFilterTabs(active, counts)}
${ordersTable(rowsResult.rows)}`, 'orders', { toastHtml: toastFromQuery(req.query as Record<string, unknown>) }));
    });

    app.get('/admin/orders/:id', async (req, res) => {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            redirectWithMsg(res, '/admin/orders', 'Nomor pesanan tidak valid.', 'error');
            return;
        }
        const order = await getOrderById(id);
        if (!order) {
            redirectWithMsg(res, '/admin/orders', 'Pesanan tidak ditemukan.', 'error');
            return;
        }
        res.send(page(`Pesanan #${id}`, `${pageHeader(`Pesanan #${id}`, 'Detail produk, pelanggan, pengiriman, dan pembayaran.', 'OR-07')}
<div class="row-actions" style="margin-bottom:22px"><a class="ghost-btn" href="/admin/orders">Kembali ke Pesanan</a><a class="ghost-btn" href="/admin/chat?jid=${encodeURIComponent(String(order.jid || ''))}">Lihat percakapan</a>${whatsappNumber(order.jid) ? `<a class="ghost-btn" href="https://wa.me/${whatsappNumber(order.jid)}" target="_blank" rel="noreferrer">Hubungi di WhatsApp</a>` : ''}</div>
${orderDetailHtml(order)}
<div class="row-actions">
${String(order.status) === 'awaiting_payment' ? `<form method="post" action="/admin/orders/paid" data-confirm="Tandai pesanan #${id} sebagai lunas setelah pembayaran diperiksa?"><input type="hidden" name="jid" value="${escapeHtml(order.jid)}"><input type="hidden" name="orderId" value="${id}"><button type="submit">Tandai lunas</button></form>` : ''}
${String(order.status) === 'paid' ? `<form method="post" action="/admin/orders/status"><input type="hidden" name="orderId" value="${id}"><input type="hidden" name="status" value="shipped"><label>Kurir<input name="shippingCarrier" placeholder="Contoh: JNE"></label><label>Nomor resi<input name="trackingNumber" required></label><button type="submit">Tandai dikirim</button></form>` : ''}
${String(order.status) === 'shipped' ? `<form method="post" action="/admin/orders/status"><input type="hidden" name="orderId" value="${id}"><input type="hidden" name="status" value="completed"><button type="submit">Tandai selesai</button></form>` : ''}
</div>`, 'orders'));
    });

    app.post('/admin/orders/paid', async (req, res) => {
        const jid = String(req.body.jid || '').trim();
        const orderId = Number(req.body.orderId);
        const paid = await markOrderPaid(jid, Number.isFinite(orderId) ? orderId : undefined);
        redirectWithMsg(res, '/admin/orders', paid.ok ? `Pesanan #${paid.order.id} ditandai lunas.` : paid.error, paid.ok ? 'ok' : 'error');
    });

    app.post('/admin/orders/status', async (req, res) => {
        const orderId = Number(req.body.orderId);
        const status = String(req.body.status || '') as 'shipped' | 'completed' | 'cancelled';
        if (!Number.isInteger(orderId) || !['shipped', 'completed', 'cancelled'].includes(status)) return redirectWithMsg(res, '/admin/orders', 'Status pesanan tidak valid.', 'error');
const result = await advanceOrderStatus(orderId, status, 'admin-ui', { trackingNumber: String(req.body.trackingNumber || '').trim(), shippingCarrier: String(req.body.shippingCarrier || '').trim() });
        redirectWithMsg(res, `/admin/orders/${orderId}`, result.ok ? 'Status pesanan diperbarui.' : result.error, result.ok ? 'ok' : 'error');
    });

    app.get('/admin/chat', async (req, res) => {
        const jid = String(req.query.jid || '').trim();
        const search = String(req.query.q || '').trim();

        if (!jid) {
            const query = new URLSearchParams();
            if (search) query.set('q', search);
            const queryString = query.toString();
            res.redirect(`/admin/leads${queryString ? `?${queryString}` : ''}`);
            return;
        }

        const [messages, conversation] = await Promise.all([
            getFullChatHistory(jid, 300),
            getConversationSummary(pool, jid),
        ]);
        const thread = messages.length
            ? `<div class="chat-thread" data-chat-thread>${renderTranscript(messages, { timeZone: getBusinessConfig().businessHours.timezone })}</div>`
            : emptyState('Riwayat kosong', 'Belum ada pesan tersimpan untuk pelanggan ini.', '/admin/leads', 'Ke Calon Pelanggan');
        const customerName = conversation?.customerName || conversation?.phone || 'Pelanggan';
        const phone = conversation?.phone || whatsappNumber(jid);

        res.send(page('Chat', `
<div class="chat-head">
  <div>
    <h1 class="chat-title">Riwayat Percakapan</h1>
    <p><strong>${escapeHtml(customerName)}</strong>${phone && phone !== shortJid(jid) ? ` · <span class="mono">${escapeHtml(phone)}</span>` : ''} · <span class="mono">${escapeHtml(shortJid(jid))}</span></p>
    <p class="muted chat-count">${conversation?.messageCount ?? messages.length} pesan${conversation?.firstAt ? ` · Kontak pertama ${fmtDateTime(conversation.firstAt)}` : ''}${conversation?.lastAt ? ` · Aktivitas terakhir ${fmtDateTime(conversation.lastAt)}` : ''}</p>
  </div>
  <div class="row-actions">
    <a class="ghost-btn" href="/admin/chat">Semua percakapan</a>
    ${whatsappNumber(jid) ? `<a class="ghost-btn" href="https://wa.me/${whatsappNumber(jid)}" target="_blank" rel="noreferrer">Hubungi di WhatsApp</a>` : ''}
  </div>
</div>
<section class="panel">${thread}</section>`, 'chat', { toastHtml: toastFromQuery(req.query as Record<string, unknown>) }));
    });

    app.get('/admin/history', (req, res) => {
        const query = new URLSearchParams();
        if (typeof req.query.q === 'string' && req.query.q.trim()) query.set('q', req.query.q.trim());
        if (typeof req.query.jid === 'string' && req.query.jid.trim()) query.set('jid', req.query.jid.trim());
        res.redirect(`/admin/chat${query.size ? `?${query.toString()}` : ''}`);
    });

    app.get('/admin/handoff', async (req, res) => {
        const [rows, inboundFailures, outboundFailures] = await Promise.all([
            handoffRepository.listActive(100),
            messageStore.listInboundFailures(20),
            messageStore.listOutboundFailures(20),
        ]);
        const pipelineFailures = [...inboundFailures.map((item) => ({ ...item, direction: 'Masuk', route: 'inbound' })), ...outboundFailures.map((item) => ({ ...item, direction: 'Keluar', route: 'outbound' }))];
        const configuredAdminJid = process.env.ADMIN_WA_JID?.trim() || '';
        const failuresHtml = `<section id="pipeline-failures" class="section-head"><div><h2>Antrean pesan bermasalah</h2><p class="muted">Pesan retry dan dead-letter yang membutuhkan perhatian operator.</p></div>${badge(pipelineFailures.length ? `${pipelineFailures.length} item` : 'Bersih', pipelineFailures.length ? 'danger' : 'ok')}</section>
${pipelineFailures.length ? `<div class="table-wrap"><table><thead><tr><th>Arah</th><th>JID</th><th>Status</th><th>Percobaan</th><th>Error terakhir</th><th>Aksi</th></tr></thead><tbody>${pipelineFailures.map((item) => `<tr><td>${escapeHtml(item.direction)}</td><td><code>${escapeHtml(item.jid)}</code></td><td>${badge(item.status, item.status === 'dead_letter' ? 'danger' : 'warn')}</td><td>${escapeHtml(item.attempts)} / ${escapeHtml(item.max_attempts)}</td><td>${escapeHtml(item.last_error || '—')}</td><td>${item.route === 'outbound' && item.jid === 'ADMIN_WA_JID' && !configuredAdminJid ? '<span class="muted">Isi nomor admin untuk retry</span>' : `<form method="post" action="/admin/pipeline/${item.route}/${item.id}/retry"><button class="secondary-button">Retry</button></form>`}</td></tr>`).join('')}</tbody></table></div>` : emptyState('Antrean pesan bersih', 'Tidak ada pesan gagal atau menunggu retry manual.', '/admin', 'Kembali ke Ringkasan')}`;
        res.send(page('Perlu Ditangani', `${pageHeader('Perlu Ditangani', 'Pelanggan dan pesan yang membutuhkan bantuan admin.', 'HF-08')}${handoffTable(rows)}${failuresHtml}`, 'handoff', { toastHtml: toastFromQuery(req.query as Record<string, unknown>) }));
    });

    app.post('/admin/handoff/resolve', async (req, res) => {
        const jid = String(req.body.jid || '').trim();
        const id = Number(req.body.id);
        if (Number.isFinite(id)) await handoffRepository.resolveById(id, 'admin-ui');
        else if (jid) await resolveHandoff(jid, 'admin-ui');
        redirectWithMsg(res, '/admin/handoff', jid ? `Handoff ${jid} di-resolve.` : 'JID kosong.', jid ? 'ok' : 'error');
    });

    app.post('/admin/handoff/assign', async (req, res) => {
        const id = Number(req.body.id);
        if (Number.isFinite(id)) await handoffRepository.assign(id, 'admin-ui', 'admin-ui');
        redirectWithMsg(res, '/admin/handoff', 'Handoff diambil.', 'ok');
    });

    app.post('/admin/handoff/handling', async (req, res) => {
        const id = Number(req.body.id);
        if (Number.isFinite(id)) await handoffRepository.startHandling(id, 'admin-ui');
        redirectWithMsg(res, '/admin/handoff', 'Handoff mulai ditangani.', 'ok');
    });

    app.post('/admin/customer/update', async (req, res) => {
        try {
            const raw = String(req.body.jid || '').trim().toLowerCase();
            const jid = raw.endsWith('@lid') ? raw : normalizeCustomerJid(raw);
            const name = String(req.body.name || '').trim();
            const phone = String(req.body.phone || '').trim();
            const status = String(req.body.status || 'new').trim();
            const preferences = String(req.body.preferences || '').trim();
            const address = String(req.body.address || '').trim();
            const notes = String(req.body.notes || '').trim();

            await pool.query(
                `UPDATE leads 
                 SET name = $1, phone = $2, status = $3, preferences = $4, address = $5, notes = $6, updated_at = CURRENT_TIMESTAMP
                 WHERE jid = $7`,
                [name, phone || null, status, preferences, address, notes, jid]
            );

            redirectWithMsg(res, '/admin/leads', 'Data pelanggan berhasil diperbarui.', 'ok');
        } catch (err: any) {
            console.error('[Admin] Gagal update customer:', err);
            redirectWithMsg(res, '/admin/leads', err.message || 'Gagal menyimpan data.', 'error');
        }
    });

    app.post('/admin/customer/update-status', async (req, res) => {
        try {
            const jid = String(req.body.jid || '').trim();
            const status = String(req.body.status || 'new').trim();
            
            await pool.query(
                `UPDATE leads SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE jid = $2`,
                [status, jid]
            );
            redirectWithMsg(res, '/admin/leads', 'Status pelanggan berhasil diperbarui.', 'ok');
        } catch (err: any) {
            console.error('[Admin] Gagal update status:', err);
            redirectWithMsg(res, '/admin/leads', err.message || 'Gagal mengubah status.', 'error');
        }
    });

    app.post('/admin/customer/clear', async (req, res) => {
        let jid = '';
        try {
            const raw = String(req.body.jid || '').trim().toLowerCase();
            if (raw.endsWith('@lid')) {
                jid = raw;
            } else {
                jid = normalizeCustomerJid(raw);
            }
            await deleteCustomerData(jid, { retainFinancial: true });
        } catch (error) {
            const back = String(req.get('referer') || '').includes('/admin/leads') ? String(req.get('referer')) : '/admin/leads';
            redirectWithMsg(res, back, error instanceof Error ? error.message : 'Nomor WhatsApp tidak valid.', 'error');
            return;
        }
        const back = String(req.get('referer') || '').includes('/admin/leads') ? String(req.get('referer')) : '/admin/leads';
        redirectWithMsg(res, back, `Customer ${jid} dihapus.`, 'ok');
    });

    app.get('/admin/customer/export', async (req, res) => {
        try {
            const jid = String(req.query.jid || '').trim();
            const payload = await exportCustomerData(jid);
            res.setHeader('Content-Disposition', `attachment; filename="customer-export-${encodeURIComponent(jid.replace(/[^a-z0-9@._-]/gi, '_'))}.json"`);
            res.type('application/json').send(JSON.stringify(payload, null, 2));
        } catch (error) {
            redirectWithMsg(res, '/admin/leads', error instanceof Error ? error.message : 'Data customer tidak dapat diekspor.', 'error');
        }
    });

    app.post('/admin/auth/clear', async (req, res) => {
        const targetUrl = String(req.body.redirectUrl || req.get('referer') || '/admin/whatsapp');
        const phone = req.body.phone ? String(req.body.phone).trim() : null;
        if (phone) {
            globalWhatsAppManager.setSessionStatus(phone, 'disconnected');
            await stopWhatsAppSession(phone, true);
            redirectWithMsg(res, targetUrl, `Sesi WhatsApp untuk ${phone} berhasil di-reset.`, 'ok');
            return;
        }
        await pool.query('DELETE FROM auth_keys');
        redirectWithMsg(res, targetUrl, 'Sesi WhatsApp berhasil di-reset. Silakan scan QR ulang.', 'ok');
    });

    app.use((error: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
        const requestId = String(res.locals.requestId || 'UNKNOWN');
        console.error(`Admin error [${requestId}] ${req.method} ${req.path}: ${error instanceof Error ? error.name : 'UnknownError'}`);
        if (res.headersSent) return;
        const message = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
            ? 'Ukuran file melebihi batas 10 MB.'
            : 'Kesalahan internal. Gunakan ID permintaan saat melapor.';
        res.status(500).send(page('Terjadi Masalah', `${pageHeader('Terjadi Masalah', 'Permintaan tidak dapat diselesaikan.', 'ER-00')}<section class="panel"><h2>Sistem mengalami kendala</h2><p>${escapeHtml(message)}</p><p class="muted">Data yang sudah tersimpan tetap aman. Coba kembali atau ulangi beberapa saat lagi.</p><p class="mono">Kode referensi: ${escapeHtml(requestId)}</p><a class="button-link" href="${escapeHtml(req.get('referer') || '/admin')}">Kembali</a></section>`, 'dashboard'));
    });

    const requestedPort = Number(process.env.PORT || 3000);
    const production = process.env.NODE_ENV === 'production';
    const host = process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1');
    const { port, server } = await listenOnAvailablePort(app, requestedPort, production ? 1 : 100, host);
    activeAdminServer = server;
    process.env.PORT = String(port);
    console.log(`Admin web aktif: http://${host}:${port}/admin`);
    return port;
};

export const stopAdminServer = async () => {
    const server = activeAdminServer;
    activeAdminServer = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
};
