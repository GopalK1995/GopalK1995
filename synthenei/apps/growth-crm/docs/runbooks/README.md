# Production runbooks (AUD-031)

Written 27 Nov 2026 from what the repository shows. Anything that depends on a dashboard, a vendor plan or a person that the repo cannot show is marked **TO CONFIRM**. Nothing here has been rehearsed yet: the acceptance for AUD-031 also needs one recorded rollback rehearsal (see `rollback.md`, section "Rehearsal log").

| Runbook | Use it when |
| --- | --- |
| [incident-response.md](incident-response.md) | A breach, leaked secret, tenant-data exposure or outage is suspected. Has the CERT-In 6 hour and DPDP steps. |
| [rollback.md](rollback.md) | A deploy or migration made things worse. |
| [secret-rotation.md](secret-rotation.md) | A secret leaked, or routine rotation: Supabase JWT, service role, SESSION_SECRET, JOBS_TICK_SECRET, Meta app secret, Vault peppers, Pub/Sub pin. |
| [database-restore.md](database-restore.md) | Data was lost or corrupted. States honestly what backups exist. |
| [on-call-checklist.md](on-call-checklist.md) | Daily and per-alert checks for whoever holds the pager. |

## Facts the runbooks rely on (verified in the repo unless marked)

- App: Next.js 15 in `synthenei/apps/growth-crm`, Vercel region `sin1` (`vercel.json`). `vercel.json` has no `crons` key.
- Background work: Supabase `pg_cron` job `gcrm_tick` (every 10 s) calls `POST /api/jobs/tick` with a bearer secret; `gcrm_maintenance` (every 5 min) and `gcrm_ai_maintenance` (hourly, minute 17) also exist. Verified live with a SELECT on `cron.job` on 27 Nov 2026: all three active.
- Integration branch: `build/v1`. Production branch per `docs/BUILD-PLAN.md` section 6.4: `claude/inspiring-fermat-2iwd0p` (TO CONFIRM in Vercel, Settings, Git).
- Backup refs in git are **branches** named `backup/*` (for example `backup/prod-code-2026-11-27`, `backup/build-v1-pre-deploy-2026-11-27`). There are no git tags in the repository yet (OPS-024).
- Single operator (OPS-027). Names and phone numbers are not in the repo: fill in the contact table in `incident-response.md`.

## Env var added by AUD-030

`GMAIL_PUBSUB_SERVICE_ACCOUNT`: email of the Google service account that Pub/Sub uses to sign push requests to the Gmail and Google Calendar webhook receivers. When unset in production, those receivers reject every push (fail closed) until the owner sets it. The owner supplies the value; no agent sets Vercel env vars.
