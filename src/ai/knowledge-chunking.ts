export interface KnowledgeChunk {
    index: number;
    content: string;
    charStart: number;
    charEnd: number;
    tokenCount: number;
    metadata: { section: number };
}

export interface ChunkingOptions {
    maxChars?: number;
    overlapChars?: number;
    minChars?: number;
}

const normalizeText = (text: string) => text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
const estimateTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

const chooseEnd = (text: string, start: number, hardEnd: number, minChars: number) => {
    if (hardEnd >= text.length) return text.length;
    const window = text.slice(start + minChars, hardEnd);
    const boundaries = [window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('\n'), window.lastIndexOf(' ')];
    const boundary = Math.max(...boundaries);
    return boundary >= 0 ? start + minChars + boundary + (window.slice(boundary, boundary + 2) === '. ' ? 1 : 0) : hardEnd;
};

export const chunkKnowledgeText = (input: string, options: ChunkingOptions = {}): KnowledgeChunk[] => {
    const text = normalizeText(input);
    if (!text) return [];
    const maxChars = Math.max(256, options.maxChars ?? 1_600);
    const overlapChars = Math.min(Math.max(0, options.overlapChars ?? 160), Math.floor(maxChars / 3));
    const minChars = Math.min(Math.max(64, options.minChars ?? 400), maxChars);
    const chunks: KnowledgeChunk[] = [];
    let start = 0;
    let section = 0;
    while (start < text.length) {
        const end = chooseEnd(text, start, Math.min(text.length, start + maxChars), minChars);
        const content = text.slice(start, end).trim();
        if (content) chunks.push({ index: chunks.length, content, charStart: start, charEnd: end, tokenCount: estimateTokens(content), metadata: { section } });
        if (end >= text.length) break;
        const next = Math.max(start + 1, end - overlapChars);
        const paragraph = text.indexOf('\n\n', next);
        start = paragraph >= 0 && paragraph < end ? paragraph + 2 : next;
        section += 1;
    }
    return chunks;
};
