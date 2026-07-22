export type ProductDomain = 'fragrance' | 'digital' | 'fashion' | 'electronics' | 'generic';

export const resolveProductDomain = (instructions: string, knowledge: string): ProductDomain => {
    const evidence = `${instructions}\n${knowledge}`.toLowerCase();
    if (/\b(?:parfum|perfume|fragrance|aroma|wewangian|notes? aroma|inspired|penggolongan[- ]notes)\b/.test(evidence)) {
        return 'fragrance';
    }
    if (/\b(?:lisensi|license|voucher|subscription|berlangganan|akun|account|masa aktif|redeem|durasi paket)\b/.test(evidence)) {
        return 'digital';
    }
    if (/\b(?:size chart|ukuran|lingkar dada|lebar dada|panjang baju|combed|oversized|regular fit|slim fit|bahan kain|baju|celana|sepatu)\b/.test(evidence)) {
        return 'fashion';
    }
    if (/\b(?:ram\b|rom\b|ssd\b|chipset|prosesor|processor|garansi resmi|mah\b|display|layar|spesifikasi tech)\b/.test(evidence)) {
        return 'electronics';
    }
    return 'generic';
};

export const buildExternalSearchQuery = (product: string, domain: ProductDomain) => {
    switch (domain) {
        case 'fragrance':
            return `${product} perfume fragrance notes official`;
        case 'digital':
            return `${product} digital subscription license plan official`;
        case 'fashion':
            return `${product} size chart material specifications official`;
        case 'electronics':
            return `${product} full specifications warranty official`;
        default:
            return `${product} product specifications official`;
    }
};

export const supportsFragranceCatalogSchema = (rows: unknown[][]) => rows.some((row) => {
    const headers = row.map((cell) => String(cell || '').trim().toLowerCase());
    return headers.includes('nama item') && headers.includes('karakter') && headers.includes('note');
});
