# Changelog

Semua perubahan penting dan kemajuan proyek CS AI WhatsApp dicatat di sini.

## [Unreleased]

- **Changed:** Pertanyaan produk referensi luar kini dijawab dengan profil notes hasil lookup terlebih dahulu, lalu menawarkan pencarian hingga tiga alternatif katalog. Persetujuan natural seperti `boleh Kak` melanjutkan referensi terakhir tanpa meminta customer mengulang nama produk.
- **Changed:** Rekomendasi pembanding luar memakai tier informatif: pilihan pertama wajib memiliki overlap notes dan boleh disebut paling mendekati; pilihan kedua/ketiga boleh menawarkan sudut family terverifikasi yang berbeda seperti lebih fresh atau lebih manis, tetapi tidak boleh diklaim sama dekatnya.
- **Fixed:** Daftar beberapa rekomendasi tidak lagi mengunci produk secara otomatis. State baru memilih satu produk setelah customer meminta atau memilih satu opsi; penjelasan hubungan Karakter-Inspired tidak boleh memindahkan state dari Karakter ke nama Inspired.
- **Fixed:** Copy detail Karakter menyebut nama Inspired konkret pada kalimat pembatas, bukan frasa generik `parfum acuannya`. Formatter juga memperbaiki mojibake aksen dan dash umum, sedangkan label notes asing yang dikenal diterjemahkan agar nyaman dibaca di WhatsApp.
- **Fixed:** Balasan deterministik tidak lagi memakai bahasa laporan sistem seperti `referensi luar ditemukan`, `kandidat dibandingkan`, atau `overlap notes`. Evidence tetap dihitung dengan aturan yang sama, tetapi alasan kepada customer disampaikan natural, misalnya kemiripan sentuhan aroma dan hubungan parfum acuan.
- **Fixed:** Konfirmasi permintaan satu pilihan kini melanjutkan konteks dengan bahasa konsultatif, menyebut produk, kelompok/variasi, dan harga yang sudah terkunci tanpa mengulang pertanyaan atau memakai frasa generik yang terasa cuek.
- **Quality:** Template aman hanya mengunci fakta dan batas klaim. Copy customer-facing wajib menjelaskan alasan dalam bahasa pembeli serta menghindari istilah retrieval, ranking, validator, evidence, dan proses internal lain.
- **Quality:** Detail aroma customer-facing merangkum maksimal tujuh notes utama yang paling relevan. Matcher tetap memakai seluruh evidence valid untuk ranking; chat tidak lagi berubah menjadi dump daftar notes panjang.
- **Fixed:** Follow-up detail aroma memprioritaskan notes yang menjadi alasan rekomendasi pada riwayat chat. Alasan seperti kesamaan vanila tidak lagi hilang saat bot kemudian merangkum profil aroma produk.
- **Fixed:** Penurunan kualitas chat ditelusuri ke routing deterministik yang terlalu dini, state parsial yang tidak menyerap rekomendasi bot, serta claim-repair fallback yang menghapus konteks. Dispatcher kini mempertahankan produk, kelompok, variasi, ukuran, jumlah, budget, dan ordinal lintas-turn; pertanyaan klasifikasi, relasi produk, edukasi, perbandingan, dan harga diprioritaskan sesuai intent.
- **Fixed:** Permintaan ukuran terkecil dan “semua harga 30ml” memakai skema aktif serta menampilkan seluruh kualitas pada kelompok yang sedang dibahas. Perbandingan satu ukuran baru terhadap ukuran terkunci menghitung dua harga dan selisihnya; kuantitas natural seperti “jadi dua botol” mempertahankan produk serta variasi.
- **Fixed:** Lookup produk luar dan produk katalog memakai batas evidence berlapis. Nama produk hanya identitas, bukan bukti notes. Padanan luar baru boleh disebut “paling dekat” setelah lookup produk luar dan kandidat katalog menemukan overlap notes; family saja tidak cukup. Karakter selalu dipetakan ke nama Inspired dari corpus KB sebelum lookup notes.
- **Fixed:** Guard deterministik menutup klaim stok, ketahanan jam, dan keamanan kulit tanpa evidence. Audience keluarga (`ayah`, `bapak`, `papa`, `ibu`, `mama`, dan pasangan) serta preferensi negatif seperti “nggak suka manis” ikut menyaring rekomendasi.
- **Fixed:** Repair text internal, fallback audit, dan mojibake pada daftar deterministik tidak lagi dikirim ke customer. Pertanyaan edukasi family aroma dijawab dari konsep KB; jawaban tetap informatif, maksimal satu pertanyaan, dan tidak buru-buru checkout.
- **Evaluated:** Sepuluh percakapan natural baru selesai 10/10 tanpa crash. Rerun terarah menutup Case 5 (external note-overlap), Case 6 (`Angelina jolie -> Agolie`), Case 8 (EDT 50ml, dua botol Rp90.000, checkout), dan Case 10 (edukasi serta ordinal Karakter). Bukti efektif: `docs/reports/conversation-quality-recovery-audit-2026-07-29.md`.
- **Tests:** Build TypeScript, suite penuh, dan regression routing/state/matcher/guard lulus pada 29 Juli 2026.

- **Evaluated:** Sepuluh percakapan natural baru dijalankan setelah hardening provenance. Seluruh case selesai tanpa crash, tetapi audit kualitas hanya meluluskan 1/10: 2 perlu perbaikan dan 7 gagal. Temuan baru mencakup state produk/variasi hilang, jawaban selisih harga berulang, daftar ukuran terkecil tidak lengkap, external facts tanpa lookup tercatat, kebocoran repair text, stok/durasi/safety tanpa evidence, audience `ayah` tidak dikenali, serta pertanyaan klasifikasi dianggap checkout. Laporan lengkap: `docs/reports/conversation-natural-evaluation-2026-07-29-new-random-natural-chat.md`.

- **Fixed:** Audit provenance lanjutan menutup celah yang sebelumnya masih berstatus sebagian/gagal. Matcher produk kini membaca pasangan, family, dan schema dari corpus Knowledge aktif di database, bukan workbook mentah pada folder; cache mengikuti isi corpus aktif sehingga versi gagal-ingest atau file lebih baru tidak dapat bocor ke rekomendasi.
- **Changed:** Produk & Harga memiliki metadata generik `recommendationTags` per kombinasi. Pemilihan tier/kombinasi menurut kebutuhan customer memakai tag Admin ini; core tidak lagi menyimpan aturan `kantor -> EDT` atau `malam -> EDP`. Tanpa tag yang cocok, resolver memilih opsi valid termurah tanpa mengklaim kecocokan penggunaan.
- **Fixed:** Balasan konsultasi mengutip kalimat klaim Knowledge utuh. Jumlah note tidak lagi dipakai untuk menempel kesimpulan hardcode seperti “konsisten” atau “berlapis”; perubahan makna pada KB langsung mengubah balasan.
- **Fixed:** Semua hasil `askAgent` live dan simulator melewati satu batas Gaya Balasan. Sapaan, larangan emoji, mode ringkas, serta gaya jual soft/proaktif berlaku juga pada jalur deterministik dan fallback; CTA proaktif tidak ditambahkan pada ringkasan transaksi, pembayaran, ongkir, atau handoff.
- **Fixed:** `enableShipping: false` sekarang dihormati untuk produk fisik dan tersedia sebagai switch Admin. Nilai `paymentInstructions: ""` tetap kosong serta menghasilkan ringkasan tanpa cara bayar buatan. Simpan Profil & Alur maupun JSON mentah langsung membangun ulang system prompt aktif dari Prompt Builder, menutup drift snapshot konfigurasi.
- **Tests:** Full `npm test`, build TypeScript, mutation tier dengan nama buatan, mutation semantik klaim KB, mutation sapaan/emoji/gaya/panjang, source scan hardcode tier/workbook, serta wiring config/prompt lulus pada 29 Juli 2026.

