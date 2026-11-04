// Data access for custom-object records, record_links and saved_views (migration 0017). Every function takes a DbProvider so tests
// inject a fake; the default is the request client, so RLS (obj:<key>.read|write|delete, views.share) is the second line of
// defence behind the checks in actions.ts. Soft delete only: `records.deleted_at`, never a hard delete.
import { dbForRequest, type Db } from "@/lib/db/client";
import { updateVersioned } from "@/lib/db/concurrency";
import { DbError, throwIfError } from "@/lib/db/errors";
import { from, type Qb } from "@/lib/db/query";
import { columnId, type FieldFilters } from "@/lib/metadata/filters";
import type { FieldDef } from "@/lib/metadata/types";
import { applyFilters, needsMemoryPass } from "./query";
import { PAGE_LIMIT, WIDE_LIMIT, type LinkRow, type ObjectRecord, type SavedView, type SortSpec, type ViewVisibility } from "./types";

type Row = Record<string, unknown>;
export type DbProvider = () => Promise<Db>;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const REC_COLS = "id,title,data,owner_id,version,created_at,updated_at";

export function recordFromRow(r: Row): ObjectRecord {
  return {
    id: String(r.id), title: String(r.title ?? ""), data: obj(r.data), ownerId: (r.owner_id as string | null) ?? null,
    version: Number(r.version ?? 1), createdAt: String(r.created_at ?? ""), updatedAt: String(r.updated_at ?? ""),
  };
}

const escLike = (s: string) => s.replace(/[%_\\,()]/g, (c) => `\\${c}`);

/** Adds the filters PostgREST can express exactly. The rest runs in memory (needsMemoryPass), so results are always exact. */
function withFilters(q: Qb, defs: FieldDef[], filters: FieldFilters): Qb {
  let out = q;
  for (const [id, f] of Object.entries(filters)) {
    const def = defs.find((d) => columnId(d.key) === id);
    if (!def || def.archivedAt) continue;
    const col = `data->>${def.key}`;
    const vals = (Array.isArray(f.value) ? f.value : [f.value]).filter((v) => v !== "");
    if (!vals.length) continue;
    if (f.op === "eq") out = out.eq(col, vals[0]);
    else if (f.op === "in") out = out.in(col, vals);
    else if (f.op === "contains" && def.type !== "multi_select") out = out.ilike(col, `%${escLike(vals[0])}%`);
  }
  return out;
}

export interface ListArgs { objectTypeId: string; workspaceId: string; q?: string; filters?: FieldFilters; defs: FieldDef[]; primaryKey?: string | null }
export interface ListResult { rows: ObjectRecord[]; truncated: boolean }

export async function listRecords(a: ListArgs, getDb: DbProvider = dbForRequest): Promise<ListResult> {
  const filters = a.filters ?? {};
  const memory = needsMemoryPass(a.defs, filters);
  const limit = memory ? WIDE_LIMIT : PAGE_LIMIT;
  let q = from(await getDb(), "records").select(REC_COLS).eq("object_type_id", a.objectTypeId).eq("workspace_id", a.workspaceId).is("deleted_at", null);
  q = withFilters(q, a.defs, filters);
  const res = await q.order("updated_at", { ascending: false }).limit(limit + 1);
  throwIfError(res.error);
  const all = ((res.data as Row[] | null) ?? []).map(recordFromRow);
  const truncated = all.length > limit;
  // The title search runs in memory over the primary field too, because the stored title can lag behind data[primary].
  return { rows: applyFilters(all.slice(0, limit), a.defs, filters, a.q ?? "", a.primaryKey), truncated };
}

export async function getRecord(id: string, objectTypeId: string, workspaceId: string, getDb: DbProvider = dbForRequest): Promise<ObjectRecord | null> {
  const r = await from(await getDb(), "records").select(REC_COLS).eq("id", id).eq("object_type_id", objectTypeId).eq("workspace_id", workspaceId).is("deleted_at", null).maybeSingle();
  throwIfError(r.error);
  return r.data ? recordFromRow(r.data as Row) : null;
}

