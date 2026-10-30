// settingsAccess namespace. Reads messages/en/settings-access.json directly until the integrator registers the
// namespace in src/i18n/registry.ts (same approach as tasks). Pure: safe in server and client bundles.
import en from "../../../../../../messages/en/settings-access.json";

const tree = en as Record<string, string>;
export const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => String(k in vars ? vars[k] : m));
export function sa(key: string, vars: Record<string, string | number> = {}): string {
  const v = tree[key];
  return typeof v === "string" ? fill(v, vars) : key;
}
/** Whole namespace for client components (placeholders stay as {x}). */
export const saAll = (): Record<string, string> => ({ ...tree });
export const EN_KEYS = Object.keys(tree);
