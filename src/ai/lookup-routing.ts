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

export const resolveExternalLookupQuery = (prompt: string, history: LookupHistoryMessage[]) => {
    const referential = /(?:yang\s+)?paling mirip(?:\s+(?:aja|saja))?|yang tadi|itu aja/i.test(prompt);
    if (!referential) {
        const direct = extractComparedProduct(prompt);
        if (direct) return direct;
        return null;
    }
    for (const message of [...history].reverse()) {
        if (message.role !== 'user') continue;
        const product = extractComparedProduct(message.content);
        if (product) return product;
    }
    return null;
};
