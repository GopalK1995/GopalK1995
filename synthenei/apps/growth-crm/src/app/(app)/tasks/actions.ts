"use server";
// Task mutations (spec 5 /tasks): Owner F, Sales Manager F (team), Rep/Marketing/Data E (own), Viewer none.
// Re-checked on the server: page access for the role, read-only support sessions, own-only for E roles.
import { pageCtx } from "@/lib/data/context";
import { accessFor, can, canEdit, ROLE_LABEL } from "@/lib/auth/roles";
import type { Task } from "@/lib/data/types";
import type { Result } from "../leads/_lib/sales";

const DEMO_SUB = "Demo workspace: nothing was saved.";
const KINDS: Task["kind"][] = ["call", "whatsapp", "email", "demo", "follow_up", "proposal"];

async function guard() {
  const ctx = await pageCtx();
  const access = accessFor(ctx.role, "/tasks");
  if (!canEdit(access)) return { ctx, error: `Your role (${ROLE_LABEL[ctx.role]}) cannot change tasks.` };
  if (ctx.support?.mode === "read_only") return { ctx, error: "Not available in a read-only support session." };
  return { ctx, error: null as string | null };
}
const manages = (role: string) => role === "owner" || role === "sales_manager";

async function ownTasks(ids: string[]) {
  const g = await guard();
  if (g.error) return { ...g, tasks: [] as Task[] };
  const all = await g.ctx.ds.tasks();
  const tasks = all.filter((t) => ids.includes(t.id));
  if (!tasks.length) return { ...g, error: "Task not found in this workspace.", tasks };
  if (!manages(g.ctx.role) && tasks.some((t) => t.ownerId !== g.ctx.session.uid)) return { ...g, error: "You can change only your own tasks.", tasks };
  return { ...g, tasks };
}

export async function completeTasks(ids: string[]): Promise<Result> {
  const g = await ownTasks(ids);
  if (g.error) return { ok: false, message: g.error };
  return { ok: true, message: g.tasks.length === 1 ? `Done: ${g.tasks[0].title}` : `${g.tasks.length} tasks marked done`, sub: DEMO_SUB };
}

export async function rescheduleTask(id: string, dueIso: string, label: string): Promise<Result> {
  const g = await ownTasks([id]);
  if (g.error) return { ok: false, message: g.error };
  const t = Date.parse(dueIso);
  if (!Number.isFinite(t)) return { ok: false, message: "Pick a valid date and time." };
  if (t < Date.parse(g.ctx.now) - 60e3) return { ok: false, message: "That time has already passed." };
  return { ok: true, message: `Moved to ${label}`, sub: `${g.tasks[0].title}. ${DEMO_SUB}` };
}

export async function reassignTask(id: string, ownerId: string): Promise<Result> {
  const g = await ownTasks([id]);
  if (g.error) return { ok: false, message: g.error };
  if (!can("assignLeads", { role: g.ctx.role, support: g.ctx.support })) return { ok: false, message: "Only Owner and Sales Manager reassign tasks." };
  const m = (await g.ctx.ds.team()).find((x) => x.id === ownerId);
  if (!m) return { ok: false, message: "Pick someone in this workspace." };
  return { ok: true, message: `Reassigned to ${m.name}`, sub: DEMO_SUB };
}

export async function createTask(input: { title: string; kind: string; due: string; leadId: string; priority: string }): Promise<Result> {
  const g = await guard();
  if (g.error) return { ok: false, message: g.error };
  const title = input.title.trim();
  if (title.length < 3 || title.length > 120) return { ok: false, message: "Give the task a title (3 to 120 characters)." };
  if (!KINDS.includes(input.kind as Task["kind"])) return { ok: false, message: "Pick a task type." };
  if (!Number.isFinite(Date.parse(input.due))) return { ok: false, message: "Pick a due date and time." };
  if (!["high", "normal", "low"].includes(input.priority)) return { ok: false, message: "Pick a priority." };
  if (input.leadId) {
    const lead = await g.ctx.ds.lead(input.leadId);
    if (!lead) return { ok: false, message: "Lead not found in this workspace." };
    if (g.ctx.role === "sales_rep" && lead.ownerId !== g.ctx.session.uid) return { ok: false, message: "You can add tasks only to your own leads." };
  }
  return { ok: true, message: `Task created: ${title}`, sub: DEMO_SUB };
}
