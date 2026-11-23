# Connector runbooks

One file per registered connector (`docs/connectors/<id>.md`), matching the ids in
`src/lib/connectors/all.ts` (`ALL_CONNECTORS`). Each runbook covers, in order:

1. **What the client must provide** — the tenant-supplied credentials or settings, if any.
2. **Approvals** — any vendor-side app review / verification that must clear before a live connection is possible.
3. **Sandbox steps** — how to connect in test/Showcase mode and prove the plumbing without touching real customers.
4. **Go-live flip** — what changes moving from sandbox to live for this connector.
5. **Failure modes** — token expiry, rate limits, signature failures, sync-error handling.

Read this page once; the per-connector files assume it.

## Index

| Connector | Id | Category | Auth | Gate | Sandbox | Webhooks |
|---|---|---|---|---|---|---|
| WhatsApp Business | `whatsapp` | messaging | api_key | needs_vendor_approval | yes | yes |
| Razorpay | `razorpay` | payments | api_key | none | yes | yes |
| Meta (Lead Ads, Instagram, Ads) | `meta-ads` | ads | oauth2 | needs_vendor_approval | yes | yes |
| Email (Resend) | `resend` | email | api_key | none | yes | yes |
| Email (SMTP) | `email-smtp` | email | api_key | none | yes | no |
| Mailchimp | `mailchimp` | email | oauth2 | needs_client_credentials | no | yes |
| Google Analytics 4 | `ga4` | analytics | oauth2 | none | yes | no |
| Google Ads | `google-ads` | ads | oauth2 | needs_vendor_approval | yes | no |
| Google Sheets import | `google-sheets` | data | oauth2 | none | yes | no |
| LinkedIn (Lead Gen, Ads) | `linkedin` | ads | oauth2 | needs_vendor_approval | yes | no |
| Calendly | `calendly` | scheduling | api_key | none | no | yes |
| Cal.com | `cal-com` | scheduling | api_key | none | no | yes |
| Google Business Profile | `google-business` | data | oauth2 | needs_vendor_approval | yes | no |
| Slack | `slack` | automation | oauth2 | needs_client_credentials | yes | yes |
| Zapier | `zapier` | automation | none | none | no | no |
| Make | `make` | automation | none | none | no | no |
| Google Calendar | `google-calendar` | scheduling | oauth2 | none | yes | no |
| Gmail | `gmail` | email | oauth2 | needs_vendor_approval | yes | no |
| Outlook / Microsoft 365 | `outlook` | email | oauth2 | needs_vendor_approval | yes | yes |
| Channel manager | `channel-manager` | ota | api_key | needs_vendor_approval | yes | yes |
| Calendar feeds (iCal) | `ical` | ota | api_key | none | no | no |
| Zoho CRM | `zoho-crm` | crm | oauth2 | needs_client_credentials | yes | yes |
| HubSpot | `hubspot` | crm | oauth2 | needs_client_credentials | yes | yes |

## Shared mechanics (true for every connector)

### Modes, availability and the status chip
A connector's availability is **platform-controlled**, not tenant-controlled. The row
`connector_availability(connector_id, env, mode, gate_status, note)` (0015) is edited by a platform
super admin from `/admin`. `mode ∈ {disabled, sandbox, live}`, `gate_status ∈ {needs_vendor_approval,
needs_client_credentials, ready}`.

The mode a **new** connection gets is decided by `modeForNewConnection()` (`core/status.ts`): it is
`live` only when `availability.mode === "live"` **and** `gate_status === "ready"`; otherwise it is
`sandbox`. A tenant can never self-promote a connection to live.

The chip a user sees is **derived, never stored** (`deriveChip()`): "Connected" is shown only when
credentials exist **and** platform availability is live/ready **and** the connection itself is live and
reports `connected`. Everything short of that reads as `sandbox`, `needs_attention`, `error`,
`needs_vendor_approval`, `needs_client_credentials`, `not_configured`, `not_available` or
`disconnected`. A sandbox connection shows an amber "Sandbox: not sending to real customers" chip
everywhere it surfaces (`integrations.chipHint.sandbox`).

### Credentials and the Vault
Every secret (OAuth tokens, API keys, webhook signing secrets) is written to the Supabase Vault via
`private.put_secret` and referenced by `integrations.credential_secret_id` / `webhook_secret_id`. Secrets
are never returned to a client, never logged, never placed in errors or audit detail
(`core/secrets.ts`, `core/pii.ts`). The `test()` hook verifies credentials with one cheap vendor call
and never echoes them.

### OAuth token refresh
`refreshIfNeeded()` (`core/lifecycle.ts`) refreshes an OAuth token that expires within a 300-second
skew. A connection with no recorded `token_expires_at` is treated as **never expiring** (Mailchimp,
Slack, HubSpot tokens). A dead or missing refresh token flips the connection to `needs_attention` with
a readable reason — never a silent failure. A `TransientError` is retried; a `CredentialError` is
surfaced to the owner.

### Webhook verification
Inbound webhooks hit `POST /api/hooks/[connector]/[connectionId]`. The **edge receiver** verifies the
provider signature on the raw body *before* anything is parsed (per-provider scheme: Meta/WhatsApp
`X-Hub-Signature-256`, Razorpay `X-Razorpay-Signature`, Slack v0 signature, Calendly
`Calendly-Webhook-Signature`, Cal.com `X-Cal-Signature-256`, HubSpot v3, Zoho token, Microsoft Graph
`clientState`). On a verification failure the request returns 401 and is stored in `webhook_inbox` with
`signature_ok = false` and **no body** for 7 days. Verified events are deduped by
`unique(connector_id, provider_event_id)` (replay protection) and processed off the `connector_inbound`
queue.

### Rate limits and sync errors
Each connector ships a `rate` policy overriding `DEFAULT_RATE_POLICY` (60 rpm, 5 retries, 500 ms base,
30 s max; `core/types.ts`). The HTTP helper honours `Retry-After`. Streams report `rowsRejected` with
**PII-free** reasons; a rejected row is counted in `sync_runs.rows_rejected` and the sync continues.
A `CredentialError` thrown by a stream or `test()` moves the connection to `needs_attention`.

### `requiredEnv`
A connector whose `requiredEnv` names are not all set shows `not_configured` and cannot be connected,
sandbox or live. These are platform (integrator) env vars, listed per connector below and in
`.env.example`.
