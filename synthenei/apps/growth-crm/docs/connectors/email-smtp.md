# Email — SMTP (`email-smtp`)

Outbound email through the **tenant's own SMTP server**. Same send pipeline as the Resend connector but
with **no delivery callbacks**: bounces land in the tenant's own mailbox, not here. Source:
`src/lib/connectors/email/` (shared with `resend`).

- **Auth:** `api_key`. **Gate:** `none`.
- **Capabilities:** outbound only — **no webhooks** (SMTP has no delivery callback).
- **Streams:** `dispatch` (every 5 min), `domain` (sending-domain re-check, every 6 h).
- **Rate:** 120 rpm, 2 retries, 500 ms–10 s backoff.

## What the client must provide
Four fields (`credentialFields`), verified with an SMTP ping before storage:

| Field | Key | Secret | Notes |
|---|---|---|---|
| SMTP server | `smtp_host` | no | hostname |
| Port | `smtp_port` | no | 465 or 587 |
| Username | `smtp_username` | no | |
| Password | `smtp_password` | yes | |

Sender name, from-address, reply-to and footer live in connection settings, never in code.

## Approvals
None at an app level. The tenant is responsible for their own SMTP provider's sending reputation, SPF/DKIM
and rate limits. The `domain` stream still checks the sending domain's DNS and stores the result.

## Sandbox steps
`sandbox.supported = true`. Runbook string (`email.sandbox`): *"Use the sandbox key shown in the runbook.
Nothing leaves this system and nothing is delivered."*

1. Platform sets `connector_availability` for `email-smtp` to `mode = sandbox`.
2. Connect with the sandbox credentials (mock transport); sends are recorded, nothing is delivered.
3. Queue a send and confirm it is recorded against the mock transport.

(For a realistic test you can instead point at a catch-all SMTP sink such as Mailtrap in your own account.)

## Go-live flip
1. Platform sets `connector_availability` for `email-smtp` to `mode = live`, `gate_status = ready`.
2. The tenant **reconnects** with their real SMTP host/port/username/password.
3. Confirm the SMTP ping succeeds and `health.domain` reports the sending domain's DNS is healthy.
4. There is **no webhook** to configure — delivery/bounce visibility comes from the tenant's own mail
   server, not the CRM.

## Failure modes
- **Bad host/port/credentials or TLS mismatch:** the ping fails at connect → "credentials rejected"; a later
  failure at send time is recorded on the message (no delivery callback to reconcile against).
- **No bounce feedback:** because SMTP gives no callbacks, suppression from this connector comes only from
  refusals at send time and from explicit unsubscribe/withdrawal; a hard bounce at the far end is **not**
  seen here — monitor the tenant's own mailbox.
- **Rate limit / greylisting:** send-time refusals are retried up to 2 times with 500 ms–10 s backoff, then
  retried on the next 5-minute dispatch slot.
