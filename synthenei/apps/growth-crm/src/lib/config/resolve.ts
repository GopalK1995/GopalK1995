// Server-side resolution: effective = preset(tenant) merged with the tenant's stored overrides. Cached per request.
import { cache } from "react";
import { getSession } from "../auth/server";
import { supabaseConfigured } from "../supabase/server";
import { brandDefaults, presetOfTenant, resolveEffective } from "./resolve-pure";
import { CookieConfigStore, SupabaseConfigStore, type ConfigStore, type StoredConfig } from "./store";
import { MODULE_IDS, VERTICAL_FEATURES, type ModuleId, type TenantConfig, type VerticalFeature } from "./types";

/** Demo/mock sessions and deployments without Supabase use the cookie store; real sessions use tenant_config. */
export const getStore = cache(async (): Promise<ConfigStore> => {
  const s = await getSession();
  return !s || s.demo || !supabaseConfigured() ? new CookieConfigStore() : new SupabaseConfigStore();
});
export const getStored = cache(async (tenantId: string): Promise<StoredConfig> => {
  try { return await (await getStore()).read(tenantId); } catch (e) { console.error("config read failed", e); return { version: 0, overrides: { v: 1 }, updatedAt: null, updatedBy: null }; }
});

export const getEffectiveConfig = cache(async (tenantId: string): Promise<TenantConfig> => resolveEffective(tenantId, (await getStored(tenantId)).overrides));

/** Server-side module switch (nav hiding is the UI's; this is the enforcement hook). */
export async function isModuleEnabled(tenantId: string, module: ModuleId): Promise<boolean> {
  if (!MODULE_IDS.includes(module)) return false;
  return (await getEffectiveConfig(tenantId)).modules[module] !== false;
}
export async function isFeatureOn(tenantId: string, feature: VerticalFeature): Promise<boolean> {
  return VERTICAL_FEATURES.includes(feature) && (await getEffectiveConfig(tenantId)).features[feature] === true;
}

export { brandDefaults, presetOfTenant, resolveEffective };
