# Operations Runbook

Runbook ini mengikuti runtime Voidlark saat ini. Perintah dijalankan dari root repository. Jangan menghapus database, auth WhatsApp, atau folder backup aktif tanpa backup tervalidasi.

## Startup dan shutdown

Development:

```bash
npm run dev
```

Production:

```bash
npm ci
npm run build
npm start
```

After server starts, run deployment smoke checks:

```bash
npm run ops:smoke
```

Override target with `VOIDLARK_URL=http://host:port npm run ops:smoke`. The check probes `/health/live`, `/health`, and `/metrics`; `/health` may report degraded while dependencies are still warming up.

`npm run dev` menjalankan `src/index.ts` melalui `tsx`. `npm start` menjalankan `dist/index.js`. Satu proses dijaga oleh `data/voidlark.lock`; jangan menjalankan dua instance terhadap database SQLite atau nomor WhatsApp yang sama.

Shutdown normal memakai `Ctrl+C` atau `SIGTERM`. Proses menghentikan scheduler backup, worker knowledge/outbound-intent, socket WhatsApp, server Admin, database pool, lalu melepas lock.
Compose memberi grace period 60 detik dan container berjalan sebagai user non-root dengan `no-new-privileges`.
Worker inbound/outbound berhenti menerima item baru dan menunggu pekerjaan aktif sampai `SHUTDOWN_DRAIN_TIMEOUT_MS` (default 15 detik), lalu proses melanjutkan cleanup.
Admin memakai per-response nonce untuk inline script; inline style masih dipakai renderer legacy dan menjadi item hardening Sprint 3 berikutnya.

## Health dan observability

Endpoint loopback Admin:

```text
/health/live   # proses hidup; tidak memeriksa dependency
/health/ready  # database, WhatsApp open, dan batas queue
/health        # detail readiness
/metrics       # Prometheus text format
```

Readiness menjadi `503` jika WhatsApp belum `open`, inbound/outbound queue melewati batas, atau database gagal. Batas queue dapat diatur lewat `READINESS_MAX_INBOUND_DEPTH` dan `READINESS_MAX_OUTBOUND_DEPTH`.

Metrik penting:

- `voidlark_wa_reconnects_total`
- `voidlark_queue_depth`
- `voidlark_queue_failures_total`
- `voidlark_backup_age_seconds`
- `voidlark_slo_breaches_total`

Log terstruktur memakai event seperti `whatsapp.connection_open`, `whatsapp.connection_closed`, `whatsapp.qr_ready`, `whatsapp.session_logged_out`, `whatsapp.session_replaced`, `database_backup.succeeded`, dan `database_backup.failed`.

## WhatsApp multi-number

Admin: `/admin/whatsapp`.

Alur tambah nomor:

1. Klik `Tambah Nomor`.
2. QR pending dibuat lebih dulu melalui `/admin/whatsapp/qr/generate`.
3. Scan QR di WhatsApp; nomor terdeteksi otomatis.
4. Isi label CS dan kuota lead, lalu simpan melalui `/admin/whatsapp/numbers/add`.

Jangan mengisi nomor baru secara manual sebelum QR selesai. Auth dipisahkan per nomor. Status runtime dapat dilihat melalui `/admin/whatsapp/status?phone=<phone>`.

Rotasi tersedia: `round_robin`, `least_busy`, `random`, dengan sticky assignment opsional. Daily lead quota adalah hard limit; sistem tidak boleh mengirim lewat nomor yang kuotanya penuh. Outbound dari nomor sama diserialkan oleh queue per nomor; nomor berbeda dapat mengirim paralel. Delay anti-ban memakai rentang `minDelaySeconds` dan `maxDelaySeconds`.

### Logout, conflict, QR, atau connecting stale

- `qr`: scan QR atau generate ulang.
- `connecting` lebih dari 60 detik: perlakukan sebagai stale; periksa log dan restart sesi dari Admin.
- `close`: periksa status code dan event `whatsapp.connection_closed`.
- `logged_out`: reset/clear sesi nomor tersebut, lalu scan QR baru.
- `session_replaced` atau reconnect terus naik: pastikan hanya satu instance memiliki nomor itu.

