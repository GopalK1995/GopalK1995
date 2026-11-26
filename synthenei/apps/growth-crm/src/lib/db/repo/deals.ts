import { dbForRequest } from "../client";
import { updateVersioned } from "../concurrency";
import { DbError, throwIfError } from "../errors";
import { toCamel } from "../map";
import { from } from "../query";
import { makeRepo, type DbProvider } from "./base";
import type { Deal, DealInput } from "./types";
import { missingRequired, requiredFieldLabel, viewOfDealRow } from "@/lib/metadata/pipelines";
import { PT } from "@/lib/metadata/pipelines-strings";

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
      let q = from(db, "pipeline_stages").select("id,key,name,required_fields").eq("tenant_id", cur.tenantId).eq("key", stageKey).is("archived_at", null);
      if (pipelineId) q = q.eq("pipeline_id", pipelineId);
      const st = await q.maybeSingle();
      throwIfError(st.error);
      if (!st.data) throw new DbError("invalid", "invalid", { detail: `unknown stage ${stageKey}` });
      const stage = toCamel<{ id: string; name?: { en?: string } | null; requiredFields?: unknown }>(st.data as Record<string, unknown>);
      const stageId = stage.id;
      // Required fields (pipeline_stages.required_fields) are checked here too, so the public API move cannot skip what the board enforces.
      // The BEFORE UPDATE trigger in migration 0028 is the last line of defence; this gives the caller the clear message first.
      const required = Array.isArray(stage.requiredFields) ? (stage.requiredFields as unknown[]).map(String) : [];
      if (required.length) {
        const merged = { ...(cur as unknown as Record<string, unknown>), ...(extra as Record<string, unknown>) };
        const missing = missingRequired(required, viewOfDealRow(merged));
        if (missing.length) {
          throw new DbError("invalid", "invalid", { detail: PT.requiredMissing(stage.name?.en || stageKey, missing.map((k) => requiredFieldLabel("deal", k))) });
        }
      }
      return updateVersioned<Deal>("deals", id, expectedVersion, { ...extra, stageId }, { db, ws });
    },
  };
}

export const dealsRepo = createDealsRepo();
