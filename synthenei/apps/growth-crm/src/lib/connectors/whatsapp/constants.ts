// WhatsApp Cloud API connector constants. No tenant-, brand-, price-, number- or URL-specific values live here:
// app ids and secrets come from the env NAMES below (values in the deployment), account ids from per-tenant credentials.
export const WA_CONNECTOR_ID = "whatsapp" as const;

/** Env var names (listed in .env.example, values never in code). */
export const WA_ENV = {
  /** Graph API base override. Cypress and local runs point this at a stub; unset = the vendor default. */
  apiBase: "WHATSAPP_API_BASE",
  /** Graph API version override (e.g. when Meta retires one). */
  apiVersion: "WHATSAPP_API_VERSION",
  /** Platform Meta app for embedded signup (token exchange). Optional: manual connection needs none of them. */
  appId: "WHATSAPP_APP_ID",
  appSecret: "WHATSAPP_APP_SECRET",
  embeddedSignupConfigId: "WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID",
} as const;

/** Vendor default, used only when WHATSAPP_API_BASE is unset. */
export const DEFAULT_API_BASE = "https://graph.facebook.com";
export const DEFAULT_API_VERSION = "v21.0";

/** Credential bundle keys kept in the Vault (never returned to a client, never logged). */
export const CRED = { wabaId: "waba_id", phoneNumberId: "phone_number_id", accessToken: "access_token", appSecret: "app_secret" } as const;

/** external_links object names. */
export const OBJ = { message: "Message", conversation: "Conversation" } as const;

/** Private storage bucket for inbound media; objects live under <tenant>/<workspace>/<connection>/<message>. */
export const MEDIA_BUCKET = "wa-media";
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

/** Customer-service window: free-form messages only within 24 h of the customer's last inbound message. */
export const SERVICE_WINDOW_MS = 24 * 3600e3;

/** Outbound throttle per phone number (messages per rolling minute). Meta enforces its own tiers on top; 429s are retried. */
export const SEND_PER_MINUTE = 600;
/** Max queued messages one dispatch run sends. */
export const DISPATCH_BATCH = 50;
/** Max body length Meta accepts for a text message. */
export const MAX_TEXT_LENGTH = 4096;

/** Sandbox (Meta test business number) can message at most this many distinct test recipients. */
export const SANDBOX_MAX_RECIPIENTS = 5;
