// The one write path for configuration. Server only. Every server action (org Settings, admin console) ends here:
//   candidate -> validate -> cross-field rules -> authorize(actor, tenant, before, after) -> sparse diff -> store.write
// so permissions are checked on the actual CHANGE, whatever the client sent.
import { TENANTS } from "../tenancy";
import { contrastChecks } from "../../app/(app)/settings/_components/contrast";
import { deepMerge, diffOverrides } from "./merge";
import type { Actor } from "./permissions";
import { authorize, SECTION_LABEL } from "./permissions";
import { presetConfig } from "./presets";
import { getStore, getStored } from "./resolve";
import { brandDefaults, resolveEffective } from "./resolve-pure";
import type { HistoryEntry } from "./store";
import { CONFIG_VERSION, validateEffective, validateOverrides, type ConfigOverrides, type Issue, type Section, type TenantConfig } from "./types";

export type ApplyResult = { ok: true; message: string; detail: string; version: number; sections: Section[] } | { ok: false; message: string; issues?: Issue[] };
const fail = (message: string, issues?: Issue[]): ApplyResult => ({ ok: false, message, issues });
const issueText = (i: Issue[]) => i.map((x) => x.message).slice(0, 3).join(" ");

/** Sections whose preset values are replaced when the preset changes; branding, data and locks are kept. */
const PRESET_OWNED = ["vocabulary", "stages", "taxonomies", "modules", "features", "dashboard"] as const;

/** Branding check, recomputed on the server (never trusted from the client): unsafe hues are refused. */
const checkHue = (before: TenantConfig, after: TenantConfig) =>
  before.branding.hue !== after.branding.hue && contrastChecks(after.branding.hue).some((c) => c.value < c.min) ? "Text contrast is below 4.5:1 for that hue. Pick another hue." : null;

async function commit(actor: Actor, tenantId: string, before: TenantConfig, after: TenantConfig, reason: string | undefined, expectedVersion: number): Promise<ApplyResult> {
  if (!TENANTS.some((t) => t.id === tenantId)) return fail("Unknown tenant.");
  const eff = validateEffective(after);
  if (eff.length) return fail(issueText(eff), eff);
  const brand = brandDefaults(tenantId);
  const hue = checkHue(before, after);
  if (hue) return fail(hue);
  const d = authorize(actor, tenantId, before, after, brand);
  if (!d.ok) return fail(d.message);
  if (!d.sections.length) return fail("Nothing changed.");
  if (actor.kind === "platform" && (reason ?? "").trim().length < 8) return fail("Give a reason of at least 8 characters. It is recorded in the audit log.");
  const sparse = (diffOverrides(presetConfig(after.preset, brand), after) ?? {}) as ConfigOverrides;
  // preset itself is stored only when it differs from the tenant's built-in vertical
  const ovr: ConfigOverrides = { ...sparse, v: CONFIG_VERSION };
  delete (ovr as { preset?: unknown }).preset;
  if (after.preset !== resolveEffective(tenantId, undefined).preset) ovr.preset = after.preset;
  const v = validateOverrides(ovr, { strict: true });
  if (v.issues.length) return fail(issueText(v.issues), v.issues);
  const store = await getStore();
  const r = await store.write(tenantId, v.value, { actor, reason: reason?.trim(), sections: d.sections, expectedVersion });
  if (!r.ok) return fail(r.message);
  const names = d.sections.map((s) => SECTION_LABEL[s]).join(", ");
  return { ok: true, message: `${names} saved`, detail: store.savedCopy, version: r.version, sections: d.sections };
}

async function current(tenantId: string) {
  const stored = await getStored(tenantId);
  return { stored, before: resolveEffective(tenantId, stored.overrides) };
}

/** Apply a patch of the FULL-shape config (sections replaced leaf-wise, lists replaced whole). */
export async function applyPatch(actor: Actor, tenantId: string, patch: unknown, reason?: string): Promise<ApplyResult> {
  const v = validateOverrides(patch, { strict: true });
  if (v.issues.length) return fail(issueText(v.issues), v.issues);
  const { stored, before } = await current(tenantId);
  let base = before;
  if (v.value.preset && v.value.preset !== before.preset) {
    const np = presetConfig(v.value.preset, brandDefaults(tenantId));
    base = { ...before, preset: np.preset };
    for (const k of PRESET_OWNED) (base as unknown as Record<string, unknown>)[k] = np[k];
  }
  const after = deepMerge(base, v.value);
  // Import mappings are open maps keyed by CSV header: a patch replaces the whole map (merge could never delete a key).
  const maps = v.value.data?.importMappings;
  if (maps) for (const k of Object.keys(maps) as (keyof typeof maps)[]) after.data.importMappings[k] = { ...(maps[k] as Record<string, string> | undefined) };
  return commit(actor, tenantId, before, after, reason, stored.version);
}
/** Put the named sections back to the preset's values. */
export async function resetToPreset(actor: Actor, tenantId: string, sections: (keyof TenantConfig)[], reason?: string): Promise<ApplyResult> {
  const { stored, before } = await current(tenantId);
  const p = presetConfig(before.preset, brandDefaults(tenantId));
  const after = { ...before } as unknown as Record<string, unknown>;
  for (const s of sections) if (s !== "v" && s !== "preset") after[s] = (p as unknown as Record<string, unknown>)[s];
  // The tile catalogue and module locks are platform decisions: a reset never removes them.
  if (sections.includes("dashboard")) after.dashboard = { ...p.dashboard, catalogueExtra: before.dashboard.catalogueExtra };
  if (sections.includes("modules")) after.modulesLocked = before.modulesLocked;
  return commit(actor, tenantId, before, after as unknown as TenantConfig, reason, stored.version);
}
/** Replace the tenant's whole override document (rollback, copy from tenant). Still authorized per changed section. */
export async function applyOverrides(actor: Actor, tenantId: string, overrides: unknown, reason?: string): Promise<ApplyResult> {
  const v = validateOverrides(overrides, { strict: false });
  const { stored, before } = await current(tenantId);
  const after = resolveEffective(tenantId, v.value);
  // Branding is tenant identity: copying another tenant's config never carries the brand name/product/hue.
  return commit(actor, tenantId, before, after, reason, stored.version);
}
export async function historyFor(tenantId: string): Promise<HistoryEntry[]> {
  try { return await (await getStore()).history(tenantId); } catch { return []; }
}
