// Alert catalogue and message builder. Pure.
//   new enquiry       lead.created
//   SLA breached      lead.sla_breached   (no emitter exists yet: see docs/migrations-backlog.md "T049 needs")
//   advance received  payment.paid
//   sync failed       connector.sync.failed
// Privacy: events carry no PII and the default alert shows none either (source, city, amount, a link). A person's name is added only when
// the owner switched `include_names` on for this connection. Everything that came from data is escaped by the block builder.
import en from "../../../../messages/en/slack.json";
import ta from "../../../../messages/ta/slack.json";
import { buildAlertMessage, isHttpsUrl, plain, type AlertField, type SlackMessage } from "./blocks";
import { CRED } from "./constants";
import type { ConnectionSecrets } from "../core/types";

export const ALERT_KEYS = ["new_enquiry", "sla_breached", "advance_received", "sync_failed"] as const;
export type AlertKey = (typeof ALERT_KEYS)[number];
export const ALERT_EVENTS: Record<AlertKey, readonly string[]> = {
  new_enquiry: ["lead.created"],
  sla_breached: ["lead.sla_breached"],
  advance_received: ["payment.paid"],
  sync_failed: ["connector.sync.failed"],
};
export function alertForEvent(type: string): AlertKey | null {
  for (const k of ALERT_KEYS) if (ALERT_EVENTS[k].includes(type)) return k;
  return null;
}
export const ALERT_EVENT_TYPES: readonly string[] = ALERT_KEYS.flatMap((k) => ALERT_EVENTS[k]);

/** The alert switches kept in the credential bundle as a comma list. Absent = all on (the picker writes the explicit list). */
export function parseAlerts(v: string | undefined | null): AlertKey[] {
  if (v === undefined || v === null) return [...ALERT_KEYS];
  return v.split(",").map((x) => x.trim()).filter((x): x is AlertKey => (ALERT_KEYS as readonly string[]).includes(x));
}
export const serializeAlerts = (keys: readonly string[]): string => ALERT_KEYS.filter((k) => keys.includes(k)).join(",");

export type Locale = "en" | "ta";
export interface SlackSettings { channelId: string | null; channelName: string | null; alerts: AlertKey[]; includeNames: boolean; locale: Locale }
export function settingsOf(s: ConnectionSecrets): SlackSettings {
  return {
    channelId: s[CRED.channelId] || null, channelName: s[CRED.channelName] || null, alerts: parseAlerts(s[CRED.alerts]),
    includeNames: s[CRED.includeNames] === "1", locale: s[CRED.locale] === "ta" ? "ta" : "en",
  };
}

type Dict = { [k: string]: string | Dict };
const DICT: Record<Locale, Dict> = { en: en as unknown as Dict, ta: ta as unknown as Dict };
/** Looks up "a.b" in the locale dictionary (falls back to English, then to the key) and fills {params}. */
export function t(locale: Locale, key: string, params: Record<string, string | number> = {}): string {
  const find = (d: Dict): string | null => { let cur: string | Dict | undefined = d; for (const p of key.split(".")) { if (typeof cur !== "object" || cur === null) return null; cur = cur[p]; } return typeof cur === "string" ? cur : null; };
  const raw = find(DICT[locale]) ?? find(DICT.en) ?? key;
  return raw.replace(/\{(\w+)\}/g, (_m, k: string) => (k in params ? String(params[k]) : `{${k}}`));
}

/** What the store could say about the object an event is about. Names and amounts only; never contact details. */
export interface Subject {
  name?: string | null; source?: string | null; city?: string | null; status?: string | null;
  amountPaise?: number | null; currency?: string | null;
  /** The CRM record the alert links to. */
  link?: { type: "lead" | "deal"; id: string } | null;
}
export interface EventFacts { type: string; objectType: string | null; objectId: string | null; data: { connector?: string; stream?: string; reason?: string } }

export function formatAmount(paise: number, currency: string, locale: Locale): string {
  const major = paise / 100;
  const tag = locale === "ta" ? "ta-IN" : "en-IN";
  try { return new Intl.NumberFormat(tag, { style: "currency", currency, maximumFractionDigits: paise % 100 === 0 ? 0 : 2 }).format(major); } catch { return `${currency} ${major.toFixed(2)}`; }
}

const PATHS: Record<string, (id: string) => string> = { lead: (id) => `/leads/${id}`, deal: (id) => `/pipeline?deal=${id}` };
/** Absolute https link to a CRM path. The base comes from the deployment (APP_BASE_URL), never from code; no base or a non-https base = no button. */
export function crmUrl(baseUrl: string | undefined, path: string): string | null {
  const base = (baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!base) return null;
  const u = `${base}${path}`;
  return isHttpsUrl(u) ? u : null;
}

export interface BuildInput { key: AlertKey; event: EventFacts; subject: Subject | null; settings: Pick<SlackSettings, "includeNames" | "locale">; baseUrl?: string }

export function buildAlert(i: BuildInput): SlackMessage {
  const { key, subject, settings: { locale, includeNames }, event } = i;
  const f: AlertField[] = [];
  const add = (label: string, v: string | null | undefined) => { if (v && v.trim()) f.push({ label: t(locale, `field.${label}`), value: plain(v, 200) }); };
  let title: string, path: string | null = null, button = "button.lead";

  if (key === "new_enquiry" || key === "sla_breached") {
    const named = includeNames && subject?.name ? plain(subject.name, 100) : null;
    title = named ? t(locale, `alert.${key}_named`, { name: named }) : t(locale, `alert.${key}`);
    add("source", subject?.source); add("city", subject?.city); add("status", subject?.status);
    const id = subject?.link?.type === "lead" ? subject.link.id : event.objectType === "lead" ? event.objectId : null;
    path = id ? PATHS.lead(id) : null;
  } else if (key === "advance_received") {
    const amount = subject?.amountPaise != null ? formatAmount(subject.amountPaise, subject.currency || "INR", locale) : null;
    title = amount ? t(locale, "alert.advance_received_amount", { amount }) : t(locale, "alert.advance_received");
    add("amount", amount);
    const l = subject?.link;
    path = l ? PATHS[l.type](l.id) : null;
  } else {
    const connector = plain(event.data.connector ?? "", 60) || "-";
    title = t(locale, "alert.sync_failed", { connector });
    add("stream", event.data.stream); add("reason", event.data.reason?.replace(/_/g, " "));
    path = "/integrations"; button = "button.integration";
  }
  return buildAlertMessage({ title, fields: f, context: t(locale, "context"), url: path ? crmUrl(i.baseUrl, path) : null, buttonLabel: t(locale, button) });
}

export function buildTestMessage(locale: Locale, baseUrl?: string): SlackMessage {
  return buildAlertMessage({ title: t(locale, "alert.test"), context: t(locale, "testContext"), url: crmUrl(baseUrl, "/integrations"), buttonLabel: t(locale, "button.test") });
}
