"use server";
// Org-admin configuration writes. The tenant comes from the SERVER session (and is compared with the id the form
// sent, so a request aimed at another tenant is refused); permissions are checked on the actual change by
// lib/config/apply -> authorize(). Nothing here trusts the client's idea of its role.
import { revalidatePath } from "next/cache";
import { requireActive } from "@/lib/auth/server";
import { applyOverrides, applyPatch, historyFor, resetToPreset, type ApplyResult } from "@/lib/config/apply";
import type { Actor } from "@/lib/config/permissions";
import type { TenantConfig } from "@/lib/config/types";

export type ConfigActionResult = { ok: boolean; message: string; detail?: string };
async function actor(tenantId: string): Promise<{ a: Actor; ok: boolean }> {
  const { session, active } = await requireActive();
  const a: Actor = { kind: "org", uid: session.uid, name: session.name, role: active.role, tenantId: active.tenant.id, isPrimaryOwner: active.tenant.primaryOwnerId === session.uid, support: active.support ? { mode: active.support.mode } : null };
  return { a, ok: tenantId === active.tenant.id };
}
const out = (r: ApplyResult): ConfigActionResult => { if (r.ok) revalidatePath("/", "layout"); return r.ok ? { ok: true, message: r.message, detail: r.detail } : { ok: false, message: r.message }; };
const REFUSED: ConfigActionResult = { ok: false, message: "You can only change your own organisation's configuration." };

export async function saveConfig(tenantId: string, patch: unknown): Promise<ConfigActionResult> {
  const { a, ok } = await actor(tenantId);
  return ok ? out(await applyPatch(a, tenantId, patch)) : REFUSED;
}
export async function resetConfig(tenantId: string, sections: (keyof TenantConfig)[]): Promise<ConfigActionResult> {
  const { a, ok } = await actor(tenantId);
  if (!ok) return REFUSED;
  const allowed: (keyof TenantConfig)[] = ["vocabulary", "stages", "taxonomies", "modules", "dashboard", "branding", "data"];
  if (!Array.isArray(sections) || sections.some((s) => !allowed.includes(s))) return { ok: false, message: "Unknown section." };
  return out(await resetToPreset(a, tenantId, sections));
}
export async function rollbackConfig(tenantId: string, version: number): Promise<ConfigActionResult> {
  const { a, ok } = await actor(tenantId);
  if (!ok) return REFUSED;
  const h = (await historyFor(tenantId)).find((x) => x.version === version);
  if (!h) return { ok: false, message: "That version is no longer available." };
  return out(await applyOverrides(a, tenantId, h.overrides));
}
