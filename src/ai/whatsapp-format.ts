import { readProductCatalog } from '../catalog/product-catalog.js';

const PRICE_OPTION = /(?:-\s*)?(\d+\s*(?:ml|g|kg|pcs|botol|pak|pack)\s*(?:[-–—:]\s*)?Rp\s*\d+(?:\.\d{3})*(?:\s*\([^)]*\))?)/gi;
const regexEscape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const separateAdjacentVariationLabels = (text: string) => {
    const values = [...new Set(readProductCatalog().schemes.flatMap((scheme) => scheme.variations.flatMap((axis) => axis.values)))]
        .sort((left, right) => right.length - left.length);
    if (!values.length) return text;
    const alternatives = values.map(regexEscape).join('|');
    return text.replace(new RegExp(`\\b(${alternatives})\\s*[–—-]\\s*(?=(?:${alternatives})\\s*[–—-])`, 'gi'), '$1\n');
};

const separatePriceOptions = (text: string) => {
    const matches = [...text.matchAll(new RegExp(PRICE_OPTION.source, PRICE_OPTION.flags))];
    if (matches.length < 2) return text;
    const priceLines = text.split('\n').filter((line) => /\d+\s*(?:ml|g|kg|pcs|botol|pak|pack)\b.*\bRp\s*\d/i.test(line));
    if (priceLines.length === matches.length) return text;
    const separated = text
        .replace(PRICE_OPTION, '\n$1\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{2,}(?=\d+\s*(?:ml|g|kg|pcs|botol|pak|pack)\s*[-–—:])/gi, '\n')
        .replace(/\n{2,}(?=[^\n]+\n\d+\s*(?:ml|g|kg|pcs|botol|pak|pack)\s*(?:[-–—:]\s*)?Rp)/gi, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    const lines = separated.split('\n');
    const result: string[] = [];
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index].trim();
        if (!line) {
            result.push('');
            continue;
        }
        const followingSizeLines = lines.slice(index + 1).findIndex((candidate) => candidate.trim() && !/^\d+\s*(?:ml|g|kg|pcs|botol|pak|pack)\b/i.test(candidate.trim()));
        const sizeCount = (followingSizeLines < 0 ? lines.slice(index + 1) : lines.slice(index + 1, index + 1 + followingSizeLines))
            .filter((candidate) => /^\d+\s*(?:ml|g|kg|pcs|botol|pak|pack)\b/i.test(candidate.trim())).length;
        if (/^[^:,.!?]{2,40}$/.test(line) && sizeCount === 1 && /^\d+\s*(?:ml|g|kg|pcs|botol|pak|pack)\b/i.test(lines[index + 1]?.trim() || '')) {
            result.push(`${line} ${lines[index + 1].trim()}`);
            index++;
            continue;
        }
        result.push(line);
    }
    return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

export const formatWhatsAppReply = (text: string) => separatePriceOptions(separateAdjacentVariationLabels(text)
    .replace(/Maaf Kak,\s*[^.!?]*(?:belum|tidak)[^.!?]*(?:di sistem|di data[^.!?]*)\.\s*(?:Tapi|Namun)\s*/i, '')
    .replace(/^dari\b/, 'Dari')
    .replace(/Rp\s*(\d+)\.\s*\n+\s*(\d{3})\b/g, 'Rp$1.$2')
    .replace(/Rp\s*(\d+)\.\s+(\d{3})\b/g, 'Rp$1.$2')
    .replace(/^\s*[,;]\s*$/gm, '')
    .replace(/,\s*[,.]+/g, '.')
    .replace(/^[ \t]*Misalnya[,:]?[ \t]*(?:lebih suka[ \t]+)?(.+?\?)([ \t]+.*)?$/gim, (_line, choices: string, suffix = '') => `${/^terlalu\b/i.test(choices)
        ? `Yang kurang cocok itu ${choices}`
        : `Kakak lebih suka ${choices}`}${suffix}`)
    .replace(/([.!][ \t]+)Misalnya[,:]?[ \t]*(?:lebih suka[ \t]+)?([^?\n]+\?)/gi, '$1Kakak lebih suka $2')
    .replace(/\bSaya bantu cari(?:in|kan)\b/gi, 'Aku bantu carikan')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s*-\s+/gm, ''))
    .split('\n')
    .map((line) => line.replace(
        /^(\s*\d+\.\s+.*?[.!])\s+((?:Kak(?:ak)?|Kamu|Mau|Tertarik|Pilih|Ingin|Lebih suka|Kalau)\b.*)$/i,
        '$1\n\n$2',
    ))
    .join('\n')
    .replace(/\n{2,}(?=\d+\s*(?:ml|g|kg|pcs|botol|pak|pack)\b[^\n]*\bRp\s*\d)/gi, '\n');
