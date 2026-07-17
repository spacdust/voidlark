export interface RetrievalChunk {
    id: number;
    documentId: number;
    fileName: string;
    chunkIndex: number;
    content: string;
}

export interface KnowledgeCitation {
    documentId: number;
    fileName: string;
    chunkIndex: number;
    chunkId: number;
}

export interface KnowledgeEvidence {
    text: string;
    score: number;
    citation: KnowledgeCitation;
}

export interface KnowledgeRetrievalResult {
    query: string;
    text: string;
    evidence: KnowledgeEvidence[];
    citations: KnowledgeCitation[];
}

const STOP_WORDS = new Set(['yang', 'dan', 'atau', 'untuk', 'dari', 'dengan', 'ini', 'itu', 'ada', 'apa', 'saya', 'aku', 'kak', 'mau', 'ingin', 'bisa', 'tidak', 'gak', 'ga', 'nya']);
const terms = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((term) => term.length >= 3 && !STOP_WORDS.has(term));

export const retrieveFromChunks = (chunks: RetrievalChunk[], query: string, options: { maxChars?: number; limit?: number } = {}): KnowledgeRetrievalResult => {
    const queryTerms = [...new Set(terms(query))];
    const documentFrequency = new Map<string, number>();
    for (const term of queryTerms) documentFrequency.set(term, chunks.filter((chunk) => terms(chunk.content).includes(term)).length);
    const scored = chunks.map((chunk, order) => {
        const words = terms(chunk.content);
        const counts = new Map<string, number>();
        for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
        const score = queryTerms.reduce((sum, term) => {
            const frequency = counts.get(term) || 0;
            if (!frequency) return sum;
            const inverseFrequency = Math.log(1 + (chunks.length + 1) / ((documentFrequency.get(term) || 0) + 1));
            return sum + (frequency / (frequency + 1.2)) * inverseFrequency;
        }, 0);
        return { chunk, order, score: Number(score.toFixed(8)) };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.chunk.fileName.localeCompare(b.chunk.fileName) || a.chunk.chunkIndex - b.chunk.chunkIndex || a.order - b.order);
    const selected = (scored.length ? scored : chunks.slice(0, 8).map((chunk, order) => ({ chunk, order, score: 0 }))).slice(0, options.limit ?? 8);
    const evidence: KnowledgeEvidence[] = [];
    let remaining = options.maxChars ?? 7_000;
    for (const item of selected) {
        if (remaining <= 0) break;
        const citation = { documentId: item.chunk.documentId, fileName: item.chunk.fileName, chunkIndex: item.chunk.chunkIndex, chunkId: item.chunk.id };
        const prefix = `--- Referensi dari ${item.chunk.fileName} ---\n`;
        const text = `${prefix}${item.chunk.content}`.slice(0, remaining);
        evidence.push({ text, score: item.score, citation });
        remaining -= text.length + 2;
    }
    return { query, text: evidence.map((item) => item.text).join('\n\n'), evidence, citations: evidence.map((item) => item.citation) };
};
