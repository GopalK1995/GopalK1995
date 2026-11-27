// Pure read model for the home dashboard (T054). Rows in, numbers out; unit-tested. Nothing tenant-, brand- or price-specific:
// stage meaning comes from the tenant config (outcome, probability, SLA hours), tiles from tenant_config.dashboard.
// Rule everywhere: a reading that cannot be computed is null, never 0 ("No data" on screen).
import type { Campaign, CampaignDay, Deal, Lead, Task, TeamMember } from "@/lib/data/types";
import type { SocialView } from "@/lib/connectors/meta/organic/view";
import { dayKey, deltaOf } from "@/lib/format";
import { leadsInWindow } from "@/lib/data/lead-window";

export const DAY_MS = 86400e3;
type Outcome = "open" | "won" | "lost";
export interface StageMeta { label: string; order: number; outcome: Outcome; slaHours?: number | null; archived?: boolean }
export type StageMap = Record<string, StageMeta>;
const outcomeOf = (m: StageMap, stage: string): Outcome => m[stage]?.outcome ?? (stage === "won" ? "won" : stage === "lost" ? "lost" : "open");
const frac = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const ageMs = (iso: string, now: string) => new Date(now).getTime() - new Date(iso).getTime();
export const isOpenDeal = (m: StageMap, d: Deal) => outcomeOf(m, d.stage) === "open";

