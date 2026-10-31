"use server";
// Marketing mutations. Real sessions: assertCan -> repository write with expected version -> ActionResult. Campaign audit rows and
// campaign.* events come from DB triggers (0014), so "saved" is only returned after the commit. Segment evaluation runs through the
// request client (RLS) and every marketing export/push is filtered by public.can_contact(). NO ad-platform push exists here.
// Demo sessions never touch Supabase: each action validates and says what would have happened (showcase behaviour kept).
import { pageCtx } from "@/lib/data/context";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { vocabFor } from "@/lib/vertical";
import { assertCan } from "@/lib/authz/load";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { DbError } from "@/lib/db/errors";
import { dbForRequest } from "@/lib/db/client";
import { campaignsRepo } from "@/lib/db/repo/campaigns";
import { metricsRepo, segmentsRepo } from "@/lib/segments/repo";
import * as P from "@/lib/segments/persist";
import { compileRules } from "@/lib/segments/compile";
import { countSegment, segmentLeadIds, segmentRows } from "@/lib/segments/query";
import { CONSENT_CAP, consentedIds, purposeFor, rpcCanContact, summarize, type SegmentSize } from "@/lib/segments/consent";
import { MAX_CSV_BYTES, MAX_CSV_ROWS, previewMetricsCsv, type MetricsPreview } from "@/lib/segments/metrics-csv";
import { createCampaignSchema, editCampaignSchema, metricsEntrySchema, noteSchema, saveSegmentSchema, statusSchema, updateSegmentSchema } from "@/lib/segments/schemas";
import { canMkt, type MktAction } from "./_lib/perm";
import { tc } from "./_lib/strings";

type Ctx = Awaited<ReturnType<typeof pageCtx>>;
export type { ActionResult };
const PREVIEW_CAP = 500;
const repos: P.Repos = { campaigns: campaignsRepo, segments: segmentsRepo, metrics: metricsRepo };
const pctx = (c: Ctx): P.Ctx => ({ ws: c.active.ws.uuid, uid: c.session.uid, now: new Date(), repos });
const campRec = (c: Ctx, id: string, ownerId: string | null) => ({ type: "campaign" as const, id, workspaceId: c.active.ws.id, ownerId });
const invalid = (e: { issues: { path: PropertyKey[]; message: string }[] }): ActionResult =>
  failResult("invalid", e.issues[0]?.message ?? "Some values are not valid.", { issues: e.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) });

/** Real-mode wrapper: AuthzError -> denied, DbError -> code; a conflict carries only the current version, never the row. */
async function real<T>(c: Ctx, what: string, fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const t = tc(vocabFor(c.active.tenant));
  const r = await runAction(fn);
  if (r.ok) return r;
  if (r.code === "denied") return { ...r, message: t("deniedTitle"), sub: c.support ? t("deniedSupport") : undefined };
  if (r.code === "conflict") {
    const v = (r.current as { version?: number } | undefined)?.version;
    return { ...r, message: t("conflictTitle", { what }), sub: t("conflictBody"), current: v === undefined ? undefined : { version: v } };
  }
  if (r.code === "not_found") return { ...r, message: t("notFound") };
  if (r.code === "error") return { ...r, message: t("errorTitle"), sub: t("errorBody") };
  return r;
}

/** Demo guard: role permission (support-aware) + the demo workspace's own data. */
function demoDeny(c: Ctx, action: MktAction): ActionResult | null {
  const t = tc(vocabFor(c.active.tenant));
  if (canMkt(action, { role: c.role, support: c.support })) return null;
  return failResult("denied", c.support ? t("deniedSupport") : `Your role (${ROLE_LABEL[c.role]}) cannot do this.`);
}
const demoSub = (c: Ctx) => tc(vocabFor(c.active.tenant))("demoNotice");

async function realCampaign(c: Ctx, perm: string, id: string) {
  const row = await campaignsRepo.get(c.active.ws.uuid, id);
  if (!row) throw new DbError("not_found", "not_found");
  await assertCan(perm, campRec(c, row.id, row.ownerId));
  return row;
}

