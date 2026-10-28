import type { PermissionDef } from "../types";
const d = (key: string, description: string, o: Partial<PermissionDef> = {}): PermissionDef => { const i = key.lastIndexOf("."), resource = key.slice(0, i), action = key.slice(i + 1); return { key, resource, action, description, ...o }; };
export const PERMISSIONS: PermissionDef[] = [
  d("members.invite", "Invite members", { supportBlocked: true }),
  d("members.manage", "Manage members", { supportBlocked: true }),
  d("roles.manage", "Manage roles", { supportBlocked: true }),
  d("teams.manage", "Manage teams"),
  d("fields.manage", "Manage custom fields"),
  d("objects.manage", "Manage custom objects"),
  d("pipelines.manage", "Manage pipelines"),
  d("layouts.manage", "Manage layouts"),
  d("views.share", "Share saved views"),
  d("notifications.manage", "Manage notification rules"),
];
