# Google Business Profile (`google-business`)

Pulls **reviews** (every 2 h) and **performance** metrics (daily, trailing-week re-read) for the tenant's
Business Profile listing; review **replies** are written back to Google only through an explicit
human-approval workflow, never an automated push. Source: `src/lib/connectors/google/business-profile/`.

- **Auth:** `oauth2` (PKCE). **Gate:** `needs_vendor_approval`.
- **Scope:** `https://www.googleapis.com/auth/business.manage`.
- **Capabilities:** inbound + outbound (reply approval only), no webhooks.
- **Streams:** `reviews` (every 2 h), `performance` (hourly slot, daily metrics).
- **Rate:** 60 rpm, 4 retries, 800 ms–30 s backoff.
- **Env (platform):** `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`.

## What the client must provide
Nothing to paste. After OAuth, `selectGbpLocation` picks the **listing** (stored as the location id). The
tenant's Google account must **manage** the Business Profile.

## Approvals
Google grants the **Business Profile APIs** to an **approved application only** — the platform must apply
for and receive access to the Business Profile API group before any live connection works. This is the
`needs_vendor_approval` gate; until it clears, the connector runs on fixtures/Showcase and a live
connection reports the gate. The `business.manage` scope also needs OAuth app verification.

## Sandbox steps
`sandbox.supported = true`. Runbook string (`google-business.sandbox`): *"Showcase only: sample reviews and
daily performance, nothing is read from or sent to Google. Google grants the Business Profile APIs to
approved applications only, so a live connection needs that approval first."*

1. Platform sets `connector_availability` for `google-business` to `mode = sandbox`.
2. Connect with the Showcase token; sample reviews + performance populate, no network.
3. Confirm the reviews list and the reply-draft/approval UI work against the sample data.

## Go-live flip
1. Obtain Google Business Profile API access (approval), verify the OAuth app, and set
   `connector_availability` for `google-business` to `mode = live`, `gate_status = ready`.
2. The tenant **reconnects** and selects the real listing.
3. Reviews and performance sync on schedule; a reply is only posted to Google after a human approves the
   draft. No webhook to configure.

## Failure modes
- **No managed listing:** `test` throws `CredentialError` ("This Google account manages no Business Profile
  listing").
- **API not yet approved:** live reads/replies fail until the platform's app is granted access; stay on
  Showcase.
- **Token refresh / revocation:** `refreshGoogleToken`, 300 s skew; dead refresh token → `needs_attention`.
- **Quota (429):** honoured with `Retry-After`, up to 4 retries; the 2-hourly / hourly slots retry missed
  reads.
