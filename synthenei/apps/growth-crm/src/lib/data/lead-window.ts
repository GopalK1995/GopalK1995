// ONE definition of "new leads in a window" (AUD-091 / UXA-007), used by Home, Campaigns, Analytics and Sales.
// Window = the last N IST calendar days INCLUDING today (so "30 days" = today and the 29 days before it), counted by
// lead created time. Scope "all" counts every lead; "campaign" counts only leads attributed to a campaign. A page must
// say which scope and window it shows; the labels below are the only wording to use for it.
import type { Lead } from "./types";

const DAY_MS = 86400e3, IST_MS = 330 * 60e3;
export type LeadScope = "all" | "campaign";
export interface LeadWindow { days: number; offsetDays?: number; scope?: LeadScope }

/** Start (inclusive) and end (exclusive) of the window in epoch ms. offsetDays shifts the window back (prior period). */
export function windowBounds(nowIso: string, days: number, offsetDays = 0): { startMs: number; endMs: number } {
  const istDayStart = Math.floor((new Date(nowIso).getTime() + IST_MS) / DAY_MS) * DAY_MS - IST_MS; // IST midnight today, in UTC ms
  const endMs = istDayStart + DAY_MS - offsetDays * DAY_MS;
  return { startMs: endMs - days * DAY_MS, endMs };
}

export function leadsInWindow<T extends Pick<Lead, "createdAt" | "campaignId">>(leads: T[], nowIso: string, w: LeadWindow): T[] {
  const { startMs, endMs } = windowBounds(nowIso, w.days, w.offsetDays ?? 0);
  return leads.filter((l) => {
    if (w.scope === "campaign" && !l.campaignId) return false;
    const t = new Date(l.createdAt).getTime();
    return t >= startMs && t < endMs;
  });
}

export const newLeadsInWindow = (leads: Pick<Lead, "createdAt" | "campaignId">[], nowIso: string, w: LeadWindow) => leadsInWindow(leads, nowIso, w).length;

/** UI wording, e.g. "Last 90 days (IST) · all leads". */
export function windowLabel(days: number, scope: LeadScope = "all"): string {
  return `Last ${days} days (IST) · ${scope === "campaign" ? "campaign-attributed leads" : "all leads"}`;
}
