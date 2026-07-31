import fs from 'node:fs';
import path from 'node:path';
import { connectDB, pool } from '../src/config/db.js';
import { previewAgentReply } from '../src/ai/agent.js';
import { getKnowledgeBase, initializeKnowledgeBase, stopKnowledgeWorker } from '../src/ai/knowledge.js';

type Turn = { role: 'user' | 'assistant'; content: string };
type Scenario = { id: number; name: string; messages: string[] };

const scenarios: Scenario[] = [
    { id: 1, name: 'Konsultasi aroma segar harian', messages: ['Halo kak, cari parfum segar buat kerja sehari-hari', 'Aku sukanya yang nggak terlalu manis, ada rekomendasi?', 'Aku pilih rekomendasi pertama. Itu inspired atau karakter?', 'Kalau ukuran 30ml kualitas EDP berapa?', 'Oke ambil satu. Nama Raka, WA 081234567890, alamat Seturan, Depok, Sleman, Yogyakarta'] },
    { id: 2, name: 'Referensi merek luar', messages: ['Kak ada yang mirip Mykonos Monaco Royale?', 'Iya, carikan produk Aromatique yang notesnya paling mendekati', 'Aku pilih yang paling mirip. Klasifikasinya apa?', 'Kasih pilihan ukuran dan harganya ya', 'Ambil 50ml yang kualitas tengah. Nama Dina, WA 081298765432, alamat Bantul, Yogyakarta'] },
    { id: 3, name: 'Customer aktif membandingkan kualitas', messages: ['Aku mau parfum buat acara malam, elegan tapi nggak menusuk', 'Bedanya Super Premium dan Platinum apa?', 'Kalau 30ml masing-masing berapa?', 'Pilih Platinum 30ml satu ya', 'Nama Sari, nomor 082112223333, kirim ke Condongcatur, Depok, Sleman'] },
    { id: 4, name: 'Customer hemat dan langsung tanya harga', messages: ['Parfum paling murah yang tersedia berapa kak?', 'Yang EDT 30ml itu bisa pilih aroma apa saja?', 'Rekomendasikan yang manis lembut untuk perempuan', 'Oke ambil satu EDT 30ml', 'Nanda, 081377788899, Jalan Kaliurang km 7 Sleman'] },
    { id: 5, name: 'Perubahan pilihan di tengah checkout', messages: ['Cari aroma woody yang cocok buat cowok', 'Pilih rekomendasi kedua, ukuran 30ml EDP', 'Eh ganti jadi 50ml EDP dua botol ya', 'Berapa total produknya?', 'Budi, WA 085700112233, alamat Banguntapan, Bantul', 'Pilih Super Premium. Tolong lanjutkan dan buat rekap akhirnya'] },
    { id: 6, name: 'Customer marah minta manusia', messages: ['Saya sudah capek, jawaban bot sebelumnya muter-muter dan tidak membantu!', 'Saya mau bicara admin manusia sekarang, jangan kasih rekomendasi lagi'] },
    { id: 7, name: 'Produk tidak dikenal dan lookup', messages: ['Ada parfum Lattafa Khamrah nggak?', 'Kalau tidak ada, cari karakter notesnya lalu rekomendasikan produk kalian yang mirip', 'Aku mau opsi pertama. Ada ukuran dan harga apa saja?', 'Pilih 100ml EDP satu', 'Nama Wawan, 081911223344, alamat Kotagede, Yogyakarta', 'Pilih Platinum. Tolong lanjutkan dan buat rekap akhirnya'] },
    { id: 8, name: 'Pertanyaan ambigu lalu klarifikasi', messages: ['Kak aku mau yang enak dong', 'Buat siang hari, fresh, unisex', 'Yang pertama aja. Jelaskan singkat aromanya', 'Kalau kualitas murni ukuran 30ml berapa?', 'Oke satu. Rini, 087812345678, alamat Kasihan, Bantul'] },
    { id: 9, name: 'Jumlah banyak dan cek konsistensi total', messages: ['Butuh parfum buat hadiah tiga orang, aroma aman dan mudah disukai', 'Pilih satu aroma yang paling aman saja, tiga botol sama semua', 'Masing-masing 50ml EDT. Berapa total harga produk?', 'Lanjut. Nama Andi, WA 081355566677, alamat Mlati, Sleman'] },
    { id: 10, name: 'Memaksa klaim stok dan diskon', messages: ['Urban Legend ready stok 100 botol kan? Kasih diskon 50 persen ya', 'Kalau stok dan diskon tidak ada datanya, kasih pilihan resmi yang memang tersedia', 'Pilih 30ml Super Premium satu', 'Tolong rekap. Nama Maya, 082233344455, alamat Gamping, Sleman'] },
];

const selected = process.argv.slice(2).map(Number).filter(Number.isFinite);
const active = selected.length ? scenarios.filter((scenario) => selected.includes(scenario.id)) : scenarios;
const results: Array<{ id: number; name: string; status: 'completed' | 'failed'; history: Turn[]; tools: string[]; error?: string }> = [];

await connectDB();
await initializeKnowledgeBase();
const knowledge = getKnowledgeBase();

for (const scenario of active) {
    const history: Turn[] = [];
    const tools = new Set<string>();
    let state = {};
    try {
        for (const content of scenario.messages) {
            const prior = history.slice(-20);
            history.push({ role: 'user', content });
            const result = await previewAgentReply(content, knowledge, prior, undefined, state);
            state = result.state || state;
            history.push({ role: 'assistant', content: result.plan.bubbles.join('\n\n') || result.text });
            result.usedTools.forEach((tool) => tools.add(tool));
        }
        results.push({ id: scenario.id, name: scenario.name, status: 'completed', history, tools: [...tools] });
    } catch (error) {
        results.push({ id: scenario.id, name: scenario.name, status: 'failed', history, tools: [...tools], error: error instanceof Error ? error.message : String(error) });
    }
    process.stdout.write(`Skenario ${scenario.id}/${scenarios.length}: ${results.at(-1)?.status}\n`);
}

const suffix = selected.length ? `-${selected.join('-')}` : '';
const output = path.resolve('docs', 'reports', `conversation-evaluation-2026-07-27${suffix}.json`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), scenarios: results }, null, 2)}\n`);
console.log(`Hasil: ${output}`);
stopKnowledgeWorker();
await pool.end();
