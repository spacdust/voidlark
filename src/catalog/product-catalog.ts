import fs from 'node:fs';
import path from 'node:path';

export type VariationAxis = { id: string; name: string; values: string[] };
export type PriceOption = { values: Record<string, string>; price: number; weightGrams?: number; recommendationTags?: string[] };
export type PriceScheme = { id: string; name: string; aliases: string[]; domainRole?: string; variations: VariationAxis[]; options: PriceOption[] };
export type ProductCatalog = { version: 3; schemes: PriceScheme[] };

export const PRODUCT_CATALOG_PATH = path.resolve('config', 'product-catalog.json');

export const DEFAULT_PRODUCT_CATALOG: ProductCatalog = {
    version: 3,
    schemes: [],
};

const slug = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
const normalize = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const regexEscape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lastMention = (text: string, candidates: string[]) => candidates.reduce((latest, candidate) => {
    const index = normalize(text).lastIndexOf(normalize(candidate));
    return index > latest.index ? { index, value: candidate } : latest;
}, { index: -1, value: '' });
const lastAxisMention = (text: string, values: string[]) => values.reduce((latest, value) => {
    const aliases = [value, ...value.split(/[\/|]/).map((part) => part.trim()).filter((part) => part.length >= 2)];
    const match = lastMention(text, aliases);
    return match.index > latest.index ? { index: match.index, value } : latest;
}, { index: -1, value: '' });
export const priceSchemeId = (name: string) => slug(name) || `scheme-${Date.now()}`;
export const buildVariationCombinations = (variations: VariationAxis[]) => variations.reduce<Record<string, string>[]>((rows, axis) => rows.flatMap((row) => axis.values.map((value) => ({ ...row, [axis.id]: value }))), [{}]);

const migrateCatalog = (saved: any): ProductCatalog => ({
    version: 3,
    schemes: Array.isArray(saved?.schemes) ? saved.schemes.map((scheme: any) => ({
        id: String(scheme.id || priceSchemeId(String(scheme.name || 'skema'))),
        name: String(scheme.name || 'Skema harga'),
        aliases: Array.isArray(scheme.aliases)
            ? scheme.aliases.map(String).filter(Boolean)
            : [scheme.classification, scheme.id, scheme.name].map(String).filter((value) => value && value !== 'undefined'),
        ...(String(scheme.domainRole || '').trim() ? { domainRole: String(scheme.domainRole).trim() } : {}),
        variations: Array.isArray(scheme.variations) && scheme.variations.length
            ? scheme.variations.map((axis: any) => ({
                id: String(axis.id || priceSchemeId(String(axis.name || 'variasi'))),
                name: String(axis.name || 'Variasi'),
                values: Array.isArray(axis.values) ? [...new Set(axis.values.map(String).map((value: string) => value.trim()).filter(Boolean))] : [],
            })).filter((axis: VariationAxis) => axis.values.length)
            : [
                { id: 'quality', name: 'Kualitas', values: [...new Set((scheme.options || []).map((option: any) => String(option.quality || '').trim()).filter(Boolean))] },
                { id: 'size', name: 'Ukuran', values: [...new Set((scheme.options || []).map((option: any) => option.sizeMl ? `${option.sizeMl}ml` : '').filter(Boolean))] },
            ].filter((axis) => axis.values.length),
        options: Array.isArray(scheme.options) ? scheme.options.map((option: any) => ({
            values: option.values && typeof option.values === 'object'
                ? Object.fromEntries(Object.entries(option.values).map(([key, value]) => [String(key), String(value)]))
                : Object.fromEntries([
                    option.quality ? ['quality', String(option.quality)] : undefined,
                    option.sizeMl ? ['size', `${option.sizeMl}ml`] : undefined,
                ].filter(Boolean) as Array<[string, string]>),
            price: Number(option.price) || 0,
            ...(Number(option.weightGrams) > 0 ? { weightGrams: Number(option.weightGrams) } : {}),
            ...(Array.isArray(option.recommendationTags) && option.recommendationTags.map(String).map((value: string) => value.trim()).filter(Boolean).length
                ? { recommendationTags: [...new Set(option.recommendationTags.map(String).map((value: string) => value.trim()).filter(Boolean))] }
                : {}),
        })) : [],
    })) : [],
});

export const readProductCatalog = (): ProductCatalog => {
    if (!fs.existsSync(PRODUCT_CATALOG_PATH)) {
        fs.mkdirSync(path.dirname(PRODUCT_CATALOG_PATH), { recursive: true });
        fs.writeFileSync(PRODUCT_CATALOG_PATH, `${JSON.stringify(DEFAULT_PRODUCT_CATALOG, null, 2)}\n`);
    }
    return migrateCatalog(JSON.parse(fs.readFileSync(PRODUCT_CATALOG_PATH, 'utf8')));
};

export const writeProductCatalog = (catalog: ProductCatalog) => {
    fs.mkdirSync(path.dirname(PRODUCT_CATALOG_PATH), { recursive: true });
    const temp = `${PRODUCT_CATALOG_PATH}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(migrateCatalog(catalog), null, 2)}\n`);
    fs.renameSync(temp, PRODUCT_CATALOG_PATH);
};

const schemeMatches = (scheme: PriceScheme, value: string) => {
    const needle = normalize(value);
    return Boolean(needle) && [scheme.id, scheme.name, ...scheme.aliases].some((candidate) => {
        const normalized = normalize(candidate);
        return normalized === needle || normalized.includes(needle) || needle.includes(normalized);
    });
};

