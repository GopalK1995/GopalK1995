# Zoho CRM (`zoho-crm`)

Two-way CRM sync through the shared sync engine (`zoho/engine/`): initial import then incremental pull
(every 15 min) and push (every 15 min, offset), with notification-channel ("watch") renewal on a daily
slot. The OAuth accounts server is the connection's **data centre** (India `.in` by default). Source:
`src/lib/connectors/zoho/`.

- **Auth:** `oauth2` (no PKCE; `access_type=offline` + `prompt=consent` for a refresh token). **Gate:**
  `needs_client_credentials`.
- **Scopes:** `ZohoCRM.modules.ALL`, `ZohoCRM.coql.READ`, `ZohoCRM.notifications.ALL`, `ZohoCRM.org.READ`.
- **Capabilities:** inbound + outbound + webhooks.
- **Streams:** pull, push, `health` (daily watch renewal).
- **Rate:** 100 rpm, 5 retries, 1 s–30 s backoff.
- **Required env:** `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` (`ZOHO_API_BASE` override; default API base
  `https://www.zohoapis.in`; `ZOHO_ACCOUNTS_URL` selects the data-centre accounts server).

## What the client must provide
Nothing to paste. Because the gate is `needs_client_credentials`, the **platform** registers a Zoho OAuth
client (per data centre) and sets `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET`. The tenant then authorises; the
connection stores the **region** (which decides the API domain) plus field-map and sync options.

## Approvals
No Zoho app review. The platform must create the Zoho API console client in the **correct data centre**
(`.in`, `.com`, `.eu`, …) matching where customers' Zoho orgs live, and grant the scopes above.

## Sandbox steps
`sandbox.supported = true`. Runbook string (`zoho-crm.sandbox`): *"Use a Zoho CRM developer or sandbox org.
Records written and read there stay in that org; the CRM only syncs what the field map and sync options
allow."*

1. Ensure `ZOHO_CLIENT_ID`/`_SECRET` are set and `connector_availability` for `zoho-crm` is
   `mode = sandbox`.
2. Connect a **Zoho developer / sandbox org** and authorise.
3. Configure the field map and sync options, run import + pull/push, and confirm records round-trip within
   the sandbox org only.

## Go-live flip
1. Platform sets `connector_availability` for `zoho-crm` to `mode = live`, `gate_status = ready`.
2. The tenant **reconnects** against their production Zoho org (correct data-centre region).
3. For webhooks, set `APP_BASE_URL` so the `health` stream can register/renew the notification channel at
   `/api/hooks/zoho-crm/<connectionId>`; the receiver verifies the per-channel token.

## Failure modes
- **Token refresh / revocation:** `refreshZohoToken`; a dead refresh token → `needs_attention`. Because
  connect forces `prompt=consent`, a refresh token is normally present.
- **Watch (notification channel) renewal:** channels live at most a week; the daily `health` step renews
  them. If `APP_BASE_URL` is unset it skips (`watch: skipped_no_app_base_url`) — polling keeps data current
  regardless. A renewal failure records `watch_failed` and retries next slot.
- **Webhook channel mismatch:** an event whose `channelId` ≠ this connection's channel is rejected
  (`channel_mismatch`) — tenant isolation.
- **Remote delete:** a delete at Zoho **never** deletes a CRM record (`remote_deleted`, rejected).
- **Conflicts:** the engine's conflict resolution applies the field map's conflict owner; see
  `zoho/engine/conflict.ts`.
- **Rate limit (100 rpm / Zoho credit limits):** 429s honour `Retry-After`, up to 5 retries.
