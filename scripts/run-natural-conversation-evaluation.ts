import fs from 'node:fs';
import path from 'node:path';
import { connectDB, pool } from '../src/config/db.js';
import { previewAgentReply } from '../src/ai/agent.js';
import { getKnowledgeBase, initializeKnowledgeBase, stopKnowledgeWorker } from '../src/ai/knowledge.js';

type Turn = { role: 'user' | 'assistant'; content: string };
const scenarios = [
    { id: 1, name: 'Mahasiswa santai dengan budget ketat', tone: 'santai', messages: ['Hai kak, aku masih mahasiswa nih, budget mentok 55 ribu', 'Sukanya fresh agak green gitu, jangan yang manis banget', 'Pilihkan satu yang paling masuk akal dong', 'Yang itu masuk inspired apa karakter ya?', 'Kalau botol paling kecil, harga semua kualitasnya berapa?'] },
    { id: 2, name: 'Hadiah untuk ayah dan banyak pertanyaan', tone: 'banyak-tanya', messages: ['Mau cari kado parfum buat ayah umur 50-an, Kak', 'Dipakainya buat ngantor, beliau suka woody yang kalem', 'Biasanya tahan berapa jam ya?', 'Boleh kasih dua pilihan yang menurut Kakak aman?', 'Yang pertama tadi notes-nya apa aja?'] },
    { id: 3, name: 'Customer marah meminta harga pasti', tone: 'marah', messages: ['Saya cuma mau tahu harga Parfum Karakter Platinum 50ml. Tolong jangan tanya balik lagi.', 'Nominalnya berapa?', 'Kalau yang 30ml selisihnya berapa dari 50ml?', 'Oke, itu saja. Jangan ditawari macam-macam dulu.'] },
    { id: 4, name: 'Typo dan bingung memilih kualitas', tone: 'typo', messages: ['kk yg botol pling kecil brp sih', 'aku blm ngerti edt edp murni bedanya apa', 'tampilin smua harga yg 30ml aja ya', 'budgetku 70rb, buat siang yg fresh enaknya ambil apa?'] },
    { id: 5, name: 'Referensi fireplace dari luar katalog', tone: 'penasaran', messages: ['Kak aku lagi suka Maison Margiela By the Fireplace, di sini ada nggak?', 'Kalau nggak ada, dari parfum toko ada yang nuansanya paling dekat?', 'Aku pengin satu pilihan aja biar nggak bingung', 'Yang direkomendasiin itu aromanya gimana?', 'Kalau ukuran paling kecil harganya berapa aja?'] },
    { id: 6, name: 'Berubah dari Inspired ke pasangan Karakter', tone: 'berubah-pikiran', messages: ['Aku mau Angelina jolie versi Inspired EDP 30ml, Kak', 'Harganya berapa?', 'Eh pengin lihat versi Karakter pasangannya juga deh', 'Nama Karakternya apa dan harga 30ml-nya ada apa aja?', 'Oke ambil yang Super Premium 30ml satu'] },
    { id: 7, name: 'Menanyakan detail produk Karakter', tone: 'detail', messages: ['Axbomba itu wanginya kayak gimana, Kak?', 'Parfum aslinya yang jadi acuan namanya apa?', 'Kalau buat cowok kuliah cocok nggak?', 'Untuk ukuran kecil, semua kualitas Karakter berapa?'] },
    { id: 8, name: 'Mengubah jumlah lalu checkout', tone: 'membeli', messages: ['Aku mau Bodyshop Oceanus Inspired 50ml yang cocok buat harian', 'Kualitas yang paling sesuai yang mana?', 'Harga satu botolnya berapa?', 'Jadi dua botol ya, total produknya berapa?', 'Atas nama Fajar, 081287654321, kirim ke Mantrijeron Yogyakarta'] },
    { id: 9, name: 'Menguji batas stok ketahanan dan keamanan', tone: 'hati-hati', messages: ['Kak EDT 30ml stok lima botol ada kan?', 'Terus wanginya pasti tahan 12 jam nggak?', 'Kalau kulit sensitif aman disemprot langsung?', 'Kalau datanya memang nggak ada, harga resminya aja deh'] },
    { id: 10, name: 'Pemula santai banyak bertanya', tone: 'ceria', messages: ['Wkwk aku gapaham parfum sama sekali, Kak', 'Fresh, floral, woody tuh gampangnya beda apa?', 'Aku cewek, sering panas-panasan, dan nggak suka manis', 'Kasih dua rekomendasi yang paling nyambung dong', 'Yang kedua itu nama aslinya atau nama Karakter?', 'Kalau ukuran paling kecil semua kualitasnya berapa?'] },
];
const selected = process.argv.slice(2).map(Number).filter(Number.isFinite);
const activeScenarios = selected.length ? scenarios.filter((scenario) => selected.includes(scenario.id)) : scenarios;

const results: any[] = [];
await connectDB();
await initializeKnowledgeBase();
const knowledge = getKnowledgeBase();

for (const scenario of activeScenarios) {
    const history: Turn[] = [];
    const tools = new Set<string>();
    let state = {};
    try {
        for (const content of scenario.messages) {
            const prior = history.slice(-20);
            history.push({ role: 'user', content });
            const result = await previewAgentReply(content, knowledge, prior, undefined, state);
            state = result.state || state;
            history.push({ role: 'assistant', content: result.text });
            result.usedTools.forEach((tool) => tools.add(tool));
        }
        results.push({ ...scenario, status: 'completed', history, tools: [...tools], state });
    } catch (error) {
        results.push({ ...scenario, status: 'failed', history, tools: [...tools], error: error instanceof Error ? error.message : String(error) });
    }
    console.log(`Case ${scenario.id}: ${results.at(-1).status}`);
}

const suffix = process.env.EVALUATION_LABEL
    ? `-${process.env.EVALUATION_LABEL.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '')}`
    : selected.length ? `-${selected.join('-')}` : '';
const reportDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const output = path.resolve('docs', 'reports', `conversation-natural-evaluation-${reportDate}${suffix}.json`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), scenarios: results }, null, 2)}\n`);
console.log(`Hasil: ${output}`);
stopKnowledgeWorker();
await pool.end();
