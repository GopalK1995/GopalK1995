// Zoho CRM connector constants. No tenant-, brand- or URL-specific value lives here: the OAuth client id and secret are env NAMES
// (values in the deployment); the data centre is a per-connection setting whose default is India (.in).
export const ZOHO_CONNECTOR_ID = "zoho-crm" as const;
export const ZOHO_VENDOR_KEY = "zoho" as const;

export const ZOHO_ENV = {
  clientId: "ZOHO_CLIENT_ID",
  clientSecret: "ZOHO_CLIENT_SECRET",
  /** Accounts (OAuth) server override. Cypress and local runs point this at a stub; unset = the region's accounts server. */
  accountsUrl: "ZOHO_ACCOUNTS_URL",
  /** CRM API base override (stub). Unset = the region's API domain. */
  apiBase: "ZOHO_API_BASE",
  /** Default data centre for a connection that has none stored: in, us, eu, au, jp, ca, sa, cn. Unset = in. */
  defaultRegion: "ZOHO_DEFAULT_REGION",
} as const;

export type ZohoRegion = "in" | "us" | "eu" | "au" | "jp" | "ca" | "sa" | "cn";
export const DEFAULT_REGION: ZohoRegion = "in";
/** Zoho data centres: the accounts server (OAuth) and the API domain. */
export const REGIONS: Record<ZohoRegion, { accounts: string; api: string }> = {
  in: { accounts: "https://accounts.zoho.in", api: "https://www.zohoapis.in" },
  us: { accounts: "https://accounts.zoho.com", api: "https://www.zohoapis.com" },
  eu: { accounts: "https://accounts.zoho.eu", api: "https://www.zohoapis.eu" },
  au: { accounts: "https://accounts.zoho.com.au", api: "https://www.zohoapis.com.au" },
  jp: { accounts: "https://accounts.zoho.jp", api: "https://www.zohoapis.jp" },
  ca: { accounts: "https://accounts.zohocloud.ca", api: "https://www.zohoapis.ca" },
  sa: { accounts: "https://accounts.zoho.sa", api: "https://www.zohoapis.sa" },
  cn: { accounts: "https://accounts.zoho.com.cn", api: "https://www.zohoapis.com.cn" },
};
export const isRegion = (s: unknown): s is ZohoRegion => typeof s === "string" && Object.prototype.hasOwnProperty.call(REGIONS, s);

/** Zoho wants scopes comma separated; the framework joins with spaces, so they travel as one element. */
export const SCOPES = ["ZohoCRM.modules.ALL,ZohoCRM.coql.READ,ZohoCRM.notifications.ALL,ZohoCRM.org.READ"] as const;
export const CRM_API_PATH = "/crm/v6";
export const OAUTH_PATHS = { authorize: "/oauth/v2/auth", token: "/oauth/v2/token" } as const;

/** Credential bundle keys kept in the Vault (never returned to a client, never logged). */
export const CRED = { accessToken: "access_token", refreshToken: "refresh_token", region: "region", orgId: "org_id" } as const;
/** Webhook secret bundle keys. */
export const WEBHOOK_KEYS = { secret: "webhook_secret", channelExpires: "channel_expires" } as const;

/** Notification channels expire after at most a week; renew when less than this is left. */
export const WATCH_TTL_DAYS = 6;
export const WATCH_RENEW_BEFORE_HOURS = 36;
/** COQL: records per page, and the largest offset used before the window restarts from the last Modified_Time. */
export const PAGE_SIZE = 200;
export const MAX_OFFSET = 2000;
/** Modules the connector reads: the CRM object and Zoho's module API name. */
export const MODULE = { lead: "Leads", contact: "Contacts", account: "Accounts", deal: "Deals" } as const;