const sizeAxis = (scheme: PriceScheme) => scheme.variations.find((axis) => /^(?:ukuran|size|kapasitas|capacity)$/i.test(axis.name.trim()));
const smallestAxisValue = (axis?: VariationAxis) => {
    if (!axis?.values.length) return undefined;
    const numeric = axis.values.map((value, order) => ({ value, order, number: Number(value.match(/\d+(?:[.,]\d+)?/)?.[0].replace(',', '.')) }));
    return numeric.every((item) => Number.isFinite(item.number))
        ? numeric.sort((a, b) => a.number - b.number || a.order - b.order)[0].value
        : axis.values[0];
};
const missingVariationReply = (catalog: ProductCatalog) => {
    const names = [...new Set(catalog.schemes.flatMap((scheme) => scheme.variations.map((axis) => axis.name)))];
    return `Boleh pastikan ${names.length ? names.join(' dan ').toLowerCase() : 'pilihan variasinya'} dulu, Kak? Harga mengikuti kombinasi variasi pada katalog.`;
};

export const resolveCatalogOffer = (input: { classification?: string; attributes?: Record<string, string>; quality?: string; sizeMl?: number; quantity?: number }, catalog = readProductCatalog()) => {
    const legacyRequested = [input.quality, input.sizeMl ? `${input.sizeMl}ml` : undefined].filter(Boolean).map((value) => normalize(String(value)));
    const matchingOptions = (scheme: PriceScheme) => scheme.options.filter((item) => {
        const available = Object.values(item.values).map(normalize);
        const namedAttributesMatch = Object.entries(input.attributes || {}).every(([name, requestedValue]) => {
            const normalizedName = normalize(name);
            const axis = scheme.variations.find((candidate) => [candidate.id, candidate.name].some((value) => normalize(value) === normalizedName));
            if (!axis) return false;
            const actualValue = normalize(item.values[axis.id] || '');
            const needle = normalize(requestedValue);
            return actualValue === needle || actualValue.includes(needle) || needle.includes(actualValue);
        });
        return namedAttributesMatch && (Object.keys(input.attributes || {}).length > 0 || legacyRequested.length > 0)
            && legacyRequested.every((needle) => available.some((value) => value === needle || value.includes(needle) || needle.includes(value)));
    });
    const explicitScheme = input.classification ? catalog.schemes.find((scheme) => schemeMatches(scheme, input.classification || '')) : undefined;
    const inferred = catalog.schemes.map((scheme) => ({ scheme, options: matchingOptions(scheme) })).filter((entry) => entry.options.length === 1);
    const scheme = explicitScheme || (inferred.length === 1 ? inferred[0].scheme : undefined);
    if (!scheme) return { valid: false as const, error: explicitScheme ? 'Kombinasi variasi tidak tersedia.' : 'Kelompok harga belum jelas atau tidak ditemukan.' };
    if (Object.keys(input.attributes || {}).length > 0) {
        const suppliedNames = new Set(Object.keys(input.attributes || {}).map(normalize));
        const complete = scheme.variations.every((axis) => [axis.id, axis.name].some((name) => suppliedNames.has(normalize(name))));
        if (!complete) return { valid: false as const, error: 'Pilihan variasi belum lengkap.', scheme };
    }
    const options = matchingOptions(scheme);
    if (options.length !== 1) return { valid: false as const, error: options.length > 1 ? 'Pilihan variasi belum lengkap.' : 'Kombinasi variasi tidak tersedia.', scheme };
    const option = options[0];
    const quantity = Math.max(1, Number(input.quantity) || 1);
    return { valid: true as const, scheme, option, quantity, unitPrice: option.price, subtotal: option.price * quantity };
};

export const inferCatalogOfferFromText = (text: string, catalog = readProductCatalog()) => {
    const explicitSchemeMatch = catalog.schemes
        .map((scheme) => ({ scheme, match: lastMention(text, [scheme.id, scheme.name, ...scheme.aliases]) }))
        .sort((left, right) => right.match.index - left.match.index)[0];
    const candidates = (explicitSchemeMatch?.match.index ?? -1) >= 0
        ? [explicitSchemeMatch.scheme]
        : catalog.schemes.filter((scheme) => scheme.variations.every((axis) => lastAxisMention(text, axis.values).index >= 0));
    const resolved = candidates.map((scheme) => {
        const attributes = Object.fromEntries(scheme.variations.map((axis) => [axis.name, lastAxisMention(text, axis.values).value]));
        return resolveCatalogOffer({ classification: scheme.name, attributes }, catalog);
    }).filter((offer) => offer.valid);
    if (resolved.length !== 1) return null;
    const normalizedText = normalize(text);
    const quantityMatch = normalizedText.match(/(?:jumlah|qty|sebanyak|ambil|pesan)\s*(\d{1,4})\b|\b(\d{1,4})\s*(?:x|buah|botol|pcs|unit|paket|item)\b/g)?.at(-1);
    const wordQuantity = [...normalizedText.matchAll(/\b(satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh)\s*(?:buah|botol|pcs|unit|paket|item)\b/g)].at(-1)?.[1];
    const words: Record<string, number> = { satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10 };
    const quantity = quantityMatch ? Number(quantityMatch.match(/\d+/)?.[0]) : words[wordQuantity || ''] || 1;
    const offer = resolveCatalogOffer({ classification: resolved[0].scheme.name, attributes: Object.fromEntries(resolved[0].scheme.variations.map((axis) => [axis.name, resolved[0].option.values[axis.id]])), quantity }, catalog);
    return offer.valid ? offer : null;
};

