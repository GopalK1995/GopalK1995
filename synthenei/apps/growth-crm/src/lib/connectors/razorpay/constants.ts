// Razorpay (tenant payments) connector constants. The TENANT collects money from THEIR customers with THEIR Razorpay keys.
// This is not the platform's own billing: it never reads the platform plan/invoice tables, and the platform RAZORPAY_KEY_* /
// BILLING_* env vars are not used here. No tenant-, brand-, price-, GST/SAC- or URL-specific values live in this module:
// tax rates and SAC codes (if a tenant wants them on a payment) come from tenant config, the API base is an env override.
export const RZP_CONNECTOR_ID = "razorpay" as const;

/** Env var names (listed in .env.example, never values). */
export const RZP_ENV = { apiBase: "RAZORPAY_API_BASE" } as const;

/** Vendor default, used only when RAZORPAY_API_BASE is unset (staging stubs and Cypress point it elsewhere). */
export const DEFAULT_API_BASE = "https://api.razorpay.com";

/** Credential bundle keys kept in the Vault. webhook_secret is picked up by the receiver (verify/index.ts pickSecret). */
export const CRED = { keyId: "key_id", keySecret: "key_secret", webhookSecret: "webhook_secret", accountId: "account_id" } as const;

/** Shape of the public key id the tenant pastes: rzp_test_... or rzp_live_... */
export const KEY_ID_PATTERN = "^rzp_(test|live)_[A-Za-z0-9]{6,40}$";
/** Razorpay account ids look like acc_XXXX (optional credential; when present, webhooks for another account are refused). */
export const ACCOUNT_ID_PATTERN = "^acc_[A-Za-z0-9]{6,40}$";

/** external_links / payments.provider. */
export const PROVIDER = "razorpay" as const;

/** payments.currency default when the caller gives none. ISO code, not a price. */
export const DEFAULT_CURRENCY = "INR";

/** Hard upper bound on a single amount in minor units (guards integer overflow and typos). */
export const MAX_AMOUNT_MINOR = 100_000_000_000_00;
