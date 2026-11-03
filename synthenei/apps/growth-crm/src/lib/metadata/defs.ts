// field_defs rows <-> FieldDef, the editor input schema, and pure planning helpers (choice retire, diff, destructive check).
import { z } from "zod";
import { checkValue, coerceValue } from "./validate";
import { FIELD_COLORS, FIELD_KEY_RE, FIELD_TYPES, type Choice, type FieldDef, type FieldType, type I18nLabel } from "./types";

type Row = Record<string, unknown>;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function fieldFromRow(r: Row): FieldDef {
  const label = obj(r.label), help = obj(r.help);
  return {
    id: String(r.id), objectTypeId: String(r.object_type_id ?? r.objectTypeId ?? ""), key: String(r.key),
    label: { en: String(label.en ?? r.key), ...(typeof label.ta === "string" ? { ta: label.ta } : {}) },
    type: r.type as FieldType, options: obj(r.options) as FieldDef["options"],
    required: !!r.required, uniqueInWorkspace: !!(r.unique_in_workspace ?? r.uniqueInWorkspace), isPii: !!(r.is_pii ?? r.isPii),
    isSearchable: !!(r.is_searchable ?? r.isSearchable), isFilterable: !!(r.is_filterable ?? r.isFilterable),
    default: r.default ?? null, validation: obj(r.validation) as FieldDef["validation"],
    help: typeof help.en === "string" ? { en: help.en, ...(typeof help.ta === "string" ? { ta: help.ta } : {}) } : undefined,
    section: (r.section as string | null) ?? null, position: Number(r.position ?? 0),
    editablePerm: ((r.editable_perm ?? r.editablePerm) as string | null) ?? null,
    archivedAt: ((r.archived_at ?? r.archivedAt) as string | null) ?? null,
    rev: typeof r.updated_at === "string" ? r.updated_at : undefined,
  };
}

/** Columns written to field_defs (snake_case). */
export function rowFromField(f: Omit<FieldDef, "id" | "objectTypeId" | "position" | "archivedAt" | "rev">): Row {
  return {
    key: f.key, label: f.label, type: f.type, options: f.options, required: f.required, unique_in_workspace: f.uniqueInWorkspace,
    is_pii: f.isPii, is_searchable: f.isSearchable, is_filterable: f.isFilterable, default: f.default ?? null, validation: f.validation,
    help: f.help ?? {}, section: f.section, editable_perm: f.editablePerm,
  };
}

const label = z.object({ en: z.string().trim().min(1, "Enter a label").max(80), ta: z.string().trim().max(80).optional().or(z.literal("")) });
const choice = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9_]{0,40}$/, "Use lowercase letters, numbers and underscores"),
  label, color: z.enum(FIELD_COLORS as [string, ...string[]]).optional(), archived: z.boolean().optional(),
});
const roles = z.array(z.string().min(1).max(60)).max(30).optional();
const NO_UNIQUE: FieldType[] = ["boolean", "long_text", "multi_select", "rating"];

