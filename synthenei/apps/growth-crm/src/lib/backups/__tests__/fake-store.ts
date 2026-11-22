// In-memory BackupStore for unit tests: same shape as the Supabase adapter (store.ts) but no network or database.
import type { AlertRule, RuleDraft } from "../types";
import type { IntegrationLite, RunLite } from "../freshness";
import type { BackupStore, CheckKindDb, CheckRow, NewCheck, NotifyRow, SchemaInfo, WorkspaceRef } from "../ports";

export class FakeStore implements BackupStore {
  wss: WorkspaceRef[] = [];
  rulesByWs = new Map<string, AlertRule[]>();
  checksList: (CheckRow & { workspaceId: string | null })[] = [];
  counts: Record<string, Record<string, number | null>> = {};
  ints: Record<string, IntegrationLite[]> = {};
  runsByWs: Record<string, RunLite[]> = {};
  recipientsByWs: Record<string, string[]> = {};
  notifiedKeys = new Set<string>();
  notifyRows: NotifyRow[] = [];
  schemaInfo: SchemaInfo | null = { hash: "fake-hash", tables: 10, columns: 100 };
  cadences: Record<string, number | null> = {};
  nextId = 1;

  async workspaces() { return this.wss; }
  async rules(ws: string) { return this.rulesByWs.get(ws) ?? []; }
  async insertRules(ws: WorkspaceRef, drafts: RuleDraft[]) {
    this.rulesByWs.set(ws.id, drafts.map((d, i) => ({ ...d, id: `r-${ws.id}-${i}` })));
  }
  async latestCheck(ws: string | null, kind: CheckKindDb, onlySuccess?: boolean) {
    const rows = this.checksList.filter((c) => c.workspaceId === ws && c.kind === kind && (!onlySuccess || c.status === "success"));
    return rows.sort((a, b) => (b.takenAt ?? "").localeCompare(a.takenAt ?? ""))[0] ?? null;
  }
  async checks(ws: string, kind: CheckKindDb, limit: number) {
    return this.checksList.filter((c) => c.workspaceId === ws && c.kind === kind).sort((a, b) => (b.takenAt ?? "").localeCompare(a.takenAt ?? "")).slice(0, limit);
  }
  async insertCheck(c: NewCheck) {
    const id = this.nextId++;
    this.checksList.push({
      id, workspaceId: c.workspaceId, kind: c.kind, status: c.status, checkedAt: c.takenAt, takenAt: c.takenAt,
      sizeBytes: c.sizeBytes ?? null, retentionDays: null, pitr: null, location: c.location ?? null, rowCounts: c.rowCounts ?? null, detail: c.detail ?? null,
    });
    return id;
  }
  async liveCounts(ws: string, tables: readonly string[]) {
    const c = this.counts[ws] ?? {};
    return Object.fromEntries(tables.map((t) => [t, c[t] ?? null]));
  }
  async integrations(ws: string) { return this.ints[ws] ?? []; }
  async runs(ws: string, sinceIso: string) { return (this.runsByWs[ws] ?? []).filter((r) => r.startedAt >= sinceIso); }
  async recipients(ws: string) { return this.recipientsByWs[ws] ?? []; }
  async notified(_ws: string, _userIds: string[], keys: string[]) { return new Set(keys.filter((k) => this.notifiedKeys.has(k))); }
  /** Mirrors production: a dedupe key written to body.dedupe is what the next `notified()` call sees. */
  async notify(rows: NotifyRow[]) {
    this.notifyRows.push(...rows);
    for (const r of rows) { const k = r.body.dedupe; if (k) this.notifiedKeys.add(k); }
  }
  async schema() { return this.schemaInfo; }
  cadenceOf = (connectorId: string, stream: string | null) => this.cadences[`${connectorId}:${stream ?? ""}`] ?? null;
}

export const mkWs = (id = "ws-1", tenantId = "t-1"): WorkspaceRef => ({ id, tenantId });
