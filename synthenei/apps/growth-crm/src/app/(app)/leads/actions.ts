"use server";
// Lead mutations. Real sessions: assertCan (authz engine) -> repository write with expected version -> ActionResult.
// Audit rows and lead.* events are written by DB triggers, so "Saved" is only returned after the commit succeeded.
// Demo sessions never touch Supabase: each action returns what would have happened ("Demo workspace: nothing was saved").
import { pageCtx } from "@/lib/data/context";
import { can, ROLE_LABEL, type Action } from "@/lib/auth/roles";
import type { Lead } from "@/lib/data/types";
import { vocabFor } from "@/lib/vertical";
import { assertCan } from "@/lib/authz/load";
import { can as engineCan } from "@/lib/authz";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { DbError } from "@/lib/db/errors";
import { dbForRequest } from "@/lib/db/client";
import { leadsRepo } from "@/lib/db/repo/leads";
import { activitiesRepo } from "@/lib/db/repo/activities";
import { tasksRepo } from "@/lib/db/repo/tasks";
import type { Lead as DbLead } from "@/lib/db/repo/types";
import { CALL_OUTCOMES, ownsOrManages } from "./_lib/sales";
import * as P from "./_lib/persist";
import { assignSchema, callSchema, createLeadSchema, demoSchema, emailSchema, statusSchema, suggestionAcceptSchema, suggestionDismissSchema, updateLeadSchema } from "./_lib/schemas";
import { lt } from "./_lib/strings";

const DEMO_SUB = "Demo workspace: nothing was saved or sent.";
const deny = (msg: string): ActionResult => failResult("denied", msg);

type Ctx = Awaited<ReturnType<typeof pageCtx>>;
const repos: P.Repos = { leads: leadsRepo, activities: activitiesRepo, tasks: tasksRepo };
const pctx = (ctx: Ctx): P.Ctx => ({ ws: ctx.active.ws.uuid, uid: ctx.session.uid, now: new Date(), repos });
const recOf = (ctx: Ctx, l: DbLead) => ({ type: "lead" as const, id: l.id, workspaceId: ctx.active.ws.id, ownerId: l.ownerId });

/** Wraps a real-mode body: AuthzError -> denied, DbError -> code, and a conflict carries only the current version (never the row). */
async function real<T>(ctx: Ctx, fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const r = await runAction(fn);
  if (r.ok) return r;
  const t = lt(vocabFor(ctx.active.tenant));
  if (r.code === "denied") return { ...r, message: t("deniedTitle"), sub: ctx.support ? "Not available in a support session." : undefined };
  if (r.code === "conflict") {
    const v = (r.current as { version?: number } | undefined)?.version;
    return { ...r, message: t("conflictTitle"), sub: t("conflictBody"), current: v === undefined ? undefined : { version: v } };
  }
  if (r.code === "not_found") return { ...r, message: t("notFound") };
  if (r.code === "error") return { ...r, message: t("errorTitle"), sub: t("errorBody") };
  return r;
}

/** Real mode: load the lead, enforce the permission on THAT record (own/team scope), return it. */
async function realLead(ctx: Ctx, perm: string | string[], leadId: string): Promise<DbLead> {
  const lead = await leadsRepo.get(ctx.active.ws.uuid, leadId);
  if (!lead) throw new DbError("not_found", "not_found");
  for (const p of Array.isArray(perm) ? perm : [perm]) await assertCan(p, recOf(ctx, lead));
  return lead;
}

async function guard(action: Action) {
  const ctx = await pageCtx();
  const allowed = can(action, { role: ctx.role, support: ctx.support });
  const why = ctx.support ? "Not available in a support session." : `Your role (${ROLE_LABEL[ctx.role]}) cannot do this.`;
  return { ctx, allowed, why };
}

/** Demo lead-level guard: role permission + workspace membership of the lead + own-only for reps. */
async function guardLead(action: Action, leadId: string): Promise<{ error: ActionResult } | { lead: Lead; ctx: Ctx }> {
  const { ctx, allowed, why } = await guard(action);
  if (!allowed) return { error: deny(why) };
  const lead = await ctx.ds.lead(leadId);
  const t = vocabFor(ctx.active.tenant).ls.a;
  if (!lead) return { error: failResult("not_found", t.notFound) };
  if (!ownsOrManages(ctx.role, ctx.session.uid, lead.ownerId)) return { error: deny(t.onlyOwn) };
  return { lead, ctx };
}

