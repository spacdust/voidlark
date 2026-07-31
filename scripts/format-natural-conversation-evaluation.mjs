import fs from 'node:fs';
import path from 'node:path';

const requestedSource = process.argv[2];
const candidates = fs.readdirSync(path.resolve('docs', 'reports'))
    .filter((name) => /^conversation-natural-evaluation-\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .reverse();
const source = path.resolve('docs', 'reports', requestedSource || candidates[0]);
const data = JSON.parse(fs.readFileSync(source, 'utf8'));
const reportDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(data.generatedAt));
const output = path.resolve('docs', 'reports', `conversation-natural-evaluation-${reportDate}-chat.md`);
const findings = {
    1: ['PERLU PERBAIKAN — pembuka memuat tiga pertanyaan; rekomendasi kebutuhan kantor berubah ke Karakter tanpa alasan evidence kuat. Daftar kualitas ukuran terkecil benar.'],
    2: ['LULUS — harga EDP 50ml konsisten Rp75.000 dan customer marah dijawab langsung.'],
    3: ['PERLU PERBAIKAN — dua pertanyaan dalam satu balasan dan “Fresh Oceanic/Sea Breeze” diperlakukan seperti pilihan produk tanpa nama item terverifikasi.'],
    4: ['LULUS — harga, selisih Rp15.000, perubahan ukuran, data checkout, dan ongkir konsisten.'],
    5: ['GAGAL — setelah customer checkout lengkap, bot memberi fallback pencocokan katalog dan handoff yang tidak relevan.'],
    6: ['LULUS — harga satuan Rp35.000, total 20 item Rp700.000, dan diskon tidak dikarang.'],
    7: ['PERLU PERBAIKAN — durasi tanpa evidence berhasil diblokir, tetapi pertanyaan selisih 30ml/50ml hanya dijawab dengan harga 50ml.'],
    8: ['GAGAL — customer meminta admin untuk penukaran, tetapi bot menunda handoff dan kembali meminta varian.'],
    9: ['GAGAL — rujukan “yang kedua” kehilangan pilihan produk; bot meminta kualitas dan ukuran lagi.'],
    10: ['PERLU PERBAIKAN — filter budget benar, tetapi kebutuhan fresh tidak menghasilkan rekomendasi item terverifikasi.'],
};
const lines = ['# Hasil 10 Percakapan Natural', '', `Tanggal pengujian: ${reportDate}`, `Dibuat: ${data.generatedAt}`, ''];

for (const scenario of data.scenarios) {
    lines.push(`## Case ${scenario.id} — ${scenario.name}`, '');
    for (const finding of findings[scenario.id] || []) lines.push(`Catatan: ${finding}`, '');
    for (const message of scenario.history) {
        lines.push(`**${message.role === 'user' ? 'Customer' : 'Anin'}**`, '');
        lines.push(...String(message.content).replaceAll('\r', '').trim().split('\n').map((line) => `> ${line}`), '');
    }
    lines.push('---', '');
}

fs.writeFileSync(output, `${lines.join('\n')}\n`);
console.log(output);
