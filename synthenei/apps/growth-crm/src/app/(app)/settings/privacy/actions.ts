"use server";
// Privacy mutations. Every action: zod-validates input, calls assertCan("privacy.fulfil") first (support sessions are blocked by the
// catalogue), has a demo branch that never touches Supabase, scopes every query to the caller's workspace, and writes an audit row with
// ids and counts only (never a name, email or message). Erasure goes through erase_lead on the owner's client; see lib/privacy/erasure.ts.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorFromPrincipal, audit } from "@/lib/audit/record";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { del, runErasure, reportNote, type ErasureReport } from "@/lib/privacy/erasure";
import { ownerRepo, RequestError } from "@/lib/privacy/owner";
import { captureConsent, CAPTURE_CHANNELS } from "@/lib/privacy/consent";
import { breachRepo, BREACH_SEVERITIES, BREACH_STATUSES } from "@/lib/privacy/breach";
import { OBJECT_RE, runRetention, supabaseRetentionPort, type PolicyOutcome } from "@/lib/privacy/retention";
import { CONSENT_PURPOSES, type RequestStatus } from "@/lib/privacy/types";
import { getPrT } from "@/lib/privacy/strings-server";
import { from } from "@/lib/db/query";
import { throwIfError } from "@/lib/db/errors";
import { fulfilCtx, type PrCtx } from "./_lib/ctx";

const ref = z.string().trim().min(1).max(64);
const uuid = z.string().uuid();
const note = z.string().trim().max(500);
const demoDone = async (): Promise<ActionResult> => okResult((await getPrT()).t("result.demo"));
const act = (c: PrCtx) => actorFromPrincipal(c.principal);
const known = async (e: unknown): Promise<ActionResult | null> => {
  const { t } = await getPrT();
  if (e instanceof RequestError) return failResult(e.code === "not_found" ? "not_found" : "invalid", t(e.code === "not_found" ? "result.notFound" : e.code === "bad_transition" ? "result.badTransition" : "result.leadNotFound"));
  return null;
};
const reval = () => { revalidatePath("/settings/privacy"); };

// ---------- requests ----------
const statusSchema = z.object({ id: ref, to: z.enum(["in_progress", "completed", "rejected"]), note: note.optional() });
export async function setRequestStatus(input: { id: string; to: "in_progress" | "completed" | "rejected"; note?: string }): Promise<ActionResult> {
  return runAction(async () => {
    const v = statusSchema.parse(input), c = await fulfilCtx(), { t } = await getPrT();
    if (c.demo || !c.db) return demoDone();
    uuid.parse(v.id);
    if (v.to === "rejected" && !v.note) return failResult("invalid", t("detail.rejectReason"));
    try {
      const r = await ownerRepo(c.db, c.ws).setStatus(v.id, v.to as RequestStatus, v.note);
      await audit(act(c), { action: "privacy.request_status", summary: `Privacy request moved to ${r.status}`, object: { table: "privacy_requests", id: v.id }, detail: { kind: r.kind, status: r.status } });
    } catch (e) { const k = await known(e); if (k) return k; throw e; }
    reval(); revalidatePath(`/settings/privacy/${v.id}`);
    return okResult(t("result.saved"));
  });
}

const noteSchema = z.object({ id: ref, note: z.string().trim().min(1).max(500) });
export async function addRequestNote(input: { id: string; note: string }): Promise<ActionResult> {
  return runAction(async () => {
    const v = noteSchema.parse(input), c = await fulfilCtx(), { t } = await getPrT();
    if (c.demo || !c.db) return demoDone();
    uuid.parse(v.id);
    try { await ownerRepo(c.db, c.ws).appendNote(v.id, v.note); } catch (e) { const k = await known(e); if (k) return k; throw e; }
    await audit(act(c), { action: "privacy.request_note", summary: "Note added to a privacy request", object: { table: "privacy_requests", id: v.id } });
    revalidatePath(`/settings/privacy/${v.id}`);
    return okResult(t("result.saved"));
  });
}

