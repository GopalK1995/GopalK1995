// Segment compiler: [{field, op:"in", values}] -> parameterised filters. AND across rules, OR within a rule's values.
// Field names are resolved through an allow-list (system fields + is_filterable custom fields); values are bound as data and
// screened for quote/backslash/control characters because PostgREST serialises `in.(...)` lists. Anything else is rejected.
import { CUSTOM_KEY_RE, LIMITS, SYSTEM_FIELDS, type CustomFieldRef, type SegmentField } from "./fields";

export interface SegmentRule { field: string; op: "in"; values: string[] }
export interface CompiledFilter { field: SegmentField; column: string; values: string[] }
export type CompileError = { path: string; code: "unknown_field" | "bad_op" | "bad_value" | "too_many" | "duplicate_field" | "bad_shape"; message: string };
export type Compiled = { ok: true; filters: CompiledFilter[]; ignored: number } | { ok: false; errors: CompileError[] };


const hasUnsafe = (v: string) => [...v].some((ch) => { const c = ch.charCodeAt(0); return ch === '"' || ch === "'" || ch === "\\" || c < 32 || c === 127; });
export const safeValue = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= LIMITS.valueLen && !hasUnsafe(v);

export function resolveField(key: string, custom: readonly CustomFieldRef[] = []): SegmentField | null {
  const sys = SYSTEM_FIELDS.find((f) => f.key === key);
  if (sys) return sys;
  // Custom fields live in the leads.custom jsonb column; the key is re-validated against both the shape and the caller's list.
  if (CUSTOM_KEY_RE.test(key) && custom.some((c) => c.key === key)) return { key, column: `custom->>${key}`, kind: "text", custom: true };
  return null;
}

export function compileRules(input: unknown, custom: readonly CustomFieldRef[] = []): Compiled {
  if (!Array.isArray(input)) return { ok: false, errors: [{ path: "", code: "bad_shape", message: "Rules must be a list." }] };
  if (input.length > LIMITS.rules) return { ok: false, errors: [{ path: "", code: "too_many", message: `At most ${LIMITS.rules} rules.` }] };
  const errors: CompileError[] = [];
  const filters: CompiledFilter[] = [];
  const seen = new Set<string>();
  let ignored = 0;
  input.forEach((raw, i) => {
    const p = `rules.${i}`;
    if (typeof raw !== "object" || raw === null) { errors.push({ path: p, code: "bad_shape", message: "Rule must be an object." }); return; }
    const r = raw as Record<string, unknown>;
    if (typeof r.field !== "string") { errors.push({ path: `${p}.field`, code: "bad_shape", message: "Rule needs a field." }); return; }
    const field = resolveField(r.field, custom);
    if (!field) { errors.push({ path: `${p}.field`, code: "unknown_field", message: "That field cannot be used in a segment." }); return; }
    if (r.op !== undefined && r.op !== "in") { errors.push({ path: `${p}.op`, code: "bad_op", message: "Only 'is any of' is supported." }); return; }
    if (seen.has(field.key)) { errors.push({ path: `${p}.field`, code: "duplicate_field", message: "Use each field once; put alternatives in the same rule." }); return; }
    seen.add(field.key);
    if (!Array.isArray(r.values)) { errors.push({ path: `${p}.values`, code: "bad_shape", message: "Values must be a list." }); return; }
    if (r.values.length > LIMITS.values) { errors.push({ path: `${p}.values`, code: "too_many", message: `At most ${LIMITS.values} values per rule.` }); return; }
    if (r.values.length === 0) { ignored++; return; } // an empty rule constrains nothing (matches the builder)
    const bad = r.values.findIndex((v) => !safeValue(v));
    if (bad >= 0) { errors.push({ path: `${p}.values.${bad}`, code: "bad_value", message: "That value contains characters that are not allowed." }); return; }
    const values = [...new Set(r.values as string[])];
    if (field.kind === "bool" && values.some((v) => v !== "true" && v !== "false")) { errors.push({ path: `${p}.values`, code: "bad_value", message: "Use true or false." }); return; }
    filters.push({ field, column: field.column, values });
  });
  return errors.length ? { ok: false, errors } : { ok: true, filters, ignored };
}

/** Canonical rules for storage: only the allow-listed shape, empty rules dropped. */
export function normalizeRules(filters: CompiledFilter[]): SegmentRule[] {
  return filters.map((f) => ({ field: f.field.key, op: "in" as const, values: f.values }));
}

/** Reads rules back from audience_segments.rules (jsonb). Legacy {field, values} rows without `op` load as "in". */
export function parseStoredRules(raw: unknown): SegmentRule[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r) => {
    if (typeof r !== "object" || r === null) return [];
    const x = r as { field?: unknown; values?: unknown };
    return typeof x.field === "string" && Array.isArray(x.values) ? [{ field: x.field, op: "in" as const, values: x.values.filter((v): v is string => typeof v === "string") }] : [];
  });
}