export async function insertRecord(row: { workspaceId: string; objectTypeId: string; title: string; data: Record<string, unknown>; ownerId: string | null }, getDb: DbProvider = dbForRequest): Promise<ObjectRecord> {
  const r = await from(await getDb(), "records").insert({ workspace_id: row.workspaceId, object_type_id: row.objectTypeId, title: row.title, data: row.data, owner_id: row.ownerId }).select(REC_COLS).single();
  throwIfError(r.error);
  return recordFromRow(r.data as Row);
}

/** Version-guarded update; stale -> DbError("conflict") carrying only the current version. */
export async function updateRecordGuarded(id: string, expectedVersion: number, patch: { title?: string; data?: Record<string, unknown>; deletedAt?: string | null }, ws: string, getDb: DbProvider = dbForRequest): Promise<{ version: number }> {
  try {
    const u = await updateVersioned<{ version: number; title: string; data: Record<string, unknown>; deletedAt: string | null }>("records", id, expectedVersion, patch, { db: await getDb(), ws });
    return { version: Number(u.version) };
  } catch (e) {
    if (e instanceof DbError && e.code === "conflict") throw new DbError("conflict", "conflict", { current: { version: Number((e.current as { version?: number } | undefined)?.version ?? expectedVersion) } });
    throw e;
  }
}

// ---------- links ----------
export const linkFromRow = (r: Row): LinkRow => ({ id: String(r.id), fromType: String(r.from_type), fromId: String(r.from_id), toType: String(r.to_type), toId: String(r.to_id), relation: String(r.relation ?? "related") });

/** Links where the record is either end. RLS hides a link when the caller cannot read BOTH ends. */
export async function listLinks(workspaceId: string, type: string, id: string, getDb: DbProvider = dbForRequest): Promise<LinkRow[]> {
  const db = await getDb();
  const [a, b] = await Promise.all([
    from(db, "record_links").select().eq("workspace_id", workspaceId).eq("from_type", type).eq("from_id", id).order("created_at", { ascending: true }),
    from(db, "record_links").select().eq("workspace_id", workspaceId).eq("to_type", type).eq("to_id", id).order("created_at", { ascending: true }),
  ]);
  throwIfError(a.error); throwIfError(b.error);
  const seen = new Set<string>();
  return [...((a.data as Row[] | null) ?? []), ...((b.data as Row[] | null) ?? [])].map(linkFromRow).filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)));
}

export async function insertLink(l: { workspaceId: string; fromType: string; fromId: string; toType: string; toId: string; relation: string }, getDb: DbProvider = dbForRequest): Promise<LinkRow> {
  const r = await from(await getDb(), "record_links").insert({ workspace_id: l.workspaceId, from_type: l.fromType, from_id: l.fromId, to_type: l.toType, to_id: l.toId, relation: l.relation }).select().single();
  throwIfError(r.error);
  return linkFromRow(r.data as Row);
}

export async function getLink(id: string, workspaceId: string, getDb: DbProvider = dbForRequest): Promise<LinkRow | null> {
  const r = await from(await getDb(), "record_links").select().eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
  throwIfError(r.error);
  return r.data ? linkFromRow(r.data as Row) : null;
}

export async function deleteLink(id: string, workspaceId: string, getDb: DbProvider = dbForRequest): Promise<void> {
  const d = await (await getDb() as unknown as { from(t: string): { delete(): { eq(c: string, v: unknown): { eq(c: string, v: unknown): PromiseLike<{ error: { code?: string; message?: string } | null }> } } } })
    .from("record_links").delete().eq("id", id).eq("workspace_id", workspaceId);
  throwIfError(d.error);
}

/** Title and object type of custom-object records by id (titles are masked by the caller when the primary field is PII). */
export async function recordsByIds(workspaceId: string, ids: string[], getDb: DbProvider = dbForRequest): Promise<(ObjectRecord & { objectTypeId: string })[]> {
  if (!ids.length) return [];
  const r = await from(await getDb(), "records").select(`${REC_COLS},object_type_id`).eq("workspace_id", workspaceId).in("id", ids).is("deleted_at", null);
  throwIfError(r.error);
  return ((r.data as Row[] | null) ?? []).map((x) => ({ ...recordFromRow(x), objectTypeId: String(x.object_type_id) }));
}

