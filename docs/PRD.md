# Project Context: Voidlark - CS AI WhatsApp Multi-Bisnis

## Tujuan

Voidlark adalah bot Customer Service WhatsApp berbasis AI untuk konsultasi, dukungan, penjualan, draft pesanan, pembayaran manual, ongkir, lookup referensi, dan handoff ke admin. Engine dan admin harus tetap generik untuk bisnis fisik maupun digital; aturan industri tidak boleh di-hardcode di `src/`.

## Non-Goal

- Voidlark bukan sistem inventory dan tidak mengelola jumlah stok, mutasi stok, reservasi, sinkronisasi gudang/POS, atau pengurangan stok setelah order.
- Kualitas percakapan CS tetap fokus utama. Bila status stok tidak tersedia pada Knowledge, bot menyampaikan batas tersebut dan mengarahkan konfirmasi ke admin tanpa mengarang availability.

## Tech Stack

- Runtime: Node.js, TypeScript, `tsx`, dan `tsc`.
- WhatsApp: `@whiskeysockets/baileys`.
- AI: API OpenAI-compatible melalui `AI_API_BASE_URL`, `AI_API_KEY`, dan `AI_MODEL`.
- Adapter completion menerima JSON non-stream maupun SSE dari gateway yang mengabaikan `stream: false`, sehingga model Gemini, Groq/Llama, DeepSeek, dan model OpenAI-compatible lain dapat dipakai tanpa mengunci aplikasi ke satu vendor.
- Database: SQLite default di `data/voidlark.db`; PostgreSQL opsional melalui `DB_DRIVER=postgres`.
- Admin: Express server-rendered HTML/CSS/JS pada loopback `127.0.0.1`.
- Ongkir: RajaOngkir/Komerce domestic API.
- Lookup eksternal: Tavily di UI; backend lama masih mengenali Brave bila env lama tersedia.
- Knowledge parsing: TXT, Markdown, PDF, DOCX, XLSX, CSV, PNG, JPG, dan JPEG.
- Icon: inline SVG resmi dari `@phosphor-icons/core`.

## Perintah Utama

```bash
npm run dev
npm run build
npm start
```

- Development otomatis memakai `NODE_ENV=development`.
- Build dari `dist` otomatis memakai `NODE_ENV=production`.
- Admin development memilih port kosong mulai 3000 dan menulis URL aktif ke terminal.
- Satu proses bot dijaga oleh `data/voidlark.lock`.
- Setelah perubahan kode, jalankan `npm run build`, lalu restart server jika server memang sedang digunakan. Jangan menyalakan server jika user sudah meminta server dihentikan.
- `src/` hanya berisi source TypeScript. Ekstensi `.js` pada import internal wajib dipertahankan untuk ESM `NodeNext`; JavaScript runtime hanya dihasilkan ke `dist/` oleh `npm run build`.

## Arsitektur Konfigurasi

### Profil & Alur Bisnis

Sumber: `business.config.json`, dikelola melalui `/admin/config`.

| Field | Fungsi |
|---|---|
| `businessName` | Nama bisnis atau produk |
| `csName` | Nama persona CS virtual |
| `productType` | `physical` atau `digital` |
| `salesFlow` | `consultative`, `direct`, atau `support` |
| `checkoutFields` | Data customer wajib |
| `orderFields` | Data pesanan wajib |
| `paymentInstructions` | Instruksi pembayaran |
| `shippingWeights` | Aturan berat per ukuran atau paket |
| `enableExternalProductLookup` | Lookup web jika Knowledge kurang |

Shipping tidak memiliki switch manual:

- Produk fisik -> shipping otomatis aktif.
- Produk digital -> shipping otomatis nonaktif.

### Koneksi Sistem

Sumber: `.env`, dikelola melalui `/admin/settings`.

Pengguna tidak mengatur `PORT` atau `NODE_ENV` dari UI. Settings dibagi menjadi:

- Koneksi utama: AI.
- Layanan lanjutan: Ongkir, Handoff, Lookup eksternal, dan Database.
- Layout desktop layanan lanjutan menempatkan Ongkir dan Handoff di kolom kiri, serta Lookup eksternal dan Database di kolom kanan; mobile runtuh menjadi satu kolom.

Nomor admin menerima format awam seperti `081234567890` dan dinormalisasi ke JID WhatsApp.

RajaOngkir dan Tavily memakai API Key List Editor:

- satu key per row,
- key utama dan cadangan,
- masking, lihat, salin, reorder, tambah, dan hapus,
- konfirmasi sebelum hapus,
- validasi duplikat,
- serialisasi `.env` tetap menggunakan pemisah koma untuk kompatibilitas backend.

