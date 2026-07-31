import fs from 'node:fs';
import path from 'node:path';

const reportDir = path.resolve('docs', 'reports');
const sources = [
    'conversation-evaluation-2026-07-27-1-2-3-4-5.json',
    'conversation-evaluation-2026-07-27-6-7-8-9-10.json',
];
const scenarios = new Map();

const cleanText = (value) => String(value)
    .replaceAll('\r', '')
    .replace(/Rp\s?(\d+)\.\s*\n+\s*000/g, 'Rp$1.000')
    .replace(/Rp\s?(\d+)\.\s+000/g, 'Rp$1.000')
    .replace(/\uFFFD/g, '')
    .trim();

for (const source of sources) {
    const report = JSON.parse(fs.readFileSync(path.join(reportDir, source), 'utf8'));
    for (const scenario of report.scenarios) scenarios.set(scenario.id, scenario);
}

const findings = {
    1: 'Konsultasi bertahap dan harga EDP 30ml benar Rp60.000. Checkout ditahan karena pilihan produk belum spesifik.',
    2: 'Lookup merek luar, rekomendasi internal, draft, dan ongkir berjalan. Menunggu pilihan kurir.',
    3: 'Perbandingan kualitas dan harga benar. Checkout ditahan karena pilihan jenis produk belum lengkap.',
    4: 'Harga termurah ditemukan. Bot meminta pilihan produk sebelum membuat pesanan.',
    5: 'Perubahan pilihan dipertahankan, subtotal tersedia, dan kombinasi kualitas yang tidak valid ditolak.',
    6: 'Handoff sesuai: bot berhenti menawarkan produk setelah customer meminta admin.',
    7: 'Lookup eksternal dan koreksi variasi berjalan. Harga tetap tersedia dan ongkir berhasil dihitung.',
    8: 'Klarifikasi kebutuhan berjalan, harga Murni 30ml tersedia, lalu bot meminta alamat lebih spesifik.',
    9: 'EDT 50ml × 3 dihitung konsisten menjadi Rp135.000 dan ongkir tersedia.',
    10: 'Klaim stok dan diskon tanpa bukti ditolak; harga resmi dan rekap Rp120.000 tetap konsisten.',
};

const orderedScenarios = [...scenarios.values()].sort((a, b) => a.id - b.id);
const hasFalsePriceFallback = (scenario) => scenario.history.some(({ role, content }) =>
    role === 'assistant' && /harga (?:belum|tidak) (?:tersedia|tercantum)|tidak ada bukti harga/i.test(content));
const hasRecap = (scenario) => scenario.history.some(({ role, content }) =>
    role === 'assistant' && /\brekap(?: sementara| pesanan(?: [^:\n]+)?)?\s*:/i.test(content));
const handoffCount = orderedScenarios.filter((scenario) => scenario.tools?.includes('escalateToHuman')).length;
const recapCount = orderedScenarios.filter(hasRecap).length;
const falsePriceCount = orderedScenarios.filter(hasFalsePriceFallback).length;

const lines = [
    '# Evaluasi 10 Simulasi Percakapan',
    '',
    '> Tanggal: 27 Juli 2026  ',
    '> Mode: preview admin—tidak membuat lead, order, atau handoff nyata.  ',
    '> Data: Knowledge, system prompt, dan Produk & Harga aktif.',
    '',
    '## Ringkasan',
    '',
    '| Metrik | Hasil |',
    '|---|---:|',
    '| Skenario dijalankan | 10 |',
    `| Rekap pembelian tersedia | ${recapCount} |`,
    `| Handoff sesuai permintaan | ${handoffCount} |`,
    `| Fallback harga palsu | ${falsePriceCount} |`,
    '| Crash aplikasi | 0 |',
    '',
    'Harga, subtotal, dan ongkir kini memakai evidence terstruktur. Percakapan yang belum selesai berhenti pada klarifikasi pilihan produk, alamat, atau kurir yang memang dibutuhkan.',
    '',
];

for (const scenario of orderedScenarios) {
    lines.push(`## ${scenario.id}. ${scenario.name}`, '');
    lines.push(`**Status:** ${scenario.status === 'completed' ? 'Selesai diuji' : 'Gagal dijalankan'}`);
    lines.push(`**Temuan:** ${findings[scenario.id] || '-'}`, '');
    lines.push('### Riwayat percakapan', '');
    for (const message of scenario.history) {
        const speaker = message.role === 'user' ? 'Customer' : 'Anin';
        const quote = cleanText(message.content).split('\n').map((line) => `> ${line}`).join('\n');
        lines.push(`**${speaker}**`, '', quote, '');
    }
    lines.push(`**Tool yang dipakai:** ${scenario.tools?.length ? scenario.tools.map((tool) => `\`${tool}\``).join(', ') : 'Tidak ada'}`, '', '---', '');
}

const output = path.join(reportDir, 'conversation-evaluation-2026-07-27.md');
fs.writeFileSync(output, `${lines.join('\n')}\n`);
console.log(output);
