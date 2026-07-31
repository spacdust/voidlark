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
                ? candidates.map((candidate, index) => `${index + 1}. Referensi pencocokan, bukan produk toko: ${candidate.inspired} | Produk internal yang boleh direkomendasikan dan dijual: ${candidate.character} | Keluarga terverifikasi: ${candidate.family}`).join('\n')
                : 'Tidak ada kandidat katalog yang melewati pencocokan terverifikasi.',
            policy: 'Produk luar dan kolom referensi hanya dipakai untuk membaca profil pembanding. Jangan pernah menawarkan, memberi harga, menyimpan draft, atau menjual nama referensi tersebut sebagai produk toko. Hanya nama pada label "Produk internal yang boleh direkomendasikan dan dijual" yang boleh ditawarkan. Jangan mengarang detail notes kandidat yang tidak ada pada evidence.',
        };
    },
};

const digitalMatcher: DomainMatcher = {
    id: 'digital',
    supports: (domain) => domain === 'digital',
    match: async (externalReference) => {
        const durations = externalReference.match(/\b(?:\d+\s*(?:bulan|tahun|hari|mo|yr|day|month|year)s?|lifetime|permanen)\b/gi) || [];
        const licenses = externalReference.match(/\b(?:personal|family|pro|premium|business|enterprise|individual|sharing|private)\b/gi) || [];
        return {
            profileEvidence: `Durasi Paket: ${[...new Set(durations)].join(', ') || '-'}\nTipe Akun/Lisensi: ${[...new Set(licenses)].join(', ') || '-'}`,
            candidateEvidence: 'Pastikan varian durasi, tipe lisensi, dan metode aktivasi persis sama dengan yang tertera di Knowledge.',
            policy: 'Hanya rekomendasikan varian lisensi/durasi terverifikasi. Jangan menjanjikan garansi masa aktif atau tipe akun yang tidak ada pada evidence.',
        };
    },
};

const fashionMatcher: DomainMatcher = {
    id: 'fashion',
    supports: (domain) => domain === 'fashion',
    match: async (externalReference) => {
        const sizes = externalReference.match(/\b(?:s|m|l|xl|xxl|3xl|[34][0-9])\b/gi) || [];
        const materials = externalReference.match(/\b(?:katun|cotton|combed|fleece|canvas|denim|leather|polyester|silk|rayon)\b/gi) || [];
        return {
            profileEvidence: `Ukuran Terdeteksi: ${[...new Set(sizes)].map((s) => s.toUpperCase()).join(', ') || '-'}\nMaterial/Bahan: ${[...new Set(materials)].join(', ') || '-'}`,
            candidateEvidence: 'Gunakan tabel Size Chart dan varian warna yang tersedia pada Knowledge.',
            policy: 'Rekomendasikan ukuran berdasarkan Size Chart resmi di Knowledge. Jangan menjanjikan ketersediaan ukuran atau bahan yang tidak ada pada evidence.',
        };
    },
};

const electronicsMatcher: DomainMatcher = {
    id: 'electronics',
    supports: (domain) => domain === 'electronics',
    match: async (externalReference) => {
        const specs = externalReference.match(/\b(?:\d+\s*(?:gb|tb|mb|ram|rom|ssd|mah|watt|hz|inch|inci))\b/gi) || [];
        const warranties = externalReference.match(/\b(?:garansi\s*(?:resmi|toko|distributor)?\s*\d*\s*(?:bulan|tahun|hari)?)\b/gi) || [];
        return {
            profileEvidence: `Spesifikasi Kunci: ${[...new Set(specs)].join(', ') || '-'}\nGaransi: ${[...new Set(warranties)].join(', ') || '-'}`,
            candidateEvidence: 'Gunakan spesifikasi memori, kondisi (Baru/Second), dan tipe garansi resmi dari Knowledge.',
            policy: 'Jangan mengonfirmasi varian RAM/Storage atau klaim Garansi Resmi yang tidak ada pada evidence.',
        };
    },
};

const matchers: DomainMatcher[] = [fragranceMatcher, digitalMatcher, fashionMatcher, electronicsMatcher, genericMatcher];

export const selectDomainMatcher = (domain: ProductDomain, schemaRows: unknown[][]) => matchers.find((matcher) => matcher.supports(domain, schemaRows)) || genericMatcher;
