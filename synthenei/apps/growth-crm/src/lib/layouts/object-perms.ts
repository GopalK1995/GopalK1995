// Permission definitions for custom objects (obj:<key>.read|write|delete). The database creates the three rows when an object type
// is inserted (trigger metadata.object_type_perms); this builds the same definitions for the role editor so they appear next to the
// catalogue permissions without a code change. Pure.
import type { PermissionDef } from "@/lib/authz/types";

export const OBJECT_ACTIONS = ["read", "write", "delete"] as const;
export type ObjectAction = (typeof OBJECT_ACTIONS)[number];

export function objectPermissionDefs(objects: { key: string; label: string }[]): PermissionDef[] {
  return objects.flatMap((o) => OBJECT_ACTIONS.map((a): PermissionDef => ({
    key: `obj:${o.key}.${a}`, resource: `obj:${o.key}`, action: a,
    description: a === "read" ? `View ${o.label} records` : a === "write" ? `Create and edit ${o.label} records` : `Delete ${o.label} records`,
  })));
}
