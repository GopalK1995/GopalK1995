// Target fields per import object: the system columns an import may write, plus the workspace's custom field_defs.
// Labels are i18n keys resolved by the caller (`label` here is the English fallback / field_def label), never tenant words.
import type { FieldDef, FieldType } from "@/lib/metadata/types";
import type { FieldKind, ImportObject, TargetField } from "./types";

type Sys = Omit<TargetField, "label"> & { labelKey: string };
const S = (key: string, kind: FieldKind, labelKey: string, extra: Partial<Sys> = {}): Sys => ({ key, kind, labelKey, ...extra });

/** System columns. `labelKey` is a key of the `imports.fields` i18n group. */
export const SYSTEM_TARGETS: Record<ImportObject, Sys[]> = {
  lead: [
    S("full_name", "text", "fullName", { required: true, aliases: ["name", "full name", "contact name", "contact", "lead name"] }),
    S("phone", "phone", "phone", { aliases: ["mobile", "mobile number", "phone number", "whatsapp", "contact number", "tel"], isPii: true }),
    S("email", "email", "email", { aliases: ["e-mail", "email address", "mail"], isPii: true }),
    S("firm_name", "text", "organisation", { aliases: ["company", "organisation", "organization", "firm", "account", "guest", "business"] }),
    S("role_title", "text", "roleTitle", { aliases: ["role", "title", "designation", "job title"] }),
    S("city", "text", "city", { aliases: ["town", "location"] }),
    S("district", "text", "district", { aliases: ["region", "area"] }),
    S("source", "text", "source", { aliases: ["lead source", "source_channel", "channel", "origin"] }),
    S("practice_area", "text", "category", { aliases: ["category", "interest", "segment", "type"] }),
    S("consent_marketing", "boolean", "consentMarketing", { aliases: ["marketing_consent", "marketing consent", "opt in", "opt-in"] }),
    S("consent_whatsapp", "boolean", "consentWhatsapp", { aliases: ["whatsapp_consent", "whatsapp consent"] }),
  ],
  contact: [
    S("full_name", "text", "fullName", { required: true, aliases: ["name", "full name", "contact name", "contact"] }),
    S("role_title", "text", "roleTitle", { aliases: ["role", "title", "designation", "job title"] }),
    S("email", "email", "email", { aliases: ["e-mail", "email address", "mail"], isPii: true }),
    S("phone", "phone", "phone", { aliases: ["mobile", "mobile number", "phone number", "whatsapp", "contact number", "tel"], isPii: true }),
    S("preferred_language", "select", "language", { aliases: ["language", "lang"], choices: ["en", "ta"] }),
    S("is_decision_maker", "boolean", "decisionMaker", { aliases: ["decision maker", "decision_maker"] }),
  ],
  account: [
    S("name", "text", "accountName", { required: true, aliases: ["account", "company", "organisation", "organization", "firm", "business", "account name"] }),
    S("city", "text", "city", { aliases: ["town", "location"] }),
    S("district", "text", "district", { aliases: ["region", "area"] }),
    S("state", "text", "state", { aliases: ["province"] }),
    S("address_line", "text", "address", { aliases: ["address", "street"] }),
    S("website", "url", "website", { aliases: ["site", "url", "web"] }),
    S("current_tools", "text", "currentTools", { aliases: ["tools", "current tools"] }),
    S("size_band", "select", "sizeBand", { aliases: ["size", "company size"], choices: ["solo", "2-5", "6-20", "21-50", "50+"] }),
  ],
};

const KIND_OF: Partial<Record<FieldType, FieldKind>> = {
  text: "text", long_text: "text", number: "number", money: "number", percent: "number", rating: "number", date: "date", datetime: "date",
  boolean: "boolean", select: "select", phone: "phone", email: "email", url: "url",
};

/** Workspace field_defs that an import can fill (retired and unsupported types are left out). */
export function customTargets(defs: FieldDef[], locale: "en" | "ta" = "en"): TargetField[] {
  return defs.filter((d) => !d.archivedAt && KIND_OF[d.type]).map((d) => ({
    key: `custom.${d.key}`,
    label: d.label[locale] ?? d.label.en,
    kind: KIND_OF[d.type] as FieldKind,
    required: d.required,
    aliases: [d.key.toLowerCase(), d.label.en.toLowerCase()],
    choices: d.type === "select" ? (d.options.choices ?? []).flatMap((c) => [c.key, c.label.en]) : undefined,
    isPii: d.isPii,
  }));
}

export function targetsFor(object: ImportObject, labelOf: (labelKey: string) => string, defs: FieldDef[] = [], locale: "en" | "ta" = "en"): TargetField[] {
  return [...SYSTEM_TARGETS[object].map(({ labelKey, ...t }) => ({ ...t, label: labelOf(labelKey) })), ...customTargets(defs, locale)];
}

/** DB table for an import object. */
export const TABLE_OF: Record<ImportObject, string> = { lead: "leads", contact: "contacts", account: "accounts" };
/** Permission that lets a user create or change that object; `leads.import` is always required on top. */
export const WRITE_PERM: Record<ImportObject, string> = { lead: "leads.write", contact: "contacts.write", account: "accounts.write" };
export const READ_PERM: Record<ImportObject, string> = { lead: "leads.read", contact: "contacts.read", account: "accounts.read" };
