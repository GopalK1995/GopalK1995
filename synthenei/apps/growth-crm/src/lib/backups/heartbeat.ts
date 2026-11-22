// Nightly logical heartbeat: schema fingerprint + per-workspace and per-tenant row counts, written to backup_checks.
// This is NOT a dump. Vercel cannot run pg_dump, so the full dump runs from the integrator machine (docs/backups-runbook.md)
// and records itself as a `logical_dump` row. The heartbeat proves the database is reachable, the schema has not silently
// changed and no table has shrunk, and it is the baseline the row-drop rule compares against.
import type { BackupStore } from "./ports";
import { TRACKED_TABLES } from "./tracked";

export interface HeartbeatResult { workspaces: number; written: number; failed: number; schemaHash: string | null; projectRow: boolean }

export async function runHeartbeat(store: BackupStore, opts: { now?: number; workspaceId?: string } = {}): Promise<HeartbeatResult> {
  const takenAt = new Date(opts.now ?? Date.now()).toISOString();
  const schema = await store.schema();
  const all = await store.workspaces();
  const targets = opts.workspaceId ? all.filter((w) => w.id === opts.workspaceId) : all;
  const res: HeartbeatResult = { workspaces: targets.length, written: 0, failed: 0, schemaHash: schema?.hash ?? null, projectRow: false };
  const tenants: Record<string, { workspaces: number; counts: Record<string, number> }> = {};

  for (const ws of targets) {
    try {
      const counts = await store.liveCounts(ws.id, TRACKED_TABLES);
      const counted = Object.values(counts).filter((v) => v !== null).length;
      const t = (tenants[ws.tenantId] ??= { workspaces: 0, counts: {} });
      t.workspaces++;
      for (const [k, v] of Object.entries(counts)) if (v !== null) t.counts[k] = (t.counts[k] ?? 0) + v;
      await store.insertCheck({
        workspaceId: ws.id, tenantId: ws.tenantId, kind: "heartbeat", status: counted === 0 ? "failed" : "success", takenAt, location: "logical:counts+schema",
        rowCounts: { v: 1, schema, counts },
        detail: counted === 0 ? "No table could be counted." : counted < TRACKED_TABLES.length ? `${TRACKED_TABLES.length - counted} tables could not be counted.` : null,
      });
      res.written++;
    } catch {
      res.failed++;   // one workspace failing must not stop the others; the missing row makes the stale-heartbeat rule fire for it
    }
  }

  // Project-wide row (workspace_id null): invisible to tenants under RLS, holds every tenant's totals for the operator.
  if (!opts.workspaceId) {
    try {
      await store.insertCheck({
        workspaceId: null, tenantId: null, kind: "heartbeat", status: res.failed === targets.length && targets.length > 0 ? "failed" : "success", takenAt,
        location: "logical:counts+schema", rowCounts: { v: 1, schema, tenants },
        detail: `${res.written} of ${targets.length} workspaces counted${schema ? "" : "; schema fingerprint unavailable"}.`,
      });
      res.projectRow = true;
    } catch { /* best effort; the per-workspace rows are what the page and the rules read */ }
  }
  return res;
}
