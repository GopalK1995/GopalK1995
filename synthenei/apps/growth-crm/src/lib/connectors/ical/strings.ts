// Strings for the needs_attention notice and the integration's last_error (stored per locale in notifications.title/body).
import en from "../../../../messages/en/ota.json";
import ta from "../../../../messages/ta/ota.json";

type Dict = Record<string, string>;
const D: Record<"en" | "ta", Dict> = { en: en as Dict, ta: ta as Dict };
const t = (l: "en" | "ta", key: string): string => D[l][key] ?? D.en[key] ?? key;
const fill = (s: string, vars: Record<string, string>): string => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));

const KNOWN = new Set(["http_401", "http_403", "http_404", "not_ical", "empty_feed", "timeout", "too_large", "blocked_address"]);
const reasonKey = (code: string): string => `reason_${KNOWN.has(code) ? code : "other"}`;

/** `label` is the feed's own label (never its URL). */
export function noticeFor(label: string, code: string): { message: string; title: Record<string, string>; body: Record<string, string> } {
  const per = (l: "en" | "ta") => ({ title: t(l, "feedFailing_title"), body: fill(t(l, "feedFailing_body"), { label, reason: t(l, reasonKey(code)) }) });
  return {
    message: fill(t("en", "feedFailing_message"), { reason: t("en", reasonKey(code)) }),
    title: { en: per("en").title, ta: per("ta").title },
    body: { en: per("en").body, ta: per("ta").body },
  };
}
