"use server";
// Public unsubscribe confirmation. The signed token is the only credential; it is verified again here (never trusted from the page).
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { applyUnsubscribe } from "@/lib/connectors/email/unsubscribe-apply";
import { clientKey } from "@/lib/security/rate-limit";

export async function confirmUnsubscribe(token: string): Promise<void> {
  const t = String(token).slice(0, 1024);
  const { serviceEmailRuntime } = await import("@/lib/connectors/email/runtime");
  const rt = await serviceEmailRuntime();
  const ip = clientKey(await headers());
  if (!(await rt.deps.rate(`unsub-ip:${ip}`, 30, 60_000))) redirect(`/unsubscribe/${encodeURIComponent(t)}?e=1`);
  let out: Awaited<ReturnType<typeof applyUnsubscribe>>;
  try { out = await applyUnsubscribe(rt.deps.store, t, rt.deps.unsubscribeSecret, Date.now()); } catch { redirect(`/unsubscribe/${encodeURIComponent(t)}?e=1`); }
  redirect(out.status === "done" ? `/unsubscribe/${encodeURIComponent(t)}?done=1` : `/unsubscribe/${encodeURIComponent(t)}`);
}
