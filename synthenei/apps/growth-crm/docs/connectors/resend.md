# Email — Resend (`resend`)

Outbound transactional/marketing email through the **tenant's own Resend account**. Queued messages are
sent by the `dispatch` stream; bounces/complaints/opens arrive by Resend webhook and write suppression +
consent withdrawal rows. Source: `src/lib/connectors/email/` (shared with `email-smtp`).

- **Auth:** `api_key`. **Gate:** `none`.
- **Capabilities:** outbound + webhooks (no inbound mail).
- **Streams:** `dispatch` (every 5 min), `domain` (sending-domain re-check, every 6 h).
- **Rate:** 120 rpm, 4 retries. **Env:** `RESEND_API_BASE` (override only).

## What the client must provide
One field (`credentialFields`), verified with a ping before storage:

| Field | Key | Secret | Notes |
|---|---|---|---|
| Resend API key | `api_key` | yes | must match `re_…` |

Sender name, from-address, reply-to and footer live in **connection settings** (`/settings/email`), never
in code. The Resend **webhook signing secret** is added *after* connect on `/settings/email`, because
Resend only reveals it once the endpoint exists (and the endpoint needs this connection's id).

## Approvals
No Resend app review. To send from the tenant's own domain they must **verify the sending domain** in
Resend (SPF + DKIM DNS records). The `domain` stream re-checks this and stores the state on the connection
(`health.domain`); an unverified domain limits deliverability.

## Sandbox steps
`sandbox.supported = true`. Runbook string (`email.sandbox`): *"Use the sandbox key shown in the runbook.
Nothing leaves this system and nothing is delivered."*

1. Platform sets `connector_availability` for `resend` to `mode = sandbox`.
2. Connect with the documented sandbox key (or `APP_ENV=demo`); the mock transport accepts sends and
   **delivers nothing**.
3. Queue a campaign/email send and confirm it is recorded as "sent" against the mock transport, and that a
   simulated bounce writes a suppression row.

## Go-live flip
1. Platform sets `connector_availability` for `resend` to `mode = live`, `gate_status = ready`.
2. The tenant **reconnects** with their live `re_…` key and completes **domain verification** in Resend.
3. In Resend, add a webhook to `/api/hooks/resend/<connectionId>` for `email.bounced` / `email.complained`
   / `email.delivered` etc., then paste the revealed **signing secret** on `/settings/email`.
4. Confirm `health.domain` reports verified before sending to real recipients.

## Failure modes
- **Bad API key:** `ping()` fails at connect → "credentials rejected".
- **Unverified domain:** sends may be rejected/soft-failed by Resend; `health.domain` flags it; fix DNS and
  let the `domain` stream re-check.
- **Bounce / complaint:** the webhook calls `suppressAddress` → the address is suppressed and a consent
  withdrawal is written; the dispatcher never re-sends to a suppressed address.
- **Webhook signature (svix) failure:** 401 at the edge, stored without body for 7 days.
- **Rate limit (120 rpm):** 429s honour `Retry-After`, up to 4 retries; unsent messages retry on the next
  5-minute slot.
