import { readProductCatalog, type ProductCatalog } from '../catalog/product-catalog.js';
import { getReplyStyleConfig } from '../config/reply-style.js';
import { supportsFragranceCatalogSchema } from './product-domain.js';
import { getKnowledgeBase, refreshKnowledgeCache } from './knowledge.js';

export interface AromaProfile {
    notes: string[];
    families: string[];
}

export interface CatalogAroma {
    inspired: string;
    character: string;
    family: string;
}

export interface MatchedCatalogAroma extends CatalogAroma {
    score: number;
    matchedFamilies: string[];
}

export interface VerifiedFragranceReference {
    inspiredName: string;
    title: string;
    url: string;
    notes: string[];
    families: string[];
    audiences: Array<'women' | 'men'>;
    qualities: string[];
}

export type FragranceReferenceLookup = (inspiredName: string) => Promise<{ content: string; source?: string }>;

const NOTE_TERMS = ['pear', 'melon', 'green notes', 'cedarwood', 'moss', 'caramel', 'musk', 'bergamot', 'lemon', 'orange', 'apple', 'peach', 'jasmine', 'rose', 'amber', 'vanilla', 'sandalwood', 'patchouli', 'vetiver', 'oud'];
const NOTE_LABELS: Record<string, string> = {
    pear: 'pir', melon: 'melon', 'green notes': 'nuansa hijau', cedarwood: 'kayu cedar', moss: 'lumut', caramel: 'karamel', musk: 'musk',
    bergamot: 'bergamot', lemon: 'lemon', orange: 'jeruk', apple: 'apel', peach: 'persik', jasmine: 'melati', rose: 'mawar', amber: 'amber',
    vanilla: 'vanila', sandalwood: 'kayu cendana', patchouli: 'patchouli', vetiver: 'vetiver', oud: 'oud', kiwi: 'kiwi', litchi: 'leci', lychee: 'leci',
    quince: 'quince', chocolate: 'cokelat', 'white chocolate': 'cokelat putih', cupcake: 'cupcake', orchid: 'anggrek', violet: 'violet', geranium: 'geranium',
    'water lily': 'teratai air', waterlily: 'teratai air', berries: 'beri', 'red berries': 'beri merah', blueberry: 'bluberi', coconut: 'kelapa', tuberose: 'tuberose', freesia: 'freesia', cardamom: 'kapulaga', clove: 'cengkeh', coffee: 'kopi',
    pomegranate: 'delima', cinnamon: 'kayu manis', 'white amber': 'amber putih', 'lily-of-the-valley': 'lily of the valley',
    'black currant': 'blackcurrant', 'cotton flower': 'bunga kapas', 'water jasmine': 'melati air', 'brazilian rosewood': 'kayu mawar Brasil',
    'mandarin orange': 'jeruk mandarin', apricot: 'aprikot', saffron: 'saffron', amberwood: 'kayu amber', ambergris: 'ambergris',
    'orange flower petals': 'kelopak bunga jeruk', 'gaïac wood oil': 'kayu guaiac', 'guaiac wood oil': 'kayu guaiac',
    'clove oil': 'minyak cengkeh', chestnut: 'kastanye', 'cade oil': 'kayu cade',
};

const FAMILY_RULES: Array<[string, RegExp]> = [
    ['fresh', /\b(?:fresh|segar|citrus|fruity|aquatic|marine|ozonic|green notes|melon|pear|bergamot|lemon|orange|kiwi|litchi|lychee|quince|berries|water lily)\b/i],
    ['floral', /\b(?:floral|flower|jasmine|rose|magnolia|lily|orchid|violet|geranium|tuberose|freesia)\b/i],
    ['woody', /\b(?:woody|wood|cedarwood|sandalwood|patchouli|vetiver|oud|moss)\b/i],
    ['glamour', /\b(?:glamour|gourmand|sensual|elegan|elegant|mewah|malam|kondangan|anniversary|romantis|manis|musk|amber(?:wood|gris)?|saffron|caramel|vanilla|chocolate|cupcake|coffee)\b/i],
];

const normalizeFamily = (value: unknown) => String(value || '').trim().toLowerCase();
const normalizeIdentity = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
const squashIdentity = (value: string) => normalizeIdentity(value).replace(/\s+/g, '');
const phoneticIdentity = (value: string) => normalizeIdentity(value).replace(/ph/g, 'f').replace(/ch/g, 'k').replace(/y\b/g, 'i').replace(/c/g, 'k');
const REFERENCE_REJECTION = /\b(?:favorite perfume|favourite perfume|perfume (?:worn|wore) by|what perfume|celebrity fragrance|doesn['’]?t have a fragrance|does not have a fragrance|as far as i know|inspired makeup|perfume collection|perfumes? ranking|ranking and review|perfumes? review)\b/i;
const NOTE_CONTEXT = /\b(?:top|heart|middle|base) notes?\b|\bnotes?\s*(?:are|is|include|includes|as|:)\b|\bfragrance\s+(?:features|combines)\b/i;
const FRAGRANCE_CONTEXT = /\b(?:perfume|parfum|fragrance|cologne|eau de|scent)\b/i;
const GENERIC_NOTE_WORDS = /\b(?:top|heart|middle|base|notes?|accords?|fragrance|perfume|parfum|scent|opening|drydown)\b/gi;
const GENERIC_AROMA_DESCRIPTOR = /^(?:fresh|fruity|floral|woody|sweet|spicy|warm|clean|soft|strong|masculine|feminine|fresh and fruity|sweet woods?)$/i;

const parseExternalHits = (content: string) => [...content.matchAll(/^\d+\.\s+([^\n]+)\n\s+([^\n]+)\n\s+(https?:\/\/\S+)/gim)]
    .map((match) => ({ title: match[1].trim(), snippet: match[2].trim(), url: match[3].trim() }));

const editDistance = (left: string, right: string) => {
    const row = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
        let previous = row[0];
        row[0] = leftIndex;
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
            const current = row[rightIndex];
            row[rightIndex] = Math.min(row[rightIndex] + 1, row[rightIndex - 1] + 1, previous + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1));
            previous = current;
        }
    }
    return row[right.length];
};

const fuzzyTokenMatch = (needle: string, candidates: string[]) => candidates.some((candidate) => needle === candidate
    || /^(?:man|men|woman|women)$/.test(needle) && /^(?:man|men|woman|women)$/.test(candidate) && needle[0] === candidate[0]
    || needle.length >= 5 && candidate.length >= 5 && editDistance(needle, candidate) <= 1);

const removeContainedNotes = (notes: string[]) => notes.filter((note, index, all) => !all.some((candidate, candidateIndex) => candidateIndex !== index
    && candidate.length > note.length
    && new RegExp(`(?:^|\\s)${note.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s)`, 'i').test(candidate)));

