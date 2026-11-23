# Gmail (`gmail`)

Per-user Gmail sync: read threads with known contacts (into the inbox) and send from the known-contact send
path. Uses a **restricted** scope (`gmail.readonly`) plus `gmail.send`. Enabled **only** while the
platform's Google OAuth app is in **testing** mode (or after CASA security assessment) **and** the tenant
has opted in. Source: `src/lib/connectors/google/gmail/`.

- **Auth:** `oauth2` (PKCE). **Gate:** `needs_vendor_approval`.
- **Scopes:** `https://www.googleapis.com/auth/gmail.readonly` (restricted),
  `https://www.googleapis.com/auth/gmail.send`.
- **Capabilities:** inbound + outbound, no webhooks. **Stream:** `threads`, every 15 min.
- **Rate:** 120 rpm, 4 retries, 800 ms–30 s backoff.
- **Required env:** `GOOGLE_OAUTH_APP_MODE` (makes the connector "not configured" until the platform
  declares the app's mode) plus the shared `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`
  (`GMAIL_API_BASE` optional).

## What the client must provide
Nothing to paste, but the tenant must **explicitly opt in** (`gate.ts`) — Gmail is not part of the generic
connect flow by default. The runtime **re-checks the gate on every sync and send**, so a connection made
around the gate never reads or sends.

## Approvals
`gmail.readonly` is a **restricted** Google scope. A production Gmail integration for external users
requires:
- Google **OAuth verification**, and
- an annual independent **CASA security assessment** (Tier 2) for restricted scopes.
Until that clears, the app must stay in **testing** mode with a limited list of test users; this is the
`needs_vendor_approval` gate. `GOOGLE_OAUTH_APP_MODE` records which mode the platform is in.

## Sandbox steps
`sandbox.supported = true`. Runbook string (`gmail.sandbox`): *"Showcase reads no mail and sends nothing. A
live connection needs the platform's Google app in testing mode and your opt-in."*

1. Platform sets `GOOGLE_OAUTH_APP_MODE` (so the connector is configured) and
   `connector_availability` for `gmail` to `mode = sandbox`.
2. Connect with the Showcase token — **reads no mail, sends nothing**.
3. Confirm the inbox surface renders the sample threads and the send UI is gated correctly.

## Go-live flip
1. Complete OAuth verification + CASA, set `GOOGLE_OAUTH_APP_MODE` to the live value, and set
   `connector_availability` for `gmail` to `mode = live`, `gate_status = ready`.
2. The user **reconnects** with their real Google account **and opts in**.
3. The `threads` stream reads known-contact threads every 15 min; sends go through the explicit
   known-contact path. No webhook to configure.

## Failure modes
- **Gate re-check fails:** if the app mode / opt-in is not satisfied at run time, sync and send are refused
  even on an existing connection — by design.
- **No access token:** `test` throws `CredentialError` ("This Google connection has no access token.").
- **Token refresh / revocation:** `refreshAllGrants`, 300 s skew; dead refresh token → `needs_attention`.
- **Quota (429):** honoured with `Retry-After`, up to 4 retries.
