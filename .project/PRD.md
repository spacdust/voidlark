# Project Context: Voidlark - CS AI WhatsApp Multi-Bisnis

## Tujuan

Voidlark adalah bot Customer Service WhatsApp berbasis AI untuk konsultasi, dukungan, penjualan, draft pesanan, pembayaran manual, ongkir, lookup referensi, dan handoff ke admin. Engine dan admin harus tetap generik untuk bisnis fisik maupun digital; aturan industri tidak boleh di-hardcode di `src/`.

## Tech Stack

- Runtime: Node.js, TypeScript, `tsx`, dan `tsc`.
- WhatsApp: `@whiskeysockets/baileys`.
- AI: API OpenAI-compatible melalui `AI_API_BASE_URL`, `AI_API_KEY`, dan `AI_MODEL`.
- Adapter completion menerima JSON non-stream maupun SSE dari gateway yang mengabaikan `stream: false`, sehingga model Gemini, Groq/Llama, DeepSeek, dan model OpenAI-compatible lain dapat dipakai tanpa mengunci aplikasi ke satu vendor.
- Database: SQLite default di `data/voidlark.db`; PostgreSQL opsional melalui `DB_DRIVER=postgres`.
- Admin: Express server-rendered HTML/CSS/JS pada loopback `127.0.0.1`.
- Ongkir: RajaOngkir/Komerce domestic API.
- Lookup eksternal: Tavily di UI; backend lama masih mengenali Brave bila env lama tersedia.
- Knowledge parsing: TXT, Markdown, PDF, DOCX, XLS/XLSX, CSV, PNG, JPG, dan JPEG.
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

- Koneksi utama: Database dan AI.
- Fitur pendukung: Ongkir, Lookup eksternal, dan Handoff.

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
- Simulator mendeteksi completion yang terpotong melalui `finish_reason` dan pola akhir kalimat; satu continuation request dilakukan dengan context ringkas lalu digabungkan ke jawaban pertama tanpa pengulangan.
- Simulator mengubah jawaban final menjadi 1-3 bubble adaptif. Paragraf bermakna dipertahankan, teks panjang hanya dipisah pada akhir kalimat, dan bubble ditampilkan bertahap dengan typing delay.
- Reset atau request baru membatalkan request/bubble simulator sebelumnya agar respons lama tidak muncul setelah konteks berubah.
- Adapter model mengenali textual tool-call DeepSeek berformat DSML dan mengubahnya menjadi eksekusi tool preview internal; markup DSML tidak boleh ditampilkan kepada customer.
- Typing indicator pertama memiliki durasi minimum 650 ms agar tetap terlihat pada provider berlatensi rendah.
- Script simulator harus lolos pemeriksaan sintaks setelah dirender dari template HTML; newline riwayat multi-bubble disimpan sebagai escape `\n\n`, bukan newline literal pada source JavaScript browser.
- Final-output guard melarang dan menghapus DSML, XML tool markup, `environment_details`, workspace metadata, serta aksara China; jawaban yang terkontaminasi diregenerasi dalam Bahasa Indonesia sebelum masuk response plan.
- Simulator melakukan deterministic external lookup untuk intent perbandingan produk yang jelas (`mirip X`, `dupe X`, dan follow-up `yang paling mirip`). Web lookup terjadi sebelum model menjawab, sehingga tidak bergantung pada kualitas native tool calling model.
- Evidence guard memverifikasi klaim format produk terhadap Knowledge relevan. `roll on` dan `spray` tidak boleh ditawarkan bila tidak tercantum dalam bukti yang diterima model.
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

Status production lengkap, payment gateway, webhook idempotent, dan state machine transactional belum tersedia; lihat `.project/nextplan.md`.

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
- Profil & Alur
- Gaya Balasan
- Katalog & Informasi
- Simulasi Percakapan
- Perlu Ditangani
- Riwayat Percakapan
- Calon Pelanggan
- Pesanan
- Koneksi Sistem

Identitas visual: Editorial Industrial Control Desk dengan IBM Plex Sans/Mono, cyan signal accent, low-radius geometry, inline Phosphor SVG, light/dark/system mode, responsive UI, dan accessibility dasar.

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

Endpoint `/health` melaporkan database, WhatsApp, AI, shipping, lookup, dan uptime. Backup database otomatis tersedia untuk SQLite dan PostgreSQL, dengan checksum, retensi, audit `backup_runs`, dan drill melalui `npm run db:backup:drill -- <file>`. Backup lokal tetap perlu disalin ke storage off-host. Metrics dan alerts belum tersedia.

## Batasan Production Saat Ini

Project belum production-ready. Temuan utama audit disimpan lengkap di `.project/nextplan.md`:

- durable inbound queue, deduplication, lease, retry/dead-letter, dan per-JID ordering sudah tersedia; cancellation produksi belum tersedia,
- outbound outbox, retry, provider ID, serta delivery/read tracking sudah tersedia; transaksi atomik dengan business state menunggu fase database,
- admin sudah memiliki authentication, logout, session expiry, dan CSRF protection,
- database migration belum versioned,
- order mutation belum transactional,
- WhatsApp baru memahami text biasa,
- Knowledge belum retrieval-based dan ingestion belum atomic,
- belum ada automated tests milik project,
- observability dan deployment supervision belum lengkap,
- `xlsx` memiliki satu advisory high severity tanpa fix otomatis.

Perkiraan production readiness hasil audit: 35-40%.

## Aturan Workspace

- Engine dan admin harus generik multi-bisnis.
- Jangan hardcode industri di `src/`.
- Jangan membuat sumber prompt kedua di luar Prompt Builder.
- Jangan memasukkan API key atau secret ke dokumentasi, log, atau source.
- `.env` harus diperlakukan sebagai secret; audit menunjukkan `.gitignore` masih perlu diperkeras sesuai `.project/nextplan.md`.
- Jangan mengedit `dist` manual; hasilkan dengan `npm run build`.
- Setelah perubahan kode, validasi build dan restart server hanya jika server sedang digunakan.
- Semua dokumentasi project wajib disimpan di folder `.project/`.
- Update `.project/CHANGELOG.md` untuk setiap perubahan penting.
- Update `.project/PRD.md` jika arsitektur, aturan, requirement, atau workflow berubah.
- Update `.project/nextplan.md` jika audit, prioritas, roadmap, atau pekerjaan lanjutan berubah.
- Jangan membuat atau menggunakan kembali folder `.agents/` maupun file `.agents/AGENTS.md`.