export const inferCatalogPartialSelectionFromText = (text: string, catalog = readProductCatalog()) => {
    const normalizedText = normalize(text);
    const mentionedSchemes = catalog.schemes
        .map((scheme) => {
            const multiWord = [scheme.id, scheme.name, ...scheme.aliases].filter((value) => normalize(value).split(' ').length > 1);
            const direct = lastMention(text, multiWord);
            const axisMentioned = scheme.variations.some((axis) => axis.values.some((value) => lastAxisMention(text, [value]).index >= 0));
            const short = [scheme.id, scheme.name, ...scheme.aliases]
                .map(normalize)
                .filter((value) => value && !value.includes(' '))
                .map((value) => ({ value, index: normalizedText.lastIndexOf(value) }))
                .filter(({ value, index }) => index >= 0 && (axisMentioned
                    || new RegExp(`\\b(?:produk|jenis|tipe|versi|kelompok|kategori|harga|parfum)\\s+${regexEscape(value)}\\b|\\b${regexEscape(value)}\\s+(?:ukuran|kualitas|harga)\\b`, 'i').test(normalizedText)))
                .sort((left, right) => right.index - left.index)[0];
            return { scheme, match: direct.index >= (short?.index ?? -1) ? direct : { index: short?.index ?? -1, value: short?.value || '' } };
        })
        .filter(({ match }) => match.index >= 0)
        .sort((left, right) => right.match.index - left.match.index);
    if (mentionedSchemes.length > 1) return null;
    const candidates = mentionedSchemes.length ? [mentionedSchemes[0].scheme] : catalog.schemes;
    const matches = candidates.map((scheme) => {
        let mentionCount = 0;
        const attributes = Object.fromEntries(scheme.variations.flatMap((axis) => {
            const mentioned = axis.values
                .map((value) => ({ value, match: lastAxisMention(text, [value]) }))
                .filter(({ match }) => match.index >= 0)
                .sort((left, right) => right.match.index - left.match.index);
            mentionCount += mentioned.length;
            return mentioned.length === 1 ? [[axis.name, mentioned[0].value] as const] : [];
        }));
        return { classification: scheme.name, attributes, mentionCount };
    }).filter((item) => mentionedSchemes.length || item.mentionCount)
        .sort((left, right) => right.mentionCount - left.mentionCount);
    if (!matches.length || matches.length > 1 && matches[0].mentionCount === matches[1].mentionCount) return null;
    const { mentionCount: _mentionCount, ...selection } = matches[0];
    if (_mentionCount > Object.keys(selection.attributes).length) return null;
    return selection;
};

export const inferCatalogRecommendationFromText = (text: string, catalog = readProductCatalog()) => {
    const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((sentence) => sentence.trim()).filter(Boolean).reverse();
    for (const sentence of sentences) {
        const scheme = catalog.schemes
            .map((item) => ({ item, match: lastMention(sentence, [item.id, item.name, ...item.aliases]) }))
            .sort((a, b) => b.match.index - a.match.index)[0];
        if (!scheme || scheme.match.index < 0) continue;
        const recommendationLanguage = /\b(?:rekomendasi(?:kan|in)?|saran(?:ku)?|sarankan|cocoknya|sebaiknya|ambil)\b/i.test(sentence);
        const mentionedValues = scheme.item.variations.flatMap((axis) => axis.values.filter((value) => lastAxisMention(sentence, [value]).index >= 0));
        const allMentionedValues = scheme.item.variations.flatMap((axis) => axis.values.filter((value) => lastAxisMention(text, [value]).index >= 0));
        if (mentionedValues.length !== 1 || (!recommendationLanguage && allMentionedValues.length !== 1)) continue;
        const attributes = Object.fromEntries(scheme.item.variations.map((axis) => {
            const match = lastAxisMention(sentence, axis.values);
            return [axis.name, match.index >= 0 ? match.value : ''];
        }).filter(([, value]) => value));
        if (!Object.keys(attributes).length) continue;
        return { classification: scheme.item.name, attributes };
    }
    return null;
};

export const inferLatestCatalogClassificationFromText = (text: string, catalog = readProductCatalog()) => {
    const latest = catalog.schemes
        .map((scheme) => ({ scheme, match: lastMention(text, [scheme.id, scheme.name, ...scheme.aliases]) }))
        .sort((left, right) => right.match.index - left.match.index)[0];
    return latest && latest.match.index >= 0 ? latest.scheme.name : null;
};

export const buildCatalogClassificationReply = (prompt: string, activeClassification = '', productName = '', catalog = readProductCatalog()) => {
    if (!activeClassification || !/\b(?:masuk|termasuk|yang itu|itu)\b[\s\S]{0,45}\b(?:apa|mana|atau)\b|\b(?:inspired|karakter)\s+apa\s+(?:inspired|karakter)\b/i.test(prompt)) return null;
    const mentioned = catalog.schemes.filter((scheme) => lastMention(prompt, [scheme.id, scheme.name, ...scheme.aliases]).index >= 0);
    if (mentioned.length < 2) return null;
    const active = catalog.schemes.find((scheme) => schemeMatches(scheme, activeClassification));
    if (!active) return null;
    return `${productName ? `${productName} ` : ''}masuk ${active.name}, Kak. Jadi pilihan yang tadi tetap di kelompok ${active.name}; bukan ${mentioned.filter((scheme) => scheme !== active).map((scheme) => scheme.name).join(' atau ')}.`;
};