const invalid = (e: { issues: { path: PropertyKey[]; message: string }[] }): ActionResult =>
  failResult("invalid", e.issues[0]?.message ?? "Some values are not valid.", { issues: e.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) });

// ---------- create / edit ----------
export async function createLead(input: unknown): Promise<ActionResult<{ id: string }>> {
  const ctx = await pageCtx();
  const v = vocabFor(ctx.active.tenant), t = lt(v);
  if (ctx.session.demo) {
    if (!can("workLeads", { role: ctx.role, support: ctx.support })) return deny(ctx.support ? "Not available in a support session." : `Your role (${ROLE_LABEL[ctx.role]}) cannot do this.`);
    const p = createLeadSchema.safeParse(input);
    if (!p.success) return invalid(p.error) as ActionResult<{ id: string }>;
    return okResult(t("created"), { sub: DEMO_SUB });
  }
  return real(ctx, async () => {
    await assertCan("leads.create");
    const p = createLeadSchema.safeParse(input);
    if (!p.success) return invalid(p.error) as ActionResult<{ id: string }>;
    return P.createLead(pctx(ctx), p.data, { created: t("created") }).then((r) => (r.ok ? { ...r, sub: t("createdSub") } : r));
  });
}

export async function updateLead(leadId: string, input: unknown): Promise<ActionResult<{ version: number }>> {
  const ctx = await pageCtx();
  const t = lt(vocabFor(ctx.active.tenant));
  const p = updateLeadSchema.safeParse(input);
  if (ctx.session.demo) {
    const g = await guardLead("workLeads", leadId);
    if ("error" in g) return g.error as ActionResult<{ version: number }>;
    if (!p.success) return invalid(p.error) as ActionResult<{ version: number }>;
    return okResult(t("saved"), { sub: DEMO_SUB });
  }
  return real(ctx, async () => {
    await realLead(ctx, "leads.write", leadId);
    if (!p.success) return invalid(p.error) as ActionResult<{ version: number }>;
    return P.updateLead(pctx(ctx), leadId, p.data.expectedVersion, p.data.patch, { saved: t("saved") });
  });
}

// ---------- assign / export / import ----------
export async function assignLeads(ids: string[], ownerId: string): Promise<ActionResult> {
  const ctx0 = await pageCtx();
  if (ctx0.session.demo) {
    const { ctx, allowed, why } = await guard("assignLeads");
    if (!allowed) return deny(why);
    const [team, leads] = await Promise.all([ctx.ds.team(), ctx.ds.leads()]);
    const owner = team.find((x) => x.id === ownerId && (x.role === "sales_rep" || x.role === "sales_manager"));
    const t = vocabFor(ctx.active.tenant).ls.a;
    if (!owner) return failResult("invalid", t.pickOwner);
    const found = leads.filter((l) => ids.includes(l.id));
    if (!found.length) return failResult("not_found", t.noneFound);
    const moved = found.filter((l) => l.ownerId !== ownerId).length;
    return okResult(t.assigned(found.length, owner.name), { sub: `${moved} changed owner; each change goes to the audit log. ${DEMO_SUB}` });
  }
  const v = vocabFor(ctx0.active.tenant);
  return real(ctx0, async () => {
    await assertCan("leads.assign");
    const p = assignSchema.safeParse({ ids, ownerId });
    if (!p.success) return invalid(p.error);
    const r = await P.assign(pctx(ctx0), p.data.ids, p.data.ownerId, { assigned: v.ls.a.assigned(p.data.ids.length, "the selected owner") });
    return r.ok ? { ...r, sub: lt(v)("assignedSub", { n: p.data.ids.length }) } : r;
  });
}

