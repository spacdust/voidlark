# Voidlark Next Plan

Lokasi kanonis roadmap ini adalah `.project/nextplan.md`. Setiap hasil audit, perubahan prioritas, dan pekerjaan lanjutan wajib diperbarui di file ini; jangan gunakan kembali folder `.agents/`.

Dokumen ini merangkum hasil audit produk, security, reliability, testing, observability, dan production readiness untuk bot WhatsApp CS otomatis Voidlark.

## Kondisi Saat Ini

| Area | Estimasi kesiapan |
|---|---:|
| Fitur CS dasar | 75% |
| Penjualan dan pesanan | 65% |
| Admin UX | 75% |
| AI dan Knowledge | 60% |
| Handoff manusia | 55% |
| Reliability | 25% |
| Security | 25% |
| Testing | 5% |
| Monitoring | 25% |
| Deployment | 15% |
| Production readiness keseluruhan | 35-40% |

Fondasi yang sudah tersedia:

- Koneksi WhatsApp melalui Baileys dan reconnect dasar.
- AI agent dengan tool calling.
- Riwayat chat, customer state, draft order, dan konfirmasi pesanan.
- Ongkir dan lookup eksternal dengan rotasi beberapa API key.
- Handoff manusia dan panel admin.
- Simulasi percakapan multi-turn.
- Matching deterministic produk luar ke pasangan Inspired -> Karakter berdasarkan family dan note yang dapat dibuktikan.

Kualitas data matcher berikutnya:

- Tingkatkan `penggolongan-notes.xlsx` dari family-level (`Fresh`, `Floral`, `Woody`, `Glamour`) ke notes-level per produk agar skor kemiripan tidak bergantung pada nama produk untuk notes eksplisit.
- Tambahkan sinonim aroma multilingual dan bobot top/middle/base setelah sumber data notes per kandidat tersedia.
- Tambahkan plugin `DomainMatcher` berikutnya untuk produk digital, elektronik, skincare, atau fashion ketika tiap domain sudah memiliki schema Knowledge dan aturan scoring yang eksplisit.
- Perluas universal claim validator ke quantity, promo, kompatibilitas, ingredients, delivery estimate, dan spesifikasi secara otomatis dari struktur Knowledge tanpa meminta input konfigurasi baru dari pengguna.
- Tambahkan registry strategi domain konfigurabel (misalnya electronics, fashion, food, dan SaaS) dengan schema atribut dan matcher masing-masing tanpa mengubah pipeline inti.
- Health endpoint dasar dan validasi koneksi AI.
- Backup Config, Prompt, dan Knowledge.
- SQLite dan PostgreSQL.
- Knowledge TXT, Markdown, PDF, DOCX, spreadsheet, CSV, gambar, dan OCR.
- Prompt Builder sebagai sumber tunggal system prompt.
- Instance lock, SQLite WAL, batas upload, dark mode, responsive UI, dan accessibility dasar.

## Fase 0 - Security Minimum Sebelum Push atau Deploy

- [x] Tambahkan `.env`, `.env.*`, WhatsApp auth/session, log, backup, dan seluruh data runtime ke `.gitignore`.
- [ ] Rotasi seluruh secret jika project atau `.env` pernah dibagikan atau dipush.
- [x] Tambahkan login admin dengan credential environment dan verifikasi constant-time.
- [x] Gunakan secure session cookie, expiration, dan rate limit login.
- [x] Tambahkan CSRF token untuk seluruh request mutasi admin.
- [x] Validasi `Origin` dan gunakan `SameSite=Strict`.
- [x] Tambahkan security headers dan `Cache-Control: no-store` untuk admin.
- [x] Redact tool arguments dan detail error admin dari log default; audit logger terstruktur untuk seluruh nomor/alamat/pesan tetap dilanjutkan sebelum deploy publik.
- [ ] Jalankan aplikasi dengan OS account berprivilege minimum.
- [ ] Tambahkan secret scanning dan dependency scanning ke CI quality gate. Audit lokal sudah dijalankan dan menemukan 1 advisory high pada `xlsx` tanpa fix upstream.
- [ ] Evaluasi atau isolasi dependency `xlsx` yang memiliki advisory high severity tanpa fix otomatis.

