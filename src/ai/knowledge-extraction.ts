import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import Tesseract from 'tesseract.js';
import ExcelJS from 'exceljs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const cellText = (value: ExcelJS.CellValue) => {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value !== 'object') return String(value);
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
    if ('text' in value) return String(value.text);
    return String(value);
};

const worksheetText = (worksheet: ExcelJS.Worksheet) => {
    const lines: string[] = [];
    worksheet.eachRow({ includeEmpty: true }, (row) => {
        const values = Array.isArray(row.values) ? row.values.slice(1) : [];
        lines.push(values.map((value) => cellText(value as ExcelJS.CellValue)).join('\t'));
    });
    return lines.join('\n');
};

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
    if (ext === '.xlsx' || ext === '.csv') {
        const workbook = new ExcelJS.Workbook();
        if (ext === '.csv') await workbook.csv.readFile(filePath);
        else await workbook.xlsx.readFile(filePath);
        const sheets = workbook.worksheets.map((worksheet) => worksheet.name);
        const text = workbook.worksheets.map((worksheet) => `## ${worksheet.name}\n${worksheetText(worksheet)}`).join('\n\n');
        return { text, mediaType: ext === '.csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', metadata: { sheets } };
    }
    if (['.png', '.jpg', '.jpeg'].includes(ext)) {
        const result = await Tesseract.recognize(filePath, 'ind+eng');
        return { text: result.data.text, mediaType: `image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)}`, metadata: { ocr: true, confidence: result.data.confidence } };
    }
    throw new Error(`Format knowledge tidak didukung: ${ext || 'tanpa ekstensi'}`);
};
