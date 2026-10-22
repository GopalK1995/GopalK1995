"use server";
// Deal stage moves (spec 5 /pipeline, 10.3 "Move deal stage", "Mark Won / Lost"). Re-checked on the server:
// support-aware can(), workspace membership of the deal, own-only for reps, and the Won/Lost data rules.
import { pageCtx } from "@/lib/data/context";
import { can, ROLE_LABEL } from "@/lib/auth/roles";
import { DEAL_STAGES } from "@/lib/data/metrics";
import { vocabFor } from "@/lib/vertical";
import { inr } from "@/lib/format";
import type { DealStage } from "@/lib/data/types";
import { ownsOrManages, type Result } from "../leads/_lib/sales";

export type WonInput = { plan: string; seats: number; value: number; start: string };
export type LostInput = { reason: string; competitor?: string };

export async function moveDeal(dealId: string, to: DealStage, extra?: { won?: WonInput; lost?: LostInput }): Promise<Result> {
  const ctx = await pageCtx();
  const v = vocabFor(ctx.active.tenant), a = v.pl.a, PLANS = v.pl.plans, LOST_REASONS = v.lost.map(([key, label]) => ({ key, label }));
  if (!can("moveDeals", { role: ctx.role, support: ctx.support })) {
    return { ok: false, message: ctx.support ? "Not available in a support session." : a.roleCant(v.role[ctx.role]) };
  }
  if (!DEAL_STAGES.includes(to)) return { ok: false, message: "Unknown stage." };
  const deal = (await ctx.ds.deals()).find((d) => d.id === dealId);
  if (!deal) return { ok: false, message: a.notFound };
  if (!ownsOrManages(ctx.role, ctx.session.uid, deal.ownerId)) return { ok: false, message: a.ownOnly };
  if (deal.stage === to) return { ok: false, message: `Already in ${v.dealStage[to]}.` };

  if (to === "won") {
    const w = extra?.won;
    if (!w || !(PLANS as readonly string[]).includes(w.plan)) return { ok: false, message: a.wonNeedsPlan };
    if (!Number.isInteger(w.seats) || w.seats < 1 || w.seats > 500) return { ok: false, message: a.seatsMax };
    if (!Number.isFinite(w.value) || w.value <= 0) return { ok: false, message: a.needValue };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(w.start)) return { ok: false, message: "Won needs a start date." };
    return { ok: true, message: a.wonMsg(deal.name, inr(w.value), w.seats, w.plan), sub: "Demo workspace: the forecast updates for this session only; nothing was saved." };
  }
  if (to === "lost") {
    const reason = LOST_REASONS.find((r) => r.key === extra?.lost?.reason);
    if (!reason) return { ok: false, message: "Lost needs a reason." };
    const comp = extra?.lost?.competitor?.trim();
    return { ok: true, message: `${deal.name} marked Lost: ${reason.label}${comp ? ` (${comp.slice(0, 40)})` : ""}`, sub: "The reason feeds win/loss analysis. Demo workspace: nothing was saved." };
  }
  return { ok: true, message: `${deal.name} moved to ${v.dealStage[to]}`, sub: "Stage history and the audit log record the move. Demo workspace: nothing was saved." };
}
