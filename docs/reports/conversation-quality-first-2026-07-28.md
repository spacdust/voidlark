# Evaluasi Percakapan Quality-First — 28 Juli 2026

## Prinsip acceptance

Kualitas jawaban, konsistensi state, kebenaran fakta, dan keamanan transaksi lebih penting daripada latency. Delay pengiriman WhatsApp tidak dianggap alasan untuk melewati validasi.

## Perubahan backend

1. State dan draft WhatsApp live dikirim sebagai struktur terpisah dari Knowledge retrieval.
2. Budget terbaru disimpan lintas-turn dan tidak dipakai sebagai target untuk menghabiskan uang customer.
3. Ranking variasi menggunakan kebutuhan penggunaan lebih dahulu, lalu memilih opsi termurah pada kualitas yang cocok.
4. Konfirmasi order gagal tertutup jika produk, variasi, harga, jumlah, checkout, atau pengiriman wajib belum lengkap.
5. Perubahan klasifikasi menghapus produk lama; nama hasil tebakan model tidak boleh masuk draft.
6. Claim guard mencakup janji penggunaan dan membersihkan frasa salah tanpa mengganti seluruh jawaban.
7. Harga katalog terstruktur mengalahkan harga lama di Knowledge.
8. Daftar harga dan numbered list tetap rapi dalam maksimal tiga bubble.

## Bukti live

- `conversation-natural-evaluation-2026-07-28-quality-first.json`: run awal 10/10 selesai; menemukan kebocoran repair text, harga Knowledge lama, dan pacing yang belum konsisten.
- `conversation-natural-evaluation-2026-07-28-quality-first-2.json`: rerun 10/10 selesai; harga/state konsisten, kebocoran internal hilang, perubahan pilihan dan handoff benar.
- `conversation-natural-evaluation-2026-07-28-quality-first-final.json`: rerun case 1, 5, 7, dan 9; kebutuhan kondangan memilih EDP 30ml Rp60.000, perbandingan 30/50 tetap pada EDP, ordinal produk dan daftar harga benar.
- `conversation-natural-evaluation-2026-07-28-quality-first-checkout.json`: checkout lintas-kelompok tidak langsung menghitung ongkir; bot memilih nama produk internal baru dan meminta konfirmasi terlebih dahulu.

## Verifikasi kode

- Regression quality-first: 71/71 lulus.
- `npm run build`: lulus.
- `npm test`: seluruh suite lulus.
- `git diff --check`: bersih selain peringatan line-ending Windows.

## Batas tersisa

Bahasa model masih dapat terasa template pada sebagian turn dan beberapa fakta bisnis di Knowledge sendiri masih perlu kurasi manusia. Karena provider generatif nondeterministik, review live berkala tetap wajib. Guard backend menjamin keputusan kritis; naturalitas tetap acceptance review manusia.
