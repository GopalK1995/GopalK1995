// Query parsing: ?cursor=&limit= and ?filter[field]=v | ?filter[field][op]=v | ?filter[custom.key]=v.
// Fields are allow-listed per resource (never passed through), custom keys must match the field-key grammar.
import { ApiError, type FieldIssue } from "./errors";

export type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains";
export type FieldKind = "text" | "uuid" | "number" | "date" | "bool" | "enum";
export interface FieldSpec { kind: FieldKind; values?: readonly string[] }
export interface ParsedFilter { field: string; op: FilterOp; value: unknown; custom: boolean }

export const DEFAULT_PAGE = 50;
export const MAX_PAGE = 100;
const OPS: readonly FilterOp[] = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains"];
const CUSTOM_KEY = /^[a-z][a-z0-9_]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILTERS = 10;

export function parseLimit(raw: string | null): number {
  if (raw === null || raw === "") return DEFAULT_PAGE;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE) throw new ApiError("invalid", `limit must be an integer between 1 and ${MAX_PAGE}.`, { errors: [{ path: "limit", message: `1 to ${MAX_PAGE}` }] });
  return n;
}

function coerce(spec: FieldSpec, raw: string, path: string, issues: FieldIssue[]): unknown {
  switch (spec.kind) {
    case "number": { const n = Number(raw); if (raw.trim() === "" || !Number.isFinite(n)) { issues.push({ path, message: "must be a number" }); return null; } return n; }
    case "bool": if (raw !== "true" && raw !== "false") { issues.push({ path, message: "must be true or false" }); return null; } return raw === "true";
    case "uuid": if (!UUID.test(raw)) { issues.push({ path, message: "must be a uuid" }); return null; } return raw;
    case "date": if (Number.isNaN(Date.parse(raw))) { issues.push({ path, message: "must be an ISO date" }); return null; } return raw;
    case "enum": if (!spec.values?.includes(raw)) { issues.push({ path, message: `must be one of ${spec.values?.join(", ")}` }); return null; } return raw;
    default: return raw;
  }
}

/**
 * `allowed` = system fields filterable on this resource. `customAllowed` = whether filter[custom.<key>] is accepted
 * (text equality / in / contains only). Throws ApiError("invalid") listing every problem.
 */
export function parseFilters(params: URLSearchParams, allowed: Record<string, FieldSpec>, customAllowed: boolean): ParsedFilter[] {
  const out: ParsedFilter[] = [], issues: FieldIssue[] = [];
  for (const [name, raw] of params.entries()) {
    const m = /^filter\[([^\]]+)\](?:\[([a-z]+)\])?$/.exec(name);
    if (!m) { if (name.startsWith("filter")) issues.push({ path: name, message: "malformed filter" }); continue; }
    const [, field, opRaw] = m;
    const op = (opRaw ?? "eq") as FilterOp;
    if (!OPS.includes(op)) { issues.push({ path: name, message: `unknown operator ${opRaw}` }); continue; }
    if (field.startsWith("custom.")) {
      const key = field.slice(7);
      if (!customAllowed || !CUSTOM_KEY.test(key)) { issues.push({ path: name, message: "unknown custom field" }); continue; }
      if (op !== "eq" && op !== "neq" && op !== "in" && op !== "contains") { issues.push({ path: name, message: "custom fields support eq, neq, in, contains" }); continue; }
      out.push({ field: key, op, value: op === "in" ? raw.split(",").filter(Boolean) : raw, custom: true });
      continue;
    }
    const spec = allowed[field];
    if (!spec) { issues.push({ path: name, message: "field is not filterable" }); continue; }
    if (op === "contains" && spec.kind !== "text") { issues.push({ path: name, message: "contains works on text fields" }); continue; }
    if ((op === "gt" || op === "gte" || op === "lt" || op === "lte") && (spec.kind === "uuid" || spec.kind === "bool" || spec.kind === "enum")) { issues.push({ path: name, message: "range operators need a number, date or text field" }); continue; }
    const value = op === "in" ? raw.split(",").filter(Boolean).map((v) => coerce(spec, v, name, issues)) : coerce(spec, raw, name, issues);
    out.push({ field, op, value, custom: false });
  }
  if (out.length > MAX_FILTERS) issues.push({ path: "filter", message: `at most ${MAX_FILTERS} filters` });
  if (issues.length) throw new ApiError("invalid", "Some filters are not valid.", { errors: issues });
  return out;
}