Kriteria selesai:

- Admin tidak dapat diakses tanpa autentikasi.
- POST sensitif ditolak tanpa CSRF yang valid.
- Tidak ada secret atau PII sensitif dalam repository dan log default.

## Fase 1 - Durable Message Pipeline

Prioritas tertinggi karena mencegah pesan hilang, order ganda, dan state race.

Status: durable inbound queue, dedupe, lease, per-JID serialization, global concurrency, retry/backoff, dead-letter, outbound outbox, provider ID, receipt delivered/read, serta tampilan/retry operator sudah diterapkan. Cancellation outbound multi-bubble produksi masih belum diterapkan; transaksi atomik bersama business state menunggu Fase 2.

### Inbound Queue

- [x] Proses seluruh item dalam `messages.upsert`, bukan hanya `messages[0]`.
- [x] Tambahkan tabel `inbound_messages`.
- [x] Simpan provider message ID dengan unique constraint.
- [x] Tambahkan lifecycle `queued`, `processing`, `retry`, `completed`, dan `dead_letter`.
- [x] Tambahkan attempts, next attempt, last error, lease token, dan lease expiry.
- [x] Klaim pesan secara atomik sebelum AI dipanggil.
- [x] Serialisasikan pemrosesan per JID.
- [x] Batasi concurrency global agar AI, DB, dan provider tidak overload.
- [x] Tambahkan exponential backoff dengan jitter.
- [x] Tambahkan dead-letter queue dan tampilan admin.

### Outbound Outbox

- [x] Tambahkan tabel `outbound_messages`.
- [ ] Simpan outbound intent dalam transaksi yang sama dengan perubahan business state.
- [x] Tambahkan status `queued`, `sending`, `sent`, `delivered`, `read`, `failed`, dan `dead_letter`.
- [x] Simpan provider message ID.
- [x] Retry kegagalan transient secara otomatis.
- [x] Tampilkan pesan gagal permanen di admin.
- [x] Gunakan receipt/update event WhatsApp untuk status delivery/read.
- [x] Tambahkan visibilitas operator jika notifikasi order atau handoff gagal.

Kriteria selesai:

- Duplicate provider message ID hanya diproses satu kali.
- Dua pesan cepat dari JID sama selalu diproses berurutan.
- Restart proses tidak menghilangkan pesan pending.
- Outbound gagal dapat di-retry dan terlihat oleh operator.

## Fase 2 - Database, Transaksi, dan Migration

- [ ] Tambahkan migration ledger `schema_migrations`.
- [ ] Pindahkan schema ke migration versioned, misalnya `001_initial`, `002_message_queue`, dan seterusnya.
- [ ] Uji migration pada database baru dan database SQLite lama.
- [ ] Pastikan kontrak schema SQLite dan PostgreSQL sama.
- [ ] Tambahkan transaction abstraction ke database layer.
- [ ] Jadikan order confirmation, chat state, audit event, dan outbound intent atomic.
- [ ] Jadikan mark-paid idempotent dan transactional.
- [ ] Tambahkan audit event untuk perubahan status sensitif.
- [ ] Tambahkan state machine yang menolak transisi order tidak valid.

Kriteria selesai:

- Kegagalan query di tengah operasi tidak meninggalkan state parsial.
- Schema version dapat dibaca dan migration dapat dilanjutkan dengan aman.

## Fase 3 - Order dan Payment Lifecycle

Status target:

```text
draft
awaiting_payment
payment_failed
payment_expired
paid
processing
packed
shipped
delivered
completed
cancelled
refund_requested
refunded
```

