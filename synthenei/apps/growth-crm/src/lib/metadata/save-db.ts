// Real (non-demo) SaveDeps over the request client. RLS is the second line of defence behind saveCustomValues.
import { dbForRequest } from "@/lib/db/client";
import { updateVersioned } from "@/lib/db/concurrency";
import { throwIfError } from "@/lib/db/errors";
import { from } from "@/lib/db/query";
import type { SaveDeps } from "./save";
import { customStorage } from "./types";

type Row = Record<string, unknown>;

export function dbSaveDeps(getDb = dbForRequest): SaveDeps {
  return {
    async getRecord(objectKey, id) {
      const { table, column } = customStorage(objectKey);
      let q = from(await getDb(), table).select().eq("id", id);
      if (table === "records") q = q.is("deleted_at", null);
      const r = await q.maybeSingle();
      throwIfError(r.error);
      const row = r.data as Row | null;
      if (!row) return null;
      const doc = row[column];
      return {
        id: String(row.id), version: Number(row.version ?? 1), ownerId: (row.owner_id as string | null) ?? null,
        assigneeId: (row.assignee_id as string | null) ?? null, workspaceId: String(row.workspace_id ?? ""),
        values: doc && typeof doc === "object" && !Array.isArray(doc) ? (doc as Record<string, unknown>) : {},
      };
    },
    async writeValues(objectKey, id, expectedVersion, doc) {
      const { table, column } = customStorage(objectKey);
      const updated = await updateVersioned<{ version: number }>(table, id, expectedVersion, { [column]: doc }, { db: await getDb() });
      return { version: Number(updated.version) };
    },
  };
}
