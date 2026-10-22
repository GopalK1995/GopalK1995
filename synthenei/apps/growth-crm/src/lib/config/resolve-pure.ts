// Pure part of resolution (no next/react imports) so scripts and edge code can use it.
import { TENANTS } from "../tenancy";
import { deepMerge } from "./merge";
import { presetConfig, type BrandDefaults } from "./presets";
import { validateEffective, type ConfigOverrides, type PresetId, type TenantConfig } from "./types";

export const brandDefaults = (tenantId: string): BrandDefaults => {
  const t = TENANTS.find((x) => x.id === tenantId);
  return { id: tenantId, name: t?.name ?? tenantId, product: t?.product ?? "Growth CRM", hue: t?.hue ?? 245 };
};
export const presetOfTenant = (tenantId: string): PresetId => TENANTS.find((x) => x.id === tenantId)?.vertical ?? "legal";
/** preset ⊕ overrides, falling back to the bare preset if the merged document breaks a cross-field rule. */
export function resolveEffective(tenantId: string, overrides: ConfigOverrides | undefined): TenantConfig {
  const base = presetConfig(overrides?.preset ?? presetOfTenant(tenantId), brandDefaults(tenantId));
  const merged = deepMerge(base, overrides);
  return validateEffective(merged).length ? base : merged;
}
