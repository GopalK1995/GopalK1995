"use client";
// Pipeline kanban (spec 5 /pipeline, 11.1). Pointer-event drag between columns on desktop, a keyboard and touch
// "Move to" menu on every card, and one column at a time on mobile (stage pills + horizontal swipe).
// Won asks for plan, seats, value and start date; Lost asks for a reason. The server action re-checks everything.
import Link from "next/link";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useMemo, useRef, useState, useTransition, type PointerEvent as RPE } from "react";
import { ArrowRightLeft, CalendarClock, ChevronLeft, ChevronRight, Hourglass } from "lucide-react";
import type { DealStage } from "@/lib/data/types";
import { DEAL_STAGES } from "@/lib/data/metrics";
import { useSession, useVocab } from "@/components/shell/providers";
import { fmtDate, inr, inrCompact, pct } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/ui/dropdown";
import { Segmented } from "@/components/ui/tabs";
import { Empty, th, thNum, td, tdNum } from "@/components/ui/misc";
import { DealStageBadge } from "@/components/ui/domain";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { moveDeal } from "../actions";
import { field } from "../../leads/_lib/sales";

export type DealCard = {
  id: string; name: string; firm: string; contact: string | null; leadId: string; value: number; seats: number; plan: string; stayLine?: string;
  owner: string; days: number; next: string | null; nextOverdue: boolean; stage: DealStage; close: string; prob: number; lostReason?: string;
};
const MAX_DAYS = 14; // pipeline_stages.max_days default (spec 6.3 M41)
const EASE = [0.22, 1, 0.36, 1] as const;

function AgeBadge({ days }: { days: number }) {
  const tone = days > MAX_DAYS ? "danger" : days > 10 ? "warn" : "neutral";
  return <Badge tone={tone} title={`${days} days in this stage${days > MAX_DAYS ? `, over the ${MAX_DAYS}-day limit` : ""}`}><Hourglass aria-hidden />{days}d</Badge>;
}

