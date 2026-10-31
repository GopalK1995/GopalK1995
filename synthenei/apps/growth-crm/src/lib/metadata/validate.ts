// Field validation shared by the UI, server actions and the public API. checkValue/validateCustom mirror
// metadata.check_value() and metadata.validate_custom() in migration 0017 and use the SAME messages
// (custom field "key" must be a number). coerceValue is the extra step the DB does not do: it turns what a form
// or CSV delivers into what the DB accepts (E.164 phones, rupees, IST instants).
import { dmyToIso, isIsoDate, istInputToIso, normalizePhone, parseRupees } from "./format";
import type { Choice, FieldDef, Issue, ValidateMode } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;
const isNil = (v: unknown): v is null | undefined => v === null || v === undefined;
const len = (s: string) => [...s].length;

export const choicesOf = (def: Pick<FieldDef, "options">): Choice[] => (Array.isArray(def.options?.choices) ? def.options.choices : []);

/** Same rules as metadata.check_value. Returns the error suffix ("must be a number") or null. */
export function checkValue(def: Pick<FieldDef, "type" | "options" | "validation">, val: unknown): string | null {
  if (isNil(val)) return null;
  const v = def.validation ?? {};
  const max = typeof v.max === "number" ? v.max : null, min = typeof v.min === "number" ? v.min : null;
  switch (def.type) {
    case "text": case "long_text": case "phone": case "email": case "url": {
      if (typeof val !== "string") return "must be text";
      const cap = typeof v.maxLength === "number" ? v.maxLength : def.type === "long_text" ? 20000 : 2000;
      if (len(val) > cap) return "is too long";
      if (def.type === "email" && !EMAIL_RE.test(val)) return "must be an email address";
      if (def.type === "phone" && !PHONE_RE.test(val)) return "must be a phone number";
      if (def.type === "url" && !URL_RE.test(val)) return "must be an http(s) URL";
      const pattern = v.pattern ?? v.regex;
      if (pattern) {
        try { if (!new RegExp(pattern).test(val)) return "does not match the required pattern"; } catch { return "is not valid"; }
      }
      return null;
    }
    case "number": case "money": case "percent": {
      if (typeof val !== "number" || !Number.isFinite(val)) return "must be a number";
      if (def.type === "percent" && (val < 0 || val > 100)) return "must be between 0 and 100";
      if (def.type === "money" && val < 0) return "must not be negative";
      if (min !== null && val < min) return "is below the minimum";
      if (max !== null && val > max) return "is above the maximum";
      return null;
    }
    case "date":
      if (typeof val !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(val)) return "must be a date (YYYY-MM-DD)";
      return isIsoDate(val) ? null : "is not valid";
    case "datetime":
      if (typeof val !== "string") return "must be a date and time";
      return Number.isFinite(Date.parse(val)) ? null : "is not valid";
    case "boolean":
      return typeof val === "boolean" ? null : "must be true or false";
    case "select":
      if (typeof val !== "string") return "must be one of the listed choices";
      return choicesOf(def).some((c) => c.key === val) ? null : "is not one of the listed choices";
    case "multi_select": {
      if (!Array.isArray(val)) return "must be a list of choices";
      const keys = new Set(choicesOf(def).map((c) => c.key));
      return val.every((x) => typeof x === "string" && keys.has(x)) ? null : "contains a value that is not a listed choice";
    }
    case "user": case "lookup":
      return typeof val === "string" && UUID_RE.test(val) ? null : "must be a record id";
    case "rating": {
      if (typeof val !== "number" || !Number.isInteger(val)) return "must be a whole number";
      const top = typeof def.options?.max === "number" ? def.options.max : 5;
      return val < 1 || val > top ? "is outside the rating range" : null;
    }
  }
}

