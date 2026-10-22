// Per-request page context: session + active workspace + workspace-scoped data source + role scoping.
// Reps see only their own records (spec 10); viewers get masked personal data.
import { requireActive } from "../auth/server";
import { getEffectiveConfig } from "../config/resolve";
import { stageList } from "../config/types";
import { getDataSource } from "./source";
import type { Conversation, Deal, Lead, Task } from "./types";

export async function pageCtx() {
  const { session, active } = await requireActive();
  const base = getDataSource(active.ws, { demo: session.demo });
  // Tenant config drives forecasts and stage order: deals carry the configured win probability (0-1), so the
  // pipeline board, funnel and weighted forecast all use the same numbers.
  const cfg = await getEffectiveConfig(active.tenant.id);
  const ds = Object.create(base, { deals: { value: async () => (await base.deals()).map((d) => ({ ...d, probability: (cfg.stages.deal[d.stage]?.probability ?? d.probability * 100) / 100 })) } }) as typeof base;
  const stageOrder = { lead: stageList(cfg.stages.lead), deal: stageList(cfg.stages.deal) };
  const role = active.role;
  const own = role === "sales_rep";
  const scope = {
    leads: (xs: Lead[]) => (own ? xs.filter((l) => l.ownerId === session.uid) : xs),
    deals: (xs: Deal[]) => (own ? xs.filter((d) => d.ownerId === session.uid) : xs),
    tasks: (xs: Task[]) => (own ? xs.filter((t) => t.ownerId === session.uid) : xs),
    conversations: (xs: Conversation[], leads: Lead[]) => (own ? xs.filter((c) => leads.find((l) => l.id === c.leadId)?.ownerId === session.uid) : xs),
  };
  return { session, active, role, ds, cfg, stageOrder, now: ds.now(), scope, masked: role === "viewer", support: active.support };
}
/** Viewer role sees aggregates only: mask personal data (initials). */
export const maskName = (name: string) => name.split(" ").map((p) => p[0] + ".").join(" ");
export const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, "$1•••$2");
