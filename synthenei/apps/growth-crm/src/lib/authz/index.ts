// Authz public API (CONTRACTS C3.2), pure and client-safe. Server loaders: import { loadPrincipal, assertCan } from "@/lib/authz/load".
export * from "./types";
export { AuthzError, decide, can, explain, enforce, denyMessageKey, maskRecord, scopeFilter, readPermissionOf, type Explanation, type StepTrace } from "./engine";
export { evaluateConditions, validateConditions, type Issue } from "./conditions";
export { PERMISSIONS, PERMISSION_BY_KEY, permissionDef } from "./catalog";
export { PAGE_PERMISSION, pagePermission, moduleOfPermission } from "./pages";
export { systemPrincipal, principalFromMyGrants } from "./principal";
export { systemGrants } from "./system-grants";
