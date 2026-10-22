// TenantConfig: one JSON document per tenant, stored as SPARSE overrides over a code preset.
// Everything here is JSON-safe, versioned (`v`) and validated by hand (no zod). Validators are allow-list based:
// unknown keys are errors on write (`strict`) and silently dropped on read, so a stale or tampered document can
// never put arbitrary content on a page. Pure module: importable from server, client and edge.
import type { DealStage, FirmSize, LeadStage } from "../data/types";

export const CONFIG_VERSION = 1 as const;
export type PresetId = "legal" | "hospitality" | "blank";
export const PRESET_IDS: PresetId[] = ["legal", "hospitality", "blank"];
export const LEAD_STAGE_IDS: LeadStage[] = ["new", "contacted", "qualified", "demo_booked", "demo_done", "proposal", "won", "lost"];
export const DEAL_STAGE_IDS: DealStage[] = ["discovery", "demo_scheduled", "demo_done", "proposal", "negotiation", "won", "lost"];
export const FIRM_SIZE_IDS: FirmSize[] = ["Solo", "2–5", "6–20", "21–50", "50+"];
export const CHANNEL_FAMILY_IDS = ["Paid social", "Search", "WhatsApp", "Email", "Referrals & events"] as const;
export const FUNNEL_IDS = ["visit", "cta", "form", "lead", "qualified", "demo", "demo_done", "won"] as const;
export const VIEW_IDS = ["mine", "unassigned", "today", "sla", "hot", "all"] as const;
export const MODULE_IDS = ["inbox", "ai", "integrations", "audience", "analytics", "tasks", "accounts", "campaigns", "data-health"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];
/** Features that exist for one vertical only: super admin toggles. */
export const VERTICAL_FEATURES = ["ecourts", "hearings"] as const;
export type VerticalFeature = (typeof VERTICAL_FEATURES)[number];
export const STAGE_COLORS = ["neutral", "accent", "info", "warn", "success", "danger"] as const;
export type StageColor = (typeof STAGE_COLORS)[number];
export type StageKind = "lead" | "deal";
export type Outcome = "open" | "won" | "lost";
export const IMPORT_KINDS = ["leads", "accounts", "campaigns"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export const FONT_KEYS = ["default", "geist", "system", "serif", "humanist", "mono"] as const;
export type FontKey = (typeof FONT_KEYS)[number];

/** Dashboard tile catalogue (metric ids). `base` tiles are open to every tenant; the rest need a super-admin grant. */
export const TILE_CATALOGUE: { id: string; label: string; base: boolean }[] = [
  { id: "won", label: "Won this month", base: true }, { id: "new", label: "New leads, 30 days", base: true },
  { id: "conv", label: "Lead to demo conversion", base: true }, { id: "cost", label: "Cost per demo", base: true },
  { id: "pipeline", label: "Open pipeline value", base: true }, { id: "winrate", label: "Win rate", base: true },
  { id: "sla", label: "First-response SLA met", base: false }, { id: "response", label: "Average first response time", base: false },
  { id: "repeat", label: "Repeat-guest share", base: false }, { id: "direct", label: "Direct-booking share", base: false },
  { id: "occupancy", label: "30-day forward occupancy", base: false }, { id: "adr", label: "Average daily rate", base: false },
];
export const CHART_CATALOGUE: { id: string; label: string }[] = [
  { id: "perDay", label: "Leads per day" }, { id: "mix", label: "Channel mix" }, { id: "funnel", label: "Funnel" },
  { id: "cpd", label: "Cost per demo by campaign" }, { id: "accounts", label: "Top accounts in pipeline" }, { id: "team", label: "Team vs target" },
];

export interface Noun { one: string; many: string }
export interface StageCfg { label: string; order: number; probability: number; color: StageColor; outcome: Outcome }
export interface BusinessHours { days: number[]; start: string; end: string }

/** The full (effective) document. */
export interface TenantConfig {
  v: typeof CONFIG_VERSION;
  preset: PresetId;
  vocabulary: {
    n: { lead: Noun; deal: Noun; demo: Noun; firm: Noun };
    nav: { leads: string; accounts: string; sell: string };
    search: string; funnel: Record<string, string>; views: Record<string, string>;
  };
  stages: { lead: Record<LeadStage, StageCfg>; deal: Record<DealStage, StageCfg> };
  taxonomies: {
    partySize: Record<FirmSize, string>; channelFamily: Record<string, string>;
    lost: [string, string][]; plans: string[]; interests: string[];
  };
  modules: Record<ModuleId, boolean>;
  modulesLocked: ModuleId[];
  features: Record<VerticalFeature, boolean>;
  branding: { name: string; product: string; hue: number; fonts: { heading: FontKey; body: FontKey } };
  dashboard: { kpiTiles: string[]; charts: string[]; catalogueExtra: string[] };
  data: {
    sampleData: boolean; slaHours: number; targetPerRepMonthly: number | null; businessHours: BusinessHours;
    importMappings: Record<ImportKind, Record<string, string>>;
  };
}
type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] };
/** What is stored: sparse overrides. `v` is optional on input and always written as 1. */
export type ConfigOverrides = DeepPartial<Omit<TenantConfig, "v">> & { v?: typeof CONFIG_VERSION };

