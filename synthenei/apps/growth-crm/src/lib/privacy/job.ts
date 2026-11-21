// Queue handler for the retention job (maintenance queue, kind "privacy.retention"). Registered from jobs/handlers/index.ts.
// Triggered only by a scheduled_jobs row (shipped DISABLED, see docs/migrations-backlog.md "T052 needs") or an explicit enqueue.
// The payload decides the mode; anything other than "apply" is a dry run that changes nothing.
import "server-only";
import { registerHandler, type JobHandler } from "@/lib/jobs/registry";
import { runRetention, supabaseRetentionPort, type RunMode } from "./retention";

export const RETENTION_KIND = "privacy.retention";
export interface RetentionPayload { mode?: RunMode; tenant_id?: string | null }

export const retentionHandler: JobHandler<RetentionPayload> = async (p, ctx) => {
  const mode: RunMode = p?.mode === "apply" ? "apply" : "plan";
  const out = await runRetention(supabaseRetentionPort(ctx.db as never), { mode, tenantId: p?.tenant_id ?? ctx.tenantId ?? null, now: Date.now(), deadline: ctx.deadline });
  // Counts only: nothing personal is logged. These lines are the run record (the job has no user, so no audit_record row).
  for (const o of out) ctx.log.info("retention policy", { mode, tenant: o.tenantId, object: o.objectType, kind: o.kind, matched: o.matched, changed: o.changed, capped: o.capped, error: o.error ?? null });
  const failed = out.filter((o) => o.error);
  if (failed.length) ctx.log.warn("retention policies with errors", { n: failed.length });
  return "done";   // a failed policy is reported, not retried in a loop: the next scheduled run tries again
};

registerHandler("maintenance", RETENTION_KIND, retentionHandler);
