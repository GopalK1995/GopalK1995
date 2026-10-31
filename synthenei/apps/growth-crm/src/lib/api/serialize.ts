// Wire format: snake_case, `org_id` = tenant_id, custom fields under `custom`, never internal bookkeeping.
import { toSnake, toSnakeKey } from "../db/map";

const HIDDEN = new Set(["is_synthetic", "external_data"]);

/** Accepts snake_case (DB rows) or camelCase (repo output). */
export function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k0, v] of Object.entries(row)) {
    const k = toSnakeKey(k0);
    if (HIDDEN.has(k) || v === undefined) continue;
    if (k === "tenant_id") { out.org_id = v; continue; }
    if (k === "data") { out.custom = v; continue; }
    out[k] = v;
  }
  return out;
}

/** Input body (snake_case, `custom`) to repo input (camelCase top-level keys come from toSnake on the way in). Drops server-owned keys. */
const SERVER_KEYS = ["id", "tenant_id", "org_id", "workspace_id", "created_at", "updated_at", "deleted_at", "version", "created_by"];
export function toDbInput(body: Record<string, unknown>, opts: { customCol?: string } = {}): Record<string, unknown> {
  const o = toSnake(body);
  for (const k of SERVER_KEYS) delete o[k];
  if (opts.customCol && opts.customCol !== "custom" && "custom" in o) { o[opts.customCol] = o.custom; delete o.custom; }
  return o;
}

export const listBody = (rows: Record<string, unknown>[], nextCursor: string | null) => ({ data: rows.map(serializeRow), next_cursor: nextCursor });
export const itemBody = (row: Record<string, unknown>) => ({ data: serializeRow(row) });
