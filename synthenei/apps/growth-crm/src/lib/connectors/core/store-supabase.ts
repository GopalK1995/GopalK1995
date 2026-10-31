// Supabase implementation of ConnectorStore. Two flavours of client:
//  - service role (jobs, OAuth callback): sees every workspace, used by the runner;
//  - request client (server actions/pages): RLS applies, used only for reads shown to the signed-in user.
// Server only. Row shapes are mapped by hand here so no raw column ever leaks to the UI layer.
import "server-only";
import type { Db } from "@/lib/db/client";
import { from, type Qb } from "@/lib/db/query";
import type { AvailabilityRow } from "./status";
import type { ConnectionPatch, ConnectorStore, LinkRow, NewConnection, RunFinish, RunRow, RunStart } from "./ports";
import type { ConnectionRow, ConnectorId, ConsentPurpose, FieldMapSpec, IntegrationStatus, TransformKey } from "./types";

type R = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function toConnection(r: R): ConnectionRow {
  return {
    id: String(r.id), tenantId: String(r.tenant_id), workspaceId: String(r.workspace_id), connectorId: String(r.connector_id ?? r.provider) as ConnectorId,
    mode: r.mode === "live" ? "live" : "sandbox", status: String(r.status) as IntegrationStatus, settings: (r.settings as Record<string, unknown>) ?? {},
    credentialSecretId: str(r.credential_secret_id), webhookSecretId: str(r.webhook_secret_id), tokenExpiresAt: str(r.token_expires_at),
    lastSyncAt: str(r.last_sync_at), lastError: str(r.last_error),
  };
}
export function toRun(r: R): RunRow {
  return {
    id: Number(r.id), connectionId: String(r.integration_id), stream: str(r.stream), kind: String(r.kind), status: r.status as RunRow["status"],
    startedAt: String(r.started_at), finishedAt: str(r.finished_at), rowsIn: Number(r.rows_in ?? 0), rowsOut: Number(r.rows_out ?? 0),
    rowsRejected: Number(r.rows_rejected ?? 0), error: str(r.error), payloadSample: r.payload_sample ?? null,
  };
}
const failed = (what: string) => new Error(`connector store: ${what} failed`);   // PostgREST text can quote values: not echoed

const PATCH_COLUMNS: Record<keyof ConnectionPatch, string> = {
  status: "status", mode: "mode", credentialSecretId: "credential_secret_id", webhookSecretId: "webhook_secret_id", tokenExpiresAt: "token_expires_at",
  lastSyncAt: "last_sync_at", lastError: "last_error", externalAccountId: "external_account_id", externalAccountLabel: "external_account_label",
  oauthScopes: "oauth_scopes", connectedBy: "connected_by", connectedAt: "connected_at", disabledAt: "disabled_at", health: "health",
};

