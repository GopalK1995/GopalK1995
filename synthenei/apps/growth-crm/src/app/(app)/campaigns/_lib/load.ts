// Campaign reads for the pages. Demo sessions read the showcase data source unchanged. Real sessions read the repositories
// (request client, RLS) and map DB rows to the Campaign / CampaignDay shapes the screens already use.
import { campaignsRepo } from "@/lib/db/repo/campaigns";
import type { CampaignRow } from "@/lib/db/repo/types";
import { metricsRepo, type DayRow } from "@/lib/segments/repo";
import type { Campaign, CampaignDay } from "@/lib/data/types";
import type { pageCtx } from "@/lib/data/context";

type Ctx = Awaited<ReturnType<typeof pageCtx>>;
export type CampaignView = Campaign & { version?: number; notes?: string | null; segmentId?: string | null };

const STATUS: Record<string, Campaign["status"]> = { active: "live", draft: "paused", paused: "paused", ended: "ended", archived: "ended" };
export const toCampaign = (r: CampaignRow, source: Campaign["dataSource"] = "csv"): CampaignView => ({
  id: r.id, name: r.name, channel: r.channel as Campaign["channel"], status: STATUS[r.status] ?? "paused", objective: r.objective ?? "",
  startDate: r.startsOn ?? r.createdAt.slice(0, 10), endDate: r.endsOn, budget: Number(r.budgetInr ?? 0), audience: "", audienceSize: 0,
  creative: { format: "", headline: "", body: "", cta: "" }, utmCampaign: r.utmCampaign, ownerId: r.ownerId ?? "", dataSource: source,
  version: r.version, notes: r.notes, segmentId: r.segmentId,
});
export const toDay = (d: DayRow): CampaignDay => ({
  campaignId: d.campaignId, date: d.day, spend: Number(d.spend), impressions: d.impressions, reach: d.reach, clicks: d.clicks,
  platformLeads: d.platformLeads, engagements: d.reactions + d.comments + d.shares,
});

export async function loadCampaigns(c: Ctx): Promise<CampaignView[]> {
  if (c.session.demo) return c.ds.campaigns();
  return (await campaignsRepo.list(c.active.ws.uuid, { limit: 200 })).rows.map((r) => toCampaign(r));
}
export async function loadCampaign(c: Ctx, id: string): Promise<CampaignView | null> {
  if (c.session.demo) return c.ds.campaign(id);
  const r = await campaignsRepo.get(c.active.ws.uuid, id);
  return r ? toCampaign(r) : null;
}
export async function loadDays(c: Ctx): Promise<CampaignDay[]> {
  if (c.session.demo) return c.ds.campaignDays();
  return (await metricsRepo.listAll(c.active.ws.uuid)).map(toDay);
}
