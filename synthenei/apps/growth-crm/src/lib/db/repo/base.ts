// Generic table repository: workspace-scoped list (keyset), get, create, versioned update, soft delete.
// Entity modules compose this and expose only the methods that make sense for the table.
import { dbForRequest, type Db } from "../client";
import { updateVersioned } from "../concurrency";
import { DbError, throwIfError } from "../errors";
import { toCamel, toSnake, toCamelKey, toSnakeKey } from "../map";
import { clampLimit, decodeCursor, encodeCursor, type Page } from "../page";
import { from, type Qb } from "../query";

export type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "ilike" | "is";
export interface Filter { field: string; op: FilterOp; value: unknown }
export interface Sort { dir: "asc" | "desc" }
export interface ListQuery { cursor?: string; limit?: number; filters?: Filter[]; sort?: Sort }
export type DbProvider = () => Promise<Db>;

export interface RepoConfig {
  table: string;
  /** Column used for keyset ordering (with id as tiebreak). Default created_at. */
  orderCol?: string;
  /** Table has a deleted_at column: list/get hide deleted rows, softDelete is available. */
  softDelete?: boolean;
}

const FIELD_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const isUnsafeValue = (v: string) => /["\\]/.test(v);

function applyFilters(q: Qb, filters: Filter[]): Qb {
  let out = q;
  for (const f of filters) {
    if (!FIELD_RE.test(f.field)) throw new DbError("invalid", "invalid", { detail: `bad filter field ${f.field}` });
    const col = toSnakeKey(f.field);
    switch (f.op) {
      case "eq": out = out.eq(col, f.value); break;
      case "neq": out = out.neq(col, f.value); break;
      case "gt": out = out.gt(col, f.value); break;
      case "gte": out = out.gte(col, f.value); break;
      case "lt": out = out.lt(col, f.value); break;
      case "lte": out = out.lte(col, f.value); break;
      case "in": out = out.in(col, Array.isArray(f.value) ? f.value : [f.value]); break;
      case "ilike": out = out.ilike(col, String(f.value)); break;
      case "is": out = out.is(col, f.value === null ? null : Boolean(f.value)); break;
    }
  }
  return out;
}

export function makeRepo<Row extends { id: string }, Input extends object>(cfg: RepoConfig, getDb: DbProvider = dbForRequest) {
  const orderCol = cfg.orderCol ?? "created_at";
  const orderKey = toCamelKey(orderCol);

  return {
    async list(ws: string, q: ListQuery = {}): Promise<Page<Row>> {
      const db = await getDb();
      const limit = clampLimit(q.limit);
      const asc = q.sort?.dir === "asc";
      let qb = from(db, cfg.table).select().eq("workspace_id", ws);
      if (cfg.softDelete) qb = qb.is("deleted_at", null);
      qb = applyFilters(qb, q.filters ?? []);
      if (q.cursor) {
        const c = decodeCursor(q.cursor);
        if (!c || isUnsafeValue(String(c.v)) || isUnsafeValue(String(c.id))) throw new DbError("invalid", "invalid", { detail: "bad cursor" });
        const cmp = asc ? "gt" : "lt";
        qb = qb.or(`${orderCol}.${cmp}."${c.v}",and(${orderCol}.eq."${c.v}",id.${cmp}."${c.id}")`);
      }
      qb = qb.order(orderCol, { ascending: asc }).order("id", { ascending: asc }).limit(limit + 1);
      const { data, error } = await qb;
      throwIfError(error);
      const all = ((data as Record<string, unknown>[] | null) ?? []).map((r) => toCamel<Row>(r));
      const rows = all.slice(0, limit);
      const last = rows[rows.length - 1] as unknown as Record<string, unknown> | undefined;
      const nextCursor = all.length > limit && last ? encodeCursor({ v: last[orderKey] as string | number, id: last.id as string }) : null;
      return { rows, nextCursor };
    },

    async get(ws: string, id: string): Promise<Row | null> {
      const db = await getDb();
      let qb = from(db, cfg.table).select().eq("workspace_id", ws).eq("id", id);
      if (cfg.softDelete) qb = qb.is("deleted_at", null);
      const { data, error } = await qb.maybeSingle();
      throwIfError(error);
      return data ? toCamel<Row>(data as Record<string, unknown>) : null;
    },

    async create(ws: string, input: Input): Promise<Row> {
      const db = await getDb();
      // tenant_id is filled by the set_tenant_from_workspace trigger
      const { data, error } = await from(db, cfg.table).insert({ ...toSnake(input as Record<string, unknown>), workspace_id: ws }).select().single();
      throwIfError(error);
      return toCamel<Row>(data as Record<string, unknown>);
    },

    /** Unversioned update (tables without a version column). */
    async updatePlain(ws: string, id: string, patch: Partial<Input>): Promise<Row> {
      const db = await getDb();
      const body = toSnake(patch as Record<string, unknown>);
      for (const k of ["id", "tenant_id", "workspace_id"]) delete body[k];
      const { data, error } = await from(db, cfg.table).update(body).eq("workspace_id", ws).eq("id", id).select().maybeSingle();
      throwIfError(error);
      if (!data) throw new DbError("not_found", "not_found");
      return toCamel<Row>(data as Record<string, unknown>);
    },

    async updateV(ws: string, id: string, expectedVersion: number, patch: Partial<Input> & Record<string, unknown>): Promise<Row> {
      const db = await getDb();
      return updateVersioned<Row>(cfg.table, id, expectedVersion, patch as Partial<Row>, { db, ws });
    },

    async softDeleteV(ws: string, id: string, expectedVersion: number): Promise<void> {
      const db = await getDb();
      await updateVersioned<Row>(cfg.table, id, expectedVersion, { deletedAt: new Date().toISOString() } as unknown as Partial<Row>, { db, ws });
    },
  };
}