const linkSchema = z.object({ id: ref, leadId: ref });
export async function linkRequestLead(input: { id: string; leadId: string }): Promise<ActionResult> {
  return runAction(async () => {
    const v = linkSchema.parse(input), c = await fulfilCtx(), { t } = await getPrT();
    if (c.demo || !c.db) return demoDone();
    uuid.parse(v.id); uuid.parse(v.leadId);
    try { await ownerRepo(c.db, c.ws).linkLead(v.id, v.leadId); } catch (e) { const k = await known(e); if (k) return k; throw e; }
    await audit(act(c), { action: "privacy.request_linked", summary: "Privacy request linked to a record", object: { table: "privacy_requests", id: v.id }, detail: { leadId: v.leadId } });
    revalidatePath(`/settings/privacy/${v.id}`); reval();
    return okResult(t("result.saved"));
  });
}

/**
 * Access delivery (AUD-064, PRIV-023): a one-time, 24 hour link the owner hands to the data principal. The principal must type the address
 * they used for the request, the file downloads once, and every step is audited under the owner's name. A newer link cancels an older one.
 */
export async function createExportDelivery(requestId: string): Promise<ActionResult<{ url: string; expiresAt: string }>> {
  return runAction<{ url: string; expiresAt: string }>(async () => {
    const id = ref.parse(requestId), c = await fulfilCtx(), { t } = await getPrT();
    if (c.demo || !c.db) return okResult<{ url: string; expiresAt: string }>(t("result.demo"));
    uuid.parse(id);
    const { dsrDeps } = await import("@/lib/privacy/runtime");
    const { issueExportDelivery } = await import("@/lib/privacy/dsr");
    const base = (process.env.APP_BASE_URL ?? "").trim().replace(/\/+$/, "");
    const deps = { ...dsrDeps(), audit: async (e: { action: string; requestId: string | null; summary: string; detail?: Record<string, unknown> }) => {
      try { await audit(act(c), { action: e.action, summary: e.summary, object: { table: "privacy_requests", id: e.requestId ?? id }, detail: e.detail }); return true; } catch { return false; }
    } };
    const r = await issueExportDelivery(deps, { wsUuid: c.ws, requestId: id, createdBy: c.uid });
    if (r.status === "not_found") return failResult("not_found", t("result.notFound"));
    if (r.status === "not_access") return failResult("invalid", t("result.deliveryNotAccess"));
    if (r.status === "no_lead") return failResult("invalid", t("detail.delivery.needLead"));
    if (r.status === "closed") return failResult("conflict", t("result.deliveryClosed"));
    if (r.status !== "ok" || !base) return failResult("error", t("result.deliveryUnavailable"));
    revalidatePath(`/settings/privacy/${id}`);
    return okResult(t("result.deliveryIssued"), { data: { url: `${base}${r.path}`, expiresAt: r.expiresAt } });
  });
}

/** Erasure. Owner only (erase_lead enforces it again in the database), never in a support session. Returns the step report. */
export async function completeErasure(requestId: string): Promise<ActionResult<ErasureReport>> {
  return runAction<ErasureReport>(async () => {
    const id = ref.parse(requestId), c = await fulfilCtx(), { t } = await getPrT();
    if (c.demo || !c.db) return okResult<ErasureReport>(t("result.demo"));
    if (c.role !== "owner") return failResult("denied", t("result.notOwner"));
    uuid.parse(id);
    const repo = ownerRepo(c.db, c.ws);
    let req;
    try { req = await repo.get(id); } catch (e) { const k = await known(e); if (k) return k as ActionResult<ErasureReport>; throw e; }
    if (req.kind !== "erasure") return failResult("invalid", t("result.invalid"));
    if (req.status === "completed" || req.status === "rejected") return failResult("conflict", t("detail.closed"));
    if (!req.leadId) return failResult("invalid", t("detail.erasure.needLead"));
    if (req.status === "received") await repo.setStatus(id, "in_progress");
    const { serviceDb } = await import("@/lib/db/service");
    const report = await runErasure({
      user: c.db, svc: serviceDb(), workspaceId: c.ws,
      audit: async (action, summary, detail) => { await audit(act(c), { action, summary, object: { table: "privacy_requests", id }, detail }); },
    }, { requestId: id, leadId: req.leadId });
    if (report.complete) await repo.setStatus(id, "completed", reportNote(report)); else await repo.appendNote(id, reportNote(report));
    reval(); revalidatePath(`/settings/privacy/${id}`);
    return okResult(report.complete ? t("result.erased") : t("result.erasedPartial"), { data: report });
  });
}

