// billing namespace. Reads messages/en/billing.json directly until the integrator registers it in src/i18n/registry.ts
// (same approach as the api and settings-access namespaces). Pure: safe in server and client bundles.
import en from "../../../messages/en/billing.json";

const tree = en as Record<string, string>;
export const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => String(k in vars ? vars[k] : m));
export function bt(key: string, vars: Record<string, string | number> = {}): string {
  const v = tree[key];
  return typeof v === "string" ? fill(v, vars) : key;
}
/** Whole namespace for client components (placeholders stay as {x}). */
export const btAll = (): Record<string, string> => ({ ...tree });
/** Message for a service failure code (err_<code>), falling back to the generic error. */
export const errText = (code: string): string => (`err_${code}` in tree ? bt(`err_${code}`) : bt("err_error"));
