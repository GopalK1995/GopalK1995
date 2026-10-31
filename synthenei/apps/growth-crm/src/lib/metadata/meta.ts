// getObjectMeta (CONTRACTS C13): object type + field definitions for the signed-in workspace, cached per request.
// Demo sessions get labelled example fields and never create a Supabase client.
import { cache } from "react";
import { requireActive } from "@/lib/auth/server";
import { DbError } from "@/lib/db/errors";
import { demoFields, demoObject, demoObjects } from "./demo";
import { getObjectType, listFields, listObjectTypes, tenantOfWorkspace } from "./repo";
import type { FieldDef, ObjectTypeDef } from "./types";

export interface ObjectMeta { object: ObjectTypeDef; fields: FieldDef[]; demo: boolean }

/** Active and retired fields are both returned; renderers must filter on `archivedAt` (see components/fields). */
export const getObjectMeta = cache(async (ws: string, objectKey: string): Promise<ObjectMeta> => {
  const { session } = await requireActive();
  if (session.demo) {
    const object = demoObject(objectKey);
    if (!object) throw new DbError("not_found", "not_found");
    return { object, fields: demoFields(objectKey), demo: true };
  }
  const tenantId = await tenantOfWorkspace(ws);
  const object = await getObjectType(tenantId, objectKey);
  if (!object) throw new DbError("not_found", "not_found");
  return { object, fields: await listFields(object.id, { includeArchived: true }), demo: false };
});

/** Object types a field editor can target (enabled ones). */
export const getEditableObjects = cache(async (ws: string): Promise<{ objects: ObjectTypeDef[]; demo: boolean }> => {
  const { session } = await requireActive();
  if (session.demo) return { objects: demoObjects(), demo: true };
  return { objects: await listObjectTypes(await tenantOfWorkspace(ws)), demo: false };
});
