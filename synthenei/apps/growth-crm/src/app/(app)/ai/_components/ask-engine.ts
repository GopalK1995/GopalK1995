// "Ask the CRM": maps a question to ONE approved metric query (spec section 9). No free SQL, no model call in
// showcase. Every answer is computed from the caller's scoped data (a Sales Rep only sees own records) and shows the
// metric IDs, filters and source tables it used.
import { accessFor } from "@/lib/auth/roles";
import { campaignStats, slaStats } from "@/lib/data/metrics";
import { dayKey, fmtWeekday, inr, inrCompact, minsToHuman, num, pct, ratio } from "@/lib/format";
import type { Account, Campaign, CampaignDay, Deal, Lead, Role, Task, TeamMember } from "@/lib/data/types";

export type QId = "demos_week" | "cost_per_demo" | "sla" | "district_pipeline" | "win_rate" | "overdue";
export const QUESTIONS: { id: QId; q: string; metric: string }[] = [
  { id: "demos_week", q: "How many demos are booked this week?", metric: "M33" },
  { id: "overdue", q: "How many follow-ups are overdue, and whose?", metric: "M31" },
  { id: "sla", q: "Are we answering new leads within 2 business hours?", metric: "M14" },
  { id: "district_pipeline", q: "Which districts hold the most open pipeline?", metric: "M34 · M54" },
  { id: "win_rate", q: "What is our win rate over the last 90 days?", metric: "M37" },
  { id: "cost_per_demo", q: "Which campaign books demos cheapest?", metric: "M11" },
];

export type Answer = {
  question: string; qid?: QId; refused?: string; metric?: string; headline?: string;
  table?: { cols: string[]; rows: (string | number)[][]; numeric: boolean[] };
  filters?: string[]; sources?: string[]; scopeNote?: string;
};
export type AskData = { role: Role; uid: string; now: string; leads: Lead[]; deals: Deal[]; tasks: Task[]; accounts: Account[]; team: TeamMember[]; campaigns: Campaign[]; days: CampaignDay[] };

const LEGAL = /\b(bail|petition|judg(e)?ment|legal (advice|opinion)|section \d+|ipc|crpc|cpc|limitation period|can i sue|my case)\b/i;
export function matchQuestion(text: string): QId | "legal" | null {
  const t = text.toLowerCase();
  if (LEGAL.test(t)) return "legal";
  if (/overdue|follow.?up/.test(t)) return "overdue";
  if (/demo/.test(t) && /week|today|booked|scheduled/.test(t)) return "demos_week";
  if (/cost per demo|cheap|cpl|cost per lead|campaign/.test(t)) return "cost_per_demo";
  if (/sla|first.?response|respond|answer(ing)? new/.test(t)) return "sla";
  if (/district|pipeline|where/.test(t)) return "district_pipeline";
  if (/win rate|won|winning|close rate/.test(t)) return "win_rate";
  return null;
}

