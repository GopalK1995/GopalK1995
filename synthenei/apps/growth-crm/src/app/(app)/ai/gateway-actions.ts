"use server";
// AI gateway actions (T050). Every one: zod-validates, asserts the permission (ai.use to run, ai.toggle to configure; support sessions
// are blocked from toggling by the catalogue), has a demo branch that never calls a model, and sends every model call through runAi().
// Nothing here accepts a cap, a key, a model or a prompt from the client: prompts are built on the server from records read under the
// caller's JWT, and caps come from ai_policies / ai_cap_status.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getT } from "@/i18n/server";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { actorFromPrincipal, audit } from "@/lib/audit/record";
import { from } from "@/lib/db/query";
import { throwIfError } from "@/lib/db/errors";
import { serviceDb } from "@/lib/db/service";
import { supabaseVault } from "@/lib/connectors/core/vault";
import { modelDef } from "@/lib/ai/models";
import { AiError, PROVIDER_IDS, isFeature } from "@/lib/ai/types";
import { ASK_VIEWS, ASK_ROW_LIMIT, askCrmRequest, isAskView, leadSummaryRequest, nextBestActionRequest, parseNba, parseReplyDraft, parseSummary, replyDraftRequest, type AskView } from "@/lib/ai/features";
import { aiCtx, aiErrorMessage, call, isDemo, loadLeadFacts, loadThread, type AiCtx } from "@/lib/ai/server";
import { windowState } from "../inbox/_lib/window";

type T = Awaited<ReturnType<typeof getT>>;
const fail = <D,>(e: unknown, t: T): ActionResult<D> => {
  const m = aiErrorMessage(e, t as never);
  return failResult<D>(m.code === "feature_off" || m.code === "cap_reached" ? "denied" : "error", m.message, { sub: m.sub });
};
/** Runs a gateway-backed body: demo sessions get the showcase notice, gateway errors become plain messages, everything else goes through runAction. */
async function run<D>(perm: "ai.use" | "ai.toggle", body: (c: AiCtx, t: T) => Promise<ActionResult<D>>): Promise<ActionResult<D>> {
  const t = await getT("ai");
  return runAction(async () => {
    const c = await aiCtx(perm);
    if (isDemo(c)) return okResult<D>(t("demoNotice"));
    try { return await body(c, t); } catch (e) { if (e instanceof AiError) return fail<D>(e, t); throw e; }
  });
}
const idSchema = z.string().uuid();
const ymd = (d: Date) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10); // IST calendar day

// ---------------------------------------------------------------- features
export interface ReplyDraftOut { body: string; needsReview: boolean; model: string; auditId: string }
export async function draftReply(conversationId: string, lang: "en" | "ta"): Promise<ActionResult<ReplyDraftOut>> {
  return run("ai.use", async (c, t) => {
    const p = z.object({ id: idSchema, lang: z.enum(["en", "ta"]) }).parse({ id: conversationId, lang });
    const cv = await loadThread(c, p.id);
    if (!cv) return failResult("not_found", t("err.noConversation"));
    if (!cv.thread.length) return failResult("invalid", t("err.emptyThread"));
    const win = windowState(cv.channel, cv.lastInboundAt, new Date());
    const r = await call(c, replyDraftRequest({ lang: p.lang, firstName: cv.firstName, channel: cv.channel, stage: cv.stage, windowOpen: win.open, thread: cv.thread }));
    const d = parseReplyDraft(r.text, p.lang);
    return okResult(t("draftReady"), { data: { body: d.body, needsReview: d.needsReview, model: r.model, auditId: r.auditId } });
  });
}

export async function generateLeadSummary(leadId: string): Promise<ActionResult<{ bullets: string[]; model: string }>> {
  return run("ai.use", async (c, t) => {
    const facts = await loadLeadFacts(c, idSchema.parse(leadId));
    if (!facts) return failResult("not_found", t("err.noLead"));
    const r = await call(c, { ...leadSummaryRequest(facts), sourceRefs: [{ kind: "lead", id: leadId }] });
    return okResult(t("summaryReady"), { data: { bullets: parseSummary(r.text), model: r.model } });
  });
}

export interface NbaOut { action: string; reason: string; due: string; factors: string[]; model: string }
export async function generateNextAction(leadId: string): Promise<ActionResult<NbaOut>> {
  return run("ai.use", async (c, t) => {
    const facts = await loadLeadFacts(c, idSchema.parse(leadId));
    if (!facts) return failResult("not_found", t("err.noLead"));
    const r = await call(c, { ...nextBestActionRequest(facts), sourceRefs: [{ kind: "lead", id: leadId }] });
    const n = parseNba(r.text);
    return okResult(t("nbaReady"), { data: { action: n.action, reason: n.reason, due: ymd(new Date(Date.now() + n.dueInDays * 86400e3)), factors: n.factors, model: r.model } });
  });
}