export const isCatalogVariationValue = (value: string, catalog = readProductCatalog()) => catalog.schemes
    .some((scheme) => scheme.variations.some((axis) => axis.values.some((item) => normalize(item) === normalize(value))));

export const inferCatalogOrdinalReference = (prompt: string, assistantHistory: string[], catalog = readProductCatalog()) => {
    const ordinal = normalize(prompt).match(/\byang (pertama|kedua|ketiga|terakhir)\b/)?.[1];
    if (!ordinal) return null;
    const index = { pertama: 0, kedua: 1, ketiga: 2 }[ordinal] ?? -1;
    for (const message of [...assistantHistory].reverse()) {
        for (const scheme of catalog.schemes) {
            const schemeMentioned = lastMention(message, [scheme.id, scheme.name, ...scheme.aliases]).index >= 0;
            const axes = scheme.variations.map((axis) => ({
                axis,
                mentions: axis.values.map((value) => ({ value, index: lastAxisMention(message, [value]).index })).filter((item) => item.index >= 0).sort((a, b) => a.index - b.index),
            })).filter((entry) => entry.mentions.length >= 2);
            const axis = axes[0];
            if (!axis || !schemeMentioned) continue;
            const selected = ordinal === 'terakhir' ? axis.mentions.at(-1) : axis.mentions[index];
            if (selected) return { classification: scheme.name, attributes: { [axis.axis.name]: selected.value } };
        }
    }
    return null;
};

export const inferOrdinalProductName = (prompt: string, assistantHistory: string[]) => {
    const ordinal = normalize(prompt).match(/\byang (pertama|kedua|ketiga|terakhir)\b/)?.[1];
    if (!ordinal) return null;
    const requestedIndex = { pertama: 0, kedua: 1, ketiga: 2 }[ordinal] ?? -1;
    for (const message of [...assistantHistory].reverse()) {
        const choices = [...message.matchAll(/(?:^|\s)(\d+)\.\s+(.+?)(?=\s+\d+\.\s+|$)/gs)]
            .map((match) => match[2].trim().split(/\s+[–—-]\s+|:\s+/)[0].trim().replace(/[.!]+$/, ''))
            .filter(Boolean);
        if (choices.length < 2) continue;
        return ordinal === 'terakhir' ? choices.at(-1) || null : choices[requestedIndex] || null;
    }
    return null;
};

export const parseCatalogBudget = (text: string) => {
    const match = normalize(text).match(/(?:budget(?:nya)?(?:\s+(?:jadi|naik(?:in)?|turun(?:in)?|mentok))?|maksimal|max|mentok|dibawah|di bawah)\s*(?:rp)?\s*(\d+(?:[.,]\d+)?)\s*(ribu|rb|juta|jt)?/i);
    if (!match) return null;
    const amount = Number(match[1].replace(',', '.'));
    return Math.round(amount * (/juta|jt/i.test(match[2] || '') ? 1_000_000 : /ribu|rb/i.test(match[2] || '') || amount < 1_000 ? 1_000 : 1));
};

const priceIntent = (text: string) => /\b(?:harga|berapa|berapaan|brp|total|selisih|budget)\b/i.test(text)
    && !/\b(?:ongkir|tahan berapa|berapa lama|berapa jam|berapa hari)\b/i.test(text);
const optionLabel = (scheme: PriceScheme, option: PriceOption) => scheme.variations.map((axis) => option.values[axis.id]).filter(Boolean).join(' ');
const optionPriceLines = (scheme: PriceScheme, options: PriceOption[]) => {
    const [groupAxis, ...detailAxes] = scheme.variations;
    const groups = groupAxis?.values
        .map((value) => ({ value, options: options.filter((option) => option.values[groupAxis.id] === value) }))
        .filter((group) => group.options.length) || [];
    const canGroup = detailAxes.length > 0 && groups.length > 1 && groups.every((group) => group.options.length > 1);
    if (!canGroup) return options.map((option) => `${optionLabel(scheme, option)}: ${rupiah(option.price)}`).join('\n');
    return groups.map((group) => [
        group.value,
        ...group.options.map((option) => `${detailAxes.map((axis) => option.values[axis.id]).filter(Boolean).join(' ')}: ${rupiah(option.price)}`),
    ].join('\n')).join('\n\n');
};

export const buildCatalogBudgetContext = (text: string, catalog = readProductCatalog()) => {
    const budget = parseCatalogBudget(text);
    if (!budget) return null;
    const options = catalog.schemes.flatMap((scheme) => scheme.options.map((option) => ({ scheme, option })))
        .filter(({ option }) => option.price <= budget)
        .sort((left, right) => left.option.price - right.option.price);
    const shown = options.slice(0, 12); // ponytail: cap prompt growth; add ranked pagination when catalogs routinely exceed 12 affordable combinations.
    const lines = shown.map(({ scheme, option }) => `${scheme.name} ${optionLabel(scheme, option)}: ${rupiah(option.price)}`);
    return {
        budget,
        options,
        evidence: `BUDGET CUSTOMER TERVERIFIKASI: maksimal ${rupiah(budget)}.\nPILIHAN HARGA DALAM BUDGET:\n${lines.join('\n') || 'Tidak ada kombinasi katalog dalam budget.'}`,
        fallback: options.length
            ? `Dengan budget maksimal ${rupiah(budget)}, pilihan harga yang tersedia:\n\n${lines.join('\n')}\n\nCeritakan kebutuhan utama Kakak supaya aku pilihkan satu yang paling cocok.`
            : `Belum ada pilihan katalog dengan harga maksimal ${rupiah(budget)}, Kak.`,
    };
};

