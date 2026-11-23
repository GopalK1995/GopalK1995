# Mailchimp (`mailchimp`)

Two-way audience sync: **push** consented leads into the tenant's chosen Mailchimp audience (tagged with
the CRM segment name); **pull** unsubscribes and cleaned (bounced) members every 30 minutes, plus a webhook
for immediacy. Both pull paths write a consent withdrawal + suppression row through the **same function the
email connector uses**. Source: `src/lib/connectors/mailchimp/`.

- **Auth:** `oauth2` (no scopes array — Mailchimp OAuth grants account-wide access). **Gate:**
  `needs_client_credentials`.
- **Capabilities:** inbound, outbound, webhooks.
- **Streams:** `unsubscribes` (twice an hour). **Push:** `contacts` (consent purpose `marketing_email`).
- **Rate:** 300 rpm, 4 retries. **Env:** `MAILCHIMP_CLIENT_ID`, `MAILCHIMP_CLIENT_SECRET`,
  `MAILCHIMP_API_BASE`.
- **Tokens do not expire** (no `token_expires_at`; nothing to refresh).

## What the client must provide
Because the gate is `needs_client_credentials`, the **platform** must register a Mailchimp OAuth app and
set `MAILCHIMP_CLIENT_ID` / `MAILCHIMP_CLIENT_SECRET`. The tenant then clicks "Connect", authorises, and
picks an **audience id** (connection setting `audienceId`, validated `^[A-Za-z0-9]{4,40}$`). No key is
pasted.

## Approvals
No Mailchimp app review for standard OAuth. The tenant must own a Mailchimp account with at least one
audience. There is **no Mailchimp sandbox** (`sandbox.supported = false`).

## Sandbox steps
`sandbox.supported = false`. Runbook string (`mailchimp.sandbox`): *"Mailchimp has no sandbox. Connect a
test audience in your own Mailchimp account."*

To rehearse without touching production contacts:
1. In the tenant's Mailchimp account, create a **throwaway test audience** with a couple of seed addresses.
2. Connect and select that audience as `audienceId`.
3. Push a consented test lead and confirm it appears (tagged) in the test audience; unsubscribe a member in
   Mailchimp and confirm the `unsubscribes` stream (or webhook) writes a suppression + consent withdrawal.

## Go-live flip
1. Ensure `MAILCHIMP_CLIENT_ID` / `MAILCHIMP_CLIENT_SECRET` are set and
   `connector_availability` for `mailchimp` is `mode = live`, `gate_status = ready`.
2. The tenant selects the **real** audience id.
3. Configure the Mailchimp webhook to `/api/hooks/mailchimp/<connectionId>` (Mailchimp does not sign; the
   receiver compares the shared `k` secret path segment).

Because there is no sandbox transport, "sandbox" vs "live" here is really "test audience" vs "real
audience" in the tenant's own account, plus the platform availability gate.

## Failure modes
- **No audience chosen:** push returns "No Mailchimp audience chosen"; the pull stream no-ops
  (`skipped: no_audience`).
- **Suppressed address re-push blocked:** a bounced/complained address is never pushed back into an audience
  through the CRM ("Address is suppressed").
- **Webhook for another list:** events whose `listId` ≠ the configured audience are rejected
  (`other_audience`).
- **Token missing/revoked:** `test`/sync throws `CredentialError` ("Mailchimp token missing") →
  `needs_attention`; reconnect (tokens otherwise never expire).
- **Rate limit (300 rpm):** 429s honour `Retry-After`; pull is paged (`PULL_PAGE`) and resumes from its
  cursor.
