export type ProductDomain = 'fragrance' | 'generic';

export const resolveProductDomain = (instructions: string, knowledge: string): ProductDomain => {
    const evidence = `${instructions}\n${knowledge}`.toLowerCase();
    return /\b(?:parfum|perfume|fragrance|aroma|wewangian|notes? aroma|inspired|penggolongan[- ]notes)\b/.test(evidence)
        ? 'fragrance'
        : 'generic';
};

export const buildExternalSearchQuery = (product: string, domain: ProductDomain) => domain === 'fragrance'
    ? `${product} perfume fragrance notes official`
    : `${product} product specifications official`;

export const supportsFragranceCatalogSchema = (rows: unknown[][]) => rows.some((row) => {
    const headers = row.map((cell) => String(cell || '').trim().toLowerCase());
    return headers.includes('nama item') && headers.includes('karakter') && headers.includes('note');
});
