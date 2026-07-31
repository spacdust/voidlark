import fs from 'node:fs';
import path from 'node:path';
import { connectDB, pool } from '../src/config/db.js';
import { previewAgentReply } from '../src/ai/agent.js';
import { getKnowledgeBase, initializeKnowledgeBase, stopKnowledgeWorker } from '../src/ai/knowledge.js';

type Turn = { role: 'user' | 'assistant'; content: string };
const scenarios = [
    { id: 1, name: 'Mencari aroma mirip Mykonos', messages: ['Kak, di sini ada Mykonos Monaco Royale nggak?', 'Oh nggak ada ya? Yang wanginya mirip ada nggak, Kak?', 'Yang paling mirip yang mana?', 'Kalau itu harganya berapa aja?'] },
    { id: 2, name: 'Mencari aroma mirip Khamrah', messages: ['Kak ada Lattafa Khamrah?', 'Kalau nggak ada, ada yang wanginya mirip Khamrah nggak?', 'Aku mau yang pertama deh. Wanginya gimana?', 'Harganya berapa, Kak?'] },
    { id: 3, name: 'Parfum untuk hadiah', messages: ['Kak, mau cari parfum buat kado cewek umur 25. Dia sukanya wangi lembut, nggak nyegrak.', 'Menurut Kakak yang paling aman yang mana?', 'Oke, kalau yang itu pilihan ukuran sama harganya berapa?', 'Aku ambil EDP 30ml ya. Nama Lala, 081234560001, kirim ke Ngaglik Sleman.'] },
    { id: 4, name: 'Mencari parfum sesuai budget', messages: ['Kak, budget 80 ribuan dapat parfum apa?', 'Aku sukanya yang fresh buat dipakai siang.', 'Kalau menurut Kakak yang paling cocok yang mana?', 'Oke ambil EDP 50ml satu ya. Nama Rian, 081234560002, alamat Sewon Bantul.'] },
    { id: 5, name: 'Mengubah ukuran dan jumlah', messages: ['Kak, aku mau parfum wangi manis, EDP 30ml satu.', 'Itu berapa harganya?', 'Eh ganti 50ml aja deh, sekalian dua botol. Jadi berapa?', 'Oke. Atas nama Tia, 081234560003, kirim ke Mlati Sleman.'] },
    { id: 6, name: 'Customer marah dan handoff', messages: ['Jawaban kamu salah terus dan saya sudah kesal', 'Jangan tawarkan produk lagi. Alihkan saya ke admin manusia sekarang'] },
    { id: 7, name: 'Menanyakan stok dan diskon besar', messages: ['Kak, Urban Legend ada stok 200 botol nggak? Kalau ambil banyak bisa diskon 70%?', 'Kalau diskon segitu nggak bisa, harga normalnya berapa?', 'Ada pilihan ukuran apa aja?', 'Oke deh, aku pikir-pikir dulu ya.'] },
    { id: 8, name: 'Konsultasi aroma malam', messages: ['Kak, aku cari parfum yang enak dong.', 'Buat malam hari. Maunya yang elegan, tapi bisa dipakai cowok atau cewek.', 'Ada dua pilihan yang cocok nggak?', 'Aku pilih yang kedua. Ada ukuran apa aja?'] },
    { id: 9, name: 'Membeli tiga parfum hadiah', messages: ['Kak, mau beli tiga parfum buat kado. Wanginya yang fresh dan sama semua ya.', 'Yang aman buat banyak orang apa?', 'Kalau EDT 50ml tiga botol totalnya berapa?', 'Oke lanjut. Nama Dodi, 081234560004, kirim ke Depok Sleman.'] },
    { id: 10, name: 'Salah menghubungi toko', messages: ['Kak, ada laptop gaming RTX 5090 nggak?', 'Oh ini toko parfum ya?', 'Kalau laptop memang nggak ada berarti ya?', 'Oke makasih, Kak.'] },
];

const selected = process.argv.slice(2).map(Number).filter(Number.isFinite);
const active = selected.length ? scenarios.filter((scenario) => selected.includes(scenario.id)) : scenarios;
const results: any[] = [];
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
        results.push({ ...scenario, status: 'completed', history, tools: [...tools], state });
    } catch (error) {
        results.push({ ...scenario, status: 'failed', history, tools: [...tools], error: error instanceof Error ? error.message : String(error) });
    }
    console.log(`Skenario ${scenario.id}: ${results.at(-1).status}`);
}

const suffix = selected.length ? `-${selected.join('-')}` : '';
const output = path.resolve('docs', 'reports', `conversation-random-evaluation-2026-07-27${suffix}.json`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), scenarios: results }, null, 2)}\n`);
console.log(`Hasil: ${output}`);
stopKnowledgeWorker();
await pool.end();
