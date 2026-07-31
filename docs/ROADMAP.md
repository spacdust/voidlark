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
6. Payment/fulfillment belum mencakup payment gateway nyata, expiration/refund, serta seluruh status fulfillment. Inventory bukan launch gap karena sengaja berada di luar scope produk.
7. Privacy retention, export/delete, dan anonymization sudah ada di kode, tetapi perlu integration test dan kebijakan retention bisnis tertulis.
8. Media video/sticker/contact/reaction/quoted-message belum menjadi alur khusus; tipe unsupported tetap diarahkan ke handoff.
9. Observability belum punya dashboard/alert routing operator; saat ini metrics dan structured log tersedia.
10. `exceljs` masih membawa advisory moderate melalui `uuid`; jangan gunakan `npm audit fix --force` tanpa rencana dependency.

## Rencana eksekusi berikutnya

Prinsip scope: prioritaskan kualitas percakapan, ketepatan rekomendasi, kesinambungan konteks, dan handoff CS. Jangan menambah manajemen inventory/stok ke backlog Voidlark.

### Sprint 0 — Conversation quality dan closing correctness

Update quality-recovery 29 Juli 2026: routing/state/evidence pada 10 percakapan baru sudah dihardening setelah audit awal hanya meluluskan 1/10. Produk, kelompok, variasi, budget, qty, relasi, perbandingan, guard stock/duration/safety, dan checkout kini bertahan lintas-turn. External “paling dekat” wajib memakai overlap notes dari lookup kedua sisi; nama produk dan family saja tidak cukup. Bukti efektif: `docs/reports/conversation-quality-recovery-audit-2026-07-29.md`.

Update pembanding luar 30 Juli 2026: turn awal kini menjelaskan notes produk luar dan meminta izin; persetujuan natural menghasilkan hingga tiga tier katalog. Tier pertama wajib overlap notes, sedangkan tier lanjutan menawarkan sudut family terverifikasi yang berbeda tanpa mengklaim tingkat kemiripan yang sama. Daftar tidak mengunci state sampai customer memilih. Detail Karakter menyebut nama Inspired konkret dan harga tetap pada kelompok Karakter. Bukti: `docs/reports/conversation-natural-evaluation-2026-07-30-external-reference-consultative-flow-final.json`.

Prioritas produk terdekat berdasarkan evaluasi 10 simulasi pada 27 Juli 2026. Bukti lengkap: `docs/reports/conversation-evaluation-2026-07-27.md`.

#### State, harga, dan evidence

- [x] Tambah state pesanan sementara terstruktur pada simulator tanpa menulis lead, order, atau handoff nyata.
- [x] Samakan reducer state produk, klasifikasi, atribut variasi, jumlah, harga terkunci, data checkout, dan ongkir antara preview dan WhatsApp live.
- [x] Pisahkan state/draft WhatsApp live dari Knowledge retrieval agar state tetap dibaca walau history atau context dipotong.
- [x] Gagalkan konfirmasi order bila produk, jumlah, variasi, harga katalog, checkout, atau pengiriman wajib belum lengkap.
- [x] Validasi harga melalui resolver Produk & Harga, bukan pencocokan string terhadap evidence.
- [x] Izinkan subtotal deterministik `harga satuan × jumlah` sebagai derived evidence. Total final dengan ongkir mengikuti hasil tool dan state checkout.
- [x] Masukkan hasil `cekOngkir` sebagai trusted evidence sebelum claim guard memeriksa jawaban akhir.
- [x] Pertahankan produk, variasi, harga, jumlah, dan data customer lintas-turn sampai customer mengubah pilihan secara eksplisit.
- [x] Tambah regression test untuk perubahan variasi, jumlah lebih dari satu, ongkir, harga, total, selisih, budget, rekomendasi parsial, dan handoff eksplisit.
- [x] Refactor resolver agar nama sumbu, nilai variasi, pilihan terkecil, dan fallback berasal dari skema aktif; core tidak menyebut nilai bisnis tertentu.
- [x] Tetapkan inventory sebagai non-goal. Pertanyaan stok tetap ditangani sebagai kualitas CS: gunakan fakta pada Knowledge atau arahkan konfirmasi admin, tanpa membangun manajemen stok.