- **Changed:** Kelompok harga domain kini dapat diberi metadata opsional `domainRole` (`reference` atau `modified`) dari Admin Produk & Harga. Plugin fragrance memakai metadata ini untuk menentukan kolom nama asli yang dicari secara eksternal dan kolom pasangan modifikasi; penggantian nama kelompok tidak memerlukan edit core.
- **Fixed:** Konsultasi perbedaan kelompok, level, konsentrasi, dan pilihan harian tidak lagi menyimpan nama kelompok atau nilai variasi bisnis di source. Nama kelompok, alias, level, urutan harga, dan sapaan dibaca saat runtime dari Produk & Harga serta Gaya Balasan; jumlah note dan persentase tetap wajib berasal dari blok KB `KLAIM PRODUK TERVERIFIKASI`.
- **Fixed:** Permintaan target pemakai eksplisit sekarang fail-closed terhadap external audience evidence. Kandidat tanpa bukti audience yang cocok tidak boleh menjadi fallback; kata pemakaian seperti `kalem` tidak lagi dipaksa menjadi klaim notes `soft`.
- **Fixed:** Claim guard dan formatter WhatsApp membaca nilai variasi Produk & Harga aktif. Nama level fragrance tidak lagi tertanam di core maupun guard umum.
- **Fixed:** Knowledge ingestion mengabaikan lock file spreadsheet `~$*`, dotfile, file sementara, dan file kosong. Corpus aktif berhasil dimuat ulang setelah harga KB disinkronkan dengan Produk & Harga.
- **Evaluated:** Acceptance sumber final efektif 10/10. Enam produk state seluruhnya ditemukan pada workbook KB, tujuh harga state tepat terhadap `config/product-catalog.json`, lookup external hanya dipakai pada rekomendasi/notes, dan scan 43 balasan mencatat nol tabel Markdown, pertanyaan ganda, disclaimer kontradiktif, istilah internal, fragmen notes, serta CTA menempel. Satu `fetch failed` ongkir transient disimpan sebagai jejak dan case 5 lulus pada rerun.
- **Tests:** Suite luas terakhir 87/87, regression dinamis matcher/claim/formatter 52/52, build TypeScript, dan `git diff --check` lulus pada 29 Juli 2026. Scan nilai bisnis aktif pada seluruh `src/**/*.ts` menghasilkan nol temuan.
- **Changed:** Lookup eksternal kini memperkaya notes dan profil aroma produk yang sudah ada di katalog, bukan hanya membaca parfum referensi dari customer. Parfum Inspired dicari memakai nama Inspired; Parfum Karakter dipetakan ke pasangan Inspired lalu dijelaskan sebagai acuan yang dapat dimodifikasi.
- **Fixed:** Rekomendasi katalog meranking kandidat memakai notes eksternal terverifikasi, kebutuhan aroma, target pemakai, dan kelompok produk aktif. Hasil ambigu, konflik target pemakai, ranking/review generik, potongan prose web, serta sumber tanpa bukti notes ditolak.
- **Fixed:** Rekomendasi tanpa kelompok eksplisit konsisten memakai Parfum Inspired. Permintaan dua pilihan selalu mempertahankan dua nama berbeda dan menjelaskan notes tiap pilihan; follow-up Karakter tetap memakai nama Karakter sambil mencari notes melalui nama Inspired.
- **Changed:** Web tetap hanya menjadi sumber notes, family, karakter aroma, dan target pemakai. Harga, stok, ketersediaan, pilihan transaksi, draft, ongkir, dan checkout tetap berasal dari sumber internal.
- **Evaluated:** Acceptance 10 percakapan natural selesai 10/10 tanpa crash. Audit mencatat nol tabel Markdown, disclaimer kontradiktif, fragmen prose web, dan balasan dengan lebih dari satu pertanyaan. Rerun target pemakai bersama menolak kandidat eksplisit satu gender. Laporan: `docs/reports/conversation-catalog-notes-lookup-acceptance-2026-07-29.md`.
- **Tests:** Regression external catalog notes 37/37, regression matcher terakhir 20/20, build TypeScript, dan `git diff --check` lulus pada 29 Juli 2026.
- **Changed:** Manajemen inventory/stok ditetapkan sebagai non-goal. Voidlark tetap fokus pada kualitas CS; pertanyaan stok dijawab secara aman dari Knowledge atau diarahkan untuk konfirmasi admin, tanpa database stok, sinkronisasi inventory, reservasi, maupun pengurangan stok.
- **Fixed:** Quality-first kini mencakup mutu bahasa, bukan hanya correctness. Balasan mempertahankan produk, kelompok, variasi, budget, dan perbandingan terakhir; permintaan satu rekomendasi menyebut nama produk beserta pilihan/harga yang sudah diketahui tanpa mengulang pertanyaan lama.
- **Fixed:** Saran setelah perbandingan ukuran bersifat universal terhadap sumbu katalog: variasi lain tetap terkunci dan opsi lebih hemat dipilih bila customer tidak memberi alasan memilih ukuran lebih besar. Perbandingan EDP 30ml versus 50ml tidak lagi melompat ke EDT atau menjalankan rekomendasi dari awal.
- **Fixed:** Pertanyaan stok menjawab harga yang diketahui sekaligus menyatakan stok perlu dikonfirmasi bila Knowledge tidak memuat statusnya. Perpindahan kelompok akibat pertanyaan variasi dijelaskan sebelum checkout agar nama produk lama tidak terbawa diam-diam.
- **Fixed:** Intent gender+harga tanpa kebutuhan cukup tidak lagi diserahkan kepada model untuk membuat daftar nama. Bot meminta budget/kebutuhan, lalu nama rekomendasi hanya diambil dari workbook Knowledge. Label internal `glamour` diterjemahkan menjadi `manis` atau `elegan`.
- **Fixed:** Hasil rewrite claim guard selalu melewati sanitizer final sebelum response plan atau WhatsApp. Fragmen `Misalnya ...?`, persona campuran, pertanyaan menempel, dan format daftar rusak tidak dapat muncul kembali setelah guard menulis ulang jawaban.
- **Evaluated:** Full run kanonis `quality-first-final-audited-15` menyelesaikan 10/10 percakapan natural. Audit mencatat 0 nama produk halu temuan sebelumnya, 0 disclaimer kontradiktif, 0 istilah audit internal, 0 tabel Markdown, 0 label keluarga internal, dan maksimal satu pertanyaan per balasan. Laporan: `docs/reports/conversation-quality-first-final-audit-2026-07-28.md`.
- **Tests:** Suite penuh `npm test`, build TypeScript, targeted guard/catalog/formatter, dan `git diff --check` lulus pada 28 Juli 2026.
- **Evaluated:** Audit live baru menjalankan 10 percakapan natural penuh dan rerun terarah untuk format, claim, checkout, serta comparative marketing. Semua skenario selesai tanpa crash; snapshot berlabel `quality-first-audit-3` sampai `quality-first-audit-13-comparison-acceptance` disimpan terpisah sebagai jejak penemuan dan perbaikan.
- **Fixed:** Sanitizer bahasa mempertahankan line break WhatsApp. Daftar ukuran/harga yang sudah vertikal tidak lagi diratakan atau memisahkan label variasi dari nominal; baris tanda baca yatim juga dibersihkan.
- **Fixed:** Pertanyaan harga, stok, atau ketersediaan tidak lagi dianggap sebagai perubahan pilihan. Checkout yang mengikuti pertanyaan lintas-kelompok membersihkan produk lama, mempertahankan variasi terakhir, lalu meminta konfirmasi produk baru sebelum menghitung ongkir.
- **Fixed:** Tool ongkir simulator dan live gagal tertutup sampai nama produk serta seluruh variasi katalog lengkap. Ongkir tidak dapat dijalankan hanya dari tebakan model atau alamat customer.
- **Changed:** Claim guard quality-first kini merewrite balasan utuh, maksimal dua percobaan, untuk klaim risiko. Guard mencakup safety/usage, durability kualitatif, stock absolut, bonus/kelengkapan, comparative marketing, social proof, dan output terpotong; penghapusan frasa tengah kalimat tidak lagi dipakai untuk kelas klaim tersebut.
- **Changed:** Janji penggunaan, durability kualitatif, bonus, dan perbandingan mutu hanya dianggap terbukti bila ada di blok Knowledge `KLAIM PRODUK TERVERIFIKASI`. Knowledge biasa tetap menjadi sumber nama, kategori, dan deskripsi dasar.
- **Changed:** Rekomendasi keluarga aroma menjelaskan bahwa kandidat adalah pilihan terdekat dari kategori pada data katalog, bukan mengklaim profil notes rinci yang tidak tersedia.
- **Tests:** Regression terarah akhir 66/66 dan build TypeScript lulus. Full live 10-case terakhir memverifikasi harga, budget, state, ordinal, handoff, checkout, serta format; rerun acceptance menutup klaim kantor dan comparative marketing tanpa bukti.
- **Changed:** Menetapkan quality-first sebagai aturan utama percakapan. Ketepatan kebutuhan, state, evidence, dan keamanan checkout didahulukan dari kecepatan respons atau percepatan closing.
- **Fixed:** WhatsApp live menerima `chat_state` dan draft sebagai input terstruktur terpisah dari Knowledge retrieval. Budget, produk, klasifikasi, variasi, jumlah, harga, dan data customer tidak lagi bergantung pada 12 pesan terakhir saja.
- **Fixed:** Konfirmasi order sekarang fail-closed: produk, jumlah, seluruh variasi katalog, harga katalog, field checkout terkonfigurasi, serta kurir/ongkir produk fisik wajib lengkap sebelum status `awaiting_payment`.
- **Fixed:** Perubahan kelompok harga membersihkan nama produk lama. Tool draft hanya menerima nama produk yang disebut customer atau sudah tersimpan sebagai rekomendasi terverifikasi.
- **Changed:** Pilihan dalam budget memakai kebutuhan penggunaan sebelum harga: malam/kondangan memprioritaskan kualitas lebih kuat yang masih masuk budget; kantor/kuliah memprioritaskan pilihan ringan. Tanpa sinyal kualitas, sistem memilih opsi paling hemat dan menyebutnya secara jujur.
- **Fixed:** Claim guard memblokir janji penggunaan tanpa evidence seperti `sekali semprot cukup`, `lebih hemat jangka panjang`, `aman tanpa noda`, `unisex`, dan `menyesuaikan suhu tubuh`. Klaim salah dihapus per frasa tanpa membuang jawaban berguna lain.
- **Fixed:** Harga pada Produk & Harga terstruktur mengalahkan harga lama yang mungkin masih ada pada Knowledge. Formatter merapikan partial/full price list dan response plan tetap maksimal tiga bubble tanpa memotong item.
- **Evaluated:** Uji live quality-first 10/10 selesai tanpa crash. Rerun kedua menghapus kebocoran instruksi internal, menjaga harga/state, memperbaiki perubahan pilihan, handoff, budget, dan ordinal. Rerun final memverifikasi kondangan memilih EDP 30ml Rp60.000; rerun checkout menahan ongkir sampai nama produk internal lengkap.
- **Tests:** Regression quality-first 71/71 lulus; build TypeScript dan suite penuh lulus pada 28 Juli 2026.
- **Fixed:** Menutup gap lanjutan hasil evaluasi live: batas budget bertahan lintas-turn, state hanya berubah dari pilihan customer terbaru, ordinal produk mengalahkan daftar variasi lama, rekomendasi normal memakai nama item Knowledge, dan pertanyaan durasi tanpa bukti mendapat disclaimer deterministik.
- **Fixed:** Jalur WhatsApp live kini memakai claim guard yang sama dengan simulator. Klaim `tahan lama`, durasi jam, stok informal, harga, dan kandidat luar yang tidak didukung evidence diblokir sebelum dikirim.
- **Fixed:** Permintaan admin bersyarat tidak lagi langsung handoff; permintaan eksplisit tetap langsung diteruskan. Lookup eksternal hanya tersedia untuk intent perbandingan produk luar yang jelas.
- **Fixed:** Checkout mempertahankan pilihan terkunci, menghapus nama produk lama saat customer pindah kelompok, membaca nama/telepon/alamat inline, dan memberi peringatan deadline bila estimasi kurir tidak memenuhi kebutuhan customer.
- **Changed:** Daftar harga lengkap dikelompokkan menurut sumbu variasi pertama tanpa mengulang label pada setiap baris. Pertanyaan penutup selalu ditempatkan setelah daftar dan peringatan pengiriman. Implementasi membaca skema produk aktif, bukan nilai parfum tertentu.
- **Evaluated:** Rerun terarah case 3, 5, 7, dan 9 memverifikasi budget Rp70.000, perubahan checkout, disclaimer durasi, selisih harga, pilihan tunggal, ordinal nama produk, seluruh harga variasi, serta deadline pengiriman. Snapshot 10-case sebelumnya tetap disimpan sebagai bukti historis penemuan bug.
- **Tests:** Regression percakapan terarah 56/56 lulus; build TypeScript, suite penuh, dan `git diff --check` juga lulus pada 28 Juli 2026.
- **Evaluated:** Uji live 10 percakapan natural setelah hardening selesai 10/10 tanpa crash, tetapi hasil perilaku 4 lulus, 2 perlu perbaikan, dan 4 gagal. Checkout serta handoff komplain membaik; gap budget deskriptif, state variasi, ordinal produk, handoff bersyarat, pertanyaan semantik, klaim durasi, dan deadline pengiriman dicatat kembali sebagai aktif.
- **Fixed:** Menutup gap evaluasi 28 Juli secara domain-netral: budget+kebutuhan tidak lagi berubah menjadi dump harga, perbandingan dua variasi menjaga sumbu lain, ordinal mempertahankan nama produk, output dibatasi satu pertanyaan, checkout terkunci mendapat fallback internal, dan permintaan admin eksplisit langsung handoff.
- **Tests:** Menambah regression produk fisik dan paket digital untuk budget deskriptif, selisih variasi, ordinal nama produk, batas pertanyaan, handoff eksplisit, dan checkout fallback. Build TypeScript serta suite penuh lulus pada 28 Juli 2026.
- **Evaluated:** Menjalankan ulang 10 percakapan natural pada 28 Juli 2026. Harga deterministik, perubahan pilihan, total jumlah besar, diskon tanpa bukti, dan daftar kualitas pada pilihan terkecil bekerja; gap checkout fallback, handoff komplain, rujukan produk, rekomendasi budget, perbandingan variasi, serta batas satu pertanyaan dicatat di roadmap dan laporan `docs/reports/`.
- **Added:** Produk & Harga terstruktur kini mendukung kelompok, sumbu variasi dinamis, kombinasi harga, bobot pengiriman, alias klasifikasi, dan backup tanpa daftar produk hard-coded di engine.
- **Added:** Resolver harga deterministik untuk harga satuan, total berdasarkan jumlah, selisih, filter budget, daftar pilihan, diskon yang belum terverifikasi, serta pilihan terkecil berdasarkan sumbu aktif dari skema Produk & Harga.
- **Changed:** Permintaan pilihan terkecil tanpa nilai variasi lain menampilkan seluruh kombinasi pada nilai terkecil; jika customer menyebut variasi spesifik, jawaban fokus pada kombinasi tersebut dan dapat menampilkan alternatif relevan.
- **Added:** State simulasi mempertahankan rekomendasi parsial, klasifikasi, variasi, jumlah, harga terkunci, data customer, dan ongkir. Rujukan natural seperti “yang pertama”, “yang kedua”, “yang tadi”, serta “ukuran kecil” diselesaikan dari rekomendasi dan katalog aktif.
- **Fixed:** Harga tidak lagi diserahkan kepada tebakan model ketika katalog terstruktur dapat menjawab. Fallback harga palsu, subtotal salah, jumlah yang terbaca dari frasa seperti “dua pilihan”, dan kontaminasi variasi dari riwayat lama diperbaiki.
- **Fixed:** Claim guard kini menolak klaim stok informal (`ready`, `stok aman`) dan durasi jam yang tidak didukung Knowledge. Diskon/grosir tanpa data dinyatakan belum tercantum dan perlu konfirmasi, bukan diklaim tersedia atau tidak tersedia.
- **Added:** Formatter WhatsApp deterministik merapikan daftar harga vertikal, nominal rupiah terpotong, bullet strip, tabel Markdown, serta pertanyaan penutup yang menempel pada item terakhir. Disclaimer keterbatasan yang kontradiktif dihapus bila balasan sama tetap memberi rekomendasi.
- **Changed:** Policy konsultasi mewajibkan satu rekomendasi saat customer meminta pilihan terbaik, mempertahankan rekomendasi sebagai pilihan sementara, tidak menanyakan ulang variasi yang sudah jelas, dan tetap domain-neutral.
- **Added:** Evaluator percakapan natural 10-case mencakup customer santai, marah, typo, berubah pikiran, buru-buru, negosiasi jumlah besar, pembanding variasi, komplain, hadiah, dan salah chat. Laporan chat tersimpan di `docs/reports/`.
- **Fixed:** Core resolver dan fallback hasil audit 27 Juli 2026 tidak lagi menyebut nilai bisnis tertentu. Label serta nilai selalu berasal dari skema Produk & Harga aktif.
- **Tests:** Regression suite mencakup produk fisik dan non-parfum/digital untuk resolusi variasi, pilihan terkecil, harga, total, selisih, budget, diskon, rekomendasi parsial, ordinal, claim guard, dan format WhatsApp.
- **Changed:** README, PRD, dan roadmap disinkronkan dengan live code, script, Admin UI, deployment spec, serta status staging/pilot. Klaim jumlah test dan production-ready yang cepat basi dihapus.
- **Removed:** Eksperimen Admin React/Vite/Tailwind dibatalkan dan compatibility host dihapus; seluruh route Admin kembali memakai Express server-rendered HTML/CSS/JS tanpa dependency frontend tersebut.
- **Changed:** Admin dan login memakai satu lapisan UI native terinspirasi shadcn/ui: Inter Variable, IBM Plex Mono untuk data teknis, token semantik light/dark, surface satu border, radius konsisten, kontrol ringkas, focus ring, tabel responsif, dialog/toast elevated, safe-area sticky action, serta reduced motion.
- **Changed:** `docs/ROADMAP.md` dirapikan menjadi status gate-based dan tiga sprint prioritas: deployment proof, reliability/privacy proof, lalu security/operator hardening. Persentase readiness historis tidak lagi dipakai sebagai status aktif.
- **Added:** Sprint 1 deployment gates: Compose grace period 60 detik, backup/readiness env passthrough, non-root/no-new-privileges runtime, dan `npm run ops:smoke` untuk health/metrics smoke check.
- **Added:** Sprint 2 bounded shutdown drain untuk worker inbound/outbound dengan timeout `SHUTDOWN_DRAIN_TIMEOUT_MS`.
- **Added:** Sprint 2 privacy retention policy guard; `PRIVACY_RETENTION_DAYS=0` menjaga auto-purge tetap nonaktif sampai kebijakan legal disetujui.
- **Changed:** Sprint 3 mengaktifkan per-response CSP nonce untuk inline script Admin dan menghapus inline event handler pada safety metrics; inline style masih pending ekstraksi.
- **Changed:** `docs/PRD.md` disinkronkan dengan implementasi live: migration/transaction, metrics, tests, knowledge retrieval, media path, dan WhatsApp multi-number tidak lagi dicatat sebagai fitur yang belum ada.
- **Changed:** Dokumentasi kanonis dipindahkan ke `docs/PRD.md`, `docs/ROADMAP.md`, dan `CHANGELOG.md` di root. Semua update berikutnya wajib memakai lokasi ini.
- **Added:** Mengintegrasikan pembuatan QR Code lokal secara asynchronous dengan format Base64 PNG Data-URL menggunakan modul `qrcode` untuk memotong ketergantungan API pihak ketiga (`api.qrserver.com`) yang terblokir CORS/adblocker di browser.
- **Fixed:** Memperbaiki TransformError syntax `await` pada `src/whatsapp/connection.ts` dengan mengubah signature penanganan event `connection.update` menjadi async callback (`async (update) => { ... }`).
- **Fixed:** Menyesuaikan logika deteksi kredensial di `checkWhatsAppCredentialsExist` agar memverifikasi objek `data.me.id` (bukan sekadar baris creds kosong), mencegah terminal memunculkan QR Code otomatis saat startup jika sesi belum login.
- **Added:** Mengimplementasikan fitur pengisian otomatis (*auto-fill*) nomor WhatsApp yang berhasil di-scan dari state Baileys (`sock.user.id`) langsung ke form isian modal admin.
- **Fixed:** Menghilangkan inline `onclick` handler pada tombol Edit sesi WhatsApp yang diblokir oleh aturan CSP, digantikan dengan *class event listener* yang aman.
- **Changed:** Mendesain ulang (*redesign-skill*) form edit sesi WA inline dengan format vertical stack, input box tinggi 40px, rounded corners, dan background soft container demi visual yang elegan.
- **Changed:** Meningkatkan estetika kartu pengaturan `.env-card` di halaman Koneksi Sistem dengan spacing antar input yang konsisten, penambahan shadow halus, serta visual fokus input modern yang premium.
- **Removed:** Menghapus bagian "Status pemrosesan" (`3. Status pemrosesan`) dan tabel jobs pendukungnya dari halaman admin/knowledge untuk menyederhanakan alur kerja pengguna.
- **Fixed:** Memperbaiki keandalan unit test rotasi WhatsApp dengan memberikan opsi mematikan persistensi penyimpanan disk pada `WhatsAppManager` (storagePath = null) guna menghindari efek samping *state* data lokal yang memicu kegagalan tes.
- **Added:** Menyatukan pengelolaan WhatsApp ke dalam **Halaman Terpusat Manajemen WhatsApp (`/admin/whatsapp`)** yang menyatukan status multi-nomor terhubung, rotasi CS, batas kuota daily lead, rentang jeda acak anti-ban, dan batasan antrean AI.
- **Added:** Mengembangkan *WhatsApp Manager* (`src/whatsapp/whatsapp-manager.ts`) yang mendukung alokasi *Round Robin Lead Rotation*, *Least Busy*, serta *Sticky Lead Assignment* (pelanggan lama tidak berpindah nomor WA).
- **Added:** Mengembangkan *Anti-Ban Delay Generator & Typing Calculator* (`src/whatsapp/anti-ban-delay.ts`) untuk kalkulasi jeda waktu acak (*Random Min-Max Delay*) dan simulasi waktu mengetik (*composing indicator*) proporsional.
- **Added:** Mengembangkan *AI Queue Limiter* (`src/ai/ai-queue-limiter.ts`) untuk mengantrekan eksekusi panggilan AI dari banyak nomor secara paralel agar tidak melampaui rate limit API.
- **Removed:** Menghapus form "Hubungkan ulang WhatsApp" dari `/admin/settings` untuk menyatukan seluruh pengelolaan koneksi di `/admin/whatsapp`.
- **Added:** Menambahkan pengujian otomatis di `tests/whatsapp-rotation.test.ts` (19/19 tests pass).
- **Added:** Menambahkan *Citation Visualizer (Sumber Fakta Internal)* di Sandbox Admin UI (`src/admin/server.ts`), yang menampilkan chip sumber dokumen (`fileName`, `chunkIndex`, dan `relevancePercent`) untuk audit transparansi admin secara murni internal.
- **Added:** Menambahkan pengujian otomatis di `tests/hybrid-retrieval.test.ts` (14/14 tests pass).
- **Added:** Mengembangkan *Universal Domain Matcher* (`src/ai/domain-matchers.ts`) dan *Product Domain Resolver* (`src/ai/product-domain.ts`) untuk mendukung domain **Digital**, **Fashion**, dan **Elektronik** secara otomatis selain Parfum dan Umum.
- **Added:** Memperluas *Claim Validator* (`src/ai/claim-validator.ts`) dengan aturan pengecekan klaim untuk durasi lisensi (`duration`), jenis akun (`license`), ukuran pakaian (`size`), bahan kain (`material`), dan spesifikasi memori (`spec`) guna menghentikan halusinasi AI CS pada produk selain parfum.
- **Added:** Menambahkan rangkaian pengujian otomatis (*unit test suite*) baru di `tests/domain-matchers.test.ts` dan memperbarui `tests/claim-validator.test.ts` (11/11 tests pass).
- **Changed:** Merevisi UI/UX secara keseluruhan dengan menerapkan bahasa desain *soft-rounded* (elegan dan presisi). Variabel `--radius-sm` disetel ke 8px dan `--radius` diubah menjadi 12px, menghilangkan sisa-sisa sudut kotak (0px) pada komponen seperti tab, badge, theme options, pane developer, penunjuk alur langkah di halaman *Knowledge*, form pengurutan (*sort-form*), serta kartu *maintenance* (*maintenance-card*), kartu cadangan (*backup-card*), baris API key (*key-row*), baris alur jadwal (*repeat-row*), panel setup (*setup-list*), checkbox setup (*setup-mark*), cangkang simulator percakapan (*simulator-shell*), dan tombol reset simulasi di halaman *Sandbox*.
- **Fixed:** Menghilangkan garis pembatas (border) ganda yang bertumpuk antara judul halaman (Ringkasan) dan panel *Perlu dilakukan sekarang* untuk tampilan yang lebih bersih.
- **Removed:** Menghapus fitur Assign Operator dan input Catatan Penyelesaian pada halaman Handoff untuk menyederhanakan alur kerja.
- **Changed:** Perintah `npm run dev` pada `package.json` sekarang menggunakan `tsx watch` agar server otomatis restart jika ada perubahan kode.
- **Fixed:** Memindahkan inline event handler (`onclick`, `onchange`) yang sebelumnya diblokir oleh CSP (Content-Security-Policy) ke event listener global. Tombol "Batal" pada modal pelanggan dan pengiriman otomatis (auto-submit) pada dropdown status pelanggan sekarang berfungsi normal.
- **Fixed:** Dropdown status pelanggan kini mewariskan warna spesifik (`tone-*`) ke setiap opsinya, sehingga menu warna-warni (hijau untuk Selesai, merah untuk Batal) muncul dengan benar sesuai jenis status.
- **Fixed:** Rute backend pembaruan status dari dropdown tidak lagi mengubah/memaksa ID pelanggan (JID) menambahkan `@s.whatsapp.net`, melainkan menggunakan raw JID sesuai dari database, sehingga penyimpanan status tidak lagi gagal dalam mode senyap.
- **Improved:** Form textarea pada halaman konfigurasi Prompt & Alur kini memiliki ketinggian awal yang lebih ringkas, fungsi tarik ubah ukuran (resize) dibatasi hanya ke arah vertikal, dan akan otomatis memanjang ke bawah menyesuaikan banyaknya konten di dalamnya.
- **Fixed:** Logika AI dalam mengekstrak nama pelanggan pada agen AI disesuaikan agar tidak menangkap keluhan atau luapan amarah panjang pelanggan sebagai entri nama.
- **Fixed:** CSP (Content-Security-Policy) kini mengizinkan Google Fonts. Directive `font-src` ditambahkan dengan whitelist `https://fonts.googleapis.com` dan `https://fonts.gstatic.com`, serta `style-src` diperluas untuk mengizinkan `https://fonts.googleapis.com`. IBM Plex Sans dan Mono dari `@import` admin dan login tidak lagi diblokir browser.
- **Changed:** Pemisahan bubble untuk numbered list kini menggunakan logika yang lebih sederhana: text intro (sebelum list) menjadi bubble terpisah, lalu setiap item numbered list (`1.`, `2.`, dst) langsung dijadikan bubble tersendiri. Orphaned list markers (pattern `"tersebut: 1."` diikuti paragraph break) otomatis digabung dengan konten berikutnya. Hasil: rekomendasi produk dengan list tidak akan terpotong lagi antara nomor dan deskripsinya.
- **Changed:** Dokumentasi project dikonsolidasikan ke struktur kanonis `docs/` dan root repository; `AGENTS.md` berganti nama menjadi `PRD.md`.
- **Changed:** Semua pembaruan dokumentasi berikutnya wajib ditulis ke `CHANGELOG.md`, `docs/PRD.md`, dan `docs/ROADMAP.md` sesuai jenis perubahannya.
- **Fixed:** Fitur `Rapikan dengan AI` kini meminta respons non-stream secara eksplisit dan tetap dapat membaca provider yang mengembalikan SSE `data: {...}`; error `Unexpected token 'd'` tidak lagi terjadi.
- **Improved:** `Rapikan dengan AI` kini menghitung kolom yang benar-benar berubah, menyorot setiap field hasil AI, dan menjelaskan jika tidak ada perubahan; pengguna tidak lagi mendapat pesan sukses generik ketika hasil terlihat sama.
- **Fixed:** Instruksi `Rapikan dengan AI` tidak lagi membatasi penyuntingan ke beberapa field. AI kini wajib menyunting setiap kolom, memperbaiki typo/ejaan/struktur, mempertahankan fakta bisnis, menggabungkan duplikasi, dan mengembalikan semua key builder; respons tidak lengkap ditolak.
- **Changed:** Status `Rapikan dengan AI` kini memakai bahasa berorientasi form (`1 form diperbarui`) dan menandai bagian yang berubah, bukan menampilkan jumlah kolom internal yang membingungkan.
- **Fixed:** Simulator tidak lagi mengirim seluruh Knowledge (sebelumnya sekitar 753 ribu karakter/188 ribu token) ke setiap request. Context dipilih berdasarkan pesan dan riwayat, dibatasi 7 ribu karakter, history dibatasi 12 pesan, dan output 600 token. Jika provider tetap menolak karena context/TPM, simulator otomatis mencoba sekali lagi dengan Knowledge 2.500 karakter dan output 500 token.
- **Fixed:** Agent WhatsApp produksi memakai budget Knowledge, history, dan output yang sama dengan simulator sehingga model kecil tidak hanya berhasil pada preview, tetapi juga pada chat WhatsApp asli.
- **Fixed:** Adapter completion lintas model menangani provider OpenAI-compatible yang mengembalikan SSE meskipun `stream: false`, termasuk `content`, reasoning-only chunks, dan tool-call fragments. DeepSeek tidak lagi menghasilkan balasan kosong karena OpenAI SDK salah membaca respons SSE sebagai completion non-stream.
- **Changed:** Keterangan `ID model AI` di Koneksi Sistem kini provider-agnostic, memberi contoh Groq, DeepSeek, dan Gemini, serta menjelaskan trade-off model hemat terhadap kualitas konsultasi dan tool calling.
- **Fixed:** Jika reasoning model menghabiskan completion tanpa menghasilkan `content`, simulator melakukan final-answer retry dengan context ringkas, tanpa tool schema, dan budget output lebih besar; jika provider tetap kosong, digunakan fallback customer-safe, bukan `Tidak ada balasan.`.
- **Fixed:** Simulator mendeteksi `finish_reason=length` dan akhir kalimat yang jelas terputus (misalnya berhenti pada `Kakak lebih`). Sistem meminta continuation dengan context ringkas, menggabungkannya tanpa mengulang bagian awal, dan memastikan jawaban berakhir lengkap.
- **Added:** Simulator memakai adaptive multi-bubble response: jawaban singkat tetap satu bubble, paragraf bermakna menjadi maksimal tiga bubble, dan paragraf panjang hanya dipisah pada batas kalimat.
- **Added:** Bubble simulator ditampilkan bertahap dengan typing indicator dan delay berdasarkan panjang pesan; riwayat menyimpan gabungan jawaban sebagai satu turn assistant.
- **Added:** Request dan bubble lama dapat dibatalkan saat reset atau respons baru dimulai melalui generation token dan `AbortController`.
- **Added:** Test runner Node dan lima regression test untuk response plan: single bubble, semantic paragraphs, sentence-boundary split, batas tiga bubble, dan fallback output kosong.
- **Fixed:** Markup tool native DeepSeek/DSML tidak lagi bocor ke chat customer. Adapter mengenali `invoke` dan `parameter`, menjalankan tool preview yang diizinkan, lalu meminta jawaban final tanpa markup internal.
- **Fixed:** Typing indicator bubble pertama kini tampil minimal 650 ms meskipun provider menjawab sangat cepat; bubble berikutnya tetap memiliki typing delay adaptif.
- **Fixed:** Escape newline pada script simulator diperbaiki. Sebelumnya `join('\n\n')` dirender sebagai newline literal di dalam string JavaScript, menyebabkan seluruh script admin gagal diparse; browser lalu melakukan submit form biasa, memuat ulang halaman, menghilangkan riwayat, dan tidak menampilkan typing indicator.
- **Fixed:** Final-output guard menghapus blok DSML dan `environment_details`, mencegah path/metadata workspace bocor, serta meminta regenerasi jika markup internal tidak menyisakan jawaban customer-facing.
- **Fixed:** Output simulator diwajibkan berbahasa Indonesia. Aksara China dideteksi, dibersihkan, lalu jawaban diregenerasi dalam Bahasa Indonesia bila model menghasilkan campuran seperti `aku推荐`.
- **Fixed:** Raw DSML tidak lagi dimasukkan kembali ke history model setelah tool tekstual terdeteksi, sehingga DeepSeek tidak terdorong mengulang markup. Jika sanitasi menghapus seluruh output, endpoint kini selalu mengembalikan fallback customer-safe non-kosong.
- **Fixed:** Simulator tidak lagi bergantung pada kepatuhan model untuk lookup produk luar. Pertanyaan eksplisit `mirip <produk>` dan follow-up referensial seperti `yang paling mirip aja` memicu Tavily/Brave secara deterministik sebelum completion; hasil web dimasukkan sebagai referensi terverifikasi dan sumber tampil di `usedTools`.
- **Fixed:** Evidence guard menolak penawaran format `roll on` atau `spray` jika format tersebut tidak ditemukan pada Knowledge relevan. Jawaban diregenerasi berdasarkan bukti katalog; jika tetap mengarang, digunakan fallback aman.
- **Fixed:** Sanitizer menghapus blok `<environment_details>` yang lengkap maupun yang tidak memiliki closing tag, sehingga metadata workspace tidak dapat menempel di akhir bubble.
- **Fixed:** Jika deterministic web lookup sudah menghasilkan referensi, native tools dinonaktifkan untuk turn tersebut agar model tidak mengulang pencarian/DSML. Jika model tetap gagal menjawab, fallback mempertahankan ringkasan fakta web dan hanya menyerahkan pencocokan katalog ke admin.
- **Fixed:** Boundary sanitizer kedua diterapkan tepat sebelum JSON simulator dikirim, pada `reply` dan setiap bubble. Ini menjadi pertahanan terakhir terhadap DSML, `environment_details`, aksara China, dan bubble kosong.
- **Added:** Deterministic aroma pipeline membaca arah kolom `Nama Item` (Inspired) dan `karakter` langsung dari `penggolongan-notes.xlsx`, mengekstrak notes/family dari referensi web, lalu memberi model maksimal tiga kandidat terverifikasi.
- **Added:** Skor matcher memprioritaskan kecocokan nama-note eksplisit (misalnya Pear atau Melon) di atas kecocokan keluarga aroma generik; family match menjadi fallback terukur, bukan tebakan bebas model.
- **Refactor:** External lookup kembali multi-produk. Search query dibentuk berdasarkan domain (`fragrance` atau `generic`), fallback memakai nama bisnis dari Config, dan tidak lagi menyaring hasil generik memakai kosakata parfum.
- **Refactor:** Matcher parfum bersifat plugin/capability-based: hanya aktif bila system prompt/Knowledge menunjukkan domain fragrance dan XLSX benar-benar memiliki schema `Nama Item`, `karakter`, dan `Note`. Katalog non-parfum tidak dipaksa melewati logika aroma.
- **Refactor:** Ditambahkan kontrak `DomainMatcher` dan registry. Core preview agent kini hanya meminta `policy`, `profileEvidence`, dan `candidateEvidence`; seluruh cabang ekstraksi/scoring domain dipindahkan ke plugin fragrance atau generic fallback.
- **Changed:** Kontrak `knowledge.schema.json` dihapus agar pergantian produk tidak menambah input atau konfigurasi tersembunyi. Domain tetap dideteksi otomatis dari Profil & Alur, Gaya Balasan, dan Knowledge.
- **Added:** Universal claim validator memblokir klaim harga, stok, garansi, dan format produk yang tidak ditemukan pada evidence. Satu repair pass dijalankan; output yang tetap melanggar diganti fallback aman.
- **Changed:** Halaman Gaya Balasan memakai progressive disclosure: dua langkah utama dibuka sebagai accordion, aturan operasional diringkas, panel ringkasan tetap terlihat di desktop, dan contoh chat customer/bot diperbarui langsung saat gaya diedit.
- **Fixed:** Preview chat tidak lagi menggabungkan teks instruksi `greeting` dan `style`. Contoh customer-facing dibentuk dari preset serta nama CS/bisnis aktual. Indikator bagian kini mengikuti accordion aktif dan progress bar berubah dari bagian 1 sampai bagian terakhir.
- **Changed:** Indikator langkah pada Gaya Balasan dihapus karena tidak memberi nilai cukup. Route admin kini memakai `Cache-Control: no-store` agar browser tidak menampilkan markup/preview versi lama setelah server diperbarui.
- **Security:** Phase 0 menambahkan login admin, session cookie HttpOnly/SameSite Strict dengan expiry, CSRF untuk seluruh mutasi, Origin check, login/admin rate limit, Helmet headers+CSP, error generik, dan ignore runtime/secrets.
- **Fixed:** Login lokal memakai cookie `voidlark_admin`; prefix `__Host-` hanya digunakan pada production HTTPS karena browser dapat menolak prefix tersebut tanpa flag `Secure`. Halaman login didesain ulang dan mendapat kontrol tampil/sembunyikan password yang aksesibel.
- **Changed:** Visual login diselaraskan dengan admin utama: IBM Plex Sans/Mono, token abu-abu dan teal yang sama, radius 4px, panel berbatas, topbar utilitarian, dark-theme preference, serta state submit dan password visibility yang konsisten.
- **Fixed:** Validasi Origin admin kini membandingkan host+port, bukan string scheme penuh. Edit melalui reverse proxy HTTPS tidak lagi salah ditolak ketika Express menerima koneksi HTTP internal; origin dengan host berbeda tetap ditolak.
- **Added:** Domain root `/` kini session-aware: pengguna tanpa session diarahkan ke `/admin/login`, sedangkan pengguna yang sudah login diarahkan ke `/admin`. Semua subhalaman `/admin/*` tetap dilindungi middleware autentikasi.
- **Fixed:** Origin validation menerima alias loopback (`localhost`, `127.0.0.1`, `::1`) dan `X-Forwarded-Host` dari reverse proxy, sehingga save/upload sah tidak ditolak. Host asing tetap 403 dan kini mendapat halaman error admin, bukan white screen teks.
- **Fixed:** Origin string comparison dihapus dari mutasi admin karena tetap rapuh di browser/proxy. Perlindungan kini memakai CSRF token dan `Sec-Fetch-Site`; request `cross-site` ditolak, sedangkan form same-origin dan upload multipart native diterima. Config save dan upload diuji live menghasilkan redirect sukses.
- **Added:** Tombol `Keluar` ditambahkan di bagian bawah navigasi admin. Logout memakai POST+CSRF, menghapus session server-side dan cookie, lalu mengarahkan ke halaman login.
- **Changed:** Login kini memiliki overlay loading dan transisi sukses sebelum membuka dashboard; logout menampilkan overlay pengakhiran sesi setelah konfirmasi. Keduanya menghormati reduced-motion.
- **Changed:** Bagian Perawatan teknis dan Backup & pemulihan di Koneksi Sistem disusun ulang menjadi kartu tugas yang responsif, danger-zone yang jelas, file picker utuh, hierarki section bernomor, dan catatan keamanan backup.
- **Fixed:** Intersepsi login berbasis `fetch(..., redirect: manual)` dihapus karena browser dapat menghasilkan opaque redirect/halaman kosong. Login kembali memakai navigasi form native yang andal; overlay loading tetap tampil selama request dan sukses dikonfirmasi melalui toast dashboard.
- **Added:** Fase 1 Durable Message Pipeline: seluruh batch `messages.upsert` dipersist, dideduplikasi lewat provider ID, diklaim dengan lease, diserialkan per JID, dan dibatasi concurrency global. Retry memakai exponential backoff+jitter serta dead-letter.
- **Added:** Outbound WhatsApp kini melewati persistent outbox dengan dedupe key, retry, provider message ID, dan pembaruan status `delivered`/`read` dari event Baileys.
- **Added:** Dashboard menampilkan jumlah antrean bermasalah; Koneksi Sistem menampilkan inbound/outbound retry/dead-letter beserta kontrol retry manual.
- **Added:** Paket A-E production-hardening: logger PII-safe dan full test runner; durable queue/outbox; migration dan transaksi order/payment; audit+backup/restore; media/voice/location; handoff SLA, jam bisnis, consent; knowledge ingestion atomik; metrics, SLO, readiness, CI/CD, container supervision, runbooks, dan resilience drills offline.
- **Fixed:** Final adversarial hardening mewajibkan password production kuat, membuat active handoff race-safe, menambahkan savepoint nested PostgreSQL, mempertahankan placeholder SQLite bernomor, dan membuat 105 test lintas file selesai deterministik di Windows.
- **Fixed:** GET `/admin/prompt` tidak lagi menulis ulang `system_prompt.txt`. Prompt aktif dipertahankan dan hanya berubah melalui submit eksplisit Gaya Balasan; regression test memastikan halaman baca tidak dapat menghapus atau menggantinya.
- **Changed:** Prompt aktif dipindahkan dari root `system_prompt.txt` ke `config/system-prompt.txt`; runtime AI, Admin, backup konfigurasi, Docker, test, dan dokumentasi memakai path baru.
- **Removed:** Artefak root yang terbukti tidak dipakai: `clear-db.js`, stale `src/index.js`, serta cache OCR `eng.traineddata` dan `ind.traineddata` yang dapat dibuat ulang otomatis oleh Tesseract.
- **Changed:** Audit UX admin merapikan Dashboard menjadi lima KPI sejajar, memadatkan detail status AI panjang, menyederhanakan Profil & Alur, mengganti bobot ongkir menjadi input label+gram, menambah handoff setelah rekap pembayaran, dan membuat jam operasional/consent lebih ramah pengguna.
- **Changed:** Katalog & Informasi memakai hierarki langkah dan istilah pemrosesan yang mudah dipahami; Calon Pelanggan memperoleh waktu serta sorting; Riwayat Percakapan dapat dicari lewat nama/nomor dan memakai metadata, jam presisi, serta pemisah tanggal.
- **Fixed:** Tombol tes koneksi kini mengirim jenis tes yang benar dan ditempatkan dekat API key; perawatan menerima nomor/JID customer tanpa `@lid`; backup config v2 mencakup semua setting non-secret; antrean pesan bermasalah dipindahkan ke Perlu Ditangani.
- **Fixed:** CI tidak lagi gagal pada `npm audit --audit-level=high`; parser SheetJS `xlsx` yang memiliki advisory tanpa fix diganti dengan `exceljs` dan dukungan spreadsheet dibatasi ke XLSX/CSV.
- **Changed:** Isi `knowledge_base/` tidak lagi dilacak Git; file lokal tetap tersedia, sedangkan repository hanya menyimpan `.gitkeep`.
- **Refactored:** Product intelligence kini memilih strategi `fragrance` atau `generic` dari system prompt dan Knowledge relevan. Query web parfum memakai fragrance notes, sedangkan produk lain memakai spesifikasi resmi dan tidak menjalankan XLSX aroma matcher.

