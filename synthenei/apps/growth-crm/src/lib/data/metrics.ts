// Metric formulas. IDs (M1..M29) match synthenei/03-projects/growth-crm/03-product-spec.md section 6 (M1–M63).
// Pure functions over arrays from the DataSource, so they work the same for mock and Supabase data.
import type { Account, Activity, Campaign, CampaignDay, Channel, Deal, DealStage, Ga4Day, Lead, LeadStage, TeamMember } from "./types";
import { median, ratio } from "../format";

export const SLA_MINUTES = 120; // 2 business hours, 10:00–19:00 IST Mon–Sat (M14, spec section 4)
export const CONSENT_RATE = 0.63; // share of GA4 users who accept analytics consent (mock assumption)
export const LEAD_STAGES: LeadStage[] = ["new", "contacted", "qualified", "demo_booked", "demo_done", "proposal", "won", "lost"];
export const LEAD_STAGE_LABEL: Record<LeadStage, string> = { new: "New", contacted: "Contacted", qualified: "Qualified", demo_booked: "Demo booked", demo_done: "Demo done", proposal: "Proposal", won: "Won", lost: "Lost" };
export const DEAL_STAGES: DealStage[] = ["discovery", "demo_scheduled", "demo_done", "proposal", "negotiation", "won", "lost"];
export const DEAL_STAGE_LABEL: Record<DealStage, string> = { discovery: "Discovery", demo_scheduled: "Demo scheduled", demo_done: "Demo done", proposal: "Proposal sent", negotiation: "Negotiation", won: "Won", lost: "Lost" };
export const CHANNEL_LABEL: Record<Channel, string> = { linkedin: "LinkedIn", whatsapp: "WhatsApp", email: "Email", meta: "Meta", google_ads: "Google Ads", organic: "Organic", referral: "Referral", event: "Events" };

const reached = (l: Lead, s: LeadStage) => {
  const idx = LEAD_STAGES.indexOf(s);
  const own = l.stage === "lost" ? 1 : LEAD_STAGES.indexOf(l.stage);
  return own >= idx;
};
export const isDemo = (l: Lead) => reached(l, "demo_booked"); // M10

/** M1–M6 funnel. Top steps come from consented GA4 users, so they under-count vs GA4 (stated on screen). */
export function funnel(leads: Lead[], ga4: Ga4Day[], days = 90, labels?: Record<string, string>) {
  const g = ga4.slice(-days);
  const visitors = Math.round(g.reduce((a, d) => a + d.users, 0) * CONSENT_RATE);
  const cta = Math.round(visitors * 0.118), start = Math.round(cta * 0.41);
  const steps = [
    { key: "visit", label: labels?.visit ?? "Visitors (consented)", n: visitors },
    { key: "cta", label: labels?.cta ?? "CTA click", n: cta },
    { key: "form", label: labels?.form ?? "Form start", n: start },
    { key: "lead", label: labels?.lead ?? "Lead", n: leads.length },
    { key: "qualified", label: labels?.qualified ?? "Qualified", n: leads.filter((l) => reached(l, "qualified")).length },
    { key: "demo", label: labels?.demo ?? "Demo booked", n: leads.filter((l) => reached(l, "demo_booked")).length },
    { key: "demo_done", label: labels?.demo_done ?? "Demo done", n: leads.filter((l) => reached(l, "demo_done")).length },
    { key: "won", label: labels?.won ?? "Won", n: leads.filter((l) => l.stage === "won").length },
  ];
  return steps.map((s, i) => ({ ...s, step: i ? ratio(s.n, steps[i - 1].n) : 1, cum: ratio(s.n, steps[0].n) }));
}

