# Audit sumber KB, setting, dan lookup — 29 Juli 2026

## Hasil

Status akhir setelah audit ulang dan perbaikan: lulus untuk seluruh celah provenance yang ditemukan.

- Acceptance efektif: 10/10 percakapan selesai.
- Produk terpilih: 6/6 ditemukan pada workbook Knowledge.
- State harga: 7/7 cocok dengan `config/product-catalog.json`.
- Build TypeScript: lulus.
- Suite luas: 87/87 lulus.
- Regression dinamis matcher, claim guard, formatter, dan source wiring: 52/52 lulus.
- Scan nilai bisnis aktif pada `src/**/*.ts`: nol nama kelompok, level, dan nominal harga aktif.
- `git diff --check`: lulus; hanya warning line-ending Windows.

## Matriks sumber runtime

| Data | Sumber | Batas |
|---|---|---|
| Nama Inspired, nama Karakter, pasangan nama, keluarga aroma | Corpus Knowledge aktif pada database | File upload mentah yang belum aktif tidak boleh dipakai matcher. |
| Jumlah note dan persentase konsentrasi | Blok `KLAIM PRODUK TERVERIFIKASI` pada KB aktif | Tidak boleh diturunkan dari harga atau web. |
| Nama kelompok, alias, peran relasi, sumbu variasi, nilai, harga, berat | `config/product-catalog.json`, dikelola dari Produk & Harga | Sumber tunggal harga dan kombinasi transaksi. |
| Sapaan, panjang balasan, gaya jual, emoji | `prompt.builder.json` + style boundary akhir | Berlaku pada output model, deterministic reply, dan fallback `askAgent`. |
| Nama bisnis, nama CS, sales flow, checkout, shipping, external lookup on/off | `business.config.json` | Mengatur alur; tidak menyimpan fakta produk. |
| Notes, family, karakter aroma, audience | External lookup terverifikasi | Tidak boleh menjadi sumber harga, stok, variasi, atau transaksi. |
| Kecocokan kebutuhan dengan kombinasi | `recommendationTags` pada Produk & Harga | Core tidak memuat nama tier atau pemetaan penggunaan bisnis. |

## Koreksi audit awal

Audit awal pada dokumen ini menyatakan scan hardcode bersih, tetapi pemeriksaan lanjutan menemukan aturan `malam -> EDP`, `harian -> EDT`, tier termurah untuk harian, kesimpulan note dari template, sapaan literal pada deterministic reply, matcher workbook mentah, dan prompt config yang dapat drift. Pernyataan awal tersebut dicabut. Status lulus di atas hanya berlaku setelah perbaikan berikut:

1. Pemilihan kombinasi memakai `recommendationTags` generik yang dikelola dari Produk & Harga.
2. Perbandingan note menampilkan kalimat klaim KB utuh, bukan interpretasi angka dari core.
3. `askAgent` dan simulator memakai satu style boundary untuk sapaan, panjang, emoji, dan gaya jual.
4. Matcher membaca corpus aktif dari Knowledge Store serta mengikat cache ke isi corpus.
5. Shipping fisik dapat dinonaktifkan, instruksi pembayaran kosong tetap kosong, dan penyimpanan config menyinkronkan prompt aktif.
6. Mutation tests memakai nama tier buatan, semantik KB yang dibalik, sapaan lain, emoji none, serta gaya soft/proaktif.

## Perbaikan hardcode

Kelompok harga plugin mendapat metadata opsional `domainRole`:

1. `reference`: kelompok yang memakai nama referensi asli dari kolom workbook untuk lookup.
2. `modified`: kelompok produk internal pasangan modifikasi.

Plugin tidak lagi mencari kata tertentu pada nama kelompok. Konsultasi juga tidak menyimpan array level aktif. Urutan tier dihitung dari rata-rata harga skema aktif; persentase tetap harus ditemukan pada KB. Claim guard dan formatter membaca nilai variasi skema aktif.

Fixture regression memakai nama buatan `Blend Asli`, `Blend Racikan`, `Ringan 2:1`, dan `Pekat 4:1`. Balasan mengikuti fixture tanpa memunculkan nama kelompok atau level bisnis saat ini. Ini membuktikan perilaku bukan bergantung pada string parfum aktif.

## Audit rekomendasi dan lookup

Produk pada state acceptance:

1. Case 1: Annasui flight funcy — ditemukan di workbook KB.
2. Case 3: Bodyshop Oceanus — ditemukan di workbook KB; dipilih setelah lookup memberi bukti target pemakai dan notes teratai air.
3. Case 5: Beneton United Woman — ditemukan di workbook KB; external memperkaya notes dan target pemakai.
4. Case 7: Axe Anarki — ditemukan di workbook KB; external memperkaya notes.
5. Case 9: Beneton Hot — ditemukan di workbook KB; ordinal pilihan tetap terjaga.
6. Case 10: Bodyshop Oceanus — ditemukan di workbook KB; harga berasal dari Produk & Harga.

External lookup tercatat pada case 1, 3, 5, 7, 9, dan 10. Semua pemakaian terkait rekomendasi, notes, atau audience. Harga state pada case 2, 3, 4, 5, 6, 7, dan 10 diverifikasi ulang melalui resolver Produk & Harga; seluruhnya cocok.

Target pemakai sekarang fail-closed. Jika customer menyebut cowok, cewek, atau dipakai berdua, matcher wajib menemukan satu hasil external yang identitas dan audience-nya cocok. Kandidat tanpa label audience tidak boleh dipakai sebagai fallback. Perbaikan ini menutup hasil salah `Angelina jolie` untuk customer cowok; rerun memilih `Bodyshop Oceanus` dengan bukti audience dan notes.

## Audit mutu chat

Total 43 balasan assistant pada run final yang dapat diaudit menghasilkan:

- 0 tabel Markdown atau karakter pipa.
- 0 balasan dengan lebih dari satu tanda tanya.
- 0 disclaimer “data aroma belum ada” yang disusul data aroma.
- 0 istilah internal seperti Knowledge, evidence, atau lookup external.
- 0 fragmen notes `lily-of-`, `fresh, juicy: lemon`, atau duplikasi `amber putih, amber`.
- 0 pertanyaan penutup menempel pada item bernomor.

## Jejak acceptance

- Case 1–5: `conversation-natural-evaluation-2026-07-29-kb-settings-source-acceptance-final-1-5.json`.
- Case 6–10: `conversation-natural-evaluation-2026-07-29-kb-settings-source-acceptance-final-6-10.json`.
- Rerun case 5: `conversation-natural-evaluation-2026-07-29-kb-settings-source-acceptance-final-rerun-5.json`.

Case 5 pada run pertama gagal di turn ongkir dengan `fetch failed`. Tiga turn AI sebelum panggilan ongkir sudah benar. Rerun case 5 selesai penuh dengan produk, variasi, harga, checkout, dan hasil ongkir yang sama. Snapshot gagal dipertahankan sebagai bukti gangguan provider, bukan dihapus.

## Batas tersisa

Tidak ada sistem generatif atau provider eksternal yang bebas kegagalan absolut. Guard saat ini menutup pola salah data yang ditemukan dan memilih tidak memberi rekomendasi bila bukti audience tidak cukup. Gangguan jaringan ongkir tetap dapat terjadi dan perlu ditangani sebagai availability provider, terpisah dari faktualitas chat.
