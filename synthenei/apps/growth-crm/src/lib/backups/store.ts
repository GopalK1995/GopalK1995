// Supabase implementation of BackupStore. Pass the SERVICE client from jobs; pages read through the request client where RLS
// applies (see src/lib/data/backup.ts). Every query is scoped by workspace_id. Server only.
import "server-only";
import { createHash } from "node:crypto";
import type { Db } from "@/lib/db/client";
import { throwIfError } from "@/lib/db/errors";
import { from } from "@/lib/db/query";
import { getConnector } from "@/lib/connectors/registry";
import { nextCronRun } from "@/lib/jobs/cron";
import { cadenceFromCron } from "./freshness";
import type { BackupStore, CheckKindDb, CheckRow, SchemaInfo } from "./ports";
import { checkToKind, type AlertRule, type RuleDraft, KIND_TO_CHECK } from "./types";

type R = Record<string, unknown>;
const rows = (d: unknown) => ((d as R[] | null) ?? []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export const toRule = (r: R): AlertRule => ({
  id: String(r.id), kind: checkToKind(String(r.check_kind)), name: String(r.name), condition: String(r.condition),
  maxAgeHours: num(r.max_age_hours), maxDropPct: num(r.max_size_drop_pct), notifyTo: String(r.notify_to), enabled: r.enabled === true,
});
export const toCheck = (r: R): CheckRow => ({
  id: Number(r.id), kind: String(r.check_kind), status: r.status as CheckRow["status"], checkedAt: String(r.checked_at), takenAt: str(r.backup_taken_at),
  sizeBytes: num(r.size_bytes), retentionDays: num(r.retention_days), pitr: typeof r.pitr_enabled === "boolean" ? r.pitr_enabled : null,
  location: str(r.location), rowCounts: (r.row_counts as Record<string, unknown> | null) ?? null, detail: str(r.detail),
});
export const ruleToRow = (d: RuleDraft) => ({
  name: d.name, check_kind: d.kind ? KIND_TO_CHECK[d.kind] : "unknown", condition: d.condition, max_age_hours: d.maxAgeHours,
  max_size_drop_pct: d.maxDropPct, notify_to: d.notifyTo, enabled: d.enabled,
});

/** Hash of "table.column" lines from the PostgREST OpenAPI document (service role). Null when it cannot be read. */
export async function fetchSchemaInfo(fetchImpl: typeof fetch = fetch): Promise<SchemaInfo | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetchImpl(`${url.replace(/\/$/, "")}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" } });
    if (!res.ok) return null;
    return schemaInfoFromOpenApi(await res.json());
  } catch { return null; }
}
export function schemaInfoFromOpenApi(doc: unknown): SchemaInfo | null {
  const defs = (doc as { definitions?: Record<string, { properties?: Record<string, unknown> }> } | null)?.definitions;
  if (!defs || typeof defs !== "object") return null;
  const lines: string[] = [];
  for (const [t, d] of Object.entries(defs)) for (const c of Object.keys(d?.properties ?? {})) lines.push(`${t}.${c}`);
  if (!lines.length) return null;
  lines.sort();
  return { hash: createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16), tables: Object.keys(defs).length, columns: lines.length };
}

export function supabaseBackupStore(db: Db, deps: { schema?: () => Promise<SchemaInfo | null> } = {}): BackupStore {
  const countOf = async (table: string, ws: string): Promise<number | null> => {
    const q = (db as unknown as { from(t: string): { select(c: string, o: { count: "exact"; head: true }): { eq(c: string, v: string): PromiseLike<{ count: number | null; error: unknown }> } } })
      .from(table).select("id", { count: "exact", head: true }).eq("workspace_id", ws);
    const { count, error } = await q;
    return error ? null : count;
  };
  return {
    async workspaces() {
      const { data, error } = await from(db, "workspaces").select("id, tenant_id");
      throwIfError(error);
      return rows(data).map((r) => ({ id: String(r.id), tenantId: String(r.tenant_id) }));
    },
    async rules(ws) {
      const { data, error } = await from(db, "backup_alert_rules").select().eq("workspace_id", ws).order("name");
      throwIfError(error);
      return rows(data).map(toRule);
    },
    async insertRules(ws, drafts) {
      if (!drafts.length) return;
      const { error } = await from(db, "backup_alert_rules").insert(drafts.map((d) => ({ ...ruleToRow(d), workspace_id: ws.id, tenant_id: ws.tenantId })));
      throwIfError(error);
    },
    async latestCheck(ws, kind, onlySuccess = true) {
      let q = from(db, "backup_checks").select().eq("check_kind", kind);
      q = ws === null ? q.is("workspace_id", null) : q.eq("workspace_id", ws);
      if (onlySuccess) q = q.eq("status", "success");
      const { data, error } = await q.order("checked_at", { ascending: false }).limit(1);
      throwIfError(error);
      const r = rows(data)[0];
      return r ? toCheck(r) : null;
    },
    async checks(ws, kind, limit) {
      const { data, error } = await from(db, "backup_checks").select().eq("workspace_id", ws).eq("check_kind", kind).order("checked_at", { ascending: false }).limit(limit);
      throwIfError(error);
      return rows(data).map(toCheck);
    },
    async insertCheck(c) {
      const { data, error } = await from(db, "backup_checks").insert({
        workspace_id: c.workspaceId, tenant_id: c.tenantId, check_kind: c.kind, status: c.status, backup_taken_at: c.takenAt,
        size_bytes: c.sizeBytes ?? null, location: c.location ?? null, row_counts: c.rowCounts ?? null, detail: c.detail ?? null,
      }).select("id").single();
      throwIfError(error);
      return Number((data as R).id);
    },
    async liveCounts(ws, tables) {
      const out: Record<string, number | null> = {};
      await Promise.all(tables.map(async (t) => { out[t] = await countOf(t, ws); }));
      return out;
    },
    async integrations(ws) {
      const { data, error } = await from(db, "integrations").select().eq("workspace_id", ws);
      throwIfError(error);
      return rows(data).map((r) => ({
        id: String(r.id), label: str(r.label) ?? str(r.provider) ?? "Connector", connectorId: str(r.connector_id) ?? str(r.provider) ?? "", status: String(r.status ?? ""),
      }));
    },
    async runs(ws, sinceIso) {
      const { data, error } = await from(db, "sync_runs").select("integration_id, stream, status, started_at, mode").eq("workspace_id", ws)
        .gte("started_at", sinceIso).order("started_at", { ascending: false }).limit(3000);
      throwIfError(error);
      return rows(data).filter((r) => r.integration_id).map((r) => ({
        integrationId: String(r.integration_id), stream: str(r.stream), status: String(r.status), startedAt: String(r.started_at), mode: str(r.mode),
      }));
    },
    async recipients(ws) {
      const perms = await from(db, "role_permissions").select("role_id").in("permission_key", ["data_health.manage", "backups.manage"]);
      throwIfError(perms.error);
      const roleIds = [...new Set(rows(perms.data).map((r) => String(r.role_id)))];
      if (!roleIds.length) return [];
      const m = await from(db, "memberships").select("user_id, valid_until").eq("workspace_id", ws).eq("is_active", true).in("role_id", roleIds);
      throwIfError(m.error);
      const now = Date.now();
      return [...new Set(rows(m.data).filter((r) => !r.valid_until || Date.parse(String(r.valid_until)) > now).map((r) => String(r.user_id)))];
    },
    async notified(ws, userIds, keys) {
      if (!userIds.length || !keys.length) return new Set();
      const { data, error } = await from(db, "notifications").select("body").eq("workspace_id", ws).in("user_id", userIds).in("body->>dedupe", keys);
      throwIfError(error);
      return new Set(rows(data).map((r) => (r.body as R | null)?.dedupe as string).filter(Boolean));
    },
    async notify(list) {
      if (!list.length) return;
      const { error } = await from(db, "notifications").insert(list.map((n) => ({
        workspace_id: n.workspaceId, user_id: n.userId, kind: n.kind, object_type: null, object_id: null, actor_id: null, title: n.title, body: n.body, url: n.url,
      })));
      throwIfError(error);
    },
    schema: deps.schema ?? (() => fetchSchemaInfo()),
    cadenceOf(connectorId, stream) {
      const def = getConnector(connectorId);
      const s = stream === null ? undefined : def?.streams.find((x) => x.key === stream);
      return s?.schedule ? cadenceFromCron(s.schedule.cron, s.schedule.tz, nextCronRun) : null;
    },
  };
}

export type { CheckKindDb };