// ---------- campaigns ----------
export async function createCampaign(input: unknown): Promise<ActionResult<{ id: string; version: number }>> {
  const c = await pageCtx();
  const t = tc(vocabFor(c.active.tenant));
  const p = createCampaignSchema.safeParse(input);
  if (c.session.demo) {
    const d = demoDeny(c, "editCampaigns");
    if (d) return d as ActionResult<{ id: string; version: number }>;
    if (!p.success) return invalid(p.error) as ActionResult<{ id: string; version: number }>;
    return okResult(`"${p.data.name}" would be created in ${c.active.ws.name}`, { sub: demoSub(c) });
  }
  return real(c, "campaign", async () => {
    await assertCan("campaigns.write", campRec(c, "", c.session.uid));
    if (!p.success) return invalid(p.error) as ActionResult<{ id: string; version: number }>;
    const r = await P.createCampaign(pctx(c), p.data, { created: (name) => t("campaignCreated", { name }) });
    return r.ok ? { ...r, sub: t("campaignCreatedSub"), data: r.data && { id: r.data.id, version: r.data.version } } : r;
  });
}

export async function editCampaign(id: string, patch: unknown, expectedVersion?: number): Promise<ActionResult<{ version: number }>> {
  const c = await pageCtx();
  const t = tc(vocabFor(c.active.tenant));
  const p = editCampaignSchema.safeParse({ expectedVersion, patch });
  if (c.session.demo) {
    const d = demoDeny(c, "editCampaigns");
    if (d) return d as ActionResult<{ version: number }>;
    const camp = await c.ds.campaign(id);
    if (!camp) return failResult("not_found", t("notFound"));
    if (!patch) return okResult(`Edit form for "${camp.name}" would open`, { sub: `Name, dates, budget and owner are editable; the UTM stays fixed so attribution holds. ${demoSub(c)}` });
    return p.success ? okResult(t("campaignSaved"), { sub: demoSub(c) }) : (invalid(p.error) as ActionResult<{ version: number }>);
  }
  return real(c, "campaign", async () => {
    await realCampaign(c, "campaigns.write", id);
    if (!p.success) return invalid(p.error) as ActionResult<{ version: number }>;
    return P.editCampaign(pctx(c), id, p.data.expectedVersion, p.data.patch, { saved: t("campaignSaved") });
  });
}

export async function setCampaignStatus(id: string, status: "paused" | "live" | "archived", expectedVersion?: number): Promise<ActionResult<{ version: number }>> {
  const c = await pageCtx();
  const t = tc(vocabFor(c.active.tenant));
  const db = status === "live" ? "active" : status;
  if (c.session.demo) {
    const d = demoDeny(c, "editCampaigns");
    if (d) return d as ActionResult<{ version: number }>;
    const camp = await c.ds.campaign(id);
    if (!camp) return failResult("not_found", t("notFound"));
    return okResult(`"${camp.name}" would be ${status === "paused" ? "paused (status only; the ad platform is not touched)" : status === "archived" ? "archived" : "resumed"}`, { sub: demoSub(c) });
  }
  const p = statusSchema.safeParse({ expectedVersion, status: db });
  return real(c, "campaign", async () => {
    await realCampaign(c, "campaigns.write", id);
    if (!p.success) return invalid(p.error) as ActionResult<{ version: number }>;
    return P.setStatus(pctx(c), id, p.data.expectedVersion, p.data.status, t(db === "active" ? "statusActive" : db === "paused" ? "statusPaused" : "statusArchived"));
  });
}

export async function addCampaignNote(id: string, note: string, expectedVersion?: number): Promise<ActionResult<{ version: number }>> {
  const c = await pageCtx();
  const t = tc(vocabFor(c.active.tenant));
  const p = noteSchema.safeParse({ expectedVersion, note });
  if (c.session.demo) {
    const d = demoDeny(c, "editCampaigns");
    if (d) return d as ActionResult<{ version: number }>;
    if (!(await c.ds.campaign(id))) return failResult("not_found", t("notFound"));
    return note.trim().length < 3 ? failResult("invalid", "Note is empty") : okResult(t("noteSaved"), { sub: demoSub(c) });
  }
  return real(c, "campaign", async () => {
    const cur = await realCampaign(c, "campaigns.write", id);
    if (!p.success) return invalid(p.error) as ActionResult<{ version: number }>;
    return P.addNote(pctx(c), cur, p.data.expectedVersion, p.data.note, { saved: t("noteSaved") });
  });
}

