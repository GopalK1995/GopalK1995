// Keyset list + single-row read for the API. Works on raw snake_case rows (the public wire format), with system and
// custom-field filters. Writes go through the repositories (src/lib/db/repo); this file only reads.
import type { Db } from "../db/client";
import { throwIfError } from "../db/errors";
import { from, type Qb } from "../db/query";
import { ApiError } from "./errors";
import type { ParsedFilter } from "./filters";

export interface ListSpec {
  table: string;
  ws: string;
  /** Column with the custom values: `custom` on system tables, `data` on custom-object records. */
  customCol?: string;
  softDelete?: boolean;
  /** Sort column and direction (columns must be NOT NULL). Default created_at desc. */
  sort?: { col: string; dir: "asc" | "desc" };
  /** Also return the exact number of matching rows. */
  includeTotal?: boolean;
  /** Extra equality constraints (e.g. object_type_id for records). */
  eq?: Record<string, string>;
  filters: ParsedFilter[];
  cursor?: string | null;
  limit: number;
}
export type Row = Record<string, unknown>;
export interface PageOut { rows: Row[]; nextCursor: string | null; total?: number }

/** PostgREST double-quoted value inside an or() filter: only backslash and double quote need escaping. */
const q = (v: unknown) => `"${String(v).replace(/[\\"]/g, (c) => `\\${c}`)}"`;

interface Cur { v: string | number; id: string; s?: string }
const encodeCur = (c: Cur) => Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
function decodeCur(raw: string): Cur | null {
  try {
    const o = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Cur>;
    if ((typeof o.v === "string" || typeof o.v === "number") && typeof o.id === "string" && (o.s === undefined || typeof o.s === "string")) return { v: o.v, id: o.id, s: o.s };
  } catch { /* malformed */ }
  return null;
}

export function applyFilters(qb: Qb, filters: ParsedFilter[], customCol: string): Qb {
  let q = qb;
  for (const f of filters) {
    const col = f.custom ? `${customCol}->>${f.field}` : f.field;
    switch (f.op) {
      case "eq": q = q.eq(col, f.value); break;
      case "neq": q = q.neq(col, f.value); break;
      case "gt": q = q.gt(col, f.value); break;
      case "gte": q = q.gte(col, f.value); break;
      case "lt": q = q.lt(col, f.value); break;
      case "lte": q = q.lte(col, f.value); break;
      case "in": q = q.in(col, Array.isArray(f.value) ? f.value : [f.value]); break;
      case "contains": q = q.ilike(col, `%${String(f.value).replace(/[\\%_]/g, (c) => `\\${c}`)}%`); break;
    }
  }
  return q;
}

export async function listPage(db: Db, s: ListSpec): Promise<PageOut> {
  const order = s.sort?.col ?? "created_at";
  const asc = s.sort?.dir === "asc";
  const sig = `${order}:${asc ? "asc" : "desc"}`;
  const base = (cols?: string, opts?: Parameters<Qb["select"]>[1]) => {
    let qb = from(db, s.table).select(cols, opts).eq("workspace_id", s.ws);
    if (s.softDelete !== false) qb = qb.is("deleted_at", null);
    for (const [k, v] of Object.entries(s.eq ?? {})) qb = qb.eq(k, v);
    return applyFilters(qb, s.filters, s.customCol ?? "custom");
  };
  let qb = base();
  if (s.cursor) {
    const c = decodeCur(s.cursor);
    if (!c) throw new ApiError("bad_request", "The cursor is not valid.", { errors: [{ path: "cursor", message: "malformed" }] });
    // A cursor from a different sort would skip or repeat rows; the default sort accepts pre-sort cursors (no s).
    if ((c.s ?? "created_at:desc") !== sig) throw new ApiError("bad_request", "The cursor was issued for a different sort.", { errors: [{ path: "cursor", message: "does not match the sort" }] });
    const cmp = asc ? "gt" : "lt";
    qb = qb.or(`${order}.${cmp}.${q(c.v)},and(${order}.eq.${q(c.v)},id.${cmp}.${q(c.id)})`);
  }
  qb = qb.order(order, { ascending: asc }).order("id", { ascending: asc }).limit(s.limit + 1);
  const [{ data, error }, tot] = await Promise.all([qb, s.includeTotal ? base("id", { count: "exact", head: true }) : Promise.resolve(null)]);
  throwIfError(error);
  if (tot) throwIfError(tot.error);
  const all = (data as Row[] | null) ?? [];
  const rows = all.slice(0, s.limit);
  const last = rows[rows.length - 1];
  return {
    rows, nextCursor: all.length > s.limit && last ? encodeCur({ v: last[order] as string | number, id: String(last.id), s: sig }) : null,
    ...(tot ? { total: tot.count ?? 0 } : {}),
  };
}

export async function getRow(db: Db, table: string, ws: string, id: string, opts: { softDelete?: boolean; eq?: Record<string, string> } = {}): Promise<Row | null> {
  let qb = from(db, table).select().eq("workspace_id", ws).eq("id", id);
  if (opts.softDelete !== false) qb = qb.is("deleted_at", null);
  for (const [k, v] of Object.entries(opts.eq ?? {})) qb = qb.eq(k, v);
  const { data, error } = await qb.maybeSingle();
  throwIfError(error);
  return (data as Row | null) ?? null;
}
