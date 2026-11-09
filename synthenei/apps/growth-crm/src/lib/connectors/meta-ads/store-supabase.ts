// Supabase implementation of MetaStore on the SERVICE-ROLE client (inbound webhooks and jobs are sanctioned users of serviceDb,
// CONTRACTS C6). RLS does not protect this path, so every query is explicitly scoped by tenant_id / workspace_id / integration id.
// Needs docs/migrations-backlog.md "T036 needs" (meta_assets). Optional message columns from "T035 needs" are written when present.
import "server-only";
import type { Db } from "@/lib/db/client";
import { from, type Qb } from "@/lib/db/query";
import { emitEvent } from "@/lib/events/emit";
import type { ConsentEntry, ConversationRef, DailyMetricRow, InsertResult, MetaStore, NewInboundMessage, OutboundPatch, OutboundRow, AssetRegistration, RegisterResult } from "./store";

type R = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const failed = (what: string) => new Error(`meta store: ${what} failed`);   // PostgREST text can quote values: not echoed
const MISSING_COLUMN = new Set(["PGRST204", "42703"]);
const CHUNK = 200;

export function supabaseMetaStore(db: Db): MetaStore {
  const q = (t: string) => from(db, t);
  const rows = async (b: Qb, what: string): Promise<R[]> => { const { data, error } = await b; if (error) throw failed(what); return (data as R[] | null) ?? []; };
  async function tolerant(what: string, op: (extra: R) => Qb, optional: R): Promise<R[]> {
    const first = await op(optional);
    if (!first.error) return (first.data as R[] | null) ?? [];
    if (!MISSING_COLUMN.has(String(first.error.code ?? "")) || !Object.keys(optional).length) throw failed(what);
    return rows(op({}), what);
  }

  /** True when another workspace owns this asset through a live connection (a disconnected owner releases it). */
  async function ownedElsewhere(platform: string, externalId: string, workspaceId: string): Promise<{ rowId: string } | "taken" | null> {
    const hit = (await rows(q("meta_assets").select("id, workspace_id, integration_id").eq("platform", platform).eq("external_id", externalId).limit(1), "asset lookup"))[0];
    if (!hit) return null;
    if (hit.workspace_id === workspaceId) return { rowId: String(hit.id) };
    const owner = hit.integration_id ? (await rows(q("integrations").select("status").eq("id", hit.integration_id).limit(1), "owner lookup"))[0] : undefined;
    if (owner && owner.status !== "disconnected") return "taken";
    await rows(q("meta_assets").update({ integration_id: null, workspace_id: workspaceId }).eq("id", hit.id).select("id"), "asset release");   // takeover of a released asset
    return { rowId: String(hit.id) };
  }

  return {
    async registerAssets(a: AssetRegistration): Promise<RegisterResult> {
      const wanted = [{ platform: "facebook_page", id: a.pageId, name: a.pageName ?? null }, ...(a.igUserId ? [{ platform: "instagram", id: a.igUserId, name: a.igUsername ?? null }] : [])];
      const found: Record<string, string | null> = {};
      for (const w of wanted) {
        const r = await ownedElsewhere(w.platform, w.id, a.workspaceId);
        if (r === "taken") return { ok: false, reason: w.platform === "instagram" ? "ig_taken" : "page_taken" };
        found[w.platform] = r ? r.rowId : null;
      }
      for (const w of wanted) {
        const row = { tenant_id: a.tenantId, workspace_id: a.workspaceId, integration_id: a.connectionId, platform: w.platform, external_id: w.id, name: w.name, updated_at: new Date().toISOString() };
        if (found[w.platform]) await rows(q("meta_assets").update(row).eq("id", found[w.platform]).select("id"), "asset update");
        else {
          const { error } = await q("meta_assets").insert(row).select("id");
          if (error) { if (error.code === "23505") return { ok: false, reason: w.platform === "instagram" ? "ig_taken" : "page_taken" }; throw failed("asset insert"); }
        }
      }
      // A re-selection drops what this connection used to own.
      const keep = wanted.map((w) => w.id);
      for (const old of await rows(q("meta_assets").select("id, external_id").eq("integration_id", a.connectionId), "asset list")) if (!keep.includes(String(old.external_id))) await rows(q("meta_assets").update({ integration_id: null }).eq("id", old.id).select("id"), "asset drop");
      if (a.adAccountId) {
        const own = (await rows(q("ad_accounts").select("id").eq("workspace_id", a.workspaceId).eq("platform", "meta").eq("external_id", a.adAccountId).limit(1), "ad account lookup"))[0];
        const row = { integration_id: a.connectionId, name: a.adAccountName ?? null, ...(a.currency && /^[A-Z]{3}$/.test(a.currency) ? { currency: a.currency } : {}), updated_at: new Date().toISOString() };
        if (own) await rows(q("ad_accounts").update(row).eq("id", own.id).select("id"), "ad account update");
        else await rows(q("ad_accounts").insert({ ...row, tenant_id: a.tenantId, workspace_id: a.workspaceId, platform: "meta", external_id: a.adAccountId }).select("id"), "ad account insert");
      }
      return { ok: true };
    },

    async ensureCampaign(i) {
      const find = async () => (await rows(q("campaigns").select("id").eq("workspace_id", i.workspaceId).eq("external_ids->>meta", i.externalId).limit(1), "campaign lookup"))[0];
      const hit = await find();
      if (hit) return String(hit.id);
      const ins = await q("campaigns").insert({
        tenant_id: i.tenantId, workspace_id: i.workspaceId, name: i.name.slice(0, 200), channel: "meta", status: "active", utm_source: "facebook", utm_medium: "paid_social",
        utm_campaign: `meta_${i.externalId}`, external_ids: { meta: i.externalId }, is_synthetic: i.synthetic,
      }).select("id");
      if (ins.error) { const again = ins.error.code === "23505" ? await find() : undefined; if (again) return String(again.id); throw failed("campaign insert"); }
      const id = ((ins.data as R[] | null) ?? [])[0]?.id;
      if (!id) throw failed("campaign insert");
      return String(id);
    },
    async upsertDailyMetrics(metrics: DailyMetricRow[], ctx) {
      const now = new Date().toISOString();
      const data = metrics.map((m) => ({
        tenant_id: ctx.tenantId, workspace_id: ctx.workspaceId, campaign_id: m.campaignId, day: m.day, spend_inr: m.spendInr, impressions: m.impressions, reach: m.reach, clicks: m.clicks,
        reactions: m.reactions, comments: m.comments, shares: m.shares, platform_leads: m.platformLeads, source: ctx.source, integration_id: ctx.connectionId, external_campaign_id: m.externalCampaignId, imported_at: now,
      }));
      type Upsertable = { from(t: string): { upsert(v: R[], o: { onConflict: string }): PromiseLike<{ error: { code?: string } | null }> } };
      for (let i = 0; i < data.length; i += CHUNK) {
        const { error } = await (db as unknown as Upsertable).from("campaign_daily_metrics").upsert(data.slice(i, i + CHUNK), { onConflict: "campaign_id,day" });
        if (error) throw failed("metrics upsert");
      }
    },
    async recordConsentOnce(c: ConsentEntry) {
      const dup = await rows(q("consent_log").select("id").eq("lead_id", c.leadId).eq("purpose", c.purpose).eq("action", "granted").eq("note", c.note).limit(1), "consent read");
      if (dup.length) return false;
      const e = await rows(q("consent_log").select("subject_ref").eq("lead_id", c.leadId).limit(1), "consent read");
      await rows(q("consent_log").insert({ tenant_id: c.tenantId, workspace_id: c.workspaceId, lead_id: c.leadId, subject_ref: e[0] ? String(e[0].subject_ref) : c.subjectRef, purpose: c.purpose, action: "granted", notice_version: c.noticeVersion, captured_via: "integration", note: c.note }).select("id"), "consent insert");
      return true;
    },

    async findMessageByExternalId(tenantId, externalId) {
      const r = await rows(q("messages").select("id, conversation_id").eq("tenant_id", tenantId).eq("external_id", externalId).limit(1), "message lookup");
      return r[0] ? { id: String(r[0].id), conversationId: String(r[0].conversation_id) } : null;
    },
    async upsertConversation(c): Promise<ConversationRef> {
      const found = await rows(q("conversations").select("id, lead_id, last_inbound_at, status").eq("workspace_id", c.workspaceId).eq("channel", "instagram").eq("external_thread_id", c.threadId).limit(1), "conversation lookup");
      const f = found[0];
      if (f) {
        let leadId = str(f.lead_id);
        if (!leadId && c.leadId) { await rows(q("conversations").update({ lead_id: c.leadId }).eq("id", f.id).select("id"), "conversation link"); leadId = c.leadId; }
        return { id: String(f.id), leadId, lastInboundAt: str(f.last_inbound_at), status: String(f.status), created: false };
      }
      const ins = await rows(q("conversations").insert({ tenant_id: c.tenantId, workspace_id: c.workspaceId, channel: "instagram", lead_id: c.leadId, external_thread_id: c.threadId, status: "open" }).select("id"), "conversation insert");
      if (!ins[0]) throw failed("conversation insert");
      return { id: String(ins[0].id), leadId: c.leadId, lastInboundAt: null, status: "open", created: true };
    },
    async insertInbound(m: NewInboundMessage): Promise<InsertResult> {
      const res = await q("messages").insert({ tenant_id: m.tenantId, workspace_id: m.workspaceId, conversation_id: m.conversationId, direction: "inbound", status: "received", body: m.body, external_id: m.mid, created_at: m.at, status_at: m.at }).select("id");
      if (res.error) { if (res.error.code === "23505") return { duplicate: true }; throw failed("message insert"); }
      const id = ((res.data as R[] | null) ?? [])[0]?.id;
      if (!id) throw failed("message insert");
      return { id: String(id) };
    },
    async touchInbound(conversationId, atIso, leadId) {
      const cur = (await rows(q("conversations").select("last_inbound_at, last_message_at, lead_id").eq("id", conversationId).limit(1), "conversation read"))[0];
      const later = (a: unknown) => !a || Date.parse(String(a)) < Date.parse(atIso);
      const patch: R = { status: "open" };
      if (later(cur?.last_inbound_at)) patch.last_inbound_at = atIso;
      if (later(cur?.last_message_at)) patch.last_message_at = atIso;
      if (!cur?.lead_id && leadId) patch.lead_id = leadId;
      await rows(q("conversations").update(patch).eq("id", conversationId).select("id"), "conversation touch");
    },
    async findLeadByIgsid(workspaceId, igsid) {
      const r = await rows(q("leads").select("id").eq("workspace_id", workspaceId).eq("external_ids->>instagram_igsid", igsid).is("deleted_at", null).limit(1), "lead lookup");
      return r[0] ? String(r[0].id) : null;
    },
    async createLead(row) { const r = await rows(q("leads").insert(row).select("id"), "lead insert"); if (!r[0]) throw failed("lead insert"); return String(r[0].id); },

    async getOutbound(id): Promise<OutboundRow | null> {
      const m = (await rows(q("messages").select("id, tenant_id, workspace_id, conversation_id, status, body, is_internal_note, direction").eq("id", id).limit(1), "message read"))[0];
      if (!m || m.direction !== "outbound") return null;
      const c = (await rows(q("conversations").select("channel, lead_id, external_thread_id, last_inbound_at").eq("id", m.conversation_id).limit(1), "conversation read"))[0];
      if (!c) return null;
      return { id: String(m.id), tenantId: String(m.tenant_id), workspaceId: String(m.workspace_id), conversationId: String(m.conversation_id), status: String(m.status), body: str(m.body), isInternalNote: m.is_internal_note === true, channel: String(c.channel), leadId: str(c.lead_id), threadId: str(c.external_thread_id), lastInboundAt: str(c.last_inbound_at) };
    },
    async listQueuedOutbound(workspaceId, limit) {
      const r = await rows(q("messages").select("id, conversations!inner(channel)").eq("workspace_id", workspaceId).eq("direction", "outbound").eq("status", "queued").eq("is_internal_note", false).eq("conversations.channel", "instagram").order("created_at", { ascending: true }).limit(limit), "queue read");
      return r.map((x) => String(x.id));
    },
    async patchOutbound(id, p: OutboundPatch) {
      const optional: R = { ...(p.errorCode !== undefined ? { error_code: p.errorCode } : {}), ...(p.errorDetail !== undefined ? { error_detail: p.errorDetail } : {}) };
      await tolerant("message update", (extra) => q("messages").update({ status: p.status, status_at: p.statusAt, ...(p.externalId !== undefined ? { external_id: p.externalId } : {}), ...extra }).eq("id", id).select("id"), optional);
    },

    async emit(e) {
      try { await emitEvent({ type: e.type, objectType: e.objectType, objectId: e.objectId, workspaceId: e.workspaceId, data: e.data }, db); }
      catch { /* best effort: row-change triggers already audit the write; an event failure must not undo or retry it */ }
    },
  };
}
