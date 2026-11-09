// Mailchimp connector constants. Client id/secret come from env NAMES (MAILCHIMP_CLIENT_ID / MAILCHIMP_CLIENT_SECRET); the audience
// (list) is chosen per tenant and kept in the connection settings; nothing tenant-specific lives here.
export const MAILCHIMP_CONNECTOR_ID = "mailchimp" as const;
export const MC_ENV = { clientId: "MAILCHIMP_CLIENT_ID", clientSecret: "MAILCHIMP_CLIENT_SECRET", apiBase: "MAILCHIMP_API_BASE" } as const;
/** Vendor defaults, used only when the override env var is unset. */
export const DEFAULT_OAUTH_BASE = "https://login.mailchimp.com";
export const SET = { audienceId: "audience_id", webhookConfigured: "webhook_configured" } as const;
export const CRED = { accessToken: "access_token", webhookSecret: "webhook_secret" } as const;
/** Max members one pull page reads. */
export const PULL_PAGE = 200;
export const PUSH_CHUNK = 50;
/** dc (data centre) as Mailchimp issues it, e.g. "us19"; validated before it is put into a host name. */
export const DC_RE = /^[a-z]{2}\d{1,3}$/;