export async function exportLeads(ids: string[], maskPersonal: boolean): Promise<ActionResult & { csv?: string; filename?: string }> {
  const ctx0 = await pageCtx();
  const v = vocabFor(ctx0.active.tenant), t = lt(v);
  if (ctx0.session.demo) {
    const { ctx, allowed, why } = await guard("exportCsv");
    if (!allowed) return deny(why);
    const [leads, accounts, team] = await Promise.all([ctx.ds.leads(), ctx.ds.accounts(), ctx.ds.team()]);
    const rows = ctx.scope.leads(leads).filter((l) => ids.includes(l.id));
    const mask = (s: string) => (maskPersonal ? s.replace(/^(.).*?(@.*)?$/, (_, a: string, b?: string) => `${a}•••${b ?? ""}`) : s);
    const cell = (x: string | number | null | undefined) => { const s = x === null || x === undefined ? "" : String(x); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ["lead_id", "name", "title", "firm", "district", "stage", "score", "owner", "channel", "utm_source", "utm_medium", "utm_campaign", "phone", "email", "created_at", "last_touch_at"];
    const body = rows.map((l) => {
      const a = accounts.find((x) => x.id === l.accountId);
      return [l.id, maskPersonal ? l.name.split(" ").map((p) => p[0] + ".").join(" ") : l.name, l.title, a?.name, a?.district, l.stage, l.score, team.find((m) => m.id === l.ownerId)?.name, l.channel, l.utm.source, l.utm.medium, l.utm.campaign, mask(l.phone), mask(l.email), l.createdAt, l.lastTouchAt].map(cell).join(",");
    });
    return { ...okResult(v.ls.a.exported(rows.length, maskPersonal), { sub: "Export is written to the audit log with your name and the filter used." }), csv: [head.join(","), ...body].join("\n"), filename: `leads-${ctx.active.ws.id}-${ctx.now.slice(0, 10)}.csv` };
  }
  const r = await real(ctx0, async () => {
    const principal = await assertCan("leads.export"); // supportBlocked in the catalogue: denied in any support session
    const ws = ctx0.active.ws.uuid;
    const p = assignSchema.pick({ ids: true }).safeParse({ ids });
    if (!p.success) return invalid(p.error);
    const found: DbLead[] = [];
    for (let i = 0; i < p.data.ids.length; i += 100) {
      const page = await leadsRepo.list(ws, { limit: 100, filters: [{ field: "id", op: "in", value: p.data.ids.slice(i, i + 100) }] });
      found.push(...page.rows);
    }
    const allowed = found.filter((l) => engineCan(principal, "leads.export", recOf(ctx0, l)));
    if (!allowed.length) return failResult("not_found", v.ls.a.noneFound);
    const mayUnmask = engineCan(principal, "pii.read");
    const mask = maskPersonal || !mayUnmask;
    const ownerNames = Object.fromEntries((await ctx0.ds.team()).map((m) => [m.id, m.name]));
    const csv = P.buildCsv(allowed, { maskPersonal: mask, ownerNames });
    await emitExportEvent(allowed.length, mask);
    return { ...okResult(v.ls.a.exported(allowed.length, mask), { sub: mask && !maskPersonal ? t("exportMasked") : t("exportedSub"), data: { csv, mask } }) };
  });
  if (!r.ok) return r;
  const data = r.data as { csv: string } | undefined;
  const { data: _d, ...rest } = r; void _d;
  return { ...rest, csv: data?.csv, filename: `leads-${ctx0.active.ws.id}-${new Date().toISOString().slice(0, 10)}.csv` };
}

/** Best effort: the export is not a row change, so it is recorded through public.emit_event (needs event type lead.exported). */
async function emitExportEvent(count: number, masked: boolean): Promise<void> {
  try {
    const db = (await dbForRequest()) as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }> };
    await db.rpc("emit_event", { p_type: "lead.exported", p_object_type: "lead", p_object_id: null, p_data: { count, masked } });
  } catch (e) { console.error("[exportLeads] emit_event failed", e); }
}

/** CSV import, step 2: dedupe preview against this workspace's live leads (same phone or same email). */
export async function previewImport(csv: string): Promise<ActionResult & { preview?: { rows: number; fresh: number; duplicates: number; invalid: number; columns: string[] } }> {
  const { ctx, allowed, why } = await guard("importCsv");
  if (!allowed) return deny(why);
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return failResult("invalid", vocabFor(ctx.active.tenant).ls.a.needRows);
  if (lines.length > 5001) return failResult("invalid", "Import up to 5,000 rows at a time.");
  const columns = lines[0].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const ci = (re: RegExp) => columns.findIndex((c) => re.test(c.toLowerCase()));
  const iPhone = ci(/phone|mobile|whatsapp/), iEmail = ci(/e-?mail/);
  const existing = await ctx.ds.leads();
  const norm = (p: string) => p.replace(/\D/g, "").slice(-10);
  const phones = new Set(existing.map((l) => norm(l.phone))), emails = new Set(existing.map((l) => l.email.toLowerCase()));
  let fresh = 0, duplicates = 0, bad = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const phone = iPhone >= 0 ? cells[iPhone] ?? "" : "", email = iEmail >= 0 ? (cells[iEmail] ?? "").toLowerCase() : "";
    const phoneOk = /^(\+?91)?[6-9]\d{9}$/.test(phone.replace(/[\s-]/g, ""));
    if (!phoneOk && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) { bad++; continue; }
    if ((phoneOk && phones.has(norm(phone))) || (email && emails.has(email))) duplicates++; else fresh++;
  }
  return { ...okResult("Preview ready"), preview: { rows: lines.length - 1, fresh, duplicates, invalid: bad, columns } };
}
export async function confirmImport(fresh: number, duplicates: number, mode: "merge" | "skip"): Promise<ActionResult> {
  const { ctx, allowed, why } = await guard("importCsv");
  if (!allowed) return deny(why);
  return okResult(vocabFor(ctx.active.tenant).ls.a.queued(fresh, duplicates, mode === "merge"), { sub: `A sync run (integration = csv) records the result. ${DEMO_SUB}` });
}

