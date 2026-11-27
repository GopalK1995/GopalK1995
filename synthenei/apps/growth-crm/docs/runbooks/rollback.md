# Rollback

Rule of thumb: roll the **app** back first (fast, reversible); roll **data** back only on the owner's decision (it loses writes). `docs/BUILD-PLAN.md` section 6.5 is the design; this page is the procedure.

## 1. Application (Vercel)

1. Vercel dashboard, project `synthan-crm` (name TO CONFIRM), Deployments. Find the last deployment that was Ready and healthy. The audit found 9 of the latest 20 deployments errored (OPS-024), so pick one marked Ready, not just the previous row.
2. Open it, then **Promote to Production** (or "Instant Rollback" where the plan shows it). No rebuild happens.
3. Verify: `GET /api/health` is ok for db and queues; sign in as the owner; open the dashboard; `select max(started_at) from job_runs;` advances (tick is alive).
4. Record the deployment ids rolled from and to in the incident log.

Promoting an old deployment does not change the git branch. If the production branch auto-deploys on push, avoid pushing until the cause is understood, or pause auto-deploy (TO CONFIRM the setting in Vercel, Settings, Git).

## 2. Code (git)

- Restore points are **branches** named `backup/*`, for example `backup/prod-code-2026-11-27` (code in production before the 27 Nov deploy) and `backup/build-v1-pre-deploy-2026-11-27`. There are no tags yet. Create one per release from now on: `git tag -a release-YYYY-MM-DD -m "..."` then `git push origin release-YYYY-MM-DD`.
- To redeploy old code: branch from the backup ref, push the branch, deploy it (Vercel preview, then promote). Never force-push `build/v1` or the production branch.
- Before every risky deploy create a backup ref: `git branch backup/pre-deploy-YYYY-MM-DD <production sha>` and push it.

## 3. Database migrations

- Migrations are forward-only and mostly additive, so the previous app version normally runs on the new schema. Exceptions have down scripts in `supabase/rollback/`: `0016_down.sql`, `0019_down.sql`, `0020_down.sql`. Read the script and the migration header first; run in the SQL editor as one transaction; never run a down script on a guess.
- Migrations 0030 and 0031 (consent HMAC peppers and backfill) change stored subject hashes. Before rolling the app back past the commit that reads `h2:` values, read the rollback comment lines in `0030_consent_hmac_pepper.sql`.
- For anything else prefer a forward fix migration (next free number after the latest in `supabase/migrations`).

## 4. Stop-the-bleeding switches (no deploy)

- Stop all background processing: `select cron.unschedule('gcrm_tick');`. Resume: `select cron.schedule('gcrm_tick', '10 seconds', $$select private.tick()$$);` (as defined in `0014_event_bus_jobs_audit.sql`).
- `connector_availability.mode = 'disabled'` per connector stops outbound vendor calls.
- Inbound webhooks: a connection with status `disconnected` answers 404 and stores nothing.

## Rehearsal log (acceptance: at least one entry before AUD-031 closes)

A rehearsal means: promote the previous Ready deployment in a quiet window, run the verify steps, promote forward again, record the times. Not done yet.

| Date | Who | From deployment | To deployment | Time to healthy | Notes |
| --- | --- | --- | --- | --- | --- |
| NOT YET REHEARSED | | | | | Owner action |
