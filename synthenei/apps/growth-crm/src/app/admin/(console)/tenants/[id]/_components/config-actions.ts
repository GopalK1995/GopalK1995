"use server";
// Super-admin configuration writes. Every action re-checks requirePlatformAdmin(), requires a reason (audited),
// and goes through lib/config/apply so the same validation and section rules apply as for org admins.
// Platform admins never get business data here: config is not business data, so no support session is needed.
import { revalidatePath } from "next/cache";
import { AuthzError } from "@/lib/authz/engine";
import { assertPlatform } from "../../../../_lib/platform-session";
import { at } from "../../../../_lib/strings";
import { applyOverrides, applyPatch, historyFor, resetToPreset, type ApplyResult } from "@/lib/config/apply";
import type { Actor } from "@/lib/config/permissions";
import { presetConfig } from "@/lib/config/presets";
import { brandDefaults, resolveEffective } from "@/lib/config/resolve-pure";
import { getStored } from "@/lib/config/resolve";
import { PRESET_IDS, type PresetId, type TenantConfig } from "@/lib/config/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TENANTS } from "@/lib/tenancy";

export type ConfigActionResult = { ok: boolean; message: string; detail?: string };
type FormResult = { ok: boolean; message: string; sub?: string; field?: string };
const DENIED = { ok: false, message: at("denied") };
/** Config writes need platform.tenants.manage (super admin). null = denied by the authz engine. */
const actor = async (): Promise<{ a: Actor; demo: boolean } | null> => {
  try { const { session: me } = await assertPlatform("platform.tenants.manage"); return { a: { kind: "platform", uid: me.uid, name: me.name }, demo: me.demo }; } catch (e) { if (e instanceof AuthzError) return null; throw e; }
};
const out = (r: ApplyResult): ConfigActionResult => { if (r.ok) { revalidatePath("/admin", "layout"); revalidatePath("/", "layout"); } return r.ok ? { ok: true, message: r.message, detail: r.detail } : { ok: false, message: r.message }; };
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const SLUG = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/, EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEMPLATE_LABEL: Record<PresetId, string> = { legal: "Legal", hospitality: "Guesthouse", blank: "Blank" };

export async function adminSaveConfig(tenantId: string, patch: unknown, reason?: string): Promise<ConfigActionResult> {
  const g = await actor(); if (!g) return DENIED; const { a } = g; return out(await applyPatch(a, tenantId, patch, reason));
}
export async function adminResetConfig(tenantId: string, sections: (keyof TenantConfig)[], reason?: string): Promise<ConfigActionResult> {
  const g = await actor(); if (!g) return DENIED; const { a } = g;
  if (!Array.isArray(sections) || sections.some((x) => !["vocabulary", "stages", "taxonomies", "modules", "dashboard", "branding", "data", "features", "modulesLocked"].includes(x))) return { ok: false, message: "Unknown section." };
  return out(await resetToPreset(a, tenantId, sections, reason));
}
export async function adminRollbackConfig(tenantId: string, version: number, reason?: string): Promise<ConfigActionResult> {
  const g = await actor(); if (!g) return DENIED; const { a } = g;
  const h = (await historyFor(tenantId)).find((x) => x.version === version);
  return h ? out(await applyOverrides(a, tenantId, h.overrides, reason)) : { ok: false, message: "That version is no longer available." };
}

/** Change preset. Vocabulary, stages, taxonomies, modules, features and dashboard return to the new preset; branding, data and locks stay. */
export async function setPreset(f: FormData): Promise<FormResult> {
  const g = await actor(); if (!g) return DENIED; const { a } = g;
  const tenant = s(f, "tenant"), preset = s(f, "preset") as PresetId, reason = s(f, "reason");
  if (!PRESET_IDS.includes(preset)) return { ok: false, field: "preset", message: "Choose a preset." };
  if (s(f, "confirm") !== tenant) return { ok: false, field: "confirm", message: `Type ${tenant} exactly to confirm.` };
  if (reason.length < 8) return { ok: false, field: "reason", message: "Give a reason of at least 8 characters." };
  const r = await applyPatch(a, tenant, { preset }, reason);
  if (r.ok) { revalidatePath("/admin", "layout"); revalidatePath("/", "layout"); }
  return r.ok ? { ok: true, message: `Preset changed to ${TEMPLATE_LABEL[preset]} for ${tenant}`, sub: r.detail } : { ok: false, message: r.message };
}