export function supabaseStore(db: Db, appEnv: string): ConnectorStore {
  const q = (t: string) => from(db, t);
  const rows = async (b: Qb, what: string): Promise<R[]> => { const { data, error } = await b; if (error) throw failed(what); return (data as R[] | null) ?? []; };
  const availabilityEnv = appEnv === "production" ? "production" : appEnv === "demo" ? "demo" : "staging";

  return {
    async getConnection(id) { const r = await rows(q("integrations").select().eq("id", id).limit(1), "read connection"); return r[0] ? toConnection(r[0]) : null; },
    async findConnection(ws, connectorId) { const r = await rows(q("integrations").select().eq("workspace_id", ws).eq("connector_id", connectorId).limit(1), "find connection"); return r[0] ? toConnection(r[0]) : null; },
    async listActiveConnections() { return (await rows(q("integrations").select().in("status", ["connected", "sandbox"]).limit(1000), "list connections")).map(toConnection); },
    async insertConnection(n: NewConnection) {
      const r = await rows(q("integrations").insert({
        tenant_id: n.tenantId, workspace_id: n.workspaceId, connector_id: n.connectorId, provider: n.connectorId.replace(/-/g, "_"), label: n.label,
        category: ["ota", "data"].includes(n.category) ? "internal" : n.category, direction: n.direction, status: n.status, mode: n.mode, connected_by: n.connectedBy,
      }).select(), "insert connection");
      if (!r[0]) throw failed("insert connection");
      return toConnection(r[0]);
    },
    async updateConnection(id, patch) {
      const row: R = {};
      for (const [k, col] of Object.entries(PATCH_COLUMNS)) if (k in patch) row[col] = (patch as R)[k];
      if (!Object.keys(row).length) return;
      const r = await rows(q("integrations").update(row).eq("id", id).select("id"), "update connection");
      if (!r.length) throw failed("update connection");
    },
    async getCursor(id, stream) { const r = await rows(q("sync_cursors").select("cursor").eq("integration_id", id).eq("stream", stream).limit(1), "read cursor"); return r[0]?.cursor ?? null; },
    async setCursor(id, stream, cursor) {
      const up = await rows(q("sync_cursors").update({ cursor, updated_at: new Date().toISOString() }).eq("integration_id", id).eq("stream", stream).select("stream"), "write cursor");
      if (!up.length) await rows(q("sync_cursors").insert({ integration_id: id, stream, cursor }).select("stream"), "write cursor");
    },
    async startRun(r: RunStart) {
      const out = await rows(q("sync_runs").insert({ tenant_id: r.tenantId, workspace_id: r.workspaceId, integration_id: r.connectionId, kind: r.kind, stream: r.stream, mode: r.mode, status: "running", started_by: r.startedBy ?? null }).select("id"), "start run");
      return Number(out[0]?.id);
    },
    async finishRun(id, f: RunFinish) {
      await rows(q("sync_runs").update({ status: f.status, rows_in: f.rowsIn, rows_out: f.rowsOut, rows_rejected: f.rowsRejected, error: f.error ?? null, payload_sample: f.payloadSample ?? null, finished_at: new Date().toISOString() }).eq("id", id).select("id"), "finish run");
    },
    async findRunningRun(id, stream, sinceIso) {
      let b = q("sync_runs").select().eq("integration_id", id).eq("status", "running").gte("started_at", sinceIso);
      if (stream) b = b.eq("stream", stream);
      const r = await rows(b.limit(1), "find running run");
      return r[0] ? toRun(r[0]) : null;
    },
    async listRuns(id, limit) { return (await rows(q("sync_runs").select().eq("integration_id", id).order("started_at", { ascending: false }).limit(limit), "list runs")).map(toRun); },
    async getFieldMap(id) {
      return (await rows(q("integration_field_maps").select().eq("integration_id", id).limit(500), "read field map")).map((r): FieldMapSpec => {
        const t = str(r.transform);
        let arg: Record<string, unknown> | null = null;
        let key: string | null = t;
        if (t && t.includes(":")) { key = t.slice(0, t.indexOf(":")); try { arg = JSON.parse(t.slice(t.indexOf(":") + 1)) as Record<string, unknown>; } catch { arg = null; } }
        return { externalObject: String(r.external_object), externalField: String(r.external_field), localTable: String(r.local_table), localColumn: String(r.local_column), direction: r.direction as FieldMapSpec["direction"], transform: key as TransformKey | null, transformArg: arg, conflictOwner: r.conflict_owner as FieldMapSpec["conflictOwner"], sample: str(r.sample_value) ?? undefined };
      });
    },
    async getLink(id, obj, ext) {
      const r = await rows(q("external_links").select("id, local_table, local_id, content_hash").eq("integration_id", id).eq("external_object", obj).eq("external_id", ext).limit(1), "read link");
      return r[0] ? ({ id: String(r[0].id), localTable: String(r[0].local_table), localId: String(r[0].local_id), contentHash: str(r[0].content_hash) } satisfies LinkRow) : null;
    },
    async putLink(l) {
      await rows(q("external_links").insert({ tenant_id: l.tenantId, workspace_id: l.workspaceId, integration_id: l.connectionId, external_object: l.externalObject, external_id: l.externalId, local_table: l.localTable, local_id: l.localId, content_hash: l.contentHash, direction: l.direction, last_synced_at: new Date().toISOString() }).select("id"), "write link");
    },
    async touchLink(id, hash) { await rows(q("external_links").update({ content_hash: hash, last_synced_at: new Date().toISOString() }).eq("id", id).select("id"), "touch link"); },
    async findByMatchKey(table, ws, keys) {
      const tryKey = async (col: string, v: string | undefined, ci: boolean) => {
        if (!v) return null;
        const b = q(table).select("id").eq("workspace_id", ws);
        const r = await rows((ci ? b.ilike(col, v.replace(/[%_]/g, "\\$&")) : b.eq(col, v)).limit(1), "match key");
        return r[0] ? String(r[0].id) : null;
      };
      return (await tryKey("phone", keys.phone, false)) ?? (await tryKey("email", keys.email, true));
    },
    async insertLocal(table, row) { const r = await rows(q(table).insert(row).select("id"), `insert ${table}`); if (!r[0]) throw failed(`insert ${table}`); return String(r[0].id); },
    async updateLocal(table, id, row) { if (Object.keys(row).length) await rows(q(table).update(row).eq("id", id).select("id"), `update ${table}`); },
    async getAvailability(connectorId): Promise<AvailabilityRow | null> {
      const r = await rows(q("connector_availability").select().eq("connector_id", connectorId).eq("env", availabilityEnv).limit(1), "read availability");
      return r[0] ? { mode: r[0].mode as AvailabilityRow["mode"], gateStatus: r[0].gate_status as AvailabilityRow["gateStatus"], note: str(r[0].note) } : null;
    },
    async canContact(leadId: string, purpose: ConsentPurpose) {
      const { data, error } = await (db as unknown as { rpc(fn: string, a: R): PromiseLike<{ data: unknown; error: unknown }> }).rpc("can_contact", { p_lead: leadId, p_purpose: purpose });
      if (error) throw failed("consent check");
      return data === true;
    },
  };
}
