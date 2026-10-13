// Per-request page context: session + active workspace + workspace-scoped data source + role scoping.
// Reps see only their own records (spec 10); viewers get masked personal data.
import { requireActive } from "../auth/server";
import { getDataSource } from "./source";
import type { Conversation, Deal, Lead, Task } from "./types";

export async function pageCtx() {
  const { session, active } = await requireActive();
  const ds = getDataSource(active.ws, { demo: session.demo });
  const role = active.role;
  const own = role === "sales_rep";
  const scope = {
    leads: (xs: Lead[]) => (own ? xs.filter((l) => l.ownerId === session.uid) : xs),
    deals: (xs: Deal[]) => (own ? xs.filter((d) => d.ownerId === session.uid) : xs),
    tasks: (xs: Task[]) => (own ? xs.filter((t) => t.ownerId === session.uid) : xs),
    conversations: (xs: Conversation[], leads: Lead[]) => (own ? xs.filter((c) => leads.find((l) => l.id === c.leadId)?.ownerId === session.uid) : xs),
  };
  return { session, active, role, ds, now: ds.now(), scope, masked: role === "viewer", support: active.support };
}
/** Viewer role sees aggregates only: mask personal data (initials). */
export const maskName = (name: string) => name.split(" ").map((p) => p[0] + ".").join(" ");
export const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, "$1•••$2");
