# LinkedIn — Lead Gen Forms, Ads (`linkedin`)

Polls **Lead Gen Form** responses (every 15 min) and pulls **Ads analytics** (daily), plus a daily token
health check. No webhook yet — LinkedIn Lead Sync push needs a separate approval and a signature scheme in
the receiver (see `docs/tasks/T044.md`). Source: `src/lib/connectors/linkedin/`.

- **Auth:** `oauth2` (no PKCE). **Gate:** `needs_vendor_approval`.
- **Scopes:** `r_ads`, `r_ads_reporting`, `r_ads_leadgen_automation` (all read).
- **Capabilities:** inbound only, no webhooks.
- **Streams:** `leads` (every 15 min), `analytics` (daily), `health` (daily).
- **Rate:** 60 rpm, 4 retries. **Required env:** `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`
  (`LINKEDIN_API_BASE` optional).

## What the client must provide
Nothing to paste. After OAuth, `selectLinkedInAccount` picks the **ad account** (`ad_account_id`). The
tenant's LinkedIn account must have access to the ad account's lead forms.

## Approvals
`needs_vendor_approval`: LinkedIn must grant the platform app the **Advertising API** and **Lead Sync**
products before any live connection works. These are gated LinkedIn Marketing Developer Platform products
with an application + review process. Until granted, the connector shows sample leads/spend only.

## Sandbox steps
`sandbox.supported = true`. Runbook string (`linkedin.sandbox`): *"LinkedIn has no public sandbox. Showcase
shows sample leads and spend only; a live connection needs LinkedIn's approval of the Advertising API and
Lead Sync products."*

1. Platform sets `connector_availability` for `linkedin` to `mode = sandbox`.
2. Connect with the Showcase token; sample leads + spend appear.
3. Confirm leads map through `DEFAULT_LEAD_MAP` and the analytics tiles populate from the sample rows.

## Go-live flip
1. Obtain Advertising API + Lead Sync approval from LinkedIn, set
   `LINKEDIN_CLIENT_ID`/`_SECRET`, and set `connector_availability` for `linkedin` to `mode = live`,
   `gate_status = ready`.
2. The tenant **reconnects** and selects the real ad account.
3. The `leads` poll runs every 15 min; `analytics` daily. No webhook (Lead Sync push is future work).

## Failure modes
- **Token invalid:** `introspect` reports inactive → `test` throws `CredentialError` ("LinkedIn says this
  access token is no longer valid") → `needs_attention`.
- **No refresh token:** LinkedIn issues refresh tokens only to **approved partners**; without one the
  connection simply **expires after ~60 days** and the `health` stream moves it to `needs_attention` — the
  tenant reconnects. (The framework default refresh is used when a refresh token exists.)
- **Products not approved:** live polling fails until LinkedIn grants access; stay on Showcase.
- **Rate limit (60 rpm):** 429s honour `Retry-After`, up to 4 retries.
