# Voidlark Roadmap

Dokumen kanonis rencana produk dan engineering. Update berdasarkan kode, test, dan deployment aktual—bukan asumsi audit lama.

## Status sekarang

Voidlark sudah memiliki fondasi operasional yang kuat untuk staging dan pilot terkontrol:

- Admin server-rendered dengan auth session, CSRF, Origin/Fetch Metadata check, rate limit, security headers, light/dark responsive UI.
- Durable inbound/outbound queue: dedupe, lease, per-JID ordering, retry, dead-letter, receipt delivery/read, operator retry.
- Order state machine, transaction abstraction, migration ledger, audit event, idempotent payment webhook.
- Handoff waiting/assigned/handling/resolved, ownership race-safe, SLA, business hours, consent opt-out/opt-in.
- Knowledge ingestion worker, checksum dedupe, bounded chunking/retrieval, citation, atomic activation, last-known-good corpus.
- AI policy layer, tool schema validation, evidence/claim guard, circuit breaker, token/cost limiter, provider fallback, prompt-injection regression tests.
- Media text/image/document/location/voice path dengan batas ukuran, metadata, transcription, dan fallback permanen.
- WhatsApp multi-number: QR-first onboarding, auth terisolasi, reconnect, conflict/logout handling, rotasi, sticky assignment, hard daily quota, queue/rate-limit per nomor.
- Local database backup SQLite/PostgreSQL, checksum, retention, audit `backup_runs`, restore drill, health endpoint, Prometheus metrics, CI build/test/audit/gitleaks.
- Source aplikasi TypeScript-only; dokumentasi kanonis berada di `docs/` dan `CHANGELOG.md`.
- Seluruh Admin UI, termasuk login dan Ringkasan, memakai renderer Express server-side dengan HTML/CSS/JS native. Eksperimen React/Vite/Tailwind sudah dibatalkan dan artefaknya dibersihkan.
- Satu shell navigasi, token tema, font Inter Variable, IBM Plex Mono untuk data teknis, dan Phosphor Icons dipakai konsisten di seluruh route Admin.

## Batas yang masih terbuka

Ini bukan blocker untuk pilot lokal, tetapi blocker untuk klaim production penuh:

1. Deployment belum dibuktikan pada target VPS/cloud nyata dengan supervisor, persistent volume, resource limit, dan rollback drill.
2. Backup masih local/same-host. Provider off-host belum aktif; S3 adapter fail-closed.
3. CSP masih memakai `unsafe-inline` karena renderer Admin menyatukan HTML/CSS/JS inline.
4. Bounded shutdown drain sudah tersedia; process-kill recovery dan failure drill pada target nyata belum dibuktikan.
5. Belum ada E2E browser, Baileys mock integration, load/replay/failure drill nyata, dan coverage report.
6. Payment/fulfillment belum mencakup payment gateway nyata, expiration/refund, inventory, serta seluruh status fulfillment.
7. Privacy retention, export/delete, dan anonymization sudah ada di kode, tetapi perlu integration test dan kebijakan retention bisnis tertulis.
8. Media video/sticker/contact/reaction/quoted-message belum menjadi alur khusus; tipe unsupported tetap diarahkan ke handoff.
9. Observability belum punya dashboard/alert routing operator; saat ini metrics dan structured log tersedia.
10. `exceljs` masih membawa advisory moderate melalui `uuid`; jangan gunakan `npm audit fix --force` tanpa rencana dependency.

## Rencana eksekusi berikutnya

### Sprint 1 — Production gate dan deployment proof

Prioritas tertinggi. Tidak menambah fitur bisnis.

- [x] Tambah Docker healthcheck, grace period, non-root runtime, `no-new-privileges`, dan deployment smoke command.
- [ ] Jalankan smoke test pada target deployment nyata.
- Tetapkan env production, fixed port, persistent volume, resource limit, dan satu-instance ownership.
- Jalankan failure drill: restart, DB lock, queue backlog, WhatsApp logout/conflict, AI outage, disk penuh.
- Dokumentasikan RPO/RTO, rollback, restore, dan acceptance checklist.
- Tambah E2E smoke minimal: login, health, Admin WhatsApp, QR status, satu inbound/outbound terkontrol.

