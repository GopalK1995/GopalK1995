// scheduled_jobs materialiser: turns due rows into queue messages and advances next_run_at.
import type { SupabaseClient } from "@supabase/supabase-js";
import { nextCronRun } from "./cron";
import type { QueuePort } from "./ports";
import type { QueueName } from "./queues";

interface SchedRow { id: string; tenant_id: string | null; workspace_id: string | null; kind: string; cron: string; tz: string; payload: Record<string, unknown> | null; next_run_at: string | null }

/** kind prefix to queue; anything else goes to maintenance. */
export function queueForKind(kind: string): QueueName {
  if (kind.startsWith("connector.")) return "connector_sync";
  if (kind.startsWith("import.")) return "import";
  if (kind.startsWith("notify.")) return "notify";
  if (kind.startsWith("webhook.")) return "webhook_out";
  return "maintenance";
}

export interface MaterialiseResult { enqueued: number; initialised: number; skipped: number }

/**
 * Safe to run from several ticks at once: a row is claimed with a compare-and-set on next_run_at, so only one caller
 * enqueues a given occurrence. Rows with no next_run_at are initialised, not run.
 */
export async function materialiseDue(db: SupabaseClient, port: QueuePort, now: number = Date.now(), limit = 50): Promise<MaterialiseResult> {
  const res: MaterialiseResult = { enqueued: 0, initialised: 0, skipped: 0 };
  const iso = new Date(now).toISOString();
  const { data, error } = await db.from("scheduled_jobs")
    .select("id, tenant_id, workspace_id, kind, cron, tz, payload, next_run_at")
    .eq("enabled", true).or(`next_run_at.is.null,next_run_at.lte.${iso}`).limit(limit);
  if (error) throw new Error(`scheduled_jobs read: ${error.message}`);
  for (const r of (data ?? []) as SchedRow[]) {
    let next: number | null;
    try { next = nextCronRun(r.cron, r.tz, now); } catch { res.skipped++; continue; }
    if (next === null) { res.skipped++; continue; }
    const claim = db.from("scheduled_jobs");
    const patch = r.next_run_at === null
      ? { next_run_at: new Date(next).toISOString() }
      : { next_run_at: new Date(next).toISOString(), last_run_at: iso };
    const q = claim.update(patch).eq("id", r.id);
    const { data: won, error: ce } = await (r.next_run_at === null ? q.is("next_run_at", null) : q.eq("next_run_at", r.next_run_at)).select("id");
    if (ce) throw new Error(`scheduled_jobs claim: ${ce.message}`);
    if (!won || won.length === 0) { res.skipped++; continue; }
    if (r.next_run_at === null) { res.initialised++; continue; }
    await port.send(queueForKind(r.kind), {
      kind: r.kind, tenant_id: r.tenant_id,
      payload: { ...(r.payload ?? {}), scheduled_job_id: r.id, workspace_id: r.workspace_id, due_at: r.next_run_at },
    }, 0);
    res.enqueued++;
  }
  return res;
}