## [2026-07-15]

### Admin UI dan Identitas Visual

- **Changed:** Admin di-redesign menjadi `Editorial Industrial Control Desk`: IBM Plex Sans/Mono, cyan signal accent, low-radius geometry, divider tegas, permukaan flat, dan light/dark/system mode.
- **Changed:** Navigasi menggunakan bahasa yang lebih ramah pengguna: Ringkasan, Profil & Alur, Gaya Balasan, Katalog & Informasi, Simulasi Percakapan, Perlu Ditangani, Riwayat Percakapan, Calon Pelanggan, Pesanan, dan Koneksi Sistem.
- **Changed:** Slogan brand menjadi `Quiet AI. Precise Service.`.
- **Fixed:** Seluruh icon font dan SVG path custom diganti inline SVG resmi Phosphor Core untuk mencegah icon kosong atau rusak.
- **Fixed:** Sidebar desktop memiliki area scroll internal agar semua menu, termasuk Koneksi Sistem, selalu dapat diakses.
- **Changed:** UI memakai satu density yang nyaman; density switch dihapus.
- **Changed:** Dark mode dirancang ulang dengan palet industrial tersendiri dan kontras yang lebih nyaman.
- **Changed:** Tabel tetap menjadi struktur data utama pada mobile dengan horizontal touch scrolling, bukan diubah menjadi banyak card.
- **Improved:** Modal memiliki focus trap, Escape, focus restoration, dan inert background; form, tabel, status, dan navigasi mendapat semantic/accessibility improvements.

