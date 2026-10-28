import type { PermissionDef } from "../types";
const d = (key: string, description: string, o: Partial<PermissionDef> = {}): PermissionDef => { const i = key.lastIndexOf("."), resource = key.slice(0, i), action = key.slice(i + 1); return { key, resource, action, description, ...o }; };
export const PERMISSIONS: PermissionDef[] = [
  d("campaigns.read", "View campaigns"),
  d("campaigns.write", "Edit campaigns"),
  d("segments.read", "View segments"),
  d("segments.write", "Edit segments"),
  d("audience.export", "Export audiences", { supportBlocked: true }),
  d("analytics.read", "View analytics"),
  d("analytics.write", "Configure analytics"),
];