const DAY = 86400e3;
export function answer(qid: QId, d: AskData, question?: string): Answer {
  const rep = d.role === "sales_rep";
  const scopeNote = rep ? "Ran under your role: Sales Rep sees own leads, deals and tasks only." : `Ran under your role with workspace-wide access.`;
  const nowMs = new Date(d.now).getTime();
  const nameOf = (id: string) => d.team.find((t) => t.id === id)?.name ?? "Unassigned";
  const meta = QUESTIONS.find((x) => x.id === qid)!;
  const base = { question: question ?? meta.q, qid, metric: meta.metric, scopeNote };

  switch (qid) {
    case "demos_week": {
      const today = dayKey(d.now); const d0 = new Date(today + "T00:00:00Z"); const dow = (d0.getUTCDay() + 6) % 7;
      const week = Array.from({ length: 6 }, (_, i) => new Date(d0.getTime() + (i - dow) * DAY).toISOString().slice(0, 10));
      const demos = d.tasks.filter((t) => t.kind === "demo" && week.includes(dayKey(t.dueAt)));
      const left = demos.filter((t) => dayKey(t.dueAt) >= today).length;
      return { ...base, headline: `${demos.length} demos are booked Monday to Saturday this week; ${left} are still ahead.`,
        table: { cols: ["Day", "Demos"], numeric: [false, true], rows: week.map((w) => [`${fmtWeekday(w + "T06:00:00Z")} ${Number(w.slice(8))}`, demos.filter((t) => dayKey(t.dueAt) === w).length]) },
        filters: ["kind = demo", "this ISO week, Mon–Sat, IST"], sources: ["tasks", "activities (meeting_type = demo)"] };
    }
    case "overdue": {
      const od = d.tasks.filter((t) => t.status === "open" && new Date(t.dueAt).getTime() < nowMs && dayKey(t.dueAt) < dayKey(d.now));
      const by = [...new Set(od.map((t) => t.ownerId))].map((o) => { const xs = od.filter((t) => t.ownerId === o); const oldest = Math.max(...xs.map((t) => Math.ceil((nowMs - new Date(t.dueAt).getTime()) / DAY))); return [nameOf(o), xs.length, `${oldest} d`] as (string | number)[]; })
        .sort((a, b) => Number(b[1]) - Number(a[1]));
      return { ...base, headline: od.length ? `${od.length} follow-ups are overdue${rep ? " in your list" : ""}; ${by[0]?.[0]} has the most (${by[0]?.[1]}).` : "No follow-ups are overdue.",
        table: { cols: ["Owner", "Overdue", "Oldest"], numeric: [false, true, true], rows: by }, filters: ["status = open", "due before today, IST"], sources: ["tasks"] };
    }
    case "sla": {
      const l30 = d.leads.filter((l) => nowMs - new Date(l.createdAt).getTime() < 30 * DAY);
      const s = slaStats(l30, d.now);
      const owners = [...new Set(l30.map((l) => l.ownerId))];
      const rows = owners.map((o) => { const x = slaStats(l30.filter((l) => l.ownerId === o), d.now); return [nameOf(o), x.n, pct(x.within, 0), Number.isFinite(x.median) ? minsToHuman(x.median) : "—"] as (string | number)[]; });
      return { ...base, headline: `${pct(s.within, 0)} of ${s.n} new leads in the last 30 days got a first response within 2 business hours (median ${minsToHuman(s.median)}). ${s.breached} breached.`,
        table: { cols: ["Owner", "Leads", "Within SLA", "Median"], numeric: [false, true, true, true], rows }, filters: ["created in last 30 days", "business hours 10:00–19:00 IST, Mon–Sat", "SLA 120 min"], sources: ["leads", "tenants.sla_first_response_mins"] };
    }
    case "district_pipeline": {
      const open = d.deals.filter((x) => x.stage !== "won" && x.stage !== "lost");
      const m = new Map<string, { v: number; n: number }>();
      for (const x of open) { const dist = d.accounts.find((a) => a.id === x.accountId)?.district ?? "Unknown"; const c = m.get(dist) ?? { v: 0, n: 0 }; c.v += x.value; c.n++; m.set(dist, c); }
      const rows = [...m.entries()].sort((a, b) => b[1].v - a[1].v);
      const tot = open.reduce((s, x) => s + x.value, 0);
      return { ...base, headline: rows.length ? `${rows[0][0]} holds ${inrCompact(rows[0][1].v)} of ${inrCompact(tot)} open pipeline (${pct(ratio(rows[0][1].v, tot), 0)}).` : "There is no open pipeline yet.",
        table: { cols: ["District", "Open deals", "Value"], numeric: [false, true, true], rows: rows.map(([k, v]) => [k, v.n, inr(v.v)]) }, filters: ["stage not in (won, lost)", "grouped by accounts.district"], sources: ["deals", "accounts"] };
    }
    case "win_rate": {
      const closed = d.deals.filter((x) => (x.stage === "won" || x.stage === "lost") && nowMs - new Date(x.stageEnteredAt).getTime() < 90 * DAY);
      const won = closed.filter((x) => x.stage === "won");
      const owners = [...new Set(closed.map((x) => x.ownerId))];
      return { ...base, headline: closed.length ? `Win rate is ${pct(ratio(won.length, closed.length), 0)}: ${won.length} won of ${closed.length} closed in the last 90 days (${inrCompact(won.reduce((s, x) => s + x.value, 0))} booked).${closed.length < 20 ? " Low n: read with care." : ""}` : "No deals closed in the last 90 days.",
        table: { cols: ["Owner", "Won", "Lost", "Win rate"], numeric: [false, true, true, true], rows: owners.map((o) => { const c = closed.filter((x) => x.ownerId === o); const w = c.filter((x) => x.stage === "won").length; return [nameOf(o), w, c.length - w, pct(ratio(w, c.length), 0)]; }) },
        filters: ["closed in last 90 days", "won / (won + lost)"], sources: ["deals"] };
    }
    case "cost_per_demo": {
      if (!accessFor(d.role, "/campaigns")) return { question: question ?? meta.q, qid, refused: "Your role cannot read campaign metrics, so this question was not run. Ask Marketing or your Owner." };
      const stats = d.campaigns.map((c) => campaignStats(c, d.days, d.leads, d.deals)).filter((s) => s.demos > 0 && s.spend > 0).sort((a, b) => a.costPerDemo - b.costPerDemo);
      return { ...base, headline: stats.length ? `${stats[0].name} books demos cheapest at ${inr(stats[0].costPerDemo)} per demo (${stats[0].demos} demos from ${inrCompact(stats[0].spend)}).` : "No campaign has booked a demo yet.",
        table: { cols: ["Campaign", "Spend", "Demos", "Cost per demo"], numeric: [false, true, true, true], rows: stats.slice(0, 6).map((s) => [s.name.split(" — ")[0], inrCompact(s.spend), num(s.demos), inr(s.costPerDemo)]) },
        filters: ["last 90 days", "first-touch attribution", "campaigns with spend > 0"], sources: ["campaign_daily_metrics", "leads", "deal_stage_history"] };
    }
  }
}

export function ask(text: string, qid: QId | null, d: AskData): Answer {
  const id = qid ?? matchQuestion(text);
  if (id === "legal") return { question: text, refused: "This looks like a legal question. The CRM answers sales and marketing metrics only and never gives legal advice." };
  if (!id) return { question: text, refused: "That question does not map to an approved metric, so nothing was run. Pick one of the suggested questions or ask about demos, follow-ups, response time, pipeline by district, win rate or cost per demo." };
  return answer(id, d, qid ? undefined : text);
}
