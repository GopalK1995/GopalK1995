// Page-local derivations for /campaigns, /campaigns/[id], /audience and /analytics.
// Pure functions over DataSource arrays (workspace-scoped by pageCtx), so mock and Supabase behave the same.
import type { Account, Activity, Campaign, CampaignDay, Channel, Deal, Ga4Day, Integration, Lead } from "@/lib/data/types";
import { CHANNEL_LABEL, campaignStats, isDemo, type CampaignStats } from "@/lib/data/metrics";
import { dayKey, fmtDate, ratio } from "@/lib/format";

export const DAY_MS = 86400e3;

/** Campaign channel -> integration route id (spec 14: key with _ -> -). Email campaigns come from Mailchimp. */
export const CHANNEL_SOURCE: Record<Campaign["channel"], string> = {
  linkedin: "linkedin", meta: "meta-ads", google_ads: "google-ads", whatsapp: "whatsapp", email: "mailchimp",
};
export const CAMPAIGN_CHANNELS: Campaign["channel"][] = ["linkedin", "whatsapp", "email", "meta", "google_ads"];
export const CHANNEL_CHIP: Record<Campaign["channel"], string> = { linkedin: "LinkedIn", whatsapp: "WhatsApp", email: "Mailchimp", meta: "Meta", google_ads: "Google" };

export const shortName = (name: string) => name.split(" — ")[0];

/** Source state per campaign channel: anything not connected wears a Showcase chip and links to its integration page. */
export function sourceState(integrations: Integration[]) {
  const out = {} as Record<Campaign["channel"], { id: string; name: string; connected: boolean; lastSyncAt: string | null }>;
  for (const ch of CAMPAIGN_CHANNELS) {
    const i = integrations.find((x) => x.id === CHANNEL_SOURCE[ch]);
    out[ch] = { id: CHANNEL_SOURCE[ch], name: i?.name ?? CHANNEL_CHIP[ch], connected: i?.status === "connected", lastSyncAt: i?.lastSyncAt ?? null };
  }
  return out;
}

/** 12 calendar weeks ending today (IST), oldest first. Week = 7 days ending on the bucket's last day. */
export function weekBuckets(nowIso: string, n = 12) {
  const today = new Date(dayKey(nowIso) + "T12:00:00Z").getTime();
  return Array.from({ length: n }, (_, i) => {
    const endMs = today - (n - 1 - i) * 7 * DAY_MS;
    const startMs = endMs - 6 * DAY_MS;
    const start = new Date(startMs).toISOString().slice(0, 10), end = new Date(endMs).toISOString().slice(0, 10);
    return { start, end, label: fmtDate(start + "T06:00:00Z") };
  });
}
export const inBucket = (date: string, b: { start: string; end: string }) => date >= b.start && date <= b.end;
export const leadDay = (l: Lead) => dayKey(l.createdAt);

export function allStats(campaigns: Campaign[], days: CampaignDay[], leads: Lead[], deals: Deal[]) {
  return campaigns.map((c) => campaignStats(c, days, leads, deals));
}

/** KPI series for the last 30 days vs the prior 30, plus 12 weekly buckets for sparklines.
 *  Same windows and definitions as the Command Center: spend by campaign-day (IST), leads by created time,
 *  demos by the date the demo was BOOKED (demo_booked activity) for campaign-sourced leads (M10/M11). */
export function kpiSeries(days: CampaignDay[], leads: Lead[], acts: Activity[], nowIso: string) {
  const nowMs = new Date(nowIso).getTime();
  const weeks = weekBuckets(nowIso, 12);
  const cLeads = leads.filter((l) => l.campaignId);
  const paid = new Set(cLeads.map((l) => l.id));
  const booked = acts.filter((a) => a.kind === "demo_booked" && paid.has(a.leadId));
  const ageSpend = (d: CampaignDay) => nowMs - new Date(d.date + "T12:00:00+05:30").getTime();
  const age = (iso: string) => nowMs - new Date(iso).getTime();
  const win = (from: number, to: number) => {
    const inW = (t: number) => t >= from * DAY_MS && t < to * DAY_MS;
    const spend = days.filter((d) => inW(ageSpend(d))).reduce((a, d) => a + d.spend, 0);
    const ls = cLeads.filter((l) => inW(age(l.createdAt))).length;
    const demos = booked.filter((a) => inW(age(a.at))).length;
    return { spend, leads: ls, demos, cpl: ratio(spend, ls), cpd: ratio(spend, demos) };
  };
  const spendW = weeks.map((w) => days.filter((d) => inBucket(d.date, w)).reduce((a, d) => a + d.spend, 0));
  const leadsW = weeks.map((w) => cLeads.filter((l) => inBucket(leadDay(l), w)).length);
  const demosW = weeks.map((w) => booked.filter((a) => inBucket(dayKey(a.at), w)).length);
  const a = win(0, 30), b = win(30, 60);
  const delta = (x: number, y: number) => (Number.isFinite(x) && Number.isFinite(y) && y > 0 ? x / y - 1 : NaN);
  return {
    weeks, spendW, leadsW, demosW,
    cplW: weeks.map((_, i) => (leadsW[i] ? spendW[i] / leadsW[i] : 0)),
    cpdW: weeks.map((_, i) => (demosW[i] ? spendW[i] / demosW[i] : 0)),
    cur: a, prev: b,
    d: { spend: delta(a.spend, b.spend), leads: delta(a.leads, b.leads), demos: delta(a.demos, b.demos), cpl: delta(a.cpl, b.cpl), cpd: delta(a.cpd, b.cpd) },
  };
}

