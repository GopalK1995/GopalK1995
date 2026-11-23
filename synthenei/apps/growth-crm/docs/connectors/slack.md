# Slack (`slack`)

Posts CRM alerts into one chosen channel. There are **no streams**: alerts are pushed by the `slack.alert`
job when the event fan-out matches a subscribed event. The only webhook traffic is token-revocation /
app-uninstall, which flips the connection to `needs_attention` immediately. Source:
`src/lib/connectors/slack/`.

- **Auth:** `oauth2` (Slack v2, bot token, no PKCE). **Gate:** `needs_client_credentials`.
- **Scopes:** `chat:write`, `channels:read`, `groups:read`, `channels:join` (sent as a **comma list** in
  `scope`).
- **Capabilities:** outbound + webhooks (revocation only), no inbound, no streams.
- **Rate:** 50 rpm, 3 retries, 500 ms–15 s backoff.
- **Required env:** `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` (`SLACK_API_BASE` optional).
- **Bot tokens do not expire** (no rotation) — nothing to refresh.

## What the client must provide
Nothing to paste. After OAuth, `selectSlackChannel` picks the **channel** and the alert on/off switches. The
installing user needs permission to add a Slack app to their workspace.

## Approvals
`needs_client_credentials`: the **platform's Slack app** (client id/secret) must exist, but **no Slack
review** is needed for a private/workspace app (only public apps in the Slack App Directory need review).
So the gate is about the platform having created the app, not a vendor approval queue.

## Sandbox steps
`sandbox.supported = true`. Runbook string (`slack.sandbox`): *"Showcase uses sample channels only; nothing
is posted to a real Slack workspace. A live connection posts to the channel you pick."*

1. Ensure `SLACK_CLIENT_ID`/`_SECRET` are set and `connector_availability` for `slack` is `mode = sandbox`.
2. Connect with the Showcase token; sample channels appear and **nothing is posted** to a real workspace.
3. Trigger an alert-eligible event and confirm the alert would route to the chosen sample channel.

## Go-live flip
1. Create the platform Slack app (if not already), set `connector_availability` for `slack` to
   `mode = live`, `gate_status = ready`.
2. The tenant **reconnects** (real OAuth install) and picks a real channel.
3. Point the Slack **Events API** request URL at `/api/hooks/slack/<connectionId>` (the receiver verifies
   `X-Slack-Signature`) so token-revocation/uninstall events flip the connection to `needs_attention`
   promptly.

## Failure modes
- **Token revoked / app uninstalled:** the Slack Events webhook (`tokens_revoked` / `app_uninstalled`) flips
  the connection to `needs_attention` with "Slack access was revoked or the app was removed; reconnect
  Slack." — only when the team id in the body matches **this** connection's team (the signing secret is
  shared across all tenants of the platform app).
- **Post fails (channel archived / bot not in channel):** `channels:join` lets the bot join public
  channels; a private channel needs a manual invite, else the post fails and is retried.
- **Signature failure:** 401 at the edge; stored without body for 7 days.
- **Rate limit (50 rpm / Slack tier limits):** 429s honour `Retry-After`, up to 3 retries.