/** Link candidates: custom-object records in the workspace whose title matches (RLS limits it to what the caller can read). */
export async function searchRecords(workspaceId: string, q: string, limit = 20, getDb: DbProvider = dbForRequest): Promise<(ObjectRecord & { objectTypeId: string })[]> {
  let b = from(await getDb(), "records").select(`${REC_COLS},object_type_id`).eq("workspace_id", workspaceId).is("deleted_at", null);
  if (q.trim()) b = b.ilike("title", `%${escLike(q.trim().slice(0, 80))}%`);
  const r = await b.order("updated_at", { ascending: false }).limit(limit);
  throwIfError(r.error);
  return ((r.data as Row[] | null) ?? []).map((x) => ({ ...recordFromRow(x), objectTypeId: String(x.object_type_id) }));
}

// ---------- saved views ----------
export function viewFromRow(r: Row): SavedView {
  const sort = Array.isArray(r.sort) ? (r.sort as unknown[]).filter((s): s is Record<string, unknown> => !!s && typeof s === "object").map((s) => ({ id: String(s.id ?? ""), desc: s.desc === true })).filter((s) => s.id) : [];
  const vis = r.visibility === "team" || r.visibility === "workspace" ? r.visibility : "private";
  return {
    id: String(r.id), objectTypeId: String(r.object_type_id), ownerId: (r.owner_id as string | null) ?? null, name: String(r.name ?? ""), filters: obj(r.filters) as SavedView["filters"],
    sort, columns: Array.isArray(r.columns) ? r.columns.map(String) : [], visibility: vis as ViewVisibility, position: Number(r.position ?? 0),
  };
}

/** Views the caller may see (private = own, team = own team, workspace = all members; enforced by RLS). */
export async function listViews(workspaceId: string, objectTypeId: string, getDb: DbProvider = dbForRequest): Promise<SavedView[]> {
  const r = await from(await getDb(), "saved_views").select().eq("workspace_id", workspaceId).eq("object_type_id", objectTypeId).order("position", { ascending: true }).order("created_at", { ascending: true });
  throwIfError(r.error);
  return ((r.data as Row[] | null) ?? []).map(viewFromRow);
}

export async function getView(id: string, workspaceId: string, getDb: DbProvider = dbForRequest): Promise<SavedView | null> {
  const r = await from(await getDb(), "saved_views").select().eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
  throwIfError(r.error);
  return r.data ? viewFromRow(r.data as Row) : null;
}

export async function insertView(v: { workspaceId: string; objectTypeId: string; ownerId: string; name: string; filters: FieldFilters; sort: SortSpec[]; columns: string[]; visibility: ViewVisibility }, getDb: DbProvider = dbForRequest): Promise<SavedView> {
  const r = await from(await getDb(), "saved_views").insert({ workspace_id: v.workspaceId, object_type_id: v.objectTypeId, owner_id: v.ownerId, name: v.name, filters: v.filters, sort: v.sort, columns: v.columns, visibility: v.visibility }).select().single();
  throwIfError(r.error);
  return viewFromRow(r.data as Row);
}

export async function updateViewRow(id: string, workspaceId: string, patch: { name?: string; visibility?: ViewVisibility; filters?: FieldFilters; sort?: SortSpec[]; columns?: string[] }, getDb: DbProvider = dbForRequest): Promise<SavedView> {
  const r = await from(await getDb(), "saved_views").update(patch).eq("id", id).eq("workspace_id", workspaceId).select();
  throwIfError(r.error);
  const rows = (r.data as Row[] | null) ?? [];
  if (!rows.length) throw new DbError("not_found", "not_found");
  return viewFromRow(rows[0]);
}

export async function deleteViewRow(id: string, workspaceId: string, getDb: DbProvider = dbForRequest): Promise<void> {
  const d = await (await getDb() as unknown as { from(t: string): { delete(): { eq(c: string, v: unknown): { eq(c: string, v: unknown): PromiseLike<{ error: { code?: string; message?: string } | null }> } } } })
    .from("saved_views").delete().eq("id", id).eq("workspace_id", workspaceId);
  throwIfError(d.error);
}
