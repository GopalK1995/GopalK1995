# Google Calendar (`google-calendar`)

Per-user two-way calendar sync into `calendar_events`: a **pull** and a **push** stream, both every 15
minutes, incremental and idempotent. Uses the **sensitive** `calendar.events` scope only — **no** restricted
scope and **no** Gmail scope (Gmail is a separate connector and a separate consent). Source:
`src/lib/connectors/google/calendar/`.

- **Auth:** `oauth2` (PKCE). **Gate:** `none`.
- **Scope:** `https://www.googleapis.com/auth/calendar.events`.
- **Capabilities:** inbound + outbound, no webhooks.
- **Streams:** `pull` and `push`, every 15 min.
- **Rate:** 120 rpm, 4 retries, 800 ms–30 s backoff.
- **Env (platform):** `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (`GOOGLE_CALENDAR_API_BASE`
  optional).

## What the client must provide
Nothing to paste. Each **user** connects their own Google account via OAuth (this is a per-user grant, not a
workspace-wide one). Multiple grants are stored and refreshed together (`refreshAllGrants`).

## Approvals
`calendar.events` is a **sensitive** scope; the shared Google OAuth app should pass **OAuth verification**
to avoid the "unverified app" screen for external users. Gate is `none` and a Showcase exists.

## Sandbox steps
`sandbox.supported = true`. Runbook string (`google-calendar.sandbox`): *"Showcase uses a sample calendar
with two sample events; nothing is read from or written to Google."*

1. Platform sets `connector_availability` for `google-calendar` to `mode = sandbox`.
2. Connect with the Showcase token; a sample calendar with two events appears.
3. Confirm events surface on the relevant record/day views and that the push step is a no-op against the
   mock gateway.

## Go-live flip
1. Verify the OAuth app and set `connector_availability` for `google-calendar` to `mode = live`,
   `gate_status = ready`.
2. Each user **reconnects** with their real Google account.
3. Pull/push run every 15 minutes. No webhook to configure (this connector polls).

## Failure modes
- **No access token:** `test` throws `CredentialError` ("This Google connection has no access token.
  Reconnect to continue.").
- **Token refresh / revocation:** `refreshAllGrants` refreshes each grant within the 300 s skew; a dead
  refresh token → `needs_attention`.
- **Conflicting edits:** push is idempotent; a repeat is a no-op, so a double run does not duplicate events.
- **Quota (429):** honoured with `Retry-After`, up to 4 retries.
