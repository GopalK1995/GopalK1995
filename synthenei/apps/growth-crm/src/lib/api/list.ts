// Keyset list + single-row read for the API. Works on raw snake_case rows (the public wire format), with system and
// custom-field filters. Writes go through the repositories (src/lib/db/repo); this file only reads.
import type { Db } from "../db/client";
import { throwIfError } from "../db/errors";
import { decodeCursor, encodeCursor } from "../db/page";
import { from, type Qb } from "../db/query";
import { ApiError } from "./errors";
import type { ParsedFilter } from "./filters";

export interface ListSpec {
  table: string;
  ws: string;
  /** Column with the custom values: `custom` on system tables, `data` on custom-object records. */
  customCol?: string;
  softDelete?: boolean;
  orderCol?: string;
  /** Extra equality constraints (e.g. object_type_id for records). */
  eq?: Record<string, string>;
  filters: ParsedFilter[];
  cursor?: string | null;
  limit: number;
}
export type Row = Record<string, unknown>;
export interface PageOut { rows: Row[]; nextCursor: string | null }

const UNSAFE = /["\\,()]/;

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
  const order = s.orderCol ?? "created_at";
  let qb = from(db, s.table).select().eq("workspace_id", s.ws);
  if (s.softDelete !== false) qb = qb.is("deleted_at", null);
  for (const [k, v] of Object.entries(s.eq ?? {})) qb = qb.eq(k, v);
  qb = applyFilters(qb, s.filters, s.customCol ?? "custom");
  if (s.cursor) {
    const c = decodeCursor(s.cursor);
    if (!c || UNSAFE.test(String(c.v)) || UNSAFE.test(String(c.id))) throw new ApiError("invalid", "The cursor is not valid.", { errors: [{ path: "cursor", message: "malformed" }] });
    qb = qb.or(`${order}.lt."${c.v}",and(${order}.eq."${c.v}",id.lt."${c.id}")`);
  }
  qb = qb.order(order, { ascending: false }).order("id", { ascending: false }).limit(s.limit + 1);
  const { data, error } = await qb;
  throwIfError(error);
  const all = (data as Row[] | null) ?? [];
  const rows = all.slice(0, s.limit);
  const last = rows[rows.length - 1];
  return { rows, nextCursor: all.length > s.limit && last ? encodeCursor({ v: last[order] as string | number, id: last.id as string }) : null };
}

export async function getRow(db: Db, table: string, ws: string, id: string, opts: { softDelete?: boolean; eq?: Record<string, string> } = {}): Promise<Row | null> {
  let qb = from(db, table).select().eq("workspace_id", ws).eq("id", id);
  if (opts.softDelete !== false) qb = qb.is("deleted_at", null);
  for (const [k, v] of Object.entries(opts.eq ?? {})) qb = qb.eq(k, v);
  const { data, error } = await qb.maybeSingle();
  throwIfError(error);
  return (data as Row | null) ?? null;
}