// ---------- daily metrics ----------
export async function saveMetricsDay(campaignId: string, row: unknown): Promise<ActionResult> {
  const c = await pageCtx();
  const t = tc(vocabFor(c.active.tenant));
  const p = metricsEntrySchema.safeParse({ campaignId, row });
  if (c.session.demo) {
    const d = demoDeny(c, "editCampaigns");
    if (d) return d;
    return p.success ? okResult(t("metricsSaved", { day: p.data.row.day }), { sub: demoSub(c) }) : invalid(p.error);
  }
  return real(c, "campaign", async () => {
    await realCampaign(c, "campaigns.write", campaignId);
    if (!p.success) return invalid(p.error);
    return P.saveMetricsDay(pctx(c), campaignId, p.data.row, { saved: (day) => t("metricsSaved", { day }) });
  });
}

export type MetricsPreviewResult = { rows: number; accepted: number; rejected: { line: number; reason: string }[]; totalSpend: number; missing: string[]; mapping: MetricsPreview["mapping"] };
const summary = (p: MetricsPreview): MetricsPreviewResult => ({ rows: p.totalRows, accepted: p.accepted.length, rejected: p.rejected.slice(0, 50), totalSpend: p.totalSpend, missing: p.missingRequired, mapping: p.mapping });

async function parseMetrics(c: Ctx, csv: string, campaignId?: string) {
  const t = tc(vocabFor(c.active.tenant));
  if (csv.length > MAX_CSV_BYTES) return { err: failResult("invalid", t("metricsTooBig")) as ActionResult };
  const camps = c.session.demo ? (await c.ds.campaigns()).map((x) => ({ id: x.id, name: x.name, utmCampaign: x.utmCampaign }))
    : (await campaignsRepo.list(c.active.ws.uuid, { limit: 200 })).rows.map((x) => ({ id: x.id, name: x.name, utmCampaign: x.utmCampaign }));
  const prev = previewMetricsCsv(csv, camps, c.now.slice(0, 10), campaignId);
  if (prev.totalRows > MAX_CSV_ROWS) return { err: failResult("invalid", t("metricsTooBig")) as ActionResult };
  return { prev };
}

/** Preview only: nothing is written. Real sessions re-parse the text on the server at commit time (never trust the client's rows). */
export async function previewMetrics(csv: string, campaignId?: string): Promise<ActionResult<MetricsPreviewResult>> {
  const c = await pageCtx();
  const t = tc(vocabFor(c.active.tenant));
  if (c.session.demo) {
    const d = demoDeny(c, "importCsv");
    if (d) return d as ActionResult<MetricsPreviewResult>;
  }
  return real(c, "campaign", async () => {
    if (!c.session.demo) await assertCan("campaigns.write", campRec(c, campaignId ?? "", c.session.uid));
    const r = await parseMetrics(c, csv, campaignId);
    if ("err" in r) return r.err as ActionResult<MetricsPreviewResult>;
    if (r.prev.missingRequired.length) return failResult("invalid", t("metricsMissing", { cols: r.prev.missingRequired.join(", ") })) as ActionResult<MetricsPreviewResult>;
    return okResult(t("metricsPreview", { ok: r.prev.accepted.length, bad: r.prev.rejected.length }), { sub: c.session.demo ? demoSub(c) : undefined, data: summary(r.prev) });
  });
}

export async function importMetrics(csv: string, campaignId?: string): Promise<ActionResult<{ written: number }>> {
  const c = await pageCtx();
  const t = tc(vocabFor(c.active.tenant));
  if (c.session.demo) {
    const d = demoDeny(c, "importCsv");
    return d ? (d as ActionResult<{ written: number }>) : okResult("Rows for unknown campaigns would be rejected; the rest would be written", { sub: demoSub(c) });
  }
  return real(c, "campaign", async () => {
    await assertCan("campaigns.write", campRec(c, campaignId ?? "", c.session.uid));
    const r = await parseMetrics(c, csv, campaignId);
    if ("err" in r) return r.err as ActionResult<{ written: number }>;
    if (r.prev.missingRequired.length) return failResult("invalid", t("metricsMissing", { cols: r.prev.missingRequired.join(", ") }));
    return P.importMetrics(pctx(c), r.prev.accepted, { done: (n) => t("metricsImported", { n }) });
  });
}

// ---------- segments ----------
export type SegmentPreview = SegmentSize;

