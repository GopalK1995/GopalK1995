// Layout specs (BUILD-PLAN 2.5, T033). A layout is jsonb on public.layouts.spec; this module is the only place that knows its shape.
// Pure and client-safe. Specs are always re-normalised against the live field definitions, so a retired or renamed field
// can never break a page: unknown keys are dropped, and fields a layout does not mention are simply not shown by it.
import type { FieldDef } from "@/lib/metadata/types";

export type LayoutKind = "detail" | "list";
export const LAYOUT_KINDS: LayoutKind[] = ["detail", "list"];

export interface DetailSection { id: string; title: string; fields: string[] }
export interface DetailSpec { sections: DetailSection[]; showRelated: boolean; showComments: boolean }
/** Column ids: "title" (the primary field) or "custom.<key>". */
export interface ListSpec { columns: string[] }
export type LayoutSpec = DetailSpec | ListSpec;

export const TITLE_COLUMN = "title";
export const MAX_SECTIONS = 12;
export const MAX_COLUMNS = 12;
export const SECTION_TITLE_MAX = 60;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const live = (defs: FieldDef[]) => defs.filter((d) => !d.archivedAt);
const keyOfCol = (c: string) => (c.startsWith("custom.") ? c.slice(7) : null);
const byPos = (a: FieldDef, b: FieldDef) => a.position - b.position || a.key.localeCompare(b.key);

/** One section per `field_defs.section` (untitled first), in field order. The primary field is the title, so it is never placed. */
export function defaultDetailSpec(defs: FieldDef[], primaryKey?: string | null, untitled = "Details"): DetailSpec {
  const order: string[] = [];
  const map = new Map<string, string[]>();
  for (const d of live(defs).sort(byPos)) {
    if (d.key === primaryKey) continue;
    const s = d.section ?? "";
    if (!map.has(s)) { map.set(s, []); order.push(s); }
    map.get(s)!.push(d.key);
  }
  const sections = order.sort((a, b) => (a === "" ? -1 : b === "" ? 1 : 0)).map((s, i) => ({ id: `s${i + 1}`, title: s || untitled, fields: map.get(s)! }));
  return { sections, showRelated: true, showComments: true };
}

export function defaultListSpec(defs: FieldDef[], primaryKey?: string | null, max = 4): ListSpec {
  const cols = live(defs).filter((d) => d.key !== primaryKey && d.type !== "long_text").sort(byPos).slice(0, max).map((d) => `custom.${d.key}`);
  return { columns: [TITLE_COLUMN, ...cols] };
}

export function normalizeDetailSpec(raw: unknown, defs: FieldDef[], primaryKey?: string | null): DetailSpec {
  const ok = new Set(live(defs).map((d) => d.key));
  const o = isObj(raw) ? raw : {};
  const seen = new Set<string>();
  const sections: DetailSection[] = [];
  for (const s of Array.isArray(o.sections) ? o.sections.slice(0, MAX_SECTIONS) : []) {
    if (!isObj(s)) continue;
    const fields = (Array.isArray(s.fields) ? s.fields : []).filter((k): k is string => typeof k === "string" && ok.has(k) && k !== primaryKey && !seen.has(k));
    fields.forEach((k) => seen.add(k));
    const title = typeof s.title === "string" ? s.title.trim().slice(0, SECTION_TITLE_MAX) : "";
    sections.push({ id: typeof s.id === "string" && s.id ? s.id.slice(0, 20) : `s${sections.length + 1}`, title, fields });
  }
  return { sections, showRelated: o.showRelated !== false, showComments: o.showComments !== false };
}

export function normalizeListSpec(raw: unknown, defs: FieldDef[], primaryKey?: string | null): ListSpec {
  const ok = new Set(live(defs).map((d) => d.key));
  const o = isObj(raw) ? raw : {};
  const cols: string[] = [];
  for (const c of Array.isArray(o.columns) ? o.columns : []) {
    if (typeof c !== "string" || cols.includes(c)) continue;
    const k = keyOfCol(c);
    if (c === TITLE_COLUMN || (k && ok.has(k) && k !== primaryKey)) cols.push(c);
  }
  if (!cols.includes(TITLE_COLUMN)) cols.unshift(TITLE_COLUMN);
  return { columns: cols.slice(0, MAX_COLUMNS) };
}

export function normalizeSpec(kind: LayoutKind, raw: unknown, defs: FieldDef[], primaryKey?: string | null): LayoutSpec {
  return kind === "detail" ? normalizeDetailSpec(raw, defs, primaryKey) : normalizeListSpec(raw, defs, primaryKey);
}
export const defaultSpec = (kind: LayoutKind, defs: FieldDef[], primaryKey?: string | null, untitled?: string): LayoutSpec =>
  kind === "detail" ? defaultDetailSpec(defs, primaryKey, untitled) : defaultListSpec(defs, primaryKey);

export interface SpecIssue { path: string; message: string }
/** Strict validation for the editor's save (the normalisers above are lenient, for reading). */
export function validateSpec(kind: LayoutKind, raw: unknown, defs: FieldDef[], primaryKey?: string | null): SpecIssue[] {
  const ok = new Set(live(defs).map((d) => d.key));
  const issues: SpecIssue[] = [];
  if (!isObj(raw)) return [{ path: "spec", message: "Layout must be an object" }];
  if (kind === "detail") {
    const secs = Array.isArray(raw.sections) ? raw.sections : null;
    if (!secs) return [{ path: "sections", message: "Sections are required" }];
    if (secs.length > MAX_SECTIONS) issues.push({ path: "sections", message: `At most ${MAX_SECTIONS} sections` });
    const seen = new Set<string>();
    secs.forEach((s, i) => {
      if (!isObj(s) || !Array.isArray(s.fields)) { issues.push({ path: `sections.${i}`, message: "Invalid section" }); return; }
      if (typeof s.title !== "string" || !s.title.trim()) issues.push({ path: `sections.${i}.title`, message: "Every section needs a title" });
      else if (s.title.length > SECTION_TITLE_MAX) issues.push({ path: `sections.${i}.title`, message: `Title is longer than ${SECTION_TITLE_MAX} characters` });
      for (const k of s.fields) {
        if (typeof k !== "string" || !ok.has(k) || k === primaryKey) issues.push({ path: `sections.${i}.fields`, message: `Unknown field "${String(k)}"` });
        else if (seen.has(k)) issues.push({ path: `sections.${i}.fields`, message: `Field "${k}" is placed twice` });
        else seen.add(k);
      }
    });
  } else {
    const cols = Array.isArray(raw.columns) ? raw.columns : null;
    if (!cols) return [{ path: "columns", message: "Columns are required" }];
    if (cols.length > MAX_COLUMNS) issues.push({ path: "columns", message: `At most ${MAX_COLUMNS} columns` });
    if (!cols.includes(TITLE_COLUMN)) issues.push({ path: "columns", message: "The primary column cannot be removed" });
    for (const c of cols) {
      const k = typeof c === "string" ? keyOfCol(c) : null;
      if (c !== TITLE_COLUMN && (!k || !ok.has(k) || k === primaryKey)) issues.push({ path: "columns", message: `Unknown column "${String(c)}"` });
    }
    if (new Set(cols).size !== cols.length) issues.push({ path: "columns", message: "A column is listed twice" });
  }
  return issues;
}
