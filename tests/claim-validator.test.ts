import assert from 'node:assert/strict';
import test from 'node:test';
import { removeUnsupportedClaimSentences, validateClaims } from '../src/ai/claim-validator.js';

test('rejects unsupported price, stock, warranty, and product format claims', () => {
    const result = validateClaims('Laptop Nova harganya Rp9.999.000, ready stock, garansi 2 tahun dan tersedia versi roll on.', 'Laptop Nova RAM 16GB.');
    assert.deepEqual(result.unsupportedTypes, ['price', 'stock', 'warranty', 'format']);
});

test('rejects unsupported digital, fashion, and electronics claims', () => {
    const result = validateClaims(
        'Akun Canva lisensi pro durasi 1 tahun, ukuran XL bahan katun combed, RAM 16GB Storage 512GB.',
        'Akun Canva lisensi personal durasi 1 bulan, ukuran M bahan polyester, RAM 8GB Storage 256GB.'
    );
    assert.ok(result.unsupportedTypes.includes('duration'));
    assert.ok(result.unsupportedTypes.includes('license'));
    assert.ok(result.unsupportedTypes.includes('size'));
    assert.ok(result.unsupportedTypes.includes('material'));
    assert.ok(result.unsupportedTypes.includes('spec'));
});

test('accepts factual claims found in evidence across domains', () => {
    const evidence = 'Laptop Nova. Harga Rp9.999.000. Stok tersedia. Garansi Resmi 2 tahun. RAM 16GB Storage 512GB. Ukuran L bahan katun. Lisensi pro durasi 1 tahun.';
    const answer = 'Laptop Nova harganya Rp9.999.000, stok tersedia, garansi resmi 2 tahun, RAM 16GB Storage 512GB, ukuran L bahan katun, lisensi pro durasi 1 tahun.';
    const result = validateClaims(answer, evidence);
    assert.deepEqual(result.unsupportedTypes, []);
});

test('does not confuse conversational language with factual claims', () => {
    const result = validateClaims('Kakak lebih suka yang ringan atau performanya tinggi?', 'Laptop Nova RAM 16GB.');
    assert.deepEqual(result.unsupportedTypes, []);
});

test('accepts verified derived subtotal only when it is present in trusted evidence', () => {
    assert.deepEqual(validateClaims('Total dua produk Rp150.000.', 'Harga satuan Rp75.000. Subtotal terverifikasi Rp150.000.').unsupportedTypes, []);
    assert.deepEqual(validateClaims('Total dua produk Rp150.000.', 'Harga satuan Rp75.000.').unsupportedTypes, ['price']);
});

test('rejects casual unsupported stock claims', () => {
    assert.deepEqual(validateClaims('EDP 30ml ready Kak, stok aman.', 'EDP 30ml Rp60.000.').unsupportedTypes, ['stock']);
    assert.deepEqual(validateClaims('Axbomba tersedia kapan aja.', 'Axbomba adalah produk katalog.').unsupportedTypes, ['stock']);
});

test('rejects unsupported durability claims expressed as hour ranges', () => {
    assert.deepEqual(validateClaims('EDT tahan 2-4 jam dan EDP 4-6 jam.', 'EDT lebih ringan daripada EDP.').unsupportedTypes, ['duration']);
    assert.deepEqual(validateClaims('EDT tahan 2-4 jam.', 'EDT memiliki ketahanan 2-4 jam.').unsupportedTypes, []);
    assert.deepEqual(validateClaims('EDP lebih tahan lama dan Karakter longlasting.', 'EDP lebih kuat.').unsupportedTypes, ['duration']);
    assert.deepEqual(validateClaims('Parfum Karakter lebih tahan lama.', 'Parfum Karakter memiliki karakter kompleks.').unsupportedTypes, ['duration']);
    assert.deepEqual(validateClaims('EDP kuat dan tahan. Wanginya nempel.', 'EDP memiliki konsentrasi 75%.').unsupportedTypes, ['duration']);
    assert.deepEqual(validateClaims('EDP tahan lama.', 'KLAIM PRODUK TERVERIFIKASI:\nEDP tahan lama.\nFAKTA LAIN:\nTidak ada.').unsupportedTypes, []);
});

