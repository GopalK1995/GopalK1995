"use server";
// Deal stage moves (spec 5 /pipeline, 10.3 "Move deal stage", "Mark Won / Lost"). CONTRACTS C7 pattern:
// assertCan (record-level, rep scope = own), version-guarded write through the deals repository, triggers write
// stage history, events and audit. Demo sessions keep today's validation and "nothing was saved" results and
// never touch Supabase.
import { revalidatePath } from "next/cache";
import { pageCtx } from "@/lib/data/context";
import { can } from "@/lib/auth/roles";
import { assertCan } from "@/lib/authz/load";
import { DEAL_STAGES } from "@/lib/data/metrics";
import { vocabFor } from "@/lib/vertical";
import { inr } from "@/lib/format";
import type { DealStage } from "@/lib/data/types";
import { dealsRepo } from "@/lib/db/repo/deals";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { getLocale } from "@/i18n/server";
import { ownsOrManages } from "../leads/_lib/sales";
import { fill, pipelineLabels } from "./_lib/labels";
import { persistMove } from "./_lib/move";

export type WonInput = { plan: string; seats: number; value: number; start: string };
export type LostInput = { reason: string; competitor?: string };
export type MoveData = { version: number; stage: DealStage };

export async function moveDeal(dealId: string, to: DealStage, extra?: { won?: WonInput; lost?: LostInput }, expectedVersion?: number): Promise<ActionResult<MoveData>> {
  return runAction<MoveData>(async () => {
    const ctx = await pageCtx();
    const v = vocabFor(ctx.active.tenant), a = v.pl.a, PLANS = v.pl.plans, LOST_REASONS = v.lost.map(([key, label]) => ({ key, label }));
    const L = pipelineLabels(await getLocale(), { deal: v.n.deal.one, deals: v.n.deal.many });
    const demo = ctx.session.demo;

    // Same guards in both modes, so a real session cannot do what a demo session is refused.
    if (!DEAL_STAGES.includes(to)) return failResult("invalid", "Unknown stage.");
    if (demo && !can("moveDeals", { role: ctx.role, support: ctx.support })) {
      return failResult("denied", ctx.support ? "Not available in a support session." : a.roleCant(v.role[ctx.role]));
    }
    if (!demo) await assertCan("deals.move"); // list-level; the record-level check follows once the deal is loaded

    const deal = (await ctx.ds.deals()).find((d) => d.id === dealId);
    if (!deal) return failResult("not_found", a.notFound);
    if (demo && !ownsOrManages(ctx.role, ctx.session.uid, deal.ownerId)) return failResult("denied", a.ownOnly);
    if (deal.stage === to) return failResult("invalid", `Already in ${v.dealStage[to]}.`);

    let okMsg: string, okSub: string;
    if (to === "won") {
      const w = extra?.won;
      if (!w || !(PLANS as readonly string[]).includes(w.plan)) return failResult("invalid", a.wonNeedsPlan);
      if (!Number.isInteger(w.seats) || w.seats < 1 || w.seats > 500) return failResult("invalid", a.seatsMax);
      if (!Number.isFinite(w.value) || w.value <= 0) return failResult("invalid", a.needValue);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(w.start)) return failResult("invalid", "Won needs a start date.");
      okMsg = a.wonMsg(deal.name, inr(w.value), w.seats, w.plan);
      okSub = "Demo workspace: the forecast updates for this session only; nothing was saved.";
    } else if (to === "lost") {
      const reason = LOST_REASONS.find((r) => r.key === extra?.lost?.reason);
      if (!reason) return failResult("invalid", "Lost needs a reason.");
      const comp = extra?.lost?.competitor?.trim();
      okMsg = `${deal.name} marked Lost: ${reason.label}${comp ? ` (${comp.slice(0, 40)})` : ""}`;
      okSub = "The reason feeds win/loss analysis. Demo workspace: nothing was saved.";
    } else {
      okMsg = `${deal.name} moved to ${v.dealStage[to]}`;
      okSub = "Stage history and the audit log record the move. Demo workspace: nothing was saved.";
    }
    if (demo) return okResult(okMsg, { sub: okSub, data: { version: expectedVersion ?? 0, stage: to } });

    // Real session: record-level check (rep scope = own), then the version-guarded write.
    const p = await assertCan("deals.move", { type: "deal", id: deal.id, workspaceId: ctx.active.ws.id, ownerId: deal.ownerId });
    void p;
    if (typeof expectedVersion !== "number") return failResult("conflict", L.missingVersion);
    const saved = await persistMove(dealsRepo, { ws: ctx.active.ws.uuid, id: deal.id, to, expectedVersion, extra });
    revalidatePath("/pipeline");
    return okResult(okMsg, { sub: fill(L.savedSub), data: { version: saved.version, stage: to } });
  });
}
