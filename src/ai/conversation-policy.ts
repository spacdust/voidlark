export type PreviewConversationState = {
    stage?: string;
    productName?: string;
    classification?: string;
    attributes?: Record<string, string>;
    quantity?: number;
    unitPrice?: number;
    subtotal?: number;
    customer?: Record<string, string>;
    shippingEvidence?: string;
    handoffReason?: string;
    maxBudget?: number;
};

const bounded = (value: unknown, max = 200) => String(value ?? '').trim().slice(0, max);
const objectValue = (value: unknown): Record<string, unknown> => {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value !== 'string') return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
};
export const normalizePreviewState = (value: unknown): PreviewConversationState => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const raw = value as Record<string, unknown>;
    const attributes = raw.attributes && typeof raw.attributes === 'object' && !Array.isArray(raw.attributes)
        ? Object.fromEntries(Object.entries(raw.attributes as Record<string, unknown>).slice(0, 20).map(([key, item]) => [bounded(key, 100), bounded(item)]).filter(([key, item]) => key && item))
        : undefined;
    const customer = raw.customer && typeof raw.customer === 'object' && !Array.isArray(raw.customer)
        ? Object.fromEntries(Object.entries(raw.customer as Record<string, unknown>).slice(0, 20).map(([key, item]) => [bounded(key, 100), bounded(item, 500)]).filter(([key, item]) => key && item))
        : undefined;
    const positive = (item: unknown, max: number) => Number.isFinite(Number(item)) && Number(item) > 0 ? Math.min(Number(item), max) : undefined;
    return {
        ...(raw.stage ? { stage: bounded(raw.stage, 50) } : {}),
        ...(raw.productName ? { productName: bounded(raw.productName) } : {}),
        ...(raw.classification ? { classification: bounded(raw.classification) } : {}),
        ...(attributes && Object.keys(attributes).length ? { attributes } : {}),
        ...(positive(raw.quantity, 10_000) ? { quantity: positive(raw.quantity, 10_000) } : {}),
        ...(positive(raw.unitPrice, 1_000_000_000) ? { unitPrice: positive(raw.unitPrice, 1_000_000_000) } : {}),
        ...(positive(raw.subtotal, 10_000_000_000) ? { subtotal: positive(raw.subtotal, 10_000_000_000) } : {}),
        ...(customer && Object.keys(customer).length ? { customer } : {}),
        ...(raw.shippingEvidence ? { shippingEvidence: bounded(raw.shippingEvidence, 2_000) } : {}),
        ...(raw.handoffReason ? { handoffReason: bounded(raw.handoffReason, 500) } : {}),
        ...(positive(raw.maxBudget, 10_000_000_000) ? { maxBudget: positive(raw.maxBudget, 10_000_000_000) } : {}),
    };
};

export const buildPersistedConversationState = (chatState: unknown, draftOrder: unknown): PreviewConversationState => {
    const chat = objectValue(chatState);
    const data = objectValue(chat.data);
    const draft = objectValue(draftOrder);
    const options = objectValue(draft.options ?? data.options ?? data.attributes ?? data.recommendedAttributes);
    const customerData = objectValue(draft.customer_data ?? data.customerData ?? data.customer);
    const attributes = {
        ...Object.fromEntries(Object.entries(options).map(([key, value]) => [key, String(value)])),
        ...(draft.quality ? { Kualitas: String(draft.quality) } : {}),
        ...(draft.package_size ? { Ukuran: String(draft.package_size) } : draft.size_ml ? { Ukuran: `${draft.size_ml}ml` } : {}),
    };
    return normalizePreviewState({
        stage: chat.stage ?? data.stage,
        productName: draft.product_name ?? draft.aroma ?? data.productName ?? data.aroma ?? data.recommendedProductName,
        classification: draft.variant ?? data.variant ?? data.classification ?? data.recommendedClassification,
        attributes,
        quantity: draft.quantity ?? data.quantity,
        unitPrice: draft.product_price ?? data.productPrice ?? data.unitPrice,
        subtotal: Number(draft.product_price ?? data.productPrice ?? data.unitPrice) * Math.max(1, Number(draft.quantity ?? data.quantity) || 1),
        customer: {
            ...Object.fromEntries(Object.entries(customerData).map(([key, value]) => [key, String(value)])),
            ...(draft.customer_name ? { name: String(draft.customer_name) } : {}),
            ...(draft.phone ? { phone: String(draft.phone) } : {}),
            ...(draft.address ? { address: String(draft.address) } : {}),
        },
        shippingEvidence: data.shippingEvidence,
        maxBudget: data.maxBudget,
    });
};

