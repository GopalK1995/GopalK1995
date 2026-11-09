// Outbound email connector constants. No tenant-, brand-, price-, domain- or URL-specific values live here: sender names,
// addresses and domains come from the tenant's connection settings, secrets from the encrypted Vault, deployment values from the env NAMES below.
export const RESEND_CONNECTOR_ID = "resend" as const;
export const SMTP_CONNECTOR_ID = "email-smtp" as const;

/** Env var names (listed in .env.example, values never in code). */
export const EMAIL_ENV = {
  /** Resend API base override; Cypress and local runs point it at a stub. Unset = the vendor default. */
  resendApiBase: "RESEND_API_BASE",
  /** Platform fallback sender for system mail only (never for a tenant's marketing mail). Read by name, never defaulted in code. */
  platformFrom: "EMAIL_FROM",
  platformReplyTo: "EMAIL_REPLY_TO",
  /** HMAC key for unsubscribe tokens. */
  unsubscribeSecret: "EMAIL_UNSUBSCRIBE_SECRET",
  /** Public base URL used to build unsubscribe links (the app's own origin). */
  appBaseUrl: "APP_BASE_URL",
} as const;

export const DEFAULT_RESEND_BASE = "https://api.resend.com";

/** Credential bundle keys kept in the Vault. */
export const CRED = {
  apiKey: "api_key", webhookSecret: "webhook_secret",
  smtpHost: "smtp_host", smtpPort: "smtp_port", smtpUsername: "smtp_username", smtpPassword: "smtp_password",
} as const;
/** Sandbox credentials: accepted outside production only, never touch the network. */
export const MOCK_API_KEY = "re_mock_key";
export const MOCK_SMTP_HOST = "mock.smtp.invalid";

/** Connection settings keys (integrations.settings), edited on /settings/email. */
export const SET = { fromName: "from_name", fromEmail: "from_email", replyTo: "reply_to", footer: "footer_text", dkimSelector: "dkim_selector", domainId: "domain_id" } as const;

/** Unsubscribe link lifetime. Long on purpose: a mail opened months later must still be able to opt out. */
export const UNSUBSCRIBE_TTL_DAYS = 180;
export const UNSUBSCRIBE_PATH = "/unsubscribe";
export const UNSUBSCRIBE_ONE_CLICK_PATH = "/api/email/unsubscribe";

/** Sending limits: messages per rolling minute per connection, recipients per batch job, messages one dispatch run sends. */
export const SEND_PER_MINUTE = 120;
export const BATCH_SIZE = 25;
export const DISPATCH_BATCH = 50;
export const MAX_SUBJECT = 200;
export const MAX_BODY_BYTES = 512 * 1024;

export const EMAIL_PURPOSE = "marketing_email" as const;
export const JOB_KIND = { campaign: "email.campaign", batch: "email.batch" } as const;
