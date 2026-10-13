"use server";
// Lead mutations. Every action re-checks permissions on the server with the support-aware can() and the
// own-only rule for reps (spec 10.3). Demo mode persists nothing: each action returns what would have happened.
import { pageCtx } from "@/lib/data/context";
import { can, ROLE_LABEL, type Action } from "@/lib/auth/roles";
import type { Lead } from "@/lib/data/types";
import { CALL_OUTCOMES, WA_TEMPLATES, ownsOrManages, type Result } from "./_lib/sales";

const DEMO_SUB = "Demo workspace: nothing was saved or sent.";
const deny = (msg: string): Result => ({ ok: false, message: msg });

async function guard(action: Action) {
  const ctx = await pageCtx();
  const allowed = can(action, { role: ctx.role, support: ctx.support });
  const why = ctx.support ? "Not available in a support session." : `Your role (${ROLE_LABEL[ctx.role]}) cannot do this.`;
  return { ctx, allowed, why };
}

/** Lead-level guard: role permission + workspace membership of the lead + own-only for reps. */
async function guardLead(action: Action, leadId: string): Promise<{ error: Result } | { lead: Lead; ctx: Awaited<ReturnType<typeof pageCtx>> }> {
  const { ctx, allowed, why } = await guard(action);
  if (!allowed) return { error: deny(why) };
  const lead = await ctx.ds.lead(leadId);
  if (!lead) return { error: deny("Lead not found in this workspace.") };
  if (!ownsOrManages(ctx.role, ctx.session.uid, lead.ownerId)) return { error: deny("You can act only on leads assigned to you.") };
  return { lead, ctx };
}

export async function assignLeads(ids: string[], ownerId: string): Promise<Result> {
  const { ctx, allowed, why } = await guard("assignLeads");
  if (!allowed) return deny(why);
  const [team, leads] = await Promise.all([ctx.ds.team(), ctx.ds.leads()]);
  const owner = team.find((t) => t.id === ownerId && (t.role === "sales_rep" || t.role === "sales_manager"));
  if (!owner) return deny("Pick a sales rep or manager in this workspace.");
  const found = leads.filter((l) => ids.includes(l.id));
  if (!found.length) return deny("None of the selected leads are in this workspace.");
  const moved = found.filter((l) => l.ownerId !== ownerId).length;
  return { ok: true, message: `${found.length} lead${found.length > 1 ? "s" : ""} assigned to ${owner.name}`, sub: `${moved} changed owner; each change goes to the audit log. ${DEMO_SUB}` };
}

const csvCell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export async function exportLeads(ids: string[], maskPersonal: boolean): Promise<Result & { csv?: string; filename?: string }> {
  const { ctx, allowed, why } = await guard("exportCsv");
  if (!allowed) return deny(why);
  const [leads, accounts, team] = await Promise.all([ctx.ds.leads(), ctx.ds.accounts(), ctx.ds.team()]);
  const rows = ctx.scope.leads(leads).filter((l) => ids.includes(l.id));
  const mask = (s: string) => (maskPersonal ? s.replace(/^(.).*?(@.*)?$/, (_, a: string, b?: string) => `${a}•••${b ?? ""}`) : s);
  const head = ["lead_id", "name", "title", "firm", "district", "stage", "score", "owner", "channel", "utm_source", "utm_medium", "utm_campaign", "phone", "email", "created_at", "last_touch_at"];
  const body = rows.map((l) => {
    const a = accounts.find((x) => x.id === l.accountId);
    return [l.id, maskPersonal ? l.name.split(" ").map((p) => p[0] + ".").join(" ") : l.name, l.title, a?.name, a?.district, l.stage, l.score, team.find((t) => t.id === l.ownerId)?.name, l.channel, l.utm.source, l.utm.medium, l.utm.campaign, mask(l.phone), mask(l.email), l.createdAt, l.lastTouchAt].map(csvCell).join(",");
  });
  const stamp = ctx.now.slice(0, 10);
  return { ok: true, message: `Exported ${rows.length} leads${maskPersonal ? " (phone and email masked)" : ""}`, sub: "Export is written to the audit log with your name and the filter used.", csv: [head.join(","), ...body].join("\n"), filename: `leads-${ctx.active.ws.id}-${stamp}.csv` };
}

