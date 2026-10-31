// Live evaluation of a segment. A segment is a saved query, never a copy of people: every call re-runs the compiled filters over
// public.leads through the request-scoped client, so RLS (workspace membership, record scope) decides what is visible.
import type { Db } from "@/lib/db/client";
import { throwIfError, type PgErrorLike } from "@/lib/db/errors";
import { from, type Qb } from "@/lib/db/query";
import type { CompiledFilter } from "./compile";

interface CountQb extends Qb { select(cols?: string, o?: { count?: "exact"; head?: boolean }): CountQb }
type CountRes = { data: unknown; error: PgErrorLike | null; count?: number | null };

function base(db: Db, ws: string, filters: CompiledFilter[], cols: string, opts?: { count?: "exact"; head?: boolean }): CountQb {
  let q = (from(db, "leads") as CountQb).select(cols, opts).eq("workspace_id", ws).is("deleted_at", null);
  for (const f of filters) q = q.in(f.column, f.values) as CountQb;
  return q;
}

/** Total matching leads (head count, no rows transferred). */
export async function countSegment(db: Db, ws: string, filters: CompiledFilter[]): Promise<number> {
  const res = (await base(db, ws, filters, "id", { count: "exact", head: true })) as CountRes;
  throwIfError(res.error);
  return res.count ?? 0;
}

/** Matching lead ids, oldest first, capped (the consent gate evaluates at most `cap`; `truncated` says the list was cut). */
export async function segmentLeadIds(db: Db, ws: string, filters: CompiledFilter[], cap: number): Promise<{ ids: string[]; truncated: boolean }> {
  const { data, error } = await base(db, ws, filters, "id").order("created_at", { ascending: true }).order("id", { ascending: true }).limit(cap + 1);
  throwIfError(error);
  const ids = ((data as { id: string }[] | null) ?? []).map((r) => r.id);
  return { ids: ids.slice(0, cap), truncated: ids.length > cap };
}

/** Rows for export. Personal columns are chosen by the caller after the permission and mask checks. */
export async function segmentRows<T extends Record<string, unknown>>(db: Db, ws: string, filters: CompiledFilter[], ids: string[], cols: string): Promise<T[]> {
  if (ids.length === 0) return [];
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await base(db, ws, filters, cols).in("id", ids.slice(i, i + 200));
    throwIfError(error);
    out.push(...((data as T[] | null) ?? []));
  }
  return out;
}