// ---------- consent capture ----------
const consentSchema = z.object({
  leadId: ref, purpose: z.enum(CONSENT_PURPOSES), action: z.enum(["granted", "withdrawn"]), via: z.enum(CAPTURE_CHANNELS), note: note.optional(), noticeVersion: z.string().trim().min(1).max(40).optional(),
});
export async function captureConsentAction(input: z.input<typeof consentSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const v = consentSchema.parse(input), c = await fulfilCtx(), { t } = await getPrT();
    if (c.demo || !c.db) return demoDone();
    uuid.parse(v.leadId);
    // The row cites the text of the notice the workspace publishes now (version + hash). If it cannot be resolved the label is all we keep.
    const { serviceDb } = await import("@/lib/db/service");
    const { currentNotice } = await import("@/lib/privacy/notice-registry");
    const notice = await currentNotice(serviceDb(), c.ws);
    await captureConsent(c.db, c.ws, c.uid, { leadId: v.leadId, purpose: v.purpose, action: v.action, via: v.via, noticeVersion: v.noticeVersion ?? notice?.version ?? "v1", note: v.note, evidence: { noticeSha256: v.noticeVersion ? null : (notice?.sha256 ?? null) } });
    await audit(act(c), { action: "privacy.consent_captured", summary: `Consent ${v.action} recorded by a team member`, object: { table: "leads", id: v.leadId }, detail: { purpose: v.purpose, via: v.via } });
    revalidatePath("/settings/privacy");
    return okResult(t("result.saved"));
  });
}

// ---------- retention ----------
const ruleSchema = z.object({ objectType: z.string().trim().regex(OBJECT_RE), days: z.number().int().min(1).max(3650), action: z.enum(["anonymise", "delete"]) });
export async function saveRetentionRule(input: z.input<typeof ruleSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const v = ruleSchema.parse(input), c = await fulfilCtx(), { t } = await getPrT();
    if (c.demo || !c.db) return demoDone();
    const u = await from(c.db, "retention_policies").update({ days: v.days, action: v.action }).eq("tenant_id", c.tenant).eq("object_type", v.objectType).select("object_type");
    throwIfError(u.error);
    if (!((u.data as unknown[] | null) ?? []).length) { const i = await from(c.db, "retention_policies").insert({ tenant_id: c.tenant, object_type: v.objectType, days: v.days, action: v.action }).select("object_type"); throwIfError(i.error); }
    await audit(act(c), { action: "privacy.retention_rule_saved", summary: `Retention rule saved for ${v.objectType}`, object: { table: "retention_policies", id: v.objectType }, detail: { days: v.days, action: v.action } });
    revalidatePath("/settings/privacy/retention");
    return okResult(t("result.saved"));
  });
}

export async function removeRetentionRule(objectType: string): Promise<ActionResult> {
  return runAction(async () => {
    const o = z.string().trim().regex(OBJECT_RE).parse(objectType), c = await fulfilCtx(), { t } = await getPrT();
    if (c.demo || !c.db) return demoDone();
    const r = await del(c.db, "retention_policies").eq("tenant_id", c.tenant).eq("object_type", o).select("object_type");
    if (r.error) throw new Error("retention rule delete failed");
    await audit(act(c), { action: "privacy.retention_rule_removed", summary: `Retention rule removed for ${o}`, object: { table: "retention_policies", id: o } });
    revalidatePath("/settings/privacy/retention");
    return okResult(t("result.saved"));
  });
}