export const buildConsultationPolicy = () => `RITME KONSULTASI LINTAS PRODUK:
1. Pahami kebutuhan dan batasan customer terlebih dahulu. Tanyakan hanya satu hal terpenting yang belum jelas.
2. Setelah kebutuhan cukup jelas, rekomendasikan maksimal 2-3 produk yang benar-benar didukung evidence.
3. Saat customer tertarik atau memilih produk, jelaskan dahulu alasan kecocokan serta fitur, manfaat, spesifikasi, komposisi, atau karakter yang paling relevan dari evidence. Jangan langsung menumpahkan semua variasi dan harga.
4. Jelaskan klasifikasi produk bila membantu customer memahami pilihan.
5. Tawarkan variasi dan harga setelah customer memahami produknya, kecuali customer memang langsung meminta harga.
6. Minta data checkout hanya setelah produk, seluruh variasi wajib, dan jumlah sudah jelas.
7. Buat rekap sementara sebelum meminta data customer, lalu rekap akhir setelah checkout dan pengiriman lengkap.
8. Jika kamu sudah merekomendasikan kelompok atau variasi tertentu dan customer melanjutkan pertanyaan tentang rekomendasi itu, pertahankan rekomendasi tersebut sebagai pilihan sementara. Jangan tanyakan ulang kelompok atau variasi yang sudah kamu tentukan kecuali customer menolak atau menggantinya.
9. Pahami rujukan natural seperti "yang pertama", "yang kedua", "yang tadi", "ukuran kecil", dan "ukuran besar" dari pilihan terakhir serta urutan variasi pada katalog.
10. Jika customer bertanya "enaknya mana", "yang paling cocok", atau meminta satu rekomendasi, pilih tepat satu opsi terbaik berdasarkan evidence dan jelaskan singkat. Jangan menjawab dengan dua opsi lalu meminta customer memilih lagi.
11. Jangan mengatakan data pilihan tidak ada atau tidak lengkap jika pada balasan yang sama kamu dapat memberikan rekomendasi yang didukung evidence. Langsung sampaikan rekomendasi dan batas hanya pada fakta yang memang belum tersedia.
12. Jika customer meminta ukuran paling kecil, jawab ukuran terkecil sebagai poin utama beserta harganya. Setelah itu boleh tampilkan ukuran lain untuk kualitas yang sama sebagai informasi tambahan.
13. Kualitas jawaban lebih penting daripada cepat closing. Sebelum menjawab, cek kecocokan dengan kebutuhan, state, budget, dan evidence. Jangan mengisi celah fakta dengan asumsi.

PENERAPAN SETTING GAYA:
- Ikuti setting panjang balasan dan cara menjual yang aktif pada prompt bisnis.
- Jika setting meminta detail, beri penjelasan bermakna pada fokus saat ini; jangan menggantinya dengan daftar panjang atau mempercepat closing.
- Jika setting penjualan meminta keseimbangan, beri ruang konsultasi dan konfirmasi minat sebelum mengarahkan pembelian.
- Akui isi pesan customer dengan kalimat natural sebelum melanjutkan.
- Kecuali customer hanya meminta angka atau konfirmasi singkat, susun balasan dengan tiga unsur: jawaban utama, alasan relevan dari fakta yang tersedia, lalu satu langkah berikutnya yang berguna. Jangan berhenti pada nama produk atau pilihan variasi saja.
- Jelaskan batas data dengan bahasa customer seperti "durasi pastinya belum dicantumkan". Jangan memakai bahasa audit seperti "klaim terverifikasi", "data internal", atau "belum lolos verifikasi".
- Hindari pola berulang dan bahasa formulir seperti "dua kelompok utama", "berikut pilihan", atau "mau pilih yang mana" pada setiap turn.
- Variasikan susunan kalimat. Gunakan Bahasa Indonesia percakapan yang hangat dan profesional, tanpa mengarang fakta.
- Jangan memakai istilah internal seperti "terverifikasi", "katalog internal", "state", atau "evidence". Jangan mengulang sapaan dan perkenalan setelah awal percakapan.
- Pertanyaan penutup wajib konkret dan berguna untuk keputusan berikutnya. Jika kebutuhan sudah cukup jelas, langsung jawab atau pilihkan satu opsi tanpa pertanyaan template.
- Jangan menyebut fase, policy, state, evidence, Knowledge, atau proses internal kepada customer.`;

