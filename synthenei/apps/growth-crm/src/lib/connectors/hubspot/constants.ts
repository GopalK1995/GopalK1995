// HubSpot connector constants. No tenant-, brand- or URL-specific value lives here: client id/secret are env NAMES (values in the
// deployment); the API base is overridable for stubs (Cypress, local).
export const HUBSPOT_CONNECTOR_ID = "hubspot" as const;
export const HUBSPOT_VENDOR_KEY = "hubspot" as const;

export const HUBSPOT_ENV = {
  clientId: "HUBSPOT_CLIENT_ID",
  /** The app's client secret also signs webhook deliveries (X-HubSpot-Signature-v3). */
  clientSecret: "HUBSPOT_CLIENT_SECRET",
  /** API base override (stub). Unset = https://api.hubapi.com. */
  apiBase: "HUBSPOT_API_BASE",
} as const;

export const DEFAULT_API_BASE = "https://api.hubapi.com";
export const OAUTH_AUTHORIZE_URL = "https://app.hubspot.com/oauth/authorize";
export const OAUTH_TOKEN_PATH = "/oauth/v1/token";
export const SCOPES = [
  "oauth", "crm.objects.contacts.read", "crm.objects.contacts.write", "crm.objects.companies.read", "crm.objects.companies.write",
  "crm.objects.deals.read", "crm.objects.deals.write",
] as const;

/** Credential bundle keys kept in the Vault (never returned to a client, never logged). */
export const CRED = { accessToken: "access_token", refreshToken: "refresh_token", hubId: "hub_id" } as const;
/** Webhook secret bundle: the app's client secret (the edge verifier reads `client_secret`). */
export const WEBHOOK_KEYS = { clientSecret: "client_secret" } as const;

/** HubSpot search allows 5 requests a second per account and reads at most 10,000 results per query. */
export const SEARCH_PACE_MS = 220;
export const PAGE_SIZE = 100;
export const MAX_AFTER = 9000;
