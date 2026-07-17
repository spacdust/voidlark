import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { supportsFragranceCatalogSchema } from './product-domain.js';

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

const NOTE_TERMS = ['pear', 'melon', 'green notes', 'cedarwood', 'moss', 'caramel', 'musk', 'bergamot', 'lemon', 'orange', 'apple', 'peach', 'jasmine', 'rose', 'amber', 'vanilla', 'sandalwood', 'patchouli', 'vetiver', 'oud'];

const FAMILY_RULES: Array<[string, RegExp]> = [
    ['fresh', /\b(?:fresh|segar|citrus|green notes|melon|pear|bergamot|lemon|orange)\b/i],
    ['floral', /\b(?:floral|flower|jasmine|rose|magnolia|lily|tuberose)\b/i],
    ['woody', /\b(?:woody|wood|cedarwood|sandalwood|patchouli|vetiver|oud|moss)\b/i],
    ['glamour', /\b(?:glamour|sensual|elegant|musk|amber|caramel|vanilla)\b/i],
];

const normalizeFamily = (value: unknown) => String(value || '').trim().toLowerCase();

export const extractAromaProfile = (reference: string): AromaProfile => {
    const lower = reference.toLowerCase();
    const notes = NOTE_TERMS.filter((note) => lower.includes(note));
    const families = FAMILY_RULES.filter(([, pattern]) => pattern.test(reference)).map(([family]) => family);
    return { notes, families };
};

export const matchCatalogCandidates = (profile: AromaProfile, catalog: CatalogAroma[], limit = 3): MatchedCatalogAroma[] => {
    const families = new Set(profile.families.map(normalizeFamily));
    return catalog
        .map((item) => {
            const family = normalizeFamily(item.family);
            const matchedFamilies = families.has(family) ? [family] : [];
            const searchableName = `${item.inspired} ${item.character}`.toLowerCase();
            const matchedNotes = profile.notes.filter((note) => searchableName.includes(note));
            const score = matchedNotes.length * 10 + matchedFamilies.length;
            return { ...item, family, score, matchedFamilies };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.inspired.localeCompare(b.inspired))
        .slice(0, limit);
};

let catalogCache: CatalogAroma[] | null = null;

export const loadCatalogSchemaRows = async (): Promise<unknown[][]> => {
    const workbookPath = path.resolve('knowledge_base', 'penggolongan-notes.xlsx');
    if (!fs.existsSync(workbookPath)) return [];
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return [];
    const rows: unknown[][] = [];
    worksheet.eachRow({ includeEmpty: true }, (row) => {
        const values = Array.isArray(row.values) ? row.values.slice(1) : [];
        rows.push(values.map((value) => value ?? ''));
    });
    return rows;
};

export const loadCatalogAromas = async (): Promise<CatalogAroma[]> => {
    if (catalogCache) return catalogCache;
    const rows = await loadCatalogSchemaRows();
    if (!supportsFragranceCatalogSchema(rows)) return [];
    const entries: CatalogAroma[] = [];
    for (const row of rows) {
        for (const start of [0, 6, 13]) {
            const inspired = String(row[start + 1] || '').trim();
            const character = String(row[start + 2] || '').trim();
            const family = normalizeFamily(row[start + 4]);
            if (!inspired || !character || inspired.toLowerCase() === 'nama item' || !['fresh', 'floral', 'woody', 'glamour'].includes(family)) continue;
            entries.push({ inspired, character, family });
        }
    }
    catalogCache = [...new Map(entries.map((entry) => [`${entry.inspired.toLowerCase()}|${entry.character.toLowerCase()}`, entry])).values()];
    return catalogCache;
};