/** Default hours an open deal may sit in a stage when the tenant set no per-stage SLA. */
export const DEFAULT_STAGE_SLA_HOURS = 168;
const monthOf = (iso: string) => dayKey(iso).slice(0, 7);
const prevMonth = (m: string) => { const [y, mo] = m.split("-").map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`; };
export const daysInMonth = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };

/* ---------- the month ruler: pipeline flow against the target ---------- */
export interface RulerPoint { day: number; actual: number | null; pace: number | null; forecast: number | null }
export interface Ruler {
  month: string; today: number; days: number; target: number | null; won: number; wonCount: number; gap: number | null;
  /** Weighted value of open deals expected to close later this month. */
  weightedRest: number; forecastEnd: number; slipped: { count: number; value: number };
  /** Value needed per remaining day to hit the target (null when there is no target, no gap or no day left). */
  perDayNeeded: number | null; projectedPct: number | null; points: RulerPoint[];
}
export function monthRuler(deals: Deal[], stages: StageMap, now: string, target: number | null): Ruler {
  const month = monthOf(now), today = Number(dayKey(now).slice(8, 10)), days = daysInMonth(month);
  const wonDeals = deals.filter((d) => outcomeOf(stages, d.stage) === "won" && d.wonAt && monthOf(d.wonAt) === month);
  const won = wonDeals.reduce((a, d) => a + d.value, 0);
  const dayOf = (iso: string) => Number(dayKey(iso).slice(8, 10));
  const open = deals.filter((d) => isOpenDeal(stages, d));
  const inMonth = open.filter((d) => d.expectedClose && monthOf(d.expectedClose) === month);
  const later = inMonth.filter((d) => dayOf(d.expectedClose) > today);
  const weightedRest = later.reduce((a, d) => a + d.value * d.probability, 0);
  const slippedDeals = open.filter((d) => d.expectedClose && dayKey(d.expectedClose) < dayKey(now));
  const hasTarget = target !== null && target > 0;
  const points: RulerPoint[] = Array.from({ length: days }, (_, i) => {
    const day = i + 1;
    const actual = day <= today ? wonDeals.filter((d) => dayOf(d.wonAt!) <= day).reduce((a, d) => a + d.value, 0) : null;
    const forecast = day < today ? null : won + later.filter((d) => dayOf(d.expectedClose) <= day).reduce((a, d) => a + d.value * d.probability, 0);
    return { day, actual, pace: hasTarget ? Math.round((target! * day) / days) : null, forecast };
  });
  const left = days - today, gap = hasTarget ? Math.max(0, target! - won) : null;
  return {
    month, today, days, target: hasTarget ? target : null, won, wonCount: wonDeals.length, gap,
    weightedRest, forecastEnd: won + weightedRest, slipped: { count: slippedDeals.length, value: slippedDeals.reduce((a, d) => a + d.value, 0) },
    perDayNeeded: gap !== null && gap > 0 && left > 0 ? gap / left : null,
    projectedPct: hasTarget ? (won + weightedRest) / target! : null, points,
  };
}

/* ---------- stage flow: where the open value sits, and how long it has been there ---------- */
export interface FlowStage { key: string; label: string; count: number; value: number; weighted: number; stale: number }
export function stageFlow(deals: Deal[], stages: StageMap, now: string): FlowStage[] {
  const open = deals.filter((d) => isOpenDeal(stages, d));
  return Object.entries(stages).filter(([, m]) => m.outcome === "open" && !m.archived).sort((a, b) => a[1].order - b[1].order).map(([key, m]) => {
    const here = open.filter((d) => d.stage === key);
    const limit = (m.slaHours ?? DEFAULT_STAGE_SLA_HOURS) * 3600e3;
    return { key, label: m.label, count: here.length, value: here.reduce((a, d) => a + d.value, 0), weighted: here.reduce((a, d) => a + d.value * d.probability, 0), stale: here.filter((d) => ageMs(d.stageEnteredAt, now) > limit).length };
  });
}

/* ---------- the decision zone ---------- */
export interface Decision { id: "unanswered" | "stale" | "closing" | "overdue" | "slipped"; count: number; value: number | null; href: string }
/** Things a person has to act on today, most urgent first. Only items with a count are returned. */
export function decisions(i: { leads: Lead[]; deals: Deal[]; tasks: Task[]; stages: StageMap; now: string; slaHours: number }): Decision[] {
  const { leads, deals, tasks, stages, now } = i;
  const open = deals.filter((d) => isOpenDeal(stages, d));
  const unanswered = leads.filter((l) => l.firstResponseMins === null && l.status !== "disqualified" && l.status !== "converted" && ageMs(l.createdAt, now) > i.slaHours * 3600e3);
  const stale = open.filter((d) => ageMs(d.stageEnteredAt, now) > (stages[d.stage]?.slaHours ?? DEFAULT_STAGE_SLA_HOURS) * 3600e3);
  const weekEnd = dayKey(new Date(new Date(now).getTime() + 7 * DAY_MS).toISOString()), today = dayKey(now);
  const closing = open.filter((d) => d.expectedClose && dayKey(d.expectedClose) >= today && dayKey(d.expectedClose) <= weekEnd);
  const slipped = open.filter((d) => d.expectedClose && dayKey(d.expectedClose) < today);
  const overdue = tasks.filter((t) => t.status === "open" && dayKey(t.dueAt) < today);
  const val = (xs: Deal[]) => xs.reduce((a, d) => a + d.value, 0);
  const all: Decision[] = [
    { id: "unanswered", count: unanswered.length, value: null, href: "/leads?view=sla" },
    { id: "slipped", count: slipped.length, value: val(slipped), href: "/pipeline" },
    { id: "stale", count: stale.length, value: val(stale), href: "/pipeline" },
    { id: "closing", count: closing.length, value: val(closing), href: "/pipeline" },
    { id: "overdue", count: overdue.length, value: null, href: "/tasks" },
  ];
  return all.filter((d) => d.count > 0);
}

/* ---------- tiles (tenant_config.dashboard.kpiTiles) ---------- */
export type TileFormat = "inr" | "inrCompact" | "num" | "pct" | "mins";
export interface Tile { id: string; value: number | null; format: TileFormat; delta?: number; goodWhen?: "up" | "down" }
export interface TileInput {
  leads: Lead[]; deals: Deal[]; days: CampaignDay[]; stages: StageMap; now: string; slaHours: number;
  /** Tenant meaning of "converted" (a booked demo, a confirmed stay...). */
  converted: (l: Lead) => boolean; rooms: number | null;
}
const rel = (cur: number | null, prev: number | null, minBase = 0): number | undefined => (Number.isFinite(deltaOf(cur, prev, minBase)) ? deltaOf(cur, prev, minBase) : undefined);
export function tiles(ids: string[], x: TileInput): Tile[] {
  const { leads, deals, stages, now } = x, nowMs = new Date(now).getTime(), month = monthOf(now);
  const win = (from: number, to: number) => leadsInWindow(leads, now, { days: to - from, offsetDays: from }); // shared IST definition (AUD-091)
  const l30 = win(0, 30), lPrev = win(30, 60);
  const wonIn = (m: string) => deals.filter((d) => outcomeOf(stages, d.stage) === "won" && d.wonAt && monthOf(d.wonAt) === m);
  const sum = (xs: Deal[]) => xs.reduce((a, d) => a + d.value, 0);
  const open = deals.filter((d) => isOpenDeal(stages, d));
  const wonAll = deals.filter((d) => outcomeOf(stages, d.stage) === "won").length, lostAll = deals.filter((d) => outcomeOf(stages, d.stage) === "lost").length;
  const inWin = x.days.filter((d) => nowMs - new Date(d.date + "T12:00:00+05:30").getTime() < 30 * DAY_MS);
  const spend30 = inWin.length ? inWin.reduce((a, d) => a + d.spend, 0) : null;
  const paidConv = l30.filter((l) => l.campaignId && x.converted(l)).length;
  const answered = l30.filter((l) => l.firstResponseMins !== null).map((l) => l.firstResponseMins!).sort((a, b) => a - b);
  const stays = deals.map((d) => d.stay).filter((s): s is NonNullable<Deal["stay"]> => !!s && s.status !== "cancelled" && s.status !== "enquiry");
  const stayLeads = leads.filter((l) => l.stay);
  const wonStays = deals.filter((d) => outcomeOf(stages, d.stage) === "won" && d.stay && d.stay.status !== "cancelled");
  const occ = (): number | null => {
    if (!x.rooms || !stays.length) return null;
    const t0 = new Date(dayKey(now) + "T00:00:00Z").getTime();
    let used = 0;
    for (let i = 0; i < 30; i++) { const t = t0 + i * DAY_MS; used += Math.min(1, stays.filter((s) => s.status !== "hold" && new Date(s.checkIn + "T00:00:00Z").getTime() <= t && t < new Date(s.checkIn + "T00:00:00Z").getTime() + s.nights * DAY_MS).reduce((a, s) => a + s.rooms, 0) / x.rooms); }
    return used / 30;
  };
  const make: Record<string, () => Tile> = {
    won: () => ({ id: "won", format: "inrCompact", value: sum(wonIn(month)), delta: rel(sum(wonIn(month)), sum(wonIn(prevMonth(month)))) }),
    new: () => ({ id: "new", format: "num", value: l30.length, delta: rel(l30.length, lPrev.length, 4) }),
    conv: () => ({ id: "conv", format: "pct", value: frac(l30.filter(x.converted).length, l30.length) }),
    cost: () => ({ id: "cost", format: "inrCompact", goodWhen: "down", value: spend30 !== null && paidConv > 0 ? spend30 / paidConv : null }),
    pipeline: () => ({ id: "pipeline", format: "inrCompact", value: open.length ? sum(open) : null }),
    winrate: () => ({ id: "winrate", format: "pct", value: frac(wonAll, wonAll + lostAll) }),
    sla: () => ({ id: "sla", format: "pct", value: frac(l30.filter((l) => (l.firstResponseMins ?? ageMs(l.createdAt, now) / 60e3) <= x.slaHours * 60).length, l30.length) }),
    response: () => ({ id: "response", format: "mins", goodWhen: "down", value: answered.length ? answered[Math.floor((answered.length - 1) / 2)] : null }),
    repeat: () => ({ id: "repeat", format: "pct", value: frac(stayLeads.filter((l) => l.stay!.origin === "repeat").length, stayLeads.length) }),
    direct: () => ({ id: "direct", format: "pct", value: frac(wonStays.filter((d) => !d.stay!.viaOta).length, wonStays.length) }),
    occupancy: () => ({ id: "occupancy", format: "pct", value: occ() }),
    adr: () => ({ id: "adr", format: "inr", value: stays.length ? stays.reduce((a, s) => a + s.ratePerNight, 0) / stays.length : null }),
  };
  return ids.filter((id) => make[id]).map((id) => make[id]());
}

/* ---------- the secondary charts ---------- */
export function leadsPerDay(leads: Lead[], now: string, days: number) {
  const today = new Date(dayKey(now) + "T12:00:00Z").getTime();
  const counts = new Map<string, number>();
  for (const l of leads) { const k = dayKey(l.createdAt); counts.set(k, (counts.get(k) ?? 0) + 1); }
  const rows = Array.from({ length: days }, (_, i) => { const date = new Date(today - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10); return { date, leads: counts.get(date) ?? 0 }; });
  return rows.map((r, i) => ({ ...r, avg: Math.round((rows.slice(Math.max(0, i - 6), i + 1).reduce((a, x) => a + x.leads, 0) / Math.min(7, i + 1)) * 10) / 10 }));
}

/** Lead funnel from the tenant's own lead stages: the first step is every lead, later steps are non-lost leads at or past that stage. */
export function leadFunnel(leads: Lead[], stages: StageMap, firstLabel: string) {
  const live = leads.filter((l) => outcomeOf(stages, l.stage) !== "lost");
  const list = Object.entries(stages).filter(([, m]) => m.outcome !== "lost" && !m.archived).sort((a, b) => a[1].order - b[1].order);
  const steps = [{ key: "all", label: firstLabel, n: leads.length }, ...list.map(([key, m]) => ({ key, label: m.label, n: live.filter((l) => (stages[l.stage]?.order ?? -1) >= m.order).length }))];
  return steps.map((s, i) => ({ ...s, step: i ? (steps[i - 1].n > 0 ? s.n / steps[i - 1].n : NaN) : 1, cum: leads.length > 0 ? s.n / leads.length : NaN }));
}

export function costPerConverted(campaigns: Campaign[], days: CampaignDay[], leads: Lead[], converted: (l: Lead) => boolean) {
  return campaigns.map((c) => {
    const ds = days.filter((d) => d.campaignId === c.id);
    const spend = ds.reduce((a, d) => a + d.spend, 0), n = leads.filter((l) => l.campaignId === c.id && converted(l)).length;
    return { label: c.name.split(" — ")[0], value: n > 0 && ds.length > 0 && spend > 0 ? Math.round(spend / n) : null, note: `${n}` };
  }).filter((r): r is { label: string; value: number; note: string } => r.value !== null).sort((a, b) => a.value - b.value);
}

export function topAccounts(deals: Deal[], stages: StageMap, names: Map<string, string>, n = 6) {
  const m = new Map<string, { id: string; value: number; deals: number }>();
  for (const d of deals.filter((x) => isOpenDeal(stages, x))) { const r = m.get(d.accountId) ?? { id: d.accountId, value: 0, deals: 0 }; r.value += d.value; r.deals++; m.set(d.accountId, r); }
  return [...m.values()].sort((a, b) => b.value - a.value).slice(0, n).map((r) => ({ ...r, name: names.get(r.id) ?? "" }));
}
export function teamVsTarget(team: TeamMember[], deals: Deal[], stages: StageMap, now: string) {
  const month = monthOf(now);
  return team.filter((t) => t.role === "sales_rep").map((t) => {
    const won = deals.filter((d) => d.ownerId === t.id && outcomeOf(stages, d.stage) === "won" && d.wonAt && monthOf(d.wonAt) === month).reduce((a, d) => a + d.value, 0);
    return { id: t.id, name: t.name, won, target: t.monthlyTarget > 0 ? t.monthlyTarget : null };
  }).sort((a, b) => b.won - a.won);
}

/* ---------- paid and organic social, side by side ---------- */
export const PAID_SOCIAL = new Set<string>(["meta", "linkedin"]);
export type Cell = number | null | "na";
export interface PaidOrganic {
  paidConnected: boolean; organicState: SocialView["state"];
  /** AUD-100: the connected accounts the organic column adds up (platform + name), so a total over several Pages is never anonymous. */
  organicAccounts: { platform: "instagram" | "facebook"; name: string }[];
  rows: { key: "reach" | "impressions" | "clicks" | "engagements" | "engagementRate" | "spend" | "leads" | "costPerLead" | "followers"; paid: Cell; organic: Cell; format: "num" | "pct" | "inr" }[];
  weekly: { week: string; a: number | null; b: number | null }[];
}
const sumNN = (xs: (number | null)[]): number | null => { const v = xs.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
export function paidVsOrganic(i: { campaigns: Campaign[]; days: CampaignDay[]; leads: Lead[]; social: SocialView; now: string; weeks?: number }): PaidOrganic {
  const nowMs = new Date(i.now).getTime(), cut = nowMs - 30 * DAY_MS, today = dayKey(i.now);
  const paidIds = new Set(i.campaigns.filter((c) => PAID_SOCIAL.has(c.channel)).map((c) => c.id));
  const pd = i.days.filter((d) => paidIds.has(d.campaignId));
  const pd30 = pd.filter((d) => new Date(d.date + "T12:00:00+05:30").getTime() >= cut);
  const has = pd30.length > 0;
  const s = (k: "spend" | "impressions" | "reach" | "clicks" | "engagements") => (has ? pd30.reduce((a, d) => a + d[k], 0) : null);
  const crmLeads = has ? i.leads.filter((l) => l.campaignId && paidIds.has(l.campaignId) && new Date(l.createdAt).getTime() >= cut).length : null;
  const spend = s("spend");
  // Organic, last 30 days.
  const sv = i.social, ready = sv.state === "ready" || sv.state === "needs_attention";
  const posts = ready ? sv.posts.filter((p) => new Date(p.postedAt).getTime() >= cut) : [];
  const trend30 = ready ? sv.trend.filter((t) => t.day >= dayKey(new Date(cut).toISOString())) : [];
  const oReach = sumNN(trend30.map((t) => t.reach)), oImp = sumNN(posts.map((p) => p.metrics.impressions));
  const oEng = sumNN(posts.map((p) => (p.metrics.likes === null && p.metrics.comments === null && p.metrics.shares === null && p.metrics.saves === null ? null : (p.metrics.likes ?? 0) + (p.metrics.comments ?? 0) + (p.metrics.shares ?? 0) + (p.metrics.saves ?? 0))));
  const followers = ready ? sumNN(sv.accounts.map((a) => a.followers)) : null;
  const pEng = s("engagements"), pImp = s("impressions");
  const rows: PaidOrganic["rows"] = [
    { key: "reach", paid: s("reach"), organic: oReach, format: "num" },
    { key: "impressions", paid: pImp, organic: oImp, format: "num" },
    { key: "clicks", paid: s("clicks"), organic: ready ? sumNN(posts.map((p) => p.metrics.linkClicks)) : null, format: "num" },
    { key: "engagements", paid: pEng, organic: oEng, format: "num" },
    { key: "engagementRate", paid: pEng !== null && pImp ? pEng / pImp : null, organic: oEng !== null && oImp ? oEng / oImp : null, format: "pct" },
    { key: "spend", paid: spend, organic: "na", format: "inr" },
    { key: "leads", paid: crmLeads, organic: "na", format: "num" },
    { key: "costPerLead", paid: spend !== null && crmLeads ? spend / crmLeads : null, organic: "na", format: "inr" },
    { key: "followers", paid: "na", organic: followers, format: "num" },
  ];
  const nWeeks = i.weeks ?? 8, end = new Date(today + "T12:00:00Z").getTime();
  const weekly = Array.from({ length: nWeeks }, (_, k) => {
    const to = end - (nWeeks - 1 - k) * 7 * DAY_MS, from = to - 6 * DAY_MS;
    const f = new Date(from).toISOString().slice(0, 10), t = new Date(to).toISOString().slice(0, 10);
    const a = sumNN(pd.filter((d) => d.date >= f && d.date <= t).map((d) => d.reach));
    const b = ready ? sumNN(sv.trend.filter((x) => x.day >= f && x.day <= t).map((x) => x.reach)) : null;
    return { week: new Date(to).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }), a, b };
  });
  return { paidConnected: has, organicState: sv.state, organicAccounts: ready ? sv.accounts.map((a) => ({ platform: a.platform, name: a.name })) : [], rows, weekly };
}
