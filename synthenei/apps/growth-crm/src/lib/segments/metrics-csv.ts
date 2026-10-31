// Simple daily-metrics CSV: parse + PREVIEW only. The full import engine (storage, queue, mapping UI, dedupe) is T034; this
// validates a small platform export against the workspace's campaigns so the user sees what would be written before it is.
export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 5000;

const ALIASES: Record<string, string> = {
  date: "day", day: "day", "reporting starts": "day",
  utm_campaign: "campaign", campaign: "campaign", "campaign name": "campaign", campaign_name: "campaign",
  spend: "spend", cost: "spend", "amount spent": "spend", "amount spent (inr)": "spend", spend_inr: "spend",
  impressions: "impressions", delivered: "impressions", reach: "reach", clicks: "clicks", "link clicks": "clicks",
  reactions: "reactions", comments: "comments", shares: "shares", opens: "opens", bounces: "bounces",
  unsubscribes: "unsubscribes", leads: "platform_leads", "platform leads": "platform_leads", platform_leads: "platform_leads", conversions: "platform_leads",
};
const CAMEL: Record<string, keyof MetricRow> = { impressions: "impressions", reach: "reach", clicks: "clicks", reactions: "reactions", comments: "comments", shares: "shares", opens: "opens", bounces: "bounces", unsubscribes: "unsubscribes", platform_leads: "platformLeads" };

/** RFC 4180-style: quoted fields, doubled quotes, CRLF or LF. Blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const src = text.replace(/^﻿/, "");
  const endRow = () => { row.push(cell); cell = ""; if (row.some((c) => c.trim() !== "")) rows.push(row); row = []; };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && src[i + 1] === "\n") i++; endRow(); }
    else cell += ch;
  }
  endRow();
  return rows;
}

export interface MetricRow { campaignId: string; day: string; spend: number; impressions: number; reach: number; clicks: number; reactions: number; comments: number; shares: number; opens: number; bounces: number; unsubscribes: number; platformLeads: number }
export type RowIssueReason = "bad_date" | "future_date" | "unknown_campaign" | "bad_number" | "negative" | "duplicate_day" | "missing_campaign";
export interface RowIssue { line: number; reason: RowIssueReason }
export interface MetricsPreview { mapping: { column: string; field: string | null }[]; accepted: MetricRow[]; rejected: RowIssue[]; totalRows: number; missingRequired: string[]; totalSpend: number }
export type CampaignRef = { id: string; name: string; utmCampaign: string };

const isoDay = (s: string): string | null => {
  const t = s.trim();
  let y: number, m: number, d: number;
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const b = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(t);
  if (a) { y = +a[1]; m = +a[2]; d = +a[3]; } else if (b) { y = +b[3]; m = +b[2]; d = +b[1]; } else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};
const num = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === "") return 0;
  const n = Number(s.replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** `fixedCampaignId` = preview launched from a campaign page: every row belongs to it and the campaign column is optional. */
export function previewMetricsCsv(text: string, campaigns: CampaignRef[], today: string, fixedCampaignId?: string): MetricsPreview {
  const rows = parseCsv(text);
  const head = rows[0] ?? [];
  const mapping = head.map((c) => ({ column: c.trim(), field: ALIASES[c.trim().toLowerCase()] ?? null }));
  const col = (f: string) => mapping.findIndex((m) => m.field === f);
  const missingRequired = [col("day") < 0 ? "date" : "", !fixedCampaignId && col("campaign") < 0 ? "campaign" : "", col("spend") < 0 ? "spend" : ""].filter(Boolean);
  const out: MetricsPreview = { mapping, accepted: [], rejected: [], totalRows: Math.max(0, rows.length - 1), missingRequired, totalSpend: 0 };
  if (missingRequired.length) return out;
  const byKey = new Map<string, CampaignRef>();
  for (const c of campaigns) { byKey.set(c.utmCampaign.toLowerCase(), c); byKey.set(c.name.toLowerCase(), c); }
  const seen = new Set<string>();
  rows.slice(1).forEach((cells, idx) => {
    const line = idx + 2;
    const bad = (reason: RowIssueReason) => { out.rejected.push({ line, reason }); };
    const day = isoDay(cells[col("day")] ?? "");
    if (!day) return bad("bad_date");
    if (day > today) return bad("future_date");
    let camp: CampaignRef | undefined;
    if (fixedCampaignId) camp = campaigns.find((c) => c.id === fixedCampaignId);
    else {
      const key = (cells[col("campaign")] ?? "").trim().toLowerCase();
      if (!key) return bad("missing_campaign");
      camp = byKey.get(key);
    }
    if (!camp) return bad("unknown_campaign");
    const m: MetricRow = { campaignId: camp.id, day, spend: 0, impressions: 0, reach: 0, clicks: 0, reactions: 0, comments: 0, shares: 0, opens: 0, bounces: 0, unsubscribes: 0, platformLeads: 0 };
    for (const [i, { field }] of mapping.entries()) {
      if (!field || field === "day" || field === "campaign") continue;
      const n = num(cells[i]);
      if (n === null) return bad("bad_number");
      if (n < 0) return bad("negative");
      if (field === "spend") m.spend = Math.round(n * 100) / 100;
      else m[CAMEL[field]] = Math.round(n) as never;
    }
    const k = `${camp.id}|${day}`;
    if (seen.has(k)) return bad("duplicate_day");
    seen.add(k);
    out.accepted.push(m);
  });
  out.totalSpend = out.accepted.reduce((a, r) => a + Math.round(r.spend * 100), 0) / 100;
  return out;
}