- [ ] Implementasikan transition matrix dan validasi state.
- [ ] Tambahkan pembatalan order.
- [ ] Tambahkan expiration pembayaran.
- [ ] Tambahkan processing, packed, shipped, delivered, dan completed.
- [ ] Tambahkan refund request dan refund completion.
- [ ] Tambahkan timeline order dan actor pada setiap perubahan.
- [ ] Integrasikan payment link atau QRIS.
- [ ] Verifikasi webhook signature.
- [ ] Simpan webhook event ID secara idempotent.
- [ ] Cocokkan nominal, currency, dan order reference.
- [ ] Jangan pernah mengizinkan AI menentukan status pembayaran.
- [ ] Tambahkan inventory/availability hook jika bisnis membutuhkannya.

Kriteria selesai:

- Duplicate webhook tidak menggandakan transisi.
- Status pembayaran dan fulfillment dapat direkonsiliasi.

## Fase 4 - Media dan Tipe Pesan WhatsApp

Saat ini alur utama hanya memahami pesan teks.

- [ ] Dukung image message.
- [ ] Dukung document/PDF message.
- [ ] Dukung voice note dengan transcription.
- [ ] Dukung location message untuk alamat atau ongkir.
- [ ] Dukung contact message.
- [ ] Dukung interactive reply jika digunakan.
- [ ] Simpan metadata attachment dan provider message ID.
- [ ] Kaitkan bukti pembayaran dengan order.
- [ ] Tampilkan attachment di Riwayat Percakapan dan Perlu Ditangani.
- [ ] Jika tipe media belum didukung, balas deterministik dan buat handoff.
- [ ] Jangan otomatis menandai bukti pembayaran sebagai lunas tanpa verifikasi.

Kriteria selesai:

- Bukti transfer, voice note, gambar produk, dan lokasi tidak lagi diabaikan diam-diam.

## Fase 5 - Handoff Operasional

- [x] Tambahkan status `waiting`, `assigned`, `handling`, dan `resolved`.
- [x] Tambahkan assigned admin/operator.
- [x] Tambahkan accepted_at, first_response_at, resolved_at, dan resolution note.
- [x] Tambahkan priority dan alasan terstruktur.
- [ ] Tampilkan pesan customer terbaru dan lama menunggu.
- [x] Tambahkan SLA handoff.
- [x] Tambahkan alert ketika SLA terlewati.
- [x] Cegah dua admin mengklaim customer yang sama.
- [ ] Tambahkan fallback jika nomor admin belum dikonfigurasi atau notif gagal.
- [x] Tambahkan jam operasional dan hari libur.
- [x] Tampilkan estimasi waktu respons admin di luar jam kerja.

Kriteria selesai:

- Operator mengetahui siapa menangani customer, sejak kapan, dan apakah SLA terlewati.

## Fase 6 - Consent, Privacy, dan Retention

- [x] Tangani `STOP`, `BERHENTI`, dan `UNSUBSCRIBE` sebelum AI dipanggil.
- [x] Tangani `START` atau opt-in ulang.
- [x] Simpan communication preference dan consent timestamp.
- [x] Bedakan pesan transaksi dan marketing.
- [ ] Jangan menambahkan broadcast sebelum consent model tersedia.
- [ ] Tetapkan retention chat, lead, handoff, order, attachment, dan log.
- [ ] Tambahkan export data customer.
- [ ] Tambahkan delete atau anonymize customer.
- [ ] Pertahankan record keuangan yang wajib secara legal dengan audit exception.
- [ ] Encrypt volume dan batasi ACL directory runtime.
- [ ] Pertimbangkan field-level encryption untuk alamat dan nomor telepon.
- [ ] Dokumentasikan data yang dikirim ke AI, lookup, ongkir, dan provider lain.

## Fase 7 - Knowledge Retrieval dan Ingestion

### Retrieval