/** CSV import, step 2: dedupe preview against this workspace's live leads (same phone or same email). */
export async function previewImport(csv: string): Promise<Result & { preview?: { rows: number; fresh: number; duplicates: number; invalid: number; columns: string[] } }> {
  const { ctx, allowed, why } = await guard("importCsv");
  if (!allowed) return deny(why);
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return deny("The file needs a header row and at least one lead.");
  if (lines.length > 5001) return deny("Import up to 5,000 rows at a time.");
  const columns = lines[0].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const ci = (re: RegExp) => columns.findIndex((c) => re.test(c.toLowerCase()));
  const iPhone = ci(/phone|mobile|whatsapp/), iEmail = ci(/e-?mail/);
  const existing = await ctx.ds.leads();
  const norm = (p: string) => p.replace(/\D/g, "").slice(-10);
  const phones = new Set(existing.map((l) => norm(l.phone))), emails = new Set(existing.map((l) => l.email.toLowerCase()));
  let fresh = 0, duplicates = 0, invalid = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const phone = iPhone >= 0 ? cells[iPhone] ?? "" : "", email = iEmail >= 0 ? (cells[iEmail] ?? "").toLowerCase() : "";
    const phoneOk = /^(\+?91)?[6-9]\d{9}$/.test(phone.replace(/[\s-]/g, ""));
    if (!phoneOk && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) { invalid++; continue; }
    if ((phoneOk && phones.has(norm(phone))) || (email && emails.has(email))) duplicates++; else fresh++;
  }
  return { ok: true, message: "Preview ready", preview: { rows: lines.length - 1, fresh, duplicates, invalid, columns } };
}
export async function confirmImport(fresh: number, duplicates: number, mode: "merge" | "skip"): Promise<Result> {
  const { allowed, why } = await guard("importCsv");
  if (!allowed) return deny(why);
  return { ok: true, message: `Import queued: ${fresh} new leads, ${duplicates} duplicates ${mode === "merge" ? "merged" : "skipped"}`, sub: `A sync run (integration = csv) records the result. ${DEMO_SUB}` };
}

export async function logCall(leadId: string, input: { outcome: string; minutes: number; notes: string; nextDate: string }): Promise<Result> {
  const g = await guardLead("workLeads", leadId);
  if ("error" in g) return g.error;
  const outcome = CALL_OUTCOMES.find((o) => o.key === input.outcome);
  if (!outcome) return deny("Pick a call outcome.");
  if (!Number.isFinite(input.minutes) || input.minutes < 0 || input.minutes > 240) return deny("Duration must be 0 to 240 minutes.");
  const firstTouch = g.lead.firstResponseMins === null;
  return { ok: true, message: `Call logged for ${g.lead.name}: ${outcome.label}`, sub: `${firstTouch ? "First touch: SLA clock stopped. " : ""}${input.nextDate ? `Follow-up task created for ${input.nextDate}. ` : ""}${DEMO_SUB}` };
}

export async function sendWhatsApp(leadId: string, templateId: string): Promise<Result> {
  const g = await guardLead("workLeads", leadId);
  if ("error" in g) return g.error;
  if (!g.lead.consent.whatsapp) return deny("No WhatsApp consent on record. Record consent before sending templates.");
  const tpl = WA_TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) return deny("Pick an approved template.");
  return { ok: true, message: `Template ${tpl.id} logged as simulated`, sub: "Showcase: a messages row with status 'simulated' is written; nothing reaches WhatsApp." };
}

export async function logEmail(leadId: string, subject: string): Promise<Result> {
  const g = await guardLead("workLeads", leadId);
  if ("error" in g) return g.error;
  return { ok: true, message: `Email to ${g.lead.name} logged`, sub: `"${subject.slice(0, 60)}" added to the timeline. ${DEMO_SUB}` };
}

export async function scheduleDemo(leadId: string, input: { date: string; time: string; minutes: number; mode: string }): Promise<Result> {
  const g = await guardLead("workLeads", leadId);
  if ("error" in g) return g.error;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) return deny("Pick a date and time.");
  if (`${input.date}T${input.time}` < g.ctx.now.slice(0, 16)) return deny("The demo time is in the past.");
  const [h] = input.time.split(":").map(Number);
  if (h < 8 || h >= 20) return deny("Pick a time between 08:00 and 20:00 IST.");
  return { ok: true, message: `Demo scheduled for ${input.date}, ${input.time} IST (${input.minutes} min, ${input.mode})`, sub: `Meeting activity and prep task created; deal moves to Demo scheduled. ${DEMO_SUB}` };
}

const STATUS = ["new", "contacted", "qualified", "nurturing", "disqualified", "converted"] as const;
const DQ = ["student", "not_a_firm", "outside_tn", "duplicate", "no_budget", "competitor"] as const;
export async function changeStatus(leadId: string, status: string, reason?: string): Promise<Result> {
  const g = await guardLead("workLeads", leadId);
  if ("error" in g) return g.error;
  if (!(STATUS as readonly string[]).includes(status)) return deny("Unknown status.");
  if (status === "disqualified" && !(DQ as readonly string[]).includes(reason ?? "")) return deny("Disqualifying needs a reason.");
  return { ok: true, message: `Status set to ${status.replace("_", " ")}${reason ? ` (${reason.replace(/_/g, " ")})` : ""}`, sub: DEMO_SUB };
}

export async function acceptSuggestion(leadId: string, action: string, due: string): Promise<Result> {
  const g = await guardLead("workLeads", leadId);
  if ("error" in g) return g.error;
  return { ok: true, message: `Task created: ${action}`, sub: `Due ${due}. The suggestion is logged as accepted in ai_insights. ${DEMO_SUB}` };
}
export async function dismissSuggestion(leadId: string, reason: string): Promise<Result> {
  const g = await guardLead("workLeads", leadId);
  if ("error" in g) return g.error;
  return { ok: true, message: "Suggestion dismissed", sub: `Reason "${reason}" is logged to tune future suggestions.` };
}