const extractNoteNames = (text: string) => {
    const normalized = text.replace(/#+\s*/g, ' ').replace(/\bmid\s*:/gi, 'Middle Notes:').replace(/\btop\s*:/gi, 'Top Notes:').replace(/\bbase\s*:/gi, 'Base Notes:');
    const sections = [...normalized.matchAll(/(?:top|heart|middle|base)\s+notes?\s*(?:are|is|include|includes|of|:)?\s*(.+?)(?=\b(?:top|heart|middle|base)\s+notes?\b|[.;]|$)/gi)].map((match) => match[1]);
    if (!sections.length) {
        const general = normalized.match(/\bnotes?\s*(?:are|is|include|includes|as|:)\s*[“"]?([^.;\n”"]{2,180})/i)?.[1]
            || normalized.match(/\bfragrance\s+(?:features|combines)\s+([^.;\n]{2,180})/i)?.[1];
        if (general) sections.push(general);
    }
    const explicit = sections.flatMap((section) => section
        .replace(/\b(?:are|is)\b[\s\S]*$/i, '')
        .replace(/\bwhile\b[\s\S]*$/i, '')
        .replace(/\b(?:and|with|over)\b/gi, ',')
        .split(/[,/]/)
        .map((value) => value.replace(GENERIC_NOTE_WORDS, '').replace(/^(?:fresh|juicy|sweet|soft|warm|clean)\s*:\s*/i, '').replace(/^[\s:.-]+|[\s:.-]+$/g, '').trim().toLowerCase())
        .filter((value) => value.length >= 2 && value.length <= 40
            && !/^(?:the|a|an|one|mix|blend)$/i.test(value)
            && !/(?:-|\bof|\bthe)$/.test(value)
            && !/\b(?:i|it|like|quite|review|smells?|scent|perfume|fragrance)\b/i.test(value)));
    const noteEvidence = sections.join(', ');
    const known = Object.keys(NOTE_LABELS).filter((note) => new RegExp(`\\b${note.replace(/\s+/g, '\\s+')}\\b`, 'i').test(noteEvidence));
    return removeContainedNotes([...new Set([...explicit, ...known])]).slice(0, 14);
};

const extractReferenceAudiences = (text: string): Array<'women' | 'men'> => {
    const audiences: Array<'women' | 'men'> = [];
    if (/\b(?:for women|for her|women and men|woman|female|feminine)\b/i.test(text)) audiences.push('women');
    if (/\b(?:for men|for him|women and men|man|male|masculine)\b/i.test(text)) audiences.push('men');
    return audiences;
};

const requestedAudiences = (conversation: string): Array<'women' | 'men'> => {
    if (/\b(?:unisex|dipakai berdua|dipake berdua|pakai berdua|pake berdua)\b/i.test(conversation)) return ['women', 'men'];
    const audiences: Array<'women' | 'men'> = [];
    if (/\b(?:cewek|wanita|perempuan|istri|ibu|mama|bunda|female|women|woman)\b/i.test(conversation)) audiences.push('women');
    if (/\b(?:cowok|cwo|pria|laki(?:-laki)?|suami|ayah|bapak|papa|male|men|man)\b/i.test(conversation)) audiences.push('men');
    return audiences;
};

const audienceCompatible = (requested: Array<'women' | 'men'>, found: Array<'women' | 'men'>) => {
    if (!requested.length) return true;
    if (!found.length) return false;
    return requested.length === 2
        ? requested.every((audience) => found.includes(audience))
        : requested.some((audience) => found.includes(audience));
};

const extractReferenceQualities = (text: string) => [
    /\b(?:sweet|gourmand|vanilla|caramel|chocolate|honey|sugar|amber|tonka|cinnamon)\b/i.test(text) ? 'sweet' : '',
    /\b(?:soft|gentle|delicate|powdery|smooth|lembut|cotton flower|musk|iris)\b/i.test(text) ? 'soft' : '',
].filter(Boolean);

const rejectsSweet = (conversation: string) => /\b(?:tidak|nggak|gak|ga|jangan|kurang)\s+(?:suka\s+)?(?:yang\s+)?(?:terlalu\s+)?(?:manis|sweet|gourmand|vanila|vanilla|karamel|cokelat)\b/i.test(conversation);
const requestedQualities = (conversation: string) => [
    !rejectsSweet(conversation) && /\b(?:manis|sweet|gourmand|vanila|vanilla|karamel|cokelat)\b/i.test(conversation) ? 'sweet' : '',
    /\b(?:lembut|soft|gentle)\b/i.test(conversation) ? 'soft' : '',
].filter(Boolean);

const identityMatches = (inspiredName: string, title: string, snippet: string) => {
    const combined = normalizeIdentity(`${title} ${snippet}`);
    const titleTokens = normalizeIdentity(title).split(' ').filter((token) => token.length >= 3);
    const combinedTokens = combined.split(' ').filter((token) => token.length >= 3);
    const compounds = titleTokens.flatMap((token, index) => [token, `${token}${titleTokens[index + 1] || ''}`]).filter(Boolean);
    const tokens = normalizeIdentity(inspiredName).split(' ').filter((token) => token.length >= 3);
    if (!tokens.length) return false;
    const phoneticCandidates = [...combinedTokens, ...compounds].map(phoneticIdentity);
    const allTokensMatch = tokens.every((token) => fuzzyTokenMatch(token, [...combinedTokens, ...compounds]) || fuzzyTokenMatch(phoneticIdentity(token), phoneticCandidates));
    if (!allTokensMatch) return false;
    const primaryTitle = normalizeIdentity(title.split(/\s+by\s+|\s+[|:-]\s+/i)[0]);
    const primaryTokens = primaryTitle.split(' ').filter((token) => token.length >= 3);
    return squashIdentity(title).startsWith(squashIdentity(inspiredName))
        || tokens.some((token) => fuzzyTokenMatch(token, primaryTokens) || fuzzyTokenMatch(phoneticIdentity(token), primaryTokens.map(phoneticIdentity)));
};