export function pipelineTotals(deals: Deal[], nowIso: string) {
  const open = deals.filter((d) => d.stage !== "won" && d.stage !== "lost");
  const month = nowIso.slice(0, 7);
  const wonMonth = deals.filter((d) => d.stage === "won" && d.wonAt && d.wonAt.slice(0, 7) === month);
  const prevMonth = new Date(new Date(nowIso).setUTCMonth(new Date(nowIso).getUTCMonth() - 1)).toISOString().slice(0, 7);
  const wonPrev = deals.filter((d) => d.stage === "won" && d.wonAt?.slice(0, 7) === prevMonth);
  return {
    openValue: open.reduce((a, d) => a + d.value, 0),
    weighted: open.reduce((a, d) => a + d.value * d.probability, 0),
    openCount: open.length,
    wonMonthValue: wonMonth.reduce((a, d) => a + d.value, 0), wonMonthCount: wonMonth.length,
    wonPrevValue: wonPrev.reduce((a, d) => a + d.value, 0),
    winRate: ratio(deals.filter((d) => d.stage === "won").length, deals.filter((d) => d.stage === "won" || d.stage === "lost").length),
    avgDeal: ratio(deals.filter((d) => d.stage === "won").reduce((a, d) => a + d.value, 0), deals.filter((d) => d.stage === "won").length),
  };
}

export function campaignStats(c: Campaign, days: CampaignDay[], leads: Lead[], deals: Deal[]) {
  const ds = days.filter((d) => d.campaignId === c.id);
  const sum = (k: keyof CampaignDay) => ds.reduce((a, d) => a + (d[k] as number), 0);
  const ls = leads.filter((l) => l.campaignId === c.id);
  const demos = ls.filter(isDemo).length;
  const wonDeals = deals.filter((d) => d.stage === "won" && ls.some((l) => l.id === d.leadId));
  const spend = sum("spend"), impressions = sum("impressions"), clicks = sum("clicks"), reach = sum("reach"), engagements = sum("engagements"), platformLeads = sum("platformLeads");
  const revenue = wonDeals.reduce((a, d) => a + d.value, 0);
  return {
    ...c, spend, impressions, clicks, reach, engagements, platformLeads,
    leads: ls.length, demos, won: wonDeals.length, revenue,
    ctr: ratio(clicks, impressions), // M7
    cpl: ratio(spend, ls.length), // M9
    costPerDemo: ratio(spend, demos), // M11
    leadToDemo: ratio(demos, ls.length), // M12
    gap: platformLeads - ls.length, // M13
    engagementRate: ratio(engagements, impressions),
    leadRate: ratio(ls.length, clicks),
    roi: spend > 0 ? revenue / spend : NaN,
  };
}
export type CampaignStats = ReturnType<typeof campaignStats>;

/** Radar profile: 5 axes normalised 0–100 against the best campaign on each axis. */
export function radarProfiles(stats: CampaignStats[]) {
  const axes = [
    { key: "Reach", get: (s: CampaignStats) => s.reach },
    { key: "Engagement", get: (s: CampaignStats) => s.engagementRate },
    { key: "CTR", get: (s: CampaignStats) => s.ctr },
    { key: "Lead rate", get: (s: CampaignStats) => s.leadRate },
    { key: "Cost efficiency", get: (s: CampaignStats) => (Number.isFinite(s.cpl) && s.cpl > 0 ? 1 / s.cpl : 0) },
  ];
  const max = axes.map((a) => Math.max(...stats.map((s) => (Number.isFinite(a.get(s)) ? a.get(s) : 0))));
  return axes.map((a, i) => {
    const row: Record<string, number | string> = { axis: a.key };
    for (const s of stats) { const v = a.get(s); row[s.id] = max[i] > 0 && Number.isFinite(v) ? Math.round((v / max[i]) * 100) : 0; }
    return row;
  });
}

export function leadsPerDay(leads: Lead[], ga4: Ga4Day[], days: number) {
  return ga4.slice(-days).map((g) => ({ date: g.date, leads: leads.filter((l) => l.createdAt.slice(0, 10) === g.date).length }));
}
export function weekly<T extends { date: string }>(rows: T[], val: (r: T) => number) {
  const out: { week: string; value: number }[] = [];
  for (let i = 0; i < rows.length; i += 7) {
    const chunk = rows.slice(i, i + 7);
    out.push({ week: chunk[0].date, value: chunk.reduce((a, r) => a + val(r), 0) });
  }
  return out;
}

