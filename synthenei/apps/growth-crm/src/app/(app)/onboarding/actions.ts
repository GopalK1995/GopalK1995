"use server";
// Onboarding wizard mutations. Each step either calls an existing, already-permission-checked action from the module
// it hands off to (saveConfig for template/branding/modules, inviteMember for team) or simply records progress --
// the pipelines/fields/integration/import steps point at their own full editors (settings/pipelines, settings/fields,
// integrations, import) and are "confirm you did it" steps here, never a second copy of those editors.
// Progress itself is a cookie (state-store.ts), not a database row: see that file for why.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActive } from "@/lib/auth/server";
import { assertCan } from "@/lib/authz/load";
import { AuthzError } from "@/lib/authz/engine";
import { saveConfig } from "../settings/_components/config-actions";
import { inviteMember } from "../settings/_components/actions";
import { contrastChecks } from "../settings/_components/contrast";
import { isStepId, stepDef } from "./_lib/steps";
import { finish, markStep, setKit } from "./_lib/progress";
import type { KitId, OnboardingState, StepId } from "./_lib/types";
import { loadOnboardingState, saveOnboardingState } from "./_lib/state-store";

export type ActionResult<T = undefined> = { ok: true; message: string; sub?: string; data?: T } | { ok: false; message: string; field?: string };
const ok = <T,>(message: string, extra?: { sub?: string; data?: T }): ActionResult<T> => ({ ok: true, message, ...extra });
const fail = (message: string, field?: string): ActionResult<never> => ({ ok: false, message, field });
const DEMO_NOTE = "Demo: shown as sample progress, nothing is saved.";

async function ctx() {
  const { session, active } = await requireActive();
  return { demo: session.demo === true, tenantId: active.tenant.id, wsUuid: active.ws.uuid };
}
/** The step's own permission gate, same key its target action re-checks -- this just gives a clean denial message
 *  before the wizard shows a step the signed-in member cannot actually complete. */
async function gateStep(id: StepId): Promise<ActionResult<never> | null> {
  try { await assertCan(stepDef(id).perm); return null; }
  catch (e) { if (e instanceof AuthzError) return fail("You don't have permission for this step."); throw e; }
}
const afterWrite = () => { revalidatePath("/onboarding"); revalidatePath("/settings"); };

const kitSchema = z.enum(["legal", "hospitality", "blank"]);
export async function chooseKit(kitRaw: unknown): Promise<ActionResult> {
  const v = kitSchema.safeParse(kitRaw);
  if (!v.success) return fail("Pick a starter kit.");
  const kit: KitId = v.data;
  const denied = await gateStep("template");
  if (denied) return denied;
  const c = await ctx();
  let s = await loadOnboardingState(c.tenantId);
  if (!c.demo) {
    const r = await saveConfig(c.tenantId, { preset: kit });
    if (!r.ok) return fail(r.message);
  }
  s = markStep(setKit(s, kit), "template", "done");
  await saveOnboardingState(c.tenantId, s);
  afterWrite();
  return ok(`${kit === "blank" ? "Blank" : kit === "legal" ? "Legal" : "Hospitality"} starter kit applied.`, { sub: c.demo ? DEMO_NOTE : undefined });
}

const brandingSchema = z.object({ name: z.string().trim().min(1).max(40), product: z.string().trim().min(1).max(40), hue: z.coerce.number().int().min(0).max(359), heading: z.string(), body: z.string() });
export async function saveBranding(raw: unknown): Promise<ActionResult> {
  const v = brandingSchema.safeParse(raw);
  if (!v.success) return fail("Check the branding fields.");
  // Recomputed here, never trusted from the client -- same gate settings/_components/actions.ts's saveBranding uses.
  if (contrastChecks(v.data.hue).some((check) => check.value < check.min)) return fail("Text contrast is below 4.5:1. Pick another hue.", "hue");
  const denied = await gateStep("branding");
  if (denied) return denied;
  const c = await ctx();
  if (!c.demo) {
    const r = await saveConfig(c.tenantId, { branding: { name: v.data.name, product: v.data.product, hue: v.data.hue, fonts: { heading: v.data.heading, body: v.data.body } } });
    if (!r.ok) return fail(r.message);
  }
  const s = markStep(await loadOnboardingState(c.tenantId), "branding", "done");
  await saveOnboardingState(c.tenantId, s);
  afterWrite();
  return ok("Branding saved.", { sub: c.demo ? DEMO_NOTE : undefined });
}

const modulesSchema = z.record(z.string(), z.boolean());
export async function saveModules(raw: unknown): Promise<ActionResult> {
  const v = modulesSchema.safeParse(raw);
  if (!v.success) return fail("Could not read the module selection.");
  const denied = await gateStep("modules");
  if (denied) return denied;
  const c = await ctx();
  if (!c.demo) {
    const r = await saveConfig(c.tenantId, { modules: v.data });
    if (!r.ok) return fail(r.message);
  }
  const s = markStep(await loadOnboardingState(c.tenantId), "modules", "done");
  await saveOnboardingState(c.tenantId, s);
  afterWrite();
  return ok("Modules saved.", { sub: c.demo ? DEMO_NOTE : undefined });
}

/** Pipelines, fields, integration and import all point at their own page; this just records that the step is done or skipped. */
export async function markStepAction(idRaw: unknown, status: "done" | "skipped"): Promise<ActionResult> {
  if (!isStepId(idRaw)) return fail("Unknown step.");
  const id = idRaw;
  const def = stepDef(id);
  if (status === "skipped" && !def.optional) return fail("This step can't be skipped.");
  const denied = status === "done" ? await gateStep(id) : null; // skipping needs no permission; marking done confirms you could act
  if (denied) return denied;
  const c = await ctx();
  const s = markStep(await loadOnboardingState(c.tenantId), id, status);
  await saveOnboardingState(c.tenantId, s);
  afterWrite();
  return ok(status === "done" ? "Marked done." : "Skipped.", { sub: c.demo ? DEMO_NOTE : undefined });
}

const teamSchema = z.object({ email: z.string().trim().email(), roleId: z.string().min(1) });
export async function inviteTeammate(raw: unknown): Promise<ActionResult> {
  const v = teamSchema.safeParse(raw);
  if (!v.success) return fail("Enter a valid email and pick a role.");
  const denied = await gateStep("team");
  if (denied) return denied;
  const c = await ctx();
  const r = await inviteMember({ email: v.data.email, roleId: v.data.roleId });
  if (!r.ok) return fail(r.message);
  const s = markStep(await loadOnboardingState(c.tenantId), "team", "done");
  await saveOnboardingState(c.tenantId, s);
  afterWrite();
  return ok(r.message, { sub: c.demo ? DEMO_NOTE : r.sub });
}

export async function finishOnboarding(): Promise<ActionResult> {
  const c = await ctx();
  const s = finish(await loadOnboardingState(c.tenantId));
  if (!s.completedAt) return fail("Finish every required step first.");
  await saveOnboardingState(c.tenantId, s);
  afterWrite();
  return ok("Setup complete.");
}

export async function getOnboardingState(): Promise<OnboardingState> {
  const c = await ctx();
  return loadOnboardingState(c.tenantId);
}
