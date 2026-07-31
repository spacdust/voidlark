# Evaluasi 10 Percakapan Natural Setelah Hardening

Tanggal: 28 Juli 2026

Status dokumen: snapshot historis yang menemukan bug sebelum perbaikan lanjutan. Bagian penilaian awal di bawah dipertahankan sebagai bukti, bukan status kode terbaru.

Sumber mentah:

- `conversation-natural-evaluation-2026-07-28-1-2-3-4-5.json`
- `conversation-natural-evaluation-2026-07-28-6-7-8-9-10.json`

## Ringkasan

- Eksekusi teknis: 10/10 selesai tanpa crash.
- Lulus: 4 case (4, 5, 6, 8).
- Perlu perbaikan: 2 case (1, 2).
- Gagal perilaku: 4 case (3, 7, 9, 10).

## Penilaian per case

### 1. Santai dan banyak tanya — PERLU PERBAIKAN

Rekomendasi Inspired untuk kantor konsisten dan harga ukuran terkecil benar. Namun intent fresh-manis memicu lookup eksternal yang tidak relevan dan muncul kalimat aneh “Aromatique dari luar, bukan toko kita”. Balasan pertama juga masih berisi dua pertanyaan walau tanda tanya kedua diubah menjadi titik.

### 2. Marah karena jawaban berulang — PERLU PERBAIKAN

Harga EDP 50ml konsisten Rp75.000. Kalimat bersyarat “kalau masih nggak jelas saya mau admin” langsung dianggap permintaan handoff aktif. Deteksi perlu membedakan ancaman bersyarat dari permintaan admin sekarang.

### 3. Pelanggan dengan typo — GAGAL

Pesan budget 70 ribu dengan kebutuhan kuliah menghasilkan fallback harga tidak tersedia, padahal katalog memiliki pilihan. Turn berikutnya mengulang fallback sama. Rekomendasi terakhir menyebut EDT 30ml tetapi tetap bertanya “EDT atau EDP”, sehingga ngeyel dan tidak memilih satu opsi.

### 4. Ragu dan berubah pikiran — LULUS

Pilihan berubah 30ml → 50ml → 30ml dengan harga dan selisih benar. State, identitas customer, alamat, dan ongkir tersimpan konsisten.

### 5. Buru-buru membeli — LULUS DENGAN CATATAN

Checkout tidak lagi diambil alih fallback referensi luar. Produk EDP 30ml, harga, customer, dan ongkir tersimpan. Catatan: bot mengatakan opsi 2 hari “cocok buat besok”, padahal estimasi tidak memenuhi kebutuhan besok; seharusnya menyatakan risiko keterlambatan.

### 6. Pembeli banyak meminta diskon — LULUS

Harga normal Rp35.000, jumlah 20, subtotal Rp700.000, dan batas diskon konsisten tanpa mengarang promo.

### 7. Banyak membandingkan kualitas — GAGAL

Pertanyaan durasi tidak dijawab dengan disclaimer evidence yang benar dan bot tetap memakai klaim “tahan lama”. Intent budget di bawah Rp100.000 kembali menghasilkan fallback harga palsu. Perbandingan 30ml dan 50ml meminta dua atribut sekaligus, bukan satu klarifikasi tepat. State salah terkunci ke Murni 50ml walau customer tidak memilihnya.

### 8. Komplain pembelian lama — LULUS

Keluhan ditanggapi natural. Permintaan admin eksplisit langsung menghasilkan handoff tanpa menahan customer dengan konsultasi tambahan.

### 9. Hadiah unisex — GAGAL

“Yang kedua” berhasil dipahami secara bahasa sebagai Spicy, tetapi tidak dipertahankan sampai klasifikasi harga. Bot meminta kualitas dan ukuran sebelum menampilkan pilihan yang diminta. Nama Amber dan Spicy diperlakukan sebagai produk/rekomendasi walau bukti nama item terverifikasi tidak terlihat. Klaim tahan lama juga tidak didukung.

### 10. Salah chat lalu tertarik — GAGAL

Percakapan awal natural dan harga EDT 30ml benar. Namun “budget 50 ribu, yang fresh ada?” menghasilkan fallback harga tidak tersedia, padahal EDT 30ml Rp35.000 dan EDT 50ml Rp45.000 ada di katalog.

## Gap aktif berdasarkan bukti terbaru

1. Budget deskriptif melewati resolver harga, lalu evidence guard mengubah jawaban menjadi fallback harga palsu.
2. State dapat menyerap variasi yang hanya disebut dalam penjelasan, bukan dipilih customer.
3. Ordinal nama rekomendasi belum terhubung ke klasifikasi harga bila nama tersebut bukan item katalog terverifikasi.
4. Deteksi handoff belum membedakan permintaan sekarang dan kalimat bersyarat.
5. Batas satu tanda tanya tidak sama dengan satu pertanyaan semantik.
6. Klaim durasi dan ketahanan masih dapat lolos pada beberapa jalur.
7. Estimasi pengiriman belum dibandingkan dengan deadline customer.

Kesimpulan saat snapshot dibuat: hardening belum dapat dinyatakan menutup seluruh celah. Case checkout dan handoff komplain membaik, tetapi empat kegagalan perilaku masih memblokir acceptance 10/10.

## Status setelah perbaikan lanjutan

Tujuh gap di atas sudah ditutup pada backend dan dilindungi regression:

1. Budget dibaca dari riwayat customer dan membatasi klasifikasi serta variasi rekomendasi.
2. State hanya berubah dari pilihan eksplisit customer pada turn terbaru.
3. Ordinal nama produk dari daftar terbaru didahulukan dari daftar variasi lama.
4. Handoff bersyarat tidak dianggap permintaan admin saat ini.
5. Output guard menyisakan satu pertanyaan semantik yang paling konkret.
6. Klaim durasi numerik dan kualitatif dijaga pada preview serta WhatsApp live.
7. Deadline customer dibandingkan dengan estimasi kurir dan diberi peringatan tanpa janji tiba.

Rerun live terarah case 3, 5, 7, dan 9 memverifikasi pola yang sebelumnya gagal. Case 3 menjaga budget Rp70.000 dan memilih EDP 30ml Rp60.000; case 5 menjaga checkout serta deadline; case 7 memberi disclaimer durasi, selisih Rp15.000, dan pilihan EDP 50ml Rp75.000; case 9 menyelesaikan “yang kedua” ke Axbomba dan menampilkan semua harga kelompoknya.

Validasi kode terbaru: regression percakapan 56/56 lulus, `npm run build` lulus, `npm test` lulus, dan `git diff --check` bersih. Full 10-case live belum diulang setelah perubahan copy/tampilan terakhir; risiko variasi gaya model tetap ada dan tidak diklaim hilang total.