// ---------- activity logging ----------
export async function logCall(leadId: string, input: { outcome: string; minutes: number; notes: string; nextDate: string }, expectedVersion?: number): Promise<ActionResult<{ version: number }>> {
  const ctx = await pageCtx();
  const v = vocabFor(ctx.active.tenant), t = lt(v);
  const outcome = CALL_OUTCOMES.find((o) => o.key === input.outcome);
  if (ctx.session.demo) {
    const g = await guardLead("workLeads", leadId);
    if ("error" in g) return g.error as ActionResult<{ version: number }>;
    if (!outcome) return failResult("invalid", "Pick a call outcome.");
    if (!Number.isFinite(input.minutes) || input.minutes < 0 || input.minutes > 240) return failResult("invalid", "Duration must be 0 to 240 minutes.");
    const firstTouch = g.lead.firstResponseMins === null;
    return okResult(`Call logged for ${g.lead.name}: ${outcome.label}`, { sub: `${firstTouch ? "First touch: SLA clock stopped. " : ""}${input.nextDate ? `Follow-up task created for ${input.nextDate}. ` : ""}${DEMO_SUB}` });
  }
  return real(ctx, async () => {
    const lead = await realLead(ctx, ["activities.write", "leads.write"], leadId);
    const p = callSchema.safeParse(input);
    if (!p.success || !outcome) return p.success ? failResult("invalid", "Pick a call outcome.") : (invalid(p.error) as ActionResult<{ version: number }>);
    const r = await P.logCall(pctx(ctx), lead, expectedVersion ?? lead.version, p.data, { saved: t("callSaved", { name: lead.fullName, outcome: outcome.label }), followUp: t("followUp") });
    return r.ok ? { ...r, sub: lead.firstResponseAt ? undefined : t("callFirstTouch") } : r;
  });
}

export async function sendWhatsApp(leadId: string, templateId: string): Promise<ActionResult> {
  // Showcase only: no WhatsApp send path exists until the Cloud API connector task; real sessions are refused, not faked.
  const g = await guardLead("workLeads", leadId);
  if ("error" in g) return g.error;
  if (!g.lead.consent.whatsapp) return failResult("invalid", "No WhatsApp consent on record. Record consent before sending templates.");
  const tpl = vocabFor(g.ctx.active.tenant).wa.find((x) => x.id === templateId);
  if (!tpl) return failResult("invalid", "Pick an approved template.");
  if (!g.ctx.session.demo) return failResult("invalid", "WhatsApp sending is not connected yet.", { sub: "Nothing was sent or saved." });
  return okResult(`Template ${tpl.id} logged as simulated`, { sub: "Showcase: a messages row with status 'simulated' is written; nothing reaches WhatsApp." });
}

export async function logEmail(leadId: string, subject: string, expectedVersion?: number): Promise<ActionResult<{ version: number }>> {
  const ctx = await pageCtx();
  const t = lt(vocabFor(ctx.active.tenant));
  if (ctx.session.demo) {
    const g = await guardLead("workLeads", leadId);
    if ("error" in g) return g.error as ActionResult<{ version: number }>;
    return okResult(`Email to ${g.lead.name} logged`, { sub: `"${subject.slice(0, 60)}" added to the timeline. ${DEMO_SUB}` });
  }
  return real(ctx, async () => {
    const lead = await realLead(ctx, ["activities.write", "leads.write"], leadId);
    const p = emailSchema.safeParse({ subject });
    if (!p.success) return invalid(p.error) as ActionResult<{ version: number }>;
    return P.logEmail(pctx(ctx), lead, expectedVersion ?? lead.version, p.data.subject, { saved: t("emailSaved", { name: lead.fullName }) });
  });
}

