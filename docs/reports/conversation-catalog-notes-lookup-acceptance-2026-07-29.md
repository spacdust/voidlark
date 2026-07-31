# Acceptance External Catalog Notes — 29 Juli 2026

## Tujuan

Memastikan lookup eksternal memperkaya detail notes produk katalog tanpa mengubah web menjadi sumber harga, stok, ketersediaan, atau transaksi.

## Kontrak yang diverifikasi

- Parfum Inspired dicari memakai nama Inspired pada workbook.
- Parfum Karakter dipetakan ke Inspired; jawaban menyebut Inspired sebagai acuan yang dapat dimodifikasi dan tidak harus identik.
- Identity, fragrance context, struktur notes, kebutuhan aroma, dan target pemakai divalidasi sebelum hasil dipakai.
- Hasil ambigu, celebrity reference, ranking/review generik, konflik target pemakai, dan potongan prose web ditolak.
- Rekomendasi dua produk berisi dua nama berbeda beserta notes tiap item bila evidence tersedia.
- Harga, stok, diskon, state, draft, ongkir, dan checkout tetap memakai data internal.

## Bukti evaluasi

- Full acceptance: `conversation-natural-evaluation-2026-07-29-catalog-notes-lookup-acceptance.json`.
- Rerun target pemakai bersama: `conversation-natural-evaluation-2026-07-29-catalog-notes-shared-use-rerun-9.json`.
- Rerun kebutuhan wanita + manis: `conversation-natural-evaluation-2026-07-29-catalog-notes-quality-rerun-5.json`.

Full run menyelesaikan 10/10 skenario tanpa crash. Scan otomatis menemukan:

- 0 tabel Markdown;
- 0 disclaimer kontradiktif seperti `belum ada daftar aroma` setelah data tersedia;
- 0 fragmen prose web pada daftar notes;
- 0 label internal `glamour` pada copy customer;
- maksimal 1 pertanyaan per balasan.

Contoh hasil katalog:

> Kalau fokusnya aroma manis, aku paling mengarah ke Beneton United Woman dari Parfum Inspired, Kak. Dari daftar yang tersedia, varian ini paling dekat karena masuk keluarga manis. Arah parfum aslinya memuat vanila, red berries, black currant, sicilian bergamot, cotton flower, jeruk, freesia, dan peony, jadi alasan rekomendasinya bukan hanya label manis.

Contoh follow-up Karakter:

> Axbomba memakai Axe Anarki sebagai acuan, Kak. Profil parfum acuannya memuat bluberi, lavender, delima, kayu cendana, amber putih, dan amber. Karena versi Karakter dimodifikasi, susunan notes akhirnya bisa lebih berlapis dan tidak harus identik dengan parfum acuan.

## Verifikasi teknis

- Targeted external notes/claim/output regression: 37/37 lulus.
- Regression matcher terakhir: 20/20 lulus.
- `npm run build`: lulus.
- `git diff --check`: lulus; hanya peringatan normalisasi LF/CRLF worktree Windows.

## Batas aman

Lookup eksternal dapat gagal menemukan referensi yang cukup jelas. Dalam kondisi itu bot mempertahankan konteks produk dan menyatakan notes acuan belum dapat dirinci; bot tidak kembali ke fallback rekomendasi produk lain dan tidak menebak.
