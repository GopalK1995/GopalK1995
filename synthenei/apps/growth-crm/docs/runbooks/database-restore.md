# Database restore and backups

## Honest state (27 Nov 2026)

- The audit (OPS-010, OPS-013) found the Supabase organisation on the **Free plan: no managed daily backups and no point-in-time recovery** for real tenant data. The Supabase MCP lists the organisation but not its plan, so the current plan is **TO CONFIRM** in the dashboard (Organisation, Billing). If the project has moved to Pro, the dashboard's Database, Backups page lists the daily backups.
- `public.backup_checks` is NOT evidence of real backups: all 30 rows were `demo:*` and the newest was 13 Oct (OPS-011). `pitr_enabled` was false (SEC-046). There is no dump job in `cron.job` (only `gcrm_tick`, `gcrm_maintenance`, `gcrm_ai_maintenance`, verified 27 Nov). `BACKUP_ADAPTER` was unset on Vercel at audit time (UNVERIFIED now).
- No restore has been performed against this project. The only recorded drill (2 Sep) predates the project, created 13 Oct.
- `/data-health` and `docs/admin-guide.md` describe backup rows, but Supabase exposes no backup-status API, so those rows are only as true as whatever writes them.

Consequence: today a destructive mistake or corruption can be undone only from a **manual dump taken by the owner**. Treat every risky operation accordingly.

## Stopgap until Pro + PITR (owner actions)

1. Before any migration, bulk import, purge or data-touching change, take a manual logical dump with the Supabase CLI or `pg_dump` using the project's database URL (kept in the owner's shell, never committed, never in chat): schema first, then data. Store it outside the repo and outside Supabase (encrypted disk or password manager). `docs/BUILD-PLAN.md` section 6.4 step 2 describes this.
2. Record row counts of the main tables next to the dump (`leads`, `contacts`, `accounts`, `deals`, `activities`, `consent_log`, `audit_log`).
3. Keep an off-platform copy of the Vault peppers (`consent_pepper_*`): a data restore without them cannot match consent hashes. Whether a logical dump includes `vault.secrets` in usable form is TO CONFIRM.
4. Upgrade the Supabase organisation to **Pro** and enable **PITR** (owner decision, cost TO CONFIRM). Then replace the demo backup rows with real ones (audit task A-003).
5. Run a restore drill into a **separate scratch project** (never over production) and record it below.

## Restore procedure (any source: dump, daily backup, PITR)

Restoring loses every write since the backup. Prefer a forward fix. Restore only on the owner's explicit decision, recorded in the incident log.

1. Freeze writes: `select cron.unschedule('gcrm_tick');` and move the app to the previous good deployment or pause it (`rollback.md`). Tell tenants.
2. Restore **into a scratch project first**, verify (row counts against the recorded counts, a sample lead, the isolation tests under `supabase/tests`, see `supabase/README.md`), then decide.
3. Managed backup or PITR (Pro): dashboard, Database, Backups, Restore. This overwrites the project; the exact wording and downtime are TO CONFIRM in the dashboard.
4. Manual dump: restore with `psql` or `pg_restore` into a fresh project, then point Vercel env (`NEXT_PUBLIC_SUPABASE_URL`, anon key, service role key, JWT secret) at it and redeploy. Re-create `private.settings.tick_url` and the Vault secret `jobs_tick_secret`, and re-schedule the three cron jobs (`supabase/migrations/0014_event_bus_jobs_audit.sql`). Required extensions: `pg_cron`, `pg_net`, `pgmq`, `supabase_vault` (TO CONFIRM against `supabase/README.md`).
5. After restore: re-schedule `gcrm_tick`, run `on-call-checklist.md`, check that `consent_log` and `email_suppressions` still match (peppers present), and rotate any secret exposed in the incident.
6. Write the data-loss window (backup time to restore time) in the incident log and tell affected tenants. This may itself be notifiable (`incident-response.md`).

## Restore drill log (quarterly target; none recorded on this project)

| Date | Source | Target | Rows verified | Time taken | Notes |
| --- | --- | --- | --- | --- | --- |
| NOT YET DONE | | | | | Owner action |
