# Channel manager (`channel-manager`)

Hospitality OTA channel-manager sync into the **Booking** custom object: pull reservation changes (every 15
min) and apply them to `booking` records; push closed availability ranges per room when they change (every
30 min); a webhook is the fast path for reservations with the poll as the safety net. The specific partner
is **not chosen yet** (owner blocker B-6), so the adapter is a generic shell. Source:
`src/lib/connectors/channel-manager/`.

- **Auth:** `api_key`. **Gate:** `needs_vendor_approval`.
- **Capabilities:** inbound + outbound + webhooks.
- **Streams:** `reservations` (15 min), `availability` (30 min).
- **Rate:** 60 rpm, 3 retries, 500 ms–15 s backoff.
- **Env:** `CHANNEL_MANAGER_API_BASE` (override only); `requiredEnv` is empty.

## What the client must provide
Two fields (`credentialFields`):

| Field | Key | Secret | Notes |
|---|---|---|---|
| API key | `api_key` | yes | from the chosen channel-manager partner |
| Webhook secret | `webhook_secret` | yes | any long random string, 24–128 chars `[A-Za-z0-9_-]` |

The workspace must have the **hospitality preset** enabled so the **Booking** object exists; without it the
reservation apply throws "This workspace has no Booking object. Enable the hospitality preset, then retry."
A `timezone` connection setting controls availability date maths.

## Approvals
`needs_vendor_approval`: a real partner (e.g. a specific channel manager) must be selected and the platform
must complete that partner's onboarding/API access. Until a partner adapter is written and approved, only
the sandbox fixture path is usable.

## Sandbox steps
`sandbox.supported = true`. Runbook string (`channelManager.sandbox`): *"Sandbox: scripted reservations,
nothing is sent to a real channel manager. Use the sandbox token shown in the connector guide."*

1. Platform sets `connector_availability` for `channel-manager` to `mode = sandbox`.
2. Connect with the **fixture token** (`CM_FIXTURE_TOKEN`) — or `APP_ENV=demo` with no key. The fixture
   gateway serves scripted reservations; **the fixture token is refused in production**.
3. Enable the hospitality preset, run the `reservations` stream and confirm bookings are created/updated/
   cancelled; run `availability` and confirm closed ranges would be pushed.

## Go-live flip
1. Choose a partner, write/enable its `ChannelManager` adapter, complete the partner's onboarding, then set
   `connector_availability` for `channel-manager` to `mode = live`, `gate_status = ready`.
2. The tenant **reconnects** with the partner's real API key + a webhook secret.
3. Configure the partner's webhook at `/api/hooks/channel-manager/<connectionId>` (the receiver verifies the
   signature) and confirm the hospitality preset is on.

## Failure modes
- **Sandbox token in production:** rejected with `CredentialError` ("The sandbox token is not accepted in
  production").
- **No Booking object:** reservation apply throws until the hospitality preset is enabled.
- **Unreadable reservation items:** counted as `rows_rejected` (`unreadable_item`); the sync continues.
- **Availability push failure:** the cursor does not advance, so the next run re-pushes (idempotent).
- **Webhook signature failure:** 401 at the edge; stored without body for 7 days. Replays are no-ops (apply
  is idempotent).
- **Rate limit (60 rpm):** 429s honour `Retry-After`, up to 3 retries.