export const fieldInputSchema = z.object({
  objectKey: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  key: z.string().regex(FIELD_KEY_RE, "Use lowercase letters, numbers and underscores (2 to 41 characters, starting with a letter)"),
  label, type: z.enum(FIELD_TYPES as unknown as [FieldType, ...FieldType[]]),
  help: label.partial({ en: true }).optional(),
  section: z.string().trim().max(60).nullable().optional(),
  required: z.boolean().default(false), uniqueInWorkspace: z.boolean().default(false), isPii: z.boolean().default(false),
  isSearchable: z.boolean().default(false), isFilterable: z.boolean().default(false),
  default: z.unknown().optional(),
  choices: z.array(choice).max(100).optional(),
  lookupObject: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/).optional(),
  validation: z.object({ pattern: z.string().max(300).optional(), maxLength: z.number().int().min(1).max(20000).optional(), min: z.number().optional(), max: z.number().optional() }).optional(),
  editablePerm: z.string().regex(/^[a-z_]+(:[a-z0-9_]+)?\.[a-z_]+$/).nullable().optional(),
  viewRoles: roles, editRoles: roles,
}).superRefine((v, ctx) => {
  const bad = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  const choices = v.choices ?? [];
  if ((v.type === "select" || v.type === "multi_select")) {
    if (!choices.filter((c) => !c.archived).length) bad("choices", "Add at least one option");
    if (new Set(choices.map((c) => c.key)).size !== choices.length) bad("choices", "Option keys must be different");
  }
  if (v.type === "lookup" && !v.lookupObject) bad("lookupObject", "Choose which object this points to");
  if (v.uniqueInWorkspace && NO_UNIQUE.includes(v.type)) bad("uniqueInWorkspace", "This type cannot be unique");
  if (v.validation?.pattern) { try { new RegExp(v.validation.pattern); } catch { bad("validation", "The pattern is not a valid expression"); } }
  if (v.validation?.min !== undefined && v.validation?.max !== undefined && v.validation.min > v.validation.max) bad("validation", "Minimum is above the maximum");
  const def = fieldFromInput(v);
  if (v.default !== undefined && v.default !== null && v.default !== "") {
    const dv = coerceValue(def, v.default);
    const err = checkValue(def, dv);
    if (err) bad("default", `The default ${err}`);
  }
});
export type FieldInput = z.input<typeof fieldInputSchema>;
export type FieldInputParsed = z.output<typeof fieldInputSchema>;

/** Editor input to the stored shape (no id). Empty labels in other locales are dropped. */
export function fieldFromInput(v: FieldInputParsed): Omit<FieldDef, "id" | "objectTypeId" | "position" | "archivedAt" | "rev"> {
  const lab = (l: { en: string; ta?: string }): I18nLabel => ({ en: l.en, ...(l.ta ? { ta: l.ta } : {}) });
  const options: FieldDef["options"] = {};
  if (v.type === "select" || v.type === "multi_select") options.choices = (v.choices ?? []).map((c) => ({ key: c.key, label: lab(c.label), ...(c.color ? { color: c.color as Choice["color"] } : {}), ...(c.archived ? { archived: true } : {}) }));
  if (v.type === "lookup" && v.lookupObject) options.lookup = { objectKey: v.lookupObject };
  if (v.type === "money") options.currency = "INR";
  if (v.viewRoles?.length || v.editRoles?.length) options.access = { ...(v.viewRoles?.length ? { viewRoles: v.viewRoles } : {}), ...(v.editRoles?.length ? { editRoles: v.editRoles } : {}) };
  const validation: FieldDef["validation"] = {};
  if (v.validation?.pattern) validation.pattern = v.validation.pattern;
  for (const k of ["maxLength", "min", "max"] as const) if (typeof v.validation?.[k] === "number") validation[k] = v.validation[k];
  const base = { key: v.key, label: lab(v.label), type: v.type, options, required: v.required, uniqueInWorkspace: v.uniqueInWorkspace, isPii: v.isPii, isSearchable: v.isSearchable, isFilterable: v.isFilterable, validation, section: v.section || null, editablePerm: v.editablePerm ?? null, help: v.help?.en ? lab({ en: v.help.en, ta: v.help.ta }) : undefined, default: null as unknown };
  const dv = v.default === undefined || v.default === null || v.default === "" ? null : coerceValue({ type: v.type }, v.default);
  return { ...base, default: dv };
}