### Ringkasan dan Onboarding

- **Added:** Checklist Kesiapan Bot untuk Profil & Alur, AI, Knowledge, dan WhatsApp.
- **Added:** Panel `Perlu dilakukan sekarang` untuk handoff, pembayaran, AI, Knowledge, dan WhatsApp.
- **Changed:** Checklist Kesiapan Bot dapat ditutup dan dibuka kembali; preferensi disimpan di browser.
- **Fixed:** Indikator teks `OK` diganti icon check Phosphor resmi.
- **Changed:** Dashboard menjadi action-first dengan metric rail, service health, handoff timeline, order ledger, dan progress kesiapan.
- **Changed:** Dashboard refresh otomatis setiap 30 detik.

### Profil, Shipping, dan Koneksi Sistem

- **Changed:** Shipping tidak memiliki switch manual; otomatis aktif untuk produk fisik dan nonaktif untuk produk digital.
- **Changed:** Menu App, PORT, dan NODE_ENV dihapus dari Settings.
- **Added:** Development memilih port kosong mulai 3000; mode runtime ditentukan otomatis dari source atau build `dist`.
- **Changed:** Settings dikelompokkan menjadi Koneksi Utama dan Fitur Pendukung.
- **Changed:** Lookup eksternal dan Handoff disusun ulang agar layout Settings lebih rapi.
- **Changed:** Nomor admin menerima format awam seperti `081234567890` dan dinormalisasi otomatis menjadi JID WhatsApp.
- **Added:** Tombol tes koneksi AI, ongkir, dan Tavily.
- **Changed:** Field Brave dihapus dari UI; Tavily menjadi pilihan free-tier yang direkomendasikan.
- **Added:** Shortcut untuk memperoleh API key Komerce dan Tavily.

