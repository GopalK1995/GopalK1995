// List-page helper: which custom fields the viewer may see as columns/filters, and a row masker that removes the
// values they may not see from `row.custom` BEFORE the rows are serialised to a client component.
import type { Principal } from "@/lib/authz";
import { visibleFields, maskCustomValues } from "./access";
import { toClientField, type ClientField } from "./runtime";
import type { FieldDef } from "./types";

export interface ListFields { fields: ClientField[]; maskRow<T extends { custom?: Record<string, unknown> | null }>(row: T): T }

export function listFieldsFor(defs: FieldDef[], principal: Principal | null, objectKey: string): ListFields {
  const o = { objectKey, canWriteRecord: false };
  const active = defs.filter((d) => !d.archivedAt).sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
  return {
    fields: visibleFields(active, principal, o).map(({ def }) => toClientField(def, false)),
    maskRow: (row) => ({ ...row, custom: maskCustomValues(defs, row.custom ?? {}, principal, o) }),
  };
}