test('rejects unsupported product usage and suitability promises', () => {
    assert.deepEqual(validateClaims('Sekali semprot cukup dan lebih hemat jangka panjang.', 'EDP tersedia dalam ukuran 30ml.').unsupportedTypes, ['usage']);
    assert.deepEqual(validateClaims('Aman disemprot ke baju tanpa noda.', 'Gunakan dengan jarak 30 cm.').unsupportedTypes, ['usage']);
    assert.deepEqual(validateClaims('Produk ini unisex.', 'Produk ini cocok untuk penggunaan unisex.').unsupportedTypes, ['usage']);
    assert.deepEqual(validateClaims('Produk ini unisex.', 'KLAIM PRODUK TERVERIFIKASI:\nProduk ini unisex.').unsupportedTypes, []);
    assert.deepEqual(validateClaims('EDT nggak menyengat dan aman buat ruangan.', 'EDT memiliki aroma ringan.').unsupportedTypes, ['usage']);
    assert.deepEqual(validateClaims('EDP menjadi favorit banyak pelanggan.', 'EDP tersedia dalam ukuran 30ml.').unsupportedTypes, ['usage']);
    assert.deepEqual(validateClaims('Wanginya menyesuaikan sama suhu tubuh dan cocok dipakai langsung ke kulit.', 'Aromanya kompleks.').unsupportedTypes, ['usage']);
    assert.deepEqual(validateClaims('Jaga jarak semprot biar tidak bernoda.', 'Semprot secukupnya.').unsupportedTypes, ['usage']);
    assert.deepEqual(validateClaims('Aman buat ruang kantor dan nggak bikin pusing.', 'Aromanya satu note.').unsupportedTypes, ['usage']);
    assert.deepEqual(validateClaims('Aman semprot ke baju tanpa noda. Spray tak menyebar.', 'Konsentrasi 66%.').unsupportedTypes, ['format', 'usage']);
    assert.deepEqual(validateClaims('Bonus box hampers dan thanks card.', 'Produk tersedia dalam ukuran 30ml.').unsupportedTypes, ['inclusion']);
    assert.deepEqual(validateClaims('Kualitas setara parfum toko.', 'Produk tersedia dalam ukuran 30ml.').unsupportedTypes, ['comparison']);
    assert.deepEqual(validateClaims('Disarankan disemprot ke baju dan jaga jarak semprot 30 cm.', 'Aromanya satu note.').unsupportedTypes, ['usage']);
    assert.deepEqual(validateClaims('Aman di ruangan tertutup.', 'Aromanya satu note.').unsupportedTypes, ['usage']);
    assert.deepEqual(validateClaims('Kesannya profesional dan nggak mencolok.', 'Aromanya satu note.').unsupportedTypes, ['usage']);
    assert.deepEqual(validateClaims('EDT paling ringan dan EDP lebih kuat.', 'Pilihan: EDT dan EDP.').unsupportedTypes, ['comparison']);
    assert.deepEqual(validateClaims('Ringan 2:1 paling ringan dan Pekat 4:1 lebih kuat.', 'Pilihan: Ringan 2:1 dan Pekat 4:1.').unsupportedTypes, ['comparison']);
    assert.deepEqual(validateClaims('Kualitasnya standar seperti toko parfum biasa dan aromanya lebih nendang.', 'Produk punya satu note aroma.').unsupportedTypes, ['comparison']);
});

test('claim cleanup removes unsupported phrase while preserving useful answer', () => {
    assert.equal(
        removeUnsupportedClaimSentences('Parfum Karakter lebih kompleks dan tahan lama. Cocok untuk malam.', 'Parfum Karakter memiliki tiga lapisan aroma.'),
        'Parfum Karakter lebih kompleks. Cocok untuk malam.',
    );
    assert.equal(
        removeUnsupportedClaimSentences('EDT — ringan\nEDP — nggak menyengat\nMurni — paling kuat', 'EDT ringan. Murni paling kuat.'),
        'EDT — ringan\nEDP —',
    );
});

test('structured catalog price overrides stale price elsewhere in Knowledge evidence', () => {
    const evidence = 'KELOMPOK HARGA TERSTRUKTUR (SUMBER KEBENARAN HARGA):\nEDT 30ml Rp35.000\nATURAN:\nDokumen lama menyebut Rp33.000.';
    assert.deepEqual(validateClaims('Harga EDT 30ml Rp35.000.', evidence).unsupportedTypes, []);
    assert.deepEqual(validateClaims('Harga EDT 30ml Rp33.000.', evidence).unsupportedTypes, ['price']);
});
