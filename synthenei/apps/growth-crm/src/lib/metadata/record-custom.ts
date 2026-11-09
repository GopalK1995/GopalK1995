// Version and custom values of a system record (lead, account, deal, contact, task, campaign) for <CustomFields/>.
// Real sessions read the row through the request client (RLS applies); demo sessions get labelled example values and never create a client.
import "server-only";
import { requireActive } from "@/lib/auth/server";
import { dbForRequest } from "@/lib/db/client";
import { throwIfError } from "@/lib/db/errors";
import { from } from "@/lib/db/query";
import { demoCustomValues } from "./demo";
import { customStorage } from "./types";
import type { CustomFieldsRecord } from "@/components/fields/custom-fields";

/** Null when the row cannot be read (missing, or hidden by RLS): the caller then skips the section. */
export async function loadRecordCustom(objectKey: string, id: string, owner?: { ownerId?: string | null; assigneeId?: string | null }): Promise<CustomFieldsRecord | null> {
  const { session } = await requireActive();
  if (session.demo) return { id, version: 1, ownerId: owner?.ownerId ?? null, assigneeId: owner?.assigneeId ?? null, custom: demoCustomValues(objectKey) };
  const { table, column } = customStorage(objectKey);
  const r = await from(await dbForRequest(), table).select(`id, version, owner_id, ${column}`).eq("id", id).maybeSingle();
  throwIfError(r.error);
  const row = r.data as Record<string, unknown> | null;
  if (!row) return null;
  const doc = row[column];
  return {
    id: String(row.id), version: Number(row.version ?? 1), ownerId: (row.owner_id as string | null) ?? owner?.ownerId ?? null, assigneeId: owner?.assigneeId ?? null,
    custom: doc && typeof doc === "object" && !Array.isArray(doc) ? (doc as Record<string, unknown>) : {},
  };
}
