# On-call checklist

For whoever holds the pager. Single operator today, so this is also the owner's daily routine.

## Daily (5 minutes)

- [ ] `GET /api/health`: db ok, queues ok. A queue RPC failure is reported as "skipped" (OPS-019), so "skipped" on production is NOT fine.
- [ ] Tick alive: `select max(started_at) from job_runs;` is within a minute or two (SELECT only).
- [ ] pg_cron: `select jobname, active from cron.job;` shows `gcrm_tick`, `gcrm_maintenance`, `gcrm_ai_maintenance` active.
- [ ] Sentry: no new unresolved issues, error rate normal.
- [ ] Vercel: the last production deployment is Ready, no failed deployment since.
- [ ] `/data-health`: backup rows are real, not `demo:*` (see `database-restore.md`).
- [ ] Inbound webhooks: unsigned requests are no longer stored (AUD-030), so `select count(*) from webhook_inbox where signature_ok = false;` should not grow. Rows from before the change can be ignored.

## Per alert

| Alert | First action | Then |
| --- | --- | --- |
| Health red | Vercel logs for `/api/health`; Supabase status; project not paused | `rollback.md` if a deploy caused it |
| Queue age growing | Is `gcrm_tick` active? Is `/api/jobs/tick` returning 401 (secret drift, see `secret-rotation.md`, JOBS_TICK_SECRET)? | Re-schedule the cron job |
| Many 401 on a webhook receiver | Secret rotated at the vendor? For Gmail and Calendar push: is `GMAIL_PUBSUB_SERVICE_ACCOUNT` set and equal to the sender account? | Fix the secret or the pin |
| Suspected breach | `incident-response.md`, write T0 | CERT-In clock starts at T0 |
| Supabase Free-tier limits (connections, DB size, pause) | Check dashboard usage | Plan upgrade is an owner decision (`database-restore.md`) |

## Weekly

- [ ] Review Supabase advisors (security and performance) in the dashboard.
- [ ] Review `npm audit` output from CI (SEC-048).
- [ ] Confirm a second person could reach the Vercel and Supabase accounts if the owner is unavailable (TO CONFIRM; single operator, 2FA status unverifiable, OPS-027).
