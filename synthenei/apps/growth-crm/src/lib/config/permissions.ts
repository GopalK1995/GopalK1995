// Who may change which section of a tenant's config (addendum B). Pure and server-checkable: every write action
// calls authorize() with the config before and after, so the check is on the CHANGE, not on what the UI offered.
//   Org admin = Owner of the tenant. Branding additionally needs the tenant's primary owner.
//   Platform admin (super admin) = any section of any tenant, always with a reason, always audited.
//   Support sessions: all org-side config writes are refused (the operator uses the admin console instead,
//   where the change carries a reason). Config is not business data, so no support session is needed there.
import type { Role } from "../data/types";
import { can } from "../auth/roles";
import { presetConfig, type BrandDefaults } from "./presets";
import { MODULE_IDS, SECTIONS, type Section, type TenantConfig } from "./types";

export type Actor =
  | { kind: "platform"; uid: string; name: string }
  | { kind: "org"; uid: string; name: string; role: Role; tenantId: string; isPrimaryOwner: boolean; support: { mode: "read_only" | "read_write" } | null };

/** Sections an org admin may edit (modules, dataSample and branding have extra rules below). */
export const ORG_SECTIONS: Section[] = ["vocabulary", "stages", "taxonomies", "targets", "dashboard", "dataImport", "dataSample", "modules", "branding"];
export const PLATFORM_ONLY: Section[] = ["preset", "tileCatalogue", "verticalFeatures", "modulesLock"];
export const SECTION_LABEL: Record<Section, string> = {
  vocabulary: "Wording", stages: "Stages", taxonomies: "Categories", targets: "Targets, SLA and hours", dashboard: "Dashboard tiles",
  dataImport: "Import mappings", dataSample: "Sample data", modules: "Modules", branding: "Branding and fonts",
  preset: "Preset", tileCatalogue: "Tile catalogue", verticalFeatures: "Vertical-only features", modulesLock: "Module locks",
};
/** Permission matrix as data (also rendered in the admin UI and asserted in tests). */
export const MATRIX: Record<Section, { org: "edit" | "edit-owner-primary" | "limited" | "no"; platform: "edit" }> = {
  vocabulary: { org: "edit", platform: "edit" }, stages: { org: "edit", platform: "edit" }, taxonomies: { org: "edit", platform: "edit" },
  targets: { org: "edit", platform: "edit" }, dashboard: { org: "edit", platform: "edit" }, dataImport: { org: "edit", platform: "edit" },
  dataSample: { org: "limited", platform: "edit" }, modules: { org: "limited", platform: "edit" }, branding: { org: "edit-owner-primary", platform: "edit" },
  preset: { org: "no", platform: "edit" }, tileCatalogue: { org: "no", platform: "edit" }, verticalFeatures: { org: "no", platform: "edit" }, modulesLock: { org: "no", platform: "edit" },
};

const j = (x: unknown) => JSON.stringify(x);
/** Which sections differ between two full configs. */
export function changedSections(a: TenantConfig, b: TenantConfig): Section[] {
  const out: Section[] = [];
  const d = (s: Section, x: unknown, y: unknown) => { if (j(x) !== j(y)) out.push(s); };
  d("preset", a.preset, b.preset); d("vocabulary", a.vocabulary, b.vocabulary); d("stages", a.stages, b.stages); d("taxonomies", a.taxonomies, b.taxonomies);
  d("modules", a.modules, b.modules); d("modulesLock", a.modulesLocked, b.modulesLocked); d("verticalFeatures", a.features, b.features); d("branding", a.branding, b.branding);
  d("dashboard", [a.dashboard.kpiTiles, a.dashboard.charts], [b.dashboard.kpiTiles, b.dashboard.charts]); d("tileCatalogue", a.dashboard.catalogueExtra, b.dashboard.catalogueExtra);
  d("targets", [a.data.slaHours, a.data.targetPerRepMonthly, a.data.businessHours], [b.data.slaHours, b.data.targetPerRepMonthly, b.data.businessHours]);
  d("dataImport", a.data.importMappings, b.data.importMappings); d("dataSample", a.data.sampleData, b.data.sampleData);
  return SECTIONS.filter((s) => out.includes(s));
}

export type Decision = { ok: true; sections: Section[] } | { ok: false; section?: Section; message: string };
const deny = (message: string, section?: Section): Decision => ({ ok: false, message, section });

/**
 * Authorize changing tenant `target` from `before` to `after`. `brand` is only used to rebuild the preset
 * defaults for the module "switch back on" rule.
 */
export function authorize(actor: Actor, target: string, before: TenantConfig, after: TenantConfig, brand: BrandDefaults): Decision {
  const sections = changedSections(before, after);
  if (actor.kind === "platform") return { ok: true, sections };
  if (actor.tenantId !== target) return deny("You can only change your own organisation's configuration.");
  if (actor.support) return deny("Configuration cannot be changed in a support session. The platform operator uses the admin console, with a recorded reason.");
  if (actor.role !== "owner") return deny("Only the Owner can change configuration.");
  for (const s of sections) {
    if (PLATFORM_ONLY.includes(s)) return deny(`${SECTION_LABEL[s]} can only be changed by the platform operator.`, s);
    if (s === "branding" && !(can("branding", { role: actor.role, support: actor.support }) && actor.isPrimaryOwner)) return deny("Only the primary owner can change branding and fonts.", s);
    if (s === "dataSample" && after.data.sampleData) return deny("Sample data can be switched off here; switching it back on is done by the platform operator.", s);
    if (s === "modules") {
      for (const m of MODULE_IDS) {
        if (before.modules[m] === after.modules[m]) continue;
        if (before.modulesLocked.includes(m)) return deny(`The ${m} module is locked by the platform operator.`, s);
        if (after.modules[m] && !presetConfig(before.preset, brand).modules[m]) return deny(`The ${m} module is not part of this tenant's plan; ask the platform operator to enable it.`, s);
      }
    }
  }
  return { ok: true, sections };
}
