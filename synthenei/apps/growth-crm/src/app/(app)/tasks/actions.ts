"use server";
// Task mutations. Real sessions: assertCan (record-level, rep scope = own) -> repository write with expected version -> ActionResult.
// Audit rows and task.* events are written by DB triggers (migration 0014), so "Saved" is only returned after the commit.
// Demo sessions never touch Supabase: each action validates and returns what would have happened.
import { pageCtx } from "@/lib/data/context";
import { accessFor, can, canEdit, ROLE_LABEL } from "@/lib/auth/roles";
import { vocabFor } from "@/lib/vertical";
import { assertCan } from "@/lib/authz/load";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { DbError } from "@/lib/db/errors";
import { tasksRepo } from "@/lib/db/repo/tasks";
import { leadsRepo } from "@/lib/db/repo/leads";
import type { TaskRow } from "@/lib/db/repo/types";
import * as P from "./_lib/persist";
import { createTaskSchema, editTaskSchema, idsSchema, reassignSchema, rescheduleSchema } from "./_lib/schemas";
import { normTasks } from "./_lib/rows";
import { tt } from "./_lib/strings";

type Ctx = Awaited<ReturnType<typeof pageCtx>>;
const repos: P.Repos = { tasks: tasksRepo };
const pctx = (ctx: Ctx): P.Ctx => ({ ws: ctx.active.ws.uuid, uid: ctx.session.uid, now: new Date(), repos });
const manages = (role: string) => role === "owner" || role === "sales_manager";
const deny = (msg: string): ActionResult => failResult("denied", msg);
const recOf = (ctx: Ctx, id: string, ownerId: string | null) => ({ type: "task" as const, id, workspaceId: ctx.active.ws.id, ownerId, assigneeId: ownerId });
const invalid = (e: { issues: { path: PropertyKey[]; message: string }[] }): ActionResult =>
  failResult("invalid", e.issues[0]?.message ?? "Some values are not valid.", { issues: e.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) });

/** Wraps a real-mode body: AuthzError -> denied, DbError -> code, and a conflict carries only the current version (never the row). */
async function real<T>(ctx: Ctx, fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const r = await runAction(fn);
  if (r.ok) return r;
  const t = tt(vocabFor(ctx.active.tenant));
  if (r.code === "denied") return { ...r, message: t("deniedTitle"), sub: ctx.support ? t("deniedSupport") : undefined };
  if (r.code === "conflict") {
    const v = (r.current as { version?: number } | undefined)?.version;
    return { ...r, message: t("conflictTitle"), sub: t("conflictBody"), current: v === undefined ? undefined : { version: v } };
  }
  if (r.code === "not_found") return { ...r, message: t("notFound") };
  if (r.code === "error") return { ...r, message: t("errorTitle"), sub: t("errorBody") };
  return r;
}

/** Real mode: load the task and enforce the permission on THAT record (own scope = assignee), return it. */
async function realTask(ctx: Ctx, perm: string, id: string): Promise<TaskRow> {
  const row = await tasksRepo.get(ctx.active.ws.uuid, id);
  if (!row) throw new DbError("not_found", "not_found");
  await assertCan(perm, recOf(ctx, row.id, row.assigneeId));
  return row;
}

/** Demo guard: page access for the role, read-only support sessions, own-only for E roles, workspace membership. */
async function demoTasks(ctx: Ctx, ids: string[]): Promise<{ error: ActionResult } | { tasks: ReturnType<typeof normTasks> }> {
  const t = tt(vocabFor(ctx.active.tenant));
  if (!canEdit(accessFor(ctx.role, "/tasks"))) return { error: deny(`Your role (${ROLE_LABEL[ctx.role]}) cannot change tasks.`) };
  if (ctx.support?.mode === "read_only") return { error: deny(t("deniedSupport")) };
  const tasks = normTasks(await ctx.ds.tasks()).filter((x) => ids.includes(x.id));
  if (!tasks.length) return { error: failResult("not_found", t("notFound")) };
  if (!manages(ctx.role) && tasks.some((x) => x.ownerId !== ctx.session.uid)) return { error: deny(t("onlyOwn")) };
  return { tasks };
}

const futureCheck = (ctx: Ctx, dueIso: string) => Date.parse(dueIso) >= Date.parse(ctx.now) - 60e3;

export async function completeTasks(ids: string[]): Promise<ActionResult> {
  const ctx = await pageCtx();
  const t = tt(vocabFor(ctx.active.tenant));
  const p = idsSchema.safeParse(ids);
  if (ctx.session.demo) {
    const g = await demoTasks(ctx, ids);
    if ("error" in g) return g.error;
    return okResult(g.tasks.length === 1 ? t("doneOne", { title: g.tasks[0].title }) : t("doneMany", { n: g.tasks.length }), { sub: t("demoNotice") });
  }
  return real(ctx, async () => {
    if (!p.success) return invalid(p.error);
    // All or none: every task must pass its own record-level check before any is completed.
    const rows: TaskRow[] = [];
    for (const id of p.data) rows.push(await realTask(ctx, "tasks.write", id));
    return P.complete(pctx(ctx), p.data, { done: rows.length === 1 ? t("doneOne", { title: rows[0].title }) : t("doneMany", { n: rows.length }) });
  });
}

