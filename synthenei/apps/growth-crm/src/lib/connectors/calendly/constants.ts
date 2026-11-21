// Booking connectors (Calendly + Cal.com). The TENANT connects THEIR scheduling account; nothing here is tenant-, brand- or URL-specific
// beyond the vendors' public API defaults, which are overridable by env (CALENDLY_API_BASE, CALCOM_API_BASE).
export const CALENDLY_ID = "calendly" as const;
export const CALENDLY_ENV = { apiBase: "CALENDLY_API_BASE" } as const;
export const CALENDLY_DEFAULT_BASE = "https://api.calendly.com";
/** Credential bundle keys kept in the Vault. signing_key is what the receiver verifies deliveries with (verify/index.ts pickSecret). */
export const CALENDLY_CRED = { token: "access_token", signingKey: "signing_key" } as const;
export const CALENDLY_EVENTS = ["invitee.created", "invitee.canceled"] as const;

/** Shared by both vendors: where booking rows and the booking events live. */
export const BOOKING_OBJECT = "booking" as const;
/** Zone used to print a start time in notifications when the connection has no `display_timezone` setting (IANA name). */
export const DEFAULT_DISPLAY_TZ = "Asia/Kolkata";
/** Longest we keep any vendor text we show (event title, reason). */
export const TEXT_MAX = 200;
/** Task due offsets. */
export const PREP_LEAD_MS = 60 * 60 * 1000;
export const CANCEL_FOLLOW_UP_MS = 24 * 60 * 60 * 1000;
