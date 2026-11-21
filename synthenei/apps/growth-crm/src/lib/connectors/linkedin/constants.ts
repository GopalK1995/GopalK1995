// LinkedIn connector constants (Lead Gen Forms + Ads analytics). No tenant-, brand-, price- or account-specific values live here:
// client id / secret are env NAMES (values in the deployment); the ad account is per-connection data in the credential bundle.
export const LINKEDIN_CONNECTOR_ID = "linkedin" as const;

/** Env var names (listed in .env.example, values never in code). */
export const LINKEDIN_ENV = {
  clientId: "LINKEDIN_CLIENT_ID",
  clientSecret: "LINKEDIN_CLIENT_SECRET",
  /** API base override (staging stub / Cypress). Unset = the vendor default. */
  apiBase: "LINKEDIN_API_BASE",
  /** Linkedin-Version header (YYYYMM). Unset = DEFAULT_API_VERSION. */
  apiVersion: "LINKEDIN_API_VERSION",
} as const;

export const DEFAULT_API_BASE = "https://api.linkedin.com";
export const DEFAULT_API_VERSION = "202511";
export const OAUTH_AUTHORIZE_URL = "https://www.linkedin.com/oauth/v2/authorization";
export const OAUTH_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
export const INTROSPECT_URL = "https://www.linkedin.com/oauth/v2/introspectToken";

/** r_ads + r_ads_reporting: Marketing Developer Platform advertising product. r_ads_leadgen_automation: Lead Sync API. Both need LinkedIn approval. */
export const SCOPES = ["r_ads", "r_ads_reporting", "r_ads_leadgen_automation"] as const;

/** Credential bundle keys kept in the Vault (never returned to a client, never logged). */
export const CRED = { accessToken: "access_token", refreshToken: "refresh_token", adAccountId: "ad_account_id" } as const;

/** external_links object name for a lead form response, and the field-map external object for its answers. */
export const LEAD_OBJECT = "LeadFormResponse";

export const ACCOUNT_URN_PREFIX = "urn:li:sponsoredAccount:";
export const CAMPAIGN_URN_PREFIX = "urn:li:sponsoredCampaign:";

/** First poll reads this many days back. */
export const LEADS_BACKFILL_DAYS = 30;
export const LEADS_PAGE_SIZE = 100;
/** Analytics: re-read this many trailing days each run (LinkedIn restates spend), backfill on first run, once the IST day reached this hour. */
export const ANALYTICS_LOOKBACK_DAYS = 7;
export const ANALYTICS_BACKFILL_DAYS = 30;
export const ANALYTICS_AFTER_HOUR_IST = 6;
/** The health stream warns when the access token has less than this left. */
export const TOKEN_WARN_DAYS = 7;

/** Consent purposes a lead form answer may grant (the product's own enum, not a tenant value). */
export const FORM_CONSENT_PURPOSES = ["demo_followup", "marketing_email", "whatsapp"] as const;
export type FormConsentPurpose = (typeof FORM_CONSENT_PURPOSES)[number];
