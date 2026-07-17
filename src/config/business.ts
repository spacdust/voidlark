import fs from 'fs';
import path from 'path';

export interface BusinessConfig {
    businessName: string;
    csName: string;
    productType: 'physical' | 'digital';
    enableShipping: boolean;
    enableExternalProductLookup: boolean;
    salesFlow: string;
    checkoutFields: string[];
    orderFields: string[];
    shippingWeights: Record<string, number>;
    paymentInstructions: string;
    handoffAfterPaymentSummary: boolean;
    businessHours: BusinessHoursConfig;
    consent: ConsentConfig;
}

export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
export interface BusinessHoursConfig {
    enabled: boolean;
    timezone: string;
    weekly: Record<Weekday, string[]>;
    holidays: string[];
    outOfHoursResponse: string;
    responseEstimate: string;
    handoffPolicy: 'create' | 'none';
    slaMinutes: Record<'low' | 'normal' | 'high' | 'urgent', number>;
}
export interface ConsentConfig {
    optOutKeywords: string[];
    optInKeywords: string[];
    optOutResponse: string;
    optInResponse: string;
}

const DEFAULT_WEEKLY: BusinessHoursConfig['weekly'] = {
    monday: ['09:00-17:00'], tuesday: ['09:00-17:00'], wednesday: ['09:00-17:00'],
    thursday: ['09:00-17:00'], friday: ['09:00-17:00'], saturday: [], sunday: [],
};

const DEFAULT_CONFIG: BusinessConfig = {
    businessName: 'Voidlark',
    csName: 'Anin',
    productType: 'physical',
    enableShipping: true,
    enableExternalProductLookup: false,
    salesFlow: 'consultative',
    checkoutFields: ['name', 'phone', 'address'],
    orderFields: ['productName', 'variant', 'quality', 'packageSize', 'quantity'],
    shippingWeights: {},
    paymentInstructions: 'Transfer ke rekening toko, lalu kirim bukti transfer di chat ini.',
    handoffAfterPaymentSummary: false,
    businessHours: {
        enabled: false, timezone: 'Asia/Jakarta', weekly: DEFAULT_WEEKLY, holidays: [],
        outOfHoursResponse: 'Pesan Kakak sudah kami terima di luar jam operasional.',
        responseEstimate: 'Tim kami akan membalas pada jam operasional berikutnya.', handoffPolicy: 'create',
        slaMinutes: { low: 240, normal: 120, high: 60, urgent: 15 },
    },
    consent: {
        optOutKeywords: ['STOP', 'BERHENTI', 'UNSUBSCRIBE'], optInKeywords: ['START', 'MULAI', 'SUBSCRIBE'],
        optOutResponse: 'Permintaan berhenti berhasil disimpan. Pesan promosi tidak akan dikirim lagi.',
        optInResponse: 'Preferensi berhasil diperbarui. Kakak dapat menerima informasi promosi lagi.',
    },
};

export const getBusinessConfig = (): BusinessConfig => {
    const configPath = path.resolve('business.config.json');
    const fileConfig = fs.existsSync(configPath)
        ? JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        : {};

    const rawProductType = fileConfig.productType || process.env.PRODUCT_TYPE || DEFAULT_CONFIG.productType;
    const productType = (rawProductType === 'digital' ? 'digital' : 'physical') as BusinessConfig['productType'];

    const hours = fileConfig.businessHours || {};
    const consent = fileConfig.consent || {};
    return {
        ...DEFAULT_CONFIG,
        ...fileConfig,
        businessName: String(fileConfig.businessName || DEFAULT_CONFIG.businessName).trim(),
        csName: String(fileConfig.csName || DEFAULT_CONFIG.csName).trim() || DEFAULT_CONFIG.csName,
        productType,
        enableShipping: productType === 'physical',
        enableExternalProductLookup: Boolean(fileConfig.enableExternalProductLookup ?? DEFAULT_CONFIG.enableExternalProductLookup),
        checkoutFields: fileConfig.checkoutFields || (productType === 'digital' ? ['name', 'phone', 'email'] : DEFAULT_CONFIG.checkoutFields),
        shippingWeights: fileConfig.shippingWeights || DEFAULT_CONFIG.shippingWeights,
        paymentInstructions: String(fileConfig.paymentInstructions || DEFAULT_CONFIG.paymentInstructions).trim(),
        handoffAfterPaymentSummary: Boolean(fileConfig.handoffAfterPaymentSummary ?? DEFAULT_CONFIG.handoffAfterPaymentSummary),
        businessHours: {
            ...DEFAULT_CONFIG.businessHours, ...hours,
            weekly: { ...DEFAULT_WEEKLY, ...(hours.weekly || {}) },
            holidays: Array.isArray(hours.holidays) ? hours.holidays.map(String) : [],
            slaMinutes: { ...DEFAULT_CONFIG.businessHours.slaMinutes, ...(hours.slaMinutes || {}) },
        },
        consent: {
            ...DEFAULT_CONFIG.consent, ...consent,
            optOutKeywords: Array.isArray(consent.optOutKeywords) ? consent.optOutKeywords.map(String) : DEFAULT_CONFIG.consent.optOutKeywords,
            optInKeywords: Array.isArray(consent.optInKeywords) ? consent.optInKeywords.map(String) : DEFAULT_CONFIG.consent.optInKeywords,
        },
    };
};

