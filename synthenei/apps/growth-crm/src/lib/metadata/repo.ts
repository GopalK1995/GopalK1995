// Data access for object_types / field_defs (migration 0017). field_defs has no `version` column, so the editor's
// optimistic token is `updated_at` (FieldDef.rev); object_types.schema_version is bumped by the DB trigger on every change.
// Every function takes the Db so tests inject a mock; defaults to the request client (RLS applies: fields.manage to write).
import { dbForRequest, type Db } from "@/lib/db/client";
import { DbError, throwIfError } from "@/lib/db/errors";
import { from } from "@/lib/db/query";
import { customStorage, type FieldDef, type ObjectTypeDef } from "./types";
import { fieldFromRow } from "./defs";

type Row = Record<string, unknown>;
export type DbProvider = () => Promise<Db>;

export function objectFromRow(r: Row): ObjectTypeDef {
  const label = (r.label && typeof r.label === "object" ? r.label : {}) as { en?: { one?: string; many?: string }; ta?: { one?: string; many?: string } };
  const one = label.en?.one ?? String(r.key), many = label.en?.many ?? `${one}s`;
  return {
    id: String(r.id), key: String(r.key), kind: (r.kind as "system" | "custom") ?? "system",
    label: { en: { one, many }, ...(label.ta?.one ? { ta: { one: label.ta.one, many: label.ta.many ?? label.ta.one } } : {}) },
    icon: String(r.icon ?? "box"), primaryField: String(r.primary_field ?? "name"), isEnabled: r.is_enabled !== false, schemaVersion: Number(r.schema_version ?? 1),
  };
}

const OT_COLS = "id,key,kind,label,icon,primary_field,is_enabled,schema_version,position";

export async function tenantOfWorkspace(ws: string, getDb: DbProvider = dbForRequest): Promise<string> {
  const r = await from(await getDb(), "workspaces").select("tenant_id").eq("id", ws).maybeSingle();
  throwIfError(r.error);
  const t = (r.data as { tenant_id?: string } | null)?.tenant_id;
  if (!t) throw new DbError("not_found", "not_found");
  return t;
}

export async function listObjectTypes(tenantId: string, getDb: DbProvider = dbForRequest): Promise<ObjectTypeDef[]> {
  const r = await from(await getDb(), "object_types").select(OT_COLS).eq("tenant_id", tenantId).eq("is_enabled", true).order("position", { ascending: true });
  throwIfError(r.error);
  return ((r.data as Row[] | null) ?? []).map(objectFromRow);
}

export async function getObjectType(tenantId: string, key: string, getDb: DbProvider = dbForRequest): Promise<ObjectTypeDef | null> {
  const r = await from(await getDb(), "object_types").select(OT_COLS).eq("tenant_id", tenantId).eq("key", key).maybeSingle();
  throwIfError(r.error);
  return r.data ? objectFromRow(r.data as Row) : null;
}

export async function listFields(objectTypeId: string, opts: { includeArchived?: boolean } = {}, getDb: DbProvider = dbForRequest): Promise<FieldDef[]> {
  let q = from(await getDb(), "field_defs").select().eq("object_type_id", objectTypeId);
  if (!opts.includeArchived) q = q.is("archived_at", null);
  const r = await q.order("position", { ascending: true });
  throwIfError(r.error);
  return ((r.data as Row[] | null) ?? []).map(fieldFromRow);
}

export async function getFieldByKey(objectTypeId: string, key: string, getDb: DbProvider = dbForRequest): Promise<FieldDef | null> {
  const r = await from(await getDb(), "field_defs").select().eq("object_type_id", objectTypeId).eq("key", key).maybeSingle();
  throwIfError(r.error);
  return r.data ? fieldFromRow(r.data as Row) : null;
}

export async function insertField(objectTypeId: string, row: Row, position: number, getDb: DbProvider = dbForRequest): Promise<FieldDef> {
  const r = await from(await getDb(), "field_defs").insert({ ...row, object_type_id: objectTypeId, position }).select().single();
  throwIfError(r.error);
  return fieldFromRow(r.data as Row);
}

/** Update where updated_at still equals the token the editor loaded. 0 rows: missing -> not_found, otherwise conflict carrying only the new token. */
export async function updateFieldGuarded(id: string, rev: string, patch: Row, getDb: DbProvider = dbForRequest): Promise<FieldDef> {
  const db = await getDb();
  const u = await from(db, "field_defs").update(patch).eq("id", id).eq("updated_at", rev).select();
  throwIfError(u.error);
  const rows = (u.data as Row[] | null) ?? [];
  if (rows.length) return fieldFromRow(rows[0]);
  const cur = await from(db, "field_defs").select("id,updated_at").eq("id", id).maybeSingle();
  throwIfError(cur.error);
  if (!cur.data) throw new DbError("not_found", "not_found");
  throw new DbError("conflict", "conflict", { current: { rev: (cur.data as Row).updated_at } });
}

/** Writes new positions; positions are not part of the editor's concurrency token. */
export async function setPositions(items: { id: string; position: number }[], getDb: DbProvider = dbForRequest): Promise<void> {
  const db = await getDb();
  for (const it of items) {
    const r = await from(db, "field_defs").update({ position: it.position }).eq("id", it.id);
    throwIfError(r.error);
  }
}

/** Org-wide limit: max_custom_fields (null = unlimited) and the number of active fields. */
export async function fieldLimit(tenantId: string, getDb: DbProvider = dbForRequest): Promise<{ max: number | null; used: number }> {
  const db = await getDb();
  const p = await from(db, "org_admin_policies").select("max_custom_fields").eq("tenant_id", tenantId).maybeSingle();
  throwIfError(p.error);
  const u = await from(db, "field_defs").select("id").eq("tenant_id", tenantId).is("archived_at", null);
  throwIfError(u.error);
  const max = (p.data as { max_custom_fields?: number | null } | null)?.max_custom_fields;
  return { max: typeof max === "number" ? max : null, used: ((u.data as Row[] | null) ?? []).length };
}

/**
 * How many records the caller can see that hold a value for this field (capped at `cap`). RLS limits the count to rows
 * the caller can read, so zero is "none visible to you", not proof for other workspaces.
 */
export async function countWithValue(objectKey: string, key: string, cap = 50, getDb: DbProvider = dbForRequest): Promise<number> {
  if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) throw new DbError("invalid", "invalid");
  const { table, column } = customStorage(objectKey);
  const r = await from(await getDb(), table).select("id").or(`${column}->>${key}.not.is.null`).limit(cap);
  throwIfError(r.error);
  return ((r.data as Row[] | null) ?? []).length;
}
