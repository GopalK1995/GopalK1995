// Supabase implementation of LinkedInStore on the SERVICE-ROLE client (scheduled jobs are sanctioned users of serviceDb, CONTRACTS C6).
// RLS does not protect this path, so every query is explicitly scoped by tenant_id / workspace_id / integration id.
// Needs docs/migrations-backlog.md "T044 needs" (linkedin_assets). Ad account details reuse `ad_accounts` (platform linkedin), campaigns reuse
// `campaigns` (external_ids->>'linkedin'), metrics reuse campaign_daily_metrics (0019 columns integration_id, external_campaign_id).
import "server-only";
import type { Db } from "@/lib/db/client";
import { from, type Qb } from "@/lib/db/query";
import { emitEvent } from "@/lib/events/emit";
import type { LinkedInStore } from "./store";

type R = Record<string, unknown>;
const failed = (what: string) => new Error(`linkedin store: ${what} failed`);   // PostgREST text can quote values: not echoed
const CHUNK = 200;
const PLATFORM = "linkedin_ad_account";

export function supabaseLinkedInStore(db: Db): LinkedInStore {
  const q = (t: string) => from(db, t);
  const rows = async (b: Qb, what: string): Promise<R[]> => { const { data, error } = await b; if (error) throw failed(what); return (data as R[] | null) ?? []; };

  return {
    async registerAccount(a) {
      const hit = (await rows(q("linkedin_assets").select("id, workspace_id, integration_id").eq("platform", PLATFORM).eq("external_id", a.accountId).limit(1), "asset lookup"))[0];
      const row = { tenant_id: a.tenantId, workspace_id: a.workspaceId, integration_id: a.connectionId, platform: PLATFORM, external_id: a.accountId, name: a.name ?? null, updated_at: new Date().toISOString() };
      if (hit) {
        if (hit.workspace_id !== a.workspaceId) {
          const owner = hit.integration_id ? (await rows(q("integrations").select("status").eq("id", hit.integration_id).limit(1), "owner lookup"))[0] : undefined;
          if (owner && owner.status !== "disconnected") return { ok: false, reason: "account_taken" };   // a disconnected owner releases it
        }
        await rows(q("linkedin_assets").update(row).eq("id", hit.id).select("id"), "asset update");
      } else {
        const { error } = await q("linkedin_assets").insert(row).select("id");
        if (error) { if (error.code === "23505") return { ok: false, reason: "account_taken" }; throw failed("asset insert"); }
      }
      // A re-selection drops what this connection used to own.
      for (const old of await rows(q("linkedin_assets").select("id, external_id").eq("integration_id", a.connectionId), "asset list")) if (String(old.external_id) !== a.accountId) await rows(q("linkedin_assets").update({ integration_id: null }).eq("id", old.id).select("id"), "asset drop");
      const own = (await rows(q("ad_accounts").select("id").eq("workspace_id", a.workspaceId).eq("platform", "linkedin").eq("external_id", a.accountId).limit(1), "ad account lookup"))[0];
      const adRow = { integration_id: a.connectionId, name: a.name ?? null, ...(a.currency && /^[A-Z]{3}$/.test(a.currency) ? { currency: a.currency } : {}), updated_at: new Date().toISOString() };
      if (own) await rows(q("ad_accounts").update(adRow).eq("id", own.id).select("id"), "ad account update");
      else await rows(q("ad_accounts").insert({ ...adRow, tenant_id: a.tenantId, workspace_id: a.workspaceId, platform: "linkedin", external_id: a.accountId }).select("id"), "ad account insert");
      return { ok: true };
    },

    async ensureCampaign(i) {
      const find = async () => (await rows(q("campaigns").select("id, name").eq("workspace_id", i.workspaceId).eq("external_ids->>linkedin", i.externalId).limit(1), "campaign lookup"))[0];
      const hit = await find();
      if (hit) {
        // A real name replaces the stand-in a lead created before the first analytics run.
        if (!i.placeholder && String(hit.name).startsWith("LinkedIn campaign ") && hit.name !== i.name) await rows(q("campaigns").update({ name: i.name.slice(0, 200) }).eq("id", hit.id).select("id"), "campaign rename");
        return String(hit.id);
      }
      const ins = await q("campaigns").insert({
        tenant_id: i.tenantId, workspace_id: i.workspaceId, name: i.name.slice(0, 200), channel: "linkedin", status: "active", utm_source: "linkedin", utm_medium: "paid_social",
        utm_campaign: `linkedin_${i.externalId}`, external_ids: { linkedin: i.externalId }, is_synthetic: i.synthetic,
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
    async recordConsentOnce(c) {
      const dup = await rows(q("consent_log").select("id").eq("lead_id", c.leadId).eq("purpose", c.purpose).eq("action", "granted").eq("note", c.note).limit(1), "consent read");
      if (dup.length) return false;
      const e = await rows(q("consent_log").select("subject_ref").eq("lead_id", c.leadId).limit(1), "consent read");
      await rows(q("consent_log").insert({ tenant_id: c.tenantId, workspace_id: c.workspaceId, lead_id: c.leadId, subject_ref: e[0] ? String(e[0].subject_ref) : c.subjectRef, purpose: c.purpose, action: "granted", notice_version: c.noticeVersion, captured_via: "integration", note: c.note }).select("id"), "consent insert");
      return true;
    },
    async emit(e) {
      try { await emitEvent({ type: e.type, objectType: e.objectType, objectId: e.objectId, workspaceId: e.workspaceId, data: e.data }, db); }
      catch { /* best effort: row-change triggers already audit the write; an event failure must not undo or retry it */ }
    },
  };
}
