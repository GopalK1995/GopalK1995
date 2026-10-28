import type { PermissionDef } from "../types";
const d = (key: string, description: string, o: Partial<PermissionDef> = {}): PermissionDef => { const i = key.lastIndexOf("."), resource = key.slice(0, i), action = key.slice(i + 1); return { key, resource, action, description, ...o }; };
export const PERMISSIONS: PermissionDef[] = [
  d("platform.tenants.manage", "Manage tenants", { platformOnly: true }),
  d("platform.policies.manage", "Manage org policies", { platformOnly: true }),
  d("platform.support", "Open support sessions", { platformOnly: true }),
  d("platform.billing", "Platform billing", { platformOnly: true }),
  d("platform.read", "Read platform console", { platformOnly: true }),
];
