interface LookupHistoryMessage {
    role: 'user' | 'assistant';
    content: string;
}

const extractComparedProduct = (value: string) => {
    const match = value.match(/(?:mirip|seperti|serupa|dupe|alternatif(?: dari)?|inspired by)\s+([a-z0-9][a-z0-9 '&.-]{2,80})/i);
    if (!match) return null;
    return match[1]
        .replace(/[?!.]+$/g, '')
        .replace(/\b(?:ga|gak|nggak|ada|kah|ya|kak|ka)$/i, '')
        .trim() || null;
};

const extractExplicitReference = (value: string) => {
    const match = value.match(/\b(?:lagi suka|suka parfum|cari(?:in)?|punya|jual)\s+([a-z0-9][a-z0-9 '&.-]{2,80}?)(?=\s*[,?.!]|\s+(?:di sini|disini|ada|nggak|gak|ga|tidak|kah)\b|$)/i);
    if (!match) return null;
    const product = match[1].replace(/\b(?:parfum|perfume)\s*$/i, '').trim();
    if (!product || /^(?:yang|aroma|wangi|produk)$/i.test(product)) return null;
    return product;
};

export const resolveExternalLookupQuery = (prompt: string, history: LookupHistoryMessage[]) => {
    const latestAssistant = [...history].reverse().find((message) => message.role === 'assistant')?.content || '';
    const acceptsRecommendationOffer = /^(?:iya|ya|boleh|mau|oke|ok|lanjut|gas)(?:\s+(?:kak|dong|deh|aja|saja))?[.!?]*$/i.test(prompt.trim())
        && /(?:rekomendasi|pilihkan|pilihan toko|yang (?:mirip|mendekati))/i.test(latestAssistant);
    const referential = /(?:yang\s+)?paling (?:mirip|dekat)(?:\s+(?:aja|saja))?|nuansa(?:nya)? paling dekat|yang tadi|itu aja|satu pilihan/i.test(prompt)
        || acceptsRecommendationOffer;
    if (!referential) {
        const direct = extractComparedProduct(prompt);
        if (direct) return direct;
        const explicit = extractExplicitReference(prompt);
        if (explicit) return explicit;
        return null;
    }
    for (const message of [...history].reverse()) {
        if (message.role !== 'user') continue;
        const product = extractComparedProduct(message.content);
        if (product) return product;
        const explicit = extractExplicitReference(message.content);
        if (explicit) return explicit;
    }
    return null;
};
