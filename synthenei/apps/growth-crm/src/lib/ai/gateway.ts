// The AI gateway: the ONLY path from the CRM to a model. Every call runs the same pipeline, in this order:
//   1 feature switch (ai_policies.features, absent = off)   2 provider + model (allow-list)   3 caps (fail closed)
//   4 PII redaction   5 key (BYOK vault or platform env)   6 provider call   7 ai_usage + ai_audit (no row = no output).
// There is no option to skip a step, and nothing here accepts a cap, key or model from a client.
import { evaluateCaps, estimateTokens } from "./caps";
import { DEFAULT_PROVIDER, costMicroUsd, defaultModel, modelDef } from "./models";
import { ENV_BASE, adapterFor } from "./providers";
import { redactAll } from "./redact";
import { scrubSecretsText } from "@/lib/audit/redact";
import { AiError, type AiCaller, type AiRequest, type AiResponse, type GatewayDeps, type ProviderId, type ProviderRow } from "./types";

const EXCERPT_MAX = 2000;
const PROMPT_MAX = 12_000;

/** Provider choice: no rows at all = the platform default (Anthropic, platform key); otherwise Anthropic if enabled, else the first enabled row. */
export function pickProvider(rows: ProviderRow[]): ProviderRow | null {
  if (rows.length === 0) return { provider: DEFAULT_PROVIDER, defaultModel: null, allowedModels: [], enabled: true, hasSecret: false };
  const on = rows.filter((r) => r.enabled);
  return on.find((r) => r.provider === DEFAULT_PROVIDER) ?? on[0] ?? null;
}

/** Model choice: the row default when set, else the catalogue default for the tier; must be in the catalogue and in the tenant allow-list when one is set. */
export function pickModel(row: ProviderRow, tier: AiRequest["tier"] = "draft"): string {
  const m = row.defaultModel || defaultModel(row.provider, tier ?? "draft");
  if (!m || !modelDef(m) || modelDef(m)!.provider !== row.provider) throw new AiError("model_not_allowed", "No usable model for this provider");
  if (row.allowedModels.length > 0 && !row.allowedModels.includes(m)) {
    const alt = row.allowedModels.find((a) => modelDef(a)?.provider === row.provider);
    if (!alt) throw new AiError("model_not_allowed", "The model is not on this workspace's allow-list");
    return alt;
  }
  return m;
}

export async function runAi(deps: GatewayDeps, who: AiCaller, req: AiRequest): Promise<AiResponse> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const uuid = deps.uuid ?? (() => crypto.randomUUID());

  // 1. feature switch: AI is off unless the tenant owner switched this feature on.
  const policy = await deps.store.getPolicy(who.tenantId);
  if (!policy) throw new AiError("policy_unavailable", "AI policy could not be read");
  if (policy.features[req.feature] !== true) throw new AiError("feature_off", "This AI feature is off for this workspace");

  // 2. provider + model
  const row = pickProvider(await deps.store.listProviders(who.tenantId));
  if (!row) throw new AiError("no_provider", "No AI provider is enabled for this workspace");
  const model = pickModel(row, req.tier);

  // 3. caps, from the database numbers and re-evaluated here; a missing answer blocks the call
  const system = req.system.slice(0, PROMPT_MAX);
  const chars = system.length + req.messages.reduce((n, m) => n + m.content.length, 0);
  const verdict = evaluateCaps(await deps.store.capStatus(who.tenantId, who.principalId), estimateTokens(chars, req.maxTokens));
  if (!verdict.ok) throw new AiError("cap_reached", "AI usage cap reached", { reason: verdict.reason });

  // 4. redaction: always at the core level; the extended level follows the tenant policy. The system prompt is ours but is scrubbed too.
  const rd = redactAll([system, ...req.messages.map((m) => m.content.slice(0, PROMPT_MAX))], { extended: policy.piiRedaction });
  const [sysR, ...msgR] = rd.parts;
  const messages = req.messages.map((m, i) => ({ role: m.role, content: msgR[i] }));

  // 5. key (never logged, never returned)
  const key = await deps.keys.resolve(who.tenantId, row.provider);
  if (!key) throw new AiError("no_key", "No API key is configured for this provider");

  // 6. call
  const adapter = deps.adapter ? deps.adapter(row.provider, env) : adapterFor(row.provider, env);
  const t0 = now();
  let result: Awaited<ReturnType<typeof adapter.complete>> | null = null;
  let failure: AiError | null = null;
  try {
    result = await adapter.complete({ model, system: sysR, messages, maxTokens: req.maxTokens, temperature: req.temperature, json: req.json },
      { apiKey: key.key, fetchImpl: deps.fetchImpl ?? fetch, baseUrl: env[ENV_BASE[row.provider]] || undefined, sleep: deps.sleep });
  } catch (e) {
    failure = e instanceof AiError ? e : new AiError("provider_error", "Provider call failed");
  }
  const latencyMs = Math.max(0, now() - t0);

  // 7. usage + audit. A failed call is still recorded (zero tokens, counts as a call so a broken loop cannot hammer the vendor).
  const inTok = result?.inputTokens ?? 0, outTok = result?.outputTokens ?? 0;
  const cost = costMicroUsd(model, inTok, outTok);
  const auditId = uuid();
  const promptFull = [sysR, ...msgR].join("\n---\n");
  const promptStored = policy.storePrompts === "none" ? null
    : policy.storePrompts === "full" ? scrubSecretsText([system, ...req.messages.map((m) => m.content)].join("\n---\n")).slice(0, PROMPT_MAX * 2)
      : promptFull.slice(0, PROMPT_MAX * 2);
  const out = result ? result.text : null;
  const excerpt = policy.storePrompts === "none" ? null : (failure ? `[failed: ${failure.code}]` : (out ?? "")).slice(0, EXCERPT_MAX);
  try {
    await deps.store.insertUsage({ tenantId: who.tenantId, workspaceId: who.workspaceId, principalKind: who.principalKind, principalId: who.principalId, feature: req.feature, provider: row.provider, model, inputTokens: inTok, outputTokens: outTok, costMicroUsd: cost, latencyMs });
    await deps.store.insertAudit({ id: auditId, tenantId: who.tenantId, workspaceId: who.workspaceId, principalKind: who.principalKind, principalId: who.principalId, feature: req.feature, model, promptRedacted: promptStored, toolCalls: [], outputExcerpt: excerpt, sourceRefs: req.sourceRefs ?? [] });
  } catch {
    throw new AiError("audit_failed", "The AI call could not be recorded, so its output was discarded");
  }
  if (failure || !result) throw failure ?? new AiError("provider_error");
  return { text: result.text, provider: row.provider as ProviderId, model, inputTokens: inTok, outputTokens: outTok, costMicroUsd: cost, latencyMs, auditId, redactions: rd.count };
}
