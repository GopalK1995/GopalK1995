import { dbForRequest } from "../client";
import { updateVersioned } from "../concurrency";
import { DbError, throwIfError } from "../errors";
import { toCamel } from "../map";
import { from } from "../query";
import { makeRepo, type DbProvider } from "./base";
import type { Deal, DealInput } from "./types";

export function createDealsRepo(getDb: DbProvider = dbForRequest) {
  const r = makeRepo<Deal, DealInput>({ table: "deals", softDelete: true }, getDb);
  return {
    list: r.list,
    get: r.get,
    create: r.create,
    update: r.updateV,
    softDelete: r.softDeleteV,
    /**
     * Move a deal to the stage with `stageKey`, version-guarded. The key is looked up in the deal's own pipeline (stage keys are
     * only unique per pipeline); a deal without a pipeline falls back to the tenant-wide lookup. Archived stages are refused.
     * `extra` carries e.g. lostReason.
     */
    async move(ws: string, id: string, stageKey: string, expectedVersion: number, extra: Partial<DealInput> = {}): Promise<Deal> {
      const db = await getDb();
      const cur = await r.get(ws, id);
      if (!cur) throw new DbError("not_found", "not_found");
      const pipelineId = (cur as { pipelineId?: string | null }).pipelineId ?? null;
      let q = from(db, "pipeline_stages").select("id").eq("tenant_id", cur.tenantId).eq("key", stageKey).is("archived_at", null);
      if (pipelineId) q = q.eq("pipeline_id", pipelineId);
      const st = await q.maybeSingle();
      throwIfError(st.error);
      if (!st.data) throw new DbError("invalid", "invalid", { detail: `unknown stage ${stageKey}` });
      const stageId = toCamel<{ id: string }>(st.data as Record<string, unknown>).id;
      return updateVersioned<Deal>("deals", id, expectedVersion, { ...extra, stageId }, { db, ws });
    },
  };
}

export const dealsRepo = createDealsRepo();
