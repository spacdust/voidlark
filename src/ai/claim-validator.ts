export type ClaimType = 'price' | 'stock' | 'warranty' | 'format';

interface ClaimRule {
    type: ClaimType;
    pattern: RegExp;
    values: (text: string) => string[];
}

const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, ' ').trim();

const rules: ClaimRule[] = [
    {
        type: 'price',
        pattern: /(?:rp\.?\s*\d[\d.,]*|\b\d[\d.,]*\s*(?:ribu|rb|juta|jt)\b)/gi,
        values: (text) => text.match(/(?:rp\.?\s*\d[\d.,]*|\b\d[\d.,]*\s*(?:ribu|rb|juta|jt)\b)/gi) || [],
    },
    {
        type: 'stock',
        pattern: /\b(?:ready stock|stok tersedia|tersedia stok|stok ready|in stock|habis|sold out)\b/gi,
        values: (text) => text.match(/\b(?:ready stock|stok tersedia|tersedia stok|stok ready|in stock|habis|sold out)\b/gi) || [],
    },
    {
        type: 'warranty',
        pattern: /\bgaransi\s+\d+\s*(?:hari|bulan|tahun)\b/gi,
        values: (text) => text.match(/\bgaransi\s+\d+\s*(?:hari|bulan|tahun)\b/gi) || [],
    },
    {
        type: 'format',
        pattern: /\b(?:roll[\s-]*on|spray)\b/gi,
        values: (text) => text.match(/\b(?:roll[\s-]*on|spray)\b/gi) || [],
    },
];

export const validateClaims = (answer: string, evidence: string) => {
    const normalizedEvidence = normalize(evidence);
    const unsupportedTypes = rules
        .filter((rule) => rule.pattern.test(answer) && rule.values(answer).some((value) => !normalizedEvidence.includes(normalize(value))))
        .map((rule) => rule.type);
    return { valid: unsupportedTypes.length === 0, unsupportedTypes };
};