export const hasCatalogSelectionLanguage = (text: string) => /\b(?:aku|saya|gue|kami)\s+(?:mau|pilih|ambil|pesan|order|ganti|jadi)|\b(?:ambil|bungkus|pesan|order|ganti|ubah|balik|jadinya|fix)\b|\bjadi\s+(?:\d{1,4}|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh)\s*(?:buah|botol|pcs|unit|paket|item)\b|\b(?:yang\s+)?(?:ini|itu|pertama|kedua|ketiga|terakhir)\s+(?:aja|saja|deh)|\b\w+\s+(?:aja|saja|deh)\b/i.test(text);
export const inferCatalogSelectionUpdateFromText = (text: string, previous?: { classification?: string; attributes?: Record<string, string> }, catalog = readProductCatalog()) => {
    if (/\b(?:beda(?:nya)?|selisih|banding(?:kan)?|versus|vs|sama|atau)\b/i.test(text)) return null;
    const direct = inferCatalogOfferFromText(text, catalog);
    const inquiryOnly = /[?]|\b(?:harga|berapa|berapaan|ready|stok|tersedia)\b/i.test(text);
    if (direct && (hasCatalogSelectionLanguage(text) || !inquiryOnly)) return direct;
    if (!hasCatalogSelectionLanguage(text) || !previous?.classification || !previous.attributes) return null;
    return inferCatalogOfferFromText([previous.classification, ...Object.values(previous.attributes), text].filter(Boolean).join(' '), catalog);
};

export const buildCatalogSelectionAcknowledgement = (offer: { scheme: PriceScheme; option: PriceOption; unitPrice: number; quantity: number; subtotal: number }, productName = '') => {
    const selection = [productName, offer.scheme.name, optionLabel(offer.scheme, offer.option)].filter(Boolean).join(' ');
    return offer.quantity > 1
        ? `Oke, Kak. Pilihannya sekarang ${selection}, ${offer.quantity} item. Harga satuan ${rupiah(offer.unitPrice)}, jadi subtotalnya ${rupiah(offer.subtotal)}.`
        : `Oke, Kak. Pilihannya sekarang ${selection}, harganya ${rupiah(offer.unitPrice)}.`;
};

const resolveComparison = (prompt: string, conversation: string, previous: { attributes?: Record<string, string>; classification?: string } | undefined, catalog: ProductCatalog) => {
    const schemes = previous?.classification
        ? catalog.schemes.filter((scheme) => schemeMatches(scheme, previous.classification || ''))
        : catalog.schemes;
    for (const scheme of schemes) {
        for (const axis of scheme.variations) {
            const requested = axis.values
                .map((value) => ({ value, index: lastAxisMention(prompt, [value]).index }))
                .filter((item) => item.index >= 0)
                .sort((a, b) => a.index - b.index);
            const previousValue = Object.entries(previous?.attributes || {}).find(([key]) => [axis.id, axis.name]
                .some((name) => normalize(name) === normalize(key)))?.[1];
            if (requested.length === 1 && previousValue && normalize(previousValue) !== normalize(requested[0].value)) {
                requested.push({ value: previousValue, index: Number.MAX_SAFE_INTEGER });
            }
            if (requested.length !== 2) continue;
            const fixed = Object.fromEntries(scheme.variations
                .filter((candidate) => candidate !== axis)
                .map((candidate) => {
                    const previousValue = Object.entries(previous?.attributes || {}).find(([key]) => [candidate.id, candidate.name].some((name) => normalize(name) === normalize(key)))?.[1];
                    const mentioned = lastAxisMention(conversation, candidate.values);
                    return [candidate.id, previousValue || (mentioned.index >= 0 ? mentioned.value : '')];
                }).filter(([, value]) => value));
            const candidates = requested.map(({ value }) => scheme.options.filter((option) => option.values[axis.id] === value
                && Object.entries(fixed).every(([id, expected]) => option.values[id] === expected)));
            const comparable = candidates[0].flatMap((first) => candidates[1]
                .filter((second) => scheme.variations.filter((candidate) => candidate !== axis)
                    .every((candidate) => first.values[candidate.id] === second.values[candidate.id]))
                .map((second) => [first, second] as const));
            if (comparable.length !== 1) {
                const missingAxes = scheme.variations.filter((candidate) => candidate !== axis && !fixed[candidate.id]);
                if (missingAxes.length === 1) return { missingReply: `Boleh pastikan ${missingAxes[0].name.toLowerCase()} yang mau dibandingkan, Kak? Setelah itu aku hitung selisih ${requested[0].value} dan ${requested[1].value}.` };
                return null;
            }
            const [first, second] = comparable[0];
            return { scheme, axis, first, second };
        }
    }
    return null;
};

const comparisonReply = (prompt: string, conversation: string, previous: { attributes?: Record<string, string>; classification?: string } | undefined, catalog: ProductCatalog) => {
    const resolved = resolveComparison(prompt, conversation, previous, catalog);
    if (!resolved) return null;
    if ('missingReply' in resolved) return resolved.missingReply;
    return `${resolved.scheme.name} ${optionLabel(resolved.scheme, resolved.first)} harganya ${rupiah(resolved.first.price)}, sedangkan ${optionLabel(resolved.scheme, resolved.second)} ${rupiah(resolved.second.price)}. Selisihnya ${rupiah(Math.abs(resolved.second.price - resolved.first.price))}, Kak.`;
};

