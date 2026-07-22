export interface ResponsePlan {
    bubbles: string[];
}

interface ResponsePlanOptions {
    maxBubbleChars?: number;
    maxBubbles?: number;
}

const FALLBACK_BUBBLE = 'Maaf Kak, aku belum bisa menyusun jawaban. Aku bantu teruskan ke admin ya.';

const splitSentences = (value: string) => value.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) || [];

const splitListItems = (section: string): string[] => {
    const listPattern = /^(\d+\.|[-*])\s+/;
    const lines = section.split('\n');
    const items: string[] = [];
    let current = '';
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        if (listPattern.test(trimmed)) {
            if (current) items.push(current.trim());
            current = trimmed;
        } else {
            current = current ? `${current} ${trimmed}` : trimmed;
        }
    }
    
    if (current) items.push(current.trim());
    return items;
};

export const buildResponsePlan = (answer: string, options: ResponsePlanOptions = {}): ResponsePlan => {
    const maxBubbleChars = options.maxBubbleChars ?? 420;
    const maxBubbles = options.maxBubbles ?? 3;
    const normalized = answer.replace(/\r\n/g, '\n').trim();
    if (!normalized) return { bubbles: [FALLBACK_BUBBLE] };

    // Step 1: Merge orphaned list markers with their content
    // Pattern: "text: 1." followed by blank line and content → "text:\n1. content"
    const mergedList = normalized.replace(/:\s*(\d+)\.\s*\n\s*\n+/g, ':\n$1. ');

    // Step 2: Normalize inline list items - split any sequence like "text) 2. next 3. another"
    // into separate lines for each numbered item
    const withSeparatedListItems = mergedList.replace(/([^\n])\s*(\d+)\.\s+/g, (match, before, num) => {
        // If this looks like the start of a list item (has non-whitespace before it),
        // add a newline before the number
        return `${before}\n${num}. `;
    });

    // Step 3: Split into sections, but detect list sections specially
    const sections = withSeparatedListItems.split(/\n\s*\n+/).map((section) => section.trim()).filter(Boolean);
    const candidates: string[] = [];
    
    for (const section of sections) {
        // Check if section contains numbered list items
        const hasListItems = /^\d+\.\s+/m.test(section);
        
        if (hasListItems) {
            // Find where the first list item starts
            const lines = section.split('\n').map(l => l.trim()).filter(Boolean);
            const firstListIndex = lines.findIndex(line => /^\d+\.\s+/.test(line));
            
            // Everything before first list item is intro
            const introLines = lines.slice(0, firstListIndex);
            const listLines = lines.slice(firstListIndex);
            
            // Process intro (text before list)
            if (introLines.length > 0) {
                const intro = introLines.join(' ');
                if (intro.length <= maxBubbleChars) {
                    candidates.push(intro);
                } else {
                    let current = '';
                    for (const sentence of splitSentences(intro)) {
                        if (!current || current.length + sentence.length + 1 <= maxBubbleChars) {
                            current = current ? `${current} ${sentence}` : sentence;
                        } else {
                            candidates.push(current);
                            current = sentence;
                        }
                    }
                    if (current) candidates.push(current);
                }
            }
            
            // Process each list item separately
            let currentItem = '';
            for (const line of listLines) {
                if (/^\d+\.\s+/.test(line)) {
                    // New list item - save previous one
                    if (currentItem) {
                        candidates.push(currentItem.trim());
                    }
                    currentItem = line;
                } else {
                    // Continuation of current item
                    currentItem = `${currentItem} ${line}`;
                }
            }
            // Don't forget the last item
            if (currentItem) {
                candidates.push(currentItem.trim());
            }
            
        } else {
            // Regular section (no list items)
            const normalized = section.replace(/\s+/g, ' ').trim();
            if (normalized.length <= maxBubbleChars) {
                candidates.push(normalized);
                continue;
            }
            let current = '';
            for (const sentence of splitSentences(normalized)) {
                if (!current || current.length + sentence.length + 1 <= maxBubbleChars) {
                    current = current ? `${current} ${sentence}` : sentence;
                } else {
                    candidates.push(current);
                    current = sentence;
                }
            }
            if (current) candidates.push(current);
        }
    }

    if (candidates.length <= maxBubbles) return { bubbles: candidates };
    
    // Check if candidates contain list items - if yes, preserve them separately
    const hasListItems = candidates.some(c => /^\d+\.\s+/.test(c));
    
    if (hasListItems) {
        // For list items, return all of them separately even if exceeds maxBubbles
        // This ensures each numbered item gets its own bubble
        return { bubbles: candidates };
    }
    
    // For non-list content, merge excess candidates
    return {
        bubbles: [
            ...candidates.slice(0, maxBubbles - 1),
            candidates.slice(maxBubbles - 1).join(' '),
        ],
    };
};
