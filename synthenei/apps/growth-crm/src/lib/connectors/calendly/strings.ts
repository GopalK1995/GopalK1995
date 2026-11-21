// Strings for notifications and task titles written by the booking connectors (stored per locale in notifications.title/body).
import en from "../../../../messages/en/calendly.json";
import ta from "../../../../messages/ta/calendly.json";

type Dict = Record<string, string>;
const D: Record<"en" | "ta", Dict> = { en: en as Dict, ta: ta as Dict };
export const t = (l: "en" | "ta", key: string): string => D[l][key] ?? D.en[key] ?? key;
export const fill = (s: string, vars: Record<string, string> = {}): string => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
