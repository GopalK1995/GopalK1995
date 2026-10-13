// Metric formulas. IDs (M1...) match synthenei/03-projects/growth-crm/02-screens-and-metrics.md.
import { leads, minutesBetween, nowMs } from "@/data/leads";
import { campaigns } from "@/data/campaigns";
import { CONSENT_ACCEPT_RATE, SLA_MINUTES, ga4Totals } from "@/data/ops";
import { median, ratio } from "./format";
import type { Campaign, Lead } from "@/data/types";

export const ICP_ROLES = ["Managing partner / owner", "Senior advocate / practice head"];

export function funnel() {
  // Top of funnel is consented visitors only (landing app sends nothing before consent), so it is below GA4 users.
  const visitors = Math.round(ga4Totals.users * CONSENT_ACCEPT_RATE); // MOCK: derived from the GA4 sample
  const cta = Math.round(visitors * 0.2), start = Math.round(cta * 0.28);
  const submit = leads.length;
  const demoBooked = leads.filter((l) => l.maxStageIdx >= 2).length;
  const demoDone = leads.filter((l) => l.maxStageIdx >= 3).length;
  const won = leads.filter((l) => l.stage === "won").length;
  const steps = [
    { event: "page_view", label: "Visit", n: visitors },
    { event: "cta_click", label: "CTA click", n: cta },
    { event: "form_start", label: "Form start", n: start },
    { event: "form_submit", label: "Form submit (lead)", n: submit },
    { event: "demo_booked", label: "Demo booked", n: demoBooked },
    { event: "demo_done", label: "Demo done", n: demoDone },
    { event: "won", label: "Won", n: won },
  ];
  return steps.map((s, i) => ({ ...s, stepRate: i === 0 ? NaN : ratio(s.n, steps[i - 1].n), cumRate: ratio(s.n, steps[0].n) }));
}
export const tourPlayers = () => leads.filter((l) => l.events.some((e) => e.name === "tour_play")).length;

export function campaignStats(c: Campaign) {
  const ls = leads.filter((l) => l.campaignId === c.id);
  const demos = ls.filter((l) => l.maxStageIdx >= 2).length;
  return {
    ...c, leads: ls.length, demos,
    ctr: ratio(c.clicks, c.impressions), cpl: c.spend > 0 ? ratio(c.spend, ls.length) : NaN,
    costPerDemo: c.spend > 0 ? ratio(c.spend, demos) : NaN, leadToDemo: ratio(demos, ls.length),
    gap: c.platformLeads ? c.platformLeads - ls.length : null,
  };
}
export const allCampaignStats = () => campaigns.map(campaignStats);

export function slaStats() {
  const mins = leads.filter((l) => l.firstResponseAt).map((l) => minutesBetween(l.createdAt, l.firstResponseAt!));
  const breached = leads.filter((l) => (l.firstResponseAt ? minutesBetween(l.createdAt, l.firstResponseAt) : minutesBetween(l.createdAt, new Date(nowMs).toISOString())) > SLA_MINUTES).length;
  return { median: median(mins), breached, pctWithin: ratio(leads.length - breached, leads.length) };
}
export const isBreached = (l: Lead) => (l.firstResponseAt ? minutesBetween(l.createdAt, l.firstResponseAt) : minutesBetween(l.createdAt, new Date(nowMs).toISOString())) > SLA_MINUTES;

export const countBy = <T,>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, number>(); xs.forEach((x) => m.set(key(x), (m.get(key(x)) ?? 0) + 1));
  return [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
};
export const icpMatch = (l: Lead) => ICP_ROLES.includes(l.role) && !l.personalEmail;

export function leadsPerDay(days = 30) {
  const out: { day: string; n: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(nowMs - i * 86400e3).toISOString().slice(0, 10);
    out.push({ day: d, n: leads.filter((l) => l.createdAt.slice(0, 10) === d).length });
  }
  return out;
}
