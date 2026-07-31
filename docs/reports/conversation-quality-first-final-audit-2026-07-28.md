# Audit Final Conversation Quality-First — 28 Juli 2026

## Hasil

Full run kanonis: `conversation-natural-evaluation-2026-07-28-quality-first-final-audited-15.json`.

- 10 dari 10 skenario selesai tanpa crash.
- Seluruh balasan memiliki maksimal satu pertanyaan.
- Harga, subtotal, budget, klasifikasi, variasi, ordinal, dan state akhir sesuai katalog terstruktur.
- Handoff hanya terjadi pada permintaan admin eksplisit di kasus komplain.
- Daftar harga tampil vertikal tanpa tabel Markdown dan pertanyaan penutup terpisah.
- Nama rekomendasi berasal dari workbook Knowledge; daftar nama halu yang ditemukan pada run sebelumnya tidak muncul lagi.

## Perbaikan yang Dibuktikan

1. Customer marah mendapat harga langsung tanpa pertanyaan aroma atau perubahan pilihan.
2. Budget Rp70.000 untuk kuliah menghasilkan Inspired EDT 30ml Rp35.000; nama produk tetap terbawa saat customer meminta satu pilihan aman.
3. Pertanyaan ukuran terkecil menampilkan EDT, EDP, dan Murni pada 30ml.
4. Perubahan EDP 30ml ke 50ml lalu kembali ke 30ml mempertahankan harga dan state.
5. Pertanyaan `EDP 30ml ready harga berapa?` menjelaskan perpindahan kelompok, harga Rp60.000, dan batas stok tanpa mengarang availability.
6. Total 20 item dihitung menjadi Rp700.000; diskon tidak diklaim ada atau tidak ada tanpa sumber.
7. Saran setelah membandingkan EDP 30ml dan 50ml memilih 30ml serta menyebut selisih Rp15.000, tanpa melompat ke EDT.
8. Komplain terlalu manis menghindari arah manis dan permintaan admin diteruskan.
9. Permintaan dipakai berdua tidak diklaim unisex tanpa data; dua kandidat elegan berasal dari Knowledge dan seluruh harga Karakter tampil rapi.
10. Intent `parfum cowok murah` tidak menghasilkan daftar nama buatan model. Bot meminta budget, lalu memilih kandidat fresh dari Knowledge dalam batas Rp50.000.

## Scan Negatif

Semua bernilai 0 pada report final:

- nama halu temuan sebelumnya: `Ocean Blue`, `Cool Water`, `Black Wood`, `Dark Knight`, `Vanilla Tobacco`;
- disclaimer kontradiktif `Maaf Kak, belum ada daftar aroma`;
- istilah internal `klaim terverifikasi` dan `katalog internal`;
- fragmen pembuka `Misalnya`;
- pertanyaan ulang `Boleh pastikan kualitas` dan `Inspired atau Karakter`;
- tabel Markdown, fenced code, label `keluarga glamour`, klaim `ready Kak`, dan `stok aman`.

## Validasi Teknis

- `npm test`: lulus.
- `npm run build`: lulus.
- Targeted guard, formatter, catalog matcher, conversation policy, product catalog, dan claim validator: lulus.
- `git diff --check`: lulus; hanya warning line-ending Windows.

## Batas Tersisa

- Kedalaman alasan produk mengikuti detail Knowledge. Sistem tidak menebak notes, durasi, unisex, stok, bonus, atau klaim pemakaian yang belum dikurasi.
- Copy pembuka generatif tetap bervariasi antar-run. Sanitizer final menjaga struktur dan istilah terlarang; evaluasi live berkala tetap diperlukan.
- Inventory sengaja berada di luar scope. Status stok yang tidak tercantum di Knowledge tetap perlu konfirmasi admin; tidak ada rencana membangun manajemen stok di Voidlark.