### API Key Editor dan Provider Rotation

- **Added:** API Key List Editor untuk RajaOngkir dan Tavily: satu key per baris, primary/backup order, masking, lihat, salin, tambah, hapus, dan reorder.
- **Added:** Konfirmasi inline sebelum menghapus API key dan validasi key duplikat.
- **Changed:** Backend tetap menyimpan beberapa key dalam format koma agar kompatibel dengan auto-rotation lama.
- **Added:** Tavily dan backend lookup mendukung beberapa key dengan auto-rotate saat limit atau invalid.
- **Added:** RajaOngkir mendukung beberapa key dengan auto-rotate saat limit atau invalid.
- **Changed:** External lookup tetap menggunakan Knowledge terlebih dahulu, lalu provider eksternal dan cache `lookup_cache` selama tujuh hari.

### Prompt Builder dan System Prompt

- **Changed:** `prompt.builder.json` menjadi sumber kebenaran tunggal untuk perilaku bot.
- **Changed:** `system_prompt.txt` selalu digenerasikan dari form Gaya Balasan dan fakta dari Profil & Alur.
- **Removed:** Editor raw prompt sebagai sumber prompt kedua.
- **Changed:** Form mencakup karakter, gaya bahasa, identitas, alur konsultasi, aturan produk generik, checkout, pengiriman, handoff, formatting, dan aturan tambahan.
- **Fixed:** Generator tidak lagi menggandakan aturan dari Form dan Config; Profil & Alur hanya menyumbang satu blok fakta bisnis.
- **Fixed:** Hardcode parfum, klasifikasi, level, ukuran, dan harga dihapus dari Prompt Builder dan system prompt.
- **Changed:** Seluruh fakta produk, kategori, harga, stok, relasi, dan pengecualian bisnis harus berasal dari Knowledge.
- **Changed:** Halaman Gaya Balasan menjadi lebih terarah dengan Ringkasan Gaya Aktif, Pemeriksaan Otomatis, CTA Simulasi, dan system prompt final read-only.
- **Changed:** Istilah teknis seperti Handoff & Formatting diganti dengan bahasa tugas pengguna.
- **Validated:** Save round-trip form menghasilkan `system_prompt.txt` yang stabil dan identik dengan preview final.