/** M45 radar rows with campaign ids as keys plus optional extra series (channel average, best). */
export const RADAR_AXES = ["Reach", "Engagement", "CTR", "Lead rate", "Cost efficiency"] as const;
export function radarRaw(s: CampaignStats) {
  return [s.reach, s.engagementRate, s.ctr, s.leadRate, s.spend === 0 && s.leads > 0 ? Infinity : Number.isFinite(s.cpl) && s.cpl > 0 ? 1 / s.cpl : 0];
}
/** M45 reach profile, 0-100 per axis by POSITION among this workspace's campaigns in the period (best = 100,
 *  lowest = 100/n). A pure "/ max" scale let one structural outlier (WhatsApp CTR ~19% vs LinkedIn ~0.6%) flatten
 *  every other campaign to a spike, so the chart compared nothing; rank keeps every axis readable and the raw value
 *  sits beside each score in the table. Ties share the higher position. Email with no media spend = best cost efficiency. */
export function radarScores(stats: CampaignStats[]) {
  const raw = stats.map(radarRaw).map((r) => r.map((v) => (Number.isFinite(v) || v === Infinity ? v : 0)));
  const n = stats.length;
  const scores = new Map<string, number[]>();
  stats.forEach((s, j) => scores.set(s.id, RADAR_AXES.map((_, i) => {
    const v = raw[j][i];
    const below = raw.filter((r) => r[i] <= v).length; // includes itself and ties
    return v <= 0 ? 0 : Math.round((below / n) * 100);
  })));
  return scores;
}
export function radarRows(series: { key: string; values: number[] }[]) {
  return RADAR_AXES.map((axis, i) => {
    const row: Record<string, number | string> = { axis };
    for (const s of series) row[s.key] = s.values[i];
    return row;
  });
}

/** Deal-based outcome for a demo lead (stacked columns). Order is ordinal: booked -> done -> proposal -> won, lost apart. */
export const OUTCOMES = [
  { key: "won", label: "Won" },
  { key: "proposal", label: "Proposal out" },
  { key: "done", label: "Demo done, open" },
  { key: "booked", label: "Booked, upcoming" },
  { key: "lost", label: "Lost" },
] as const;
export type OutcomeKey = (typeof OUTCOMES)[number]["key"];
export function outcomeOf(l: Lead): OutcomeKey {
  if (l.stage === "won") return "won";
  if (l.stage === "lost") return "lost";
  if (l.stage === "proposal") return "proposal";
  if (l.stage === "demo_done") return "done";
  return "booked";
}

/** First vs last touch credit by channel (leads, demos, won). */
export function attribution(leads: Lead[], model: "first" | "last") {
  const m = new Map<Channel, { leads: number; demos: number; won: number }>();
  for (const l of leads) {
    const ch = model === "first" ? l.firstTouch : l.lastTouch;
    const r = m.get(ch) ?? { leads: 0, demos: 0, won: 0 };
    r.leads++; if (isDemo(l)) r.demos++; if (l.stage === "won") r.won++;
    m.set(ch, r);
  }
  return [...m.entries()].map(([ch, r]) => ({ ch, label: CHANNEL_LABEL[ch], ...r })).sort((a, b) => b.leads - a.leads);
}

/** Lead enriched with its account (for audience segmentation). Personal data stripped: counts only leave the server. */
export type SegLead = {
  district: string; size: Account["size"] | "Unknown"; title: string; practice: string; highCourt: boolean;
  channel: Channel; demo: boolean; won: boolean; closed: boolean; marketingConsent: boolean; recent: boolean; workEmail: boolean;
};
export function segLeads(leads: Lead[], accounts: Account[], nowIso: string): SegLead[] {
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const now = new Date(nowIso).getTime();
  return leads.map((l) => {
    const a = acc.get(l.accountId);
    return {
      district: a?.district ?? "Unknown", size: a?.size ?? "Unknown", title: l.title, practice: a?.practiceAreas[0] ?? "Unknown",
      highCourt: !!a?.courts.some((c) => c.includes("High Court")), channel: l.channel, demo: isDemo(l), won: l.stage === "won",
      closed: l.stage === "won" || l.stage === "lost", marketingConsent: l.consent.marketing, recent: now - new Date(l.createdAt).getTime() < 30 * DAY_MS,
      workEmail: !l.email.endsWith("@mail.example"),
    };
  });
}

/** Spend per day for one campaign joined with CRM leads per day (IST). */
export function dailyJoin(days: CampaignDay[], leads: Lead[]) {
  return [...days].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({
    date: d.date, spend: d.spend, clicks: d.clicks, leads: leads.filter((l) => leadDay(l) === d.date).length,
  }));
}

export function ga4Weekly(ga4: Ga4Day[], nowIso: string) {
  return weekBuckets(nowIso, 12).map((w) => {
    const xs = ga4.filter((g) => inBucket(g.date, w));
    return { week: w.label, sessions: xs.reduce((a, g) => a + g.sessions, 0), engaged: xs.reduce((a, g) => a + g.engagedSessions, 0) };
  });
}
