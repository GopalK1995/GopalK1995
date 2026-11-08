// Column mapper: header -> target field suggestions, and row cleaning by target kind. Pure.
import type { CountryCode } from "libphonenumber-js/min";
import { DEFAULT_REGION, normaliseEmail, normalisePhone } from "./phone";
import type { ImportObject, Mapping, RowIssue, TargetField } from "./types";

const norm = (s: string) => s.toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Suggests a mapping. Priority per header: a saved mapping (still pointing at a known target), then an exact label/key match,
 * then an alias. A target is used once; later headers that would take the same target are left unmapped.
 */
export function autoMap(headers: string[], targets: TargetField[], saved: Mapping = {}): Mapping {
  const byKey = new Map(targets.map((t) => [t.key, t]));
  const used = new Set<string>();
  const out: Mapping = {};
  const take = (h: string, key: string) => { out[h] = key; used.add(key); };
  for (const h of headers) {
    const s = saved[h];
    if (s && byKey.has(s) && !used.has(s)) take(h, s);
  }
  for (const h of headers) {
    if (h in out) continue;
    const n = norm(h);
    const t = targets.find((x) => !used.has(x.key) && (norm(x.label) === n || norm(x.key.replace(/^custom\./, "")) === n))
      ?? targets.find((x) => !used.has(x.key) && x.aliases?.some((a) => norm(a) === n));
    if (t) take(h, t.key);
  }
  for (const h of headers) if (!(h in out)) out[h] = "";
  return out;
}

export interface MappingCheck { ok: boolean; missingRequired: string[]; duplicates: string[] }
/** A mapping is usable when every required target is mapped once; a target mapped twice is reported. */
export function checkMapping(mapping: Mapping, targets: TargetField[], object: ImportObject): MappingCheck {
  const count = new Map<string, number>();
  for (const k of Object.values(mapping)) if (k) count.set(k, (count.get(k) ?? 0) + 1);
  const missing = targets.filter((t) => t.required && !count.has(t.key)).map((t) => t.key);
  // a lead needs a way to reach it: email or phone
  if (object === "lead" && !count.has("email") && !count.has("phone")) missing.push("email|phone");
  const duplicates = [...count].filter(([, n]) => n > 1).map(([k]) => k);
  return { ok: missing.length === 0 && duplicates.length === 0, missingRequired: missing, duplicates };
}

const YES = new Set(["yes", "y", "true", "1", "t", "opted in", "opt in"]);
const NO = new Set(["no", "n", "false", "0", "f", "opted out", "opt out"]);

function parseDate(s: string): string | null {
  let y: number, mo: number, d: number;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; } // day first
  else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
}

export type Cleaned = { ok: true; value: unknown } | { ok: false; reason: RowIssue["reason"] };

/** Cleans one raw cell for a target. Blank cells are not an error here (callers skip them). */
export function cleanValue(raw: string, t: TargetField, region: CountryCode = DEFAULT_REGION): Cleaned {
  const s = raw.trim();
  switch (t.kind) {
    case "text": return s.length > 500 ? { ok: false, reason: "too_long" } : { ok: true, value: s };
    case "email": { const e = normaliseEmail(s); return e ? { ok: true, value: e } : { ok: false, reason: "email_invalid" }; }
    case "phone": { const p = normalisePhone(s, region); return p ? { ok: true, value: p } : { ok: false, reason: "phone_invalid" }; }
    case "number": {
      const n = Number(s.replace(/[,\s]/g, ""));
      return s !== "" && Number.isFinite(n) ? { ok: true, value: n } : { ok: false, reason: "number_invalid" };
    }
    case "boolean": { const l = s.toLowerCase(); return YES.has(l) ? { ok: true, value: true } : NO.has(l) ? { ok: true, value: false } : { ok: false, reason: "boolean_invalid" }; }
    case "date": { const d = parseDate(s); return d ? { ok: true, value: d } : { ok: false, reason: "date_invalid" }; }
    case "url": {
      const u = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
      try { const x = new URL(u); return /^https?:$/.test(x.protocol) && x.hostname.includes(".") ? { ok: true, value: x.toString() } : { ok: false, reason: "url_invalid" }; }
      catch { return { ok: false, reason: "url_invalid" }; }
    }
    case "select": {
      const hit = (t.choices ?? []).find((c) => c.toLowerCase() === s.toLowerCase());
      return hit ? { ok: true, value: hit } : { ok: false, reason: "choice_invalid" };
    }
  }
}

/** Maps and cleans one row. Returns system values, custom values and the issues found. */
export function mapRow(cells: Record<string, string>, mapping: Mapping, targets: TargetField[], region: CountryCode = DEFAULT_REGION) {
  const byKey = new Map(targets.map((t) => [t.key, t]));
  const record: Record<string, unknown> = {};
  const custom: Record<string, unknown> = {};
  const issues: RowIssue[] = [];
  for (const [header, key] of Object.entries(mapping)) {
    const t = key ? byKey.get(key) : undefined;
    if (!t) continue;
    const raw = cells[header] ?? "";
    if (raw.trim() === "") continue;
    const c = cleanValue(raw, t, region);
    if (!c.ok) { issues.push({ field: t.key, reason: c.reason, value: raw.slice(0, 80) }); continue; }
    if (t.key.startsWith("custom.")) custom[t.key.slice(7)] = c.value; else record[t.key] = c.value;
  }
  return { record, custom, issues };
}
