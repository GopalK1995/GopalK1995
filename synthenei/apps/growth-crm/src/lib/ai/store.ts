// Supabase implementations of the gateway ports. Server only.
//  - policy, caps, usage and audit run under the CALLER'S JWT (RLS: ai.use writes own rows, ai_cap_status is guarded for members).
//  - provider rows and BYOK secrets use the service role: clients cannot select ai_providers unless they hold ai.toggle and can never select
//    secret_id, yet a rep's reply draft must still honour the owner's provider choice. The tenant id always comes from the verified session.
import "server-only";
import { dbForRequest, type Db } from "@/lib/db/client";
import { serviceDb } from "@/lib/db/service";
import { from } from "@/lib/db/query";
import { supabaseVault } from "@/lib/connectors/core/vault";
import { ENV_KEY, mockEnabled } from "./providers";
import { PROVIDER_IDS, type AiStore, type CapStatus, type GatewayDeps, type KeyResolver, type PolicyRow, type ProviderId, type ProviderRow } from "./types";

type Rpc = { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }> };
const isProvider = (p: unknown): p is ProviderId => PROVIDER_IDS.includes(p as ProviderId);

export function policyFromRow(tenantId: string, r: Record<string, unknown>): PolicyRow {
  const f = r.features && typeof r.features === "object" && !Array.isArray(r.features) ? (r.features as Record<string, unknown>) : {};
  const sp = r.store_prompts === "none" || r.store_prompts === "full" ? r.store_prompts : "redacted";
  return {
    tenantId, monthlyCallCap: r.monthly_call_cap == null ? null : Number(r.monthly_call_cap), monthlyTokenCap: r.monthly_token_cap == null ? null : Number(r.monthly_token_cap),
    perUserDailyCap: r.per_user_daily_cap == null ? null : Number(r.per_user_daily_cap), piiRedaction: r.pii_redaction !== false, storePrompts: sp,
    features: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === true])),
  };
}

export function supabaseStore(db: Db, admin: () => Db = serviceDb): AiStore {
  return {
    async getPolicy(tenantId) {
      const r = await from(db, "ai_policies").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (r.error) return null;
      // A row exists for every tenant (migration 0021); a missing row reads as "everything off".
      return r.data ? policyFromRow(tenantId, r.data as Record<string, unknown>) : policyFromRow(tenantId, {});
    },
    async listProviders(tenantId): Promise<ProviderRow[]> {
      const r = await from(admin(), "ai_providers").select("provider, default_model, allowed_models, enabled, has_secret").eq("tenant_id", tenantId);
      if (r.error) throw new Error("providers unreadable");
      return ((r.data as Record<string, unknown>[]) ?? []).filter((x) => isProvider(x.provider)).map((x) => ({
        provider: x.provider as ProviderId, defaultModel: (x.default_model as string | null) ?? null, allowedModels: Array.isArray(x.allowed_models) ? (x.allowed_models as string[]) : [],
        enabled: x.enabled !== false, hasSecret: x.has_secret === true,
      }));
    },
    async capStatus(tenantId, uid): Promise<CapStatus | null> {
      const { data, error } = await (db as unknown as Rpc).rpc("ai_cap_status", { p_tenant: tenantId, p_user: uid });
      return error || !data ? null : (data as CapStatus);
    },
    async insertUsage(u) {
      const r = await from(db, "ai_usage").insert({
        tenant_id: u.tenantId, workspace_id: u.workspaceId, principal_kind: u.principalKind, principal_id: u.principalId, feature: u.feature, provider: u.provider, model: u.model,
        input_tokens: u.inputTokens, output_tokens: u.outputTokens, cost_micro_usd: u.costMicroUsd, latency_ms: u.latencyMs,
      });
      if (r.error) throw new Error("ai_usage insert failed");
    },
    async insertAudit(a) {
      const r = await from(db, "ai_audit").insert({
        id: a.id, tenant_id: a.tenantId, workspace_id: a.workspaceId, principal_kind: a.principalKind, principal_id: a.principalId, feature: a.feature, model: a.model,
        prompt_redacted: a.promptRedacted, tool_calls: a.toolCalls, output_excerpt: a.outputExcerpt, source_refs: a.sourceRefs,
      });
      if (r.error) throw new Error("ai_audit insert failed");
    },
  };
}

/** BYOK secret from the vault when the tenant stored one for this provider, otherwise the platform key from env. */
export function vaultKeyResolver(env: Record<string, string | undefined> = process.env, admin: () => Db = serviceDb): KeyResolver {
  return {
    async resolve(tenantId, provider) {
      if (mockEnabled(env)) return { key: "mock", byok: false }; // staging/Cypress only; the mock adapter never calls a vendor
      const r =await from(admin(), "ai_providers").select("secret_id").eq("tenant_id", tenantId).eq("provider", provider).maybeSingle();
      const sid = (r.data as { secret_id?: string | null } | null)?.secret_id;
      if (sid) {
        const key = await supabaseVault(admin()).getSecret(sid).catch(() => null);
        if (key) return { key, byok: true };
        return null; // a BYOK row whose secret cannot be read must not silently fall back to the platform key (it would bill the wrong party)
      }
      const platform = env[ENV_KEY[provider]];
      return platform ? { key: platform, byok: false } : null;
    },
  };
}

/** Production wiring, built per request from the signed-in user's client. */
export async function requestGateway(): Promise<GatewayDeps> {
  return { store: supabaseStore(await dbForRequest()), keys: vaultKeyResolver() };
}
