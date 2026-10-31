"use server";
// Preferences (own rows) and notification rules (notifications.manage). Demo sessions validate and report, never write.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { assertCan } from "@/lib/authz/load";
import { notifyRepos } from "@/lib/notify/repo";
import { prefSchema, quietSchema, ruleSchema } from "@/lib/notify/schemas";
import { collabCtx } from "@/lib/notify/session";
import { ct } from "@/lib/notify/strings";

const bad = (e: z.ZodError): ActionResult<never> =>
  failResult("invalid", e.issues[0]?.message ?? ct("error"), { issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });

export async function savePref(input: z.input<typeof prefSchema>): Promise<ActionResult> {
  const p = prefSchema.safeParse(input);
  if (!p.success) return bad(p.error);
  const c = await collabCtx();
  if (c.demo) return okResult(ct("prefsSaved"), { sub: ct("prefsDemoNotice") });
  return runAction(async () => {
    await assertCan("workspace.access", undefined, c.wsKey);
    await notifyRepos.prefs.upsert(c.uid, c.ws, p.data.kind, p.data.channels, p.data.digest);
    revalidatePath("/settings/notifications");
    return okResult(ct("prefsSaved"));
  });
}

/** Quiet hours in IST. `clear: true` removes them. */
export async function saveQuiet(input: { from: string; to: string } | { clear: true }): Promise<ActionResult> {
  const clear = "clear" in input;
  const p = clear ? null : quietSchema.safeParse(input);
  if (p && !p.success) return bad(p.error);
  const c = await collabCtx();
  const done = ct(clear ? "quietCleared" : "quietSaved");
  if (c.demo) return okResult(done, { sub: ct("prefsDemoNotice") });
  return runAction(async () => {
    await assertCan("workspace.access", undefined, c.wsKey);
    const existing = await notifyRepos.prefs.list(c.uid, c.ws);
    const v = p?.success ? p.data : null;
    await notifyRepos.prefs.setQuiet(c.uid, c.ws, v ? `${v.from}-${v.to}` : null, existing);
    revalidatePath("/settings/notifications");
    return okResult(done);
  });
}

export async function saveRule(input: z.input<typeof ruleSchema>): Promise<ActionResult<{ id: string }>> {
  const p = ruleSchema.safeParse(input);
  if (!p.success) return bad(p.error);
  const c = await collabCtx();
  if (c.demo) return okResult(ct("ruleSaved"), { sub: ct("rulesDemoNotice"), data: { id: p.data.id ?? "demo-rule" } });
  return runAction(async () => {
    await assertCan("notifications.manage", undefined, c.wsKey);
    const { id, ...rest } = p.data;
    const row = id ? await notifyRepos.rules.update(c.ws, id, rest) : await notifyRepos.rules.create(c.ws, rest);
    revalidatePath("/settings/notifications");
    return okResult(ct("ruleSaved"), { data: { id: row.id } });
  });
}

export async function removeRule(input: { id: string }): Promise<ActionResult> {
  const p = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!p.success) return bad(p.error);
  const c = await collabCtx();
  if (c.demo) return okResult(ct("ruleRemoved"), { sub: ct("rulesDemoNotice") });
  return runAction(async () => {
    await assertCan("notifications.manage", undefined, c.wsKey);
    await notifyRepos.rules.remove(c.ws, p.data.id);
    revalidatePath("/settings/notifications");
    return okResult(ct("ruleRemoved"));
  });
}
