import fs from 'node:fs';
import path from 'node:path';

export type ReplyStyleConfig = {
    salutation: string;
    replyLength: 'concise' | 'balanced' | 'detailed';
    sellingStyle: string;
    emojiLevel: string;
};

const DEFAULT_REPLY_STYLE: ReplyStyleConfig = { salutation: 'Kak', replyLength: 'balanced', sellingStyle: 'balanced', emojiLevel: 'light' };

export const getReplyStyleConfig = (): ReplyStyleConfig => {
    const file = path.resolve('prompt.builder.json');
    if (!fs.existsSync(file)) return { ...DEFAULT_REPLY_STYLE };
    try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        const replyLength = ['concise', 'balanced', 'detailed'].includes(saved.replyLength) ? saved.replyLength : DEFAULT_REPLY_STYLE.replyLength;
        return {
            salutation: String(saved.salutation || DEFAULT_REPLY_STYLE.salutation).trim() || DEFAULT_REPLY_STYLE.salutation,
            replyLength,
            sellingStyle: String(saved.sellingStyle || DEFAULT_REPLY_STYLE.sellingStyle),
            emojiLevel: String(saved.emojiLevel || DEFAULT_REPLY_STYLE.emojiLevel),
        };
    } catch {
        return { ...DEFAULT_REPLY_STYLE };
    }
};
