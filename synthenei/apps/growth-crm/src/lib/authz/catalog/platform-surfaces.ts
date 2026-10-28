import type { PermissionDef } from "../types";
const d = (key: string, description: string, o: Partial<PermissionDef> = {}): PermissionDef => { const i = key.lastIndexOf("."), resource = key.slice(0, i), action = key.slice(i + 1); return { key, resource, action, description, ...o }; };
export const PERMISSIONS: PermissionDef[] = [
  d("integrations.read", "View integrations"),
  d("integrations.manage", "Manage integrations", { supportBlocked: true }),
  d("webhooks.manage", "Manage webhooks", { supportBlocked: true }),
  d("api_keys.manage", "Manage API keys", { supportBlocked: true }),
  d("data_health.read", "View data health"),
  d("data_health.manage", "Run data health checks"),
  d("backups.manage", "Manage backups and alert rules"),
  d("privacy.fulfil", "Fulfil privacy requests and erasure", { supportBlocked: true }),
  d("billing.read", "View billing"),
  d("billing.manage", "Manage billing", { supportBlocked: true }),
  d("ai.use", "Use AI features"),
  d("ai.toggle", "Switch AI on or off", { supportBlocked: true }),
];
