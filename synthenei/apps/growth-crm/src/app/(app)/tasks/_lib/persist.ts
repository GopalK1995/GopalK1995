// Real-mode persistence for task actions. Pure over injected repositories so it is unit-testable with the mocked client.
// assertCan (record-level) runs in actions.ts BEFORE any of these; audit rows and task.* events come from DB triggers (0014).
import { okResult, type ActionResult } from "@/lib/actions/result";
import type { TaskInput, TaskRow } from "@/lib/db/repo/types";
import { PRIORITY_NUM } from "./rows";
import type { CreateTaskInput } from "./schemas";

export interface Repos {
  tasks: {
    create(ws: string, input: TaskInput): Promise<TaskRow>;
    update(ws: string, id: string, v: number, patch: Partial<TaskInput> & Record<string, unknown>): Promise<TaskRow>;
    complete(ws: string, ids: string[]): Promise<void>;
  };
}
export interface Ctx { ws: string; uid: string; now: Date; repos: Repos }

const iso = (s: string) => new Date(s).toISOString();

export async function create(c: Ctx, i: CreateTaskInput, msg: { created: string }): Promise<ActionResult<{ id: string; version: number }>> {
  const row = await c.repos.tasks.create(c.ws, {
    title: i.title, kind: i.kind, priority: PRIORITY_NUM[i.priority], dueAt: iso(i.due),
    leadId: i.leadId || null, assigneeId: i.assigneeId ?? c.uid, createdBy: c.uid, status: "open",
  } as TaskInput);
  return okResult(msg.created, { data: { id: row.id, version: row.version } });
}

export async function edit(c: Ctx, id: string, expectedVersion: number, p: { title?: string; kind?: string; priority?: string; due?: string }, msg: { saved: string }): Promise<ActionResult<{ version: number }>> {
  const patch: Record<string, unknown> = {};
  if (p.title !== undefined) patch.title = p.title;
  if (p.kind !== undefined) patch.kind = p.kind;
  if (p.priority !== undefined) patch.priority = PRIORITY_NUM[p.priority as keyof typeof PRIORITY_NUM];
  if (p.due !== undefined) patch.dueAt = iso(p.due);
  const row = await c.repos.tasks.update(c.ws, id, expectedVersion, patch);
  return okResult(msg.saved, { data: { version: row.version } });
}

/** Reschedule and snooze are the same write (due_at moves, status stays open). */
export async function reschedule(c: Ctx, id: string, expectedVersion: number, due: string, msg: { moved: string }): Promise<ActionResult<{ version: number }>> {
  const row = await c.repos.tasks.update(c.ws, id, expectedVersion, { dueAt: iso(due) });
  return okResult(msg.moved, { data: { version: row.version } });
}

export async function reassign(c: Ctx, id: string, expectedVersion: number, ownerId: string, msg: { reassigned: string }): Promise<ActionResult<{ version: number }>> {
  const row = await c.repos.tasks.update(c.ws, id, expectedVersion, { assigneeId: ownerId });
  return okResult(msg.reassigned, { data: { version: row.version } });
}

export async function complete(c: Ctx, ids: string[], msg: { done: string }): Promise<ActionResult> {
  await c.repos.tasks.complete(c.ws, ids);
  return okResult(msg.done);
}