async function moveTo(kind: "moved" | "snoozed", id: string, dueIso: string, label: string, expectedVersion?: number): Promise<ActionResult<{ version: number }>> {
  const ctx = await pageCtx();
  const t = tt(vocabFor(ctx.active.tenant));
  if (!Number.isFinite(Date.parse(dueIso))) return failResult("invalid", t("pickTime"));
  if (!futureCheck(ctx, dueIso)) return failResult("invalid", t("passed"));
  if (ctx.session.demo) {
    const g = await demoTasks(ctx, [id]);
    if ("error" in g) return g.error as ActionResult<{ version: number }>;
    return okResult(t(kind, { when: label }), { sub: `${g.tasks[0].title}. ${t("demoNotice")}` });
  }
  const p = rescheduleSchema.safeParse({ expectedVersion, due: dueIso });
  return real(ctx, async () => {
    await realTask(ctx, "tasks.write", id);
    if (!p.success) return invalid(p.error) as ActionResult<{ version: number }>;
    return P.reschedule(pctx(ctx), id, p.data.expectedVersion, p.data.due, { moved: t(kind, { when: label }) });
  });
}
export async function rescheduleTask(id: string, dueIso: string, label: string, expectedVersion?: number) {
  return moveTo("moved", id, dueIso, label, expectedVersion);
}
export async function snoozeTask(id: string, dueIso: string, label: string, expectedVersion?: number) {
  return moveTo("snoozed", id, dueIso, label, expectedVersion);
}

export async function reassignTask(id: string, ownerId: string, expectedVersion?: number): Promise<ActionResult<{ version: number }>> {
  const ctx = await pageCtx();
  const t = tt(vocabFor(ctx.active.tenant));
  const members = (await ctx.ds.team()).filter((x) => x.role === "sales_rep" || x.role === "sales_manager");
  const m = members.find((x) => x.id === ownerId);
  if (ctx.session.demo) {
    const g = await demoTasks(ctx, [id]);
    if ("error" in g) return g.error as ActionResult<{ version: number }>;
    if (!can("assignLeads", { role: ctx.role, support: ctx.support })) return deny(t("onlyManagers")) as ActionResult<{ version: number }>;
    if (!m) return failResult("invalid", t("pickPerson"));
    return okResult(t("reassigned", { name: m.name }), { sub: t("demoNotice") });
  }
  const p = reassignSchema.safeParse({ expectedVersion, ownerId });
  return real(ctx, async () => {
    await realTask(ctx, "tasks.write", id);
    await assertCan("tasks.assign", recOf(ctx, id, ownerId));
    if (!m) return failResult("invalid", t("pickPerson"));
    if (!p.success) return invalid(p.error) as ActionResult<{ version: number }>;
    return P.reassign(pctx(ctx), id, p.data.expectedVersion, p.data.ownerId, { reassigned: t("reassigned", { name: m.name }) });
  });
}

export async function createTask(input: { title: string; kind: string; due: string; leadId: string; priority: string; assigneeId?: string | null }): Promise<ActionResult<{ id: string; version: number }>> {
  const ctx = await pageCtx();
  const t = tt(vocabFor(ctx.active.tenant));
  const p = createTaskSchema.safeParse(input);
  if (ctx.session.demo) {
    if (!canEdit(accessFor(ctx.role, "/tasks"))) return deny(`Your role (${ROLE_LABEL[ctx.role]}) cannot change tasks.`) as ActionResult<{ id: string; version: number }>;
    if (ctx.support?.mode === "read_only") return deny(t("deniedSupport")) as ActionResult<{ id: string; version: number }>;
    if (!p.success) return invalid(p.error) as ActionResult<{ id: string; version: number }>;
    if (p.data.leadId) {
      const lead = await ctx.ds.lead(p.data.leadId);
      if (!lead) return failResult("not_found", t("leadNotFound"));
      if (ctx.role === "sales_rep" && lead.ownerId !== ctx.session.uid) return deny(t("ownLeads")) as ActionResult<{ id: string; version: number }>;
    }
    return okResult(t("created", { title: p.data.title }), { sub: t("demoNotice") });
  }
  return real(ctx, async () => {
    if (!p.success) return invalid(p.error) as ActionResult<{ id: string; version: number }>;
    const assignee = p.data.assigneeId ?? ctx.session.uid;
    // Own scope: a rep can create only for themselves; assigning to someone else needs the wider scope or tasks.assign.
    await assertCan("tasks.write", recOf(ctx, "", assignee));
    if (assignee !== ctx.session.uid) await assertCan("tasks.assign", recOf(ctx, "", assignee));
    if (p.data.leadId) {
      const lead = await leadsRepo.get(ctx.active.ws.uuid, p.data.leadId);
      if (!lead) return failResult("not_found", t("leadNotFound"));
      await assertCan("leads.read", { type: "lead", id: lead.id, workspaceId: ctx.active.ws.id, ownerId: lead.ownerId });
    }
    if (!futureCheck(ctx, p.data.due)) return failResult("invalid", t("passed"));
    const r = await P.create(pctx(ctx), p.data, { created: t("created", { title: p.data.title }) });
    return r.ok ? { ...r, sub: t("createdSub") } : r;
  });
}

export async function editTask(id: string, input: unknown): Promise<ActionResult<{ version: number }>> {
  const ctx = await pageCtx();
  const t = tt(vocabFor(ctx.active.tenant));
  const p = editTaskSchema.safeParse(input);
  if (ctx.session.demo) {
    const g = await demoTasks(ctx, [id]);
    if ("error" in g) return g.error as ActionResult<{ version: number }>;
    if (!p.success) return invalid(p.error) as ActionResult<{ version: number }>;
    return okResult(t("saved"), { sub: t("demoNotice") });
  }
  return real(ctx, async () => {
    await realTask(ctx, "tasks.write", id);
    if (!p.success) return invalid(p.error) as ActionResult<{ version: number }>;
    if (p.data.patch.due && !futureCheck(ctx, p.data.patch.due)) return failResult("invalid", t("passed"));
    return P.edit(pctx(ctx), id, p.data.expectedVersion, p.data.patch, { saved: t("saved") });
  });
}