- [ ] Jangan kirim seluruh Knowledge ke setiap AI request.
- [ ] Chunk Knowledge berdasarkan file, section, tabel, atau produk.
- [ ] Tambahkan keyword/BM25 retrieval sebagai tahap awal.
- [ ] Tambahkan vector search bila diperlukan.
- [ ] Ambil hanya 5-10 chunk paling relevan.
- [ ] Batasi total context Knowledge.
- [ ] Prioritaskan exact product match.
- [ ] Sertakan source filename dan section.
- [ ] Tambahkan citation/source internal untuk debugging.
- [ ] Pisahkan Knowledge sebagai data tidak tepercaya dari instruksi sistem.

### Ingestion

- [ ] Simpan status ingestion per file.
- [ ] Simpan checksum, versi, extracted text size, dan error.
- [ ] Bangun immutable snapshot baru.
- [ ] Aktifkan snapshot hanya jika build sukses.
- [ ] Pertahankan last-known-good snapshot ketika parser gagal.
- [ ] Jalankan OCR dan document parsing di worker terisolasi.
- [ ] Batasi halaman PDF, ukuran gambar, pixel count, spreadsheet cells, dan extracted characters.
- [ ] Tambahkan timeout dan resource limit parser.
- [ ] Tampilkan hasil per file di admin.

Kriteria selesai:

- File rusak tidak membuat Knowledge aktif menjadi parsial.
- Token dan latency tidak tumbuh linear dengan total ukuran Knowledge.

## Fase 8 - AI Safety dan Provider Resilience

- [ ] Tambahkan schema validation untuk seluruh tool arguments dengan Zod atau Ajv.
- [ ] Validasi enum, panjang teks, quantity, harga, address, dan status.
- [ ] Tambahkan policy layer sebelum setiap write yang diminta model.
- [ ] Gunakan idempotency key pada tool mutasi.
- [ ] Klasifikasikan transient dan permanent errors.
- [ ] Tambahkan retry budget, exponential backoff, dan circuit breaker.
- [ ] Tambahkan provider fallback untuk AI jika dibutuhkan.
- [ ] Tambahkan cooldown untuk API key yang gagal.
- [ ] Tambahkan deadline per turn.
- [ ] Setelah kegagalan berulang, kirim fallback customer dan buat handoff.
- [ ] Tambahkan batas token/cost per customer dan per hari.
- [ ] Tambahkan dataset evaluasi jawaban dan regression suite.
- [ ] Uji prompt injection dari customer dan Knowledge.

Fallback minimum:

```text
Maaf Kak, sistem sedang mengalami kendala. Pesan Kakak sudah diteruskan ke admin.
```

## Fase 9 - Automated Backup dan Recovery

Backup admin saat ini belum mencakup database dan sesi WhatsApp.

- [ ] Backup database otomatis setiap hari.
- [ ] Backup WhatsApp session secara aman jika strategi operasional mengizinkan.
- [ ] Encrypt backup.
- [ ] Simpan backup off-host.
- [ ] Gunakan retention harian, mingguan, dan bulanan.
- [ ] Simpan checksum dan status backup.
- [ ] Alert jika backup lebih tua dari 26 jam.
- [ ] Uji restore secara terjadwal.
- [ ] Buat restore atomic dengan rollback jika gagal.
- [ ] Dokumentasikan recovery point objective dan recovery time objective.

Target awal:

- RPO maksimal 24 jam.
- RTO maksimal 2 jam.

## Fase 10 - Observability dan SLO

### Structured Logging

- [ ] Gunakan Pino secara konsisten, bukan `console.log`.
- [ ] Tambahkan correlation ID untuk inbound, AI turn, order, dan outbound.
- [ ] Mask JID/phone dan redact message/address/tool args.
- [ ] Pisahkan level debug, info, warn, error, dan fatal.
- [ ] Tambahkan log rotation.

### Metrics

- [ ] `voidlark_inbound_messages_total`
- [ ] `voidlark_inbound_duplicates_total`
- [ ] `voidlark_inbound_queue_age_seconds`
- [ ] `voidlark_ai_latency_seconds`
- [ ] `voidlark_ai_errors_total`
- [ ] `voidlark_outbound_failures_total`
- [ ] `voidlark_outbound_dead_letters_total`
- [ ] `voidlark_handoff_wait_seconds`
- [ ] `voidlark_orders_total`
- [ ] `voidlark_payment_pending_age_seconds`
- [ ] `voidlark_knowledge_ingestion_failures_total`
- [ ] Database latency, error, size, dan WAL size.
- [ ] OCR queue duration dan extracted text size.

