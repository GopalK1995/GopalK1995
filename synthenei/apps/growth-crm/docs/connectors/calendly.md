# Calendly (`calendly`)

Inbound booking sync: Calendly `invitee.created` / `invitee.canceled` webhooks become `calendar_events` /
booking rows. No polling — events drive everything. Source: `src/lib/connectors/calendly/`.

- **Auth:** `api_key`. **Gate:** `none`.
- **Capabilities:** inbound + webhooks, no streams, no outbound.
- **Rate:** 60 rpm, 3 retries, 500 ms–15 s backoff.
- **Env:** `CALENDLY_API_BASE` (override only).

## What the client must provide
Two fields (`credentialFields`), the token verified with one read (`whoAmI`) before storage:

| Field | Key | Secret | Notes |
|---|---|---|---|
| Personal access token | `token` | yes | the tenant's own Calendly PAT |
| Signing key | `signing_key` | yes | any long random string, 24–128 chars `[A-Za-z0-9_-]` |

The signing key is **chosen by the integrator** and used both when subscribing the webhook and when
verifying its signature — the two must match.

## Approvals
No Calendly app review. **Webhook subscriptions require a PAID Calendly plan** (Standard or higher):
subscribing is a separate call (`subscribeCalendly`) the integrator runs from a server action after
connect. A free Calendly plan can connect (token verifies) but cannot receive webhooks.

## Sandbox steps
`sandbox.supported = false`. Runbook string (`calendly.sandbox`): *(no dedicated sandbox).* To rehearse:

1. Use a **test Calendly account** on a paid plan with a throwaway event type.
2. Connect with that account's PAT + a signing key; subscribe the webhook to
   `/api/hooks/calendly/<connectionId>`.
3. Book and cancel a test invitee and confirm a booking row is created then cancelled. The receiver verifies
   `Calendly-Webhook-Signature` (`t=…,v1=HMAC-SHA256`, 3-minute window) and dedupes by body hash.

## Go-live flip
Because there is no mock transport, "go-live" is: platform sets `connector_availability` for `calendly` to
`mode = live` / `gate_status = ready`, the tenant connects with their **real** PAT + signing key, and the
integrator subscribes the production webhook. Swap the test account for the real one and re-subscribe.

## Failure modes
- **Token rejected:** `whoAmI` fails → `CredentialError` ("Calendly rejected the token") at connect.
- **Free plan:** connect succeeds but no webhooks arrive; upgrade the Calendly plan and re-subscribe.
- **Signature failure or stale timestamp (>3 min):** 401 at the edge; stored without body for 7 days.
- **Replay:** deduped by body hash and the forward-only calendar row — a repeat is a no-op.
- **Rate limit (60 rpm):** 429s honour `Retry-After`, up to 3 retries.
