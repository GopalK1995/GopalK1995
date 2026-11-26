// Enabled object types for a tenant, once per request. requireActive() starts it with the tenant uuid from my_workspaces()
// (parallel with the config and grants reads); the sidebar loader awaits the same promise. Never throws: the caller treats a
// failure as "no custom entries" (a metadata problem must not take the shell down).
import { cache } from "react";
import { listObjectTypes } from "./repo";
import type { ObjectTypeDef } from "./types";

export type NavTypes = { ok: true; types: ObjectTypeDef[] } | { ok: false; error: unknown };

export const fetchNavTypes = cache(async (tenantUuid: string): Promise<NavTypes> => {
  try { return { ok: true, types: await listObjectTypes(tenantUuid) }; } catch (error) { return { ok: false, error }; }
});
