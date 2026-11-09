// Supabase implementation of AdsStore on the SERVICE-ROLE client (scheduled jobs are sanctioned users of serviceDb, CONTRACTS C6).
// RLS does not protect this path, so every query is explicitly scoped by tenant_id / workspace_id / integration id.
// Metrics reuse campaign_daily_metrics (0019 columns integration_id, external_campaign_id); campaigns reuse `campaigns`
// (channel google_ads, external_ids->>'google_ads'). No migration is needed.
import "server-only";
import type { Db } from "@/lib/db/client";
import { from, type Qb } from "@/lib/db/query";
import type { AdsStore } from "./store";

type R = Record<string, unknown>;
const failed = (what: string) => new Error(`ads store: ${what} failed`);   // PostgREST text can quote values: not echoed
const CHUNK = 200;

export function supabaseAdsStore(db: Db): AdsStore {
  const q = (t: string) => from(db, t);
  const rows = async (b: Qb, what: string): Promise<R[]> => { const { data, error } = await b; if (error) throw failed(what); return (data as R[] | null) ?? []; };
  return {
    async ensureCampaign(i) {
      const find = async () => (await rows(q("campaigns").select("id").eq("workspace_id", i.workspaceId).eq("external_ids->>google_ads", i.externalId).limit(1), "campaign lookup"))[0];
      const hit = await find();
      if (hit) return String(hit.id);
      const ins = await q("campaigns").insert({
        tenant_id: i.tenantId, workspace_id: i.workspaceId, name: i.name.slice(0, 200), channel: "google_ads", status: "active", utm_source: "google", utm_medium: "cpc",
        utm_campaign: `google_ads_${i.externalId}`, external_ids: { google_ads: i.externalId }, is_synthetic: i.synthetic,
      }).select("id");
      if (ins.error) { const again = ins.error.code === "23505" ? await find() : undefined; if (again) return String(again.id); throw failed("campaign insert"); }
      const id = ((ins.data as R[] | null) ?? [])[0]?.id;
      if (!id) throw failed("campaign insert");
      return String(id);
    },
    async upsertDailyMetrics(metrics, ctx) {
      const now = new Date().toISOString();
      const data = metrics.map((m) => ({
        tenant_id: ctx.tenantId, workspace_id: ctx.workspaceId, campaign_id: m.campaignId, day: m.day, spend_inr: m.spendInr, impressions: m.impressions, clicks: m.clicks,
        platform_leads: m.platformLeads, source: ctx.source, integration_id: ctx.connectionId, external_campaign_id: m.externalCampaignId, imported_at: now,
      }));
      type Upsertable = { from(t: string): { upsert(v: R[], o: { onConflict: string }): PromiseLike<{ error: { code?: string } | null }> } };
      for (let i = 0; i < data.length; i += CHUNK) {
        const { error } = await (db as unknown as Upsertable).from("campaign_daily_metrics").upsert(data.slice(i, i + CHUNK), { onConflict: "campaign_id,day" });
        if (error) throw failed("metrics upsert");
      }
    },
  };
}
