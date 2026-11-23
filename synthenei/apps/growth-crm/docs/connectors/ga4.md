# Google Analytics 4 (`ga4`)

Read-only daily GA4 report (sessions, users, key events by channel / source-medium / device / city /
landing page / campaign) into `ga4_daily`: 90-day backfill then incremental with a 3-day re-read. Source:
`src/lib/connectors/google/ga4/` (shares the Google OAuth client with Ads, Sheets, Calendar, Gmail, GBP).

- **Auth:** `oauth2` (PKCE). **Gate:** `none`.
- **Scope:** `https://www.googleapis.com/auth/analytics.readonly` (read-only — the CRM never writes to GA4).
- **Capabilities:** inbound only, no webhooks. **Stream:** `daily` (hourly slot, step decides from cursor +
  IST clock, from 05:30 IST).
- **Rate:** 60 rpm, 4 retries, 800 ms–30 s backoff.
- **Env (platform):** `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (`GA4_DATA_API_BASE` /
  `GA4_ADMIN_API_BASE` optional overrides).

## What the client must provide
Nothing to paste. The integrator registers one Google Cloud OAuth client; the tenant clicks "Connect",
grants read-only Analytics access, then `selectGa4Property` picks the **GA4 property** (stored as
`property_id`).

## Approvals
The analytics read-only scope is a **sensitive** Google scope. The platform's Google Cloud OAuth app needs
**OAuth verification** (Google brand/scope review) before unlimited external users can grant it without the
"unverified app" screen. The gate is `none` because GA4 has a working Showcase and the scope is read-only,
but production use at scale still wants a verified app.

## Sandbox steps
`sandbox.supported = true`. Runbook string (`ga4.sandbox`): *"Showcase only: sample sessions and key
events, nothing is read from Google. A live connection reads your own GA4 property with read-only access."*

1. Platform sets `connector_availability` for `ga4` to `mode = sandbox`.
2. Connect with the Showcase/mock token (`google-mock-token`, refused in production). The connection serves
   sample sessions/key events; **nothing is read from Google**.
3. Confirm the dashboard analytics tiles populate from the sample rows.

## Go-live flip
1. Verify the Google OAuth app (see Approvals) and set
   `connector_availability` for `ga4` to `mode = live`, `gate_status = ready`.
2. The tenant **reconnects** via real Google OAuth (`access_type=offline` + `prompt=consent` guarantee a
   refresh token) and selects their real GA4 property.
3. The `daily` stream backfills 90 days then runs incrementally. No webhook to configure.

## Failure modes
- **No readable property:** if the Google account can read no GA4 property, `test` throws `CredentialError`
  ("This Google account can read no GA4 property").
- **Token refresh:** handled by `refreshGoogleToken` within the 300 s skew; a dead refresh token →
  `needs_attention`. Because connect forces `prompt=consent`, a refresh token is normally always present.
- **Quota (429 / rateLimitExceeded):** honoured with `Retry-After`, up to 4 retries; the hourly slot
  retries a missed read within the hour.
- **Property deleted / access revoked at Google:** next read throws `CredentialError` → `needs_attention`.