export const buildCatalogComparisonAdvice = (prompt: string, comparisonPrompt: string, previous?: { attributes?: Record<string, string>; classification?: string }, catalog = readProductCatalog()) => {
    if (!/\b(?:kakak sendiri|menurut (?:kakak|kamu)|saran(?:nya|mu)?|rekomendasi(?:nya|mu)?|pilih(?: yang)? mana|enaknya mana)\b/i.test(prompt)) return null;
    const resolved = resolveComparison(comparisonPrompt, comparisonPrompt, previous, catalog);
    if (!resolved || 'missingReply' in resolved || !/^(?:ukuran|size|kapasitas|capacity)$/i.test(resolved.axis.name.trim())) return null;
    const cheaper = resolved.first.price <= resolved.second.price ? resolved.first : resolved.second;
    const pricier = cheaper === resolved.first ? resolved.second : resolved.first;
    const unchanged = resolved.scheme.variations
        .filter((axis) => axis !== resolved.axis)
        .map((axis) => cheaper.values[axis.id])
        .filter(Boolean)
        .join(' ');
    const stableDetail = unchanged ? `${unchanged} tetap sama seperti pilihan sebelumnya, tetapi ` : '';
    return `Kalau dari dua pilihan tadi, aku pilih ${optionLabel(resolved.scheme, cheaper)}, Kak. ${stableDetail}harganya ${rupiah(cheaper.price)} dan lebih hemat ${rupiah(pricier.price - cheaper.price)} daripada ${optionLabel(resolved.scheme, pricier)}. Kalau belum butuh ${resolved.axis.name.toLowerCase()} lebih besar, pilihan ini lebih masuk akal.`;
};