export const buildBusinessPrompt = () => {
    const config = getBusinessConfig();
    const lookupRule = config.enableExternalProductLookup
        ? `Lookup eksternal AKTIF. Jika customer sebut produk/brand/spec yang tidak ada atau kurang jelas di knowledge base, panggil tool cariReferensiProduk. Hasil web = referensi saja, bukan stok/harga toko. Setelah dapat referensi, arahkan ke katalog toko.`
        : `Lookup eksternal NONAKTIF. Jika item di luar knowledge base, jujur belum ada di katalog, tawarkan opsi mirip dari knowledge base, atau escalateToHuman jika perlu.`;

    return `BUSINESS CONFIG:
Nama bisnis/produk: ${config.businessName}
Nama CS virtual: ${config.csName}
Tipe produk: ${config.productType}
Shipping aktif: ${config.enableShipping ? 'ya' : 'tidak'}
Lookup eksternal: ${config.enableExternalProductLookup ? 'ya' : 'tidak'}
Sales flow: ${config.salesFlow}
Field checkout wajib: ${config.checkoutFields.join(', ')}
Field order utama: ${config.orderFields.join(', ')}
Instruksi pembayaran: ${config.paymentInstructions}

IDENTITAS WAJIB:
Kamu adalah ${config.csName}, CS virtual ${config.businessName}. Bukan admin manusia.
Sapa sebagai ${config.csName} dari ${config.businessName}, jangan "Ada yang bisa ${config.businessName} bantu?" (terasa kaku/korporat).
Contoh sapaan bagus: "Halo Kak, aku ${config.csName} dari ${config.businessName}."

Jika ditanya bot/AI/manusia:
- Jujur singkat, hangat, tanpa malu-malu berlebihan dan tanpa emoji robot berlebihan.
- Contoh: "Iya Kak, aku ${config.csName}, CS virtual ${config.businessName}. Tetap bisa bantu kok."
- Jangan berbohong bilang manusia. Jangan panjang-panjang soal "asisten virtual".
- Langsung tawarkan bantu 1 pertanyaan lanjutan.

ATURAN CHAT:
- Satu balasan = satu fokus utama. Jangan tembak 3 pertanyaan sekaligus.
- Kalau customer sudah jawab sebagian, jangan tanya ulang info yang sama.
- Produk/brand/spec yang disebut customer: cek knowledge base dulu.
- ${lookupRule}
- Jawaban WhatsApp ringkas. Detail panjang hanya jika customer minta.
- Ikuti tipe produk, field order, dan sales flow dari config — jangan asumsikan industri tertentu.

Gunakan konfigurasi ini sebagai aturan utama. Jika produk/aturan di knowledge base berbeda, ikuti business.config.json untuk flow checkout dan shipping.
Saat customer setuju checkout final (data lengkap + ongkir jika fisik), panggil tool konfirmasiPesanan. Setelah itu kirim ringkasan + instruksi pembayaran. Jangan bilang order lunas sebelum admin/status paid.`;
};
