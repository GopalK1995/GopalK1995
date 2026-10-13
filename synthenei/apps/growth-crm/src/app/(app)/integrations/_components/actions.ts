"use server";
// Integration mutations. Every action re-checks the role and support session on the server (UI gating is a hint only).
// Demo: nothing is stored and no vendor is called; the result tells the UI what would have happened.
import { requireActive } from "@/lib/auth/server";
import { can } from "@/lib/auth/roles";

export type ActionResult = { ok: boolean; message: string; detail?: string };

export async function connectIntegration(id: string): Promise<ActionResult> {
  const { active } = await requireActive();
  if (active.support) return { ok: false, message: "Not available in a support session", detail: "Connecting integrations is on the support never-list." };
  if (!can("connectIntegrations", { role: active.role, support: active.support })) return { ok: false, message: "Only the workspace Owner can connect integrations." };
  return { ok: true, message: `Connect request noted for ${id}`, detail: "Showcase: no credentials stored, no vendor called. Going live needs the listed account access and a vault secret." };
}

export async function runSyncNow(id: string): Promise<ActionResult> {
  const { active } = await requireActive();
  if (active.support?.mode === "read_only") return { ok: false, message: "Read-only support session", detail: "Syncs cannot be started." };
  if (!(active.role === "owner" || active.role === "data")) return { ok: false, message: "Only Owner or Data can run a sync." };
  return { ok: true, message: `Sync for ${id} not started`, detail: "Showcase connector: there is nothing to sync until it is connected. CSV import is the live path." };
}