## Prompt Builder dan System Prompt

`prompt.builder.json` adalah sumber form Gaya Balasan. Prompt aktif berada di `config/system-prompt.txt` dan digenerasikan hanya saat form disimpan dari:

1. input form Gaya Balasan,
2. data faktual dari Profil & Alur.

Tidak ada editor raw sebagai sumber kedua. Preview final harus identik dengan isi `config/system-prompt.txt` setelah disimpan. Membuka halaman Prompt tidak boleh menulis ulang prompt aktif.

Form Gaya Balasan mencakup:

- karakter dan gaya bahasa,
- identitas dan kejujuran bot,
- alur konsultasi dan penggunaan riwayat,
- cara generik membaca produk dan harga dari Knowledge,
- checkout dan penyimpanan draft,
- pengiriman dan cek ongkir,
- handoff admin,
- formatting WhatsApp,
- aturan tambahan.

Fitur `Rapikan dengan AI` mengirim seluruh field builder ke provider, meminta output JSON non-stream, dan memiliki fallback parser untuk respons SSE `data: {...}` dari gateway yang mengabaikan `stream: false`. AI wajib menyunting setiap field string: memperbaiki typo, ejaan, tanda baca, struktur, dan duplikasi tanpa mengubah fakta bisnis atau requirement unik. Respons harus memuat semua key builder atau ditolak. UI menampilkan status sederhana `1 form diperbarui` dan menyorot bagian yang benar-benar berubah; hasil tetap harus ditinjau dan disimpan manual.

Aturan penting:

- Jangan menggandakan aturan yang sama dari Config dan Prompt Builder.
- Profil & Alur hanya menyumbang satu blok fakta bisnis.
- Jangan hardcode parfum, pakaian, makanan, kursus, nominal harga, ukuran, atau klasifikasi industri di `src/`, `prompt.builder.json`, atau `config/system-prompt.txt`.
- Nama produk, kategori, relasi, harga, stok, dan pengecualian bisnis berada di Knowledge.
- Bot tidak boleh mengarang fakta yang tidak tersedia di Knowledge.

## Knowledge Base

Folder: `knowledge_base/`.

- Upload maksimum 30 file sekaligus.
- Maksimum 10 MB per file.
- Nama file yang sudah ada tidak ditimpa diam-diam; file baru mendapat nama unik.
- Upload dan delete otomatis menjalankan `loadKnowledgeBase()`.
- Knowledge aktif saat ini masih dimuat penuh ke memori dan dikirim ke AI; retrieval/chunking adalah pekerjaan penting berikutnya.
- Kesalahan parser per file saat ini dicatat dan dilewati; atomic ingestion dan last-known-good snapshot belum tersedia.

Aturan khusus bisnis harus diletakkan di Knowledge. Contoh data parfum yang saat ini ada:

- Pada Penggolongan Notes Fix, `Nama Item` berarti Inspired dan `karakter` berarti Karakter.
- `KZ Leupar Man + Exist -> Uniblack` berarti Uniblack adalah Karakter.

Contoh tersebut adalah data Knowledge bisnis aktif, bukan aturan engine multi-bisnis.

## AI Agent dan Simulasi

### Agent Produksi

- `askAgent()` menerima system prompt, Knowledge, customer state, draft order, dan 20 pesan terakhir.
- Tool utama: cek ongkir, simpan data customer, simpan draft, konfirmasi pesanan, lookup referensi, dan handoff.
- Tool call loop mendukung beberapa round-trip.

### Simulasi Percakapan

Route: `/admin/sandbox`.