export const buildPreviewStateEvidence = (state: PreviewConversationState = {}) => `STATE SIMULASI TERVERIFIKASI:
${JSON.stringify(state, null, 2)}
${state.unitPrice ? `Harga satuan terkunci: Rp${state.unitPrice.toLocaleString('id-ID')}.` : ''}
${state.subtotal ? `Subtotal terkunci: Rp${state.subtotal.toLocaleString('id-ID')}.` : ''}
${state.maxBudget ? `Budget maksimal customer: Rp${state.maxBudget.toLocaleString('id-ID')}.` : ''}
Pertahankan nilai yang sudah ada. Ubah hanya bila customer secara eksplisit mengganti pilihannya.`;

export const requestsHumanHandoff = (text: string) => {
    if (/\bkalau\b[\s\S]{0,50}\b(?:masih|nanti)\b[\s\S]{0,40}\b(?:admin|manusia|cs|customer service)\b/i.test(text)) return false;
    const explicitHuman = /\b(?:mau|ingin|pengen|tolong|sambung(?:kan)?|hubung(?:kan)?|bicara|ngomong|chat)\b[\s\S]{0,40}\b(?:admin|manusia|orang|cs|customer service)\b/i;
    const adminFirst = /\b(?:admin|manusia|orang|cs|customer service)\b[\s\S]{0,30}\b(?:dong|aja|saja|tolong|sekarang|langsung)\b/i;
    return explicitHuman.test(text) || adminFirst.test(text);
};

export const enforceSingleQuestion = (text: string) => {
    const parts = text.match(/[^.!?\n]+[.!?]?|\n+/g) || [text];
    const lastQuestion = parts.findLastIndex((part) => part.includes('?'));
    return parts.filter((part, index) => !part.includes('?') || index === lastQuestion)
        .join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
};

export const buildUnsupportedDurabilityReply = (prompt: string, evidence: string) => {
    if (!/\b(?:tahan berapa|berapa lama.*tahan|ketahanan.*berapa|pasti.*tahan|tahan.*\d+\s*(?:menit|jam|hari))\b/i.test(prompt)) return null;
    if (/\b(?:tahan|ketahanan)[^\n.!?]{0,60}\d+(?:\s*[-–—]\s*\d+)?\s*(?:menit|jam|hari)\b/i.test(evidence)) return null;
    return 'Durasi ketahanan pastinya belum tercantum, Kak, jadi aku tidak bisa menjanjikan jumlah jam tertentu. Hasil pemakaian juga bisa berbeda tergantung kondisi dan cara penggunaan.';
};

export const buildUnsupportedStockNote = (prompt: string, evidence: string) => {
    if (!/\b(?:ready|stok|stock|tersedia)\b/i.test(prompt)) return '';
    if (/\b(?:ready(?:\s+stock)?|stok (?:tersedia|ready|aman)|tersedia stok|in stock|habis|sold out)\b/i.test(evidence)) return '';
    return 'Status stok saat ini belum dicantumkan, jadi perlu dikonfirmasi ke admin sebelum pesanan diproses.';
};

export const buildUnsupportedSafetyReply = (prompt: string, evidence: string) => {
    if (!/\b(?:kulit sensitif|alergi|iritasi|aman.*(?:kulit|anak|hamil)|semprot langsung.*kulit)\b/i.test(prompt)) return null;
    if (/\b(?:aman untuk kulit sensitif|hypoallergenic|teruji dermatologis|petunjuk penggunaan|peringatan penggunaan)\b/i.test(evidence)) return null;
    return 'Keamanan untuk kulit sensitif belum dicantumkan, Kak, jadi aku tidak bisa memastikan aman disemprot langsung. Ikuti petunjuk pada kemasan; kalau mudah iritasi, hentikan pemakaian bila muncul reaksi dan konfirmasikan dulu ke admin atau tenaga kesehatan.';
};