#### Ritme konsultasi dan kualitas bahasa

Evaluasi ulang 28 Juli 2026: 10/10 skenario selesai tanpa crash; 3 case lulus penuh, 4 perlu perbaikan, dan 3 gagal secara perilaku. Bukti: `docs/reports/conversation-natural-evaluation-2026-07-28-chat.md`.

Hardening setelah evaluasi menutup gap teridentifikasi dengan guard deterministik. Bukti lokal: build TypeScript bersih, suite penuh lulus, serta regression lintas produk untuk budget+kebutuhan, perbandingan dua variasi, ordinal nama produk, satu pertanyaan, checkout fallback, dan handoff eksplisit. Evaluasi percakapan live tetap perlu dijalankan berkala karena output provider bersifat nondeterministik.

Audit quality-first final 28 Juli 2026 menutup gap naturalness dan halusinasi lanjutan: konteks perbandingan tidak lagi berpindah variasi, nama produk tetap terbawa saat rekomendasi dikunci, pertanyaan stok mendapat batas inventory jujur, perpindahan kelompok dijelaskan, daftar nama untuk intent gender+murah tidak dibuat model, dan setiap rewrite claim guard melewati sanitizer final. Full run `quality-first-final-audited-15` selesai 10/10; scan negatif untuk nama halu temuan sebelumnya, disclaimer kontradiktif, istilah internal, tabel Markdown, label taksonomi internal, dan fragmen `Misalnya` bernilai nol. Bukti: `docs/reports/conversation-quality-first-final-audit-2026-07-28.md`.

Audit sumber final 29 Juli 2026 menutup hardcode bisnis tersisa pada konsultasi, claim guard, dan formatter. Produk berasal dari workbook KB; kelompok/peran/variasi/harga berasal dari Produk & Harga; klaim note/persentase berasal dari KB; gaya dan flow berasal dari setting Admin. Acceptance efektif 10/10, termasuk rerun case 5 setelah gangguan ongkir transient. Bukti: `docs/reports/conversation-kb-settings-source-audit-2026-07-29.md`.

Audit ulang 29 Juli 2026 menemukan klaim tersebut belum cukup ketat: tier penggunaan masih memuat EDT/EDP, beberapa deterministic reply mengabaikan Gaya Balasan, matcher membaca workbook mentah, dan prompt Profil & Alur dapat drift. Seluruh celah ditutup: `recommendationTags` generik menggantikan aturan tier, claim copy berasal dari kalimat KB utuh, output AI memakai style boundary universal, matcher membaca corpus aktif, shipping/pembayaran menghormati nilai kosong/nonaktif, dan save config menyinkronkan prompt. Mutation tests dan full suite lulus. Laporan audit diperbarui pada dokumen yang sama.

Evaluasi end-to-end baru setelah perbaikan provenance menjalankan 10 percakapan natural yang belum pernah dipakai. Eksekusi selesai 10/10, tetapi kualitas percakapan hanya lulus penuh 1/10; 2 perlu perbaikan dan 7 gagal. Unit provenance benar, namun orkestrasi masih dapat kehilangan state, memilih jalur harga terlalu dini, mengulang jawaban, memakai external facts tanpa lookup tercatat, membocorkan repair text, serta meloloskan klaim stok/durasi/safety. Prioritas berikutnya adalah menutup gap end-to-end ini sebelum klaim “tanpa celah” dipakai kembali. Bukti: `docs/reports/conversation-natural-evaluation-2026-07-29-new-random-natural-chat.md`.

