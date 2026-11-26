// Meta connector constants (Lead Ads, Instagram DMs, Ads Insights). No tenant-, brand-, price-, page-id- or URL-specific values live
// here: the app id and secret are env NAMES (values in the deployment), page / Instagram / ad account ids are per-connection data.
export const META_CONNECTOR_ID = "meta-ads" as const;

/** Env var names (listed in .env.example, values never in code). */
export const META_ENV = {
  /** Graph API base override. Cypress and local runs point this at a stub; unset = the vendor default. */
  apiBase: "META_GRAPH_API_BASE",
  apiVersion: "META_GRAPH_API_VERSION",
  /** The platform Meta app (OAuth client). The secret also signs webhooks (X-Hub-Signature-256) and the appsecret_proof. */
  appId: "META_APP_ID",
  appSecret: "META_APP_SECRET",
} as const;

export const DEFAULT_API_BASE = "https://graph.facebook.com";
export const DEFAULT_API_VERSION = "v21.0";
/** META_GRAPH_API_VERSION when it looks like a Graph version ("v23.0"); anything else (typo, injection) falls back to the default. */
export function graphVersionOf(raw: string | undefined): string {
  const v = (raw ?? "").trim();
  return /^v\d{1,2}\.\d{1,2}$/.test(v) ? v : DEFAULT_API_VERSION;
}
export const oauthDialogUrl = (raw?: string): string => `https://www.facebook.com/${graphVersionOf(raw)}/dialog/oauth`;
export const oauthTokenUrl = (raw?: string): string => `https://graph.facebook.com/${graphVersionOf(raw)}/oauth/access_token`;
/** Resolved once at module load from the deployment env, like every other connector's OAuth URLs (the ConnectorDef is a constant). */
export const OAUTH_DIALOG_URL = oauthDialogUrl(process.env[META_ENV.apiVersion]);
export const OAUTH_TOKEN_URL = oauthTokenUrl(process.env[META_ENV.apiVersion]);

/** Permissions requested together with the rest of the Meta review (docs/META-PERMISSIONS.md). */
export const SCOPES = [
  "pages_show_list", "pages_manage_metadata", "pages_read_engagement", "leads_retrieval", "ads_read", "instagram_basic", "instagram_manage_messages",
  "instagram_manage_insights", "read_insights",
] as const;

/**
 * Scopes actually requested on the OAuth dialog. META_OAUTH_SCOPES (comma separated) overrides the default list, so a Meta app that has not
 * been granted every use case yet (for example leads_retrieval needs the Lead Ads use case) can still connect: Meta rejects the whole
 * dialog with "Invalid Scopes" if even one scope is not enabled for the app. Unknown names are passed through; Meta is the judge.
 */
export function effectiveScopes(raw: string | undefined = process.env.META_OAUTH_SCOPES): string[] {
  const listed = (raw ?? "").split(",").map((x) => x.trim()).filter((x) => /^[a-z_]+$/.test(x));
  return listed.length ? Array.from(new Set(listed)) : [...SCOPES];
}

/** Credential bundle keys kept in the Vault (never returned to a client, never logged). */
export const CRED = {
  accessToken: "access_token", refreshToken: "refresh_token", pageId: "page_id", pageToken: "page_token", igUserId: "ig_user_id", adAccountId: "ad_account_id",
} as const;
/** Keys of the webhook secret bundle (webhook_secret_id): the signing secret and the hub.challenge token. */
export const WEBHOOK_KEYS = { appSecret: "app_secret", verifyToken: "verify_token" } as const;

/** external_links object names. */
export const OBJ = { lead: "LeadgenLead", campaign: "Campaign" } as const;
/** Field-map external object for lead form answers (the field-mapping editor edits rows of this object). */
export const LEAD_OBJECT = "Lead";

/** Customer-service window for Instagram DMs: free-form replies only within 24 h of the person's last message. */
export const SERVICE_WINDOW_MS = 24 * 3600e3;
/** Instagram text messages are capped at 1000 bytes (UTF-8). */
export const MAX_IG_TEXT_BYTES = 1000;
export const SEND_PER_MINUTE = 300;
export const DISPATCH_BATCH = 50;

/** Insights: re-fetch this many trailing days each run (Meta restates attribution), and backfill this many on the first run. */
export const INSIGHTS_LOOKBACK_DAYS = 7;
export const INSIGHTS_BACKFILL_DAYS = 30;
export const INSIGHTS_PAGE_SIZE = 200;
/** The daily sync runs once the IST day has reached this hour (Meta finalises the previous day overnight). */
export const INSIGHTS_AFTER_HOUR_IST = 6;
/** The health stream warns when the user token has less than this left. */
export const TOKEN_WARN_DAYS = 7;

/** Consent purposes a lead form answer may grant (the product's own enum, not a tenant value). */
export const FORM_CONSENT_PURPOSES = ["demo_followup", "marketing_email", "whatsapp"] as const;
export type FormConsentPurpose = (typeof FORM_CONSENT_PURPOSES)[number];
