import type { FieldDef } from "../types";

let n = 0;
export function def(p: Partial<FieldDef> & Pick<FieldDef, "key" | "type">): FieldDef {
  n += 1;
  return {
    id: `f${n}`, objectTypeId: "ot1", label: { en: p.key }, options: {}, required: false, uniqueInWorkspace: false, isPii: false,
    isSearchable: false, isFilterable: true, default: null, validation: {}, section: null, position: n, editablePerm: null, archivedAt: null, rev: "2026-10-31T00:00:00Z", ...p,
  };
}
export const UUID = "123e4567-e89b-12d3-a456-426614174000";