/** Live size from the real leads query (RLS applies) plus the consented count, shown separately. */
export async function previewSegment(rules: unknown, channel?: string, cap = PREVIEW_CAP): Promise<ActionResult<SegmentPreview>> {
  const c = await pageCtx();
  const t = tc(vocabFor(c.active.tenant));
  if (c.session.demo) return failResult("invalid", t("demoNotice"));
  return real(c, "segment", async () => {
    await assertCan("segments.read", { type: "segment", workspaceId: c.active.ws.id });
    const k = compileRules(rules);
    if (!k.ok) return failResult("invalid", t("segmentRules"), { issues: k.errors.map((e) => ({ path: e.path, message: e.message })) });
    const db = await dbForRequest();
    const ws = c.active.ws.uuid, purpose = purposeFor(channel);
    const [total, { ids, truncated }] = await Promise.all([countSegment(db, ws, k.filters), segmentLeadIds(db, ws, k.filters, Math.min(cap, CONSENT_CAP))]);
    const ok = await consentedIds(ids, purpose, rpcCanContact(db));
    return okResult("", { data: summarize(total, ids, truncated, ok, purpose) });
  });
}

export async function saveSegmentRules(input: unknown, id?: string, expectedVersion?: number): Promise<ActionResult<{ id: string; version: number }>> {
  const c = await pageCtx();
  const t = tc(vocabFor(c.active.tenant));
  const p = id ? updateSegmentSchema.safeParse({ ...(input as object), expectedVersion }) : saveSegmentSchema.safeParse(input);
  if (c.session.demo) {
    const d = demoDeny(c, "editSegments");
    if (d) return d as ActionResult<{ id: string; version: number }>;
    return p.success ? okResult(t("segmentSaved", { name: p.data.name }), { sub: demoSub(c) }) : (invalid(p.error) as ActionResult<{ id: string; version: number }>);
  }
  return real(c, "segment", async () => {
    await assertCan("segments.write", { type: "segment", id, workspaceId: c.active.ws.id });
    if (!p.success) return invalid(p.error) as ActionResult<{ id: string; version: number }>;
    const pc = pctx(c);
    const rules = P.prepareRules(pc, p.data.rules);
    if (!rules.ok) return failResult("invalid", t("segmentRules"), { issues: rules.issues });
    const msg = { saved: (name: string) => t("segmentSaved", { name }) };
    if (id) {
      const r = await P.updateSegment(pc, id, (p.data as unknown as { expectedVersion: number }).expectedVersion, { name: p.data.name, rules: rules.rules, isIcp: p.data.isIcp }, msg);
      return r.ok ? { ...r, data: { id, version: r.data!.version } } : (r as ActionResult<{ id: string; version: number }>);
    }
    return P.createSegment(pc, { name: p.data.name, rules: rules.rules, isIcp: p.data.isIcp }, msg);
  });
}

/** Link a saved segment (a query) to a campaign. This is bookkeeping only; it never pushes anyone to an ad platform. */
export async function attachSegment(campaignId: string, segmentId: string, expectedVersion?: number): Promise<ActionResult<{ version: number }>> {
  const c = await pageCtx();
  const t = tc(vocabFor(c.active.tenant));
  if (c.session.demo) {
    const d = demoDeny(c, "editCampaigns");
    return d ? (d as ActionResult<{ version: number }>) : okResult(t("segmentAttached"), { sub: demoSub(c) });
  }
  const p = editCampaignSchema.safeParse({ expectedVersion, patch: { segmentId } });
  return real(c, "campaign", async () => {
    await realCampaign(c, "campaigns.write", campaignId);
    if (!p.success) return invalid(p.error) as ActionResult<{ version: number }>;
    if (!(await segmentsRepo.get(c.active.ws.uuid, segmentId))) return failResult("not_found", t("notFound"));
    return P.editCampaign(pctx(c), campaignId, p.data.expectedVersion, p.data.patch, { saved: t("segmentAttached") });
  });
}

