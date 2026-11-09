// Constants shared by the Google connectors (GA4, Google Ads, Google Sheets). No tenant-, brand-, price-, account-id- or URL-specific
// values live in code: the OAuth client and the Ads developer token are env NAMES (values in the deployment); property, customer and
// spreadsheet ids are per-connection data.

/** Env var names (listed in .env.example, values never in code). One Google OAuth client serves all three connectors. */
export const GOOGLE_ENV = {
  clientId: "GOOGLE_OAUTH_CLIENT_ID",
  clientSecret: "GOOGLE_OAUTH_CLIENT_SECRET",
  /** Google Ads developer token (basic access needed for live accounts; test-account access works before that). */
  adsDeveloperToken: "GOOGLE_ADS_DEVELOPER_TOKEN",
  /** Optional manager (MCC) customer id sent as login-customer-id when client accounts are reached through a manager. */
  adsLoginCustomerId: "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
  adsApiBase: "GOOGLE_ADS_API_BASE",
  adsApiVersion: "GOOGLE_ADS_API_VERSION",
  ga4DataApiBase: "GA4_DATA_API_BASE",
  ga4AdminApiBase: "GA4_ADMIN_API_BASE",
  sheetsApiBase: "GOOGLE_SHEETS_API_BASE",
} as const;

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Read-only where Google offers it: the CRM never writes to a customer's Analytics or Sheets. Ads has only the one scope. */
export const SCOPE = {
  analytics: "https://www.googleapis.com/auth/analytics.readonly",
  adwords: "https://www.googleapis.com/auth/adwords",
  sheets: "https://www.googleapis.com/auth/spreadsheets.readonly",
} as const;

/** `access_type=offline` + `prompt=consent` so Google returns a refresh token on every connect (reconnect included). */
export const GOOGLE_AUTH_PARAMS: Record<string, string> = { access_type: "offline", prompt: "consent" };

/** Credential bundle keys kept in the Vault (never returned to a client, never logged). */
export const CRED = {
  accessToken: "access_token", refreshToken: "refresh_token",
  propertyId: "property_id", customerId: "customer_id", loginCustomerId: "login_customer_id", currency: "currency",
} as const;

/** Retry policy for quota (429 / rateLimitExceeded) and 5xx answers. */
export const MAX_RETRIES = 4;
export const BASE_DELAY_MS = 800;
export const MAX_DELAY_MS = 30_000;

/** Showcase sandbox token: the connection never touches Google and rows are labelled mock. Refused in production. */
export const MOCK_TOKEN = "google-mock-token";