### SLO Awal

- [ ] 99% inbound message durable dalam 5 detik.
- [ ] 95% balasan otomatis selesai dalam 30 detik.
- [ ] 99.5% outbound message akhirnya terkirim.
- [ ] Handoff first response kurang dari 10 menit selama jam kerja.
- [ ] Backup database sukses setiap 24 jam.
- [ ] Target message loss: 0.

### Alert

- [ ] WhatsApp disconnect lebih dari 5 menit.
- [ ] Queue tertua lebih dari 60 detik.
- [ ] Semua AI provider/key gagal.
- [ ] Semua shipping/lookup key gagal.
- [ ] Dead-letter lebih dari 0.
- [ ] Database unavailable.
- [ ] Disk lebih dari 80%.
- [ ] Backup lebih tua dari 26 jam.
- [ ] Payment pending terlalu lama.
- [ ] Handoff melewati SLA.

## Fase 11 - Testing dan Quality Gates

Saat audit, belum ada project-owned automated tests atau test runner.

### Foundation

- [ ] Tambahkan Vitest atau test runner setara.
- [ ] Tambahkan scripts `test`, `test:unit`, `test:integration`, `test:e2e`, dan `coverage`.
- [ ] Pisahkan `createAdminApp()` dari port binding.
- [ ] Inject database, AI client, fetch, Baileys, clock, dan filesystem/temp directory.
- [ ] Hindari infrastructure global pada import time.

### 15 Test Prioritas Pertama

- [ ] Duplicate inbound message diproses sekali.
- [ ] Semua pesan dalam upsert batch diproses.
- [ ] Dua pesan cepat per JID tetap berurutan.
- [ ] Konfirmasi order rollback saat query kedua gagal.
- [ ] Mark paid idempotent.
- [ ] Invalid tool arguments ditolak.
- [ ] Legacy SQLite berhasil dimigrasi.
- [ ] Contract schema SQLite dan PostgreSQL sama.
- [ ] AI timeout retry lalu handoff.
- [ ] Outbound failure masuk retry queue.
- [ ] Duplicate payment webhook aman.
- [ ] Media payment proof tersimpan.
- [ ] Knowledge reload gagal mempertahankan snapshot lama.
- [ ] Restore gagal tidak membuat state parsial.
- [ ] Admin POST ditolak tanpa auth dan CSRF.

Target coverage:

- Unit tests 70% dari jumlah test.
- Integration tests 20%.
- E2E tests 10%.
- Critical business modules minimal 80% coverage.

## Fase 12 - Graceful Lifecycle dan Deployment

### Graceful Lifecycle

- [ ] Berhenti menerima pesan baru saat shutdown.
- [ ] Drain inbound dan outbound queue.
- [ ] Tunggu pekerjaan aktif hingga timeout.
- [ ] Tutup HTTP server.
- [ ] Tutup socket WhatsApp.
- [ ] Tutup database.
- [ ] Flush log.
- [ ] Lepaskan instance lock setelah cleanup.
- [ ] Tangani `unhandledRejection` dan `uncaughtException` secara terkontrol.

### Deployment

- [ ] Tambahkan Dockerfile atau service definition.
- [ ] Tambahkan process supervisor dan restart-on-failure.
- [ ] Gunakan fixed port di production; auto-port hanya untuk development.
- [ ] Tambahkan persistent volumes.
- [ ] Tambahkan resource limits.
- [ ] Pisahkan liveness dan readiness.
- [ ] Tambahkan CI/CD build, test, audit, dan secret scan.
- [ ] Dokumentasikan release, migration, rollback, dan restore.
- [ ] Tambahkan runbook untuk WA logout/conflict, AI outage, DB lock/full disk, queue backlog, dan failed backup.
- [ ] Lakukan failure drill sebelum launch.

