// object_types data access for the admin page (migration 0017; RLS: objects.manage + org policy allow_custom_objects to write).
// The optimistic token is `updated_at` (object_types has no version column; schema_version is bumped by the database).
import { dbForRequest, type Db } from "@/lib/db/client";
import { DbError, throwIfError } from "@/lib/db/errors";
import { from } from "@/lib/db/query";
import { objectFromRow } from "@/lib/metadata/repo";
import type { ObjectTypeDef } from "@/lib/metadata/types";

type Row = Record<string, unknown>;
export type DbProvider = () => Promise<Db>;
export interface AdminObject extends ObjectTypeDef { rev: string; position: number }

const adminFromRow = (r: Row): AdminObject => ({ ...objectFromRow(r), rev: String(r.updated_at ?? ""), position: Number(r.position ?? 0) });

/** Every custom object of the tenant, enabled or not. */
export async function listCustomObjects(tenantId: string, getDb: DbProvider = dbForRequest): Promise<AdminObject[]> {
  const r = await from(await getDb(), "object_types").select().eq("tenant_id", tenantId).eq("kind", "custom").order("position", { ascending: true });
  throwIfError(r.error);
  return ((r.data as Row[] | null) ?? []).map(adminFromRow);
}

export async function getCustomObject(tenantId: string, key: string, getDb: DbProvider = dbForRequest): Promise<AdminObject | null> {
  const r = await from(await getDb(), "object_types").select().eq("tenant_id", tenantId).eq("key", key).maybeSingle();
  throwIfError(r.error);
  return r.data ? adminFromRow(r.data as Row) : null;
}

/** Org policy: custom objects can be switched off for the whole organisation. Missing row = allowed (column default true). */
export async function customObjectsAllowed(tenantId: string, getDb: DbProvider = dbForRequest): Promise<boolean> {
  const r = await from(await getDb(), "org_admin_policies").select("allow_custom_objects").eq("tenant_id", tenantId).maybeSingle();
  throwIfError(r.error);
  return (r.data as { allow_custom_objects?: boolean } | null)?.allow_custom_objects !== false;
}

export async function insertObject(tenantId: string, row: { key: string; label: unknown; icon: string; primaryField: string; position: number }, getDb: DbProvider = dbForRequest): Promise<AdminObject> {
  const r = await from(await getDb(), "object_types").insert({ tenant_id: tenantId, key: row.key, kind: "custom", label: row.label, icon: row.icon, primary_field: row.primaryField, position: row.position }).select().single();
  throwIfError(r.error);
  return adminFromRow(r.data as Row);
}

/** Update where updated_at still equals the token the page loaded. 0 rows: missing -> not_found, otherwise conflict carrying only the new token. */
export async function updateObjectGuarded(id: string, rev: string, patch: Row, getDb: DbProvider = dbForRequest): Promise<AdminObject> {
  const db = await getDb();
  const u = await from(db, "object_types").update(patch).eq("id", id).eq("updated_at", rev).select();
  throwIfError(u.error);
  const rows = (u.data as Row[] | null) ?? [];
  if (rows.length) return adminFromRow(rows[0]);
  const cur = await from(db, "object_types").select("id,updated_at").eq("id", id).maybeSingle();
  throwIfError(cur.error);
  if (!cur.data) throw new DbError("not_found", "not_found");
  throw new DbError("conflict", "conflict", { current: { rev: (cur.data as Row).updated_at } });
}

/** Number of live records per object type the caller can see (RLS-limited), for the admin list. Capped; zero means none visible. */
export async function recordCounts(objectTypeIds: string[], cap = 500, getDb: DbProvider = dbForRequest): Promise<Record<string, number>> {
  if (!objectTypeIds.length) return {};
  const r = await from(await getDb(), "records").select("object_type_id").in("object_type_id", objectTypeIds).is("deleted_at", null).limit(cap);
  throwIfError(r.error);
  const out: Record<string, number> = {};
  for (const x of (r.data as Row[] | null) ?? []) out[String(x.object_type_id)] = (out[String(x.object_type_id)] ?? 0) + 1;
  return out;
}