Local gate status: build, deployment config guard, smoke script syntax, dan full test suite lulus. Docker CLI dan target VPS/cloud tidak tersedia di workspace ini; container startup, rollback, dan failure drill nyata tetap pending eksekusi eksternal.

Definition of done: satu deployment disposable dapat build, start, ready, dipantau, direstart, di-rollback, dan dipulihkan tanpa data hilang. Config guard lokal selesai; target nyata masih pending.

### Sprint 2 — Reliability dan privacy proof

- [x] Implement bounded graceful shutdown: stop intake, drain worker, timeout, lalu close socket/HTTP/DB. Target external failure drill tetap pending.
- Tambah integration test export/delete/anonymization, attachment unlink, audit redaction, dan rollback.
- [x] Tetapkan konfigurasi kebijakan awal `PRIVACY_RETENTION_DAYS=0` (auto-purge nonaktif); jadwal purge terotomasi menunggu persetujuan retention bisnis/legal.
- Tambah test recovery queue setelah process kill dan lease expiry.
- Tambah dashboard/alert minimum untuk readiness, queue, reconnect, backup age, dead-letter, dan AI error.

Definition of done: failure drill dan privacy drill lulus otomatis, dengan bukti log/metric yang dapat ditelusuri.

Local gate status: bounded worker drain, retention policy guard, build, targeted tests, dan full test suite lulus. Process-kill recovery, browser privacy integration, dashboard/alert routing, dan failure drill target nyata masih pending.

### Sprint 3 — Security hardening dan operator UX

- [x] Migrasikan inline script ke per-response CSP nonce dan hilangkan inline `onclick` pada safety metrics.
- [x] Tambah lapisan stylesheet native bersama untuk dashboard dan login, dengan token semantik light/dark dan guard visual. CSS komponen lama serta sebagian atribut `style` masih inline.
- [ ] Ekstrak sisa inline Admin CSS dan atribut `style`; hapus `style-src 'unsafe-inline'` setelah header test lulus.
- Tambah authorization/operator identity pada aksi sensitif dan audit UI yang lebih lengkap.
- Selesaikan order lifecycle yang benar-benar dibutuhkan bisnis: cancellation, expiration, fulfillment timeline, payment provider.
- Tambah media fallback untuk tipe yang paling sering diterima customer.
- Buat visual regression light/dark pada viewport desktop, tablet, dan mobile.

Definition of done: security header strict, critical operator flows teruji browser, dan tidak ada overflow/regression pada viewport target. Script hardening lokal selesai; style CSP dan browser visual regression masih pending.

Local gate status: per-response script nonce, inline-handler cleanup, build, targeted tests, dan full test suite lulus. Style CSP extraction, operator authorization expansion, order/media feature expansion, serta real browser visual regression masih pending.

## Backlog setelah launch gate

- Off-host backup encrypted dengan retention dan restore drill.
- Coverage report dan target coverage berbasis critical path, bukan angka global kosmetik.
- Baileys mock/integration test multi-socket dan load test outbound per nomor.
- Plugin domain baru hanya bila schema Knowledge dan kebutuhan bisnis nyata tersedia.
- Log rotation, alert routing Slack/Email/PagerDuty, dan dashboard SLO production.
- Evaluasi penggantian dependency `exceljs` setelah alternatif kompatibel teruji.

## Urutan keputusan

```text
Deployment proof
  → Reliability/privacy proof
  → CSP dan operator hardening
  → Payment/media expansion
  → Off-host backup dan scale observability
```

Jangan memulai plugin domain, redesign besar, atau fitur marketing sebelum tiga sprint utama selesai. Fokus sekarang: bukti operasional production, recovery, dan keamanan.

## Launch gates

Sebelum menyebut sistem production-ready, semua harus lulus:

- `npm run build`, `npm test`, `npm audit --audit-level=high`, secret scan.
- Deployment satu instance dengan lock, persistent data, readiness supervisor, dan rollback.
- Backup tervalidasi, restore drill lulus, serta RPO/RTO terdokumentasi.
- Queue restart/retry/dead-letter dan WhatsApp reconnect/logout/conflict teruji.
- Admin auth/CSRF/Origin/rate limit dan critical browser flows teruji.
- Privacy export/delete/retention dan audit redaction teruji.
- Metrics, SLO threshold, dashboard, dan alert owner ditentukan.
- Minimal satu failure drill penuh tanpa kehilangan pesan atau state bisnis.
