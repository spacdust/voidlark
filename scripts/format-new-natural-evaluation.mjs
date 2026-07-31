import fs from 'node:fs';
import path from 'node:path';

const reportDir = path.resolve('docs', 'reports');
const sources = process.argv.slice(2);
if (!sources.length) throw new Error('Masukkan minimal satu file hasil evaluasi.');
const datasets = sources.map((name) => JSON.parse(fs.readFileSync(path.join(reportDir, name), 'utf8')));
const scenarios = datasets.flatMap((data) => data.scenarios).sort((left, right) => left.id - right.id);
const generatedAt = datasets.map((data) => data.generatedAt).sort().at(-1);
const findings = {
    1: { status: 'GAGAL', note: 'Kehilangan fokus kebutuhan. Bot meminta kualitas/ukuran terlalu awal, memberi fallback harga yang tidak relevan, merekomendasikan kelompok tanpa nama produk, lalu berpindah dari Inspired ke Karakter saat customer meminta harga ukuran terkecil.' },
    2: { status: 'PERLU PERBAIKAN', note: 'Produk pertama dan lookup notes benar, tetapi pilihan kedua berlabel Woman untuk hadiah ayah karena kata “ayah” belum dianggap audience pria. Susunan notes juga memiliki tanda baca rusak.' },
    3: { status: 'PERLU PERBAIKAN', note: 'Harga Platinum 50ml benar Rp180.000, tetapi pertanyaan selisih 30ml dan 50ml dijawab dengan mengulang harga 50ml. Selisih seharusnya Rp45.000.' },
    4: { status: 'GAGAL', note: 'Permintaan seluruh harga 30ml hanya menampilkan Murni 30ml. Seharusnya EDT Rp35.000, EDP Rp60.000, dan Murni Rp120.000.' },
    5: { status: 'GAGAL', note: 'Bot menjelaskan By the Fireplace dan mengklaim alternatif warm/woody/manis tanpa lookup tercatat, lalu tidak pernah menyebut nama produk internal. Ini halusinasi provenance.' },
    6: { status: 'GAGAL', note: 'Teks repair internal bocor ke customer. Relasi Angelina jolie → Agolie tidak dijawab, dan daftar harga berikutnya tetap memakai Inspired ketika customer meminta Karakter.' },
    7: { status: 'LULUS', note: 'Axbomba dipetakan ke Axe Anarki, lookup notes memakai nama acuan, konteks Karakter bertahan, dan harga 30ml benar: Super Premium Rp120.000 serta Platinum Rp135.000.' },
    8: { status: 'GAGAL', note: 'Produk, ukuran 50ml, dan rekomendasi EDT sudah disebut customer/bot, tetapi state tidak terkunci. Harga satu botol malah menampilkan seluruh katalog, total dua botol tidak dihitung, lalu checkout mengatakan produk belum dipilih.' },
    9: { status: 'GAGAL', note: 'Bot mengklaim stok lima botol tersedia tanpa data. Pertanyaan ketahanan 12 jam dan keamanan kulit sensitif tidak mendapat batas data yang benar. Harga akhir EDT 30ml Rp35.000 benar.' },
    10: { status: 'GAGAL', note: 'Rekomendasi beralih ke Karakter tanpa pilihan kelompok, kandidat pertama memuat vanila walau customer menolak manis, dan pertanyaan “nama asli atau Karakter?” dijawab sebagai checkout.' },
};
const count = (status) => Object.values(findings).filter((item) => item.status === status).length;
const lines = [
    '# Evaluasi 10 Percakapan Natural Baru',
    '',
    `Dibuat: ${generatedAt}`,
    '',
    `Eksekusi selesai: ${scenarios.filter((scenario) => scenario.status === 'completed').length}/10`,
    `Lulus kualitas penuh: ${count('LULUS')}/10`,
    `Perlu perbaikan: ${count('PERLU PERBAIKAN')}/10`,
    `Gagal kualitas/provenance: ${count('GAGAL')}/10`,
    '',
];

for (const scenario of scenarios) {
    const finding = findings[scenario.id];
    lines.push(`## Case ${scenario.id} — ${scenario.name}`, '', `Status: ${finding.status}`, '', `Audit: ${finding.note}`, '');
    for (const message of scenario.history) {
        lines.push(`**${message.role === 'user' ? 'Customer' : 'Anin'}**`, '');
        lines.push(...String(message.content).replaceAll('\r', '').trim().split('\n').map((line) => `> ${line}`), '');
    }
    lines.push('---', '');
}

const output = path.join(reportDir, 'conversation-natural-evaluation-2026-07-29-new-random-natural-chat.md');
fs.writeFileSync(output, `${lines.join('\n')}\n`);
console.log(output);
