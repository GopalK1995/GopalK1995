# Meta — Lead Ads, Instagram, Ads (`meta-ads`)

One Facebook-Login OAuth connection per workspace covering **Lead Ads** (instant-form leads), **Instagram
DMs**, and **Ads Insights** (daily spend/clicks), plus T071 organic Instagram/Facebook metrics. Source:
`src/lib/connectors/meta-ads/` (and `src/lib/connectors/meta/`).

- **Auth:** `oauth2` (Facebook Login, no PKCE). **Gate:** `needs_vendor_approval`.
- **Capabilities:** inbound, outbound, webhooks.
- **Streams:** `insights` (hourly, loads the GA-style daily rows), `health` (daily token check),
  `dispatch` (Instagram outbound, every 15 min), `social` (organic metrics, every 3 h).
- **Rate:** 200 rpm, 4 retries. **Required env:** `META_APP_ID`, `META_APP_SECRET`
  (`META_GRAPH_API_BASE` optional).
- **OAuth scopes:** `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`,
  `leads_retrieval`, `ads_read`, `instagram_basic`, `instagram_manage_messages`,
  `instagram_manage_insights`, `read_insights`.

## What the client must provide
Nothing to paste. The **integrator registers one Meta app**; the tenant clicks "Connect", authorises via
Facebook Login, then `selectMetaAssets` (`assets.ts`) picks the Page, the linked Instagram account and the
ad account. There is no per-tenant key.

## Approvals
The scopes above are **advanced-access** permissions. Before any non-dev tenant can connect live, the Meta
app must pass **App Review** for each of: `leads_retrieval`, `ads_read`, `pages_*`,
`instagram_manage_messages`, `instagram_manage_insights`, `read_insights`, plus **Business Verification**
of the app's business. Instagram messaging also requires the Page/IG account to be a **Professional
account** linked to the Page. This is why the gate is `needs_vendor_approval`.

## Sandbox steps
`sandbox.supported = true`. Runbook string (`meta-ads.sandbox`): *"Use a Meta test ad account and the Lead
Ads Testing Tool. Test leads and sample spend only; nothing reaches real customers."*

1. Platform sets `connector_availability` for `meta-ads` to `mode = sandbox`.
2. In the Meta app, create a **test ad account** and use the **Lead Ads Testing Tool** to fire sample
   leadgen events.
3. Connect in the CRM (a dev/admin role on the app can authorise even before App Review). The connection is
   `sandbox`; insights show sample spend.
4. Fire a test lead and confirm it lands as a CRM lead through `DEFAULT_LEAD_MAP`; send a test IG DM to
   confirm the dispatcher.

## Go-live flip
1. Clear App Review + Business Verification for all scopes.
2. Platform super admin sets `connector_availability` for `meta-ads` to `mode = live`,
   `gate_status = ready`.
3. The tenant **reconnects** (fresh Facebook Login) and re-selects live Page / IG / ad account.
4. Ensure the production webhook subscription (Page + Instagram fields) points at
   `/api/hooks/meta-ads/<connectionId>`; the receiver verifies `X-Hub-Signature-256` with `META_APP_SECRET`
   and answers Meta's `hub.challenge` GET.

## Failure modes
- **Token no longer valid:** `debugToken` reports invalid → `test`/`health` throws `CredentialError` →
  `needs_attention` ("Meta says this access token is no longer valid"). Meta long-lived user tokens are
  **renewed by exchange** (`refresh()` → `refreshUserToken`), not a `refresh_token` grant; a user who
  changed their password or revoked the app must reconnect.
- **No Instagram account selected:** the `dispatch` stream no-ops (`skipped: no_instagram_account`).
- **Webhook phone/asset mismatch:** events for assets this connection does not own are rejected.
- **Signature failure:** 401 at the edge, stored without body for 7 days.
- **Rate limit (200 rpm) / Meta app-level throttle:** 429s honour `Retry-After`; the hourly insights stream
  retries a missed slot within the hour.