export async function scheduleDemo(leadId: string, input: { date: string; time: string; minutes: number; mode: string }): Promise<ActionResult> {
  const ctx = await pageCtx();
  const v = vocabFor(ctx.active.tenant);
  const check = (nowIso: string): ActionResult | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) return failResult("invalid", "Pick a date and time.");
    if (`${input.date}T${input.time}` < nowIso.slice(0, 16)) return failResult("invalid", v.ls.a.demoPast);
    const [h] = input.time.split(":").map(Number);
    if (h < 8 || h >= 20) return failResult("invalid", "Pick a time between 08:00 and 20:00 IST.");
    return null;
  };
  if (ctx.session.demo) {
    const g = await guardLead("workLeads", leadId);
    if ("error" in g) return g.error;
    const bad = check(g.ctx.now);
    if (bad) return bad;
    return okResult(v.ls.a.demoSched(input.date, input.time, input.minutes, input.mode), { sub: `${v.ls.a.demoSub} ${DEMO_SUB}` });
  }
  return real(ctx, async () => {
    const lead = await realLead(ctx, "activities.write", leadId);
    await assertCan("tasks.write");
    const p = demoSchema.safeParse(input);
    if (!p.success) return invalid(p.error);
    // IST wall clock "now" for the past check
    const nowIst = new Date(Date.now() + 5.5 * 3600e3).toISOString();
    const bad = check(nowIst);
    if (bad) return bad;
    return P.scheduleDemo(pctx(ctx), lead, p.data, { saved: v.ls.a.demoSched(input.date, input.time, input.minutes, input.mode), prep: lt(v)("demoPrep") });
  });
}

// ---------- status ----------
export async function changeStatus(leadId: string, status: string, reason?: string, expectedVersion?: number): Promise<ActionResult<{ version: number }>> {
  const ctx = await pageCtx();
  const t = lt(vocabFor(ctx.active.tenant));
  const p = statusSchema.safeParse({ status, reason, expectedVersion });
  if (ctx.session.demo) {
    const g = await guardLead("workLeads", leadId);
    if ("error" in g) return g.error as ActionResult<{ version: number }>;
    if (!p.success) return failResult("invalid", status === "disqualified" ? "Disqualifying needs a reason." : "Unknown status.");
    return okResult(`Status set to ${status.replace("_", " ")}${reason ? ` (${reason.replace(/_/g, " ")})` : ""}`, { sub: DEMO_SUB });
  }
  return real(ctx, async () => {
    const lead = await realLead(ctx, "leads.write", leadId);
    if (!p.success) return invalid(p.error) as ActionResult<{ version: number }>;
    return P.setStatus(pctx(ctx), lead, p.data.expectedVersion ?? lead.version, p.data.status, p.data.reason, { saved: t("statusSaved", { status: p.data.status.replace("_", " ") }) });
  });
}

// ---------- suggestions ----------
export async function acceptSuggestion(leadId: string, action: string, due: string): Promise<ActionResult> {
  const ctx = await pageCtx();
  const t = lt(vocabFor(ctx.active.tenant));
  if (ctx.session.demo) {
    const g = await guardLead("workLeads", leadId);
    if ("error" in g) return g.error;
    return okResult(`Task created: ${action}`, { sub: `Due ${due}. The suggestion is logged as accepted in ai_insights. ${DEMO_SUB}` });
  }
  return real(ctx, async () => {
    const lead = await realLead(ctx, "tasks.write", leadId);
    const p = suggestionAcceptSchema.safeParse({ action, due });
    if (!p.success) return invalid(p.error);
    const r = await P.acceptSuggestion(pctx(ctx), lead, p.data, { saved: t("taskCreated", { action: p.data.action }) });
    return r.ok ? { ...r, sub: t("taskCreatedSub", { due: p.data.due }) } : r;
  });
}
export async function dismissSuggestion(leadId: string, reason: string): Promise<ActionResult> {
  const ctx = await pageCtx();
  const t = lt(vocabFor(ctx.active.tenant));
  if (ctx.session.demo) {
    const g = await guardLead("workLeads", leadId);
    if ("error" in g) return g.error;
    return okResult("Suggestion dismissed", { sub: `Reason "${reason}" is logged to tune future suggestions.` });
  }
  return real(ctx, async () => {
    const lead = await realLead(ctx, "activities.write", leadId);
    const p = suggestionDismissSchema.safeParse({ reason });
    if (!p.success) return invalid(p.error);
    const r = await P.dismissSuggestion(pctx(ctx), lead, p.data.reason, { saved: t("dismissed"), note: t("dismissNote") });
    return r.ok ? { ...r, sub: t("dismissedSub", { reason: p.data.reason }) } : r;
  });
}