- UI menyerupai chat WhatsApp.
- Pesan customer tampil optimistis tanpa reload.
- Input langsung kosong setelah kirim.
- Typing indicator dan status progres muncul saat AI lambat.
- `Enter` mengirim; `Shift+Enter` membuat baris baru.
- Maksimal 20 pesan terakhir disimpan di `sessionStorage` per tab.
- Tombol `Mulai ulang percakapan` membersihkan riwayat simulasi.
- Simulator tidak menulis lead, order, handoff, atau chat history ke database dan tidak mengirim WhatsApp.
- Timeout preview 75 detik dan retry satu kali untuk timeout/connection transient.
- Simulator memilih potongan Knowledge yang relevan berdasarkan pesan dan riwayat, dengan budget 7.000 karakter; riwayat dibatasi 12 pesan dan completion dibatasi 600 token. Penolakan context/TPM di-retry satu kali memakai Knowledge 2.500 karakter dan completion 500 token.
- Agent WhatsApp produksi juga menggunakan Knowledge relevan maksimal 7.000 karakter, 12 pesan riwayat, dan output maksimal 600 token.
- Quality-first menjadi prioritas runtime. Waktu proses tambahan boleh dipakai untuk retrieval, state resolution, claim validation, dan formatting selama meningkatkan ketepatan jawaban; latency bukan acceptance utama.
- Quality-first mencakup isi dan cara penyampaian. Jalur deterministik wajib tetap hangat, menjawab kebutuhan langsung, memberi alasan yang mudah dipahami customer, dan melanjutkan konteks; istilah proses internal seperti `evidence`, `overlap`, `kandidat`, `ranking`, `validator`, atau status lookup tidak boleh muncul pada chat.
- Batas anti-halusinasi tidak boleh berubah menjadi jawaban cuek. Bila fakta belum cukup, bot menyebut bagian yang belum bisa dipastikan, menjelaskan risiko salah secara singkat, lalu menawarkan langkah paling relevan tanpa membuang fakta lain yang sudah diketahui.
- Detail notes harus informatif tetapi mudah dipindai di WhatsApp. Matcher boleh memakai seluruh notes terverifikasi, sedangkan copy customer merangkum maksimal tujuh notes utama yang relevan dan menandainya sebagai contoh, bukan daftar lengkap.
- Follow-up detail produk wajib konsisten dengan alasan rekomendasi sebelumnya. Notes pembanding yang sudah disebut pada riwayat diprioritaskan dalam ringkasan berikutnya tanpa hardcode nama produk atau jenis note tertentu.
- Dispatcher intent menyelesaikan relasi/identitas produk, edukasi, perbandingan, harga, stok, durasi, safety, dan checkout sebelum konsultasi generik. Formatter tidak boleh dipakai untuk menutupi jawaban upstream yang salah.
- State parsial boleh diserap dari satu rekomendasi bot yang jelas, tetapi daftar banyak pilihan tidak boleh dianggap pilihan final. Alias klasifikasi satu kata hanya valid dekat konteks kelompok/produk/harga/variasi; frasa biasa seperti “karakter aromanya” tidak boleh memindahkan kelompok transaksi.
- WhatsApp live menerima state dan draft pesanan sebagai kontrak terstruktur terpisah dari Knowledge retrieval. Pemotongan Knowledge atau history tidak boleh menghilangkan pilihan customer yang sudah terkunci.
- Simulator mendeteksi completion yang terpotong melalui `finish_reason` dan pola akhir kalimat; satu continuation request dilakukan dengan context ringkas lalu digabungkan ke jawaban pertama tanpa pengulangan.
- Simulator mengubah jawaban final menjadi 1-3 bubble adaptif. Paragraf bermakna dipertahankan, teks panjang hanya dipisah pada akhir kalimat, dan bubble ditampilkan bertahap dengan typing delay.
- Reset atau request baru membatalkan request/bubble simulator sebelumnya agar respons lama tidak muncul setelah konteks berubah.
- Adapter model mengenali textual tool-call DeepSeek berformat DSML dan mengubahnya menjadi eksekusi tool preview internal; markup DSML tidak boleh ditampilkan kepada customer.
- Typing indicator pertama memiliki durasi minimum 650 ms agar tetap terlihat pada provider berlatensi rendah.
- Script simulator harus lolos pemeriksaan sintaks setelah dirender dari template HTML; newline riwayat multi-bubble disimpan sebagai escape `\n\n`, bukan newline literal pada source JavaScript browser.
- Final-output guard melarang dan menghapus DSML, XML tool markup, `environment_details`, workspace metadata, serta aksara China; jawaban yang terkontaminasi diregenerasi dalam Bahasa Indonesia sebelum masuk response plan.
- Simulator dan WhatsApp live melakukan deterministic external lookup untuk intent perbandingan produk luar serta detail notes produk katalog yang belum lengkap. Web lookup terjadi sebelum jawaban rekomendasi, sehingga tidak bergantung pada kualitas native tool calling model.
- Evidence guard memverifikasi klaim format produk terhadap Knowledge relevan. `roll on` dan `spray` tidak boleh ditawarkan bila tidak tercantum dalam bukti yang diterima model.
- Resolver budget membedakan permintaan harga murni dari kebutuhan deskriptif. Permintaan seperti “budget 50 ribu, yang fresh” tetap masuk alur rekomendasi berbasis Knowledge; daftar kombinasi harga hanya dipakai untuk pertanyaan budget murni.
- Batas budget dibaca dari percakapan customer terbaru dan dipertahankan pada follow-up. Bila hanya satu kelompok harga yang masuk budget, rekomendasi produk dan variasinya wajib tetap berada di kelompok tersebut.
- Budget adalah batas maksimum, bukan target pengeluaran. Ranking kebutuhan menentukan kualitas lebih dahulu; sistem lalu memilih harga terendah pada kualitas yang cocok. Bila kebutuhan tidak memberi sinyal kualitas, pilihan termurah harus dilabeli sebagai opsi paling hemat, bukan paling cocok.
- Perbandingan dua nilai variasi dihitung deterministik hanya bila sumbu lain sama atau sudah terkunci. Ambiguitas tidak boleh dijawab memakai dua kombinasi berbeda.
- Nama pada daftar rekomendasi bernomor dipertahankan untuk rujukan “yang pertama/kedua/ketiga/terakhir”, termasuk nama produk yang bukan nilai variasi harga.
- Pilihan hanya berubah dari bahasa pemilihan eksplisit pada turn customer terbaru. Nilai yang muncul dalam penjelasan, perbandingan, atau riwayat lama tidak boleh diam-diam menjadi pilihan aktif.
- Ordinal diselesaikan dari daftar pilihan relevan terbaru. Ordinal nama produk didahulukan dari daftar variasi lama, lalu nama produk dibawa ke jawaban harga dan state.
- Rekomendasi produk normal memakai nama item yang benar-benar ditemukan di Knowledge. Label keluarga atau karakter hanya menjadi alasan rekomendasi, bukan nama produk baru.
- Pada domain fragrance, kandidat Parfum Inspired dicari memakai nama Inspired asli dari workbook. Kandidat Parfum Karakter wajib dipetakan ke pasangan Inspired dan lookup tetap memakai nama Inspired; copy customer menyebut Inspired sebagai acuan, bukan notes Karakter yang identik.
- Hasil external lookup untuk katalog hanya boleh menambah notes, family, karakter aroma, dan target pemakai. Harga, stok, ketersediaan, diskon, draft, ongkir, dan checkout tidak boleh berasal dari web.
- Klaim padanan produk luar “paling dekat” memerlukan profil luar dan kandidat katalog yang sama-sama lolos identity/notes validation serta memiliki overlap notes. Nama item bukan notes evidence; family KB hanya prefilter. Bila overlap tidak ditemukan, bot wajib menyatakan belum menemukan padanan spesifik.
- Saat customer pertama kali menyebut produk luar yang tidak dijual, bot menjelaskan ringkasan notes hasil lookup dan menawarkan pencarian alternatif sebelum memilih produk toko. Persetujuan singkat pada turn berikutnya harus terhubung ke produk luar terakhir.
- Permintaan alternatif produk luar memberi maksimal tiga tier bila evidence cukup: pilihan pertama `paling mendekati` wajib memiliki note overlap; tier berikutnya boleh memakai family dan notes lookup kandidat untuk menawarkan arah berbeda seperti lebih fresh, woody, floral, atau manis. Tier berbasis family tidak boleh disebut sama dekatnya dengan tier pertama.
- Daftar dua atau tiga kandidat tidak mengubah pilihan transaksi. Produk dan kelompok baru terkunci setelah customer memilih ordinal/nama atau secara eksplisit meminta satu pilihan.
- Pada copy customer, hubungan produk Karakter dan Inspired menyebut kedua nama konkretnya. Frasa generik seperti `parfum acuannya` tidak boleh menggantikan nama parfum yang sedang dijelaskan bila nama tersebut sudah diketahui.
- Validator external notes wajib mengikat identitas parfum, konteks fragrance, dan struktur notes. Hasil celebrity ambiguity, ranking/review generik, identitas berbeda, prose web yang menempel pada nama note, atau konflik target pemakai wajib diabaikan.
- Permintaan dua rekomendasi wajib mempertahankan dua nama katalog berbeda dan memberi alasan notes per item bila evidence tersedia. Jika kelompok belum dipilih, domain fragrance memakai Parfum Inspired secara konsisten; Karakter hanya dipakai setelah pilihan kelompok jelas.
- Final-output guard membatasi balasan ke maksimal satu pertanyaan semantik. Permintaan manusia eksplisit diproses sebelum model; kalimat bersyarat tidak membuat handoff sampai customer benar-benar meminta. Mode live mencatat handoff, mode preview menandai state simulasi.
- Claim guard bukan tahap output terakhir. Setiap jawaban yang ditulis ulang oleh claim guard wajib melewati sanitizer customer-facing lagi sebelum response plan, preview, atau WhatsApp.
- Pertanyaan stok wajib menjawab fakta harga/variasi yang tersedia tanpa mengarang availability. Bila Knowledge tidak memuat status stok, bot menyatakan perlu konfirmasi admin; pertanyaan tersebut tidak mengubah pilihan transaksi. Tidak ada rencana menambah subsistem inventory.
- Saat customer meminta pendapat setelah membandingkan dua ukuran/kapasitas, resolver mempertahankan sumbu variasi lain. Tanpa kebutuhan eksplisit untuk nilai lebih besar, rekomendasi memilih opsi lebih hemat dan menyebut selisihnya.
- Permintaan rekomendasi gender+harga yang belum memuat kebutuhan cukup tidak boleh menghasilkan daftar nama dari model. Bot meminta budget atau konteks penggunaan; nama produk hanya berasal dari kandidat Knowledge.
- Label taksonomi internal wajib diterjemahkan ke bahasa customer. Istilah seperti `glamour` tidak tampil bila kebutuhan dapat dinyatakan sebagai `manis` atau `elegan`.
- Pertanyaan durasi mendapat jawaban deterministik bila Knowledge tidak memuat angka durasi. Claim guard live dan preview menolak durasi numerik maupun klaim kualitatif seperti `tahan lama` tanpa evidence.
- Claim guard juga memvalidasi janji penggunaan dan kecocokan seperti jumlah semprotan, bebas noda, hemat jangka panjang, unisex, penyesuaian suhu tubuh, serta klaim tidak menyengat.
- Hasil ongkir dibandingkan dengan kebutuhan `hari ini` atau `besok`. Bila tidak ada estimasi yang memenuhi, balasan wajib menyatakan risikonya; estimasi kurir tidak boleh disebut sebagai jaminan.
- Checkout dengan produk, variasi, jumlah, dan harga terkunci memakai fallback checkout internal; fallback pencocokan referensi luar tidak boleh mengambil alih alur tersebut.
- Saat web reference sudah tersedia, simulator menjalankan completion tanpa tool schema untuk mencegah duplicate lookup dan DSML. Safe fallback tetap menyampaikan fakta web yang ditemukan, tetapi tidak mengarang kandidat katalog.
- Endpoint simulator melakukan sanitasi final pada reply dan seluruh bubble sebelum serialisasi JSON.
- Matching aroma produk luar dilakukan oleh kode: ekstrak notes/family dari web, load pasangan Inspired->Karakter dari XLSX, skor kandidat, lalu berikan hanya kandidat terverifikasi kepada model. Model tidak bebas menciptakan nama kandidat.
- Arsitektur rekomendasi bersifat multi-domain. Core pipeline menangani retrieval, external lookup, evidence, sanitasi, dan history secara generik; matcher aroma adalah kapabilitas opsional yang hanya aktif saat domain dan schema Knowledge mendukungnya.
- Plugin domain mengikuti kontrak `DomainMatcher`: `supports(domain, schema)`, `match(reference)`, dan output evidence yang seragam. Penambahan domain baru tidak memerlukan perubahan pada alur utama preview agent.
- Adaptasi produk wajib otomatis dari Profil & Alur, Gaya Balasan, serta file Knowledge yang sudah ada. Pengguna tidak perlu mengelola schema atau menu teknis tambahan.
- Universal factual guard memvalidasi klaim harga, stok, garansi, dan format terhadap evidence sebelum bubble dikirim.
- UX Gaya Balasan memprioritaskan preset dan karakter bahasa, menyembunyikan aturan lanjutan sampai dibutuhkan, serta menyediakan preview percakapan langsung sebelum pengguna menyimpan.
- Preview Gaya Balasan wajib berupa contoh ucapan nyata, bukan isi instruksi prompt. Accordion hanya membuka satu bagian; tidak ada indikator langkah dekoratif.
- Seluruh halaman admin wajib terautentikasi; seluruh mutasi wajib membawa CSRF token dan same-origin. Credential admin berasal dari `ADMIN_PASSWORD`, bukan Config atau Knowledge.
- Cookie development HTTP tidak boleh memakai prefix `__Host-`; production HTTPS wajib memakai `__Host-` dan `Secure`. Login menyediakan kontrol visibilitas password dengan state ARIA.
- Arsitektur product intelligence harus multi-produk. Pipeline inti (external lookup, evidence boundary, history, output guard) bersifat domain-neutral. Matcher parfum adalah strategi opsional yang hanya aktif bila system prompt/Knowledge membuktikan domain fragrance; bisnis lain memakai strategi generik tanpa istilah parfum.

