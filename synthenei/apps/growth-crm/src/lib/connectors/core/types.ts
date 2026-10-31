// Connector framework types (BUILD-PLAN 1.7, CONTRACTS C9). Pure: no server imports, safe in any bundle.
export type ConnectorId =
  | "csv" | "whatsapp" | "meta-ads" | "razorpay" | "gmail" | "outlook" | "google-ads" | "ga4" | "google-business" | "linkedin"
  | "mailchimp" | "booking-com" | "makemytrip" | "airbnb" | "google-calendar" | "google-sheets" | "calendly" | "cal-com"
  | "zoho-crm" | "hubspot" | "slack" | "zapier" | "make" | "email" | "email-smtp" | "resend" | "ical" | "mock";

export type ConnectorCategory = "crm" | "messaging" | "email" | "ads" | "analytics" | "scheduling" | "payments" | "automation" | "ota" | "data";
export type AuthKind = "oauth2" | "api_key" | "service_account" | "webhook_secret" | "none";
export type Gate = "none" | "needs_vendor_approval" | "needs_client_credentials";
export type ConnMode = "sandbox" | "live";
export type ConsentPurpose = "demo_followup" | "marketing_email" | "whatsapp" | "analytics_cookies" | "ai_processing";
export type TransformKey = "e164_phone" | "lower_email" | "inr_paise_to_rupees" | "micros_to_rupees" | "date_ist" | "stage_key_map" | "hash_sha256" | "trim";

/** Status values stored in integrations.status (0001 + 0015). */
export type IntegrationStatus = "connected" | "showcase" | "needs_attention" | "error" | "not_configured" | "sandbox" | "disconnected";

export interface ConnectionRow {
  id: string; tenantId: string; workspaceId: string; connectorId: ConnectorId;
  mode: ConnMode; status: IntegrationStatus; settings: Record<string, unknown>;
  credentialSecretId: string | null; webhookSecretId: string | null; tokenExpiresAt: string | null;
  lastSyncAt?: string | null; lastError?: string | null;
}
/** Decrypted credential bundle. Lives only in memory of a server job or action; never logged, never returned to a client. */
export type ConnectionSecrets = Record<string, string>;

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface HttpRequest { method: string; url: string; headers?: Record<string, string>; body?: unknown }
export interface VendorHttp { json<T>(req: HttpRequest): Promise<T> }

export interface FieldMapSpec {
  externalObject: string; externalField: string; localTable: string; localColumn: string;
  direction: "in" | "out" | "both"; transform?: TransformKey | null; transformArg?: Record<string, unknown> | null;
  conflictOwner?: "crm" | "external" | "last_write"; sample?: string;
}

export type UpsertTarget = "lead" | "contact" | "account" | "deal" | "campaign_daily" | "ga4_daily" | "message" | "conversation" | "payment" | "calendar_event" | "review" | `obj:${string}`;
export interface Upserter {
  /** Dedupes through external_links and match keys; applies the tenant's field map; returns the local id. */
  record(target: UpsertTarget, externalObject: string, externalId: string, data: Record<string, unknown>): Promise<{ localId: string; created: boolean }>;
}

export interface SyncContext {
  conn: ConnectionRow; secrets(): Promise<ConnectionSecrets>; http: VendorHttp; upsert: Upserter; log: Logger; runId: number; apiBase: string;
  /** Called by a stream when it rejects a row (counted in rows_rejected with the reason; reasons never carry PII). */
  reject?(reason: string): void;
}
export interface SyncResult { cursor: unknown; rowsIn: number; rowsRejected: number; done: boolean; sample?: unknown }
export interface PushContext extends SyncContext { contactId: string }
export interface PushResult { ok: boolean; externalId?: string; error?: string }

export interface StreamDef { key: string; schedule?: { cron: string; tz: "Asia/Kolkata" }; run(ctx: SyncContext, cursor: unknown): Promise<SyncResult> }
export interface PushDef { key: string; onEvent?: string[]; consentPurpose?: ConsentPurpose; run(ctx: PushContext, input: unknown): Promise<PushResult> }

export interface RateLimitPolicy { requestsPerMinute: number; maxRetries: number; baseDelayMs: number; maxDelayMs: number }
export const DEFAULT_RATE_POLICY: RateLimitPolicy = { requestsPerMinute: 60, maxRetries: 5, baseDelayMs: 500, maxDelayMs: 30_000 };

export interface OAuthSpec {
  authorizeUrl: string; tokenUrl: string; scopes: string[]; pkce: boolean; extraAuthParams?: Record<string, string>;
  clientIdEnv: string; clientSecretEnv: string;
}
export interface CredentialField { key: string; label: string; secret: boolean; pattern?: string }

export interface ConnectorDef {
  id: ConnectorId; name: string; category: ConnectorCategory; auth: AuthKind;
  oauth?: OAuthSpec;
  /** api_key / service_account forms. */
  credentialFields?: CredentialField[];
  gate: Gate;
  sandbox: { supported: boolean; howTo: string };
  /** Capabilities shown on the detail page and checked by the runner. */
  capabilities: { inbound: boolean; outbound: boolean; webhooks: boolean };
  streams: StreamDef[];
  pushes: PushDef[];
  webhook?: { verify(req: { rawBody: string; headers: Record<string, string> }, secrets: ConnectionSecrets): Promise<unknown[]>; handle(ctx: SyncContext, evt: unknown): Promise<void> };
  defaultFieldMap: FieldMapSpec[];
  rate?: Partial<RateLimitPolicy>;
  /** Env var names that must be set for the connector to be usable (client id/secret, partner key...). Empty = always usable. */
  requiredEnv?: string[];
  /** Env var holding an API base override; the default is `defaultApiBase`. */
  apiBaseEnv?: string; defaultApiBase?: string;
  /** Verifies stored credentials with one cheap vendor call. Throws a CredentialError when the vendor rejects them. */
  test?(ctx: { conn: ConnectionRow; secrets: ConnectionSecrets; http: VendorHttp; apiBase: string }): Promise<{ accountLabel?: string; accountId?: string }>;
  /** OAuth refresh; default implementation posts grant_type=refresh_token to oauth.tokenUrl. */
  refresh?(ctx: { conn: ConnectionRow; secrets: ConnectionSecrets; http: VendorHttp }): Promise<{ secrets: ConnectionSecrets; expiresInSec?: number }>;
}

/** Thrown when the vendor says the credentials/refresh token are no longer valid: the connection needs the owner's attention. */
export class CredentialError extends Error {
  constructor(message: string) { super(message); this.name = "CredentialError"; }
}
/** Thrown for a transient vendor failure after retries; the job retries. */
export class TransientError extends Error {
  constructor(message: string, public retryAfterMs?: number) { super(message); this.name = "TransientError"; }
}
