// Channel-manager connector constants. The connector id is generic on purpose: the partner is an owner decision (B-6), not code.
export const CM_ID = "channel-manager" as const;
export const CM_ENV = { apiBase: "CHANNEL_MANAGER_API_BASE" } as const;
/** Credential bundle keys kept in the Vault. webhook_secret signs deliveries (verify/index.ts pickSecret). */
export const CM_CRED = { apiKey: "api_key", webhookSecret: "webhook_secret" } as const;
/** Sandbox / showcase token: selects the fixture gateway (no network). Refused in production, like the other connectors' sandbox tokens. */
export const CM_FIXTURE_TOKEN = "cm-fixture-token";
export const CM_PAGE_SIZE = 100;
export const CM_STREAMS = { reservations: "reservations", availability: "availability" } as const;
/** Reservations are pulled every 15 minutes as the safety net behind webhooks; availability is re-evaluated every 30. */
export const CM_RESERVATIONS_CRON = "*/15 * * * *";
export const CM_AVAILABILITY_CRON = "*/30 * * * *";
