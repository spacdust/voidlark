import { getReplyStyleConfig, type ReplyStyleConfig } from '../config/reply-style.js';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EMOJI = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu;

export const applyCustomerReplyStyle = (text: string, style: ReplyStyleConfig = getReplyStyleConfig()) => {
    const salutation = style.salutation.trim();
    let output = text;
    if (salutation && !/^kak(?:ak)?$/i.test(salutation)) {
        output = output
            .replace(/\bKakak\b/g, salutation)
            .replace(/\bkakak\b/g, salutation.toLowerCase())
            .replace(/\bKak\b/g, salutation)
            .replace(/\bkak\b/g, salutation.toLowerCase());
    }
    if (style.emojiLevel === 'none') output = output.replace(EMOJI, '');
    if (style.sellingStyle === 'soft') {
        output = output
            .replace(/\blangsung (?:checkout|pesan|beli)\b/gi, 'lanjutkan pilihan')
            .replace(/\bambil sekarang\b/gi, 'pilih jika sudah cocok');
    }
    const transactional = /(?:ringkasan pesanan|pesanan #|menunggu pembayaran|pembayaran|subtotal|ongkir|data checkout|admin akan melanjutkan)/i.test(output);
    if (style.sellingStyle === 'proactive' && !transactional && !/[?]\s*$/.test(output) && /(?:Rp\s?\d|harga|pilihan|produk)/i.test(output)) {
        output = `${output.trim()}\n\n${salutation || 'Kak'} mau lanjut ke pilihan yang paling cocok?`;
    }
    if (style.replyLength === 'concise' && !/^\s*\d+\.\s/m.test(output)) {
        const parts = output.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) || [];
        const question = [...parts].reverse().find((part) => part.endsWith('?'));
        const statement = parts.find((part) => !part.endsWith('?'));
        output = [statement, question && question !== statement ? question : ''].filter(Boolean).join('\n\n');
    }
    return output
        .replace(new RegExp(`(?:${escapeRegExp(salutation)}){2,}`, 'gi'), salutation)
        .replace(/[ \t]+\n/g, '\n')
        .replace(/ {2,}/g, ' ')
        .trim();
};