### AI Health

`src/ai/health.ts` melakukan validasi bertahap:

1. cek `/models`,
2. verifikasi API key dan model jika provider mendukung,
3. inference nyata ke `/chat/completions`.

Status yang digunakan bersama oleh Ringkasan, Settings, `/health`, tombol tes, dan simulator:

- `ready`,
- `slow`,
- `missing`,
- `unreachable`,
- `unauthorized`,
- `model_not_found`,
- `error`.

Cache health berlaku 5 menit dan di-invalidasi setelah Settings berubah. Status `slow` tetap dianggap operasional.

## Lookup Eksternal

Alur:

1. cek Knowledge terlebih dahulu,
2. jika kurang dan lookup aktif, panggil `cariReferensiProduk`,
3. Tavily digunakan dari UI Settings,
4. beberapa key dipisahkan koma dan dirotasi saat limit atau invalid,
5. hasil disimpan di `lookup_cache` selama 7 hari,
6. hasil web hanya referensi; bukan bukti stok atau harga toko.

Untuk katalog fragrance, lookup juga dipakai saat nama produk sudah internal tetapi detail notes belum cukup. Nama Inspired menjadi identitas pencarian. Nama Karakter dipetakan ke pasangan Inspired pada workbook, lalu hasilnya hanya dijelaskan sebagai profil acuan yang dapat dimodifikasi. Cache tetap 7 hari; hasil ambigu atau konflik kebutuhan customer ditolak.