/** Dry run: counts rows older than each of this tenant's rules and changes nothing. */
export async function planRetention(): Promise<ActionResult<PolicyOutcome[]>> {
  return runAction<PolicyOutcome[]>(async () => {
    const c = await fulfilCtx(), { t } = await getPrT();
    if (c.demo || !c.db) return okResult<PolicyOutcome[]>(t("result.demo"), { data: [{ objectType: "lead", tenantId: "demo", kind: "anonymise", cutoff: new Date().toISOString(), matched: 12, changed: 0, capped: false }] });
    const { serviceDb } = await import("@/lib/db/service");
    const out = await runRetention(supabaseRetentionPort(serviceDb()), { mode: "plan", tenantId: c.tenant, now: Date.now(), deadline: Date.now() + 20_000 });
    await audit(act(c), { action: "privacy.retention_plan_run", summary: "Retention dry run", detail: { policies: out.length, matched: out.reduce((n, o) => n + o.matched, 0) } });
    return okResult<PolicyOutcome[]>(t("result.saved"), { data: out });
  });
}

// ---------- breach register ----------
const validDate = (d: string) => d.length >= 10 && !Number.isNaN(new Date(d).getTime());
const breachSchema = z.object({
  detectedAt: z.string().trim().max(40).refine(validDate), occurredAt: z.string().trim().max(40).refine((d) => d === "" || validDate(d)).optional(), summary: z.string().trim().min(5).max(2000),
  categories: z.array(z.string().trim().min(1).max(60)).max(20), affectedCount: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  severity: z.enum(BREACH_SEVERITIES), remediation: z.string().trim().max(2000).optional(),
});
const asIso = (s: string): string => new Date(s).toISOString();
export async function addBreach(input: z.input<typeof breachSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const v = breachSchema.parse(input), c = await fulfilCtx(), { t } = await getPrT();
    if (c.demo || !c.db) return demoDone();
    const id = await breachRepo(c.db, c.ws).add({ detectedAt: asIso(v.detectedAt), occurredAt: v.occurredAt ? asIso(v.occurredAt) : null, summary: v.summary, categories: v.categories, affectedCount: v.affectedCount ?? null, severity: v.severity, remediation: v.remediation ?? null });
    await audit(act(c), { action: "privacy.breach_recorded", summary: "Personal-data breach recorded", object: { table: "breach_register", id }, detail: { severity: v.severity, affected: v.affectedCount ?? null } });
    revalidatePath("/settings/privacy/breaches");
    return okResult(t("result.saved"));
  });
}

const breachUpdate = z.object({ id: ref, status: z.enum(BREACH_STATUSES).optional(), boardNotified: z.boolean().optional(), individualsNotified: z.boolean().optional(), remediation: z.string().trim().max(2000).optional() });
export async function updateBreach(input: z.input<typeof breachUpdate>): Promise<ActionResult> {
  return runAction(async () => {
    const v = breachUpdate.parse(input), c = await fulfilCtx(), { t } = await getPrT();
    if (c.demo || !c.db) return demoDone();
    uuid.parse(v.id);
    const now = new Date().toISOString();
    await breachRepo(c.db, c.ws).update(v.id, {
      ...(v.status ? { status: v.status } : {}), ...(v.boardNotified ? { boardNotifiedAt: now } : {}),
      ...(v.individualsNotified ? { individualsNotifiedAt: now } : {}), ...(v.remediation !== undefined ? { remediation: v.remediation } : {}),
    });
    await audit(act(c), { action: "privacy.breach_updated", summary: "Breach register entry updated", object: { table: "breach_register", id: v.id }, detail: { status: v.status ?? null, board: !!v.boardNotified, individuals: !!v.individualsNotified } });
    revalidatePath("/settings/privacy/breaches");
    return okResult(t("result.saved"));
  });
}
