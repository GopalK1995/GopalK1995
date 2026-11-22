// Real BackupSnapshot for one workspace. READ ONLY: a page view never writes rules, heartbeats or notifications.
// Checks, rules, integrations and sync runs are read with the signed-in user's client (RLS: data_health.read, integrations.read).
// Live row counts use the service client for ONE reason: RLS hides soft-deleted and out-of-scope rows, so counts through the
// user's client would look like a drop against the heartbeat (which counts physical rows). The caller has already passed the
// data_health.read check for this workspace, and the query is filtered by that workspace id.
import "server-only";
import "@/lib/connectors/all";
import { dbForRequest } from "@/lib/db/client";
import { serviceDb } from "@/lib/db/service";
import type { BackupSnapshot, BackupCheck, DrillLogEntry } from "@/lib/data/backup";
import { loadWorkspaceHealth } from "./evaluate";
import type { CheckRow } from "./ports";
import { supabaseBackupStore } from "./store";
import { STALE_AFTER_HOURS } from "./types";

const NOT_COVERED = [
  "Supabase Storage objects (files)", "Edge Functions code and secrets",
  "Anything outside the Postgres database (e.g. CSV originals)", "Vault secrets are not in a logical dump; they are re-entered on restore",
];

export const parseDrillDetail = (d: string | null): { durationMin: number; notes: string } => {
  if (!d) return { durationMin: 0, notes: "" };
  try {
    const j = JSON.parse(d) as { durationMin?: unknown; notes?: unknown };
    return { durationMin: Number.isFinite(Number(j.durationMin)) ? Number(j.durationMin) : 0, notes: typeof j.notes === "string" ? j.notes : "" };
  } catch { return { durationMin: 0, notes: d.slice(0, 300) }; }
};

const asCheck = (kind: BackupCheck["kind"], c: CheckRow | null, label: string, detail: string): BackupCheck =>
  c ? { kind, status: c.status, takenAt: c.takenAt, sizeBytes: c.sizeBytes, location: c.location ?? label, detail: c.detail ?? detail }
    : { kind, status: "missing", takenAt: null, sizeBytes: null, location: label, detail };

export async function realSnapshot(ws: { uuid: string; tenantId: string }, now = Date.now()): Promise<BackupSnapshot> {
  const req = supabaseBackupStore(await dbForRequest());
  const store = { ...req, liveCounts: supabaseBackupStore(serviceDb()).liveCounts };
  const tenantId = ws.tenantId ?? "";
  const h = await loadWorkspaceHealth(store, { id: ws.uuid, tenantId }, now, { readOnly: true });
  const [dump, daily, drills] = await Promise.all([
    store.latestCheck(ws.uuid, "logical_dump"), store.latestCheck(ws.uuid, "supabase_daily"), store.checks(ws.uuid, "restore_drill", 20),
  ]);
  const schema = (h.heartbeat?.rowCounts as { schema?: { hash: string; tables: number; columns: number } | null } | null)?.schema ?? null;
  const drillLog: DrillLogEntry[] = drills.map((d) => ({ at: d.takenAt ?? d.checkedAt, result: d.status === "success" ? "pass" : "fail", ...parseDrillDetail(d.detail) }));
  const passDrill = drills.find((d) => d.status === "success") ?? null;
  return {
    isMock: false, generatedAt: new Date(now).toISOString(), retentionDays: daily?.retentionDays ?? null, pitrEnabled: daily?.pitr ?? null,
    staleAfterHours: STALE_AFTER_HOURS,
    checks: [
      asCheck("heartbeat", h.heartbeat, "logical heartbeat", "No heartbeat recorded yet. The nightly job writes one."),
      asCheck("logical_dump", dump, "integrator machine", "No full dump recorded. Run the runbook and record it."),
      asCheck("supabase_daily", daily, "supabase-managed", "Supabase has no API for backup status; nothing records this row yet."),
      asCheck("restore_drill", passDrill, "scratch database", "No passing restore drill logged."),
    ],
    tableCounts: h.input.counts,
    alertRules: h.rules.map((r) => ({ ...r, state: h.states[r.id]?.state ?? "unknown", detail: h.states[r.id]?.findings[0]?.detail ?? null })),
    rulesPersisted: h.rules.length > 0,
    drillLog, notCovered: NOT_COVERED, freshness: h.input.freshness,
    heartbeat: h.heartbeat ? { at: h.heartbeat.takenAt, schemaHash: schema?.hash ?? null, tables: schema?.tables ?? null, columns: schema?.columns ?? null } : null,
  };
}
