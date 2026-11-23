# Outlook / Microsoft 365 (`outlook`)

Mail + calendar over **Microsoft Graph**: inbox, sent (known contacts only), calendar (into
`calendar_events`), and a subscriptions stream that renews Graph change-notification subscriptions hourly.
One multi-tenant Entra ID app (delegated permissions, OAuth code + PKCE) serves every customer firm; a
tenant admin can pre-approve it firm-wide with the admin-consent link. Source:
`src/lib/connectors/microsoft/`.

- **Auth:** `oauth2` (PKCE, `response_mode=query`). **Gate:** `needs_vendor_approval`.
- **Scopes:** `offline_access`, `User.Read`, `Mail.Read`, `Mail.Send`, `Calendars.Read` (calendar is
  read-only; `Mail.Send` only for the known-contact send path).
- **Capabilities:** inbound + outbound + webhooks.
- **Streams:** `inbox` / `sent` (every 15 min), `calendar` (every 20 min), `subscriptions` (hourly renew).
- **Rate:** 60 rpm, 4 retries, 800 ms–30 s backoff.
- **Env (platform):** `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`
  (`MICROSOFT_GRAPH_API_BASE` optional).

## What the client must provide
Nothing to paste. The user connects via Microsoft OAuth. A **tenant (firm) admin** can grant
**admin-consent** once for the whole firm via the admin-consent link (`consent.ts`); otherwise each user
consents individually.

## Approvals
`needs_vendor_approval`: until the app's **publisher is verified** (Microsoft Partner Network / Publisher
Verification), other Microsoft tenants see an "unverified" consent screen and many org policies **block**
consent entirely. So the connector runs on Showcase until publisher verification clears, and a live
connection reports the gate.

## Sandbox steps
`sandbox.supported = true`. Runbook string (`outlook.sandbox`): *"Showcase only: sample mail and calendar
events, nothing is read from or sent to Microsoft. A live connection needs the app's publisher verification
at Microsoft first; a tenant admin can pre-approve it for the whole firm with the admin-consent link."*

1. Platform sets `connector_availability` for `outlook` to `mode = sandbox`.
2. Connect with the Showcase token; sample mail + calendar appear, no network.
3. Confirm threads/events surface and the known-contact send UI is gated.

## Go-live flip
1. Complete Microsoft **Publisher Verification**, set `connector_availability` for `outlook` to
   `mode = live`, `gate_status = ready`.
2. The user (or firm admin via admin-consent) **reconnects** with the real Microsoft account.
3. Ensure the app has a **public URL** so Graph change-notification subscriptions can be created; the
   `subscriptions` stream reports its status (`active` / `no_public_url` / `error`). The webhook receiver
   verifies the subscription `clientState`.

## Failure modes
- **No mailbox:** `test` throws `CredentialError` ("This Microsoft account has no mailbox address").
- **Consent blocked:** an unverified publisher or a firm policy can block consent — resolve with publisher
  verification + admin-consent.
- **No public URL:** subscriptions cannot be created (`status: no_public_url`); webhooks won't arrive until a
  reachable URL exists (polling still works).
- **Token refresh / revocation:** `refreshMicrosoftToken`, 300 s skew; dead refresh token →
  `needs_attention`.
- **Signature (`clientState`) failure:** 401 at the edge; stored without body for 7 days.
- **Rate limit (60 rpm / Graph throttling):** 429s honour `Retry-After`, up to 4 retries.