Brave input sudah dihapus dari UI karena tidak menjadi free-tier utama. Dukungan backend lama dipertahankan untuk kompatibilitas env lama.

## Order dan Handoff

### Alur Order Saat Ini

1. Konsultasi.
2. `simpanDraftPesanan` membuat atau memperbarui draft.
3. Checkout dan ongkir jika produk fisik.
4. `konfirmasiPesanan` mengubah status ke `awaiting_payment`.
5. Admin mendapat notifikasi WhatsApp.
6. Admin menandai lunas dari web atau `#paid <jid> [orderId]`.
7. Customer mendapat notifikasi pembayaran diterima.

Total detail order menghitung `harga satuan x quantity + ongkir`.

Status production penuh dan payment gateway nyata belum tersedia; webhook idempotent, transaction abstraction, migration ledger, dan order state machine sudah tersedia. Lihat `docs/ROADMAP.md` untuk gap launch.

### Handoff

- `escalateToHuman` mencatat handoff.
- Handoff aktif tidak dibuat berulang untuk JID yang sama.
- Pesan customer tetap disimpan saat bot berhenti auto-reply.
- Admin dapat membuka WhatsApp customer dari panel.
- Penyelesaian handoff mengaktifkan bot kembali.

Command admin WhatsApp:

```text
#resolve <jid>
#paid <jid> [orderId]
```

