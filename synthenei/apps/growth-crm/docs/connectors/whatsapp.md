# WhatsApp Business (`whatsapp`)

Messaging connector over the **WhatsApp Cloud API** (Meta Graph). Inbound customer messages and template
status updates arrive by webhook; outbound template/session messages are queued and sent by the
`dispatch` stream. Source: `src/lib/connectors/whatsapp/`.

- **Auth:** `api_key` (manual credential paste, or Embedded Signup which produces the same bundle).
- **Gate:** `needs_vendor_approval`.
- **Capabilities:** inbound, outbound, webhooks.
- **Rate:** 600 rpm, 4 retries, 500 ms–20 s backoff.
- **Env (platform):** `WHATSAPP_APP_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_API_BASE` (override, optional).

## What the client must provide
This is a `needs_client_credentials`-shaped flow even though the gate is `needs_vendor_approval`: the
tenant pastes four values (`credentialFields`), each verified with one Graph call before storage:

| Field | Key | Secret | Notes |
|---|---|---|---|
| WhatsApp Business Account ID | `waba_id` | no | 5–32 digits |
| Phone number ID | `phone_number_id` | no | 5–32 digits; globally unique in this CRM |
| System user access token | `access_token` | yes | a long-lived Meta system-user token |
| Meta app secret | `app_secret` | yes | signs inbound webhooks |

The phone number ID is registered to the workspace in `wa_numbers`; if another workspace already owns that
number, connect fails with "This WhatsApp number is already connected to another workspace".

## Approvals
WhatsApp cannot go live until, at Meta:
- the **Business is verified** (Meta Business Verification), and
- the **WhatsApp Business Account / display number is approved** and the number has cleared registration,
- **message templates are submitted and approved** per template (the `templates` stream syncs their
  `status`: draft/submitted/approved/rejected/paused into `message_templates`).

Business-initiated messages outside the **24-hour customer-care window** must use an approved template;
only inside that window can free-form session messages be sent. The outbound dispatcher enforces the
window (`whatsapp/window.ts`) and consent (opt-out via STOP writes `consent_log`, `whatsapp/optout.ts`).

## Sandbox steps
`sandbox.supported = true`. Runbook string (`whatsapp.sandbox`): *"Use Meta's test business number and up
to 5 test recipients. Nothing reaches real customers."*

1. Platform sets `connector_availability` for `whatsapp` to `mode = sandbox`.
2. In the Meta app dashboard, use the provided **test business number** and add up to **5 test recipients**
   (Meta refuses any other recipient).
3. Connect in the CRM with the test WABA id / phone number id / token / app secret. The connection lands in
   `sandbox` status; the amber sandbox chip shows everywhere.
4. Send a template to a test recipient and reply from that handset to confirm inbound parsing, the 24-hour
   window and template sync all work end to end.

## Go-live flip
1. Complete all approvals above (business verification, number approval, template approval).
2. Platform super admin sets `connector_availability` for `whatsapp` to `mode = live`,
   `gate_status = ready`.
3. The tenant **reconnects** with production WABA credentials (live system-user token + app secret). The new
   connection is minted `live` / `connected`.
4. Confirm the inbound webhook is subscribed on the production WABA and that
   `/api/hooks/whatsapp/<connectionId>` is reachable (the receiver verifies `X-Hub-Signature-256` with the
   app secret). No code change; the flip is availability + reconnect.

## Failure modes
- **Token invalid/expired:** the system-user token can be revoked at Meta; the next `test`/sync throws
  `CredentialError` → connection `needs_attention` ("…token is no longer valid"). Reconnect with a fresh
  token. System-user tokens are long-lived, so there is no automatic refresh.
- **Number taken / mismatch:** a webhook for a `phone_number_id` this connection does not own is rejected
  (`phone_number_mismatch` / `phone_number_taken`) and not processed.
- **Template rejected/paused:** the `templates` stream records the vendor status; sends using a
  non-approved template are blocked by the dispatcher.
- **Outside the 24-hour window:** a free-form send with no open window is rejected; use a template.
- **Consent withdrawn (STOP):** the contact is suppressed; the dispatcher skips them (`blocked`).
- **Rate limit (600 rpm):** 429s honour `Retry-After` with up to 4 retries; persistent failures count as
  `retry`/`failed` in the dispatch sample and the message is retried on the next 15-minute slot.
- **Webhook signature failure:** 401 at the edge; stored `signature_ok = false`, no body, 7 days.