export function Board({ deals, canMove, masked, today }: { deals: DealCard[]; canMove: boolean; masked: boolean; today: string }) {
  const vv = useVocab(), pl = vv.pl, DEAL_STAGE_LABEL = vv.dealStage, PLANS = pl.plans, LOST_REASONS = vv.lost.map(([key, label]) => ({ key, label })), tenantName = useSession().tenant.name;
  const [items, setItems] = useState(deals);
  const [view, setView] = useState<"board" | "table">("board");
  const [mStage, setMStage] = useState<DealStage>(() => DEAL_STAGES.find((s) => deals.some((d) => d.stage === s)) ?? "discovery");
  const [dlg, setDlg] = useState<null | { kind: "won" | "lost"; card: DealCard }>(null);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState<null | { id: string; x: number; y: number; ox: number; oy: number; w: number; over: DealStage | null }>(null);
  const start = useRef<{ id: string; x: number; y: number; ox: number; oy: number; w: number } | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const scrollBoard = (dir: 1 | -1) => boardRef.current?.scrollBy({ left: dir * 520, behavior: reduce ? "auto" : "smooth" });
  const [pending, startT] = useTransition();
  const reduce = useReducedMotion();

  const byStage = useMemo(() => Object.fromEntries(DEAL_STAGES.map((s) => [s, items.filter((d) => d.stage === s)])) as Record<DealStage, DealCard[]>, [items]);
  const prob: Record<DealStage, number> = { discovery: 0.1, demo_scheduled: 0.25, demo_done: 0.4, proposal: 0.6, negotiation: 0.8, won: 1, lost: 0 };

  const commit = (card: DealCard, to: DealStage, extra?: Parameters<typeof moveDeal>[2]) => {
    const before = items;
    setItems((xs) => xs.map((d) => (d.id === card.id ? { ...d, stage: to, days: 0, prob: prob[to], ...(extra?.won ? { value: extra.won.value, seats: extra.won.seats, plan: extra.won.plan } : {}) } : d)));
    startT(async () => {
      const r = await moveDeal(card.id, to, extra);
      if (!r.ok) { setItems(before); toast(r.message, "The card went back to its stage."); }
      else toast(r.message, r.sub);
    });
  };
  const request = (card: DealCard, to: DealStage) => {
    if (to === card.stage) return;
    setErr(null);
    if (to === "won" || to === "lost") setDlg({ kind: to, card });
    else commit(card, to);
  };

  // ---------- pointer drag (desktop board)
  const onDown = (e: RPE<HTMLElement>, card: DealCard) => {
    if (!canMove || e.button !== 0 || e.pointerType === "touch" || (e.target as HTMLElement).closest("a,button")) return;
    const r = e.currentTarget.getBoundingClientRect();
    start.current = { id: card.id, x: e.clientX, y: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, w: r.width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: RPE<HTMLElement>) => {
    const s = start.current; if (!s) return;
    if (!drag && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 6) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-stage]");
    setDrag({ id: s.id, x: e.clientX, y: e.clientY, ox: s.ox, oy: s.oy, w: s.w, over: (el?.dataset.stage as DealStage) ?? null });
  };
  const onUp = () => {
    const d = drag; start.current = null; setDrag(null);
    if (!d?.over) return;
    const card = items.find((x) => x.id === d.id);
    if (card) request(card, d.over);
  };
  const dragged = drag ? items.find((d) => d.id === drag.id) : null;

  const moveMenu = (card: DealCard) => !canMove ? null : (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" className="inline-grid size-8 place-items-center rounded-sm text-ink-3 outline-none hover:bg-paper-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Move ${card.firm} to another stage`}>
          <ArrowRightLeft className="size-4" aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>Move to</MenuLabel>
        {DEAL_STAGES.filter((s) => s !== card.stage).map((s) => (
          <MenuItem key={s} onSelect={() => request(card, s)} className={s === "lost" ? "text-danger" : undefined}>{DEAL_STAGE_LABEL[s]}{s === "won" ? "…" : s === "lost" ? "…" : ""}</MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );

  const cardBody = (card: DealCard) => (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {masked ? <span className="block truncate text-[13px] font-medium text-ink">{card.firm}</span>
            : <Link href={`/leads/${card.leadId}`} className="block truncate text-[13px] font-medium text-ink hover:text-accent">{card.firm}</Link>}
          {card.contact && <span className="block truncate text-[12px] text-ink-3">{card.contact}</span>}
        </div>
        {moveMenu(card)}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="text-[14px] font-semibold text-ink num">{inr(card.value)}</span>
        <span className="text-[12px] text-ink-3 num">{card.stayLine ?? pl.seatsLine(card.seats, card.plan)}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-ink-2"><Avatar name={card.owner} size={20} /><span className="truncate">{card.owner.split(" ")[0]}</span></span>
        <span className="flex items-center gap-1.5">
          {card.stage === "lost" && card.lostReason ? <span className="max-w-[120px] truncate text-[11px] text-ink-3" title={card.lostReason}>{card.lostReason}</span>
            : card.stage !== "won" && <AgeBadge days={card.days} />}
          {card.next && card.stage !== "won" && card.stage !== "lost" && (
            <span className={cn("inline-flex items-center gap-1 text-[11px] num", card.nextOverdue ? "font-medium text-danger" : "text-ink-3")} title="Next step date">
              <CalendarClock className="size-3" aria-hidden />{fmtDate(card.next)}
            </span>
          )}
        </span>
      </div>
    </>
  );

  const columnHead = (s: DealStage) => {
    const ds = byStage[s]; const sum = ds.reduce((a, d) => a + d.value, 0);
    return (
      <div className="px-3 pb-2 pt-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-ink">{DEAL_STAGE_LABEL[s]}</h2>
          <span className="text-[12px] text-ink-3 num" aria-label={pl.deals(ds.length)}>{ds.length}</span>
        </div>
        <div className="mt-0.5 flex items-baseline justify-between gap-2 text-[12px] num">
          <span className="font-medium text-ink">{inrCompact(sum)}</span>
          {s !== "won" && s !== "lost" && <span className="text-ink-3" title={`Weighted at ${Math.round(prob[s] * 100)}%`}>wtd {inrCompact(sum * prob[s])}</span>}
        </div>
      </div>
    );
  };

  // Stage conversion strip (M36), from each deal's current position.
  const open = DEAL_STAGES.filter((s) => s !== "lost");
  const reached = (i: number) => items.filter((d) => d.stage !== "lost" && open.indexOf(d.stage) >= i).length;

  if (!items.length) return <div className="rounded-md border border-line bg-surface p-4"><Empty title={pl.emptyTitle}>{pl.emptyHint}</Empty></div>;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <ol aria-label={pl.shareAria} className="scrollbar-thin flex min-w-0 items-center gap-1 overflow-x-auto text-[11px] text-ink-3">
          {open.slice(0, -1).map((s, i) => (
            <li key={s} className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-line bg-surface px-2 py-1">
              <span>{DEAL_STAGE_LABEL[s]} → {DEAL_STAGE_LABEL[open[i + 1]]}</span>
              <span className="font-medium text-ink num">{reached(i) ? pct(reached(i + 1) / reached(i), 0) : "–"}</span>
              {reached(i) < 20 && <span className="text-[10px]">low n</span>}
            </li>
          ))}
        </ol>
        <div className="flex items-center gap-2">
          {view === "board" && (
            <span className="hidden items-center gap-1 md:inline-flex">
              <span className="text-[12px] text-ink-3">7 stages</span>
              <Button size="icon" variant="secondary" aria-label="Scroll board left" onClick={() => scrollBoard(-1)}><ChevronLeft /></Button>
              <Button size="icon" variant="secondary" aria-label="Scroll board right to Won and Lost" onClick={() => scrollBoard(1)}><ChevronRight /></Button>
            </span>
          )}
          <Segmented label="Pipeline view" value={view} onChange={setView} options={[{ value: "board", label: "Board" }, { value: "table", label: "Table" }]} />
        </div>
      </div>

      {view === "table" ? (
        <div className="scrollbar-thin relative overflow-x-auto rounded-md border border-line bg-surface">
          <table className="w-full border-collapse" style={{ minWidth: 860 }} aria-label={pl.tableAria}>
            <thead><tr className="border-b border-line bg-paper/60">
              <th scope="col" className={th}>{pl.firmCol}</th>{!masked && <th scope="col" className={th}>Contact</th>}<th scope="col" className={th}>Stage</th>
              <th scope="col" className={thNum}>Value</th><th scope="col" className={thNum}>{pl.seatsCol}</th><th scope="col" className={th}>Owner</th>
              <th scope="col" className={thNum}>Days in stage</th><th scope="col" className={th}>Close</th><th scope="col" className={th}><span className="sr-only">Move</span></th>
            </tr></thead>
            <tbody>
              {[...items].sort((a, b) => DEAL_STAGES.indexOf(a.stage) - DEAL_STAGES.indexOf(b.stage) || b.value - a.value).map((d) => (
                <tr key={d.id} className="border-b border-line last:border-0 hover:bg-paper/60">
                  <td className={td}>{masked ? d.firm : <Link href={`/leads/${d.leadId}`} className="hover:text-accent">{d.firm}</Link>}</td>
                  {!masked && <td className={cn(td, "text-ink-2")}>{d.contact}</td>}
                  <td className={td}><DealStageBadge stage={d.stage} /></td>
                  <td className={tdNum}>{inr(d.value)}</td><td className={tdNum}>{d.seats}</td>
                  <td className={cn(td, "text-ink-2")}>{d.owner}</td>
                  <td className={tdNum}>{d.stage === "won" || d.stage === "lost" ? "—" : d.days}</td>
                  <td className={cn(td, "text-ink-2 num")}>{fmtDate(d.close)}</td>
                  <td className={td}>{moveMenu(d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          {/* Desktop and tablet board */}
          <LayoutGroup>
            <div ref={boardRef} className="scrollbar-thin relative hidden gap-3 overflow-x-auto pb-2 md:flex" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { start.current = null; setDrag(null); }}>
              {DEAL_STAGES.map((s) => (
                <section key={s} data-stage={s} aria-label={`${DEAL_STAGE_LABEL[s]}: ${pl.deals(byStage[s].length)}`}
                  className={cn("flex w-[248px] shrink-0 flex-col rounded-md border bg-paper-2/60 transition-colors duration-150",
                    drag?.over === s && dragged?.stage !== s ? "border-accent bg-accent-soft/50" : "border-line",
                    s === "won" && "bg-success-soft/40", s === "lost" && "bg-paper/60")}>
                  {columnHead(s)}
                  <ul className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
                    {byStage[s].map((card) => (
                      <motion.li key={card.id} layout={!reduce} layoutId={reduce ? undefined : `deal-${card.id}`} transition={{ duration: 0.15, ease: EASE }}
                        onPointerDown={(e) => onDown(e, card)}
                        className={cn("relative rounded-sm border border-line bg-surface p-2.5 shadow-1", canMove && "cursor-grab active:cursor-grabbing", drag?.id === card.id && "opacity-40")}>
                        {cardBody(card)}
                      </motion.li>
                    ))}
                    {!byStage[s].length && <li className="rounded-sm border border-dashed border-line-strong px-2 py-4 text-center text-[12px] text-ink-3">{canMove ? pl.drop : pl.noDeals}</li>}
                  </ul>
                </section>
              ))}
            </div>
          </LayoutGroup>
          {drag && dragged && (
            <div aria-hidden className="pointer-events-none fixed z-50 rounded-sm border border-accent bg-surface p-2.5 shadow-pop" style={{ left: drag.x - drag.ox, top: drag.y - drag.oy, width: drag.w }}>
              {cardBody(dragged)}
            </div>
          )}

          {/* Mobile: one column at a time */}
          <div className="md:hidden">
            <div role="tablist" aria-label="Stages" className="scrollbar-thin -mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4">
              {DEAL_STAGES.map((s) => (
                <button key={s} type="button" role="tab" aria-selected={mStage === s} onClick={() => setMStage(s)} ref={(el) => { if (el && mStage === s) el.scrollIntoView({ block: "nearest", inline: "nearest" }); }}
                  className={cn("inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    mStage === s ? "border-navy-900 bg-navy-900 text-navy-ink" : "border-line-strong bg-surface text-ink-2")}>
                  {DEAL_STAGE_LABEL[s]}<span className="num text-[12px] opacity-75">{byStage[s].length}</span>
                </button>
              ))}
            </div>
            <section role="tabpanel" aria-label={DEAL_STAGE_LABEL[mStage]} className="touch-pan-y rounded-md border border-line bg-paper-2/60"
              onPointerDown={(e) => { swipe.current = { x: e.clientX, y: e.clientY }; }}
              onPointerUp={(e) => {
                const s0 = swipe.current; swipe.current = null; if (!s0) return;
                const dx = e.clientX - s0.x, dy = e.clientY - s0.y;
                if (Math.abs(dx) < 60 || Math.abs(dy) > 40) return;
                const i = DEAL_STAGES.indexOf(mStage) + (dx < 0 ? 1 : -1);
                if (i >= 0 && i < DEAL_STAGES.length) setMStage(DEAL_STAGES[i]);
              }}>
              {columnHead(mStage)}
              <ul className="flex flex-col gap-2 px-2 pb-2">
                {byStage[mStage].map((card) => <li key={card.id} className="rounded-sm border border-line bg-surface p-3 shadow-1">{cardBody(card)}</li>)}
                {!byStage[mStage].length && <li className="px-2 py-6 text-center text-[13px] text-ink-3">{pl.noIn(DEAL_STAGE_LABEL[mStage])}</li>}
              </ul>
            </section>
            <p className="mt-2 text-center text-[12px] text-ink-3">Swipe left or right to change stage{canMove ? "; use the move button on a card to change its stage" : ""}.</p>
          </div>
        </>
      )}

      <Dialog open={dlg?.kind === "won"} onOpenChange={(o) => !o && setDlg(null)}>
        {dlg?.kind === "won" && (
          <DialogContent title={pl.wonTitle(dlg.card.firm)} description={pl.wonDesc}>
            <form className="space-y-3" onSubmit={(e) => {
              e.preventDefault(); const f = new FormData(e.currentTarget);
              const won = { plan: String(f.get("plan")), seats: Number(f.get("seats")), value: Number(f.get("value")), start: String(f.get("start")) };
              if (!won.seats || won.seats < 1 || !won.value || won.value <= 0 || !won.start) { setErr(pl.wonErr); return; }
              const card = dlg.card; setDlg(null); commit(card, "won", { won });
            }}>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{pl.plan}</span>
                  <select name="plan" className={field} defaultValue={PLANS.includes(dlg.card.plan) ? dlg.card.plan : PLANS[0]}>{PLANS.map((p) => <option key={p}>{p}</option>)}</select></label>
                <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{pl.seats}</span>
                  <input name="seats" type="number" min={1} max={500} required defaultValue={dlg.card.seats} className={field} /></label>
                <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{pl.value}</span>
                  <input name="value" type="number" min={1} step={100} required defaultValue={dlg.card.value} className={cn(field, "num")} /></label>
                <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{pl.start}</span>
                  <input name="start" type="date" required defaultValue={today} className={field} /></label>
              </div>
              <p className="text-[12px] text-ink-3">{pl.wonNote(tenantName)}</p>
              {err && <p role="alert" className="text-[12px] text-danger">{err}</p>}
              <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setDlg(null)}>Cancel</Button><Button variant="primary" disabled={pending}>{pl.wonBtn}</Button></div>
            </form>
          </DialogContent>
        )}
      </Dialog>
      <Dialog open={dlg?.kind === "lost"} onOpenChange={(o) => !o && setDlg(null)}>
        {dlg?.kind === "lost" && (
          <DialogContent title={pl.lostTitle(dlg.card.firm)} description={pl.lostDesc}>
            <form className="space-y-3" onSubmit={(e) => {
              e.preventDefault(); const f = new FormData(e.currentTarget);
              const reason = String(f.get("reason") ?? ""); if (!reason) { setErr("Pick a reason."); return; }
              const card = dlg.card; setDlg(null); commit(card, "lost", { lost: { reason, competitor: String(f.get("competitor") ?? "") } });
            }}>
              <fieldset className="grid grid-cols-2 gap-2">
                <legend className="mb-1 text-[12px] font-medium text-ink-2">Reason</legend>
                {LOST_REASONS.map((r) => (
                  <label key={r.key} className="flex min-h-11 items-center gap-2 rounded-sm border border-line px-2.5 text-[13px] has-[:checked]:border-accent has-[:checked]:bg-accent-soft/50">
                    <input type="radio" name="reason" value={r.key} required className="accent-[var(--accent)]" />{r.label}
                  </label>
                ))}
              </fieldset>
              <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">Competitor (optional)</span>
                <input name="competitor" className={field} placeholder={pl.compPh} maxLength={60} /></label>
              {err && <p role="alert" className="text-[12px] text-danger">{err}</p>}
              <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setDlg(null)}>Cancel</Button><Button variant="danger" disabled={pending}>Mark Lost</Button></div>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