export const extractVerifiedFragranceReference = (
    inspiredName: string,
    externalReference: string,
    requirements: { audiences?: Array<'women' | 'men'>; qualities?: string[] } = {},
): VerifiedFragranceReference | null => {
    const matches: Array<VerifiedFragranceReference & { score: number; index: number }> = [];
    let index = 0;
    for (const hit of parseExternalHits(externalReference)) {
        index += 1;
        const evidence = `${hit.title}. ${hit.snippet}`;
        if (!identityMatches(inspiredName, hit.title, hit.snippet) || REFERENCE_REJECTION.test(evidence)) continue;
        if (!FRAGRANCE_CONTEXT.test(evidence) || !NOTE_CONTEXT.test(evidence)) continue;
        const notes = extractNoteNames(evidence);
        if (!notes.length) continue;
        const concreteNotes = notes.filter((note) => !GENERIC_AROMA_DESCRIPTOR.test(note)).length;
        const structureScore = /\b(?:top|heart|middle|base) notes?\b/i.test(evidence)
            ? 6
            : /\bfragrance\s+(?:features|combines)\b/i.test(evidence)
                ? 4
                : 1;
        const audiences = extractReferenceAudiences(evidence);
        const qualities = extractReferenceQualities(evidence);
        if (!audienceCompatible(requirements.audiences || [], audiences)) continue;
        if ((requirements.qualities || []).some((quality) => !qualities.includes(quality))) continue;
        const audienceScore = requirements.audiences?.length && audiences.length
            ? requirements.audiences.every((audience) => audiences.includes(audience)) ? 4 : 0
            : 0;
        matches.push({ inspiredName, title: hit.title, url: hit.url, notes, families: extractAromaProfile(evidence).families, audiences, qualities, score: concreteNotes * 2 + structureScore + audienceScore, index });
    }
    const best = matches.sort((left, right) => right.score - left.score || left.index - right.index)[0];
    if (!best) return null;
    const { score: _score, index: _index, ...reference } = best;
    return reference;
};

const noteLabel = (note: string) => NOTE_LABELS[note] || note;
const naturalNoteList = (notes: string[], preferredFamilies: string[] = [], maxItems = 12, preferredContext = '') => {
    const normalizedContext = normalizeIdentity(preferredContext);
    const priority = (note: string) => preferredFamilies.reduce((score, family, index) => {
        const familyPattern = FAMILY_RULES.find(([name]) => name === family)?.[1];
        return score + (familyPattern?.test(note) ? preferredFamilies.length - index : 0);
    }, ` ${normalizedContext} `.includes(` ${normalizeIdentity(note)} `) || ` ${normalizedContext} `.includes(` ${normalizeIdentity(noteLabel(note))} `) ? 100 : 0);
    const labels = [...new Set(notes)]
        .map((note, index) => ({ note, index, priority: priority(note) }))
        .sort((left, right) => right.priority - left.priority || left.index - right.index)
        .slice(0, maxItems)
        .map(({ note }) => noteLabel(note));
    if (labels.length <= 1) return labels[0] || '';
    if (labels.length === 2) return `${labels[0]} dan ${labels[1]}`;
    return `${labels.slice(0, -1).join(', ')}, dan ${labels.at(-1)}`;
};

const audienceNameScore = (candidate: CatalogAroma, requested: Array<'women' | 'men'>) => {
    if (!requested.length) return 0;
    const name = normalizeIdentity(`${candidate.inspired} ${candidate.character}`);
    const women = /\b(?:woman|women|female|girl|lady|her)\b/.test(name);
    const men = /\b(?:man|men|male|boy|him)\b/.test(name);
    if (requested.length === 2) return women || men ? -1 : 1;
    if (requested[0] === 'women') return women ? 2 : men ? -2 : 0;
    return men ? 2 : women ? -2 : 0;
};

const fragranceGroups = (catalog = readProductCatalog()) => {
    const schemes = catalog.schemes;
    const reference = schemes.find((scheme) => scheme.domainRole === 'reference');
    const modified = schemes.find((scheme) => scheme.domainRole === 'modified');
    return { inspired: reference?.name, character: modified?.name, reference, modified };
};
const schemeMentioned = (text: string, scheme?: { id: string; name: string; aliases: string[] }) => Boolean(scheme && [scheme.id, scheme.name, ...scheme.aliases]
    .some((value) => normalizeIdentity(text).includes(normalizeIdentity(value))));
const customerFamilyLabel = (family: string, conversation: string) => family !== 'glamour'
    ? family
    : /\b(?:manis|sweet|vanilla|caramel)\b/i.test(conversation)
        ? 'manis'
        : /\b(?:elegan|mewah|malam|anniversary|romantis)\b/i.test(conversation)
            ? 'elegan'
            : family;
const verifiedClaimBlock = (evidence: string) => evidence.match(/KLAIM PRODUK TERVERIFIKASI:[\s\S]*?(?=\n[A-Z][A-Z ]{4,}:|$)/i)?.[0] || '';
const regexEscape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const valueAliases = (value: string) => [...new Set([value, ...value.split(/[\/|]/).map((part) => part.trim()).filter((part) => part.length >= 2)])]
    .sort((left, right) => right.length - left.length);
const percentageFor = (value: string, evidence: string) => {
    const claims = verifiedClaimBlock(evidence);
    for (const alias of valueAliases(value)) {
        const match = claims.match(new RegExp(`(?:^|[^\\p{L}\\p{N}])${regexEscape(alias)}(?:$|[^\\p{L}\\p{N}])[^.\\n]{0,100}?(\\d{1,3})%`, 'iu'));
        if (match) return Number(match[1]) || 0;
    }
    return 0;
};
const claimNoteCount = (group: string, evidence: string) => Number(verifiedClaimBlock(evidence)
    .match(new RegExp(`${regexEscape(group)}[^.\\n]{0,100}?(\\d+)\\s+notes?`, 'i'))?.[1]) || 0;
const claimLineFor = (subject: string, evidence: string) => verifiedClaimBlock(evidence)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-•]\s*/, '').trim())
    .find((line) => normalizeIdentity(line).startsWith(normalizeIdentity(subject))) || '';
const normalizedTokens = (value: string) => new Set(normalizeIdentity(value).split(' ').filter((token) => token.length >= 3));
const recommendationScore = (conversation: string, tags: string[] = []) => {
    const need = normalizedTokens(conversation);
    return tags.reduce((score, tag) => score + [...normalizedTokens(tag)].filter((token) => need.has(token)).length, 0);
};
const fragrancePriceProfile = (catalog = readProductCatalog()) => {
    const groups = fragranceGroups(catalog);
    const scheme = groups.reference;
    if (!scheme) return { groups, levels: [] as Array<{ value: string; averagePrice: number; recommendationTags: string[] }> };
    const axis = scheme.variations.find((candidate) => candidate.values.some((value) => !/\d/.test(value))) || scheme.variations[0];
    const levels = (axis?.values || []).map((value) => {
        const prices = scheme.options.filter((option) => option.values[axis.id] === value).map((option) => option.price);
        const recommendationTags = scheme.options
            .filter((option) => option.values[axis.id] === value)
            .flatMap((option) => option.recommendationTags || []);
        return { value, averagePrice: prices.reduce((sum, price) => sum + price, 0) / Math.max(1, prices.length), recommendationTags: [...new Set(recommendationTags)] };
    }).sort((left, right) => left.averagePrice - right.averagePrice);
    return { groups, levels };
};

