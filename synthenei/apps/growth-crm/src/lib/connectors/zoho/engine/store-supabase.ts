// Supabase implementation of CrmStore on the SERVICE-ROLE client (jobs and webhook consumers are sanctioned users of serviceDb,
// CONTRACTS C6). RLS does not protect this path, so every query is explicitly scoped by workspace_id and/or integration id.
// The framework's own store supplies links, field maps and local writes (core), so links and dedupe follow the same rules everywhere.
import "server-only";
import type { Db } from "@/lib/db/client";
import { from, type Qb } from "@/lib/db/query";
import { loadExistingIndex } from "@/lib/import/engine";
import type { ConnectorStore } from "../../core/ports";
import type { CrmStore, LinkInfo, LocalRow } from "./types";

type R = Record<string, unknown>;
const failed = (what: string) => new Error(`crm sync store: ${what} failed`);   // PostgREST text can quote values: not echoed
const COLUMN_RE = /^[a-z][a-z0-9_]{0,62}$/;
const safeCols = (cols: string[]) => [...new Set(cols.filter((c) => COLUMN_RE.test(c)))];

export function supabaseCrmStore(db: Db, core: ConnectorStore): CrmStore {
  const q = (t: string) => from(db, t);
  const rows = async (b: Qb, what: string): Promise<R[]> => { const { data, error } = await b; if (error) throw failed(what); return (data as R[] | null) ?? []; };
  const toRow = (r: R, cols: string[]): LocalRow => ({ id: String(r.id), updatedAt: typeof r.updated_at === "string" ? r.updated_at : null, values: Object.fromEntries(cols.map((c) => [c, r[c] ?? null])) });

  return {
    core,
    async getLinkByLocal(connectionId, table, localId): Promise<LinkInfo | null> {
      const r = (await rows(q("external_links").select("id, external_object, external_id, local_id, content_hash").eq("integration_id", connectionId).eq("local_table", table).eq("local_id", localId).limit(1), "read link by local"))[0];
      return r ? { id: String(r.id), externalObject: String(r.external_object), externalId: String(r.external_id), localId: String(r.local_id), hash: typeof r.content_hash === "string" ? r.content_hash : null } : null;
    },
    async readLocal(table, workspaceId, ids, columns) {
      if (!ids.length) return [];
      const cols = safeCols(columns);
      return (await rows(q(table).select(["id", "updated_at", ...cols].join(", ")).eq("workspace_id", workspaceId).in("id", ids).is("deleted_at", null), `read ${table}`)).map((r) => toRow(r, cols));
    },
    async listChangedLocal(table, workspaceId, after, columns, limit) {
      const cols = safeCols(columns);
      let b = q(table).select(["id", "updated_at", ...cols].join(", ")).eq("workspace_id", workspaceId).is("deleted_at", null);
      if (after) b = b.or(`updated_at.gt."${after.ts}",and(updated_at.eq."${after.ts}",id.gt."${after.id}")`);
      return (await rows(b.order("updated_at", { ascending: true }).order("id", { ascending: true }).limit(limit), `list changed ${table}`)).map((r) => toRow(r, cols));
    },
    existingIndex: (workspaceId, object) => loadExistingIndex(db, workspaceId, object),
    /** Stage keys are unique per pipeline, not per workspace: deals map onto the workspace's default deal pipeline. */
    async listStages(workspaceId) {
      const pipe = (await rows(q("pipelines").select("id").eq("workspace_id", workspaceId).eq("object_type", "deal").eq("is_default", true).is("archived_at", null).limit(1), "read pipeline"))[0];
      const b = q("pipeline_stages").select("id, key").eq("workspace_id", workspaceId);
      return (await rows((pipe ? b.eq("pipeline_id", pipe.id) : b).limit(200), "read stages")).map((r) => ({ id: String(r.id), key: String(r.key) }));
    },
    async updateSettings(connectionId, patch) {
      const cur = (await rows(q("integrations").select("settings").eq("id", connectionId).limit(1), "read settings"))[0];
      const merged = { ...((cur?.settings as R | undefined) ?? {}), ...patch };
      await rows(q("integrations").update({ settings: merged }).eq("id", connectionId).select("id"), "write settings");
    },
  };
}
