// Real-mode persistence for campaigns, daily metrics and segments. Pure over injected repositories (unit-testable with mocks).
// assertCan runs in the server actions BEFORE any of these. Campaign audit rows and campaign.* events come from DB triggers
// (0014); audience_segments has a version trigger but no audit trigger yet (see report: Needs from integrator).
import { okResult, type ActionResult } from "@/lib/actions/result";
import { DbError } from "@/lib/db/errors";
import type { CampaignInput, CampaignRow } from "@/lib/db/repo/types";
import { compileRules, normalizeRules, type CustomFieldRef, type SegmentRule } from "./compile";
import type { MetricRow } from "./metrics-csv";
import type { SegmentInput, SegmentRow } from "./repo";
import type { CreateCampaignInput, MetricsRowInput } from "./schemas";

export interface Repos {
  campaigns: {
    create(ws: string, input: CampaignInput): Promise<CampaignRow>;
    update(ws: string, id: string, v: number, patch: Partial<CampaignInput> & Record<string, unknown>): Promise<CampaignRow>;
  };
  segments: {
    create(ws: string, input: SegmentInput): Promise<SegmentRow>;
    update(ws: string, id: string, v: number, patch: Partial<SegmentInput> & Record<string, unknown>): Promise<SegmentRow>;
  };
  metrics: { upsertDays(ws: string, rows: MetricRow[], source: "manual" | "csv"): Promise<number> };
}
export interface Ctx { ws: string; uid: string; now: Date; repos: Repos; custom?: readonly CustomFieldRef[] }

const CH_ABBR: Record<string, string> = { linkedin: "li", whatsapp: "wa", email: "em", meta: "meta", google_ads: "gads", referral: "ref" };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_|_$)/g, "");
const CHANNEL_MEDIUM: Record<string, string> = { linkedin: "paid_social", meta: "paid_social", google_ads: "cpc", whatsapp: "messaging", email: "email", referral: "referral" };

/** {channel}_{district|statewide}_{theme}_{yyyymm}; the utm is generated server side so attribution never depends on the browser. */
export function utmFor(i: { channel: string; district: string; theme: string }, now: Date): string {
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${CH_ABBR[i.channel] ?? slug(i.channel)}_${slug(i.district) || "statewide"}_${slug(i.theme) || "theme"}_${ym}`;
}

export async function createCampaign(c: Ctx, i: CreateCampaignInput, msg: { created: (name: string) => string }): Promise<ActionResult<{ id: string; version: number; utmCampaign: string }>> {
  const base = utmFor(i, c.now);
  for (let n = 1; n <= 3; n++) {
    const utm = n === 1 ? base : `${base}_${n}`;
    try {
      const row = await c.repos.campaigns.create(c.ws, {
        name: i.name, channel: i.channel, status: "draft", objective: i.objective ?? null, utmSource: i.channel, utmMedium: CHANNEL_MEDIUM[i.channel] ?? "other",
        utmCampaign: utm, budgetInr: i.budget, startsOn: i.startsOn ?? null, endsOn: i.endsOn ?? null, segmentId: i.segmentId ?? null, ownerId: c.uid,
      } as CampaignInput);
      return okResult(msg.created(row.name), { data: { id: row.id, version: row.version, utmCampaign: utm } });
    } catch (e) {
      if (!(e instanceof DbError && e.code === "unique") || n === 3) throw e;
    }
  }
  throw new DbError("error", "unreachable");
}

export async function editCampaign(c: Ctx, id: string, v: number, p: { name?: string; objective?: string | null; budget?: number; startsOn?: string | null; endsOn?: string | null; ownerId?: string | null; segmentId?: string | null }, msg: { saved: string }): Promise<ActionResult<{ version: number }>> {
  const patch: Record<string, unknown> = { name: p.name, objective: p.objective, budgetInr: p.budget, startsOn: p.startsOn, endsOn: p.endsOn, ownerId: p.ownerId, segmentId: p.segmentId };
  const row = await c.repos.campaigns.update(c.ws, id, v, patch);
  return okResult(msg.saved, { data: { version: row.version } });
}

/** Status only: the ad platform is never touched from here. */
export async function setStatus(c: Ctx, id: string, v: number, status: "active" | "paused" | "archived", msg: string): Promise<ActionResult<{ version: number }>> {
  const row = await c.repos.campaigns.update(c.ws, id, v, { status });
  return okResult(msg, { data: { version: row.version } });
}

export async function addNote(c: Ctx, cur: CampaignRow, v: number, note: string, msg: { saved: string }): Promise<ActionResult<{ version: number }>> {
  const stamp = c.now.toISOString().slice(0, 10);
  const next = [cur.notes?.trim(), `${stamp}: ${note}`].filter(Boolean).join("\n");
  const row = await c.repos.campaigns.update(c.ws, cur.id, v, { notes: next });
  return okResult(msg.saved, { data: { version: row.version } });
}

export async function saveMetricsDay(c: Ctx, campaignId: string, r: MetricsRowInput, msg: { saved: (day: string) => string }): Promise<ActionResult> {
  await c.repos.metrics.upsertDays(c.ws, [{ campaignId, ...r }], "manual");
  return okResult(msg.saved(r.day));
}

export async function importMetrics(c: Ctx, rows: MetricRow[], msg: { done: (n: number) => string }): Promise<ActionResult<{ written: number }>> {
  const written = await c.repos.metrics.upsertDays(c.ws, rows, "csv");
  return okResult(msg.done(written), { data: { written } });
}

export type SegCompileFail = { ok: false; issues: { path: string; message: string }[] };
export function prepareRules(c: Ctx, rules: unknown): { ok: true; rules: SegmentRule[] } | SegCompileFail {
  const r = compileRules(rules, c.custom);
  return r.ok ? { ok: true, rules: normalizeRules(r.filters) } : { ok: false, issues: r.errors.map((e) => ({ path: e.path, message: e.message })) };
}

export async function createSegment(c: Ctx, i: { name: string; rules: SegmentRule[]; isIcp?: boolean }, msg: { saved: (n: string) => string }): Promise<ActionResult<{ id: string; version: number }>> {
  const row = await c.repos.segments.create(c.ws, { name: i.name, rules: i.rules, isIcp: i.isIcp ?? false, createdBy: c.uid });
  return okResult(msg.saved(row.name), { data: { id: row.id, version: row.version } });
}
export async function updateSegment(c: Ctx, id: string, v: number, i: { name: string; rules: SegmentRule[]; isIcp?: boolean }, msg: { saved: (n: string) => string }): Promise<ActionResult<{ version: number }>> {
  const row = await c.repos.segments.update(c.ws, id, v, { name: i.name, rules: i.rules, isIcp: i.isIcp });
  return okResult(msg.saved(row.name), { data: { version: row.version } });
}

/** CSV cell with spreadsheet-formula neutralisation (=, +, -, @, tab, CR) and RFC 4180 quoting. */
export const csvCell = (v: unknown): string => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (head: string[], rows: unknown[][]): string => [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