export const buildDeterministicPriceReply = (prompt: string, conversation: string, previous?: { unitPrice?: number; attributes?: Record<string, string>; classification?: string }, catalog = readProductCatalog()) => {
    const asksDiscount = /\b(?:diskon(?:nya)?|promo(?:nya)?|grosir)\b/i.test(prompt);
    if (!priceIntent(prompt) && !asksDiscount) return null;
    const budget = parseCatalogBudget(prompt);
    if (budget) {
        // Descriptive needs still need Knowledge-backed recommendation. Do not replace them with a raw price dump.
        const withoutBudget = normalize(prompt)
            .replace(/(?:budget|maksimal|max|dibawah|di bawah)\s*(?:rp)?\s*\d+(?:[.,]\d+)?\s*(?:ribu|rb|juta|jt)?/i, '')
            .replace(/\b(?:dapat|dapet|ada|apa|yang|buat|untuk|pilih|mana|kak|dong|aja|saja|an)\b/g, '')
            .trim();
        if (withoutBudget) return null;
        const matchingSchemes = previous?.classification
            ? catalog.schemes.filter((scheme) => schemeMatches(scheme, previous.classification || ''))
            : catalog.schemes;
        const options = matchingSchemes.flatMap((scheme) => scheme.options.map((option) => ({ scheme, option })))
            .filter(({ option }) => option.price <= budget)
            .sort((a, b) => a.option.price - b.option.price);
        if (!options.length) return `Belum ada pilihan dengan harga maksimal ${rupiah(budget)}, Kak.`;
        return `Dengan budget maksimal ${rupiah(budget)}, pilihan yang tersedia:\n\n${options.map(({ scheme, option }) => `${scheme.name} ${optionLabel(scheme, option)}: ${rupiah(option.price)}`).join('\n')}\n\nKakak mau pilih yang mana?`;
    }
    const promptOffer = inferCatalogOfferFromText(prompt, catalog);
    const asksDifference = /\b(?:selisih(?:nya)?|beda(?:nya)?|beda berapa)\b/i.test(prompt);
    if (asksDifference) {
        const comparison = comparisonReply(prompt, conversation, previous, catalog);
        if (comparison) return comparison;
    }
    const previousScheme = previous?.classification ? catalog.schemes.find((scheme) => schemeMatches(scheme, previous.classification || '')) : undefined;
    const asksSmallest = /\b(?:ukuran |botol )?(?:paling |pling )?kecil(?:nya)?\b/i.test(prompt);
    const explicitAllValue = /\b(?:semua|smua|seluruh|apa aja|apa saja)\b/i.test(prompt)
        ? catalog.schemes.flatMap((scheme) => (sizeAxis(scheme)?.values || []).map((value) => ({ scheme, value, index: lastAxisMention(prompt, [value]).index })))
            .filter((item) => item.index >= 0)
        : [];
    if (!previousScheme && explicitAllValue.length) {
        const ranked = catalog.schemes.map((scheme) => ({
            scheme,
            score: scheme.variations.filter((axis) => axis !== sizeAxis(scheme)).reduce((sum, axis) => sum + axis.values.filter((value) => lastAxisMention(conversation, [value]).index >= 0).length, 0),
        })).sort((left, right) => right.score - left.score);
        const inferredScheme = ranked[0]?.score > 0 && ranked[0].score > (ranked[1]?.score || 0) ? ranked[0].scheme : undefined;
        if (inferredScheme) {
            const axis = sizeAxis(inferredScheme);
            const requested = explicitAllValue.find((item) => item.scheme === inferredScheme)?.value;
            const options = requested && axis ? inferredScheme.options.filter((option) => option.values[axis.id] === requested) : [];
            if (options.length) return `${inferredScheme.name} ${axis?.name || 'Pilihan'} ${requested}:\n\n${options.map((option) => `${optionLabel(inferredScheme, option)}: ${rupiah(option.price)}`).join('\n')}\n\nDari pilihan ini, kualitas mana yang paling sesuai kebutuhan Kakak?`;
        }
    }
    if (!previousScheme && asksSmallest) {
        const groups = catalog.schemes.flatMap((scheme) => {
            const axis = sizeAxis(scheme);
            const smallest = smallestAxisValue(axis);
            if (!axis || !smallest) return [];
            const options = scheme.options.filter((option) => option.values[axis.id] === smallest);
            return options.length ? [{ scheme, axis, smallest, options }] : [];
        });
        if (groups.length) return `Ukuran paling kecil yang tersedia:\n\n${groups.map(({ scheme, axis, smallest, options }) => `${scheme.name}: ${axis.name} ${smallest}\n${options.map((option) => `${optionLabel(scheme, option)}: ${rupiah(option.price)}`).join('\n')}`).join('\n\n')}\n\nKakak sedang mempertimbangkan kelompok produk yang mana?`;
    }
    const previousSizeAxis = previousScheme ? sizeAxis(previousScheme) : undefined;
    const explicitSize = previousSizeAxis ? lastAxisMention(prompt, previousSizeAxis.values) : { index: -1, value: '' };
    const asksAllAtSize = explicitSize.index >= 0
        && /\b(?:semua|smua|seluruh|apa aja|apa saja)\b/i.test(prompt)
        && /\b(?:harga|berapa|berapaan)\b/i.test(prompt);
    if (previousScheme && asksAllAtSize) {
        const options = previousScheme.options.filter((option) => option.values[previousSizeAxis?.id || ''] === explicitSize.value);
        if (options.length) return `${previousScheme.name} ${previousSizeAxis?.name || 'Pilihan'} ${explicitSize.value}:\n\n${options.map((option) => `${optionLabel(previousScheme, option)}: ${rupiah(option.price)}`).join('\n')}\n\nDari pilihan ini, kualitas mana yang paling sesuai kebutuhan Kakak?`;
    }
    const smallestSize = previousScheme && asksSmallest
        ? smallestAxisValue(previousSizeAxis)
        : undefined;
    const explicitlyRequestedNonSizeValue = previousScheme?.variations
        .filter((axis) => axis !== previousSizeAxis)
        .some((axis) => axis.values.some((value) => lastAxisMention(prompt, [value]).index >= 0));
    if (previousScheme && smallestSize && !explicitlyRequestedNonSizeValue) {
        const options = previousScheme.options.filter((option) => Object.values(option.values).includes(smallestSize));
        const remainingAxes = previousScheme.variations.filter((axis) => axis !== previousSizeAxis);
        if (options.length) return `${previousScheme.name} ${previousSizeAxis?.name || 'Pilihan'} ${smallestSize}:\n\n${options.map((option) => `${optionLabel(previousScheme, option)}: ${rupiah(option.price)}`).join('\n')}\n\nKakak tertarik ${remainingAxes.map((axis) => axis.name).join(' dan ').toLowerCase() || 'pilihan'} yang mana?`;
    }
    const stateOffer = previous?.attributes
        ? inferCatalogOfferFromText([previous.classification, ...Object.values(previous.attributes), smallestSize, prompt].filter(Boolean).join(' '), catalog)
        : null;
    if (asksDifference && !promptOffer && !stateOffer) return missingVariationReply(catalog);
    const offer = promptOffer || stateOffer || inferCatalogOfferFromText(conversation, catalog);
    if (asksDiscount) {
        const normalPrice = offer ? ` Harga normal ${optionLabel(offer.scheme, offer.option)} adalah ${rupiah(offer.unitPrice)} per item.` : '';
        return `Info diskon atau harga grosir belum tercantum di katalog, Kak.${normalPrice} Penawaran khusus perlu dikonfirmasi ke admin.`;
    }
    if (offer && asksDifference && previous?.unitPrice && previous.unitPrice !== offer.unitPrice) {
        return `Harga pilihan sebelumnya ${rupiah(previous.unitPrice)}, sedangkan ${optionLabel(offer.scheme, offer.option)} ${rupiah(offer.unitPrice)}. Selisihnya ${rupiah(Math.abs(offer.unitPrice - previous.unitPrice))}, Kak.`;
    }
    if (!smallestSize && previousScheme && previous?.attributes && /\b(?:ukuran|pilihan).*(?:harga|berapa)|\bharga.*(?:ukuran|apa aja|semua)\b/i.test(prompt)) {
        const selected = Object.entries(previous.attributes).map(([name, value]) => {
            const axis = previousScheme.variations.find((candidate) => [candidate.id, candidate.name].some((label) => normalize(label) === normalize(name)));
            return axis ? [axis.id, value] as const : null;
        }).filter(Boolean) as Array<readonly [string, string]>;
        const options = previousScheme.options.filter((option) => selected.every(([id, value]) => normalize(option.values[id] || '') === normalize(value)));
        if (options.length) return `${previousScheme.name} ${selected.map(([, value]) => value).join(' ')}:\n\n${optionPriceLines(previousScheme, options)}\n\nKakak mau pilih yang mana?`;
    }
    if (!smallestSize && previousScheme && /\b(?:ukuran|pilihan).*(?:harga|berapa)|\bharga.*(?:ukuran|apa aja|semua)\b/i.test(prompt)) {
        return `${previousScheme.name}:\n\n${optionPriceLines(previousScheme, previousScheme.options)}\n\nKakak tertarik pilihan yang mana?`;
    }
    if (!smallestSize && /\b(?:ukuran|pilihan).*(?:harga|berapa)|\bharga.*(?:ukuran|apa aja|semua)\b/i.test(prompt)) {
        const partialMatches = catalog.schemes.flatMap((item) => {
            const mentioned = item.variations.flatMap((axis) => axis.values.filter((value) => lastAxisMention(conversation, [value]).index >= 0));
            if (!mentioned.length) return [];
            const latest = mentioned.map((value) => ({ value, index: lastAxisMention(conversation, [value]).index })).sort((a, b) => b.index - a.index)[0].value;
            const options = item.options.filter((option) => Object.values(option.values).includes(latest));
            return options.length ? [{ item, latest, options }] : [];
        }).sort((a, b) => lastAxisMention(conversation, [b.latest]).index - lastAxisMention(conversation, [a.latest]).index);
        const partial = partialMatches[0];
        if (partial) {
            const remainingAxes = partial.item.variations.filter((axis) => !Object.values(partial.options[0].values).includes(partial.latest) || partial.options.some((option) => option.values[axis.id] !== partial.latest));
            return `${partial.item.name} ${partial.latest}:\n\n${optionPriceLines(partial.item, partial.options)}\n\nKakak mau ${remainingAxes.at(-1)?.name.toLowerCase() || 'pilihan'} yang mana?`;
        }
    }
    if (offer) {
        const selection = `${offer.scheme.name} ${optionLabel(offer.scheme, offer.option)}`;
        if (/\b(?:total|jadi berapa)\b/i.test(prompt)) return `${selection} harganya ${rupiah(offer.unitPrice)} per item. Untuk ${offer.quantity} item, totalnya ${rupiah(offer.subtotal)}, Kak.`;
        if (/\b(?:ukuran )?(?:paling )?kecil(?:nya)?\b/i.test(prompt)) {
            const qualityValues = offer.scheme.variations
                .filter((axis) => axis !== sizeAxis(offer.scheme))
                .map((axis) => offer.option.values[axis.id])
                .filter(Boolean);
            const alternatives = offer.scheme.options.filter((option) => option !== offer.option
                && qualityValues.every((value) => Object.values(option.values).includes(value)));
            return `${selection} harganya ${rupiah(offer.unitPrice)} per item, Kak.${alternatives.length ? `\n\nUkuran lainnya dengan kualitas yang sama:\n${alternatives.map((option) => `${optionLabel(offer.scheme, option)}: ${rupiah(option.price)}`).join('\n')}` : ''}`;
        }
        return `${selection} harganya ${rupiah(offer.unitPrice)} per item, Kak.`;
    }
    const scheme = catalog.schemes
        .map((item) => ({ item, match: lastMention(conversation, [item.id, item.name, ...item.aliases]) }))
        .sort((a, b) => b.match.index - a.match.index)[0];
    if (scheme?.match.index >= 0 && /\b(?:harga.*(?:apa|semua)|ukuran.*harga|pilihan.*harga)\b/i.test(prompt)) {
        return `${scheme.item.name}:\n\n${optionPriceLines(scheme.item, scheme.item.options)}\n\nKakak tertarik pilihan yang mana?`;
    }
    if (/\b(?:selisih(?:nya)?|beda(?:nya)?|beda berapa)\b/i.test(prompt)) return missingVariationReply(catalog);
    return missingVariationReply(catalog);
};

