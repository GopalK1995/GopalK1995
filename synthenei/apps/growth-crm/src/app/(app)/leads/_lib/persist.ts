// Real-mode persistence for lead actions. Pure over injected repositories so it is unit-testable with the mocked client.
// Authorization (assertCan) happens in actions.ts BEFORE any of these run; audit rows and lead.* events come from DB triggers.
import { okResult, type ActionResult } from "@/lib/actions/result";
import type { ActivityInput, ActivityRow, Lead, LeadInput, TaskInput, TaskRow } from "@/lib/db/repo/types";
import type { CreateLeadInput } from "./schemas";

export interface Repos {
  leads: {
    get(ws: string, id: string): Promise<Lead | null>;
    create(ws: string, input: LeadInput): Promise<Lead>;
    update(ws: string, id: string, v: number, patch: Partial<LeadInput> & Record<string, unknown>): Promise<Lead>;
    assign(ws: string, ids: string[], ownerId: string | null): Promise<void>;
  };
  activities: { create(ws: string, input: ActivityInput): Promise<ActivityRow> };
  tasks: { create(ws: string, input: TaskInput): Promise<TaskRow> };
}
export interface Ctx { ws: string; uid: string; now: Date; repos: Repos }

const iso = (d: Date) => d.toISOString();
/** IST wall time -> UTC ISO (India has no DST). */
export const istToIso = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`).toISOString();

export async function createLead(c: Ctx, input: CreateLeadInput, msg: { created: string }): Promise<ActionResult<{ id: string }>> {
  const row = await c.repos.leads.create(c.ws, {
    fullName: input.fullName, roleTitle: input.roleTitle || null, firmName: input.firmName || null,
    email: input.email || null, phone: input.phone || null, city: input.city || null,
    ownerId: input.ownerId ?? c.uid, source: "manual", status: "new",
  } as LeadInput);
  return okResult(msg.created, { data: { id: row.id } });
}

export async function updateLead(c: Ctx, id: string, expectedVersion: number, patch: Record<string, unknown>, msg: { saved: string }): Promise<ActionResult<{ version: number }>> {
  const row = await c.repos.leads.update(c.ws, id, expectedVersion, patch as Partial<LeadInput>);
  return okResult(msg.saved, { data: { version: row.version } });
}

export async function assign(c: Ctx, ids: string[], ownerId: string, msg: { assigned: string }): Promise<ActionResult> {
  await c.repos.leads.assign(c.ws, ids, ownerId);
  return okResult(msg.assigned);
}

export async function setStatus(c: Ctx, lead: Lead, expectedVersion: number, status: string, reason: string | undefined, msg: { saved: string }): Promise<ActionResult<{ version: number }>> {
  const patch: Record<string, unknown> = { status, disqualifyReason: status === "disqualified" ? reason ?? null : null };
  const row = await c.repos.leads.update(c.ws, lead.id, expectedVersion, patch as Partial<LeadInput>);
  return okResult(msg.saved, { data: { version: row.version } });
}

/** Touch bookkeeping shared by call / email: first response stops the SLA clock; last touch moves forward. */
function touchPatch(c: Ctx, lead: Lead, channel: string): Record<string, unknown> {
  return {
    lastTouchAt: iso(c.now), lastTouchChannel: channel,
    ...(lead.firstResponseAt ? {} : { firstResponseAt: iso(c.now) }),
  };
}

export async function logCall(c: Ctx, lead: Lead, expectedVersion: number, i: { outcome: string; minutes: number; notes: string; nextDate: string }, msg: { saved: string; followUp: string }): Promise<ActionResult<{ version: number }>> {
  await c.repos.activities.create(c.ws, { kind: "call", leadId: lead.id, ownerId: c.uid, outcome: i.outcome, durationMins: Math.round(i.minutes), body: i.notes || null, doneAt: iso(c.now), source: "manual" } as ActivityInput);
  const patch: Record<string, unknown> = touchPatch(c, lead, "other");
  if (i.nextDate) {
    const due = istToIso(i.nextDate, "10:00");
    await c.repos.tasks.create(c.ws, { leadId: lead.id, title: msg.followUp, kind: "call", assigneeId: lead.ownerId ?? c.uid, createdBy: c.uid, dueAt: due } as TaskInput);
    patch.nextStepAt = due;
  }
  const row = await c.repos.leads.update(c.ws, lead.id, expectedVersion, patch as Partial<LeadInput>);
  return okResult(msg.saved, { data: { version: row.version } });
}

export async function logEmail(c: Ctx, lead: Lead, expectedVersion: number, subject: string, msg: { saved: string }): Promise<ActionResult<{ version: number }>> {
  await c.repos.activities.create(c.ws, { kind: "email", leadId: lead.id, ownerId: c.uid, direction: "outbound", subject, doneAt: iso(c.now), source: "manual" } as ActivityInput);
  const row = await c.repos.leads.update(c.ws, lead.id, expectedVersion, touchPatch(c, lead, "email") as Partial<LeadInput>);
  return okResult(msg.saved, { data: { version: row.version } });
}

/** Meeting activity (calendar placeholder: scheduled_at, no external calendar write) plus a prep task due at the slot. */
export async function scheduleDemo(c: Ctx, lead: Lead, i: { date: string; time: string; minutes: number; mode: string }, msg: { saved: string; prep: string }): Promise<ActionResult> {
  const at = istToIso(i.date, i.time);
  await c.repos.activities.create(c.ws, { kind: "meeting", meetingType: "demo", leadId: lead.id, ownerId: c.uid, scheduledAt: at, durationMins: i.minutes, subject: i.mode, source: "manual" } as ActivityInput);
  await c.repos.tasks.create(c.ws, { leadId: lead.id, title: msg.prep, kind: "demo_prep", assigneeId: lead.ownerId ?? c.uid, createdBy: c.uid, dueAt: at } as TaskInput);
  return okResult(msg.saved);
}

export async function acceptSuggestion(c: Ctx, lead: Lead, i: { action: string; due: string }, msg: { saved: string }): Promise<ActionResult> {
  const dueDay = /^\d{4}-\d{2}-\d{2}$/.test(i.due) ? i.due : iso(c.now).slice(0, 10);
  await c.repos.tasks.create(c.ws, { leadId: lead.id, title: i.action.slice(0, 200), kind: "follow_up", assigneeId: lead.ownerId ?? c.uid, createdBy: c.uid, dueAt: istToIso(dueDay, "10:00") } as TaskInput);
  return okResult(msg.saved);
}

/** Dismissal is recorded as a note on the timeline (an ai_insights repository does not exist yet). */
export async function dismissSuggestion(c: Ctx, lead: Lead, reason: string, msg: { saved: string; note: string }): Promise<ActionResult> {
  await c.repos.activities.create(c.ws, { kind: "note", leadId: lead.id, ownerId: c.uid, subject: msg.note, body: reason, doneAt: iso(c.now), source: "manual" } as ActivityInput);
  return okResult(msg.saved);
}

// ---- export ----
const csvCell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const maskContact = (s: string) => s.replace(/^(.).*?(@.*)?$/, (_, a: string, b?: string) => `${a}***${b ?? ""}`);
export const maskPerson = (n: string) => n.split(" ").filter(Boolean).map((p) => p[0] + ".").join(" ");

/** Callers pass maskPersonal=true unless they hold pii.read and asked for unmasked data. */
export function buildCsv(rows: Lead[], opts: { maskPersonal: boolean; ownerNames: Record<string, string> }): string {
  const head = ["lead_id", "name", "title", "firm", "city", "status", "score", "owner", "source", "phone", "email", "created_at", "last_touch_at"];
  const m = opts.maskPersonal;
  const body = rows.map((l) => [
    l.id, m ? maskPerson(l.fullName) : l.fullName, l.roleTitle, l.firmName, l.city, l.status, l.score,
    l.ownerId ? opts.ownerNames[l.ownerId] ?? "" : "", l.source,
    m ? maskContact(l.phone ?? "") : l.phone, m ? maskContact(l.email ?? "") : l.email, l.createdAt, l.lastTouchAt,
  ].map(csvCell).join(","));
  return [head.join(","), ...body].join("\n");
}
