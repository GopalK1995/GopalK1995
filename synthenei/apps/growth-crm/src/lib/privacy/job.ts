// Queue handler for the retention job (maintenance queue, kind "privacy.retention"). Registered from jobs/handlers/index.ts.
// Triggered only by a scheduled_jobs row (shipped DISABLED, see docs/migrations-backlog.md "T052 needs") or an explicit enqueue.
// The payload decides the mode; anything other than "apply" is a dry run that changes nothing.
import "server-only";
import { registerHandler, type JobHandler } from "@/lib/jobs/registry";
import { runRetention, supabaseRetentionPort, type RunMode } from "./retention";
import { sweepDue } from "./alerts";
import { supabaseAlertPort } from "./alerts-supabase";

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

// ---------- purge of rows that retention already soft-deleted ----------
// Same pattern as T041's maintenance.purge_soft_deleted: a SQL function does the removal, a scheduled_jobs row (DISABLED) triggers it.
// The function public.privacy_purge(p_days) is a service-role wrapper from docs/migrations-backlog.md "T052 needs"; until it is applied
// the handler logs that and does nothing. A minimum of 30 days between soft delete and purge is enforced here AND in SQL.
export const PURGE_KIND = "privacy.purge";
export const PURGE_MIN_DAYS = 30;
export interface PurgePayload { retention_days?: number }

export const purgeHandler: JobHandler<PurgePayload> = async (p, ctx) => {
  const days = Math.floor(Number(p?.retention_days ?? 90));
  if (!Number.isFinite(days) || days < PURGE_MIN_DAYS) { ctx.log.warn("privacy.purge refused: retention below the minimum", { min: PURGE_MIN_DAYS }); return "done"; }
  const r = await (ctx.db as unknown as { rpc(fn: string, a: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string } | null }> }).rpc("privacy_purge", { p_days: days });
  if (r.error) {
    // 42883 / PGRST202: the function is not applied yet. Not a failure worth retrying in a loop.
    ctx.log.warn("privacy.purge did not run", { code: r.error.code ?? null });
    return r.error.code === "42883" || r.error.code === "PGRST202" ? "done" : "retry";
  }
  ctx.log.info("privacy.purge", { counts: r.data as Record<string, unknown> });
  return "done";
};
registerHandler("maintenance", PURGE_KIND, purgeHandler);

// ---------- response-clock sweep (AUD-064, PRIV-021) ----------
// Daily. Alerts the workspace owners once at due-5d and once when a request is overdue, then drops spent tokens. Reads open requests and
// writes events and notifications only; a request that fails is counted and the others still run. Counts only are logged.
export const DSR_DUE_KIND = "privacy.dsr_due";
export const dsrDueHandler: JobHandler<Record<string, never>> = async (_p, ctx) => {
  const db = ctx.db as never;
  const r = await sweepDue(supabaseAlertPort(db), Date.now());
  ctx.log.info("privacy.dsr_due", { scanned: r.scanned, due_soon: r.dueSoon, overdue: r.overdue, skipped: r.skipped, failed: r.failed });
  if (r.failed) ctx.log.warn("privacy.dsr_due: some requests could not be alerted", { n: r.failed });
  // Housekeeping is best effort: the function only exists after migration 0032.
  try {
    const p = await (ctx.db as unknown as { rpc(fn: string, a: Record<string, unknown>): PromiseLike<{ error: { code?: string } | null }> }).rpc("privacy_tokens_purge", {});
    if (p.error && p.error.code !== "42883" && p.error.code !== "PGRST202") ctx.log.warn("privacy_tokens_purge did not run", { code: p.error.code ?? null });
  } catch { /* ignore */ }
  return "done";   // the next daily run tries again; alerts are idempotent per (type, request)
};
registerHandler("maintenance", DSR_DUE_KIND, dsrDueHandler);
