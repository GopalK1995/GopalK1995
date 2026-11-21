// Gateway contracts. Provider adapters, the store and the key resolver are ports so tests run with fakes and no network.
export type ProviderId = "anthropic" | "openai" | "google";
export const PROVIDER_IDS: readonly ProviderId[] = ["anthropic", "openai", "google"];

/** Feature keys as stored in ai_policies.features (absent or false = off). */
export const FEATURES = ["reply_draft", "lead_summary", "next_best_action", "ask_crm"] as const;
export type FeatureKey = (typeof FEATURES)[number];
export const isFeature = (k: string): k is FeatureKey => (FEATURES as readonly string[]).includes(k);

export interface ChatMessage { role: "user" | "assistant"; content: string }
export interface CompleteRequest { model: string; system: string; messages: ChatMessage[]; maxTokens: number; temperature?: number; json?: boolean }
export interface CompleteResult { text: string; inputTokens: number; outputTokens: number; model: string; stopReason: string | null }
export interface AdapterCtx { apiKey: string; fetchImpl: typeof fetch; baseUrl?: string; sleep?: (ms: number) => Promise<void>; timeoutMs?: number }
export interface ProviderAdapter { id: ProviderId; complete(req: CompleteRequest, ctx: AdapterCtx): Promise<CompleteResult> }

export type AiErrorCode =
  | "feature_off" | "no_provider" | "no_key" | "model_not_allowed" | "cap_reached" | "rate_limited" | "provider_error" | "bad_output" | "audit_failed" | "policy_unavailable" | "invalid";
export class AiError extends Error {
  constructor(public code: AiErrorCode, message?: string, public detail?: Record<string, unknown>) { super(message ?? code); this.name = "AiError"; }
}

export interface PolicyRow {
  tenantId: string; monthlyCallCap: number | null; monthlyTokenCap: number | null; perUserDailyCap: number | null;
  piiRedaction: boolean; storePrompts: "none" | "redacted" | "full"; features: Record<string, boolean>;
}
export interface ProviderRow { provider: ProviderId; defaultModel: string | null; allowedModels: string[]; enabled: boolean; hasSecret: boolean }
export interface CapStatus {
  allowed: boolean; reason: string | null;
  usage: { calls_month: number; tokens_month: number; user_calls_today: number };
  caps: { monthly_call_cap: number | null; monthly_token_cap: number | null; per_user_daily_cap: number | null; plan_calls: number | null };
}
export interface UsageRow {
  tenantId: string; workspaceId: string; principalKind: "user" | "agent"; principalId: string; feature: FeatureKey; provider: string; model: string;
  inputTokens: number; outputTokens: number; costMicroUsd: number; latencyMs: number | null;
}
export interface AuditRow {
  id: string; tenantId: string; workspaceId: string; principalKind: "user" | "agent"; principalId: string; feature: FeatureKey; model: string;
  promptRedacted: string | null; toolCalls: unknown[]; outputExcerpt: string | null; sourceRefs: unknown[];
}

export interface AiStore {
  getPolicy(tenantId: string): Promise<PolicyRow | null>;
  listProviders(tenantId: string): Promise<ProviderRow[]>;
  capStatus(tenantId: string, uid: string): Promise<CapStatus | null>;
  /** Must throw when the row was not written. */
  insertUsage(r: UsageRow): Promise<void>;
  insertAudit(r: AuditRow): Promise<void>;
}
/** Resolves the API key for a tenant + provider: the tenant's BYOK secret from the vault, else the platform key from env. Never logged. */
export interface KeyResolver { resolve(tenantId: string, provider: ProviderId): Promise<{ key: string; byok: boolean } | null> }

export interface GatewayDeps {
  store: AiStore; keys: KeyResolver; fetchImpl?: typeof fetch; env?: Record<string, string | undefined>;
  sleep?: (ms: number) => Promise<void>; now?: () => number; uuid?: () => string;
  /** Test/staging provider override (see providers/index.ts); ignored in production. */
  adapter?: (p: ProviderId, env: Record<string, string | undefined>) => ProviderAdapter;
}
export interface AiCaller { tenantId: string; workspaceId: string; principalKind: "user" | "agent"; principalId: string }
export interface AiRequest {
  feature: FeatureKey; tier?: "draft" | "fast" | "deep"; system: string; messages: ChatMessage[]; maxTokens: number; temperature?: number; json?: boolean;
  /** Object references the answer is based on (stored in ai_audit.source_refs): ids and view names only. */
  sourceRefs?: { kind: string; id: string }[];
}
export interface AiResponse { text: string; provider: ProviderId; model: string; inputTokens: number; outputTokens: number; costMicroUsd: number; latencyMs: number; auditId: string; redactions: number }