### Knowledge dan Koreksi Data Bisnis

- **Changed:** Upload Knowledge otomatis menjalankan reload dan langsung menerapkan informasi ke bot.
- **Removed:** Tombol reload manual dari alur utama Katalog & Informasi.
- **Added:** Batas upload 10 MB per file dan maksimal 30 file.
- **Added:** File dengan nama sama mendapat nama unik dan tidak ditimpa diam-diam.
- **Changed:** Pesan upload, delete, dan reload Knowledge dibuat lebih ramah pengguna.
- **Fixed:** Knowledge parfum menegaskan Uniblack sebagai Parfum Karakter dengan referensi KZ Leupar Man + Exist dan acuan Paco Olympea Intense.
- **Fixed:** Harga Uniblack mengikuti kategori Karakter, bukan Inspired.
- **Changed:** Aturan `Nama Item = Inspired` dan `karakter = Karakter` tetap menjadi data khusus Knowledge bisnis aktif, bukan hardcode engine multi-bisnis.

### Simulasi Percakapan

- **Added:** Halaman Simulasi Percakapan bergaya WhatsApp tanpa menulis database atau mengirim WhatsApp.
- **Changed:** Identitas CS diletakkan pada header halaman; panel chat hanya berisi percakapan, composer, dan status preview.
- **Added:** Optimistic customer bubble, input langsung kosong, typing indicator, dan bot/error bubble tanpa reload halaman.
- **Added:** `Enter` mengirim dan `Shift+Enter` membuat baris baru.
- **Added:** Riwayat multi-turn maksimal 20 pesan disimpan di `sessionStorage` per tab dan dikirim ke AI.
- **Added:** Tombol `Mulai ulang percakapan` yang jelas di atas panel chat.
- **Changed:** Prompt preview diwajibkan membaca riwayat, tidak mengulang sapaan/pertanyaan, dan memahami rujukan seperti `yang tadi` atau `yang paling mirip`.
- **Fixed:** Preview menggunakan AI client runtime agar perubahan endpoint, key, dan model terbaru langsung terbaca.
- **Fixed:** Timeout preview dinaikkan menjadi 75 detik dan transient timeout/connection error di-retry satu kali.
- **Added:** Progress status bertahap: bot sedang mengetik, mencari jawaban terbaik, dan model sedang sibuk.
- **Added:** Endpoint JSON `/admin/sandbox/reply` untuk balasan interaktif.