export const buildCatalogShippingWeights = (catalog = readProductCatalog()) => {
    const labels: Record<string, number> = {};
    const valueWeights = new Map<string, Set<number>>();
    for (const scheme of catalog.schemes) {
        for (const option of scheme.options) {
            if (!option.weightGrams || option.weightGrams <= 0) continue;
            const combination = Object.values(option.values).join(' ');
            labels[combination] = option.weightGrams;
            for (const alias of [scheme.name, ...scheme.aliases]) labels[`${alias} ${combination}`] = option.weightGrams;
            for (const value of Object.values(option.values)) {
                const weights = valueWeights.get(value) || new Set<number>();
                weights.add(option.weightGrams);
                valueWeights.set(value, weights);
            }
        }
    }
    for (const [value, weights] of valueWeights) if (weights.size === 1) labels[value] = [...weights][0];
    return labels;
};

const rupiah = (value: number) => `Rp${value.toLocaleString('id-ID')}`;
export const buildCatalogEvidence = (_query = '', catalog = readProductCatalog()) => [
    'KELOMPOK HARGA TERSTRUKTUR (SUMBER KEBENARAN HARGA):',
    'Nama item dan detail produk berasal dari Knowledge. Jangan membatasi produk pada daftar di bawah karena daftar ini hanya aturan harga.',
    ...catalog.schemes.flatMap((scheme) => [
        `Kelompok ${scheme.name}; kode=${scheme.id}; dikenali sebagai=${scheme.aliases.join(', ') || scheme.name}${scheme.domainRole ? `; peran domain=${scheme.domainRole}` : ''}:`,
        `Variasi: ${scheme.variations.map((axis) => `${axis.name}=[${axis.values.join(', ')}]`).join('; ') || 'tanpa variasi'}`,
        ...scheme.options.map((option) => `- ${scheme.variations.map((axis) => `${axis.name}: ${option.values[axis.id] || '-'}`).join('; ')}; ${rupiah(option.price)}${option.weightGrams ? `; ${option.weightGrams}g` : ''}${option.recommendationTags?.length ? `; cocok untuk=${option.recommendationTags.join(', ')}` : ''}`),
    ]),
    'ATURAN: Tentukan kelompok harga dari klasifikasi produk di Knowledge, lalu cocokkan seluruh variasi yang dipilih. Pertahankan harga sepanjang riwayat kecuali pilihan berubah.',
].join('\n');
