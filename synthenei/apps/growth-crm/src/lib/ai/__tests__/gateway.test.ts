// Gateway pipeline with fake ports: off by default, caps before every call, redaction before the provider, usage + audit for every call,
// no output without an audit row, BYOK vs platform key, model allow-list. No network, no database.
import { describe, expect, it, vi } from "vitest";
import { pickModel, pickProvider, runAi } from "../gateway";
import { costMicroUsd, defaultModel, modelDef, MODELS } from "../models";
import { AiError, type AiRequest, type AiStore, type CapStatus, type GatewayDeps, type PolicyRow, type ProviderAdapter, type ProviderRow, type UsageRow, type AuditRow } from "../types";

const WHO = { tenantId: "t1", workspaceId: "w1", principalKind: "user" as const, principalId: "u1" };
const POLICY: PolicyRow = { tenantId: "t1", monthlyCallCap: null, monthlyTokenCap: null, perUserDailyCap: null, piiRedaction: true, storePrompts: "redacted", features: { reply_draft: true } };
const OK_CAPS: CapStatus = { allowed: true, reason: null, usage: { calls_month: 3, tokens_month: 1000, user_calls_today: 1 }, caps: { monthly_call_cap: 100, monthly_token_cap: 100000, per_user_daily_cap: 20, plan_calls: null } };
const REQ: AiRequest = { feature: "reply_draft", system: "Draft a reply.", messages: [{ role: "user", content: "Customer asha@example.com, call +91 98765 43210, PAN ABCDE1234F, asks about timing." }], maxTokens: 300 };

function rig(over: { policy?: Partial<PolicyRow> | null; providers?: ProviderRow[]; caps?: CapStatus | null; key?: { key: string; byok: boolean } | null; adapter?: ProviderAdapter["complete"]; failInsert?: "usage" | "audit" } = {}) {
  const usage: UsageRow[] = [], audits: AuditRow[] = [];
  const complete = vi.fn(over.adapter ?? (async (r) => ({ text: "Sure, I can help.", inputTokens: 100, outputTokens: 20, model: r.model, stopReason: "end_turn" })));
  const store: AiStore = {
    getPolicy: async () => (over.policy === null ? null : { ...POLICY, ...over.policy }),
    listProviders: async () => over.providers ?? [],
    capStatus: async () => (over.caps === undefined ? OK_CAPS : over.caps),
    insertUsage: async (r) => { if (over.failInsert === "usage") throw new Error("x"); usage.push(r); },
    insertAudit: async (r) => { if (over.failInsert === "audit") throw new Error("x"); audits.push(r); },
  };
  const deps: GatewayDeps = {
    store, keys: { resolve: async () => (over.key === undefined ? { key: "k-platform", byok: false } : over.key) },
    adapter: () => ({ id: "anthropic", complete }), fetchImpl: vi.fn() as unknown as typeof fetch, env: {}, uuid: () => "audit-1",
  };
  return { deps, usage, audits, complete };
}

describe("models", () => {
  it("uses the exact catalogue ids and defaults to Anthropic tiers", () => {
    expect(MODELS.filter((m) => m.provider === "anthropic").map((m) => m.id).sort()).toEqual(["claude-haiku-5-5", "claude-opus-5-5", "claude-sonnet-5-5"]);
    expect(defaultModel("anthropic", "draft")).toBe("claude-sonnet-5-5");
    expect(defaultModel("anthropic", "fast")).toBe("claude-haiku-5-5");
    expect(defaultModel("anthropic", "deep")).toBe("claude-opus-5-5");
    expect(defaultModel("openai", "deep")).toBe("gpt-4.1");   // no deep model: falls back to the draft model
    expect(modelDef("nope")).toBeNull();
  });
  it("costs in micro-USD from per-million prices", () => {
    expect(costMicroUsd("claude-sonnet-5-5", 1_000_000, 0)).toBe(3_000_000);
    expect(costMicroUsd("unknown", 10, 10)).toBe(0);
  });
});

