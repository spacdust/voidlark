# Hardening Gap Percakapan — 28 Juli 2026

Scope tetap generik untuk produk fisik dan digital.

## Gap yang ditutup

1. Budget dengan kebutuhan deskriptif diteruskan ke rekomendasi berbasis Knowledge, bukan dump seluruh kombinasi murah.
2. Selisih dua variasi dihitung hanya untuk kombinasi dengan sumbu lain sama atau terkunci.
3. Nama produk pada daftar bernomor dipertahankan saat customer berkata “yang kedua” dan bentuk ordinal lain.
4. Balasan customer dibatasi maksimal satu pertanyaan oleh final-output guard.
5. Checkout valid memakai fallback internal yang mempertahankan pilihan dan harga; fallback referensi luar tidak mengambil alih.
6. Permintaan admin/manusia eksplisit langsung membuat handoff live atau state handoff simulasi.
7. Candidate/evidence guard tetap memblokir nama rekomendasi yang tidak terverifikasi.
8. Budget customer dipertahankan dari riwayat customer dan membatasi kelompok, variasi, serta harga rekomendasi berikutnya.
9. State hanya menerima perubahan dari pilihan eksplisit pada turn customer terbaru; deskripsi dan perbandingan tidak lagi mengunci variasi.
10. Ordinal produk dari daftar rekomendasi terbaru didahulukan dari ordinal variasi lama dan tetap dibawa ke jawaban harga.
11. Handoff bersyarat dibedakan dari permintaan admin saat ini; lookup eksternal dibatasi ke perbandingan produk luar eksplisit.
12. Klaim durasi numerik maupun kualitatif dijaga pada jalur preview dan WhatsApp live.
13. Deadline pengiriman dibandingkan dengan estimasi kurir, data checkout inline dinormalisasi, dan pilihan produk lama dibersihkan saat kelompok berubah.
14. Daftar harga penuh dikelompokkan berdasarkan sumbu variasi aktif agar tetap rapi untuk produk apa pun.

## Bukti verifikasi

- `npm run build`: lulus.
- `npm test`: lulus seluruh suite.
- Regression terarah terbaru: 56/56 lulus.
- Fixture universal mencakup skema parfum, paket langganan digital, kapasitas user, dan nama produk bebas.

## Bukti rerun live terarah

- Case 3: budget Rp70.000 bertahan; rekomendasi memakai nama item Knowledge dan memilih Parfum Inspired EDP 30ml Rp60.000.
- Case 5: checkout berubah ke Parfum Inspired EDP 30ml tanpa membawa nama produk Karakter lama; nama, telepon, alamat, harga, dan peringatan kebutuhan besok tetap konsisten.
- Case 7: pertanyaan durasi mendapat disclaimer; budget di bawah Rp100.000 bertahan; selisih EDP 30ml dan 50ml Rp15.000; pilihan akhir EDP 50ml Rp75.000.
- Case 9: dua nama item berbeda berasal dari Knowledge; “yang kedua” menjadi Axbomba dan jawaban harga menampilkan seluruh kombinasi Parfum Karakter.

File mentah rerun: `conversation-natural-evaluation-2026-07-28-3-5-7-9.json` dan `conversation-natural-evaluation-2026-07-28-7-9.json`.

## Batas klaim

Guard deterministik menutup pola kegagalan yang diketahui. Tidak ada sistem generatif yang dapat dibuktikan bebas semua kemungkinan output. Evaluasi 10 percakapan live tetap dijalankan berkala untuk menemukan pola baru dari provider/model.
