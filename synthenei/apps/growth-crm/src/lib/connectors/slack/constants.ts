// Slack connector constants. No tenant-, brand- or workspace-specific values live here: client id / secret / signing secret are env NAMES
// (values in the deployment); the chosen channel and alert switches are per-connection data in the Vault credential bundle.
export const SLACK_CONNECTOR_ID = "slack" as const;

/** Env var names (listed in .env.example, values never in code). */
export const SLACK_ENV = {
  clientId: "SLACK_CLIENT_ID",
  clientSecret: "SLACK_CLIENT_SECRET",
  /** Slack app signing secret: verifies inbound Slack requests (X-Slack-Signature). */
  signingSecret: "SLACK_SIGNING_SECRET",
  /** API base override (staging stub / Cypress). Unset = the vendor default. */
  apiBase: "SLACK_API_BASE",
} as const;

export const DEFAULT_API_BASE = "https://slack.com/api";
export const OAUTH_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
export const OAUTH_TOKEN_URL = "https://slack.com/api/oauth.v2.access";

/** Bot scopes. chat:write posts; channels:read / groups:read feed the picker; channels:join lets the bot enter a public channel the owner picked. */
export const SCOPES = ["chat:write", "channels:read", "groups:read", "channels:join"] as const;

/** Credential bundle keys kept in the Vault (never returned to a client, never logged). Bundle values are strings only. */
export const CRED = {
  accessToken: "access_token", channelId: "channel_id", channelName: "channel_name", teamId: "team_id", teamName: "team_name", botUserId: "bot_user_id",
  /** Comma list of enabled alert keys. */
  alerts: "alerts", includeNames: "include_names", locale: "locale",
} as const;
export const WEBHOOK_KEYS = { signingSecret: "signing_secret" } as const;

/** The sandbox token: serves the Showcase gateway (no network). Refused in production. */
export const SLACK_MOCK_TOKEN = "slack-mock-token";

/** Slack limits the builder stays under. */
export const LIMITS = { headerText: 150, sectionText: 3000, fieldText: 2000, fields: 10, blocks: 50, fallbackText: 300, buttonText: 75, buttonUrl: 3000 } as const;

/** Alert rate cap per connection. A bulk import of leads must not flood a channel. */
export const ALERT_RATE = { limit: 30, windowMs: 60_000 } as const;

export const ALERT_JOB_KIND = "slack.alert" as const;
