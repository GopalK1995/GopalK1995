// Data access for public.layouts and the role ids layouts can target (migration 0017, RLS: layouts.manage to write, members read).
// `layouts` has no version trigger, so the optimistic token is the `version` column and this module bumps it on every write.
// Every function takes a DbProvider so tests inject a fake; the default is the request client (RLS applies).
import { dbForRequest, type Db } from "@/lib/db/client";
import { DbError, throwIfError } from "@/lib/db/errors";
import { from } from "@/lib/db/query";
import type { LayoutRow } from "./resolve";
import type { LayoutKind } from "./spec";

type Row = Record<string, unknown>;
export type DbProvider = () => Promise<Db>;

export interface RoleRef { id: string; key: string; name: string; system: boolean }

export function layoutFromRow(r: Row): LayoutRow {
  return {
    id: String(r.id), objectTypeId: String(r.object_type_id), kind: r.kind === "list" ? "list" : "detail", workspaceId: (r.workspace_id as string | null) ?? null,
    roleId: (r.role_id as string | null) ?? null, spec: r.spec ?? {}, version: Number(r.version ?? 1), updatedAt: (r.updated_at as string | null) ?? null,
  };
}

/** Every layout row of an object the caller can read (org-wide rows plus their workspaces'). */
export async function listLayouts(objectTypeId: string, getDb: DbProvider = dbForRequest): Promise<LayoutRow[]> {
  const r = await from(await getDb(), "layouts").select().eq("object_type_id", objectTypeId);
  throwIfError(r.error);
  return ((r.data as Row[] | null) ?? []).map(layoutFromRow);
}

export async function listRoles(tenantId: string, getDb: DbProvider = dbForRequest): Promise<RoleRef[]> {
  const r = await from(await getDb(), "roles").select("id,key,name,tenant_id,is_system").or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);
  throwIfError(r.error);
  return ((r.data as Row[] | null) ?? []).map((x) => ({ id: String(x.id), key: String(x.key), name: String(x.name), system: x.is_system === true }));
}

/** Role ids that apply to a role key: the tenant's own role of that key wins over the system template, but both are returned. */
export const roleIdsFor = (roles: RoleRef[], roleKey: string | null): string[] => (roleKey ? roles.filter((r) => r.key === roleKey).map((r) => r.id) : []);

export interface LayoutTarget { objectTypeId: string; kind: LayoutKind; workspaceId: string | null; roleId: string | null }

async function findExact(db: Db, t: LayoutTarget): Promise<LayoutRow | null> {
  let q = from(db, "layouts").select().eq("object_type_id", t.objectTypeId).eq("kind", t.kind);
  q = t.workspaceId ? q.eq("workspace_id", t.workspaceId) : q.is("workspace_id", null);
  q = t.roleId ? q.eq("role_id", t.roleId) : q.is("role_id", null);
  const r = await q.maybeSingle();
  throwIfError(r.error);
  return r.data ? layoutFromRow(r.data as Row) : null;
}

export const getExactLayout = async (t: LayoutTarget, getDb: DbProvider = dbForRequest): Promise<LayoutRow | null> => findExact(await getDb(), t);

/**
 * Create or replace the layout of one scope. `expectedVersion` is the version the editor loaded (0 = it saw no row).
 * Mismatch -> conflict carrying only the current version, never the spec.
 */
export async function saveLayout(t: LayoutTarget, spec: unknown, expectedVersion: number, by: string | null, getDb: DbProvider = dbForRequest): Promise<LayoutRow> {
  const db = await getDb();
  const cur = await findExact(db, t);
  const now = new Date().toISOString();
  if (!cur) {
    if (expectedVersion !== 0) throw new DbError("conflict", "conflict", { current: { version: 0 } });
    const r = await from(db, "layouts").insert({ object_type_id: t.objectTypeId, kind: t.kind, workspace_id: t.workspaceId, role_id: t.roleId, spec, version: 1, updated_by: by, updated_at: now }).select().single();
    throwIfError(r.error);   // a concurrent insert hits layouts_scope_unique (23505 -> unique)
    return layoutFromRow(r.data as Row);
  }
  if (cur.version !== expectedVersion) throw new DbError("conflict", "conflict", { current: { version: cur.version } });
  const u = await from(db, "layouts").update({ spec, version: cur.version + 1, updated_by: by, updated_at: now }).eq("id", cur.id).eq("version", cur.version).select();
  throwIfError(u.error);
  const rows = (u.data as Row[] | null) ?? [];
  if (!rows.length) throw new DbError("conflict", "conflict", { current: { version: cur.version + 1 } });
  return layoutFromRow(rows[0]);
}

/** Removes one scope's override (the viewer falls back to the next broader layout, then the default). */
export async function deleteLayout(t: LayoutTarget, expectedVersion: number, getDb: DbProvider = dbForRequest): Promise<string> {
  const db = await getDb();
  const cur = await findExact(db, t);
  if (!cur) throw new DbError("not_found", "not_found");
  if (cur.version !== expectedVersion) throw new DbError("conflict", "conflict", { current: { version: cur.version } });
  // The shared Qb view has no delete(); this is the one structural cast.
  const d = await (db as unknown as { from(t: string): { delete(): { eq(c: string, v: unknown): { eq(c: string, v: unknown): PromiseLike<{ error: { code?: string; message?: string } | null }> } } } })
    .from("layouts").delete().eq("id", cur.id).eq("version", cur.version);
  throwIfError(d.error);
  return cur.id;
}
