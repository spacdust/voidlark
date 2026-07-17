import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import Tesseract from 'tesseract.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
const xlsx = require('xlsx');

export interface ExtractedKnowledge {
    text: string;
    mediaType: string;
    metadata: Record<string, unknown>;
}

export const extractKnowledgeFile = async (filePath: string): Promise<ExtractedKnowledge> => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.txt' || ext === '.md') return { text: await fs.readFile(filePath, 'utf8'), mediaType: `text/${ext.slice(1)}`, metadata: {} };
    if (ext === '.pdf') {
        const result = await pdfParse(await fs.readFile(filePath));
        return { text: result.text, mediaType: 'application/pdf', metadata: { pages: result.numpages } };
    }
    if (ext === '.docx') {
        const result = await mammoth.extractRawText({ path: filePath });
        return { text: result.value, mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', metadata: { warnings: result.messages.length } };
    }
    if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
        const workbook = xlsx.readFile(filePath);
        const text = workbook.SheetNames.map((name: string) => `## ${name}\n${xlsx.utils.sheet_to_txt(workbook.Sheets[name])}`).join('\n\n');
        return { text, mediaType: ext === '.csv' ? 'text/csv' : 'application/vnd.ms-excel', metadata: { sheets: workbook.SheetNames } };
    }
    if (['.png', '.jpg', '.jpeg'].includes(ext)) {
        const result = await Tesseract.recognize(filePath, 'ind+eng');
        return { text: result.data.text, mediaType: `image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)}`, metadata: { ocr: true, confidence: result.data.confidence } };
    }
    throw new Error(`Format knowledge tidak didukung: ${ext || 'tanpa ekstensi'}`);
};
