# Operations Runbook

Use `docker compose ps`, `docker compose logs --tail=200 voidlark`, `/health/live`, `/health/ready`, and `/metrics` first. Never delete the active database or authentication records without a verified backup.

## WhatsApp logout or conflict

- Signal: readiness 503, `whatsapp.session_logged_out` or `whatsapp.session_replaced`, reconnect metric rising.
- Diagnose: confirm only one deployment owns the number (`docker compose ps` and host process list). For a conflict, stop duplicate instances and wait one reconnect interval.
- Recover logout: open Admin Settings, clear the session only after confirming logout, restart, then scan the new QR. Verify WA state `open`, readiness 200, and a controlled inbound/outbound message.

## AI outage

- Signal: AI error counter/latency rises; customer receives the existing AI failure response.
- Diagnose provider/gateway reachability from the container without printing keys. Check base URL, model ID, DNS, status page, quota, and timeout logs.
- Mitigate: restore the local gateway/provider, or switch the configured OpenAI-compatible endpoint/model. Do not invent responses or disable evidence rules. Verify a sandbox reply and falling error rate.

## Database lock or full disk

- Lock: stop duplicate app instances and long-running backup/maintenance jobs; SQLite already uses WAL and a busy timeout. Never remove `-wal`/`-shm` while the app runs.
- Disk: `df -h`, inspect Docker volume usage and backup retention. Free space by rotating logs/expired verified backups, not the active DB. Restart only after space is available.
- Verify `/health/ready`, a read/write workflow, `PRAGMA integrity_check` on an offline copy, and a successful backup.

## Queue backlog

- Signal: `voidlark_queue_depth` or oldest processing latency exceeds the configured SLO; failure/dead-letter counters rise.
- Diagnose readiness, WA/AI/DB dependencies, worker error logs, and Admin pipeline failures. Identify inbound versus outbound and retry versus dead-letter.
- Mitigate dependency first; then use the Admin retry action in small batches. Do not bulk-requeue permanent failures. Verify depth decreases and end-to-end ordering for one JID remains correct.

## Failed backup

- Signal: backup failure counter/log event or backup age SLO breach.
- Diagnose writable `/app/backups`, free disk, SQLite source path, or `pg_dump` compatibility for Postgres. Run `npm run db:backup` once after remediation.
- Verify checksum plus `npm run db:backup:drill -- <backup>` before declaring recovery; copy verified backups off-host.

## Migration and release

1. Create and validate a fresh backup; record image digest and current schema version.
2. Build/test: `npm ci && npm run build && npm test && npm audit --audit-level=high`.
3. Build image and validate config: `docker compose config && docker compose build`.
4. Stop the old single instance, deploy the immutable image, and watch migration/startup logs. Verify live, ready, metrics, Admin login, WA state, and one controlled message.

## Rollback

1. Stop traffic and the new instance; preserve its DB and logs for diagnosis.
2. If the schema is backward compatible, redeploy the prior image digest against the current data. Otherwise restore the pre-release backup before starting the prior image.
3. Verify health, WA ownership, critical reads/writes, queue drain, and backup schedule. Never run two versions against one SQLite volume.

## Restore

1. Stop the app and retain the failed database under a timestamped name.
2. Validate and drill the selected backup. For SQLite, restore with the backup CLI/library atomic restore path; for Postgres, restore into a new database first.
3. Start one app instance, verify schema version, integrity, live/ready, record counts, WA state, queue state, and a controlled transaction. Keep the previous data until acceptance is complete.
