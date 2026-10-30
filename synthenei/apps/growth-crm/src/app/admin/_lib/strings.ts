// Admin namespace lookup. Reads messages/en/admin.json directly until the integrator registers the `admin` namespace in src/i18n/registry.ts.
import en from "../../../../messages/en/admin.json";

const get = (k: string): string => { const v = (en as Record<string, unknown>)[k]; return typeof v === "string" ? v : k; };
export const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => String(k in vars ? vars[k] : m));
/** at("tenantCreated", { name }) */
export const at = (key: string, vars: Record<string, string | number> = {}) => fill(get(key), vars);
