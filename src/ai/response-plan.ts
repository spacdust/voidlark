export interface ResponsePlan {
    bubbles: string[];
}

interface ResponsePlanOptions {
    maxBubbleChars?: number;
    maxBubbles?: number;
}

const FALLBACK_BUBBLE = 'Maaf Kak, aku belum bisa menyusun jawaban. Aku bantu teruskan ke admin ya.';

const splitSentences = (value: string) => value.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) || [];

export const buildResponsePlan = (answer: string, options: ResponsePlanOptions = {}): ResponsePlan => {
    const maxBubbleChars = options.maxBubbleChars ?? 420;
    const maxBubbles = options.maxBubbles ?? 3;
    const normalized = answer.replace(/\r\n/g, '\n').trim();
    if (!normalized) return { bubbles: [FALLBACK_BUBBLE] };

    const sections = normalized.split(/\n\s*\n+/).map((section) => section.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const candidates: string[] = [];
    for (const section of sections) {
        if (section.length <= maxBubbleChars) {
            candidates.push(section);
            continue;
        }
        let current = '';
        for (const sentence of splitSentences(section)) {
            if (!current || current.length + sentence.length + 1 <= maxBubbleChars) {
                current = current ? `${current} ${sentence}` : sentence;
            } else {
                candidates.push(current);
                current = sentence;
            }
        }
        if (current) candidates.push(current);
    }

    if (candidates.length <= maxBubbles) return { bubbles: candidates };
    return {
        bubbles: [
            ...candidates.slice(0, maxBubbles - 1),
            candidates.slice(maxBubbles - 1).join(' '),
        ],
    };
};