/** Consent-filtered CSV for a platform upload done by hand. Only contacts passing public.can_contact() are included. */
export async function exportSegmentConsented(rules: unknown, channel?: string): Promise<ActionResult<{ csv: string; filename: string; included: number; skipped: number }>> {
  const c = await pageCtx();
  const t = tc(vocabFor(c.active.tenant));
  if (c.session.demo) {
    const d = demoDeny(c, "exportCsv");
    return d ? (d as never) : okResult("CSV of consented contacts would download", { sub: `Audit-logged. ${demoSub(c)}` });
  }
  return real(c, "segment", async () => {
    await assertCan("audience.export", { type: "segment", workspaceId: c.active.ws.id }); // supportBlocked in the catalogue
    const k = compileRules(rules);
    if (!k.ok) return failResult("invalid", t("segmentRules"), { issues: k.errors.map((e) => ({ path: e.path, message: e.message })) });
    const db = await dbForRequest(), ws = c.active.ws.uuid;
    const { ids, truncated } = await segmentLeadIds(db, ws, k.filters, CONSENT_CAP);
    const ok = new Set(await consentedIds(ids, purposeFor(channel), rpcCanContact(db)));
    const rows = await segmentRows<{ id: string; full_name: string; email: string | null; phone: string | null; district: string | null }>(db, ws, k.filters, ids.filter((i) => ok.has(i)), "id,full_name,email,phone,district");
    const csv = P.toCsv(["name", "email", "phone", "district"], rows.map((r) => [r.full_name, r.email, r.phone, r.district]));
    const skipped = ids.length - rows.length;
    try {
      await (db as unknown as { rpc(f: string, a: Record<string, unknown>): PromiseLike<unknown> }).rpc("emit_event", { p_type: "audience.exported", p_object_type: "segment", p_object_id: null, p_data: { included: rows.length, skipped, purpose: purposeFor(channel) } });
    } catch (e) { console.error("[exportSegmentConsented] emit_event failed", e); }
    return okResult(t("segmentExported", { n: rows.length }), { sub: `${t("segmentExportedSub", { skip: skipped })}${truncated ? ` ${t("segmentTruncated", { cap: CONSENT_CAP })}` : ""}`, data: { csv, filename: `segment-${c.now.slice(0, 10)}.csv`, included: rows.length, skipped } });
  });
}

// ---------- demo-only showcase actions (unchanged behaviour) ----------
async function demoGuard(action: MktAction) {
  const c = await pageCtx();
  const v = vocabFor(c.active.tenant);
  if (!c.session.demo) return { c, v, res: failResult("invalid", tc(v)("pushDisabled")) as ActionResult };
  return { c, v, res: demoDeny(c, action) };
}

export async function importCampaignCsv(platform: string, campaignId?: string): Promise<ActionResult> {
  const g = await demoGuard("importCsv");
  if (g.res) return g.res;
  const target = campaignId ? (await g.c.ds.campaigns()).find((x) => x.id === campaignId) : null;
  if (campaignId && !target) return failResult("not_found", "Unknown campaign", { sub: "Rows for unknown campaigns are rejected." });
  return okResult(`${platform} export would be mapped and previewed${target ? ` for "${target.name}"` : ""}`, { sub: `Rows with an unknown utm_campaign are rejected. ${demoSub(g.c)}` });
}

export async function exportCampaignLeads(campaignId: string): Promise<ActionResult> {
  const g = await demoGuard("exportCsv");
  if (g.res) return g.res;
  const leads = (await g.c.ds.leads()).filter((l) => l.campaignId === campaignId);
  const ok = leads.filter((l) => l.consent.marketing).length;
  return okResult(g.v.cd.exportMsg(leads.length), { sub: `${g.v.cd.exportDetail(leads.length - ok)} Export is audit-logged. ${demoSub(g.c)}` });
}

/** Showcase only: never claims anything was pushed. Real sessions get a disabled-with-reason answer. */
export async function sendSegmentToCampaign(segment: string, size: number, campaignId: string): Promise<ActionResult> {
  const g = await demoGuard("editCampaigns");
  if (g.res) return g.res;
  const camp = await g.c.ds.campaign(campaignId);
  if (!camp) return failResult("not_found", "Campaign not found in this workspace");
  return okResult(g.v.cd.segMsg(segment, size, camp.name), { sub: `Showcase: no audience is pushed to the ad platform until its source is connected. ${demoSub(g.c)}` });
}

export async function saveSegment(segment: string, rules: number): Promise<ActionResult> {
  const g = await demoGuard("editSegments");
  if (g.res) return g.res;
  if (segment.trim().length < 3) return failResult("invalid", "Give the segment a name");
  return okResult(`Segment "${segment.trim()}" with ${rules} rule${rules === 1 ? "" : "s"} would be saved`, { sub: demoSub(g.c) });
}

export async function exportSegment(segment: string, size: number): Promise<ActionResult> {
  const g = await demoGuard("exportCsv");
  if (g.res) return g.res;
  return okResult(`CSV of "${segment}" (${size} consented contacts) would download`, { sub: `Audit-logged. ${demoSub(g.c)}` });
}