export interface AskOut { answer: string; views: AskView[]; model: string }
/** Ask-the-CRM over the approved summary views only: the model never sees a table, a lead row or a message. */
export async function askCrmGateway(question: string): Promise<ActionResult<AskOut>> {
  return run("ai.use", async (c, t) => {
    const q = z.string().trim().min(3).max(300).parse(question);
    const data: { view: AskView; rows: Record<string, unknown>[] }[] = [];
    for (const view of Object.keys(ASK_VIEWS)) {
      if (!isAskView(view)) continue;
      const r = await from(c.db, view).select("*").eq("workspace_id", c.wsId).limit(ASK_ROW_LIMIT); // views filter by role inside (a rep gets no team rows)
      if (r.error) continue; // a view the caller cannot read is simply not part of the answer
      const rows = ((r.data as Record<string, unknown>[]) ?? []).map(({ workspace_id: _w, ...rest }) => rest);
      if (rows.length) data.push({ view, rows });
    }
    if (!data.length) return failResult("invalid", t("err.noViewData"));
    const r = await call(c, askCrmRequest(q, data));
    return okResult(t("askReady"), { data: { answer: r.text.trim(), views: data.map((d) => d.view), model: r.model } });
  });
}

// ---------------------------------------------------------------- settings (ai.toggle, owners; blocked in support sessions)
async function record(c: AiCtx, action: string, summary: string, detail: Record<string, unknown>) {
  await audit(actorFromPrincipal(c.principal), { action, summary, object: { table: "ai_policies", id: c.tenantId }, detail });
}
const touch = (c: AiCtx) => ({ updated_at: new Date().toISOString(), updated_by: c.uid });

export async function setFeature(key: string, on: boolean, terms: string[]): Promise<ActionResult> {
  return run("ai.toggle", async (c, t) => {
    const p = z.object({ key: z.string().refine(isFeature), on: z.boolean(), terms: z.array(z.string().max(300)).max(10) }).parse({ key, on, terms });
    if (p.on && p.terms.length < 3) return failResult("invalid", t("err.tickChecks"));
    const cur = await from(c.db, "ai_policies").select("features").eq("tenant_id", c.tenantId).maybeSingle();
    throwIfError(cur.error);
    const features = { ...((cur.data as { features?: Record<string, boolean> } | null)?.features ?? {}), [p.key]: p.on };
    const r = cur.data
      ? await from(c.db, "ai_policies").update({ features, ...touch(c) }).eq("tenant_id", c.tenantId)
      : await from(c.db, "ai_policies").insert({ tenant_id: c.tenantId, features, ...touch(c) });
    throwIfError(r.error);
    await record(c, "ai.feature", `AI feature ${p.key} turned ${p.on ? "on" : "off"}`, { feature: p.key, on: p.on, checks: p.terms.length });
    revalidatePath("/ai");
    return okResult(t(p.on ? "featureOn" : "featureOff", { name: t(`feature.${p.key}`) }), { sub: t("saved") });
  });
}

const capN = (max: number) => z.union([z.literal(""), z.null(), z.coerce.number().int().min(0).max(max)]).transform((v) => (v === "" || v === null ? null : v));
const policySchema = z.object({
  monthlyCallCap: capN(10_000_000), monthlyTokenCap: capN(10_000_000_000), perUserDailyCap: capN(100_000),
  piiRedaction: z.boolean(), storePrompts: z.enum(["none", "redacted", "full"]),
});
export type PolicyInput = z.input<typeof policySchema>;
export async function savePolicy(input: PolicyInput): Promise<ActionResult> {
  return run("ai.toggle", async (c, t) => {
    const p = policySchema.parse(input);
    const row = { monthly_call_cap: p.monthlyCallCap, monthly_token_cap: p.monthlyTokenCap, per_user_daily_cap: p.perUserDailyCap, pii_redaction: p.piiRedaction, store_prompts: p.storePrompts, ...touch(c) };
    const cur = await from(c.db, "ai_policies").select("tenant_id").eq("tenant_id", c.tenantId).maybeSingle();
    throwIfError(cur.error);
    const r = cur.data ? await from(c.db, "ai_policies").update(row).eq("tenant_id", c.tenantId) : await from(c.db, "ai_policies").insert({ tenant_id: c.tenantId, ...row });
    throwIfError(r.error);
    await record(c, "ai.policy", "AI limits and privacy settings changed", { caps: [p.monthlyCallCap, p.monthlyTokenCap, p.perUserDailyCap], piiRedaction: p.piiRedaction, storePrompts: p.storePrompts });
    revalidatePath("/ai");
    return okResult(t("policySaved"), { sub: t("saved") });
  });
}