## Urutan Eksekusi yang Disarankan

Status eksekusi lokal per 17 Juli 2026:

- [x] Paket A selesai pada level repository: test runner Windows, structured logging PII-safe, security/config tests, dan CI scanning tersedia.
- [x] Paket B selesai: durable inbound/outbound, dedupe, ordering, concurrency, retry/dead-letter, receipt, dan operator recovery.
- [x] Paket C selesai: versioned migration, transaction API, state machine order/payment, audit trail, backup, retention, dan restore drill.
- [x] Paket D selesai: media/payment proof, voice/location, handoff ownership/SLA, business hours, serta consent/opt-out.
- [x] Paket E selesai pada level lokal/offline: knowledge ingestion atomik, retrieval chunks, metrics/readiness/SLO, deployment artifacts, runbooks, dan resilience drills.

Catatan eksternal: rotasi secret aktual, instalasi dengan OS account minimum, konfigurasi provider payment nyata, dan verifikasi pada VPS/cloud target tetap membutuhkan akses deployment.

### Paket A - Fondasi Aman

1. `.gitignore`, rotasi secret, auth admin, CSRF, security headers.
2. Test runner dan test untuk security/config dasar.
3. PII-safe structured logging.

Target readiness setelah Paket A: sekitar 45-50%.

### Paket B - No Message Loss

1. Inbound queue dan deduplication.
2. Per-JID ordering.
3. Outbound outbox dan retry.
4. Delivery/read receipt.
5. Failure fallback dan handoff.

Target readiness setelah Paket B: sekitar 60-70%.

### Paket C - Business Integrity

1. Versioned migrations.
2. Transactional order state machine.
3. Payment lifecycle/webhook.
4. Audit trail.
5. Database backup otomatis.

Target readiness setelah Paket C: sekitar 75-80%.

### Paket D - CS Lengkap

1. Media dan payment proof.
2. Voice note dan location.
3. Handoff assignment/SLA.
4. Business hours.
5. Consent/opt-out.

Target readiness setelah Paket D: sekitar 85%.

### Paket E - Scale dan Operations

1. Retrieval/chunking.
2. Worker-based ingestion.
3. Metrics, alerts, SLO, runbooks.
4. CI/CD dan supervised deployment.
5. Load, replay, outage, restart, dan restore tests.

Target readiness setelah Paket E: 90%+ dengan catatan audit ulang dan production drill lulus.

## Production Launch Gates

Voidlark belum boleh dianggap production-ready sebelum semua kondisi ini terpenuhi:

- [ ] Durable inbound queue dan unique message-ID deduplication aktif.
- [ ] Per-JID ordering dan global concurrency limit aktif.
- [ ] Business state transactional dan replay-safe.
- [ ] Outbound outbox memiliki retry dan delivery status.
- [ ] Admin memiliki auth, authorization, CSRF, dan rate limit.
- [ ] Secrets dan PII dilindungi serta tidak masuk log/repository.
- [ ] Database migrations versioned dan diuji pada legacy DB.
- [ ] Automated encrypted off-host backup dan restore drill lulus.
- [ ] Liveness/readiness dipakai supervisor.
- [ ] Metrics, SLO dashboard, dan critical alerts aktif.
- [ ] Knowledge retrieval token-bounded dan ingestion atomic.
- [ ] Tool arguments divalidasi schema dan policy layer.
- [ ] Media penting tidak diabaikan.
- [ ] Critical automated tests dan failure drills lulus.
- [ ] Deployment rollback dan incident runbook tersedia.

## Catatan Audit

- Audit dilakukan secara statis menggunakan perspektif product design, UI review, security, production readiness, observability, dan testing/QA.
- `npm audit` menemukan satu high-severity vulnerability tanpa fix otomatis pada dependency saat ini.
- Server tidak dijalankan selama audit dan tetap dalam keadaan berhenti.