/** Channel families so a donut never has "Other" as its biggest slice: Paid social, Search, WhatsApp, Email, Other. */
export const CHANNEL_FAMILY: Record<Channel, string> = { linkedin: "Paid social", meta: "Paid social", google_ads: "Search", organic: "Search", whatsapp: "WhatsApp", email: "Email", referral: "Referrals & events", event: "Referrals & events" };
export function channelMix(leads: Lead[], max = 4, rename?: Record<string, string>) {
  const m = new Map<string, number>();
  const fam = (c: Channel) => rename?.[CHANNEL_FAMILY[c]] ?? CHANNEL_FAMILY[c];
  leads.forEach((l) => m.set(fam(l.channel), (m.get(fam(l.channel)) ?? 0) + 1));
  const rows = [...m.entries()].map(([fam, n]) => ({ key: fam, label: fam, n })).sort((a, b) => b.n - a.n);
  const top = rows.slice(0, max), rest = rows.slice(max);
  return rest.length ? [...top, { key: "other", label: rest.length === 1 ? rest[0].label : "Other", n: rest.reduce((a, r) => a + r.n, 0) }] : top;
}

export const countBy = <T,>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, number>();
  xs.forEach((x) => m.set(key(x), (m.get(key(x)) ?? 0) + 1));
  return [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
};

/** M14: median first response and share within SLA (unanswered leads past SLA count as breached). */
export function slaStats(leads: Lead[], nowIso: string) {
  const now = new Date(nowIso).getTime();
  const mins = leads.filter((l) => l.firstResponseMins !== null).map((l) => l.firstResponseMins!);
  const breached = leads.filter((l) => (l.firstResponseMins ?? (now - new Date(l.createdAt).getTime()) / 60e3) > SLA_MINUTES).length;
  return { median: median(mins), breached, within: ratio(leads.length - breached, leads.length), n: leads.length };
}

/** One definition of a rep's month, shared by Command Center and My day so the numbers always agree.
 *  won = deals won this calendar month; demosBooked/demosDone = activities dated this month; sla = leads created in the last 30 days. */
export function repMonth(repId: string, deals: Deal[], leads: Lead[], acts: Activity[], nowIso: string) {
  const month = nowIso.slice(0, 7), now = new Date(nowIso).getTime();
  const mine = deals.filter((d) => d.ownerId === repId);
  const myLeadIds = new Set(leads.filter((l) => l.ownerId === repId).map((l) => l.id));
  const inMonth = (k: Activity["kind"]) => acts.filter((a) => a.kind === k && myLeadIds.has(a.leadId) && a.at.slice(0, 7) === month).length;
  const l30 = leads.filter((l) => l.ownerId === repId && now - new Date(l.createdAt).getTime() < 30 * 86400e3);
  const sla = slaStats(l30, nowIso);
  return {
    won: mine.filter((d) => d.stage === "won" && d.wonAt?.slice(0, 7) === month).reduce((a, d) => a + d.value, 0),
    open: mine.filter((d) => d.stage !== "won" && d.stage !== "lost").reduce((a, d) => a + d.value, 0),
    demosBooked: inMonth("demo_booked"), demosDone: inMonth("demo_done"), sla: sla.within, slaMedian: sla.median, slaN: sla.n,
  };
}
export const DEMOS_DONE_TARGET = 8;
export function leaderboard(team: TeamMember[], deals: Deal[], leads: Lead[], acts: Activity[], nowIso: string) {
  return team.filter((t) => t.role === "sales_rep").map((t) => ({ id: t.id, name: t.name, title: t.title, target: t.monthlyTarget, ...repMonth(t.id, deals, leads, acts, nowIso) }))
    .sort((a, b) => b.won / b.target - a.won / a.target);
}

export function topFirms(accounts: Account[], deals: Deal[], leads: Lead[], n = 6) {
  return accounts.map((a) => {
    const open = deals.filter((d) => d.accountId === a.id && d.stage !== "won" && d.stage !== "lost");
    const best = leads.filter((l) => l.accountId === a.id).sort((x, y) => y.score - x.score)[0];
    return { ...a, openValue: open.reduce((s, d) => s + d.value, 0), openStage: open[0]?.stage, topScore: best?.score ?? 0, leadCount: leads.filter((l) => l.accountId === a.id).length };
  }).filter((a) => a.openValue > 0).sort((a, b) => b.openValue - a.openValue).slice(0, n);
}

export const ICP_TITLES = ["Managing Partner", "Senior Advocate", "Partner", "Founding Advocate"];
export const icpMatch = (l: Lead, acc?: Account) => ICP_TITLES.includes(l.title) && !l.email.endsWith("@mail.example") && (!acc || acc.icpTier !== "C"); // M15