Reset satu sesi memakai tombol `Reset Sesi` (`/admin/auth/clear`). Hapus nomor dari rotasi memakai `/admin/whatsapp/numbers/delete`; tindakan ini tidak boleh dilakukan untuk memperbaiki masalah koneksi sebelum auth dan status diperiksa.

## Queue pesan

Inbound durable queue melakukan dedupe, lease, retry, serialisasi per-JID, dan dead-letter untuk error permanen. Outbound memakai outbox persisten dengan status `queued`, `sending`, `sent`, `delivered`, `read`, `failed`, atau `dead_letter`.

Jika backlog naik:

1. Buka Admin `Perlu Ditangani` dan `Koneksi Sistem`.
2. Periksa database, readiness, socket WhatsApp, AI provider, dan event error.
3. Bedakan `retry` dari `dead_letter`; retry hanya error transient.
4. Retry dalam batch kecil dan verifikasi depth turun.
5. Uji satu JID untuk memastikan urutan pesan tetap benar.

Pesan media yang tidak didukung dapat masuk handoff/dead-letter dengan kode seperti `UNSUPPORTED_MESSAGE` atau `UNSUPPORTED_MIME`; jangan memaksa retry permanen.

## Privacy dan retention

Export customer tersedia dari halaman Calon Pelanggan. Delete customer menghapus chat, handoff, queue, media metadata/file, dan preference; order finansial dipertahankan dengan JID anonim untuk audit. `PRIVACY_RETENTION_DAYS=0` berarti tidak ada auto-delete. Jangan mengaktifkan purge otomatis sebelum retention bisnis/legal disetujui dan diuji pada backup disposable.

## Backup dan restore

Backup scheduler aktif secara default. Konfigurasi:

- `DB_BACKUP_ENABLED` (default `true`)
- `DB_BACKUP_DIR` (default `backups/database`)
- `DB_BACKUP_RETENTION` (default `14`)
- `DB_BACKUP_INTERVAL_MINUTES` (default `1440`)
- `DB_BACKUP_RUN_ON_START` (default `false`)

Manual backup:

```bash
npm run db:backup
```

Backup SQLite menghasilkan file `.sqlite` dan sidecar `.sha256`. PostgreSQL memakai `pg_dump`/`pg_restore` dan membutuhkan `DATABASE_URL`. Provider off-host/S3 belum aktif; storage S3 fail-closed.

Restore drill tanpa mengubah database aktif:

```bash
npm run db:backup:drill -- <backup-file>
```

Restore produksi:

1. Hentikan aplikasi dan simpan database gagal dengan nama timestamp.
2. Validasi checksum dan jalankan restore drill.
3. Restore ke database disposable/baru terlebih dahulu.
4. Verifikasi schema, row penting, queue, health, dan transaksi kontrol.
5. Alihkan database hanya setelah acceptance selesai.

SQLite memakai WAL dan busy timeout. Jangan menghapus file `-wal` atau `-shm` saat aplikasi hidup.

## Database lock atau disk penuh

- Pastikan hanya satu PID memegang `data/voidlark.lock`.
- Hentikan job backup/maintenance panjang sebelum menangani lock.
- Periksa kapasitas disk dan retention backup.
- Jangan menghapus database aktif atau auth session untuk membebaskan ruang.
- Setelah remediasi, verifikasi `/health/ready`, operasi read/write, dan backup baru.

## AI outage

Periksa `AI_API_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, DNS, quota, dan latency tanpa mencetak secret. Sistem harus memakai fallback/error response yang ada dan tetap menjalankan evidence/policy guard. Uji `/admin/sandbox` setelah provider pulih.

## Release, rollback, dan migrasi

1. Buat backup dan catat schema/version.
2. Jalankan `npm ci && npm run build && npm test && npm audit --audit-level=high`.
3. Validasi environment dan satu instance lock.
4. Deploy satu instance; pantau startup, `/health/live`, `/health/ready`, `/metrics`, Admin login, status WhatsApp, dan satu pesan kontrol.
5. Rollback ke image/build sebelumnya hanya jika schema kompatibel. Jika tidak, restore backup pre-release lebih dulu.

Jangan menjalankan dua versi aplikasi terhadap satu SQLite volume atau satu nomor WhatsApp.
