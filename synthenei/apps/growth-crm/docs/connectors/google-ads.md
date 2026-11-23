# Google Ads (`google-ads`)

Daily cost, clicks, impressions and conversions per campaign into `campaign_daily_metrics`: 30-day backfill
then incremental with a 7-day re-read. Source: `src/lib/connectors/google/ads/`.

- **Auth:** `oauth2` (PKCE). **Gate:** `needs_vendor_approval`.
- **Scope:** `https://www.googleapis.com/auth/adwords` (the only Google Ads scope).
- **Capabilities:** inbound only, no webhooks. **Stream:** `daily` (hourly slot, from 06:00 IST).
- **Rate:** 60 rpm, 4 retries, 800 ms–30 s backoff.
- **Required env:** `GOOGLE_ADS_DEVELOPER_TOKEN` (plus the shared `GOOGLE_OAUTH_CLIENT_ID` /
  `_SECRET`; optional `GOOGLE_ADS_LOGIN_CUSTOMER_ID` as the MCC login-customer-id).

## What the client must provide
Nothing to paste. The tenant connects via Google OAuth; `selectAdsCustomer` picks the **client customer
account** (`customer_id`). The **developer token is the platform's**, not the tenant's.

## Approvals
Two-sided:
- **Platform:** the Google Ads **developer token** needs **Basic access** granted by Google before it can
  read **live** accounts; until then it works only against **test accounts**. This is the
  `needs_vendor_approval` gate shown to owners.
- **App:** the shared Google OAuth app should be verified for the `adwords` scope.

## Sandbox steps
`sandbox.supported = true`. Runbook string (`google-ads.sandbox`): *"Use a Google Ads test account with the
developer token in test mode. Showcase shows sample spend only; nothing is read from Google."*

1. Platform sets `connector_availability` for `google-ads` to `mode = sandbox`.
2. Connect with the Showcase token (sample spend) **or** point the developer token at a **Google Ads test
   account** (test-account access works before Basic access is granted).
3. Confirm campaign spend tiles populate from the sample/test rows.

## Go-live flip
1. Obtain **Basic access** for the developer token from Google, verify the OAuth app, and set
   `connector_availability` for `google-ads` to `mode = live`, `gate_status = ready`.
2. The tenant **reconnects** and selects their live client account; if reached through a manager account,
   set `GOOGLE_ADS_LOGIN_CUSTOMER_ID`.
3. The `daily` stream backfills 30 days then runs incrementally.

## Failure modes
- **No readable client account:** `test` throws `CredentialError` ("This Google account can read no Google
  Ads client account").
- **Developer token lacks Basic access:** live reads fail; stay on test accounts / Showcase until granted.
- **Token refresh / revocation:** as GA4 — `refreshGoogleToken` with 300 s skew; dead refresh token →
  `needs_attention`.
- **Quota (429 / RESOURCE_EXHAUSTED):** honoured with `Retry-After`, up to 4 retries; hourly slot retries a
  missed read.