const providerSchema = z.object({
  provider: z.enum(PROVIDER_IDS as unknown as [string, ...string[]]), enabled: z.boolean(),
  defaultModel: z.string().max(80).nullable(), allowedModels: z.array(z.string().max(80)).max(20),
});
export async function saveProvider(input: z.input<typeof providerSchema>): Promise<ActionResult> {
  return run("ai.toggle", async (c, t) => {
    const p = providerSchema.parse(input);
    const own = (m: string) => modelDef(m)?.provider === p.provider;
    if ((p.defaultModel && !own(p.defaultModel)) || p.allowedModels.some((m) => !own(m))) return failResult("invalid", t("err.badModel"));
    const row = { default_model: p.defaultModel, allowed_models: p.allowedModels, enabled: p.enabled };
    const cur = await from(c.db, "ai_providers").select("id").eq("tenant_id", c.tenantId).eq("provider", p.provider).maybeSingle();
    throwIfError(cur.error);
    const r = cur.data ? await from(c.db, "ai_providers").update({ ...row, updated_at: new Date().toISOString() }).eq("tenant_id", c.tenantId).eq("provider", p.provider)
      : await from(c.db, "ai_providers").insert({ tenant_id: c.tenantId, provider: p.provider, ...row });
    throwIfError(r.error);
    await record(c, "ai.provider", `AI provider ${p.provider} ${p.enabled ? "enabled" : "disabled"}`, { provider: p.provider, enabled: p.enabled, defaultModel: p.defaultModel, allowed: p.allowedModels.length });
    revalidatePath("/ai");
    return okResult(t("providerSaved"), { sub: t("saved") });
  });
}

/** BYOK: the key goes straight to the Vault and only its secret id is stored (by the service role: clients cannot write secret_id). It is never returned or logged. */
export async function saveByok(provider: string, apiKey: string): Promise<ActionResult> {
  return run("ai.toggle", async (c, t) => {
    const p = z.object({ provider: z.enum(PROVIDER_IDS as unknown as [string, ...string[]]), key: z.string().trim().min(16).max(400).regex(/^[\w.~+/=-]+$/) }).safeParse({ provider, key: apiKey });
    if (!p.success) return failResult("invalid", t("err.badKey"));
    const exists = await from(c.db, "ai_providers").select("id").eq("tenant_id", c.tenantId).eq("provider", p.data.provider).maybeSingle();
    throwIfError(exists.error);
    if (!exists.data) { const ins = await from(c.db, "ai_providers").insert({ tenant_id: c.tenantId, provider: p.data.provider, enabled: true, allowed_models: [] }); throwIfError(ins.error); }
    const admin = serviceDb();
    const prev = await from(admin, "ai_providers").select("secret_id").eq("tenant_id", c.tenantId).eq("provider", p.data.provider).maybeSingle();
    const vault = supabaseVault(admin);
    const id = await vault.putSecret(`ai:${c.tenantId}:${p.data.provider}:${Date.now().toString(36)}`, p.data.key);
    const up = await from(admin, "ai_providers").update({ secret_id: id, updated_at: new Date().toISOString() }).eq("tenant_id", c.tenantId).eq("provider", p.data.provider);
    if (up.error) { await vault.deleteSecret(id).catch(() => undefined); throw new AiError("invalid", "key not stored"); }
    const old = (prev.data as { secret_id?: string | null } | null)?.secret_id;
    if (old) await vault.deleteSecret(old).catch(() => undefined);
    await record(c, "ai.key", `AI key stored for ${p.data.provider}`, { provider: p.data.provider, replaced: !!old }); // the key itself is never part of the audit detail
    revalidatePath("/ai");
    return okResult(t("keySaved"), { sub: t("keyNeverShown") });
  });
}

export async function removeByok(provider: string): Promise<ActionResult> {
  return run("ai.toggle", async (c, t) => {
    const p = z.enum(PROVIDER_IDS as unknown as [string, ...string[]]).parse(provider);
    const admin = serviceDb();
    const prev = await from(admin, "ai_providers").select("secret_id").eq("tenant_id", c.tenantId).eq("provider", p).maybeSingle();
    const sid = (prev.data as { secret_id?: string | null } | null)?.secret_id;
    if (!sid) return okResult(t("keyRemoved"));
    const up = await from(admin, "ai_providers").update({ secret_id: null, updated_at: new Date().toISOString() }).eq("tenant_id", c.tenantId).eq("provider", p);
    throwIfError(up.error);
    await supabaseVault(admin).deleteSecret(sid).catch(() => undefined);
    await record(c, "ai.key", `AI key removed for ${p}`, { provider: p });
    revalidatePath("/ai");
    return okResult(t("keyRemoved"));
  });
}
