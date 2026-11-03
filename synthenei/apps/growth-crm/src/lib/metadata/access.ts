// Field-level visibility and edit permission. Pure: used on the server to strip values BEFORE they are serialised to the
// client, and again by the save action to refuse writes to fields the caller may not touch.
import { can, readPermissionOf, type ObjectType, type Principal } from "@/lib/authz";
import { authzTypeOf, type FieldDef } from "./types";

export interface FieldPerm { view: boolean; edit: boolean }

const hasPii = (p: Principal) => !!p.grants["pii.read"] && p.grants["pii.read"].scope !== "none";

/**
 * view: not retired, not PII for a viewer without pii.read, role allowed by options.access.viewRoles, not in the read
 * grant's fieldMask ("custom.<key>" or "<key>"). Admins with fields.manage always see values (they define them).
 * edit: view AND the record is writable AND role allowed by options.access.editRoles AND editablePerm (when set) is held.
 */
export function fieldPerm(def: FieldDef, p: Principal | null, o: { objectKey: string; canWriteRecord: boolean }): FieldPerm {
  if (!p || def.archivedAt) return { view: false, edit: false };
  const manager = can(p, "fields.manage");
  const role = p.roleKey ?? "";
  const acc = def.options?.access;
  if (!manager) {
    if (def.isPii && !hasPii(p)) return { view: false, edit: false };
    if (acc?.viewRoles?.length && !acc.viewRoles.includes(role)) return { view: false, edit: false };
    const mask = p.grants[readPermissionOf(authzTypeOf(o.objectKey) as ObjectType)]?.fieldMask ?? [];
    if (mask.includes(def.key) || mask.includes(`custom.${def.key}`)) return { view: false, edit: false };
  }
  const roleEdit = !acc?.editRoles?.length || acc.editRoles.includes(role);
  const permEdit = !def.editablePerm || can(p, def.editablePerm);
  return { view: true, edit: o.canWriteRecord && roleEdit && permEdit };
}

/** Defs the viewer may see, with their edit flag. */
export function visibleFields(defs: FieldDef[], p: Principal | null, o: { objectKey: string; canWriteRecord: boolean }): { def: FieldDef; edit: boolean }[] {
  return defs.flatMap((def) => { const r = fieldPerm(def, p, o); return r.view ? [{ def, edit: r.edit }] : []; });
}

/** Keeps only the keys the viewer may see. Masked values are removed, not blanked: they never reach the client. */
export function maskCustomValues(defs: FieldDef[], values: Record<string, unknown>, p: Principal | null, o: { objectKey: string; canWriteRecord: boolean }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { def } of visibleFields(defs, p, o)) if (def.key in values) out[def.key] = values[def.key];
  return out;
}

/** Defs the viewer may NOT edit, among the keys they tried to change. */
export function deniedEdits(defs: FieldDef[], keys: string[], p: Principal | null, o: { objectKey: string; canWriteRecord: boolean }): string[] {
  const by = new Map(defs.map((d) => [d.key, d]));
  return keys.filter((k) => { const d = by.get(k); return !d || !fieldPerm(d, p, o).edit; });
}