Hardening 29 Juli 2026 memperluas external lookup ke detail notes produk katalog. Inspired memakai nama asli; Karakter dipetakan ke Inspired dan selalu disebut sebagai acuan. Validator menolak identitas ambigu, prose web, konflik target pemakai, serta web sebagai sumber transaksi. Acceptance 10/10 dan rerun kebutuhan bersama tersimpan di `docs/reports/conversation-catalog-notes-lookup-acceptance-2026-07-29.md`.

Evaluasi live setelah hardening pada 28 Juli 2026 menemukan tujuh gap lanjutan pada budget, state, ordinal, handoff bersyarat, pertanyaan, durasi, dan deadline pengiriman. Seluruh pola tersebut sudah ditutup dengan guard deterministik dan regression. Rerun terarah case 3, 5, 7, dan 9 memverifikasi jalur yang sebelumnya gagal. Bukti dan batas klaim: `docs/reports/conversation-natural-evaluation-2026-07-28-after-hardening.md` serta `docs/reports/conversation-gap-hardening-2026-07-28.md`. Full 10-case live tetap perlu dijalankan berkala karena bahasa provider nondeterministik.

- [x] Terapkan policy konsultasi: pahami kebutuhan → rekomendasikan produk → jelaskan alasan/karakter → jelaskan klasifikasi bila perlu → tawarkan variasi/harga → lengkapi checkout → rekap.
- [x] Jangan menampilkan harga dan seluruh variasi segera setelah nama produk disebut. Beri penjelasan singkat yang relevan tentang aroma/notes, kecocokan, dan alasan rekomendasi terlebih dahulu, kecuali customer memang langsung meminta harga.
- [ ] Setting `Detail` harus menambah kedalaman pada fokus saat ini, bukan mempercepat perpindahan ke closing atau membuat daftar panjang sekaligus.
- [ ] Setting penjualan `Seimbang` harus memberi ruang konsultasi dan konfirmasi minat sebelum menawarkan order.
- [ ] Hindari bahasa template seperti “dua kelompok utama”, “mau pilih yang mana?”, atau pengulangan katalog yang sama pada beberapa turn jika konteks sudah jelas.
- [ ] Gunakan Bahasa Indonesia percakapan yang natural, hangat, dan bervariasi; tetap ringkas per bubble, tanpa terdengar kaku, korporat, atau seperti formulir AI.
- [x] Respons memakai state dan rujukan konteks seperti “yang tadi”, ordinal pilihan, serta pilihan terkecil tanpa menanyakan ulang data yang sudah jelas.
- [x] Tambah evaluator percakapan natural 10-case dan formatter laporan chat di `scripts/` serta `docs/reports/`.
- [x] Blok nama item rekomendasi yang tidak ditemukan di Knowledge melalui candidate/evidence guard; kandidat luar hanya boleh dijual bila terverifikasi sebagai produk internal.
- [x] Gabungkan intent budget dengan kebutuhan produk: resolver harga tidak lagi mengambil alih pesan yang masih memuat kebutuhan deskriptif; AI menerima kebutuhan dan batas budget sekaligus.
- [x] Batasi output customer ke maksimal satu tanda tanya secara deterministik setelah formatter WhatsApp.
- [x] Hitung selisih dua nilai variasi hanya saat seluruh sumbu lain sama atau sudah terkunci; jika ambigu, minta variasi yang belum jelas.
- [x] Cegah external-reference fallback mengambil alih checkout internal melalui fallback khusus yang mempertahankan produk, variasi, jumlah, dan harga terkunci.
- [x] Jalankan handoff komplain/penukaran langsung ketika customer eksplisit meminta admin, sebelum completion model.
- [x] Pertahankan nama produk dari daftar bernomor seperti “yang kedua” di state dan prompt terverifikasi sampai klasifikasi harga ditemukan.
- [x] Pertahankan budget lintas-turn dan batasi rekomendasi serta variasi ke kelompok yang benar-benar masuk budget.
- [x] Ubah state hanya dari pilihan eksplisit customer terbaru; abaikan variasi yang hanya disebut pada deskripsi atau perbandingan.
- [x] Bedakan permintaan admin sekarang dari ancaman atau rencana bersyarat.
- [x] Blok klaim durasi numerik dan kualitatif tanpa evidence pada simulator maupun WhatsApp live.
- [x] Bandingkan estimasi ongkir dengan deadline customer dan letakkan pertanyaan pilihan kurir setelah peringatan.
- [x] Kelompokkan daftar harga berdasarkan sumbu variasi aktif agar label tidak berulang pada setiap ukuran atau paket.
- [x] Terapkan quality-first: validasi kebutuhan, state, budget, evidence, dan checkout sebelum closing; latency bukan acceptance utama.
- [x] Pilih variasi dalam budget berdasarkan kebutuhan penggunaan sebelum harga, lalu ambil opsi termurah pada kualitas yang cocok.
- [x] Blok janji penggunaan tanpa evidence dan hapus hanya frasa salah tanpa membuang isi jawaban yang masih berguna.
- [x] Batasi daftar panjang ke maksimal tiga bubble tanpa memotong item bernomor.
- [x] Pertahankan line break WhatsApp melewati language guard dan cegah formatter memecah label variasi dari harga.
- [x] Bedakan pertanyaan harga/ketersediaan dari pilihan eksplisit agar state produk tidak berubah diam-diam.
- [x] Fail-closed ongkir sampai nama produk dan seluruh variasi katalog lengkap pada simulator serta live tool.
- [x] Rewrite utuh klaim risiko dan validasi ulang; blok safety, durability kualitatif, stock absolut, bonus, social proof, dan comparative marketing tanpa blok evidence terkurasi.
- [x] Lewatkan setiap hasil rewrite claim guard melalui sanitizer final sebelum dikirim.
- [x] Blok daftar nama produk generatif pada intent gender+harga yang belum cukup; minta budget/kebutuhan lalu gunakan kandidat Knowledge.
- [x] Pertahankan variasi saat memberi saran setelah perbandingan ukuran/kapasitas dan pilih opsi lebih hemat bila kebutuhan tidak menuntut nilai lebih besar.
- [x] Perkaya rekomendasi katalog fragrance dengan external notes terverifikasi; mapping Karakter ke Inspired tetap eksplisit sebagai acuan dan tidak mengubah batas harga/stok internal.
- [x] Tolak external notes yang ambigu, konflik target pemakai, berbentuk review/ranking generik, atau mengandung fragmen prose; prefer sumber dengan susunan notes konkret.
- [x] Pertahankan jumlah rekomendasi yang diminta dan jelaskan notes per pilihan tanpa menghilangkan ordinal follow-up.
- [x] Hilangkan nama kelompok, nilai variasi, dan harga bisnis aktif dari core; baca relasi plugin melalui `domainRole` Produk & Harga.
- [x] Wajibkan external audience evidence untuk rekomendasi dengan target cowok, cewek, atau shared-use; jangan fallback ke kandidat tanpa bukti.
- [ ] Kurasi blok `KLAIM PRODUK TERVERIFIKASI` untuk perbedaan kualitas, aturan pemakaian, durability, bonus, dan comparative claim yang memang disetujui bisnis. Tanpa kurasi ini, jawaban perbandingan sengaja konservatif.

Acceptance minimum:

- 10 skenario evaluasi tidak menghasilkan fallback harga palsu, nama item tanpa evidence, klaim stok/durasi tanpa evidence, atau kehilangan pilihan lintas-turn.
- Produk terpilih dijelaskan sebelum harga, kecuali customer meminta harga secara langsung.
- Tidak ada klasifikasi, variasi, harga, jumlah, atau alamat yang hilang pada turn berikutnya.
- Kasus customer marah atau meminta manusia tetap langsung diarahkan ke admin.
- Review manusia menilai balasan natural, konsultatif, tidak terburu-buru, dan konsisten dengan setting `Detail + Seimbang`.

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
