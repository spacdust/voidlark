<div align="center">

# VOIDLARK

### AI Customer Service untuk WhatsApp yang tahan gangguan, dapat diaudit, dan siap dioperasikan

[![Node.js](https://img.shields.io/badge/Node.js-24-2E7D32?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-ESM-2563EB?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-Baileys-128C7E?style=flat-square&logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![Database](https://img.shields.io/badge/Database-SQLite%20%7C%20PostgreSQL-0F766E?style=flat-square)](#database)
[![Tests](https://img.shields.io/badge/Tests-107%20passing-16A34A?style=flat-square)](#pengujian)

**Konsultasi AI · Knowledge Base · Order & Payment · Handoff Admin · Durable Queue · Observability**

[Mulai Cepat](#mulai-cepat) · [Fitur](#fitur-utama) · [Arsitektur](#arsitektur) · [Konfigurasi](#konfigurasi) · [Deploy](#deployment)

</div>

---

## Tentang Voidlark

Voidlark adalah sistem Customer Service WhatsApp berbasis AI untuk bisnis fisik maupun digital. Sistem ini menangani percakapan konsultatif, rekomendasi produk, pengumpulan data pelanggan, draft pesanan, pembayaran manual, ongkir, pencarian referensi eksternal, dan eskalasi ke admin manusia.

Berbeda dari bot demo yang langsung memanggil model lalu mengirim balasan, Voidlark menyimpan setiap pesan ke durable pipeline. Pesan masuk dideduplikasi, diurutkan per pelanggan, diberi lease, di-retry dengan backoff, dan dipindahkan ke dead-letter queue jika gagal permanen. Pesan keluar menggunakan persistent outbox serta melacak status `sent`, `delivered`, dan `read`.

Aturan industri tidak di-hardcode di engine. Identitas bisnis, gaya balasan, alur checkout, jam operasional, consent, dan pengetahuan produk dapat dikelola melalui Admin UI serta file konfigurasi.

> [!IMPORTANT]
> Voidlark menggunakan library WhatsApp Web tidak resmi melalui Baileys. Pengguna bertanggung jawab mematuhi kebijakan WhatsApp, mendapatkan consent pelanggan, membatasi spam, dan mengoperasikan akun secara wajar.

## Daftar Isi

- [Fitur Utama](#fitur-utama)
- [Tampilan Operasional](#tampilan-operasional)
- [Cara Kerja](#cara-kerja)
- [Tech Stack](#tech-stack)
- [Mulai Cepat](#mulai-cepat)
- [Konfigurasi](#konfigurasi)
- [Menyiapkan Bisnis](#menyiapkan-bisnis)
- [Knowledge Base](#knowledge-base)
- [Database](#database)
- [Admin UI](#admin-ui)
- [Endpoint Operasional](#endpoint-operasional)
- [Backup dan Pemulihan](#backup-dan-pemulihan)
- [Pengujian](#pengujian)
- [Deployment](#deployment)
- [Keamanan](#keamanan)
- [Struktur Project](#struktur-project)
- [Troubleshooting](#troubleshooting)
- [Batasan](#batasan)

## Fitur Utama

### Percakapan dan AI

- Endpoint AI OpenAI-compatible; dapat menggunakan gateway lokal atau provider yang kompatibel.
- Menerima completion berbentuk JSON biasa maupun payload SSE dari gateway, lalu menormalisasinya sebelum respons dikirim.
- Tool calling untuk ongkir, penyimpanan lead, order, pembayaran, lookup eksternal, dan handoff.
- Riwayat percakapan dan customer state untuk menjaga konteks.
- Simulator percakapan pada Admin UI tanpa mengirim pesan WhatsApp nyata.
- System prompt aktif dipisahkan dari prompt builder dan tidak ditimpa saat halaman dibuka.

### Penjualan dan Operasional Bisnis

- Profil bisnis generik untuk produk fisik maupun digital.
- Alur penjualan konsultatif dan checkout field yang dapat dikonfigurasi.
- Lead capture, draft order, konfirmasi order, dan payment lifecycle.
- Perhitungan ongkir melalui RajaOngkir/Komerce.
- Jam operasional, hari libur, timezone, respons di luar jam kerja, dan SLA.
- Consent, opt-out, re-opt-in, dan suppression untuk pesan promosi.
- Handoff dengan priority, assignment, ownership, SLA, resolution note, dan audit trail.

### Durable Message Pipeline

- Memproses seluruh item dalam event `messages.upsert`.
- Deduplikasi berdasarkan provider message ID.
- Serialisasi per JID dengan concurrency global untuk JID berbeda.
- Lease, expiry recovery, exponential backoff, jitter, retry, dan dead-letter.
- Persistent outbound outbox dengan dedupe key.
- Pelacakan status outbound: `queued`, `sending`, `sent`, `delivered`, `read`, `failed`, `dead_letter`.
- Retry manual melalui Admin UI.

### Media dan Knowledge

- Input teks, gambar, PDF, caption, voice note, dan lokasi.
- Payment proof dengan MIME allowlist, batas ukuran, sanitasi filename, dan SHA-256.
- Knowledge source: TXT, Markdown, PDF, DOCX, XLSX, CSV, PNG, JPG, dan JPEG.
- OCR untuk gambar melalui Tesseract.
- Corpus versioning, checksum dedupe, bounded chunking, metadata, dan atomic activation.
- Corpus lama tetap aktif jika ingestion versi baru gagal.
- Lexical retrieval dengan evidence dan citation contract.

### Keandalan dan Observability

- SQLite default dan PostgreSQL opsional.
- Versioned migration dengan checksum.
- Transaction API dan nested savepoint.
- Append-only audit trail.
- Backup terjadwal, retention, checksum, restore validation, dan restore drill.
- Structured logging Pino dengan redaksi PII dan secret.
- Liveness, readiness, health detail, dan Prometheus metrics.
- SLO rules dan alert sink lokal berbentuk JSONL.
- Single-instance guard untuk mendeteksi proses aktif lain yang memakai workspace yang sama.

## Tampilan Operasional

Admin UI merupakan aplikasi server-rendered Express yang responsif dan tidak membutuhkan framework frontend terpisah.

| Area | Fungsi |
| --- | --- |
| Ringkasan | KPI lead, order, handoff, status layanan, dan antrean bermasalah |
| Profil & Alur | Identitas bisnis, checkout, shipping, jam kerja, SLA, dan consent |
| Gaya Balasan | Prompt builder, preset gaya, preview, validator, dan AI assist |
| Katalog & Informasi | Upload knowledge, status ingestion, corpus aktif, dan retry job |
| Simulasi Percakapan | Menguji respons AI tanpa mengirim WhatsApp |
| Calon Pelanggan | Melihat lead dan progres customer |
| Pesanan | Memfilter draft, awaiting payment, dan paid |
| Handoff | Assignment, priority, SLA, resolve, dan riwayat operator |
| Perlu Ditangani | Handoff pelanggan serta antrean pesan gagal/retry |
| Koneksi Sistem | Env editor, pengujian koneksi, health, backup, dan perawatan |

## Cara Kerja

```mermaid
flowchart LR
    WA[WhatsApp / Baileys] --> IQ[(Inbound Queue)]
    IQ --> D{Dedupe + Lease}
    D --> W[Per-JID Worker]
    W --> C[Consent & Business Hours]
    C --> K[Knowledge Retrieval]
    K --> AI[OpenAI-compatible AI]
    AI --> T[Business Tools]
    T --> DB[(SQLite / PostgreSQL)]
    AI --> OQ[(Outbound Outbox)]
    OQ --> WA
    WA --> R[Delivery / Read Receipts]
    R --> OQ
    DB --> UI[Admin UI]
    IQ --> UI
    OQ --> UI
```

Urutan bootstrap aplikasi:

1. Memvalidasi password production dan mengambil instance lock.
2. Menghubungkan database dan menjalankan migration.
3. Memuat active knowledge corpus serta worker ingestion.
4. Menyalakan scheduler backup database.
5. Menyalakan Admin UI dan endpoint operasional.
6. Membuka koneksi WhatsApp dan memulihkan queue yang belum selesai.

## Tech Stack

| Lapisan | Teknologi |
| --- | --- |
| Runtime | Node.js 24, TypeScript, ESM, `tsx`, `tsc` |
| WhatsApp | `@whiskeysockets/baileys` |
| AI | OpenAI-compatible HTTP API dan OpenAI SDK |
| Web | Express 5, server-rendered HTML/CSS/JS |
| Database | SQLite bawaan Node.js atau PostgreSQL melalui `pg` |
| Knowledge | `pdf-parse`, Mammoth, SheetJS, Tesseract.js |
| Logging | Pino dan `pino-pretty` untuk development |
| Security | Helmet, rate limiting, CSRF, Fetch Metadata, secure session cookie |
| Icons | Phosphor Icons |
| Delivery | Docker multi-stage, Compose, GitHub Actions |

## Prasyarat

- Node.js 24 atau lebih baru.
- npm yang disertakan bersama Node.js.
- Akun WhatsApp yang dapat memindai QR.
- Endpoint AI OpenAI-compatible.
- Opsional: PostgreSQL, Docker, RajaOngkir/Komerce, Tavily, atau Brave Search.

## Mulai Cepat

### 1. Install dependency

```powershell
npm install
```

Untuk instalasi reproducible pada CI atau deployment:

```powershell
npm ci
```

### 2. Buat konfigurasi environment

```powershell
Copy-Item ".env.example" ".env"
```

Linux/macOS:

```bash
cp .env.example .env
```

Isi minimal berikut:

```dotenv
DB_DRIVER=sqlite
SQLITE_PATH=./data/voidlark.db
AI_API_BASE_URL=http://localhost:20128/v1
AI_API_KEY=your_api_key
AI_MODEL=gemini/gemini-2.5-flash
ADMIN_PASSWORD=development-password
HOST=127.0.0.1
PORT=3000
```

> [!NOTE]
> `.env.example` menggunakan `AI_API_BASE_URL`, `AI_API_KEY`, dan `AI_MODEL`. `OPENROUTER_API_KEY` tersedia hanya sebagai fallback kompatibilitas lama.

### 3. Jalankan development server

```powershell
npm run dev
```

Development memilih port kosong mulai `3000`. URL aktual ditulis ke terminal, misalnya:

```text
Admin web aktif: http://127.0.0.1:3001/admin
```

### 4. Login dan hubungkan WhatsApp

1. Buka URL Admin yang muncul di terminal.
2. Login menggunakan `ADMIN_PASSWORD`.
3. Buka **Koneksi Sistem** dan pastikan AI/database siap.
4. Scan QR WhatsApp yang muncul di terminal jika sesi belum tersedia.
5. Tunggu status WhatsApp menjadi `open`.
6. Uji respons melalui **Simulasi Percakapan** sebelum mengirim pesan nyata.

### 5. Build production

```powershell
npm run build
npm start
```

`npm start` menjalankan `dist/index.js` dalam mode production dan akan menolak password admin lemah atau default.

## Konfigurasi

### Environment variables

| Variable | Wajib | Default | Keterangan |
| --- | --- | --- | --- |
| `DB_DRIVER` | Tidak | `sqlite` | `sqlite` atau `postgres` |
| `SQLITE_PATH` | SQLite | `./data/voidlark.db` | Lokasi database SQLite |
| `DATABASE_URL` | PostgreSQL | - | PostgreSQL connection string |
| `AI_API_BASE_URL` | Ya | `http://localhost:20128/v1` | Base URL API OpenAI-compatible |
| `AI_API_KEY` | Ya | - | Credential AI utama |
| `AI_MODEL` | Ya | provider-dependent | ID model persis dari provider/gateway |
| `ADMIN_PASSWORD` | Ya | - | Password Admin UI; production minimal 16 karakter dan tidak boleh berpola lemah |
| `HOST` | Tidak | `127.0.0.1` | Bind host Admin UI |
| `PORT` | Tidak | `3000` | Port awal development dan fixed port production |
| `ADMIN_WA_JID` | Disarankan | - | JID WhatsApp operator, contoh `628xxx@s.whatsapp.net` |
| `RAJAONGKIR_API_KEY` | Opsional | - | Satu atau beberapa key dipisahkan koma |
| `STORE_DESTINATION_ID` | Ongkir | - | ID lokasi toko untuk kalkulasi ongkir |
| `STORE_CITY_NAME` | Tidak | `Bantul` | Label lokasi asal |
| `SHIPPING_COURIERS` | Tidak | daftar kurir | Kurir yang diminta ke API |
| `SHIPPING_WEIGHT_GRAMS` | Tidak | `500` | Fallback berat jika produk tidak terbaca |
| `TAVILY_API_KEY` | Opsional | - | Key lookup eksternal, mendukung rotasi dengan koma |
| `BRAVE_SEARCH_API_KEY` | Opsional | - | Kompatibilitas lookup lama |
| `DB_BACKUP_ENABLED` | Tidak | `true` | Menyalakan scheduler backup |
| `DB_BACKUP_DIR` | Tidak | `./backups/database` | Direktori backup database |
| `DB_BACKUP_RETENTION` | Tidak | `14` | Jumlah backup yang dipertahankan |
| `DB_BACKUP_INTERVAL_MINUTES` | Tidak | `1440` | Interval scheduler backup |
| `DB_BACKUP_RUN_ON_START` | Tidak | `false` | Membuat backup saat startup |
| `SLO_RULES_JSON` | Tidak | `[]` | Daftar rule SLO berbentuk JSON array |
| `ALERT_LOG_HOOK_FILE` | Tidak | - | File JSONL untuk alert lokal |
| `LOG_LEVEL` | Tidak | `debug` dev / `info` prod | Level structured logging Pino |
| `INBOUND_CONCURRENCY` | Tidak | `3` | Batas worker inbound lintas JID |
| `INBOUND_MEDIA_ROOT` | Tidak | `./data/inbound-media` | Penyimpanan media masuk |
| `INBOUND_MEDIA_MAX_BYTES` | Tidak | `10485760` | Batas byte media masuk |
| `PAYMENT_WEBHOOK_SECRET` | Webhook | - | Shared secret HMAC payment webhook |
| `PAYMENT_WEBHOOK_SIGNATURE_HEADER` | Tidak | `x-payment-signature` | Header signature webhook |

Lihat seluruh contoh di [`.env.example`](.env.example).

### File konfigurasi

| File | Peran |
| --- | --- |
| `business.config.json` | Identitas bisnis, flow, checkout, shipping, jam operasional, SLA, consent |
| `prompt.builder.json` | Sumber form Gaya Balasan dan preset prompt |
| `config/system-prompt.txt` | System prompt aktif yang digunakan bot |
| `knowledge_base/` | Dokumen pengetahuan bisnis |

Isi `knowledge_base/` bersifat data operasional lokal dan diabaikan Git. Repository hanya mempertahankan `knowledge_base/.gitkeep`; unggah dokumen melalui Admin UI pada setiap environment atau pulihkan dari cadangan konfigurasi.
| `.env` | Secret dan konfigurasi runtime |

> [!WARNING]
> Jangan commit `.env`, API key, database customer, backup, atau sesi WhatsApp. Path sensitif sudah dikecualikan melalui `.gitignore`.

## Menyiapkan Bisnis

Gunakan **Admin → Profil & Alur** untuk mengatur:

- nama bisnis dan nama CS virtual,
- produk fisik atau digital,
- sales flow,
- field pesanan,
- field checkout,
- ongkir dan aturan berat,
- instruksi pembayaran,
- handoff opsional setelah rekap pembayaran,
- jam operasional dan hari libur,
- SLA handoff,
- keyword opt-out dan opt-in.

Contoh konfigurasi minimal:

```json
{
  "businessName": "Aromatique",
  "csName": "Anindya",
  "productType": "physical",
  "enableShipping": true,
  "salesFlow": "consultative",
  "checkoutFields": ["name", "phone", "address"],
  "orderFields": ["productName", "variant", "quantity", "productPrice", "shippingCost"],
  "paymentInstructions": "Transfer ke rekening bisnis lalu kirim bukti pembayaran."
}
```

### System prompt dan gaya balasan

- **Gaya Balasan** mengelola `prompt.builder.json`.
- Menekan tombol simpan secara eksplisit menghasilkan `config/system-prompt.txt` baru.
- Membuka atau me-refresh halaman Prompt tidak mengubah system prompt aktif.
- Aturan khusus produk sebaiknya ditempatkan dalam Knowledge Base, bukan hardcode source code.

Sebelum perubahan besar, unduh backup konfigurasi melalui **Koneksi Sistem → Backup & Pemulihan**.

## Knowledge Base

### Format yang didukung

| Jenis | Ekstensi |
| --- | --- |
| Teks | `.txt`, `.md`, `.csv` |
| Dokumen | `.pdf`, `.docx` |
| Spreadsheet | `.xlsx` |
| Gambar/OCR | `.png`, `.jpg`, `.jpeg` |

### Alur ingestion

1. File diunggah melalui Admin UI.
2. Sistem membuat ingestion job persisten.
3. Konten diekstrak dan dinormalisasi.
4. Dokumen dipecah menjadi chunk dengan metadata dan checksum.
5. Corpus baru diaktifkan secara atomik jika seluruh proses berhasil.
6. Jika gagal, corpus sebelumnya tetap menjadi sumber aktif.

Operator dapat melihat error dan menjalankan retry pada halaman Katalog & Informasi.

### Pedoman isi

- Gunakan nama produk, variasi, harga, dan kebijakan yang eksplisit.
- Pertahankan header tabel dan arah relasi antar-kolom.
- Hindari beberapa harga ambigu untuk nama produk yang sama.
- Jangan memasukkan API key, password, atau data pribadi customer.
- Pisahkan dokumen berdasarkan domain agar retrieval lebih presisi.

## Database

### SQLite

SQLite adalah default dan cocok untuk satu instance:

```dotenv
DB_DRIVER=sqlite
SQLITE_PATH=./data/voidlark.db
```

Runtime menggunakan WAL, busy timeout, migration ledger, transaction serialization, dan savepoint untuk nested transaction.

### PostgreSQL

```dotenv
DB_DRIVER=postgres
DATABASE_URL=postgres://voidlark:strong-password@localhost:5432/voidlark
```

PostgreSQL menggunakan connection pool, transaksi per client, nested savepoint, dan migration yang sama secara semantik.

### Migration

Migration berjalan otomatis saat startup. Setiap migration memiliki versi dan checksum. Jangan mengedit migration yang sudah pernah diterapkan pada database production; tambahkan migration baru.

## Admin UI

Default development URL:

```text
http://127.0.0.1:3000/admin
```

Development dapat berpindah ke port berikutnya jika port sedang digunakan. Production menggunakan fixed port dan gagal startup jika port tidak tersedia.

Security controls Admin UI:

- password login dan rate limiting,
- signed session dengan expiry,
- `HttpOnly`, `SameSite=Strict`, dan secure cookie pada production HTTPS,
- CSRF token untuk request mutasi,
- Fetch Metadata checks,
- Helmet security headers,
- same-origin multipart validation,
- logout eksplisit.

## Endpoint Operasional

| Endpoint | Tujuan | Status sehat |
| --- | --- | --- |
| `GET /health/live` | Memastikan proses hidup | `200` |
| `GET /health/ready` | Memastikan dependency siap menerima traffic | `200` |
| `GET /health` | Status detail database, WhatsApp, AI, shipping, lookup | `200`, dapat `degraded` |
| `GET /metrics` | Prometheus exposition format | `200` |
| `POST /webhooks/payment` | Webhook payment idempotent dengan HMAC | `200`/`4xx` |

Contoh:

```powershell
Invoke-RestMethod "http://127.0.0.1:3000/health/live"
Invoke-RestMethod "http://127.0.0.1:3000/health/ready"
Invoke-WebRequest "http://127.0.0.1:3000/metrics"
```

Readiness dapat mengembalikan `503` ketika database, AI, backup freshness, atau antrean melewati batas operasional. Status WhatsApp tersedia pada `GET /health`, tetapi tidak menjadi gate readiness saat ini.

## Backup dan Pemulihan

### Backup database manual

```powershell
npm run db:backup
```

Backup menggunakan temporary file dan atomic rename, lalu menyimpan checksum serta metadata run.

### Restore drill

```powershell
npm run db:backup:drill -- "backups/database/nama-backup.db"
```

Restore drill memvalidasi checksum dan membuka salinan disposable. Perintah ini tidak menimpa database aktif.

### Backup konfigurasi

Admin UI dapat mengekspor dan memulihkan:

- `business.config.json`,
- `config/system-prompt.txt`,
- `prompt.builder.json`,
- seluruh file `knowledge_base/`.

Backup konfigurasi tidak menyertakan `.env`, API key, sesi WhatsApp, atau database customer.

> [!CAUTION]
> Simpan salinan backup terverifikasi di luar host. Backup pada disk/volume yang sama tidak melindungi dari kehilangan server atau volume.

## Pengujian

Jalankan seluruh suite:

```powershell
npm test
```

Build dan type-check:

```powershell
npm run build
```

Suite saat ini mencakup 107 test untuk:

- security, auth, CSRF, dan konfigurasi,
- prompt preservation,
- database portability dan transaction rollback,
- migration idempotence dan checksum,
- order/payment state machine,
- queue dedupe, ordering, concurrency, retry, replay, restart, dan dead-letter,
- media security dan deterministic failure handling,
- business hours, consent, handoff assignment, SLA, dan race handling,
- knowledge chunking, retrieval, atomic activation, dan restart recovery,
- backup checksum, retention, corrupt restore rejection, dan drill,
- metrics, readiness, dan operational retry behavior.

Test runner menjalankan setiap file dalam proses terisolasi dengan timeout agar stabil pada Windows dan mencegah resource leak antar-test.

## Deployment

### Docker Compose

Buat `.env` production dan isi minimal:

```dotenv
ADMIN_PASSWORD=gunakan-password-kuat-minimal-16-karakter
AI_API_BASE_URL=https://gateway.example.com/v1
AI_API_KEY=secret
AI_MODEL=provider/model
```

Jalankan:

```powershell
docker compose up -d --build
```

Verifikasi:

```powershell
docker compose ps
docker compose logs --tail=200 voidlark
Invoke-RestMethod "http://127.0.0.1:3000/health/live"
Invoke-RestMethod "http://127.0.0.1:3000/health/ready"
```

Compose menyediakan persistent volume untuk:

- database,
- backup,
- Knowledge Base.

Runtime image menggunakan user non-root dan resource limit. Sesi WhatsApp disimpan pada tabel `auth_keys`, sehingga ikut persisten bersama volume database.

### Native service

```powershell
npm ci
npm run build
$env:ADMIN_PASSWORD="password-production-kuat"
npm start
```

Gunakan process supervisor seperti systemd, NSSM, Docker, atau orchestrator lain. Pastikan hanya satu instance memiliki nomor/sesi WhatsApp yang sama.

### CI

Workflow GitHub Actions berada di `.github/workflows/ci.yml` dan menjalankan instalasi, build, full tests, audit dependency, dan secret scanning tanpa credential production.

## Keamanan

- Jangan mengekspos Admin UI langsung ke internet tanpa HTTPS, firewall, dan access control tambahan.
- Bind ke `127.0.0.1` bila hanya digunakan lokal atau melalui SSH tunnel.
- Gunakan reverse proxy dengan TLS pada production.
- Rotasi AI, shipping, lookup, database, dan admin credentials secara berkala.
- Jangan menulis isi pesan, JID mentah, token, cookie, atau secret ke log.
- Batasi permission direktori `data/`, `backups/`, `knowledge_base/`, dan auth WhatsApp.
- Uji restore backup secara berkala, bukan hanya pembuatan backup.
- Jangan menjalankan lebih dari satu instance pada sesi WhatsApp yang sama.
- Tinjau dead-letter queue dan audit trail setiap hari.

## Struktur Project

```text
.
├── src/
│   ├── admin/          # Admin UI, auth, CSRF, settings, operator controls
│   ├── ai/             # Agent, tool calling, extraction, chunking, retrieval
│   ├── api/            # Shipping, lookup, dan integrasi eksternal
│   ├── chat/           # History, state, lead, order, consent, handoff, business hours
│   ├── config/         # Database, migration, logging, backup, instance lock
│   ├── operations/     # Metrics, health/readiness, retry dan SLO helpers
│   ├── payments/       # Payment lifecycle dan webhook
│   ├── whatsapp/       # Connection, media input, durable store dan worker
│   └── index.ts        # Bootstrap dan graceful shutdown
├── tests/              # Test suite offline dan deterministic
├── docs/operations.md  # Runbook incident dan prosedur operasi
├── knowledge_base/     # Dokumen sumber bisnis
├── business.config.json
├── prompt.builder.json
├── config/
│   └── system-prompt.txt
├── Dockerfile
├── compose.yml
└── package.json
```

## Troubleshooting

### Admin tidak bisa dibuka

- Periksa URL aktual di terminal; development mungkin berpindah dari port `3000`.
- Periksa `HOST` dan `PORT`.
- Pastikan hanya satu process memegang `data/voidlark.lock`.
- Gunakan `/health/live` untuk memastikan proses hidup.

### Login selalu gagal

- Pastikan `ADMIN_PASSWORD` sudah dimuat dari `.env`.
- Restart aplikasi setelah mengubah `.env`.
- Production menolak password default, berulang, berurutan, atau terlalu lemah.
- Tunggu rate-limit window jika terjadi terlalu banyak percobaan.

### QR WhatsApp tidak muncul atau koneksi conflict

- Pastikan tidak ada instance lain menggunakan sesi/nomor yang sama.
- Hentikan process duplikat sebelum membersihkan sesi.
- Jangan menghapus file sesi ketika proses masih berjalan.
- Setelah login ulang, verifikasi status WhatsApp `open` dan kirim satu pesan kontrol.

### AI tidak merespons

- Periksa `AI_API_BASE_URL`, `AI_API_KEY`, dan `AI_MODEL`.
- Uji endpoint melalui tombol test pada Koneksi Sistem tanpa mencetak key.
- Periksa quota, timeout, DNS, dan status provider/gateway.
- Gunakan Simulasi Percakapan untuk memisahkan masalah AI dari WhatsApp.

### Database SQLite terkunci

- Pastikan hanya satu instance aplikasi aktif.
- Hentikan maintenance atau backup eksternal yang membuka DB terlalu lama.
- Jangan menghapus file `-wal` atau `-shm` ketika aplikasi berjalan.
- Periksa kapasitas disk dan permission direktori `data/`.

### Pesan tertahan atau gagal

- Buka **Koneksi Sistem → Antrean pesan bermasalah**.
- Periksa error terakhir, attempts, dan status dead-letter.
- Pulihkan dependency sebelum menekan retry.
- Buka **Perlu Ditangani → Antrean pesan bermasalah**, lalu pantau `voidlark_queue_depth` dan `/health/ready`.

### Knowledge baru tidak aktif

- Buka Katalog & Informasi dan periksa ingestion job.
- Perbaiki format atau ukuran file yang gagal.
- Jalankan retry job.
- Corpus lama sengaja tetap aktif sampai seluruh corpus baru berhasil.

Runbook lengkap tersedia di [`docs/operations.md`](docs/operations.md).

## Batasan

- Integrasi WhatsApp melalui Baileys bukan WhatsApp Business Cloud API resmi.
- Payment provider production harus dikonfigurasi sesuai PSP yang digunakan bisnis.
- Backup harus direplikasi ke storage off-host secara terpisah.
- PostgreSQL backup memerlukan tool `pg_dump` yang kompatibel di host.
- OCR dan transkripsi dipengaruhi kualitas media serta ketersediaan AI provider.
- Browser/admin runtime QA pada target production tetap diperlukan setelah deployment.

## Status Project

Voidlark saat ini memiliki fondasi production-oriented: durable messaging, transaksi data, operator workflow, knowledge ingestion atomik, observability, backup/restore, CI, dan container deployment. Langkah sebelum go-live adalah mengisi ulang konfigurasi bisnis yang benar, memasukkan secret production, menjalankan restore drill, menghubungkan nomor WhatsApp terkontrol, dan melakukan acceptance test end-to-end pada host target.

---

<div align="center">

**Voidlark** — percakapan otomatis yang tetap bisa diawasi, dipulihkan, dan dipertanggungjawabkan.

</div>