export const buildVerifiedFragranceConsultationReply = (prompt: string, conversation: string, evidence: string, catalog?: ProductCatalog) => {
    if (/\b(?:pasangan(?:nya)?|nama\s+(?:karakter|asli|inspired)|aslinya|acuannya)\b/i.test(prompt)) return null;
    const claims = verifiedClaimBlock(evidence);
    if (!claims) return null;
    const { groups, levels: priceLevels } = fragrancePriceProfile(catalog);
    if (!groups.inspired || !groups.character || !groups.reference || !groups.modified) return null;
    const salutation = getReplyStyleConfig().salutation;
    const asksDifference = /\b(?:beda|bedanya|perbedaan|banding|bingung)\b/i.test(prompt);
    const educationalFamilies = [
        /\b(?:fresh|segar)\b/i.test(prompt) ? 'fresh' : '',
        /\bfloral\b|\bbunga\b/i.test(prompt) ? 'floral' : '',
        /\bwoody\b|\bkayu\b/i.test(prompt) ? 'woody' : '',
    ].filter(Boolean);
    if (educationalFamilies.length >= 2 && asksDifference) {
        const descriptions: Record<string, string> = {
            fresh: 'kesannya ringan dan segar. Arah ini bisa muncul dari nuansa buah, citrus, aquatic, atau green, tergantung susunan aromanya',
            floral: 'fokusnya bunga-bungaan, misalnya mawar, melati, atau lily. Kesannya bisa lembut sampai kaya dan elegan',
            woody: 'fokusnya kayu-kayuan, misalnya cedarwood, sandalwood, vetiver, atau patchouli. Kesannya cenderung hangat dan lebih dalam',
        };
        return `Gampangnya begini, ${salutation}:\n\n${educationalFamilies.map((family, index) => `${index + 1}. ${family[0].toUpperCase()}${family.slice(1)}: ${descriptions[family]}.`).join('\n\n')}\n\nKalau sering dipakai saat cuaca panas, arah fresh biasanya paling mudah dijadikan titik awal. Setelah itu baru aku saring lagi sesuai selera manis, audience, dan budget.`;
    }
    if (requestedAudiences(prompt).length && rejectsSweet(prompt)) {
        return `Siap, ${salutation}. Berarti rekomendasinya perlu nyaman untuk cuaca panas dan sisi manisnya harus dihindari. Aku akan menyaring pilihan berdasarkan audience serta profil aroma yang tersedia, bukan sekadar nama variannya.\n\nDari fresh, floral, dan woody yang tadi dibahas, ${salutation} paling tertarik ke arah mana?`;
    }
    if (/\b(?:fresh|segar|green|hijau|floral|woody)\b/i.test(prompt) && rejectsSweet(prompt)) {
        const requested = extractAromaProfile(prompt).families.filter((family) => family !== 'glamour');
        const direction = requested.map((family) => customerFamilyLabel(family, prompt)).join(' dan ') || 'segar';
        return `Siap, ${salutation}. Berarti arahnya ${direction}, sementara sisi manisnya perlu dihindari. Aku akan menyaring nama produk dari katalog berdasarkan keluarga aroma itu dan mengecek profil parfum acuannya bila detail notes dibutuhkan.\n\nKalau kebutuhan pemakaian dan budget sudah disebutkan, aku bisa langsung pilihkan satu yang paling masuk akal.`;
    }
    const referenceNotes = claimNoteCount(groups.inspired, claims);
    const modifiedNotes = claimNoteCount(groups.character, claims);
    if (asksDifference && schemeMentioned(prompt, groups.reference) && schemeMentioned(prompt, groups.modified) && referenceNotes && modifiedNotes) {
        const referenceClaim = claimLineFor(groups.inspired, claims);
        const modifiedClaim = claimLineFor(groups.character, claims);
        if (referenceClaim && modifiedClaim) return `Bedanya ada di susunan aromanya, ${salutation}.\n\n1. ${referenceClaim}\n\n2. ${modifiedClaim}\n\nDari perbedaan yang tercantum itu, ${salutation} lebih tertarik ke yang mana?`;
    }

    const mentionedLevels = priceLevels.filter(({ value }) => valueAliases(value).some((alias) => normalizeIdentity(prompt).includes(normalizeIdentity(alias))));
    if (asksDifference && mentionedLevels.length >= 2) {
        const levels = priceLevels.map(({ value, averagePrice }) => ({ value, averagePrice, percentage: percentageFor(value, claims) }))
            .filter((item) => item.percentage)
            .sort((left, right) => left.percentage - right.percentage || left.averagePrice - right.averagePrice);
        if (levels.length === priceLevels.length) {
            const order = levels.map((item) => item.value).join(', ').replace(/, ([^,]+)$/, ', lalu $1');
            return `Bedanya terutama di konsentrasi bibitnya, ${salutation}.\n\n${levels.map((item, index) => `${index + 1}. ${item.value} — ${item.percentage}% bibit.`).join('\n\n')}\n\nJadi urutannya dari konsentrasi paling rendah ke paling tinggi adalah ${order}. Kalau ${salutation} kasih tahu parfumnya dipakai untuk apa, aku bisa bantu pilih satu yang paling masuk akal.`;
        }
    }

    const asksUsageChoice = /\b(?:enaknya mana|pilih mana|paling cocok)\b/i.test(prompt);
    const hasSpecificAromaNeed = /\b(?:fresh|segar|manis|sweet|floral|bunga|woody|kayu|glamour|citrus|vanilla|amber)\b/i.test(prompt);
    const hasBudget = /\b(?:budget|maksimal|di bawah|dibawah)\b[^.!?\n]{0,30}\d/i.test(prompt);
    const dailyLevel = priceLevels
        .map((level) => ({ ...level, score: recommendationScore(conversation, level.recommendationTags) }))
        .filter((level) => level.score > 0)
        .sort((left, right) => right.score - left.score || left.averagePrice - right.averagePrice)[0];
    const dailyPercentage = dailyLevel ? percentageFor(dailyLevel.value, claims) : 0;
    if ((asksUsageChoice || hasBudget) && !hasSpecificAromaNeed && dailyLevel && dailyPercentage && referenceNotes) {
        const groupClaim = claimLineFor(groups.inspired, claims);
        const levelClaim = claimLineFor(dailyLevel.value, claims);
        if (groupClaim && levelClaim) return `Untuk kebutuhan yang tadi disebutkan, aku lebih condong ke ${groups.inspired} level ${dailyLevel.value}, ${salutation}. Pilihan ini mengikuti kecocokan penggunaan yang diatur pada Produk & Harga.\n\n${groupClaim}\n\n${levelClaim}\n\nUntuk aromanya, ${salutation} lebih suka fresh, manis, floral, atau woody?`;
    }
    if (/\b(?:cwo|cowok|pria|laki-laki)\b/i.test(prompt) && /\b(?:kalem|lembut|nggak nyolot|tidak mencolok)\b/i.test(prompt)) {
        return `Bisa aku bantu carikan, ${salutation}. Supaya nggak asal memilih dari label cowok, aku cocokkan dari karakter aroma dan kebutuhan pemakaiannya.\n\nParfumnya lebih sering dipakai untuk kuliah, kantor, harian, atau acara tertentu?`;
    }
    if (/\b(?:cwo|cowok|pria|laki-laki)\b/i.test(prompt) && /\b(?:murah|terjangkau|hemat|budget)\b/i.test(prompt)) {
        return `Ada pilihan yang bisa disesuaikan, ${salutation}. Supaya nggak asal memberi label cowok atau menyebut varian yang belum cocok, aku saring dari karakter aroma dan batas harganya.\n\nBudget maksimalnya berapa?`;
    }
    if (/\b(?:terlalu manis|kemanisan|bikin eneg|buat eneg)\b/i.test(prompt)) {
        return `Paham, ${salutation}. Berarti arah manisnya kita hindari dulu supaya rekomendasi berikutnya nggak mengulang masalah yang sama.\n\nAku bisa arahkan ke keluarga fresh yang lebih segar atau woody yang lebih berkayu. ${salutation} lebih condong ke fresh atau woody?`;
    }
    return null;
};

