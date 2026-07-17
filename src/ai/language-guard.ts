const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;

export const containsUnexpectedCjk = (value: string) => CJK_PATTERN.test(value);

export const sanitizeCustomerLanguage = (value: string) => value
    .replace(CJK_PATTERN, '')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
