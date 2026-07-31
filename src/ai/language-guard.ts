const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const MOJIBAKE: Record<string, string> = {
    'â€”': '—', 'â€“': '–',
    'Ã¡': 'á', 'Ã¢': 'â', 'Ã¤': 'ä', 'Ã§': 'ç', 'Ã¨': 'è', 'Ã©': 'é', 'Ãª': 'ê', 'Ã«': 'ë',
    'Ã®': 'î', 'Ã¯': 'ï', 'Ã±': 'ñ', 'Ã´': 'ô', 'Ã¶': 'ö', 'Ã¹': 'ù', 'Ã»': 'û', 'Ã¼': 'ü',
};
const repairMojibake = (value: string) => Object.entries(MOJIBAKE).reduce((text, [broken, fixed]) => text.replaceAll(broken, fixed), value);

export const containsUnexpectedCjk = (value: string) => CJK_PATTERN.test(value);

export const sanitizeCustomerLanguage = (value: string) => repairMojibake(value)
    .replace(CJK_PATTERN, '')
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
