export type ClaimType = 'price' | 'stock' | 'warranty' | 'format' | 'duration' | 'license' | 'size' | 'material' | 'spec';

interface ClaimRule {
    type: ClaimType;
    pattern: RegExp;
    values: (text: string) => string[];
}

const normalize = (value: string) => value.toLowerCase().replace(/[.,]$/g, '').replace(/\s+/g, ' ').trim();

const rules: ClaimRule[] = [
    {
        type: 'price',
        pattern: /(?:rp\.?\s*\d[\d.]*|\b\d[\d.]*\s*(?:ribu|rb|juta|jt)\b)/gi,
        values: (text) => (text.match(/(?:rp\.?\s*\d[\d.]*|\b\d[\d.]*\s*(?:ribu|rb|juta|jt)\b)/gi) || []).map((v) => v.replace(/[.,]$/, '')),
    },
    {
        type: 'stock',
        pattern: /\b(?:ready stock|stok tersedia|tersedia stok|stok ready|in stock|habis|sold out)\b/gi,
        values: (text) => text.match(/\b(?:ready stock|stok tersedia|tersedia stok|stok ready|in stock|habis|sold out)\b/gi) || [],
    },
    {
        type: 'warranty',
        pattern: /\bgaransi\s*(?:resmi|toko|distributor)?\s*\d+\s*(?:hari|bulan|tahun)\b/gi,
        values: (text) => text.match(/\bgaransi\s*(?:resmi|toko|distributor)?\s*\d+\s*(?:hari|bulan|tahun)\b/gi) || [],
    },
    {
        type: 'format',
        pattern: /\b(?:roll[\s-]*on|spray)\b/gi,
        values: (text) => text.match(/\b(?:roll[\s-]*on|spray)\b/gi) || [],
    },
    {
        type: 'duration',
        pattern: /\b\d+\s*(?:bulan|tahun|hari)\s*(?:berlangganan|aktif|paket)?\b/gi,
        values: (text) => {
            const matches = text.match(/\b\d+\s*(?:bulan|tahun|hari)\b/gi) || [];
            // Filter out warranty matches
            return matches.filter((m) => !/\bgaransi\b/i.test(text.substring(Math.max(0, text.indexOf(m) - 15), text.indexOf(m) + m.length + 15)));
        },
    },
    {
        type: 'license',
        pattern: /\b(?:lisensi|akun)\s+(?:personal|family|pro|premium|business|enterprise|sharing|private)\b/gi,
        values: (text) => text.match(/\b(?:personal|family|pro|premium|business|enterprise|sharing|private)\b/gi) || [],
    },
    {
        type: 'size',
        pattern: /\b(?:ukuran|size)\s+(?:s|m|l|xl|xxl|3xl|[34][0-9])\b/gi,
        values: (text) => text.match(/\b(?:s|m|l|xl|xxl|3xl|[34][0-9])\b/gi) || [],
    },
    {
        type: 'material',
        pattern: /\bbahan\s+(?:katun|cotton|combed|fleece|canvas|denim|leather|kulit|polyester|silk|rayon)\b/gi,
        values: (text) => text.match(/\b(?:katun|cotton|combed|fleece|canvas|denim|leather|kulit|polyester|silk|rayon)\b/gi) || [],
    },
    {
        type: 'spec',
        pattern: /\b(?:ram\s+\d+\s*gb|storage\s+\d+\s*(?:gb|tb)|rom\s+\d+\s*gb|ssd\s+\d+\s*(?:gb|tb))\b/gi,
        values: (text) => text.match(/\b(?:ram\s+\d+\s*gb|storage\s+\d+\s*(?:gb|tb)|rom\s+\d+\s*gb|ssd\s+\d+\s*(?:gb|tb))\b/gi) || [],
    },
];

export const validateClaims = (answer: string, evidence: string) => {
    const normalizedEvidence = normalize(evidence);
    const unsupportedTypes = rules
        .filter((rule) => {
            rule.pattern.lastIndex = 0;
            if (!rule.pattern.test(answer)) return false;
            const unsupportedValues = rule.values(answer).filter((value) => !normalizedEvidence.includes(normalize(value)));
            return unsupportedValues.length > 0;
        })
        .map((rule) => rule.type);
    return { valid: unsupportedTypes.length === 0, unsupportedTypes };
};