/** Copy wording, stages, categories, modules, dashboard and targets from another tenant. Brand, sample-data switch and locks are never copied. */
export async function copyConfigFrom(f: FormData): Promise<FormResult> {
  const g = await actor(); if (!g) return DENIED; const { a } = g;
  const target = s(f, "tenant"), source = s(f, "source"), reason = s(f, "reason");
  if (!TENANTS.some((t) => t.id === source)) return { ok: false, field: "source", message: "Choose a tenant to copy from." };
  if (source === target) return { ok: false, field: "source", message: "Choose a different tenant." };
  if (reason.length < 8) return { ok: false, field: "reason", message: "Give a reason of at least 8 characters." };
  const src: TenantConfig = resolveEffective(source, (await getStored(source)).overrides);
  const patch = { preset: src.preset, vocabulary: src.vocabulary, stages: src.stages, taxonomies: src.taxonomies, modules: src.modules, features: src.features,
    dashboard: src.dashboard, data: { slaHours: src.data.slaHours, targetPerRepMonthly: src.data.targetPerRepMonthly, businessHours: src.data.businessHours } };
  const r = await applyPatch(a, target, patch, `Copied from ${source}: ${reason}`);
  if (r.ok) { revalidatePath("/admin", "layout"); revalidatePath("/", "layout"); }
  return r.ok ? { ok: true, message: `Copied configuration from ${source} to ${target}`, sub: r.detail } : { ok: false, message: r.message };
}

/** New tenant from a template (Legal, Guesthouse, Blank). Demo: validates and says what would happen; real: admin_create_tenant + admin_set_tenant_config. */
export async function createTenantFromTemplate(f: FormData): Promise<FormResult> {
  const g = await actor(); if (!g) return DENIED; const { a, demo } = g;
  const name = s(f, "name"), slug = s(f, "slug"), template = s(f, "template") as PresetId, hue = Number(s(f, "hue")), ws = s(f, "workspace"), owner = s(f, "owner"), reason = s(f, "reason");
  if (name.length < 2) return { ok: false, field: "name", message: "Enter the tenant's trading name." };
  if (!SLUG.test(slug)) return { ok: false, field: "slug", message: "Slug: 3-32 lowercase letters, digits or hyphens." };
  if (TENANTS.some((t) => t.id === slug)) return { ok: false, field: "slug", message: `Slug "${slug}" is already used.` };
  if (!PRESET_IDS.includes(template)) return { ok: false, field: "template", message: "Choose a template." };
  if (!(hue >= 0 && hue <= 359)) return { ok: false, field: "hue", message: "Hue must be 0-359." };
  if (ws.length < 2) return { ok: false, field: "workspace", message: "Name the first workspace." };
  if (!EMAIL.test(owner) || /@synthan\./i.test(owner)) return { ok: false, field: "owner", message: "Enter the client owner's own email address." };
  if (reason.length < 8) return { ok: false, field: "reason", message: "Give a reason of at least 8 characters." };
  const cfg = presetConfig(template, { id: slug, name, product: name, hue });
  const summary = `${TEMPLATE_LABEL[template]} template: ${Object.values(cfg.vocabulary.nav).join(", ")}; ${Object.values(cfg.stages.deal).length} deal stages; ${Object.values(cfg.modules).filter(Boolean).length} modules on`;
  if (demo) return { ok: true, message: `Would create tenant ${name} (${slug}) from the ${TEMPLATE_LABEL[template]} template and invite ${owner} as Owner.`, sub: `${summary}. Demo: nothing was saved or sent.` };
  const sb = await createSupabaseServerClient();
  if (!sb) return { ok: false, message: "Supabase is not configured on this deployment." };
  const created = await sb.rpc("admin_create_tenant", { p_name: name, p_slug: slug, p_branding: { brand_name: name, brand_primary: `oklch(0.52 0.15 ${hue})` }, p_owner_email: owner, p_workspace_name: ws });
  if (created.error) return { ok: false, message: `admin_create_tenant failed: ${created.error.message}` };
  const set = await sb.rpc("admin_set_tenant_config", { p_tenant: slug, p_config: { v: 1, preset: template }, p_reason: `Created from ${TEMPLATE_LABEL[template]} template: ${reason}` });
  void a;
  return set.error ? { ok: false, message: `Tenant created, but applying the template failed: ${set.error.message}` } : { ok: true, message: `Created ${name} from the ${TEMPLATE_LABEL[template]} template. Invitation sent to ${owner}.`, sub: summary };
}
