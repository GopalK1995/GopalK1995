// Gmail connector constants. Nothing tenant-, brand-, mailbox- or URL-specific of a customer lives here.
export const GMAIL_CONNECTOR_ID = "gmail" as const;
/** gmail.readonly is a RESTRICTED scope (CASA assessment before production use); gmail.send is sensitive. Nothing broader is requested. */
export const GMAIL_SCOPES = { read: "https://www.googleapis.com/auth/gmail.readonly", send: "https://www.googleapis.com/auth/gmail.send" } as const;
export const GMAIL_ENV = {
  apiBase: "GMAIL_API_BASE",
  /** Publishing status of the platform's Google OAuth app: "testing" (at most 100 named test users) or "production". */
  appMode: "GOOGLE_OAUTH_APP_MODE",
  /** "true" once the restricted-scope security assessment (CASA) has been passed and Google has verified the app. */
  casaComplete: "GOOGLE_OAUTH_CASA_COMPLETE",
} as const;
export const DEFAULT_GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";

export const STREAM_THREADS = "threads" as const;
/** Addresses per Gmail search (Google filters server side, so mail with strangers is not even listed). */
export const ADDRESS_CHUNK = 20;
export const THREADS_PER_QUERY = 50;
export const MAX_BODY = 20_000;
/** Credential bundle flag stamped when the tenant opted in through the gated start. Without it the connection never reads or sends. */
export const OPT_IN_KEY = "gmail_opt_in";
/** Re-read overlap, so a message that arrived during the previous run is never missed (writes are idempotent). */
export const OVERLAP_SEC = 3600;
export const FIRST_LOOKBACK_DAYS = 30;
