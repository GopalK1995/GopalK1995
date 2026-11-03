// webhooks namespace. Reads messages/en/webhooks.json directly until the integrator registers the namespace in src/i18n/registry.ts
// (same approach as api-keys and settings-access). Pure: safe in server and client bundles.
import en from "../../../../../../messages/en/webhooks.json";

const tree = en as Record<string, string>;
export const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => String(k in vars ? vars[k] : m));
export function wh(key: string, vars: Record<string, string | number> = {}): string {
  const v = tree[key];
  return typeof v === "string" ? fill(v, vars) : key;
}
/** Whole namespace for client components (placeholders stay as {x}). */
export const whAll = (): Record<string, string> => ({ ...tree });