/** Form or CSV input to the stored shape. Empty input becomes null. Unparseable input is returned unchanged so checkValue reports it. */
export function coerceValue(def: Pick<FieldDef, "type">, raw: unknown): unknown {
  if (isNil(raw)) return null;
  if (typeof raw === "string" && raw.trim() === "" && def.type !== "boolean") return null;
  switch (def.type) {
    case "text": case "long_text": return typeof raw === "string" ? raw.trim() : raw;
    case "number": case "percent": case "rating": {
      if (typeof raw !== "string") return raw;
      const n = Number(raw.replace(/[,\s]/g, ""));
      return Number.isFinite(n) ? n : raw;
    }
    case "money": {
      const n = parseRupees(raw as string | number);
      return Number.isNaN(n) ? raw : n;
    }
    case "boolean":
      if (typeof raw === "string") {
        const s = raw.trim().toLowerCase();
        if (["true", "yes", "1", "on"].includes(s)) return true;
        if (["false", "no", "0", "off", ""].includes(s)) return false;
      }
      return raw;
    case "date": return typeof raw === "string" ? dmyToIso(raw) : raw;
    case "datetime": return typeof raw === "string" ? (istInputToIso(raw) ?? raw) : raw;
    case "phone": return typeof raw === "string" ? (normalizePhone(raw) ?? raw.trim()) : raw;
    case "email": return typeof raw === "string" ? raw.trim().toLowerCase() : raw;
    case "url": {
      if (typeof raw !== "string") return raw;
      const s = raw.trim();
      return /^[a-z][a-z0-9+.-]*:/i.test(s) || /\s/.test(s) || !/^[^./]+(\.[^./]+)+(\/.*)?$/.test(s) ? s : `https://${s}`;
    }
    case "multi_select":
      if (typeof raw === "string") return [...new Set(raw.split(",").map((x) => x.trim()).filter(Boolean))];
      return Array.isArray(raw) ? [...new Set(raw)] : raw;
    default: return raw;
  }
}

const msg = (key: string, suffix: string) => `custom field "${key}" ${suffix}`;

export interface ValidateOptions {
  /** Values currently stored on the record. Retired choices and retired fields are allowed only when unchanged from these. */
  existing?: Record<string, unknown>;
}

/**
 * Validates the COMPLETE custom document the record will have after the write (merge patches before calling).
 * create: defaults fill absent keys. Returns the cleaned document (coerced, nulls removed) and DB-identical issues.
 * Retired (archived) fields are rejected as unknown unless their stored value is unchanged: retire keeps the data.
 */
export function validateCustom(fields: FieldDef[], values: Record<string, unknown>, mode: ValidateMode, opts: ValidateOptions = {}): { value: Record<string, unknown>; issues: Issue[] } {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const issues: Issue[] = [];
  const out: Record<string, unknown> = {};
  const doc: Record<string, unknown> = { ...values };
  if (mode === "create") for (const f of fields) if (!f.archivedAt && !isNil(f.default) && !(f.key in doc)) doc[f.key] = f.default;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  for (const [key, raw] of Object.entries(doc)) {
    const def = byKey.get(key);
    if (!def) { issues.push({ path: key, message: `unknown custom field "${key}"` }); continue; }
    if (def.archivedAt) {
      // Retire = hidden + kept: an unchanged stored value is carried through; a new value is refused.
      if (opts.existing && key in opts.existing && same(opts.existing[key], raw)) out[key] = raw;
      else if (!isNil(raw)) issues.push({ path: key, message: `unknown custom field "${key}"` });
      continue;
    }
    const val = coerceValue(def, raw);
    const err = checkValue(def, val);
    if (err) { issues.push({ path: key, message: msg(key, err) }); continue; }
    // A retired choice stays valid for the value already stored, but cannot be newly picked.
    if ((def.type === "select" || def.type === "multi_select") && !isNil(val)) {
      const retired = new Set(choicesOf(def).filter((c) => c.archived).map((c) => c.key));
      const picked = (Array.isArray(val) ? val : [val]) as string[];
      const before = opts.existing?.[key];
      const prior = new Set(Array.isArray(before) ? before : isNil(before) ? [] : [before]);
      if (picked.some((k) => retired.has(k) && !prior.has(k))) {
        issues.push({ path: key, message: msg(key, def.type === "select" ? "is not one of the listed choices" : "contains a value that is not a listed choice") });
        continue;
      }
    }
    if (!isNil(val)) out[key] = val;
  }
  for (const f of fields) {
    if (f.archivedAt || !f.required) continue;
    if (isNil(out[f.key])) issues.push({ path: f.key, message: msg(f.key, "is required") });
  }
  return { value: out, issues };
}

/** Message shown to a person: the DB text with the field key swapped for its label. */
export function friendlyIssue(def: Pick<FieldDef, "key" | "label"> | undefined, issue: Issue, locale: "en" | "ta" = "en"): string {
  if (!def) return issue.message;
  const label = (locale === "ta" && def.label.ta) || def.label.en;
  return issue.message.replace(`custom field "${def.key}"`, label);
}
