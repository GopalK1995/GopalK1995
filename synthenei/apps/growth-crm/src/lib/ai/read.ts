// Read model for the /ai page (real sessions). Everything is read under the caller's JWT: members read the policy and their own usage,
// ai.toggle holders also read providers (has_secret only, never secret_id), all usage and the whole audit trail.
import "server-only";
import type { Db } from "@/lib/db/client";
import { from } from "@/lib/db/query";
import { policyFromRow } from "./store";
import { PROVIDER_IDS, type CapStatus, type PolicyRow, type ProviderId } from "./types";

export interface ProviderView { provider: ProviderId; enabled: boolean; defaultModel: string | null; allowedModels: string[]; hasSecret: boolean }
export interface AuditView { id: string; at: string; feature: string; model: string; excerpt: string | null; principalId: string | null }
export interface AiOverview { tenantId: string; policy: PolicyRow; providers: ProviderView[]; caps: CapStatus | null; lastRun: Record<string, string>; audit: AuditView[] }

export async function loadAiOverview(db: Db, wsUuid: string, uid: string): Promise<AiOverview | null> {
  const w = await from(db, "workspaces").select("tenant_id").eq("id", wsUuid).maybeSingle();
  const tenantId = (w.data as { tenant_id?: string } | null)?.tenant_id;
  if (w.error || !tenantId) return null;
  const [pol, prov, usage, audit, caps] = await Promise.all([
    from(db, "ai_policies").select("*").eq("tenant_id", tenantId).maybeSingle(),
    from(db, "ai_providers").select("provider, enabled, default_model, allowed_models, has_secret").eq("tenant_id", tenantId),
    from(db, "ai_usage").select("feature, at").eq("workspace_id", wsUuid).order("at", { ascending: false }).limit(60),
    from(db, "ai_audit").select("id, at, feature, model, output_excerpt, principal_id").eq("workspace_id", wsUuid).order("at", { ascending: false }).limit(8),
    (db as unknown as { rpc(f: string, a: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }).rpc("ai_cap_status", { p_tenant: tenantId, p_user: uid }),
  ]);
  const lastRun: Record<string, string> = {};
  for (const r of (usage.data as { feature: string; at: string }[] | null) ?? []) if (!lastRun[r.feature]) lastRun[r.feature] = r.at;
  return {
    tenantId,
    policy: policyFromRow(tenantId, (pol.data as Record<string, unknown> | null) ?? {}),
    providers: ((prov.data as Record<string, unknown>[] | null) ?? []).filter((p) => PROVIDER_IDS.includes(p.provider as ProviderId)).map((p) => ({
      provider: p.provider as ProviderId, enabled: p.enabled !== false, defaultModel: (p.default_model as string | null) ?? null,
      allowedModels: Array.isArray(p.allowed_models) ? (p.allowed_models as string[]) : [], hasSecret: p.has_secret === true,
    })),
    caps: caps.error || !caps.data ? null : (caps.data as CapStatus),
    lastRun,
    audit: ((audit.data as Record<string, unknown>[] | null) ?? []).map((a) => ({ id: String(a.id), at: String(a.at), feature: String(a.feature), model: String(a.model), excerpt: (a.output_excerpt as string | null) ?? null, principalId: (a.principal_id as string | null) ?? null })),
  };
}