export const buildRecommendationConfirmationReply = (prompt: string, state: PreviewConversationState) => {
    if (!state.productName || !/\b(?:pilih(?:kan)? satu|satu pilihan|pilihan (?:aja|saja)|paling aman(?: satu)?|satu aja|satu saja|kualitas (?:yang )?paling sesuai)\b/i.test(prompt)) return null;
    const variation = [state.classification, ...Object.values(state.attributes || {})].filter(Boolean).join(' ');
    if (variation && state.unitPrice) return `Kalau mau satu pilihan, aku pilih ${state.productName} ${variation}, Kak. Harganya Rp${state.unitPrice.toLocaleString('id-ID')}, dan ini yang paling sesuai dengan yang Kakak cari tadi.`;
    if (variation) return `Kalau mau satu pilihan, aku pilih ${state.productName} dari ${variation}, Kak. Ini yang paling sesuai dengan yang Kakak cari tadi.`;
    return `Kalau mau satu pilihan, aku pilih ${state.productName}, Kak. Ini yang paling sesuai dengan yang Kakak cari tadi.`;
};

export const annotateShippingDeadline = (shipping: string, conversation: string) => {
    if (!/\b(?:butuh|dipakai|sampai|tiba|datang)\b[^.!?\n]{0,35}\b(?:hari ini|besok)\b/i.test(conversation)) return shipping;
    const needsToday = /\b(?:butuh|dipakai|sampai|tiba|datang)\b[^.!?\n]{0,35}\bhari ini\b/i.test(conversation);
    const days = [...shipping.matchAll(/\((\d+)\s*hari\)/gi)].map((match) => Number(match[1]));
    const limit = needsToday ? 0 : 1;
    const eligible = days.some((day) => day <= limit);
    const lines = shipping.split(/\r?\n/);
    const closingQuestion = lines.findLast((line) => line.includes('?'))?.trim();
    const body = lines.filter((line) => !line.includes('?')).join('\n').trim();
    const note = eligible
        ? `Karena dibutuhkan ${needsToday ? 'hari ini' : 'besok'}, pilih layanan dengan estimasi maksimal ${limit} hari. Estimasi kurir bukan jaminan waktu tiba.`
        : `Belum ada layanan pada hasil ini yang estimasinya memenuhi kebutuhan ${needsToday ? 'hari ini' : 'besok'}, Kak.`;
    return `${body}\n\n${note}${closingQuestion ? `\n\n${closingQuestion}` : ''}`;
};

export const buildCheckoutSafeFallback = (state: PreviewConversationState, prompt: string) => {
    const hasCheckoutData = /(?:\+?62|0)\d[\d\s-]{7,16}\d/.test(prompt)
        || /\b(?:nama|atas nama|alamat|kirim ke|email)\b/i.test(prompt);
    if (!hasCheckoutData || !state.productName || !state.classification || !state.attributes || !state.unitPrice) return null;
    const selection = [state.productName, state.classification, ...Object.values(state.attributes)].filter(Boolean).join(' ');
    const quantity = Math.max(1, state.quantity || 1);
    return `Oke, Kak. Pilihannya tetap ${selection} x ${quantity}, harga satuan Rp${state.unitPrice.toLocaleString('id-ID')}. Data checkout dari pesan Kakak aku lanjutkan tanpa mengubah pilihan produk.`;
};

export const mergePreviewState = (current: PreviewConversationState, update: Record<string, unknown>): PreviewConversationState => ({
    ...normalizePreviewState(current),
    ...(update.stage ? { stage: String(update.stage) } : {}),
    ...(update.productName || update.aroma ? { productName: String(update.productName || update.aroma) } : {}),
    ...(update.variant ? { classification: String(update.variant) } : {}),
    ...(update.options && typeof update.options === 'object' ? { attributes: Object.fromEntries(Object.entries(update.options).map(([key, value]) => [key, String(value)])) } : {}),
    ...(Number(update.quantity) > 0 ? { quantity: Number(update.quantity) } : {}),
    customer: {
        ...(current.customer || {}),
        ...(update.customerName ? { name: String(update.customerName) } : {}),
        ...(update.name ? { name: String(update.name) } : {}),
        ...(update.phone ? { phone: String(update.phone) } : {}),
        ...(update.address ? { address: String(update.address) } : {}),
    },
});