Handoff operasional memiliki status waiting/assigned/handling/resolved, priority, assignment/reassignment race-safe, timestamps respons/resolve, SLA due/breach, dan append-only audit event. Jam operasional, timezone IANA, jadwal mingguan, holiday, respons deterministik, dan kebijakan handoff dikonfigurasi di `business.config.json`; fitur jam operasional default nonaktif untuk menjaga perilaku lama. Keyword opt-out/opt-in diproses sebelum AI, dipersistenkan, dan menekan pesan marketing/proactive tanpa memblokir balasan transactional.

## Admin UI

Nama navigasi saat ini:

- Ringkasan
- Perlu Ditangani
- Pelanggan & Chat
- Pesanan
- Profil & Alur
- Gaya Balasan
- Katalog & Informasi
- Simulasi Percakapan
- Manajemen WA
- Koneksi Sistem

Identitas visual: operational calm dengan bahasa komponen native terinspirasi shadcn/ui, hierarchy Carbon/Fluent, Inter Variable untuk product UI, IBM Plex Mono untuk data teknis, mature teal accent, satu-border surface, radius konsisten, inline Phosphor SVG, light/dark/system mode, responsive UI, dan accessibility dasar. Implementasi tetap server-rendered Express; tidak memakai paket React, Vite, Tailwind, atau shadcn/ui.

Fitur penting:

- checklist Kesiapan Bot yang dapat disembunyikan,
- panel tindakan prioritas,
- status WhatsApp, AI, dan ongkir,
- detail pesanan,
- upload Knowledge otomatis,
- tes koneksi,
- backup/restore Config, Prompt, dan Knowledge tanpa secret/database,
- health JSON pada `/health`,
- global error page dengan kode referensi.

Slogan brand:

```text
Quiet AI. Precise Service.
```

## Backup dan Monitoring Saat Ini

Backup admin mencakup:

- `business.config.json`,
- `config/system-prompt.txt`,
- `prompt.builder.json`,
- file Knowledge.

Backup tidak mencakup:

- `.env` dan API key,
- database customer/order/chat,
- sesi WhatsApp.

Endpoint `/health`, `/health/live`, `/health/ready`, dan `/metrics` melaporkan database, WhatsApp, queue, backup age, uptime, dan metrik operasional. Backup database otomatis tersedia untuk SQLite dan PostgreSQL, dengan checksum, retensi, audit `backup_runs`, dan drill melalui `npm run db:backup:drill -- <file>`. Backup lokal tetap perlu disalin ke storage off-host; alert saat ini berupa structured log/SLO metric, belum routing operator.