### AI Health dan Monitoring

- **Added:** `src/ai/health.ts` untuk validasi endpoint, API key, model, dan inference nyata.
- **Changed:** Probe AI dilakukan bertahap melalui `/models` lalu `/chat/completions`.
- **Fixed:** Model valid dengan cold start tidak lagi mendapat false-negative timeout lima detik.
- **Added:** Status `ready`, `slow`, `missing`, `unreachable`, `unauthorized`, `model_not_found`, dan `error`.
- **Changed:** Status AI yang sama digunakan oleh Ringkasan, Koneksi Sistem, tombol tes, Simulator, dan `/health`.
- **Added:** Cache status AI lima menit dan invalidasi setelah Settings berubah.
- **Added:** Endpoint `/health` untuk database, WhatsApp, AI, shipping, lookup, dan uptime.
- **Added:** Global error page dengan kode referensi request.

### Order, Handoff, dan Riwayat

- **Added:** Halaman detail pesanan dengan produk, varian, quantity, harga satuan, subtotal, ongkir, total, customer, alamat, dan data tambahan.
- **Fixed:** Total order menghitung `harga satuan x quantity + ongkir`.
- **Added:** Shortcut Riwayat Percakapan dan Hubungi di WhatsApp dari detail pesanan/handoff.
- **Changed:** Handoff tidak dibuat berulang untuk JID yang sama.
- **Fixed:** Pesan customer tetap disimpan saat handoff aktif meskipun bot berhenti auto-reply.
- **Changed:** Copy `Kembalikan ke bot` menjadi `Selesai - aktifkan bot`.
- **Changed:** Status internal order/lead dan WhatsApp diterjemahkan ke bahasa Indonesia.
- **Changed:** Chat dinamai Riwayat Percakapan agar sesuai fungsi sebenarnya.
- **Changed:** Pesan admin `marked paid` dilokalkan menjadi `ditandai lunas`.

