import { dbForRequest } from "../client";
import { throwIfError } from "../errors";
import { from } from "../query";
import { makeRepo, type DbProvider } from "./base";
import type { Lead, LeadInput } from "./types";

export function createLeadsRepo(getDb: DbProvider = dbForRequest) {
  const r = makeRepo<Lead, LeadInput>({ table: "leads", softDelete: true }, getDb);
  return {
    list: r.list,
    get: r.get,
    create: r.create,
    update: r.updateV,
    softDelete: r.softDeleteV,
    /** Bulk reassign; RLS re-checks, triggers write audit and events. */
    async assign(ws: string, ids: string[], ownerId: string | null): Promise<void> {
      if (ids.length === 0) return;
      const db = await getDb();
      const { error } = await from(db, "leads").update({ owner_id: ownerId }).eq("workspace_id", ws).in("id", ids);
      throwIfError(error);
    },
  };
}

export const leadsRepo = createLeadsRepo();
