// Custom values for a list page of system records (leads today). Real sessions read `id, custom` through the request client (RLS applies,
// bounded); demo sessions get labelled example values and never create a client. Values are masked per viewer by `loadListFields().maskRow`.
import "server-only";
import { requireActive } from "@/lib/auth/server";
import { dbForRequest } from "@/lib/db/client";
import { throwIfError } from "@/lib/db/errors";
import { from } from "@/lib/db/query";
import { demoCustomValues } from "./demo";
import { customStorage } from "./types";

export const LIST_CUSTOM_LIMIT = 5000;

/** Map of record id to its custom document. Failure returns an empty map (the list still renders, without custom columns' values). */
export async function loadListCustom(objectKey: string, ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  try {
    const { session } = await requireActive();
    if (session.demo) { for (const id of ids) out.set(id, demoCustomValues(objectKey)); return out; }
    const { table, column } = customStorage(objectKey);
    const r = await from(await dbForRequest(), table).select(`id, ${column}`).limit(LIST_CUSTOM_LIMIT);
    throwIfError(r.error);
    for (const row of (r.data as Record<string, unknown>[] | null) ?? []) {
      const doc = row[column];
      if (doc && typeof doc === "object" && !Array.isArray(doc)) out.set(String(row.id), doc as Record<string, unknown>);
    }
  } catch (e) { console.error("[list custom] load failed", e); }
  return out;
}
