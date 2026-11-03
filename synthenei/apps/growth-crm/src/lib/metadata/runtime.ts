// Server-side preparation of what a record page may send to the browser. Masked values are REMOVED here, before
// serialisation, and the permission internals (access roles, editablePerm) never leave the server.
import type { Principal } from "@/lib/authz";
import { visibleFields } from "./access";
import type { Choice, FieldDef, FieldType, I18nLabel } from "./types";

/** A definition as the client sees it. */
export interface ClientField {
  key: string; label: I18nLabel; type: FieldType; help?: I18nLabel; section: string | null; required: boolean; isPii: boolean;
  isFilterable: boolean; choices?: Choice[]; lookupObject?: string; min?: number; max?: number; maxLength?: number;
  edit: boolean; default: unknown;
}

export interface PreparedFields {
  fields: ClientField[];
  values: Record<string, unknown>;
  /** Visible fields that exist but the viewer may not edit are listed with edit=false; hidden ones are only counted. */
  hiddenCount: number;
}

export function toClientField(def: FieldDef, edit: boolean): ClientField {
  const v = def.validation ?? {};
  return {
    key: def.key, label: def.label, type: def.type, help: def.help, section: def.section, required: def.required, isPii: def.isPii,
    isFilterable: def.isFilterable, edit, default: def.default ?? null,
    ...(def.options.choices ? { choices: def.options.choices } : {}), ...(def.options.lookup ? { lookupObject: def.options.lookup.objectKey } : {}),
    ...(typeof v.min === "number" ? { min: v.min } : {}), ...(typeof v.max === "number" ? { max: v.max } : {}), ...(typeof v.maxLength === "number" ? { maxLength: v.maxLength } : {}),
  };
}

export function prepareCustomFields(o: { defs: FieldDef[]; values: Record<string, unknown>; principal: Principal | null; objectKey: string; canWriteRecord: boolean }): PreparedFields {
  const active = o.defs.filter((d) => !d.archivedAt).sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
  const vis = visibleFields(active, o.principal, { objectKey: o.objectKey, canWriteRecord: o.canWriteRecord });
  const values: Record<string, unknown> = {};
  for (const { def } of vis) if (def.key in o.values) values[def.key] = o.values[def.key];
  return { fields: vis.map(({ def, edit }) => toClientField(def, edit)), values, hiddenCount: active.length - vis.length };
}

/** Group by section, keeping field order; null section first under "". */
export function bySection<T extends { section: string | null }>(fields: T[]): { section: string; fields: T[] }[] {
  const order: string[] = [];
  const map = new Map<string, T[]>();
  for (const f of fields) {
    const s = f.section ?? "";
    if (!map.has(s)) { map.set(s, []); order.push(s); }
    map.get(s)!.push(f);
  }
  return order.sort((a, b) => (a === "" ? -1 : b === "" ? 1 : 0)).map((s) => ({ section: s, fields: map.get(s)! }));
}
