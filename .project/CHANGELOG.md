# Changelog

Semua perubahan penting dan kemajuan proyek CS AI WhatsApp dicatat di sini.

## [Unreleased]

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
- **Changed:** Folder dokumentasi project dipindahkan dari `.agents/` ke `.project/`; `AGENTS.md` berganti nama menjadi `PRD.md`.
- **Changed:** Semua pembaruan dokumentasi berikutnya wajib ditulis ke `.project/CHANGELOG.md`, `.project/PRD.md`, dan `.project/nextplan.md` sesuai jenis perubahannya.
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

- **Added:** `.project/nextplan.md` berisi roadmap production hardening lengkap.
- **Audited:** Product workflow, security, reliability, observability, testing, backup, deployment, dan failure modes.
- **Assessed:** Production readiness keseluruhan saat ini sekitar 35-40% ketika reliability, security, tests, monitoring, dan deployment ikut dihitung.
- **Identified:** Prioritas utama adalah admin auth/CSRF, durable inbound queue, message deduplication, per-JID ordering, outbound outbox, transactional state, versioned migrations, automated tests, database backup, structured logs, dan observability.
- **Identified:** WhatsApp saat ini baru memproses teks; media, delivery/read receipt, consent, business hours, assignment/SLA handoff, dan payment gateway masih masuk roadmap.
- **Security:** `npm audit` menemukan satu high-severity vulnerability tanpa fix otomatis pada dependency spreadsheet chain.

### Documentation

- **Changed:** `.project/PRD.md` diperbarui dengan arsitektur, prompt model, UI, AI health, simulator, Knowledge, order, backup, batasan production, dan workflow terbaru.
- **Added:** `.project/nextplan.md` sebagai roadmap utama pekerjaan berikutnya.
- **Changed:** `.project/CHANGELOG.md` dirapikan agar kondisi final hari ini tidak bercampur dengan implementasi sementara yang sudah diganti.

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

- **Added:** Dokumentasi project awal untuk pedoman arsitektur, sistem prompt, dan progres project; sekarang disimpan sebagai `.project/PRD.md` dan `.project/CHANGELOG.md`.
# 2026-07-16 - Package D operational handoff, hours, and consent

- Added migration v5 for handoff ownership/SLA fields and persisted communication preferences.
- Added race-safe assignment, reassignment, handling, resolution, SLA breach state, and append-only operator audit events.
- Added configurable timezone-aware business hours, overnight ranges, holidays, deterministic out-of-hours replies, and handoff policy.
- Added opt-out/opt-in keyword handling before AI and outbound suppression for marketing/proactive messages while preserving transactional replies.
- Extended the authenticated, CSRF-protected handoff and business configuration admin forms with minimal controls.
