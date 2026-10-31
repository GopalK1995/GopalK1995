"use server";
// Mark notifications read. Rows are the caller's own (RLS: user_id = auth.uid(), only read_at is grantable).
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { assertCan } from "@/lib/authz/load";
import { notifyRepos } from "@/lib/notify/repo";
import { collabCtx } from "@/lib/notify/session";
import { ct } from "@/lib/notify/strings";

export async function markRead(input: { ids: string[] }): Promise<ActionResult> {
  const p = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).safeParse(input);
  if (!p.success) return failResult("invalid", ct("error"));
  const c = await collabCtx();
  if (c.demo) return okResult(ct("markDone"), { sub: ct("demoNotice") });
  return runAction(async () => {
    await assertCan("workspace.access", undefined, c.wsKey);
    await notifyRepos.notifications.markRead(c.uid, p.data.ids);
    revalidatePath("/notifications");
    return okResult(ct("markDone"));
  });
}

export async function markAllRead(): Promise<ActionResult> {
  const c = await collabCtx();
  if (c.demo) return okResult(ct("markAllDone"), { sub: ct("demoNotice") });
  return runAction(async () => {
    await assertCan("workspace.access", undefined, c.wsKey);
    await notifyRepos.notifications.markAllRead(c.uid, c.ws);
    revalidatePath("/notifications");
    return okResult(ct("markAllDone"));
  });
}