describe("provider and model choice", () => {
  it("no rows = platform Anthropic; Anthropic wins when enabled; all disabled = no provider", () => {
    expect(pickProvider([])).toMatchObject({ provider: "anthropic", hasSecret: false });
    const rows: ProviderRow[] = [{ provider: "openai", defaultModel: null, allowedModels: [], enabled: true, hasSecret: true }, { provider: "anthropic", defaultModel: null, allowedModels: [], enabled: true, hasSecret: false }];
    expect(pickProvider(rows)?.provider).toBe("anthropic");
    expect(pickProvider(rows.map((r) => ({ ...r, enabled: r.provider === "openai" })))?.provider).toBe("openai");
    expect(pickProvider(rows.map((r) => ({ ...r, enabled: false })))).toBeNull();
  });
  it("applies the tenant allow-list and rejects a model of another provider", () => {
    const base: ProviderRow = { provider: "anthropic", defaultModel: null, allowedModels: [], enabled: true, hasSecret: false };
    expect(pickModel(base, "fast")).toBe("claude-haiku-5-5");
    expect(pickModel({ ...base, allowedModels: ["claude-opus-5-5"] }, "fast")).toBe("claude-opus-5-5");
    expect(() => pickModel({ ...base, allowedModels: ["gpt-4.1"] }, "fast")).toThrow(AiError);
    expect(() => pickModel({ ...base, defaultModel: "gpt-4.1" })).toThrow(AiError);
  });
});

