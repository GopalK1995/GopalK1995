import type { PermissionDef } from "../types";
const d = (key: string, description: string, o: Partial<PermissionDef> = {}): PermissionDef => { const i = key.lastIndexOf("."), resource = key.slice(0, i), action = key.slice(i + 1); return { key, resource, action, description, ...o }; };
export const PERMISSIONS: PermissionDef[] = [
  d("dashboard.read", "View the dashboard"),
  d("myday.read", "View My Day"),
  d("settings.read", "View settings"),
  d("pii.read", "See email and phone unmasked", { isPii: true }),
  d("records.share", "Share records with users, teams or roles"),
  d("comments.write", "Write comments"),
  d("comments.moderate", "Moderate comments"),
  d("audit.read", "Read the audit log"),
  d("org.admin", "Administer the organisation and workspaces", { supportBlocked: true }),
  d("org.branding", "Change branding and fonts", { supportBlocked: true }),
  d("config.edit", "Edit tenant configuration"),
];
