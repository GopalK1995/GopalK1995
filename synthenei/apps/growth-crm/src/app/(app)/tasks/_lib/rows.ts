// Maps whatever ds.tasks() returns (demo Task, or the raw camelCased tasks table row in real mode) to the UI Task shape.
// Real rows carry assigneeId, priority 1..3, status open|done|snoozed|cancelled, free-text kind and a version (migration 0014).
import type { Task } from "@/lib/data/types";

export type NormTask = Task & { version: number | null; firstResponse: boolean };
const KINDS: Task["kind"][] = ["call", "whatsapp", "email", "demo", "follow_up", "proposal"];
export const PRIORITY_NUM: Record<Task["priority"], number> = { high: 1, normal: 2, low: 3 };
const PRIORITY: Record<number, Task["priority"]> = { 1: "high", 2: "normal", 3: "low" };

function kindOf(raw: string): { kind: Task["kind"]; firstResponse: boolean } {
  if ((KINDS as string[]).includes(raw)) return { kind: raw as Task["kind"], firstResponse: false };
  if (raw === "demo_prep") return { kind: "demo", firstResponse: false };
  if (raw === "first_response" || raw === "first_contact") return { kind: "call", firstResponse: true };
  return { kind: "follow_up", firstResponse: false };
}

/** Returns open (and snoozed) tasks only; done and cancelled rows are not shown on the task screens. */
export function normTasks(raw: unknown[]): NormTask[] {
  const out: NormTask[] = [];
  for (const x of raw) {
    const r = x as Record<string, unknown>;
    const status = String(r.status ?? "open");
    if (status === "done" || status === "cancelled") continue;
    const { kind, firstResponse } = kindOf(String(r.kind ?? ""));
    const p = r.priority;
    out.push({
      id: String(r.id), leadId: (r.leadId as string | null) ?? null, dealId: (r.dealId as string | null) ?? null, title: String(r.title ?? ""),
      kind, firstResponse, ownerId: String((r.ownerId ?? r.assigneeId ?? "") as string), dueAt: String(r.dueAt),
      status: "open", priority: typeof p === "number" ? PRIORITY[p] ?? "normal" : p === "high" || p === "low" ? p : "normal",
      version: typeof r.version === "number" ? r.version : null,
    });
  }
  return out;
}