/** Permission sections (see permissions.ts). */
export const SECTIONS = ["vocabulary", "stages", "taxonomies", "targets", "dashboard", "dataImport", "dataSample", "modules", "branding", "preset", "tileCatalogue", "verticalFeatures", "modulesLock"] as const;
export type Section = (typeof SECTIONS)[number];

// ---------------------------------------------------------------------------------------------- validation
export type Issue = { path: string; message: string };
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
// No markup, no control characters; URLs are not allow-listed anywhere in this document.
const BAD_TEXT = /[<>\u0000-\u001f\u007f]|https?:\/\/|javascript:/i;

class Ctx {
  issues: Issue[] = [];
  constructor(readonly strict: boolean) {}
  err(path: string, message: string) { this.issues.push({ path, message }); }
}
function str(c: Ctx, path: string, v: unknown, max: number, min = 1): string | undefined {
  if (typeof v !== "string") { c.err(path, "Must be text."); return undefined; }
  const s = v.trim().replace(/\s+/g, " ");
  if (s.length < min) { c.err(path, min === 1 ? "Cannot be empty." : `At least ${min} characters.`); return undefined; }
  if (s.length > max) { c.err(path, `At most ${max} characters.`); return undefined; }
  if (BAD_TEXT.test(s)) { c.err(path, "Text cannot contain markup, links or control characters."); return undefined; }
  return s;
}
function int(c: Ctx, path: string, v: unknown, lo: number, hi: number): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v) || Math.round(v) !== v || v < lo || v > hi) { c.err(path, `Whole number from ${lo} to ${hi}.`); return undefined; }
  return v;
}
function bool(c: Ctx, path: string, v: unknown): boolean | undefined {
  if (typeof v !== "boolean") { c.err(path, "Must be on or off."); return undefined; }
  return v;
}
function oneOf<T extends string>(c: Ctx, path: string, v: unknown, list: readonly T[]): T | undefined {
  if (typeof v !== "string" || !list.includes(v as T)) { c.err(path, `Must be one of: ${list.join(", ")}.`); return undefined; }
  return v as T;
}
/** Walk an object accepting only `allowed` keys. */
function obj(c: Ctx, path: string, v: unknown, allowed: readonly string[], each: (k: string, val: unknown) => void) {
  if (!isObj(v)) { c.err(path, "Must be an object."); return; }
  for (const k of Object.keys(v)) {
    if (FORBIDDEN_KEYS.has(k) || !allowed.includes(k)) { if (c.strict) c.err(`${path}.${k}`, "Unknown setting."); continue; }
    each(k, v[k]);
  }
}
const set = <T extends object>(o: T, k: string, v: unknown) => { if (v !== undefined) (o as Record<string, unknown>)[k] = v; };
function noun(c: Ctx, path: string, v: unknown): Noun | undefined {
  const o: Partial<Noun> = {};
  obj(c, path, v, ["one", "many"], (k, x) => set(o, k, str(c, `${path}.${k}`, x, 32)));
  if (!o.one || !o.many) { if (!c.issues.some((i) => i.path.startsWith(path))) c.err(path, "Needs a singular and a plural."); return undefined; }
  return { one: o.one, many: o.many };
}
function labelMap(c: Ctx, path: string, v: unknown, ids: readonly string[], max = 40) {
  const o: Record<string, string> = {};
  obj(c, path, v, ids, (k, x) => set(o, k, str(c, `${path}.${k}`, x, max)));
  return o;
}
function strList(c: Ctx, path: string, v: unknown, maxItems: number, maxLen: number): string[] | undefined {
  if (!Array.isArray(v)) { c.err(path, "Must be a list."); return undefined; }
  if (v.length > maxItems) { c.err(path, `At most ${maxItems} items.`); return undefined; }
  const out = v.map((x, i) => str(c, `${path}[${i}]`, x, maxLen)).filter((x): x is string => x !== undefined);
  const dup = out.find((x, i) => out.findIndex((y) => y.toLowerCase() === x.toLowerCase()) !== i);
  if (dup) c.err(path, `"${dup}" appears twice.`);
  return out.length === v.length ? out : undefined;
}
function stageOverrides(c: Ctx, path: string, v: unknown, ids: readonly string[]) {
  const out: Record<string, Partial<StageCfg>> = {};
  obj(c, path, v, ids, (id, sv) => {
    const s: Partial<StageCfg> = {};
    obj(c, `${path}.${id}`, sv, ["label", "order", "probability", "color", "outcome"], (k, x) => {
      const p = `${path}.${id}.${k}`;
      if (k === "label") set(s, k, str(c, p, x, 32));
      else if (k === "order") set(s, k, int(c, p, x, 0, 50));
      else if (k === "probability") set(s, k, int(c, p, x, 0, 100));
      else if (k === "color") set(s, k, oneOf(c, p, x, STAGE_COLORS));
      else set(s, k, oneOf(c, p, x, ["open", "won", "lost"] as const));
    });
    out[id] = s;
  });
  return out;
}
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Validate sparse overrides. Returns the cleaned value (only allowed, valid keys) and every issue found. */
export function validateOverrides(raw: unknown, opts: { strict?: boolean } = {}): { value: ConfigOverrides; issues: Issue[] } {
  const c = new Ctx(opts.strict ?? true);
  const out: Record<string, unknown> = {};
  if (raw === undefined || raw === null) return { value: { v: CONFIG_VERSION }, issues: [] };
  const top = ["v", "preset", "vocabulary", "stages", "taxonomies", "modules", "modulesLocked", "features", "branding", "dashboard", "data"];
  obj(c, "config", raw, top, (k, x) => {
    switch (k) {
      case "v": if (x !== CONFIG_VERSION) c.err("config.v", `Unsupported config version (expected ${CONFIG_VERSION}).`); break;
      case "preset": set(out, k, oneOf(c, "preset", x, PRESET_IDS)); break;
      case "vocabulary": {
        const o: Record<string, unknown> = {};
        obj(c, "vocabulary", x, ["n", "nav", "search", "funnel", "views"], (kk, xx) => {
          if (kk === "n") { const n: Record<string, Noun> = {}; obj(c, "vocabulary.n", xx, ["lead", "deal", "demo", "firm"], (nk, nv) => { const r = noun(c, `vocabulary.n.${nk}`, nv); if (r) n[nk] = r; }); o.n = n; }
          else if (kk === "nav") o.nav = labelMap(c, "vocabulary.nav", xx, ["leads", "accounts", "sell"], 32);
          else if (kk === "search") set(o, kk, str(c, "vocabulary.search", xx, 80));
          else if (kk === "funnel") o.funnel = labelMap(c, "vocabulary.funnel", xx, FUNNEL_IDS, 40);
          else o.views = labelMap(c, "vocabulary.views", xx, VIEW_IDS, 32);
        });
        out.vocabulary = o; break;
      }
      case "stages": {
        const o: Record<string, unknown> = {};
        obj(c, "stages", x, ["lead", "deal"], (kk, xx) => { o[kk] = stageOverrides(c, `stages.${kk}`, xx, kk === "lead" ? LEAD_STAGE_IDS : DEAL_STAGE_IDS); });
        out.stages = o; break;
      }
      case "taxonomies": {
        const o: Record<string, unknown> = {};
        obj(c, "taxonomies", x, ["partySize", "channelFamily", "lost", "plans", "interests"], (kk, xx) => {
          if (kk === "partySize") o.partySize = labelMap(c, "taxonomies.partySize", xx, FIRM_SIZE_IDS, 32);
          else if (kk === "channelFamily") o.channelFamily = labelMap(c, "taxonomies.channelFamily", xx, CHANNEL_FAMILY_IDS, 32);
          else if (kk === "plans") set(o, kk, strList(c, "taxonomies.plans", xx, 20, 40));
          else if (kk === "interests") set(o, kk, strList(c, "taxonomies.interests", xx, 20, 40));
          else {
            if (!Array.isArray(xx) || xx.length < 1 || xx.length > 12) { c.err("taxonomies.lost", "Between 1 and 12 reasons."); return; }
            const rows: [string, string][] = [];
            xx.forEach((r, i) => {
              if (!Array.isArray(r) || r.length !== 2) { c.err(`taxonomies.lost[${i}]`, "Each reason is [id, label]."); return; }
              const id = typeof r[0] === "string" && /^[a-z][a-z0-9_]{1,31}$/.test(r[0]) ? r[0] : (c.err(`taxonomies.lost[${i}]`, "Reason id: lowercase letters, digits, underscore."), undefined);
              const label = str(c, `taxonomies.lost[${i}]`, r[1], 40);
              if (id && label) rows.push([id, label]);
            });
            if (new Set(rows.map((r) => r[0])).size !== rows.length) c.err("taxonomies.lost", "Reason ids must be unique.");
            o.lost = rows;
          }
        });
        out.taxonomies = o; break;
      }
      case "modules": {
        const o: Record<string, boolean> = {};
        obj(c, "modules", x, MODULE_IDS, (kk, xx) => set(o, kk, bool(c, `modules.${kk}`, xx)));
        out.modules = o; break;
      }
      case "modulesLocked": {
        if (!Array.isArray(x) || x.length > MODULE_IDS.length) { c.err("modulesLocked", "Must be a list of modules."); break; }
        out.modulesLocked = [...new Set(x.map((m, i) => oneOf(c, `modulesLocked[${i}]`, m, MODULE_IDS)).filter((m): m is ModuleId => !!m))]; break;
      }
      case "features": {
        const o: Record<string, boolean> = {};
        obj(c, "features", x, VERTICAL_FEATURES, (kk, xx) => set(o, kk, bool(c, `features.${kk}`, xx)));
        out.features = o; break;
      }
      case "branding": {
        const o: Record<string, unknown> = {};
        obj(c, "branding", x, ["name", "product", "hue", "fonts"], (kk, xx) => {
          if (kk === "name" || kk === "product") set(o, kk, str(c, `branding.${kk}`, xx, 40));
          else if (kk === "hue") set(o, kk, int(c, "branding.hue", xx, 0, 359));
          else { const f: Record<string, unknown> = {}; obj(c, "branding.fonts", xx, ["heading", "body"], (fk, fv) => set(f, fk, oneOf(c, `branding.fonts.${fk}`, fv, FONT_KEYS))); o.fonts = f; }
        });
        out.branding = o; break;
      }
      case "dashboard": {
        const o: Record<string, unknown> = {};
        const ids = TILE_CATALOGUE.map((t) => t.id), charts = CHART_CATALOGUE.map((t) => t.id);
        obj(c, "dashboard", x, ["kpiTiles", "charts", "catalogueExtra"], (kk, xx) => {
          const list = kk === "charts" ? charts : ids;
          if (!Array.isArray(xx) || xx.length > 12) { c.err(`dashboard.${kk}`, "Must be a short list."); return; }
          const cleaned = xx.map((t, i) => oneOf(c, `dashboard.${kk}[${i}]`, t, list)).filter((t): t is string => !!t);
          if (new Set(cleaned).size !== cleaned.length) c.err(`dashboard.${kk}`, "No repeats.");
          if (kk === "kpiTiles" && cleaned.length !== 4) c.err("dashboard.kpiTiles", "Pick exactly 4 headline tiles.");
          o[kk] = cleaned;
        });
        out.dashboard = o; break;
      }
      case "data": {
        const o: Record<string, unknown> = {};
        obj(c, "data", x, ["sampleData", "slaHours", "targetPerRepMonthly", "businessHours", "importMappings"], (kk, xx) => {
          if (kk === "sampleData") set(o, kk, bool(c, "data.sampleData", xx));
          else if (kk === "slaHours") set(o, kk, int(c, "data.slaHours", xx, 1, 72));
          else if (kk === "targetPerRepMonthly") { if (xx === null) o[kk] = null; else set(o, kk, int(c, "data.targetPerRepMonthly", xx, 0, 1e9)); }
          else if (kk === "businessHours") {
            const b: Record<string, unknown> = {};
            obj(c, "data.businessHours", xx, ["days", "start", "end"], (bk, bv) => {
              if (bk === "days") {
                if (!Array.isArray(bv) || bv.length < 1 || bv.length > 7 || bv.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) c.err("data.businessHours.days", "Days 0 (Sunday) to 6, at least one."); else b.days = [...new Set(bv as number[])].sort();
              } else if (typeof bv !== "string" || !HHMM.test(bv)) c.err(`data.businessHours.${bk}`, "Time as HH:MM."); else b[bk] = bv;
            });
            if (typeof b.start === "string" && typeof b.end === "string" && b.start >= b.end) c.err("data.businessHours", "Closing time must be after opening time.");
            o.businessHours = b;
          } else {
            const m: Record<string, Record<string, string>> = {};
            obj(c, "data.importMappings", xx, IMPORT_KINDS, (ik, iv) => {
              if (!isObj(iv) || Object.keys(iv).length > 30) { c.err(`data.importMappings.${ik}`, "At most 30 column mappings."); return; }
              const mm: Record<string, string> = {};
              for (const h of Object.keys(iv)) { if (FORBIDDEN_KEYS.has(h)) continue; const hh = str(c, `data.importMappings.${ik}`, h, 60), vv = str(c, `data.importMappings.${ik}.${h}`, iv[h], 60); if (hh && vv) mm[hh] = vv; }
              m[ik] = mm;
            });
            o.importMappings = m;
          }
        });
        out.data = o; break;
      }
    }
  });
  out.v = CONFIG_VERSION;
  return { value: out as ConfigOverrides, issues: c.issues };
}

