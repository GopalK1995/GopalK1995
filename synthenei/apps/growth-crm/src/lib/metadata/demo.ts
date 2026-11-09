// Demo workspaces never touch Supabase. They get a few example custom fields per object, clearly labelled as examples,
// so the editor and the renderers can be shown. Ids are stable strings (demo ids are not uuids).
import type { FieldDef, ObjectTypeDef, SystemObjectKey } from "./types";
import { SYSTEM_OBJECT_KEYS } from "./types";

export const DEMO_EXAMPLE_TAG = "Example";

const base = (objectKey: string, i: number, f: Partial<FieldDef> & Pick<FieldDef, "key" | "label" | "type">): FieldDef => ({
  id: `demo-${objectKey}-${f.key}`, objectTypeId: `demo-ot-${objectKey}`, options: {}, required: false, uniqueInWorkspace: false, isPii: false,
  isSearchable: false, isFilterable: true, default: null, validation: {}, section: DEMO_EXAMPLE_TAG, position: i, editablePerm: null, archivedAt: null, ...f,
});

export function demoFields(objectKey: string): FieldDef[] {
  const k = objectKey;
  const common: FieldDef[] = [
    base(k, 0, { key: "example_source_note", label: { en: "Example: where we met", ta: "எடுத்துக்காட்டு: சந்தித்த இடம்" }, type: "text", isSearchable: true }),
    base(k, 1, { key: "example_priority", label: { en: "Example: priority", ta: "எடுத்துக்காட்டு: முன்னுரிமை" }, type: "select",
      options: { choices: [
        { key: "high", label: { en: "High", ta: "அதிகம்" }, color: "danger" },
        { key: "normal", label: { en: "Normal", ta: "சாதாரணம்" }, color: "neutral" },
        { key: "low", label: { en: "Low", ta: "குறைவு" }, color: "info" },
      ] }, default: "normal" }),
  ];
  if (k === "lead" || k === "deal") common.push(base(k, 2, { key: "example_budget", label: { en: "Example: budget (INR)", ta: "எடுத்துக்காட்டு: பட்ஜெட் (INR)" }, type: "money", options: { currency: "INR" } }));
  if (k === "contact" || k === "lead") common.push(base(k, 3, { key: "example_alt_phone", label: { en: "Example: alternate phone", ta: "எடுத்துக்காட்டு: மாற்று தொலைபேசி" }, type: "phone", isPii: true }));
  if (k === "task") common.push(base(k, 2, { key: "example_needs_travel", label: { en: "Example: needs travel" }, type: "boolean" }));
  return common;
}

export function demoObjects(): ObjectTypeDef[] {
  const label = (one: string) => ({ en: { one, many: `${one}s` } });
  return SYSTEM_OBJECT_KEYS.map((key: SystemObjectKey) => ({ id: `demo-ot-${key}`, key, kind: "system" as const, label: label(key), icon: "box", primaryField: "name", isEnabled: true, schemaVersion: 1 }));
}

export const demoObject = (key: string): ObjectTypeDef | null => demoObjects().find((o) => o.key === key) ?? null;

/** Example values for the labelled example fields, so a demo record page shows something to read. Never saved. */
export function demoCustomValues(objectKey: string): Record<string, unknown> {
  const v: Record<string, unknown> = { example_source_note: "Example value", example_priority: "normal" };
  if (objectKey === "lead" || objectKey === "deal") v.example_budget = 250000;
  return v;
}
