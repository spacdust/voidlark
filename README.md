<div align="center">

<img src="docs/assets/voidlark-logo-clean.svg" alt="Voidlark" width="220">

### Customer Sales Support untuk WhatsApp

Konsultasi produk, lead closing, pesanan, dan handoff admin dalam satu workspace operasional.

[![Node.js](https://img.shields.io/badge/Node.js-24-2E7D32?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-ESM-2563EB?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-Baileys-128C7E?style=flat-square&logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![Tests](https://img.shields.io/badge/Tests-npm%20test-16A34A?style=flat-square)](#validasi)

</div>

## Status

Voidlark siap untuk **staging dan pilot terkontrol**, belum untuk klaim production-ready penuh. Deployment nyata, backup off-host, browser E2E/failure drill, CSP style yang ketat, alert routing, dan payment/fulfillment penuh masih menjadi launch gate. Lihat [roadmap](docs/ROADMAP.md).

Admin memakai Express server-rendered HTML/CSS/JS. Tidak ada React, Vite, Tailwind, atau paket shadcn/ui. UI memakai Inter Variable, IBM Plex Mono untuk data teknis, Phosphor Icons, serta tema light/dark/system.

## Kemampuan utama

- WhatsApp multi-number: onboarding QR-first, sesi terisolasi, reconnect, rotasi round-robin/least-busy, sticky assignment, kuota harian, dan nama CS per nomor.
- AI OpenAI-compatible dengan bounded context, tool validation, evidence/claim guard, provider fallback, dan simulator bercitation internal.
- Durable inbound queue dan outbound outbox: dedupe, lease, urutan per JID, retry, dead-letter, serta status delivered/read.
- Knowledge atomik untuk TXT, MD, PDF, DOCX, XLSX, CSV, PNG, JPG, dan JPEG.
- Lead, draft pesanan, ongkir, pembayaran manual/webhook foundation, consent, jam bisnis, SLA, dan handoff operator.
- SQLite default atau PostgreSQL opsional, audit trail, health/readiness, Prometheus metrics, dan backup database lokal.

## Arsitektur ringkas

```text
WhatsApp/Baileys
  -> durable inbound queue
  -> consent + business-hours guard
  -> Knowledge retrieval + AI policy/claim guard
  -> tools: lead, order, ongkir, lookup, handoff
  -> durable outbound outbox
  -> WhatsApp delivery/read receipt

Express Admin UI <-> configuration + operational database
Health/metrics   <-> queue + database + WhatsApp + backup state
```

## Mulai cepat

Prasyarat: Node.js 24+ dan npm.

```powershell
npm install
Copy-Item ".env.example" ".env"
npm run dev
```

Isi minimal `.env`:

```dotenv
DB_DRIVER=sqlite
SQLITE_PATH=./data/voidlark.db
AI_API_BASE_URL=http://localhost:20128/v1
AI_API_KEY=your_ai_api_key
AI_MODEL=gemini/gemini-2.5-flash
ADMIN_PASSWORD=password-kuat-minimal-16-karakter
HOST=127.0.0.1
PORT=3000
```

Development memilih port kosong mulai dari `PORT` dan mencetak URL Admin aktif di terminal. Gunakan URL tersebut; jangan mengasumsikan port selalu `3000`. Satu proses dijaga oleh `data/voidlark.lock`.

Setelah login:

1. Buka **Koneksi Sistem** dan tes koneksi AI.
2. Isi **Profil & Alur**, **Gaya Balasan**, serta **Katalog & Informasi**.
3. Buka **Manajemen WA**, tambah nomor, lalu scan QR baru.
4. Uji perilaku bot melalui **Simulasi Percakapan** sebelum menerima traffic nyata.

Referensi seluruh variabel tersedia di [.env.example](.env.example). Secret tidak boleh masuk Git, dokumentasi, atau log.

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Development dengan `tsx watch` |
| `npm run dev:restart` | Hentikan instance workspace aktif lalu mulai ulang development |
| `npm run build` | Compile TypeScript ke `dist/` |
| `npm start` | Jalankan hasil build dari `dist/index.js` |
| `npm test` | Jalankan seluruh test |
| `npm run ops:smoke` | Smoke test health/metrics; base URL dapat diatur lewat `VOIDLARK_URL` |
| `npm run db:backup` | Buat backup database lokal |
| `npm run db:backup:drill -- <file>` | Verifikasi restore backup tanpa mengganti database aktif |

`src/` hanya berisi TypeScript. Ekstensi `.js` pada import internal diperlukan oleh ESM `NodeNext`. `dist/` adalah output build dan tidak diedit manual.

## Admin workspace

| Menu | Fungsi |
|---|---|
| Ringkasan | KPI pekerjaan pelanggan dan kesiapan sistem |
| Perlu Ditangani | Handoff, SLA, retry, dan dead-letter |
| Pelanggan & Chat | Lead, preferensi, dan riwayat percakapan |
| Pesanan | Draft, menunggu bayar, dan pesanan lunas |
| Profil & Alur | Identitas bisnis, checkout, ongkir, SLA, dan consent |
| Gaya Balasan | Preferensi bahasa dan aturan lanjutan bot |
| Katalog & Informasi | Upload dan pengelolaan sumber Knowledge |
| Simulasi Percakapan | Pengujian bot tanpa mengirim WhatsApp atau menyimpan data customer |
| Manajemen WA | Nomor, QR, sesi, rotasi, kuota, dan anti-ban |
| Koneksi Sistem | AI, ongkir, lookup eksternal, handoff, database, backup, dan perawatan |

Health dan observability:

- `/health/live`: proses hidup.
- `/health/ready`: dependency dan gate kesiapan.
- `/health`: status operasional terperinci.
- `/metrics`: metrik Prometheus.

## Deployment

Docker multi-stage, Compose, dan GitHub Actions CI tersedia. Compose menjalankan proses non-root, `no-new-privileges`, healthcheck, resource limit, persistent volume, dan grace period 60 detik.

```powershell
docker compose up -d --build
docker compose ps
$env:VOIDLARK_URL='http://127.0.0.1:3000'; npm run ops:smoke
```

Volume menyimpan database/runtime, backup lokal, dan Knowledge. Backup tersebut tetap same-host; salin dan uji restore ke storage off-host sebelum production. Jangan mengekspos Admin langsung ke internet tanpa HTTPS reverse proxy dan kontrol akses yang sesuai.

## Validasi

```powershell
npm run build
npm test
npm audit --audit-level=high
```

CI menjalankan build, test, audit dependency, dan secret scan. Jumlah test sengaja tidak dicantumkan karena berubah mengikuti kode.

## Struktur repositori

```text
cs-automation/
|-- src/                  # Source TypeScript aplikasi
|   |-- admin/            # SSR Admin, auth, CSRF, dan operator UI
|   |-- ai/               # Agent, retrieval, tools, dan safeguards
|   |-- config/           # Database, migration, backup, dan logging
|   |-- operations/       # Health, readiness, metrics, dan privacy
|   `-- whatsapp/         # Multi-session, inbound queue, dan outbox
|-- tests/                # Test runner dan regression tests
|-- config/               # System prompt aktif
|-- docs/                 # Dokumen kanonis dan aset
|-- scripts/              # Restart dan deployment smoke helpers
|-- dist/                 # Output build; jangan edit manual
|-- CHANGELOG.md          # Riwayat perubahan
|-- business.config.json  # Profil dan alur bisnis aktif
`-- compose.yml           # Spesifikasi deployment container
```

## Dokumentasi kanonis

- [PRD dan aturan engineering](docs/PRD.md)
- [Roadmap dan launch gates](docs/ROADMAP.md)
- [Runbook operasional](docs/operations.md)
- [Changelog](CHANGELOG.md)

## Catatan WhatsApp

Voidlark memakai koneksi WhatsApp Web melalui Baileys, bukan WhatsApp Business Platform resmi. Pengguna bertanggung jawab atas consent pelanggan, kepatuhan kebijakan platform, keamanan sesi, rate limit, dan risiko pembatasan akun. Jangan memakai sistem untuk spam atau komunikasi tanpa izin.