/** Cross-field rules on the FULL effective config (after merge). */
export function validateEffective(cfg: TenantConfig): Issue[] {
  const issues: Issue[] = [];
  for (const kind of ["lead", "deal"] as const) {
    const st = cfg.stages[kind] as Record<string, StageCfg>;
    const ids = Object.keys(st);
    if (!ids.some((i) => st[i].outcome === "won")) issues.push({ path: `stages.${kind}`, message: "At least one stage must count as won." });
    if (!ids.some((i) => st[i].outcome === "lost")) issues.push({ path: `stages.${kind}`, message: "At least one stage must count as lost." });
    if (st.won.outcome !== "won") issues.push({ path: `stages.${kind}.won.outcome`, message: "The Won stage always counts as won." });
    if (st.lost.outcome !== "lost") issues.push({ path: `stages.${kind}.lost.outcome`, message: "The Lost stage always counts as lost." });
    for (const i of ids) if (st[i].outcome === "won" && st[i].probability !== 100) issues.push({ path: `stages.${kind}.${i}.probability`, message: "A won stage is 100%." });
    for (const i of ids) if (st[i].outcome === "lost" && st[i].probability !== 0) issues.push({ path: `stages.${kind}.${i}.probability`, message: "A lost stage is 0%." });
    const labels = ids.map((i) => st[i].label.toLowerCase());
    if (new Set(labels).size !== labels.length) issues.push({ path: `stages.${kind}`, message: "Stage names must be different from each other." });
  }
  const t = cfg.dashboard.kpiTiles;
  const allowed = new Set([...TILE_CATALOGUE.filter((x) => x.base).map((x) => x.id), ...cfg.dashboard.catalogueExtra]);
  for (const id of t) if (!allowed.has(id)) issues.push({ path: "dashboard.kpiTiles", message: `Tile "${id}" is not in this tenant's catalogue.` });
  if (t.length !== 4) issues.push({ path: "dashboard.kpiTiles", message: "Pick exactly 4 headline tiles." });
  return issues;
}

export const stageList = <K extends string>(st: Record<K, StageCfg>) => (Object.keys(st) as K[]).sort((a, b) => st[a].order - st[b].order);
