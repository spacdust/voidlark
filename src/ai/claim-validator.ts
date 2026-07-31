export type ClaimType = 'price' | 'stock' | 'warranty' | 'format' | 'duration' | 'license' | 'size' | 'material' | 'spec' | 'usage' | 'inclusion' | 'comparison';

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
        pattern: /\b(?:ready(?:\s+stock)?|stok (?:tersedia|ready|aman)|tersedia stok|tersedia kapan (?:aja|saja)|selalu tersedia|in stock|habis|sold out)\b/gi,
        values: (text) => text.match(/\b(?:ready(?:\s+stock)?|stok (?:tersedia|ready|aman)|tersedia stok|tersedia kapan (?:aja|saja)|selalu tersedia|in stock|habis|sold out)\b/gi) || [],
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
        pattern: /\b(?:\d+(?:\s*[-–—]\s*\d+)?\s*(?:jam|bulan|tahun|hari)\s*(?:berlangganan|aktif|paket)?|(?:lebih\s+)?tahan lama|longlasting|wangi nempel|aroma awet|tahan(?=[,.!;]|\s*$))\b/gi,
        values: (text) => {
            const numeric = text.match(/\b\d+(?:\s*[-–—]\s*\d+)?\s*(?:jam|bulan|tahun|hari)\b/gi) || [];
            const qualitative = text.match(/\b(?:(?:lebih|makin|paling)\s+)?tahan lama\b|\blonglasting\b|\bwangi nempel\b|\baroma awet\b|\btahan(?=[,.!;]|\s*$)/gi) || [];
            const matches = [...numeric, ...qualitative];
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
    {
        type: 'usage',
        pattern: /\b(?:sekali semprot cukup|aman[^.!?]{0,45}(?:baju|kantor|ruangan?|tanpa noda)|(?:disarankan|sebaiknya)[^.!?]{0,35}(?:semprot|dipakai)|jaga jarak(?: semprot)?[^.!?]{0,35}|lebih hemat jangka panjang|(?:menyesuaikan|sesuaikan) (?:(?:dengan|sama) )?suhu tubuh|aroma makin enak[^.!?]{0,30}(?:suhu|badan|kulit)|cocok[^.!?]{0,35}dipakai (?:berdua|langsung ke kulit)|(?:tidak|nggak|ga) bikin pusing|(?:tidak|nggak|ga) (?:nyengat|menyengat|overload|mencolok)|(?:wangi|spray) (?:tidak |tak )?menyebar|proyeksi[^.!?]{0,25}(?:kulit|udara)|kesan profesional|profesional(?=[,.!;]|\s*$)|favorit (?:banyak )?(?:orang|pelanggan)|unisex)\b/gi,
        values: (text) => text.match(/\b(?:sekali semprot cukup|aman[^.!?]{0,45}(?:baju|kantor|ruangan?|tanpa noda)|(?:disarankan|sebaiknya)[^.!?]{0,35}(?:semprot|dipakai)|jaga jarak(?: semprot)?[^.!?]{0,35}|lebih hemat jangka panjang|(?:menyesuaikan|sesuaikan) (?:(?:dengan|sama) )?suhu tubuh|aroma makin enak[^.!?]{0,30}(?:suhu|badan|kulit)|cocok[^.!?]{0,35}dipakai (?:berdua|langsung ke kulit)|(?:tidak|nggak|ga) bikin pusing|(?:tidak|nggak|ga) (?:nyengat|menyengat|overload|mencolok)|(?:wangi|spray) (?:tidak |tak )?menyebar|proyeksi[^.!?]{0,25}(?:kulit|udara)|kesan profesional|profesional(?=[,.!;]|\s*$)|favorit (?:banyak )?(?:orang|pelanggan)|unisex)\b/gi) || [],
    },
    {
        type: 'inclusion',
        pattern: /\b(?:bonus|gratis|free gift|sudah termasuk|dapat bonus)[^.!?\n]{0,80}\b/gi,
        values: (text) => text.match(/\b(?:bonus|gratis|free gift|sudah termasuk|dapat bonus)[^.!?\n]{0,80}\b/gi) || [],
    },
    {
        type: 'comparison',
        pattern: /\b(?:(?:kualitas|performa|hasil|daya tahan)\s+(?:setara|sama dengan|standar seperti|sekelas|lebih (?:baik|bagus|kuat))[^.!?\n]{0,80}|(?:aroma|wangi|[\p{L}\p{N}:/-]+)[^.!?\n]{0,25}\b(?:lebih|paling)\s+(?:ringan|kuat|strong|lembut|nendang))\b/giu,
        values: (text) => text.match(/\b(?:(?:kualitas|performa|hasil|daya tahan)\s+(?:setara|sama dengan|standar seperti|sekelas|lebih (?:baik|bagus|kuat))[^.!?\n]{0,80}|(?:aroma|wangi|[\p{L}\p{N}:/-]+)[^.!?\n]{0,25}\b(?:lebih|paling)\s+(?:ringan|kuat|strong|lembut|nendang))\b/giu) || [],
    },
];

export const validateClaims = (answer: string, evidence: string) => {
    const normalizedEvidence = normalize(evidence);
    const unsupportedTypes = rules
        .filter((rule) => {
            rule.pattern.lastIndex = 0;
            if (!rule.pattern.test(answer)) return false;
            const structuredPriceEvidence = evidence.match(/KELOMPOK HARGA TERSTRUKTUR[\s\S]*?\nATURAN:/i)?.[0] || evidence;
            const verifiedClaimEvidence = evidence.match(/KLAIM PRODUK TERVERIFIKASI:[\s\S]*?(?=\n[A-Z][A-Z ]{4,}:|$)/i)?.[0] || '';
            const unsupportedValues = rule.values(answer).filter((value) => {
                const ruleEvidence = rule.type === 'price'
                    ? normalize(structuredPriceEvidence)
                : ['usage', 'inclusion', 'comparison'].includes(rule.type) || (rule.type === 'duration' && !/\d/.test(value))
                        ? normalize(verifiedClaimEvidence)
                        : normalizedEvidence;
                return !ruleEvidence.includes(normalize(value));
            });
            return unsupportedValues.length > 0;
        })
        .map((rule) => rule.type);
    return { valid: unsupportedTypes.length === 0, unsupportedTypes };
};

export const removeUnsupportedClaimSentences = (answer: string, evidence: string) => {
    const normalizedEvidence = normalize(evidence);
    let cleaned = answer;
    for (const rule of rules.filter((item) => ['duration', 'stock', 'usage', 'inclusion', 'comparison'].includes(item.type))) {
        for (const value of rule.values(answer)) {
            const evidenceForRule = ['usage', 'inclusion', 'comparison'].includes(rule.type) || (rule.type === 'duration' && !/\d/.test(value))
                ? normalize(evidence.match(/KLAIM PRODUK TERVERIFIKASI:[\s\S]*?(?=\n[A-Z][A-Z ]{4,}:|$)/i)?.[0] || '')
                : normalizedEvidence;
            if (!evidenceForRule.includes(normalize(value))) cleaned = cleaned.replace(value, '');
        }
    }
    return cleaned
        .replace(/[ \t]+([,.!?])/g, '$1')
        .replace(/(?:^|\s)(?:dan|serta|dengan)\s*([,.!?]|$)/gi, '$1')
        .replace(/([.!?])\s*([.!?])+/g, '$1')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};
