// Outlook / Microsoft 365 connector constants. No tenant, brand, mailbox or URL of any customer lives here; the vendor hosts are
// Microsoft's public hosts, the Graph base is overridable by env name (values in the deployment).
export const MS_ID = "outlook" as const;
export const STREAM_INBOX = "inbox" as const;
export const STREAM_SENT = "sent" as const;
export const STREAM_CALENDAR = "calendar" as const;
export const STREAM_SUBSCRIPTIONS = "subscriptions" as const;

/** Env var names (listed in .env.example, values never in code). One multi-tenant Entra ID app serves every customer firm. */
export const MS_ENV = { clientId: "MICROSOFT_OAUTH_CLIENT_ID", clientSecret: "MICROSOFT_OAUTH_CLIENT_SECRET", graphApiBase: "MICROSOFT_GRAPH_API_BASE", appBaseUrl: "APP_BASE_URL" } as const;

export const MS_LOGIN_BASE = "https://login.microsoftonline.com";
/** `common` = any work or school account of any Entra tenant (multi-tenant app); the app registration decides whether personal accounts are allowed. */
export const MS_AUTHORIZE_URL = `${MS_LOGIN_BASE}/common/oauth2/v2.0/authorize`;
export const MS_TOKEN_URL = `${MS_LOGIN_BASE}/common/oauth2/v2.0/token`;
export const DEFAULT_GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/** Delegated scopes. Calendar is read-only (the CRM never edits a customer's calendar); Mail.Send is used only by the known-contact send path. */
export const MS_SCOPES = ["offline_access", "User.Read", "Mail.Read", "Mail.Send", "Calendars.Read"] as const;
/** Scope string for an admin-consent request and for refresh (`.default` = everything the app registration lists). */
export const GRAPH_DEFAULT_SCOPE = "https://graph.microsoft.com/.default";

/** Showcase sandbox token: the connection never touches Microsoft. Refused in production. */
export const MOCK_TOKEN = "microsoft-mock-token";

export const MAX_RETRIES = 4;
export const BASE_DELAY_MS = 800;
export const MAX_DELAY_MS = 30_000;

export const PAGE_SIZE = 50;
export const PAGES_PER_STEP = 5;
export const MAIL_BACKFILL_DAYS = 30;
export const CAL_PAST_DAYS = 30;
export const CAL_FUTURE_DAYS = 180;

/** Graph caps mail / event subscriptions at 4230 minutes (about 70.5 h). We ask for a little less and renew when under 12 h remain. */
export const SUB_MINUTES = 4200;
export const SUB_RENEW_BEFORE_MS = 12 * 3600_000;
export const SUB_RESOURCES = { inbox: "me/mailFolders('inbox')/messages", sent: "me/mailFolders('sentitems')/messages", calendar: "me/events" } as const;
export type SubKey = keyof typeof SUB_RESOURCES;
export const SUB_KEYS = Object.keys(SUB_RESOURCES) as SubKey[];
/** Graph opaque ids: base64url-like. Anything else is refused before it can be put in a URL. */
export const GRAPH_ID = /^[A-Za-z0-9_\-=+]{1,512}$/;

export const MAX_RECIPIENTS = 10;
export const MAX_SUBJECT = 255;
export const MAX_BODY = 20_000;
export const MAX_TITLE = 300;