### Backup dan Recovery

- **Added:** Export backup untuk `business.config.json`, `system_prompt.txt`, `prompt.builder.json`, dan seluruh Knowledge.
- **Added:** Preview backup sebelum restore dengan token sementara 15 menit.
- **Added:** Validasi versi, whitelist file, nama file Knowledge, dan konfirmasi sebelum restore.
- **Changed:** Backup sengaja tidak menyertakan `.env`, API key, database customer, atau sesi WhatsApp.
- **Added:** Restore otomatis memuat ulang Knowledge setelah diterapkan.

### Audit Production Readiness

- **Added:** `docs/ROADMAP.md` berisi roadmap production hardening lengkap.
- **Audited:** Product workflow, security, reliability, observability, testing, backup, deployment, dan failure modes.
- **Assessed:** Production readiness keseluruhan saat ini sekitar 35-40% ketika reliability, security, tests, monitoring, dan deployment ikut dihitung.
- **Identified:** Prioritas utama adalah admin auth/CSRF, durable inbound queue, message deduplication, per-JID ordering, outbound outbox, transactional state, versioned migrations, automated tests, database backup, structured logs, dan observability.
- **Identified:** WhatsApp saat ini baru memproses teks; media, delivery/read receipt, consent, business hours, assignment/SLA handoff, dan payment gateway masih masuk roadmap.
- **Security:** `npm audit` menemukan satu high-severity vulnerability tanpa fix otomatis pada dependency spreadsheet chain.

### Documentation

- **Changed:** `docs/PRD.md` diperbarui dengan arsitektur, prompt model, UI, AI health, simulator, Knowledge, order, backup, batasan production, dan workflow terbaru.
- **Added:** `docs/ROADMAP.md` sebagai roadmap utama pekerjaan berikutnya.
- **Changed:** `CHANGELOG.md` dirapikan agar kondisi final hari ini tidak bercampur dengan implementasi sementara yang sudah diganti.

## [2026-07-11]

- **Added:** Chat History / Memory AI menyimpan riwayat percakapan per customer dan mengirim 20 pesan terakhir sebagai konteks.
- **Added:** Tabel `chat_history`, `leads`, dan `handoff_log`.
- **Added:** Modul `src/chat/history.ts`, `src/chat/leads.ts`, dan `src/chat/handoff.ts`.
- **Added:** Tool `simpanDataPelanggan` dan `escalateToHuman`.
- **Added:** Notifikasi handoff ke admin dan command `#resolve <jid>`.
- **Added:** Schema terpusat di `src/config/schema.ts`.
- **Changed:** `askAgent` mengembalikan `AgentResult` dan mendukung multi-tool loop.
- **Fixed:** Output TypeScript diarahkan ke `dist` dan type errors utama diperbaiki.

## [2026-07-10]

- **Added:** Dokumentasi project awal untuk pedoman arsitektur, sistem prompt, dan progres project; sekarang disimpan sebagai `docs/PRD.md` dan `CHANGELOG.md`.
# 2026-07-16 - Package D operational handoff, hours, and consent

- Added migration v5 for handoff ownership/SLA fields and persisted communication preferences.
- Added race-safe assignment, reassignment, handling, resolution, SLA breach state, and append-only operator audit events.
- Added configurable timezone-aware business hours, overnight ranges, holidays, deterministic out-of-hours replies, and handoff policy.
- Added opt-out/opt-in keyword handling before AI and outbound suppression for marketing/proactive messages while preserving transactional replies.
- Extended the authenticated, CSRF-protected handoff and business configuration admin forms with minimal controls.
# 2026-07-22 - Operational sprint execution

- Hardened customer privacy lifecycle, outbound intent projection, WhatsApp counter reset, handoff actions, order fulfillment UI, and local backup storage.
- Disabled fake cloud-backup success responses; unsupported providers now fail closed.
- Updated README and next-plan runtime claims.
- Added migration v10 for persistent order tracking, carrier, shipped/completed/cancelled timestamps, and cancellation reason.
- Removed external font origins from Admin CSP and added deterministic tests for local backup, outbound intent idempotency, and WhatsApp daily counter reset.

# 2026-07-23 - WhatsApp inbound filtering

- Ignored group and broadcast JIDs before durable customer processing, preventing unsupported group payloads from creating retries and handoffs.
- Added migration v11 to complete existing group pipeline failures and resolve group handoffs created by the old behavior.
- Permanent inbound failures now display their real attempt count instead of being reported as `5 / 5`.
- Suppressed only libsignal session lifecycle console messages that exposed ratchet session objects despite silent Baileys logging.

# 2026-07-23 - True multi-number WhatsApp runtime

- Added isolated Baileys auth namespaces, socket generations, reconnect timers, QR status, and inbound workers per registered phone number.
- Added one shared outbound dispatcher that selects an online socket using persistent sticky customer assignment.
- Isolated session reset/delete so one phone no longer clears every WhatsApp credential.
- Added safe legacy credential claiming when stored account phone matches a registered number.
- Admin QR flow now starts and polls the selected number, rejects mismatched scanned accounts, and shows runtime status per number.

# 2026-07-23 - New-number QR false positive

- Fixed new-number registration incorrectly showing the primary session as connected.
- New number starts in isolated `connecting` state and requires per-number QR scan.
- Status endpoint without a phone no longer returns primary session state.
- QR endpoint rejects unregistered numbers; connected badge only accepts matching phone.
- Corrected onboarding order: open Add Number to create pending QR first, scan QR, auto-fill detected phone, then save CS label and quota.
- Activated anti-ban delay in real outbound dispatcher, persisted sent counters, enforced daily lead hard limits, restricted sticky routing to online numbers, and validated rotation mode input.
