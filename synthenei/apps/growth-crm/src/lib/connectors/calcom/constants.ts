// Cal.com booking connector constants. Cal.com is open source and self-hostable: the API base is an env override (CALCOM_API_BASE).
export const CALCOM_ID = "cal-com" as const;
export const CALCOM_ENV = { apiBase: "CALCOM_API_BASE" } as const;
export const CALCOM_DEFAULT_BASE = "https://api.cal.com";
/** Credential bundle keys kept in the Vault. webhook_secret signs deliveries (verify/index.ts pickSecret). */
export const CALCOM_CRED = { apiKey: "api_key", webhookSecret: "webhook_secret" } as const;
export const CALCOM_TRIGGERS = ["BOOKING_CREATED", "BOOKING_CANCELLED", "BOOKING_RESCHEDULED"] as const;
/** Header Cal.com's v2 API wants; a vendor-side version pin, not a tenant value. */
export const CALCOM_API_VERSION = "2024-08-13";
