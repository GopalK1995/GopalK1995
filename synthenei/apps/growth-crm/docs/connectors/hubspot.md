# HubSpot (`hubspot`)

Two-way CRM sync through the **same shared engine as Zoho** (`zoho/engine/`): initial import then
incremental pull and push every 15 minutes, with app-level webhook subscriptions (v3 signature). HubSpot
has **one people object**, so contacts land as leads **or** contacts (never both), chosen by the sync
options' `contactTarget`. Source: `src/lib/connectors/hubspot/`.

- **Auth:** `oauth2` (no PKCE). **Gate:** `needs_client_credentials`.
- **Scopes:** `oauth`, `crm.objects.contacts.read|write`, `crm.objects.companies.read|write`,
  `crm.objects.deals.read|write`.
- **Capabilities:** inbound + outbound + webhooks.
- **Streams:** pull, push (every 15 min).
- **Rate:** 300 rpm, 5 retries, 1 s–30 s backoff. Search is paced (~5 req/s/account, ≤10k results/query).
- **Required env:** `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET` (`HUBSPOT_API_BASE` override; default
  `api.hubapi.com`).
- **Refresh tokens neither rotate nor expire** (framework default refresh applies).

## What the client must provide
Nothing to paste. Because the gate is `needs_client_credentials`, the **platform** registers a HubSpot app
and sets `HUBSPOT_CLIENT_ID` / `HUBSPOT_CLIENT_SECRET`. The tenant authorises (the install binds a HubSpot
**portal / hub id**); field map and sync options (including `contactTarget`) are configured afterwards.

## Approvals
No HubSpot marketplace review needed for a private/standard OAuth app. Webhooks are configured on the
**HubSpot app** (app-level subscriptions), not per connection; the platform sets the target URL and
subscriptions in the HubSpot app settings.

## Sandbox steps
`sandbox.supported = true`. Runbook string (`hubspot.sandbox`): *"Use a HubSpot developer test account (a
free test portal with sample data). Nothing reaches a real customer portal."*

1. Ensure `HUBSPOT_CLIENT_ID`/`_SECRET` are set and `connector_availability` for `hubspot` is
   `mode = sandbox`.
2. Connect a **HubSpot developer test portal** and authorise.
3. Configure field map / `contactTarget`, run import + pull/push, and confirm records round-trip in the test
   portal only.

## Go-live flip
1. Platform sets `connector_availability` for `hubspot` to `mode = live`, `gate_status = ready`.
2. The tenant **reconnects** against their production HubSpot portal.
3. Ensure the HubSpot app's webhook target points at `/api/hooks/hubspot/<connectionId>` with the needed
   object subscriptions; the receiver verifies the **v3 signature** with the app client secret.

## Failure modes
- **Incomplete credentials:** `test` throws `CredentialError` ("HubSpot credentials are incomplete") if the
  access token is missing.
- **Portal mismatch / unbound:** a webhook whose `portalId` ≠ this connection's hub id is rejected
  (`portal_mismatch` / `portal_unbound`) — tenant isolation.
- **Remote delete / merge:** a delete or merge at HubSpot **never** deletes a CRM record (`remote_deleted`).
- **Search pacing:** HubSpot search is capped (~5 req/s, ≤10k results); the engine paces requests
  (`SEARCH_PACE_MS`) to stay under it.
- **Rate limit (300 rpm / HubSpot limits):** 429s honour `Retry-After`, up to 5 retries.
