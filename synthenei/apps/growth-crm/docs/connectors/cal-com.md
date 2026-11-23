# Cal.com (`cal-com`)

Inbound booking sync, the same flow and shared handler as Calendly with a different parser and signature.
Cal.com sends **no timestamp**, so replay protection is the dedupe key (body hash) plus the forward-only
calendar row. Source: `src/lib/connectors/calcom/` (reuses `calendly/connector.ts`'s `handleBookingEvent`).

- **Auth:** `api_key`. **Gate:** `none`.
- **Capabilities:** inbound + webhooks, no streams, no outbound.
- **Rate:** 60 rpm, 3 retries, 500 ms–15 s backoff.
- **Env:** `CALCOM_API_BASE` (override only).

## What the client must provide
Two fields (`credentialFields`), the API key verified with one read (`whoAmI`) before storage:

| Field | Key | Secret | Notes |
|---|---|---|---|
| API key | `api_key` | yes | the tenant's own Cal.com API key |
| Webhook secret | `webhook_secret` | yes | any long random string, 24–128 chars `[A-Za-z0-9_-]` |

The webhook secret is chosen by the integrator and must match the secret configured on the Cal.com webhook.

## Approvals
None. Cal.com (self-hosted or cloud) supports webhooks on its standard plans; there is no app-review gate.

## Sandbox steps
`sandbox.supported = false`. Runbook string (`calcom.sandbox`): *(no dedicated sandbox).* To rehearse:

1. Use a **test Cal.com account** with a throwaway event type.
2. Connect with that account's API key + a webhook secret; add a Cal.com webhook to
   `/api/hooks/cal-com/<connectionId>` for booking created/cancelled, using the same secret.
3. Book and cancel a test slot and confirm the booking row appears then cancels. The receiver verifies
   `X-Cal-Signature-256 = HMAC-SHA256(webhook_secret, raw body)`.

## Go-live flip
No mock transport: platform sets `connector_availability` for `cal-com` to `mode = live` /
`gate_status = ready`, the tenant connects with their **real** API key + webhook secret, and the integrator
configures the production Cal.com webhook. Swap test for real and reconfigure the webhook.

## Failure modes
- **API key rejected:** `whoAmI` fails at connect.
- **Signature failure:** 401 at the edge; stored without body for 7 days.
- **Replay:** because Cal.com sends no timestamp, duplicate deliveries are caught by the body-hash dedupe
  and the forward-only calendar row — a repeat is a no-op.
- **Rate limit (60 rpm):** 429s honour `Retry-After`, up to 3 retries.
