import fs from 'node:fs';
import path from 'node:path';

const reportDir = path.resolve('docs', 'reports');
const sources = [
    'conversation-random-evaluation-2026-07-27-1-2-3-4-5.json',
    'conversation-random-evaluation-2026-07-27-6-7-8-9-10.json',
];
const scenarios = sources
    .flatMap((source) => JSON.parse(fs.readFileSync(path.join(reportDir, source), 'utf8')).scenarios)
    .sort((a, b) => a.id - b.id);

const clean = (value) => String(value).replaceAll('\r', '').trim();
const issues = (scenario) => {
    const replies = scenario.history.filter(({ role }) => role === 'assistant').map(({ content }) => content);
    const found = [];
    if (replies.some((text) => text.includes('|'))) found.push('masih memakai karakter pipa');
    if (replies.some((text) => /(?:^|\n)\s*-\s/m.test(text))) found.push('masih memakai bullet strip');
    if (replies.some((text) => /Rp\d+[.]\s*\n+\s*000/.test(text))) found.push('nominal rupiah terpotong baris');
    if (replies.some((text) => /\b\d+[.]\s+[^\n?]+[.!]\s+[^\n]*\?/s.test(text))) found.push('pertanyaan penutup menempel pada item daftar');
    if (replies.some((text) => /(?:Rp[\d.]+[^\n]*){3,}/.test(text))) found.push('daftar harga menumpuk dalam satu baris');
    return found;
};

const audited = scenarios.map((scenario) => ({ scenario, findings: issues(scenario) }));
const passed = audited.filter(({ findings }) => findings.length === 0).length;
const lines = [
    '# Hasil 10 Case Random — Tampilan Chat',
    '',
    `Status format: ${passed}/10 lulus pemeriksaan otomatis, ${10 - passed}/10 perlu perbaikan.`,
    '',
];

for (const { scenario, findings } of audited) {
    lines.push(`## Case ${scenario.id} — ${scenario.name}`, '');
    lines.push(`Status: ${findings.length ? 'Perlu perbaikan' : 'Lulus format'}`);
    lines.push(`Catatan: ${findings.length ? findings.join('; ') : 'tidak ditemukan pola format bermasalah'}.`, '');
    for (const message of scenario.history) {
        const speaker = message.role === 'user' ? 'Customer' : 'Anin';
        const quoted = clean(message.content).split('\n').map((line) => `> ${line}`).join('\n');
        lines.push(`**${speaker}**`, '', quoted, '');
    }
    lines.push('---', '');
}

const output = path.join(reportDir, 'conversation-random-evaluation-2026-07-27-chat.md');
fs.writeFileSync(output, `${lines.join('\n')}\n`);
console.log(output);
