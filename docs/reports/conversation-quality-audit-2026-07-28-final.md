# Audit Percakapan Natural Quality-First — 28 Juli 2026

## Hasil

- Full run akhir: 10/10 skenario selesai tanpa crash.
- Regression terarah akhir: 66/66 lulus.
- Build TypeScript: lulus.
- Harga, subtotal, budget, state pilihan, ordinal, handoff, checkout, dan format daftar lulus pada audit manual akhir.

## Celah yang ditemukan dan ditutup

1. Language guard meratakan line break sehingga daftar harga WhatsApp menempel.
2. Pertanyaan `EDP 30ml ready harga berapa?` sempat dianggap perubahan pilihan dan menggabungkan produk lama dengan kelompok harga baru.
3. Ongkir dapat dipanggil sebelum nama produk dan seluruh variasi lengkap.
4. Penghapusan klaim per frasa meninggalkan kalimat cacat seperti `EDP —` atau tanda baca ganda.
5. Klaim tanpa evidence lolos dalam variasi bahasa: aman di ruangan, tidak bikin pusing, anti-noda, menyesuaikan suhu tubuh, stock selalu tersedia, bonus hampers, kualitas setara toko lain, dan klaim relatif paling kuat/ringan.
6. Rekomendasi keluarga aroma terdengar lebih spesifik daripada data workbook yang tersedia.

## Perbaikan

- Pertahankan line break dan bersihkan tanda baca yatim pada formatter.
- State hanya berubah dari pilihan eksplisit, bukan pertanyaan harga/stok.
- Ongkir live dan simulator fail-closed sampai pilihan transaksi lengkap.
- Klaim risiko direwrite utuh maksimal dua kali dan divalidasi ulang.
- Safety/usage, durability kualitatif, bonus, social proof, serta comparative marketing membutuhkan blok `KLAIM PRODUK TERVERIFIKASI`.
- Rekomendasi menyebut kategori terdekat dari data, tanpa mengarang notes rinci.

## Bukti laporan

- `conversation-natural-evaluation-2026-07-28-quality-first-audit-3.json`: baseline audit; menemukan format, claim, dan state checkout.
- `conversation-natural-evaluation-2026-07-28-quality-first-audit-6-final.json`: full rerun setelah hardening awal.
- `conversation-natural-evaluation-2026-07-28-quality-first-audit-10-final-full.json`: full rerun akhir 10 case.
- `conversation-natural-evaluation-2026-07-28-quality-first-audit-13-comparison-acceptance.json`: acceptance comparative marketing dan case kantor.

## Batas tersisa

Knowledge belum memiliki blok klaim terkurasi. Karena itu, bot sengaja memberi jawaban konservatif ketika customer meminta perbedaan pemakaian atau ketahanan EDT, EDP, Murni, Inspired, dan Karakter. Agar jawaban lebih kaya tanpa halusinasi, admin perlu menambahkan fakta bisnis yang telah disetujui ke blok `KLAIM PRODUK TERVERIFIKASI`.

Provider generatif tetap nondeterministik. Guard backend melindungi keputusan kritis dan kelas klaim yang diketahui; review live manusia berkala tetap wajib untuk menemukan variasi bahasa baru.