/** Editor input for an existing definition, to prefill the form. */
export function inputFromField(objectKey: string, f: FieldDef): FieldInput {
  return {
    objectKey, key: f.key, label: { en: f.label.en, ta: f.label.ta ?? "" }, type: f.type, help: f.help ? { en: f.help.en, ta: f.help.ta ?? "" } : undefined,
    section: f.section, required: f.required, uniqueInWorkspace: f.uniqueInWorkspace, isPii: f.isPii, isSearchable: f.isSearchable, isFilterable: f.isFilterable,
    default: f.default ?? undefined,
    choices: f.options.choices?.map((c) => ({ key: c.key, label: { en: c.label.en, ta: c.label.ta ?? "" }, color: c.color, archived: c.archived })),
    lookupObject: f.options.lookup?.objectKey,
    validation: { pattern: f.validation.pattern ?? f.validation.regex, maxLength: f.validation.maxLength, min: f.validation.min, max: f.validation.max },
    editablePerm: f.editablePerm, viewRoles: f.options.access?.viewRoles, editRoles: f.options.access?.editRoles,
  };
}

/** "Deal size" -> "deal_size"; never empty, always a legal key. */
export function keyFromLabel(text: string): string {
  const k = text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[0-9_]+/, "").slice(0, 41);
  return k.length >= 2 ? k : "field";
}

/**
 * Options removed from the list are retired, never dropped: existing values keep validating (the DB checks keys against
 * options.choices) and old records keep their label. Returns the merged list and the keys that were just retired.
 */
export function reconcileChoices(prev: Choice[], next: Choice[]): { choices: Choice[]; retired: string[]; restored: string[] } {
  const nextKeys = new Set(next.map((c) => c.key));
  const retired: string[] = [], restored: string[] = [];
  const kept = next.map((c) => {
    const old = prev.find((p) => p.key === c.key);
    if (old?.archived && !c.archived) restored.push(c.key);
    return c;
  });
  const dropped = prev.filter((p) => !nextKeys.has(p.key)).map((p) => {
    if (!p.archived) retired.push(p.key);
    return { ...p, archived: true };
  });
  for (const c of next) if (c.archived && !prev.find((p) => p.key === c.key)?.archived) retired.push(c.key);
  return { choices: [...kept, ...dropped], retired: [...new Set(retired)], restored };
}

export type FieldChange = { field: string; from: unknown; to: unknown };
const WATCH: (keyof FieldDef)[] = ["label", "type", "required", "uniqueInWorkspace", "isPii", "isSearchable", "isFilterable", "default", "validation", "help", "section", "editablePerm"];
/** Changed properties between two definitions, for the audit detail and the metadata.changed event. */
export function diffField(a: FieldDef, b: FieldDef): FieldChange[] {
  const out: FieldChange[] = [];
  for (const k of WATCH) if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) out.push({ field: k, from: a[k] ?? null, to: b[k] ?? null });
  if (JSON.stringify(a.options.choices ?? null) !== JSON.stringify(b.options.choices ?? null)) out.push({ field: "choices", from: a.options.choices?.map((c) => c.key) ?? null, to: b.options.choices?.map((c) => c.key) ?? null });
  if (JSON.stringify(a.options.access ?? null) !== JSON.stringify(b.options.access ?? null)) out.push({ field: "access", from: a.options.access ?? null, to: b.options.access ?? null });
  if (JSON.stringify(a.options.lookup ?? null) !== JSON.stringify(b.options.lookup ?? null)) out.push({ field: "lookup", from: a.options.lookup ?? null, to: b.options.lookup ?? null });
  return out;
}

/** Order helper: new positions after moving `key` by `delta` (-1 up, +1 down) among the given (active) fields. */
export function reorder(fields: Pick<FieldDef, "id" | "key" | "position">[], key: string, delta: -1 | 1): { id: string; position: number }[] {
  const sorted = [...fields].sort((x, y) => x.position - y.position || x.key.localeCompare(y.key));
  const i = sorted.findIndex((f) => f.key === key), j = i + delta;
  if (i < 0 || j < 0 || j >= sorted.length) return [];
  [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  return sorted.map((f, n) => ({ id: f.id, position: n })).filter((p) => fields.find((f) => f.id === p.id)?.position !== p.position);
}
