// Optimistic concurrency: write only when the row still has the version the caller read.
import { dbForRequest, type Db } from "./client";
import { DbError, throwIfError } from "./errors";
import { toCamel, toSnake } from "./map";
import { from } from "./query";

const PROTECTED = ["id", "version", "tenant_id", "workspace_id"];

/** Update `id` where version = expectedVersion. 0 rows: re-read; missing -> not_found, present -> conflict carrying the current row. */
export async function updateVersioned<T>(
  table: string,
  id: string,
  expectedVersion: number,
  patch: Partial<T>,
  opts: { db?: Db; ws?: string } = {},
): Promise<T> {
  const client = opts.db ?? (await dbForRequest());
  const body = toSnake(patch as Record<string, unknown>);
  for (const k of PROTECTED) delete body[k];
  let upd = from(client, table).update(body).eq("id", id).eq("version", expectedVersion);
  if (opts.ws) upd = upd.eq("workspace_id", opts.ws);
  const { data, error } = await upd.select();
  throwIfError(error);
  const rows = (data as Record<string, unknown>[] | null) ?? [];
  if (rows.length > 0) return toCamel<T>(rows[0]);
  let rd = from(client, table).select().eq("id", id);
  if (opts.ws) rd = rd.eq("workspace_id", opts.ws);
  const cur = await rd.maybeSingle();
  throwIfError(cur.error);
  if (!cur.data) throw new DbError("not_found", "not_found");
  throw new DbError("conflict", "conflict", { current: toCamel(cur.data as Record<string, unknown>) });
}
