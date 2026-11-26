// Consent rows for one data subject. New consent_log.subject_ref values are salted in the database (migration 0026, 'h1:' + HMAC), so
// an equality match on the plain sha256 no longer finds them. consent_log_for_subject() matches the legacy and the salted form
// without exposing the HMAC. Before that migration exists (or when the RPC is refused) this falls back to the direct table query,
// which is exactly the old behaviour, so the app works both before and after the owner applies the migration.
import type { Db } from "@/lib/db/client";
import { from, type Qb, type QResult } from "@/lib/db/query";

export async function consentRowsForSubject(
  db: Db, workspaceId: string, subjectRef: string, cols: string, opts: { ascending: boolean; limit: number },
): Promise<QResult> {
  try {
    const rpc = (db as unknown as { rpc(fn: string, args: Record<string, unknown>): Qb }).rpc("consent_log_for_subject", { p_workspace: workspaceId, p_ref: subjectRef });
    const r = await rpc.select(cols).order("occurred_at", { ascending: opts.ascending }).limit(opts.limit);
    if (!r.error) return r;
  } catch { /* function missing (migration not applied) or client without rpc: use the table */ }
  return from(db, "consent_log").select(cols).eq("workspace_id", workspaceId).eq("subject_ref", subjectRef)
    .order("occurred_at", { ascending: opts.ascending }).limit(opts.limit);
}