export const extractAromaProfile = (reference: string): AromaProfile => {
    const lower = reference.toLowerCase();
    const notes = NOTE_TERMS.filter((note) => lower.includes(note));
    const explicitFamily = [...reference.matchAll(/\b(fresh|fruity|floral|woody|gourmand|oriental|amber)\s+fragrance\b/gi)]
        .map((match) => /gourmand|oriental|amber/i.test(match[1]) ? 'glamour' : /fruity/i.test(match[1]) ? 'fresh' : match[1].toLowerCase());
    const inferredFamilies = FAMILY_RULES.filter(([, pattern]) => pattern.test(reference)).map(([family]) => family);
    const families = [...new Set([...explicitFamily, ...inferredFamilies])]
        .filter((family) => family !== 'glamour' || !rejectsSweet(reference));
    return { notes, families };
};

export const matchCatalogCandidates = (profile: AromaProfile, catalog: CatalogAroma[], limit = 3): MatchedCatalogAroma[] => {
    const familyPriority = new Map(profile.families.map((family, index) => [normalizeFamily(family), profile.families.length - index]));
    return catalog
        .map((item) => {
            const family = normalizeFamily(item.family);
            const matchedFamilies = familyPriority.has(family) ? [family] : [];
            // Product names identify rows; they are not notes evidence.
            const score = familyPriority.get(family) || 0;
            return { ...item, family, score, matchedFamilies };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.inspired.localeCompare(b.inspired))
        .slice(0, limit);
};

export const buildVerifiedFragranceRecommendation = async (prompt: string, conversation: string, classification = '', lookupReference?: FragranceReferenceLookup) => {
    const explicitRequest = /\b(?:rekomendasi(?:kan|in)?|paling aman|pilih(?:kan)? satu|pilih(?: yang)? mana|kasih dua|dua pilihan|enaknya mana|paling cocok)\b/i.test(prompt);
    const completedNeed = /\b(?:cari|butuh|mau|ada|buat)\b/i.test(conversation)
        && /\b(?:fresh|segar|floral|bunga|woody|kayu|elegan|manis|lembut|glamour|kuat|ringan|kalem)\b/i.test(prompt);
    if (!explicitRequest && !completedNeed) return null;
    const profile = extractAromaProfile(conversation);
    const audienceNeed = requestedAudiences(conversation);
    const qualityNeed = requestedQualities(conversation);
    const avoidSweet = rejectsSweet(conversation);
    const candidates = matchCatalogCandidates(profile, await loadCatalogAromas(), 12)
        .filter((candidate) => !avoidSweet || !/\b(?:vanila|vanilla|caramel|karamel|chocolate|cokelat|honey|gourmand|sweet)\b/i.test(`${candidate.inspired} ${candidate.character}`));
    if (!candidates.length) return null;
    const groups = fragranceGroups();
    const style = getReplyStyleConfig();
    const salutation = style.salutation;
    const useCharacter = schemeMentioned(classification, groups.modified);
    const group = useCharacter ? groups.character : groups.inspired;
    if (!group) return null;
    const count = /\b(?:kasih )?dua(?: pilihan)?\b/i.test(prompt) ? 2 : 1;
    const presentedName = (candidate: CatalogAroma) => useCharacter ? candidate.character : candidate.inspired;
    const uniquePresentedCandidates = (items: MatchedCatalogAroma[]) => [...new Map(items
        .filter((candidate) => presentedName(candidate))
        .map((candidate) => [normalizeIdentity(presentedName(candidate)), candidate] as const)).values()];
    const lookupCandidates = [...candidates].sort((left, right) => audienceNameScore(right, audienceNeed) - audienceNameScore(left, audienceNeed)
        || right.score - left.score
        || left.inspired.localeCompare(right.inspired));
    let selectedCandidates = uniquePresentedCandidates(lookupCandidates).slice(0, count);
    const references = new Map<string, VerifiedFragranceReference>();
    const lookupSources = new Set<string>();
    if (lookupReference) {
        const inspected: Array<{ candidate: MatchedCatalogAroma; reference: VerifiedFragranceReference; overlap: number; qualityOverlap: number; audienceScore: number }> = [];
        const lookupLimit = audienceNeed.length || qualityNeed.length || count > 1 ? 12 : 5;
        for (const candidate of lookupCandidates.slice(0, lookupLimit)) { // ponytail: bounded provider usage; replace with a pre-indexed profile store when catalog scale exceeds this ceiling.
            const result = await lookupReference(candidate.inspired);
            if (result.source) lookupSources.add(result.source);
            const reference = extractVerifiedFragranceReference(candidate.inspired, result.content, { audiences: audienceNeed, qualities: qualityNeed });
            if (!reference || avoidSweet && reference.qualities.includes('sweet')) continue;
            if (!audienceCompatible(audienceNeed, reference.audiences)) continue;
            if (qualityNeed.some((quality) => !reference.qualities.includes(quality))) continue;
            const overlap = profile.families.filter((family) => reference.families.includes(family)).length;
            const qualityOverlap = qualityNeed.filter((quality) => reference.qualities.includes(quality)).length;
            const audienceScore = audienceNeed.length && reference.audiences.length
                ? audienceNeed.every((audience) => reference.audiences.includes(audience)) ? 2 : 1
                : 0;
            inspected.push({ candidate, reference, overlap, qualityOverlap, audienceScore });
            const complete = overlap >= profile.families.length && qualityOverlap >= qualityNeed.length && (!audienceNeed.length || audienceScore === 2);
            if (count === 1 && complete) break;
            if (count > 1 && inspected.filter((item) => item.overlap >= profile.families.length && item.qualityOverlap >= qualityNeed.length && (!audienceNeed.length || item.audienceScore === 2)).length >= count) break;
        }
        const ranked = inspected.sort((left, right) => right.overlap - left.overlap
            || right.qualityOverlap - left.qualityOverlap
            || right.audienceScore - left.audienceScore
            || right.candidate.score - left.candidate.score
            || left.candidate.inspired.localeCompare(right.candidate.inspired));
        if (audienceNeed.length && !ranked.length) return null;
        if (ranked.length) {
            selectedCandidates = uniquePresentedCandidates([...ranked.map((item) => item.candidate), ...lookupCandidates]).slice(0, count);
            for (const item of ranked) references.set(item.candidate.inspired, item.reference);
        }
    }
    const names = [...new Map(selectedCandidates
        .map(presentedName)
        .filter(Boolean)
        .map((name) => [name.toLowerCase().replace(/[^a-z0-9]+/g, ''), name] as const)).values()].slice(0, count);
    if (!names.length) return null;
    const family = selectedCandidates[0].family;
    const secondaryNeed = profile.families.find((item) => item !== family);
    const familyLabel = customerFamilyLabel(family, conversation);
    const secondaryLabel = secondaryNeed ? customerFamilyLabel(secondaryNeed, conversation) : '';
    const primaryReference = references.get(selectedCandidates[0].inspired);
    const referenceDetail = primaryReference
        ? useCharacter
            ? style.replyLength === 'concise'
                ? ` Acuannya ${selectedCandidates[0].inspired}, dengan arah notes ${naturalNoteList(primaryReference.notes, profile.families)}. Racikan akhirnya tidak harus identik.`
                : ` ${names[0]} memakai ${selectedCandidates[0].inspired} sebagai acuan. Profil parfum acuannya memuat ${naturalNoteList(primaryReference.notes, profile.families)}. Karena versi ${groups.character} dapat dimodifikasi, notes akhirnya bisa lebih berlapis dari acuan tersebut.`
            : style.replyLength === 'concise'
                ? ` Arah notes aslinya ${naturalNoteList(primaryReference.notes, profile.families)}.`
                : ` Arah parfum aslinya memuat ${naturalNoteList(primaryReference.notes, profile.families)}, jadi alasan rekomendasinya bukan hanya label ${familyLabel}.`
        : secondaryNeed
            ? ` Sisi ${familyLabel}-nya paling jelas cocok. Referensi notes yang cukup kuat untuk memastikan nuansa ${secondaryLabel} belum ditemukan.`
            : '';
    const choiceDetail = (candidate: MatchedCatalogAroma, name: string) => {
        const reference = references.get(candidate.inspired);
        if (!reference) return `${name} — keluarga ${familyLabel}.`;
        const notes = naturalNoteList(reference.notes, profile.families);
        return useCharacter
            ? `${name} — keluarga ${familyLabel}. Memakai ${candidate.inspired} sebagai acuan; profil acuannya memuat ${notes}. Versi ${groups.character} dapat dimodifikasi, jadi susunannya tidak harus identik.`
            : `${name} — keluarga ${familyLabel}, dengan arah notes ${notes}.`;
    };
    const text = names.length === 1
        ? `Kalau fokusnya aroma ${familyLabel}, aku paling mengarah ke ${names[0]} dari ${group}, ${salutation}. Dari daftar yang tersedia, varian ini paling dekat karena masuk keluarga ${familyLabel}.${referenceDetail}`
        : `Aku pilihkan dua biar nggak bikin bingung, ${salutation}. Keduanya paling dekat dengan arah ${familyLabel} yang dicari:\n\n${selectedCandidates.slice(0, names.length).map((candidate, index) => `${index + 1}. ${choiceDetail(candidate, names[index])}`).join('\n\n')}\n\nDari dua ini, mana yang paling menarik?`;
    return { text, classification: group, productNames: names, references: [...references.values()], lookupSources: [...lookupSources] };
};

export const buildVerifiedExternalFragranceMatch = async (externalName: string, externalReference: string, lookupReference: FragranceReferenceLookup, request = '') => {
    const external = extractVerifiedFragranceReference(externalName, externalReference);
    const profile = external ? { notes: external.notes, families: external.families } : extractAromaProfile(externalReference);
    const candidates = matchCatalogCandidates(profile, await loadCatalogAromas(), 12);
    const ranked: Array<{ candidate: MatchedCatalogAroma; reference: VerifiedFragranceReference; noteOverlap: string[]; familyOverlap: string[]; source?: string }> = [];
    for (const candidate of candidates) {
        const result = await lookupReference(candidate.inspired);
        const reference = extractVerifiedFragranceReference(candidate.inspired, result.content);
        if (!reference) continue;
        const noteOverlap = profile.notes.filter((note) => reference.notes.some((candidateNote) => normalizeIdentity(candidateNote) === normalizeIdentity(note)));
        const familyOverlap = profile.families.filter((family) => reference.families.includes(family));
        if (!noteOverlap.length && !familyOverlap.length) continue;
        ranked.push({ candidate, reference, noteOverlap, familyOverlap, source: result.source });
    }
    const ordered = ranked.sort((left, right) => right.noteOverlap.length - left.noteOverlap.length
        || right.familyOverlap.length - left.familyOverlap.length
        || right.candidate.score - left.candidate.score
        || left.candidate.character.localeCompare(right.candidate.character));
    if (!ordered.length || profile.notes.length && !ordered.some((item) => item.noteOverlap.length)) return null;
    const groups = fragranceGroups();
    if (!groups.character) return null;
    const wantsOne = /\b(?:satu pilihan|pilih(?:kan)? satu|satu aja|satu saja)\b/i.test(request);
    const picked: typeof ordered = [];
    const primary = ordered.find((item) => item.noteOverlap.length) || ordered[0];
    picked.push(primary);
    if (!wantsOne) {
        const remaining = ordered.filter((item) => normalizeIdentity(item.candidate.character) !== normalizeIdentity(primary.candidate.character));
        for (const item of remaining) {
            if (picked.some((selected) => normalizeFamily(selected.candidate.family) === normalizeFamily(item.candidate.family))) continue;
            picked.push(item);
            if (picked.length >= 3) break;
        }
        for (const item of remaining) {
            if (picked.length >= 3) break;
            if (picked.some((selected) => normalizeIdentity(selected.candidate.character) === normalizeIdentity(item.candidate.character))) continue;
            picked.push(item);
        }
    }
    const usedAngles = new Set<string>();
    const assignedFamilies = picked.map((item, index) => {
        if (index === 0) return normalizeFamily(item.candidate.family) || item.familyOverlap[0] || item.reference.families[0] || '';
        const options = [normalizeFamily(item.candidate.family), ...item.reference.families, ...item.familyOverlap].filter(Boolean);
        const family = options.find((value) => !usedAngles.has(value)) || options[0] || '';
        if (family) usedAngles.add(family);
        return family;
    });
    const angle = (item: typeof ordered[number], index: number) => {
        if (index === 0) return 'Paling mendekati';
        const family = assignedFamilies[index];
        if (family) return `Alternatif yang lebih ${customerFamilyLabel(family, externalReference)}`;
        return `Alternatif dengan sentuhan ${noteLabel(item.noteOverlap[0])}`;
    };
    const lines = picked.map((item, index) => {
        const shared = naturalNoteList(item.noteOverlap, profile.families, 4);
        const family = assignedFamilies[index];
        const reason = shared
            ? `${item.candidate.inspired} memiliki kesamaan pada notes ${shared} dengan ${externalName}`
            : `Sisi ${customerFamilyLabel(family, externalReference)} pada ${item.candidate.inspired} terlihat dari notes seperti ${naturalNoteList(item.reference.notes, [family], 4)}`;
        return `${index + 1}. ${item.candidate.character} - ${angle(item, index)}. ${reason}. Karena ${item.candidate.character} merupakan racikan berbeda, hasil akhirnya tidak akan persis sama dengan ${externalName}.`;
    });
    const text = picked.length === 1
        ? `Kalau mau satu pilihan, aku paling merekomendasikan ${picked[0].candidate.character}, Kak. ${picked[0].candidate.inspired} memiliki kesamaan pada notes ${naturalNoteList(picked[0].noteOverlap, profile.families, 4)} dengan ${externalName}. Karena ${picked[0].candidate.character} merupakan racikan berbeda, hasil akhirnya tidak akan persis sama dengan ${externalName}.`
        : `Aku menemukan ${picked.length} pilihan dari katalog yang notes-nya mendekati ${externalName}, Kak:\n\n${lines.join('\n\n')}\n\nKalau Kakak mau, aku bisa bantu pilihkan satu berdasarkan sisi aroma yang paling disukai.`;
    return {
        text,
        productName: picked.length === 1 ? picked[0].candidate.character : undefined,
        productNames: picked.map((item) => item.candidate.character),
        classification: groups.character,
        reference: picked[0].reference,
        lookupSources: [...new Set(picked.map((item) => item.source).filter((source): source is string => Boolean(source)))],
    };
};

export const buildExternalFragranceIntroductionReply = (externalName: string, externalReference: string) => {
    const reference = extractVerifiedFragranceReference(externalName, externalReference);
    if (!reference) return null;
    const notes = naturalNoteList(reference.notes, reference.families, 7);
    return `${externalName} belum ada di katalog kami, Kak. Berdasarkan hasil pencarianku, ${externalName} punya beberapa notes utama seperti ${notes}.\n\nKalau Kakak mau, aku bisa carikan hingga tiga parfum dari katalog kami yang notes-nya paling mendekati ${externalName}. Mau aku carikan?`;
};

export const resolveCatalogFragranceProduct = async (text: string, classification = '') => {
    const normalized = normalizeIdentity(text);
    const rows = await loadCatalogAromas();
    const matches = rows.flatMap((item) => [
        { item, side: 'inspired' as const, name: item.inspired },
        { item, side: 'character' as const, name: item.character },
    ]).filter(({ name }) => {
        const identity = normalizeIdentity(name);
        return identity && ` ${normalized} `.includes(` ${identity} `);
    }).sort((left, right) => right.name.length - left.name.length);
    if (!matches.length) return null;
    const longest = matches[0].name.length;
    const exact = matches.filter((match) => match.name.length === longest);
    if (exact.length !== 1) return null;
    const groups = fragranceGroups();
    const match = exact[0];
    const asksCharacter = /\b(?:pasangan(?:nya)?|versi)\s+karakter\b|\bversi\s+karakter\s+pasangan(?:nya)?\b|\bnama\s+karakter(?:nya)?\b/i.test(text);
    const asksInspired = /\b(?:nama asli(?:nya)?|parfum asli(?:nya)?|acuan(?:nya)?|versi inspired|nama inspired(?:nya)?)\b/i.test(text);
    const side = asksCharacter ? 'character' : asksInspired ? 'inspired' : match.side;
    const productName = side === 'character' ? match.item.character : match.item.inspired;
    const resolvedClassification = side === 'character' ? groups.character : groups.inspired;
    if (!productName || !resolvedClassification) return null;
    return { productName, classification: resolvedClassification, pair: match.item, requestedRelation: asksCharacter || asksInspired };
};

export const buildCatalogFragranceRelationReply = async (prompt: string, contextProduct = '', classification = '') => {
    if (!/\b(?:pasangan(?:nya)?|nama\s+(?:karakter|asli|inspired)|aslinya|acuannya)\b/i.test(prompt)) return null;
    const resolved = await resolveCatalogFragranceProduct(`${contextProduct} ${prompt}`, classification);
    if (!resolved) return null;
    const groups = fragranceGroups();
    const asksCharacter = /\b(?:pasangan(?:nya)?|versi)\s+karakter\b|\bversi\s+karakter\s+pasangan(?:nya)?\b|\bnama\s+karakter(?:nya)?\b/i.test(prompt);
    if (asksCharacter) return {
        text: `${resolved.pair.character} adalah nama ${groups.character}, Kak. Pasangan ${groups.inspired}-nya adalah ${resolved.pair.inspired}.`,
        productName: resolved.pair.character,
        classification: groups.character || resolved.classification,
        switchSelection: true,
    };
    return {
        text: `${resolved.pair.inspired} adalah nama ${groups.inspired} atau parfum acuannya, Kak. Nama ${groups.character}-nya ${resolved.pair.character}.`,
        productName: resolved.pair.inspired,
        classification: groups.inspired || resolved.classification,
        switchSelection: false,
    };
};

export const buildCatalogFragranceDetailReply = async (prompt: string, classification: string, lookupReference?: FragranceReferenceLookup, recommendationContext = '') => {
    if (!lookupReference || !/\b(?:notes?|aroma(?:nya)?|wanginya|profil|karakter aromanya)\b/i.test(prompt)) return null;
    const normalizedPrompt = normalizeIdentity(prompt);
    const catalog = await loadCatalogAromas();
    const named = catalog.flatMap((item) => [item.inspired, item.character].map((name) => ({ item, name: normalizeIdentity(name) })))
        .filter(({ name }) => name && ` ${normalizedPrompt} `.includes(` ${name} `))
        .sort((left, right) => right.name.length - left.name.length);
    if (!named.length) return null;
    const longest = named[0].name.length;
    const matches = [...new Map(named.filter(({ name }) => name.length === longest).map(({ item }) => [`${normalizeIdentity(item.inspired)}|${normalizeIdentity(item.character)}`, item])).values()];
    if (matches.length !== 1) return null;
    const item = matches[0];
    const salutation = getReplyStyleConfig().salutation;
    const groups = fragranceGroups();
    if (!groups.inspired || !groups.character) return null;
    const result = await lookupReference(item.inspired);
    const asksCharacter = schemeMentioned(classification, groups.modified) || normalizedPrompt.includes(normalizeIdentity(item.character));
    const reference = extractVerifiedFragranceReference(item.inspired, result.content);
    if (!reference) {
        const text = asksCharacter
            ? `${item.character} dikembangkan dari profil ${item.inspired}, ${salutation}. Detail notes ${item.inspired} yang cukup jelas belum ditemukan, jadi aku belum bisa merinci aromanya tanpa berisiko salah.`
            : `Referensi notes ${item.inspired} yang cukup jelas belum ditemukan, ${salutation}. Aku belum bisa merinci susunannya tanpa berisiko salah.`;
        const resolvedClassification = asksCharacter ? groups.character : groups.inspired;
        if (!resolvedClassification) return null;
        return { text, productName: asksCharacter ? item.character : item.inspired, classification: resolvedClassification, reference: null, lookupSource: result.source };
    }
    const text = asksCharacter
        ? `${item.character} dikembangkan dari profil ${item.inspired}, ${salutation}. Beberapa notes utama ${item.inspired} adalah ${naturalNoteList(reference.notes, [item.family], 7, recommendationContext)}. Racikannya sudah dimodifikasi, jadi susunan akhirnya bisa berbeda dan tidak persis sama dengan ${item.inspired}.`
        : `${item.inspired} punya beberapa notes utama seperti ${naturalNoteList(reference.notes, [item.family], 7, recommendationContext)}, ${salutation}. Jadi profilnya tidak hanya diketahui dari keluarga aroma ${customerFamilyLabel(item.family, prompt)}, tetapi juga dari susunan notes parfum aslinya.`;
    const resolvedClassification = asksCharacter ? groups.character : groups.inspired;
    if (!resolvedClassification) return null;
    return { text, productName: asksCharacter ? item.character : item.inspired, classification: resolvedClassification, reference, lookupSource: result.source };
};

export const buildCatalogFragranceSuitabilityReply = async (prompt: string, productName: string, classification: string, lookupReference?: FragranceReferenceLookup) => {
    if (!lookupReference || !productName || !/\b(?:cocok|pas|aman)\b/i.test(prompt) || !/\b(?:kuliah|kantor|ngantor|harian|sekolah|malam|kondangan|pesta|pria|cowok|wanita|cewek)\b/i.test(prompt)) return null;
    const resolved = await resolveCatalogFragranceProduct(productName, classification);
    if (!resolved) return null;
    const result = await lookupReference(resolved.pair.inspired);
    const audiences = requestedAudiences(prompt);
    const reference = extractVerifiedFragranceReference(resolved.pair.inspired, result.content, { audiences });
    if (audiences.length && !reference) return null;
    const scheme = readProductCatalog().schemes.find((item) => schemeMentioned(classification || resolved.classification, item));
    const selectedSize = scheme?.variations.find((axis) => /^(?:ukuran|size|kapasitas|capacity)$/i.test(axis.name.trim()));
    const sizeValue = selectedSize?.values.find((value) => normalizeIdentity(prompt).includes(normalizeIdentity(value)));
    const eligibleOptions = scheme?.options.filter((option) => !sizeValue || option.values[selectedSize?.id || ''] === sizeValue) || [];
    const usageOption = scheme ? selectFragranceBudgetOption(eligibleOptions.map((option) => ({ option })), prompt)?.option : undefined;
    const audienceText = audiences.length === 1 && reference
        ? `Parfum acuannya, ${resolved.pair.inspired}, tercatat untuk ${audiences[0] === 'men' ? 'pria' : 'wanita'}. Karena ${resolved.productName} merupakan versi modifikasi, profil akhirnya tidak harus identik.`
        : '';
    const usageText = usageOption
        ? `Dari pengaturan pemakaian pada Produk & Harga, kualitas ${Object.values(usageOption.values).join(' ')} paling sesuai dengan kebutuhan ${/\bkuliah\b/i.test(prompt) ? 'kuliah' : /\b(?:kantor|ngantor)\b/i.test(prompt) ? 'kantor' : /\bharian\b/i.test(prompt) ? 'harian' : 'yang disebutkan'}.`
        : 'Kecocokan kualitas spesifik belum bisa dipastikan dari data yang tersedia.';
    return { text: `${productName} bisa dipertimbangkan, Kak. ${audienceText}\n\n${usageText}`, lookupSource: result.source };
};

export const selectFragranceBudgetOption = <T extends { option: { values: Record<string, string>; price: number; recommendationTags?: string[] } }>(options: T[], conversation: string): T | undefined => {
    if (!options.length) return undefined;
    const ranked = options.map((item) => ({ item, score: recommendationScore(conversation, item.option.recommendationTags) }));
    const bestScore = Math.max(...ranked.map(({ score }) => score));
    return ranked
        .filter(({ score }) => score === bestScore)
        .sort((left, right) => left.item.option.price - right.item.option.price)[0]?.item;
};

let catalogCache: { source: string; rows: CatalogAroma[] } | null = null;

export const loadCatalogSchemaRows = async (): Promise<unknown[][]> => {
    if (!getKnowledgeBase()) await refreshKnowledgeCache();
    const rows = getKnowledgeBase().split(/\r?\n/).filter((line) => line.includes('\t')).map((line) => line.split('\t'));
    return supportsFragranceCatalogSchema(rows) ? rows : [];
};

export const loadCatalogAromas = async (): Promise<CatalogAroma[]> => {
    const source = getKnowledgeBase();
    if (catalogCache?.source === source) return catalogCache.rows;
    const rows = await loadCatalogSchemaRows();
    if (!supportsFragranceCatalogSchema(rows)) return [];
    const entries: CatalogAroma[] = [];
    let headers: string[] = [];
    let starts: number[] = [];
    for (const row of rows) {
        const candidateHeaders = row.map((cell) => normalizeIdentity(String(cell)));
        if (candidateHeaders.includes('nama item') && candidateHeaders.includes('karakter') && candidateHeaders.includes('note')) {
            headers = candidateHeaders;
            starts = headers.map((header, index) => header === 'nama item' ? index : -1).filter((index) => index >= 0);
            continue;
        }
        if (!starts.length) continue;
        for (const start of starts) {
            const end = starts.find((candidate) => candidate > start) ?? headers.length;
            const block = headers.slice(start, end);
            const characterOffset = block.findIndex((header) => header === 'karakter');
            const familyOffset = block.findIndex((header) => header === 'note');
            if (characterOffset < 0 || familyOffset < 0) continue;
            const inspired = String(row[start] || '').trim();
            const character = String(row[start + characterOffset] || '').trim();
            const family = normalizeFamily(row[start + familyOffset]);
            if (!inspired || !character || !family || inspired.toLowerCase() === 'nama item' || /^\d+$/.test(family)) continue;
            entries.push({ inspired, character, family });
        }
    }
    const parsed = [...new Map(entries.map((entry) => [`${entry.inspired.toLowerCase()}|${entry.character.toLowerCase()}`, entry])).values()];
    catalogCache = { source, rows: parsed };
    return parsed;
};
