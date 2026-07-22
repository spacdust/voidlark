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
    relevancePercent?: number;
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

// Helper for N-Gram semantic character overlap for informal phrasing
const extractNGrams = (text: string, n = 3): Set<string> => {
    const clean = text.toLowerCase().replace(/[^a-z0-9]/g, '');
    const nGrams = new Set<string>();
    for (let i = 0; i <= clean.length - n; i++) {
        nGrams.add(clean.substring(i, i + n));
    }
    return nGrams;
};

const calculateSemanticSimilarity = (queryNGrams: Set<string>, contentNGrams: Set<string>): number => {
    if (!queryNGrams.size || !contentNGrams.size) return 0;
    let matchCount = 0;
    for (const gram of queryNGrams) {
        if (contentNGrams.has(gram)) matchCount++;
    }
    return matchCount / Math.max(queryNGrams.size, 1);
};

export const retrieveFromChunks = (chunks: RetrievalChunk[], query: string, options: { maxChars?: number; limit?: number } = {}): KnowledgeRetrievalResult => {
    const queryTerms = [...new Set(terms(query))];
    const queryNGrams = extractNGrams(query, 3);
    const documentFrequency = new Map<string, number>();

    for (const term of queryTerms) {
        documentFrequency.set(term, chunks.filter((chunk) => terms(chunk.content).includes(term)).length);
    }

    const scored = chunks.map((chunk, order) => {
        const words = terms(chunk.content);
        const counts = new Map<string, number>();
        for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);

        // BM25 Sparse Score
        const bm25Score = queryTerms.reduce((sum, term) => {
            const frequency = counts.get(term) || 0;
            if (!frequency) return sum;
            const inverseFrequency = Math.log(1 + (chunks.length + 1) / ((documentFrequency.get(term) || 0) + 1));
            return sum + (frequency / (frequency + 1.2)) * inverseFrequency;
        }, 0);

        // Semantic N-Gram Score
        const contentNGrams = extractNGrams(chunk.content, 3);
        const semanticScore = calculateSemanticSimilarity(queryNGrams, contentNGrams);

        // Hybrid Fusion Score (50% BM25 + 50% Semantic)
        const hybridScore = Number((bm25Score * 0.5 + semanticScore * 1.5).toFixed(8));

        return { chunk, order, score: hybridScore, bm25Score, semanticScore };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.chunk.fileName.localeCompare(b.chunk.fileName) || a.chunk.chunkIndex - b.chunk.chunkIndex || a.order - b.order);

    const selected = (scored.length ? scored : chunks.slice(0, 8).map((chunk, order) => ({ chunk, order, score: 0, bm25Score: 0, semanticScore: 0 }))).slice(0, options.limit ?? 8);
    const maxScoreFound = Math.max(...selected.map((s) => s.score), 0.00001);

    const evidence: KnowledgeEvidence[] = [];
    let remaining = options.maxChars ?? 7_000;

    for (const item of selected) {
        if (remaining <= 0) break;
        const relevancePercent = Math.min(99, Math.max(50, Math.round((item.score / maxScoreFound) * 98)));
        const citation: KnowledgeCitation = {
            documentId: item.chunk.documentId,
            fileName: item.chunk.fileName,
            chunkIndex: item.chunk.chunkIndex,
            chunkId: item.chunk.id,
            relevancePercent,
        };
        const prefix = `--- Referensi dari ${item.chunk.fileName} ---\n`;
        const text = `${prefix}${item.chunk.content}`.slice(0, remaining);
        evidence.push({ text, score: item.score, citation });
        remaining -= text.length + 2;
    }

    return { query, text: evidence.map((item) => item.text).join('\n\n'), evidence, citations: evidence.map((item) => item.citation) };
};