describe("runAi", () => {
  it("is off by default: no feature flag, no call, no usage row", async () => {
    const r = rig({ policy: { features: {} } });
    await expect(runAi(r.deps, WHO, REQ)).rejects.toMatchObject({ code: "feature_off" });
    expect(r.complete).not.toHaveBeenCalled();
    expect(r.usage).toHaveLength(0);
    const r2 = rig({ policy: { features: { reply_draft: false } } });
    await expect(runAi(r2.deps, WHO, REQ)).rejects.toMatchObject({ code: "feature_off" });
  });

  it("fails closed when the policy cannot be read", async () => {
    const r = rig({ policy: null });
    await expect(runAi(r.deps, WHO, REQ)).rejects.toMatchObject({ code: "policy_unavailable" });
    expect(r.complete).not.toHaveBeenCalled();
  });

  it("blocks before the provider when a cap is reached, whatever the allowed flag says", async () => {
    for (const caps of [
      { ...OK_CAPS, allowed: false, reason: "monthly_calls" },
      { ...OK_CAPS, caps: { ...OK_CAPS.caps, monthly_call_cap: 3 } },                 // allowed:true but numbers say exceeded
      { ...OK_CAPS, caps: { ...OK_CAPS.caps, per_user_daily_cap: 1 } },
      { ...OK_CAPS, caps: { ...OK_CAPS.caps, monthly_token_cap: 1000 } },             // 1000 used + estimate > cap
      null,
    ] as (CapStatus | null)[]) {
      const r = rig({ caps });
      await expect(runAi(r.deps, WHO, REQ)).rejects.toMatchObject({ code: "cap_reached" });
      expect(r.complete).not.toHaveBeenCalled();
      expect(r.usage).toHaveLength(0);
    }
  });

  it("redacts phone, email and ID numbers before the provider sees the prompt, and reports the count", async () => {
    const r = rig();
    const out = await runAi(r.deps, WHO, REQ);
    const sent = r.complete.mock.calls[0][0];
    const text = JSON.stringify(sent);
    expect(text).not.toMatch(/asha@example|98765|ABCDE1234F/);
    expect(text).toContain("[email]");
    expect(text).toContain("[phone]");
    expect(out.redactions).toBeGreaterThanOrEqual(3);
  });

  it("writes one usage row and one audit row per call, with tokens, cost, redacted prompt and source refs", async () => {
    const r = rig();
    const out = await runAi(r.deps, WHO, { ...REQ, sourceRefs: [{ kind: "conversation", id: "c1" }] });
    expect(r.usage).toEqual([expect.objectContaining({ tenantId: "t1", workspaceId: "w1", principalId: "u1", feature: "reply_draft", provider: "anthropic", model: "claude-sonnet-5-5", inputTokens: 100, outputTokens: 20, costMicroUsd: 600 })]);
    expect(r.audits).toHaveLength(1);
    expect(r.audits[0]).toMatchObject({ id: "audit-1", feature: "reply_draft", model: "claude-sonnet-5-5", outputExcerpt: "Sure, I can help.", sourceRefs: [{ kind: "conversation", id: "c1" }] });
    expect(r.audits[0].promptRedacted).not.toMatch(/asha@example|98765/);
    expect(out).toMatchObject({ text: "Sure, I can help.", auditId: "audit-1", provider: "anthropic" });
  });

  it("store_prompts: none drops prompt and output text; full keeps the prompt but still removes keys", async () => {
    const none = rig({ policy: { storePrompts: "none" } });
    await runAi(none.deps, WHO, REQ);
    expect(none.audits[0]).toMatchObject({ promptRedacted: null, outputExcerpt: null });
    const full = rig({ policy: { storePrompts: "full" } });
    await runAi(full.deps, WHO, { ...REQ, messages: [{ role: "user", content: "token=abc123secretvalue please reply" }] });
    expect(full.audits[0].promptRedacted).toContain("please reply");
    expect(full.audits[0].promptRedacted).not.toContain("abc123secretvalue");
  });

  it("records a failed provider call (zero tokens, counts as a call) and still raises the error", async () => {
    const r = rig({ adapter: async () => { throw new AiError("rate_limited", "busy"); } });
    await expect(runAi(r.deps, WHO, REQ)).rejects.toMatchObject({ code: "rate_limited" });
    expect(r.usage).toEqual([expect.objectContaining({ inputTokens: 0, outputTokens: 0, costMicroUsd: 0 })]);
    expect(r.audits[0].outputExcerpt).toBe("[failed: rate_limited]");
  });

  it("discards the output when usage or audit cannot be written (no audit row, no output)", async () => {
    for (const failInsert of ["usage", "audit"] as const) {
      const r = rig({ failInsert });
      await expect(runAi(r.deps, WHO, REQ)).rejects.toMatchObject({ code: "audit_failed" });
    }
  });

  it("needs a key: no key, no call; a tenant with only a disabled provider gets no provider", async () => {
    const r = rig({ key: null });
    await expect(runAi(r.deps, WHO, REQ)).rejects.toMatchObject({ code: "no_key" });
    expect(r.complete).not.toHaveBeenCalled();
    const r2 = rig({ providers: [{ provider: "anthropic", defaultModel: null, allowedModels: [], enabled: false, hasSecret: true }] });
    await expect(runAi(r2.deps, WHO, REQ)).rejects.toMatchObject({ code: "no_provider" });
  });

  it("passes the resolved key to the adapter but never into usage, audit or the result", async () => {
    const r = rig({ key: { key: "k-byok-secret-value", byok: true } });
    const out = await runAi(r.deps, WHO, REQ);
    expect(r.complete.mock.calls[0][1].apiKey).toBe("k-byok-secret-value");
    expect(JSON.stringify([r.usage, r.audits, out])).not.toContain("k-byok-secret-value");
  });

  it("uses the tier's model and an Anthropic fast model for summaries", async () => {
    const r = rig({ policy: { features: { lead_summary: true } } });
    await runAi(r.deps, WHO, { ...REQ, feature: "lead_summary", tier: "fast" });
    expect(r.complete.mock.calls[0][0].model).toBe("claude-haiku-5-5");
  });
});