## Batasan Production Saat Ini

Project siap untuk staging/pilot terkontrol, tetapi belum boleh disebut production-ready penuh. Temuan utama audit disimpan di `docs/ROADMAP.md`:

- durable inbound queue, deduplication, lease, retry/dead-letter, per-JID ordering, dan bounded graceful drain saat shutdown sudah tersedia; failure drill process-kill nyata masih perlu,
- outbound outbox, retry, provider ID, delivery/read tracking, dan outbound intent projection sudah tersedia; cancellation multi-bubble produksi belum menjadi requirement utama,
- admin sudah memiliki authentication, logout, session expiry, dan CSRF protection,
- database migration, order transaction, payment webhook idempotency, dan audit trail sudah tersedia; payment provider nyata dan fulfillment lengkap belum,
- WhatsApp mendukung text, image, document, location, dan voice path; tipe media lain tetap fallback/handoff,
- Knowledge sudah bounded retrieval dan atomic ingestion; tuning chunk/schema lanjutan tetap terbuka,
- automated tests, CI build/test/audit/secret scan, metrics, dan runbook sudah tersedia; E2E, load, failure drill, dashboard, dan deployment supervision nyata belum lengkap,
- Parsing workbook menggunakan `exceljs`; format spreadsheet Knowledge yang didukung adalah XLSX dan CSV.

Perkiraan readiness bersifat gate-based, bukan persentase. Status saat ini: staging/pilot terkontrol; launch gates ada di `docs/ROADMAP.md`.

## Aturan Workspace

- Engine dan admin harus generik multi-bisnis.
- Jangan hardcode industri di `src/`.
- Jangan membuat sumber prompt kedua di luar Prompt Builder.
- Jangan memasukkan API key atau secret ke dokumentasi, log, atau source.
- `.env` harus diperlakukan sebagai secret dan tidak boleh dilacak Git.
- Jangan mengedit `dist` manual; hasilkan dengan `npm run build`.
- Setelah perubahan kode, validasi build dan restart server hanya jika server sedang digunakan.
- Dokumentasi produk dan engineering wajib disimpan di `docs/`; changelog kanonis berada di root repository.
- Update `CHANGELOG.md` untuk setiap perubahan penting.
- Update `docs/PRD.md` jika arsitektur, aturan, requirement, atau workflow berubah.
- Update `docs/ROADMAP.md` jika audit, prioritas, roadmap, atau pekerjaan lanjutan berubah.
- Jangan membuat atau menggunakan kembali folder `.agents/` maupun file `.agents/AGENTS.md`.

## Kontrak Universal Produk & Percakapan

