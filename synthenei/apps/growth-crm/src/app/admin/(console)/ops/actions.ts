"use server";
// Ops console write actions (platform admin only; every action re-checks the session). Demo sessions do nothing.
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth/server";
import { serviceDb } from "@/lib/db/service";
import { loadEnv } from "@/lib/env";
import { emitEvent } from "@/lib/events";
import { requeueFromDlq, supabaseQueuePort } from "@/lib/jobs/ports";
import { isQueueName } from "@/lib/jobs/queues";

function live(): boolean {
  const e = loadEnv();
  return !e.demoMode && e.supabaseConfigured && !!e.serviceRoleKey;
}

/** Moves one dead-lettered message (or all shown, up to 20) back to its queue with a fresh attempt count. */
export async function requeueDead(form: FormData): Promise<void> {
  const s = await requirePlatformAdmin();
  const queue = String(form.get("queue") ?? "");
  const id = form.get("msgId") ? Number(form.get("msgId")) : undefined;
  if (s.demo || !live() || !isQueueName(queue) || (id !== undefined && !Number.isInteger(id))) return;
  await requeueFromDlq(supabaseQueuePort(serviceDb()), queue, id);
  revalidatePath("/admin/ops");
}

/** Emits the synthetic ops.test event into the first workspace; it should show as processed on this page within a tick or two. */
export async function emitTestEvent(): Promise<void> {
  const s = await requirePlatformAdmin();
  if (s.demo || !live()) return;
  const db = serviceDb();
  const { data } = await db.from("workspaces").select("id").order("created_at", { ascending: true }).limit(1).maybeSingle();
  const ws = (data as { id: string } | null)?.id;
  if (!ws) return;
  await emitEvent({ type: "ops.test", workspaceId: ws, data: { source: "ops-console" } }, db);
  revalidatePath("/admin/ops");
}
