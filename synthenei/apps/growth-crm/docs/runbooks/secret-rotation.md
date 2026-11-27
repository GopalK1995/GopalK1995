# Secret rotation

Rotate on suspicion at once; routine rotation target 12 months (TO CONFIRM policy). Never paste a secret into chat, a ticket, a commit or a log. Env vars live in Vercel; Production and Preview are separate (OPS-015 found Preview missing several). A changed Vercel env var needs a redeploy. `src/lib/env.ts` validates env at boot: with Supabase configured, `SESSION_SECRET` is required and must be at least 32 characters in production and staging.

| Secret | Stored in | Owner | Impact of rotation |
| --- | --- | --- | --- |
| Supabase JWT secret (`SUPABASE_JWT_SECRET`) | Supabase dashboard + Vercel | owner | Signs Supabase API JWTs; rotating invalidates anon and service-role keys and every user session. |
| Service role key (`SUPABASE_SERVICE_ROLE_KEY`) | Supabase dashboard + Vercel | owner | Full database access, bypasses RLS. |
| `SESSION_SECRET` | Vercel | owner | Single key (`src/lib/auth/session.ts`): rotation signs EVERYONE out at once, no overlap (SEC-047). |
| `JOBS_TICK_SECRET` | Vercel AND Supabase Vault secret `jobs_tick_secret` | owner | Must change in both places or the tick returns 401 (OPS-022). |
| `CRON_SECRET` | Vercel | owner | Accepted by the tick route for Vercel Cron, but `vercel.json` defines no crons, so it is currently unused (OPS-020). |
| `META_APP_SECRET` | Vercel (Meta app dashboard is the source) | owner | Verifies Meta webhook signatures and the data-deletion callback. |
| Consent peppers `consent_pepper_<tenant uuid>` | Supabase Vault, one per tenant | owner | Not rotatable like the others, see below. |
| `GMAIL_PUBSUB_SERVICE_ACCOUNT` (an identity pin, not a secret) | Vercel | owner | Change when the Google Pub/Sub push service account changes. |
| Tenant webhook signing secrets | Vault | tenant owner via UI | `/settings/webhooks` rotates with a 24 hour overlap (`docs/admin-guide.md`). |

## SESSION_SECRET

1. Generate 48 random bytes, base64 (for example `openssl rand -base64 48`); paste straight into Vercel, nowhere else.
2. Vercel, Settings, Environment Variables: edit `SESSION_SECRET` (Production, and Preview if set). Redeploy.
3. Verify: an old cookie is rejected (sign-in is requested), a new sign-in works, the owner dashboard loads. Warn tenants first: everyone is signed out, and open support sessions (signed the same way) end.

## JOBS_TICK_SECRET (two places, in this order)

1. Generate a new value as above.
2. Supabase SQL editor: update the Vault secret named `jobs_tick_secret` (`select vault.update_secret(id, '<new>') from vault.secrets where name = 'jobs_tick_secret';`; run once, do not save the query). Until step 3 finishes, ticks get 401, which is acceptable for a few minutes.
3. Vercel: set `JOBS_TICK_SECRET` to the same value, redeploy.
4. Verify: `select max(started_at) from job_runs;` advances within a minute; no 401 on `/api/jobs/tick` in Vercel logs.
5. `private.tick()` returns silently if the URL or the Vault secret is null (OPS-021). Confirm both exist, names only: `select key from private.settings where key = 'tick_url';` and `select name from vault.secrets where name = 'jobs_tick_secret';`.

## Supabase JWT secret and service role key

1. Dashboard, Project Settings, API / JWT keys. Rotating the JWT secret changes the anon and service-role keys, so have the new values ready for Vercel `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`. The exact dashboard flow, and whether the project uses the newer asymmetric signing keys, is TO CONFIRM.
2. Update all three in Vercel (Production and Preview) and redeploy immediately. Between rotation and redeploy the app is down: schedule it, or accept it during an incident.
3. Update every other place the keys are used (the operator's local `.env` files). CI uses none (`docs/CI.md`).
4. Verify: sign-in, a read, `/api/health`, tick running. All user sessions are invalidated.
5. If an old key leaked, treat it as an incident (`incident-response.md`) and review `audit_log` and Supabase API logs for the exposure window.

## META_APP_SECRET

1. Meta developer dashboard, App settings, Basic: reset the App Secret (needs the app admin; whether Meta keeps the old one valid for a grace period is TO CONFIRM).
2. Put the new value in Vercel `META_APP_SECRET`, redeploy promptly. Until then inbound Meta webhooks fail signature checks with 401 (they are no longer stored; Meta retries).
3. Verify: send a test event from the Meta dashboard and expect 200.
4. Per-connection WhatsApp and Meta tokens are in Vault and are unaffected.

## Gmail and Calendar Pub/Sub sender pin (AUD-030)

1. Find the push subscription's service account in Google Cloud, Pub/Sub, Subscriptions, push authentication (the owner supplies the value; TO CONFIRM).
2. Set `GMAIL_PUBSUB_SERVICE_ACCOUNT` in Vercel Production to that email and redeploy.
3. Verify: a real push is accepted (200); a token from another account is refused (401). Until it is set, production rejects every Gmail and Calendar push by design.

## Vault peppers (consent hashes)

`consent_pepper_<tenant uuid>` keys the HMAC of subject references in `consent_log` and `email_suppressions` (migration 0030). **Changing a pepper breaks matching** of every existing hash for that tenant: suppressed addresses stop being recognised, so unsubscribed people could be emailed again. Therefore:

- Do not rotate or delete a pepper unless it is confirmed leaked. A leaked pepper alone does not reveal addresses but makes guessing attacks on the hashes feasible.
- Keep an off-platform copy in a password manager, as the migration header requires. A lost pepper means that tenant's hashes cannot be matched.
- If rotation is unavoidable it needs a re-hash plan and an owner decision. No tool for it exists in the repo (TO CONFIRM).

## Verification after any rotation

- [ ] `/api/health` ok
- [ ] Owner can sign in
- [ ] `job_runs` advancing
- [ ] One inbound webhook per affected connector returns 200
- [ ] Log entry written: date, which secret, who, why