- Engine tidak boleh hard-code nama industri, produk, kualitas, paket, ukuran, kapasitas, durasi, atau nilai variasi bisnis.
- Produk & Harga menjadi sumber kebenaran untuk kelompok harga, sumbu variasi, kombinasi nilai, harga, dan berat pengiriman. Nama item serta detail produk tetap berasal dari Knowledge.
- Kelompok harga boleh memiliki `domainRole` opsional untuk plugin yang membutuhkan relasi antarkolom Knowledge. `reference` menandai kelompok yang memakai nama referensi asli untuk lookup; `modified` menandai produk internal pasangan modifikasi. Metadata diatur dari Produk & Harga dan tidak boleh disimpulkan dari nama kelompok di core.
- Nama sumbu dan nilai wajib dibaca dari skema aktif. Contoh bisnis hanya boleh berada di Knowledge, Config, fixture test, dan plugin domain opsional.
- Harga satuan, subtotal, total, selisih, serta filter budget yang dapat diturunkan dari katalog harus dihitung deterministik. Model hanya merangkai bahasa dan tidak boleh mengganti angka.
- Produk & Harga terstruktur selalu menjadi sumber kebenaran harga bila berbeda dari teks Knowledge lama.
- Pilihan parsial dari rekomendasi dipertahankan lintas-turn. Rujukan natural seperti “yang pertama”, “yang kedua”, “yang tadi”, dan pilihan terkecil diselesaikan terhadap rekomendasi serta urutan skema aktif.
- State pilihan hanya boleh berubah dari pilihan eksplisit customer pada turn terbaru; deskripsi assistant dan perbandingan tidak menjadi pilihan.
- Permintaan nilai terkecil tanpa variasi lain menampilkan seluruh kombinasi pada nilai terkecil. Jika variasi lain disebut eksplisit, jawaban fokus pada kombinasi tersebut.
- Klaim stok, diskon, garansi, durasi, format, spesifikasi, dan fakta produk lain wajib didukung evidence. Ketidaktersediaan evidence tidak boleh diubah menjadi klaim negatif atau positif.
- Pada domain fragrance, nama pasangan dan keluarga berasal dari workbook Knowledge; jumlah note serta konsentrasi berasal dari blok `KLAIM PRODUK TERVERIFIKASI`; kelompok, alias, variasi, urutan tier harga, harga, dan berat berasal dari Produk & Harga; sapaan dan detail copy berasal dari Gaya Balasan; flow checkout berasal dari Profil & Alur.
- Runtime matcher hanya boleh membaca hasil corpus Knowledge yang berstatus aktif. File pada folder upload yang belum berhasil diaktifkan bukan sumber rekomendasi. Cache matcher wajib terikat pada isi corpus aktif.
- Kecocokan penggunaan terhadap kombinasi produk berasal dari `recommendationTags` pada Produk & Harga. Core tidak boleh memetakan istilah penggunaan ke nama tier tertentu. Tanpa tag cocok, fallback harga termurah boleh dipakai tetapi tidak boleh disebut sebagai rekomendasi penggunaan.
- Kesimpulan semantik klaim harus berasal dari kalimat Knowledge utuh. Parser tidak boleh mengambil angka lalu menambahkan arti bisnis yang tidak terdapat pada kalimat sumber.
- Semua output `askAgent`, termasuk deterministic reply dan fallback, wajib melewati batas Gaya Balasan yang sama. Sapaan, panjang, gaya jual, dan kebijakan emoji tidak boleh hanya berlaku pada output model.
- Menyimpan Profil & Alur wajib menyinkronkan prompt aktif dari Prompt Builder. `enableShipping` produk fisik harus mengikuti switch Admin; instruksi pembayaran kosong harus tetap kosong dan tidak boleh diganti default atau hasil karangan model.
- External lookup hanya boleh memperkaya notes, family, karakteristik, dan target pemakai. Harga, stok, ketersediaan, variasi, berat, draft, dan transaksi tidak boleh diambil dari web. Target pemakai eksplisit wajib fail-closed bila tidak ada satu hasil external yang cocok dan cukup jelas.
- Klaim berisiko customer seperti safety/pemakaian, durability kualitatif, social proof, bonus/kelengkapan, dan comparative marketing hanya boleh digunakan bila dicatat pada blok Knowledge `KLAIM PRODUK TERVERIFIKASI`. Teks Knowledge umum tidak cukup untuk mengesahkan janji tersebut.
- Pertanyaan harga, stok, atau ketersediaan bukan pilihan produk. State transaksi hanya berubah setelah bahasa pilihan eksplisit; checkout setelah pertanyaan lintas-kelompok wajib meminta konfirmasi nama produk yang cocok sebelum ongkir.
- Sanitizer customer-facing wajib mempertahankan line break WhatsApp. Repair klaim harus menulis ulang balasan utuh dan memvalidasinya kembali; pemotongan frasa tidak boleh meninggalkan label, tanda baca, atau kalimat gantung.
- Order final wajib gagal tertutup sampai produk, jumlah, seluruh sumbu variasi, harga katalog, field checkout terkonfigurasi, dan data pengiriman wajib lengkap. Prompt model tidak boleh menjadi satu-satunya pengaman transaksi.
- Perubahan kelompok atau klasifikasi wajib menghapus nama produk lama sampai produk baru dipilih atau direkomendasikan dari Knowledge.
- Output WhatsApp harus berupa daftar vertikal yang mudah dibaca, tanpa tabel Markdown, bullet strip, nominal terpotong, label variasi berulang pada setiap baris, atau pertanyaan penutup yang menempel pada item daftar maupun peringatan pengiriman.
- Setiap perubahan arsitektur, perilaku produk, aturan percakapan, atau hasil evaluasi penting wajib memperbarui `CHANGELOG.md` dan dokumen kanonis terkait pada turn yang sama.

## Runtime Status Terbaru — 2026-07-23

Catatan lama di bawah dokumen ini bersifat historis. Status kanonis saat ini: durable ingestion, versioned migrations, payment webhook idempotency, tests, metrics, privacy lifecycle, outbound intent projection, dan WhatsApp multi-number control plane aktif. Gap launch tercatat di `docs/ROADMAP.md`; cloud backup providers tetap nonaktif sampai implementasi dan kredensial diverifikasi.
# Runtime status note — 2026-07-22

Catatan status historis telah digabungkan ke status kanonis di atas. Lifecycle multi-socket WhatsApp kini aktif; provider backup off-host tetap nonaktif sampai implementasi dan kredensial diverifikasi.
