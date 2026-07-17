import type { ProductDomain } from './product-domain.js';
import { supportsFragranceCatalogSchema } from './product-domain.js';
import { extractAromaProfile, loadCatalogAromas, matchCatalogCandidates } from './catalog-matcher.js';

export interface DomainMatchResult {
    profileEvidence: string;
    candidateEvidence: string;
    policy: string;
}

export interface DomainMatcher {
    id: ProductDomain;
    supports: (domain: ProductDomain, schemaRows: unknown[][]) => boolean;
    match: (externalReference: string) => Promise<DomainMatchResult>;
}

const genericMatcher: DomainMatcher = {
    id: 'generic',
    supports: () => true,
    match: async () => ({
        profileEvidence: 'Gunakan spesifikasi produk dari referensi web terverifikasi.',
        candidateEvidence: 'Gunakan hanya produk dan atribut yang ditemukan pada Knowledge relevan.',
        policy: 'Gunakan referensi web hanya untuk memahami produk luar. Jangan menciptakan produk, spesifikasi, pilihan, harga, stok, atau ketersediaan yang tidak ada pada evidence.',
    }),
};

const fragranceMatcher: DomainMatcher = {
    id: 'fragrance',
    supports: (domain, schemaRows) => domain === 'fragrance' && supportsFragranceCatalogSchema(schemaRows),
    match: async (externalReference) => {
        const profile = extractAromaProfile(externalReference);
        const candidates = matchCatalogCandidates(profile, await loadCatalogAromas(), 3);
        return {
            profileEvidence: `Notes: ${profile.notes.join(', ') || '-'}\nKeluarga: ${profile.families.join(', ') || '-'}`,
            candidateEvidence: candidates.length
                ? candidates.map((candidate, index) => `${index + 1}. Inspired: ${candidate.inspired} | Karakter: ${candidate.character} | Keluarga terverifikasi: ${candidate.family}`).join('\n')
                : 'Tidak ada kandidat katalog yang melewati pencocokan terverifikasi.',
            policy: 'Hanya rekomendasikan kandidat terverifikasi. Pertahankan arah Inspired -> Karakter. Jangan mengarang detail notes kandidat yang tidak ada pada evidence.',
        };
    },
};

const matchers: DomainMatcher[] = [fragranceMatcher, genericMatcher];

export const selectDomainMatcher = (domain: ProductDomain, schemaRows: unknown[][]) => matchers.find((matcher) => matcher.supports(domain, schemaRows)) || genericMatcher;
