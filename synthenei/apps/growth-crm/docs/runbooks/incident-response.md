# Incident response

Scope: suspected personal-data breach, leaked credential, cross-tenant exposure, malicious access, or an outage that affects tenants. One operator today (OPS-027), so steps name a role: **IC** (incident commander, the owner) and **Scribe** (the same person until a second one exists).

Legal clocks below come from the audit (PRIV-044) and must be **confirmed by counsel (TO CONFIRM)**: CERT-In Directions of 28 April 2022 (report within 6 hours of noticing a specified incident; keep logs 180 days) and DPDP Act s.8(6) with its Rules (intimate the Data Protection Board without delay, detailed report within 72 hours, tell each affected person). `src/lib/privacy/breach.ts` models only the 72 hour Board clock (`BOARD_REPORT_HOURS`).

## Contact table (fill in; not in the repo: TO CONFIRM)

| Role | Name | Phone | Email |
| --- | --- | --- | --- |
| IC / owner | | | |
| Counsel | | | |
| Supabase support | | | dashboard, Support |
| Vercel support | | | dashboard, Support |
| CERT-In | | | TO CONFIRM current reporting address and portal |

## Clocks

Write **T0** (the moment anyone first noticed the incident, in IST and UTC) in the incident log before anything else.

| Clock | Deadline | Who | Source |
| --- | --- | --- | --- |
| Declare severity and open the log | T0 + 30 min | IC | this runbook |
| Report to CERT-In | **T0 + 6 hours** | IC | CERT-In Directions 2022 (TO CONFIRM scope: not every incident is reportable) |
| Tenant notice (we are the processor, the tenant is the fiduciary) | T0 + 24 hours target, sooner if data left the platform | IC | DPDP s.8(6); our own target, TO CONFIRM with counsel |
| First intimation to the Data Protection Board | without delay once a personal-data breach is confirmed | Tenant (fiduciary); we supply facts | DPDP Rules (TO CONFIRM) |
| Detailed Board report | 72 hours from awareness | Tenant; we supply facts | `BOARD_REPORT_HOURS` |
| Notify affected people | without delay, after Board intimation | Tenant | DPDP s.8(6) |
| Keep logs | 180 days | IC | CERT-In 2022 (TO CONFIRM that Supabase and Vercel log retention meets this; on current plans it probably does not, so export logs) |

## Steps

1. **Detect and record.** Sources: Sentry alerts, `/api/health`, Vercel logs, Supabase logs and advisors, a tenant report, `public.audit_log` (row changes only: login, MFA and password events are not audited yet, SEC-016, so absence of evidence is weak). Write T0, who found it, what was seen.
2. **Classify.** Personal data of tenants' leads or contacts involved or possible? Credentials or secrets exposed? Cross-tenant read or write? Outage only? If unsure, treat it as a personal-data breach.
3. **Contain (first 60 minutes).** Pick what applies and write down the time of each action:
   - Stop background processing: `select cron.unschedule('gcrm_tick');` (re-schedule later, see `rollback.md` section 4).
   - Stop vendor calls for one connector without a deploy: set `connector_availability.mode = 'disabled'` for it (BUILD-PLAN section 6.5).
   - Leaked secret: rotate it now with `secret-rotation.md`. A leaked service role key or JWT secret means assume full database read and write.
   - Bad deploy: `rollback.md`.
   - Malicious tenant user: remove the membership or revoke API keys from the admin UI. Support sessions expire within 60 minutes by design.
   - Revoke provider tokens for affected connectors in the vendor console (Meta, Google, Slack and so on); tenants reconnect later.
4. **Preserve evidence.** Export Vercel and Supabase logs for the window (they roll off), export `audit_log` rows from T0 minus 24 hours to a file kept outside the repo, save Sentry issue links. Do not delete rows or restart anything you do not need to.
5. **CERT-In report (by T0 + 6 h).** Send per CERT-In's current instructions (TO CONFIRM). Include: organisation and contact, time of occurrence and detection, type of incident, systems and data affected, actions taken so far. A partial report on time beats a full one late; send updates.
6. **Tenant notice (we are the processor).** For each affected workspace, tell the workspace owner in writing: what happened, which data categories, approximate people count if known, what we did, what they should do. No platform-level breach register exists (PRIV-045), so keep a copy of every notice in the incident log and ask each owner to record it under `/settings/privacy/breaches`. The `breach_register` table was absent in production on 26 Nov 2026 (PRIV-043): check it exists before sending owners to that page (TO CONFIRM).
7. **Board and individuals.** The tenant's duty. Give them the facts and the 72 hour date computed from when they became aware (their awareness may be our notice time).
8. **Recover.** Rotate remaining secrets, restore data only per `database-restore.md` and only on the owner's decision, re-enable `gcrm_tick` and connectors, verify with `on-call-checklist.md`.
9. **Close and learn.** Within 5 working days: timeline, root cause, what detection missed, actions with owners. Update this runbook. Keep the log 180 days.

## Incident log template

```
Incident ID:            YYYY-MM-DD-n
T0 (IST / UTC):
Declared by / severity:
Systems and tenants affected:
Data categories (leads, contacts, messages, credentials):
Actions (time, who, what):
CERT-In report sent at (IST), reference:
Tenant notices sent at, to whom:
Board intimation by tenant at:
Individuals notified at:
Root cause:
Follow-ups:
```
