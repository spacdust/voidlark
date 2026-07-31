# Audit Pemulihan Kualitas Chat — 29 Juli 2026

## Hasil

- Eksekusi: 10/10 skenario selesai tanpa crash.
- Harga, selisih, dan total deterministik: lulus.
- State produk, kelompok, variasi, ukuran, jumlah, dan checkout: lulus pada rerun kritis.
- Relasi Inspired/Karakter dan ordinal: lulus.
- Guard stok, durasi, safety, dan repair text: lulus.
- Lookup notes produk katalog dan pembanding luar: lulus dengan batas evidence baru.
- Format daftar harga WhatsApp dan pemisahan pertanyaan: lulus.

## Penyebab awal

Penurunan kualitas bukan berasal dari formatter atau model saja. Cabang harga/konsultasi mengambil alih terlalu dini, state hanya percaya pesan customer dan mengabaikan rekomendasi bot, alias klasifikasi satu kata terlalu longgar, serta claim repair dapat membuang konteks lalu mengirim fallback pendek.

## Perbaikan utama

1. Resolver state parsial menyerap satu rekomendasi jelas dari balasan bot, tetapi menolak daftar ambigu.
2. Intent relasi, edukasi, harga, perbandingan, stok, durasi, safety, dan checkout mempunyai prioritas sebelum model generik.
3. Permintaan ukuran terkecil menampilkan seluruh kualitas pada kelompok aktif; “semua harga 30ml” mengabaikan kualitas lama.
4. Qty natural mempertahankan produk/variasi dan menghitung subtotal.
5. External lookup tidak memakai nama sebagai notes. Padanan “paling dekat” membutuhkan overlap notes hasil lookup kedua sisi.
6. Audience keluarga dan preferensi negatif ikut memfilter kandidat.
7. Output internal repair dan mojibake deterministik diblokir.
8. Copy jalur deterministik dipisahkan dari istilah audit internal. Fakta note-overlap tetap menjadi syarat pemilihan, tetapi customer menerima alasan natural seperti kesamaan sentuhan aroma, bukan laporan proses matcher.
9. Permintaan satu pilihan melanjutkan rekomendasi dan data harga yang sudah terkunci dengan bahasa konsultatif; bot tidak mengulang discovery yang sudah selesai.
10. Audit lanjutan 30 Juli mengubah pembanding luar menjadi alur konsultatif: profil luar dijelaskan dahulu, persetujuan customer menghasilkan hingga tiga tier berbukti, lalu pilihan baru dikunci setelah customer meminta satu opsi.
11. Detail Karakter menyebut nama Inspired konkret, mojibake notes diperbaiki, dan state harga tetap berada pada kelompok Karakter setelah follow-up aroma.

## Bukti percakapan efektif

- Case 1: budget Rp55.000, fresh, tidak manis; rekomendasi Inspired EDT 30ml Rp35.000; seluruh harga 30ml benar.
- Case 2: hadiah ayah; dua kandidat pria/woody; notes kandidat pertama berasal dari lookup.
- Case 3: Platinum 30ml Rp135.000 versus 50ml Rp180.000; selisih Rp45.000.
- Case 4: seluruh kualitas Inspired 30ml tampil vertikal.
- Case 5: produk luar tidak dijual sebagai stok toko; kandidat internal dipilih setelah overlap notes, bukan family saja.
- Case 6: `Angelina jolie -> Agolie`; Karakter 30ml Super Premium Rp120.000 dan Platinum Rp135.000; Agolie bertahan saat dipilih.
- Case 7: `Axbomba -> Axe Anarki`; suitability pria/kuliah memakai lookup audience dan recommendation tags.
- Case 8: Bodyshop Oceanus Inspired EDT 50ml Rp45.000; dua botol Rp90.000; checkout dan ongkir mempertahankan state.
- Case 9: stok, janji 12 jam, dan kulit sensitif tidak dihalusinasi; harga EDT 30ml Rp35.000 tetap dijawab.
- Case 10: edukasi Fresh/Floral/Woody dari KB; preferensi wanita, panas, dan tidak manis; ordinal kedua dijawab sebagai identitas Karakter.

Snapshot utama:

- `conversation-natural-evaluation-2026-07-29-quality-first-final-a.json`
- `conversation-natural-evaluation-2026-07-29-quality-first-final-b.json`
- `conversation-natural-evaluation-2026-07-29-quality-first-case5-evidence.json`
- `conversation-natural-evaluation-2026-07-29-quality-first-case5-final.json`
- `conversation-natural-evaluation-2026-07-30-external-reference-consultative-flow-final.json`
- `conversation-natural-evaluation-2026-07-29-quality-first-case6-verified.json`
- `conversation-natural-evaluation-2026-07-29-quality-first-final-regression.json`

## Batas jujur

Bahasa model tetap nondeterministik. Detail notes hanya boleh disampaikan bila lookup menemukan sumber yang lolos identity dan note validation. Bila lookup kandidat gagal, bot menyebut batasnya tanpa mengarang. Inventory tetap non-goal; status stok tanpa KB harus dikonfirmasi admin.
