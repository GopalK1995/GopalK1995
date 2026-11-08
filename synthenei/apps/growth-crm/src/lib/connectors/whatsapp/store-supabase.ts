// Supabase implementation of WaStore on the SERVICE-ROLE client (inbound webhooks and jobs are sanctioned users of serviceDb,
// CONTRACTS C6). RLS does not protect this path, so every query is explicitly scoped by tenant_id / workspace_id / integration id.
// Optional columns added by docs/migrations-backlog.md "T035 needs" (messages.attachments / error_code / error_detail) are
// written when present; on a database that lacks them the write is retried without them, so the connector works before and after.
import "server-only";
import type { Db } from "@/lib/db/client";
import { from, type Qb } from "@/lib/db/query";
import { emitEvent } from "@/lib/events/emit";
import type { ConsentEntry, ConversationRef, InsertResult, NewInboundMessage, NumberUpsert, OutboundPatch, OutboundRow, TemplateRow, TemplateUpsert, WaStore } from "./store";

type R = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const failed = (what: string) => new Error(`whatsapp store: ${what} failed`);   // PostgREST text can quote values: not echoed
const RANK: Record<string, number> = { queued: 0, pending_template: 0, simulated: 0, sent: 1, delivered: 2, read: 3 };
const MISSING_COLUMN = new Set(["PGRST204", "42703"]);

export function supabaseWaStore(db: Db): WaStore {
  const q = (t: string) => from(db, t);
  const rows = async (b: Qb, what: string): Promise<R[]> => { const { data, error } = await b; if (error) throw failed(what); return (data as R[] | null) ?? []; };
  /** Runs op with the optional columns; if the database does not have them yet, runs it again without. */
  async function tolerant(what: string, op: (extra: R) => Qb, optional: R): Promise<R[]> {
    const first = await op(optional);
    if (!first.error) return (first.data as R[] | null) ?? [];
    if (!MISSING_COLUMN.has(String(first.error.code ?? "")) || !Object.keys(optional).length) throw failed(what);
    return rows(op({}), what);
  }

  return {
    async upsertNumber(n: NumberUpsert) {
      const other = await rows(q("wa_numbers").select("workspace_id").eq("phone_number_id", n.phoneNumberId).neq("workspace_id", n.workspaceId).limit(1), "number lookup");
      if (other.length) return { ok: false, reason: "phone_number_taken" };
      const row = { tenant_id: n.tenantId, workspace_id: n.workspaceId, integration_id: n.connectionId, waba_id: n.wabaId, phone_number_id: n.phoneNumberId, display_number: n.displayNumber, verified_name: n.verifiedName ?? null, quality_rating: n.quality, messaging_limit_tier: n.messagingLimitTier ?? null, updated_at: new Date().toISOString() };
      const own = await rows(q("wa_numbers").select("id").eq("workspace_id", n.workspaceId).eq("phone_number_id", n.phoneNumberId).limit(1), "number lookup");
      if (own[0]) { await rows(q("wa_numbers").update(row).eq("id", own[0].id).select("id"), "number update"); return { ok: true }; }
      const { error } = await q("wa_numbers").insert(row).select("id");
      if (error) { if (error.code === "23505") return { ok: false, reason: "phone_number_taken" }; throw failed("number insert"); }
      return { ok: true };
    },

    async findMessageByWamid(tenantId, wamid) {
      const r = await rows(q("messages").select("id, conversation_id").eq("tenant_id", tenantId).eq("external_id", wamid).limit(1), "message lookup");
      return r[0] ? { id: String(r[0].id), conversationId: String(r[0].conversation_id) } : null;
    },
    async upsertConversation(c): Promise<ConversationRef> {
      const found = await rows(q("conversations").select("id, lead_id, last_inbound_at, status").eq("workspace_id", c.workspaceId).eq("channel", "whatsapp").eq("external_thread_id", c.waId).limit(1), "conversation lookup");
      const f = found[0];
      if (f) {
        let leadId = str(f.lead_id);
        if (!leadId && c.leadId) { await rows(q("conversations").update({ lead_id: c.leadId }).eq("id", f.id).select("id"), "conversation link"); leadId = c.leadId; }
        return { id: String(f.id), leadId, lastInboundAt: str(f.last_inbound_at), status: String(f.status), created: false };
      }
      const ins = await rows(q("conversations").insert({ tenant_id: c.tenantId, workspace_id: c.workspaceId, channel: "whatsapp", lead_id: c.leadId, external_thread_id: c.waId, status: "open" }).select("id"), "conversation insert");
      if (!ins[0]) throw failed("conversation insert");
      return { id: String(ins[0].id), leadId: c.leadId, lastInboundAt: null, status: "open", created: true };
    },
    async insertInbound(m: NewInboundMessage): Promise<InsertResult> {
      const base = { tenant_id: m.tenantId, workspace_id: m.workspaceId, conversation_id: m.conversationId, direction: "inbound", status: "received", body: m.body, external_id: m.wamid, created_at: m.at, status_at: m.at };
      const op = (extra: R) => q("messages").insert({ ...base, ...extra }).select("id");
      let res = await op(m.attachments ? { attachments: m.attachments } : {});
      if (res.error && MISSING_COLUMN.has(String(res.error.code ?? ""))) res = await op({});
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
    async setAttachments(messageId, attachments) {
      const { error } = await q("messages").update({ attachments }).eq("id", messageId).select("id");
      if (error && !MISSING_COLUMN.has(String(error.code ?? ""))) throw failed("attachments update");
    },

    async findLeadByPhone(workspaceId, e164) {
      const r = await rows(q("leads").select("id").eq("workspace_id", workspaceId).eq("phone", e164).is("deleted_at", null).limit(1), "lead lookup");
      return r[0] ? String(r[0].id) : null;
    },
    async createLead(row) { const r = await rows(q("leads").insert(row).select("id"), "lead insert"); if (!r[0]) throw failed("lead insert"); return String(r[0].id); },

    async applyStatus(tenantId, wamid, status, atIso, error) {
      const cur = (await rows(q("messages").select("id, status, direction").eq("tenant_id", tenantId).eq("external_id", wamid).limit(1), "message lookup"))[0];
      if (!cur) return { result: "unknown" };
      const id = String(cur.id), now = String(cur.status);
      if (cur.direction !== "outbound") return { result: "ignored", messageId: id };
      const advances = status === "failed" ? now !== "read" && now !== "delivered" && now !== "failed" : (RANK[status] ?? 0) > (RANK[now] ?? 0);
      if (!advances) return { result: "ignored", messageId: id };
      await tolerant("status update", (extra) => q("messages").update({ status, status_at: atIso, ...extra }).eq("id", id).select("id"), error ? { error_code: error.code, error_detail: error.detail ?? null } : {});
      return { result: "updated", messageId: id };
    },

    async getOutbound(id): Promise<OutboundRow | null> {
      const m = (await rows(q("messages").select("id, tenant_id, workspace_id, conversation_id, status, body, template_id, is_internal_note, direction").eq("id", id).limit(1), "message read"))[0];
      if (!m || m.direction !== "outbound") return null;
      const c = (await rows(q("conversations").select("channel, lead_id, external_thread_id, last_inbound_at").eq("id", m.conversation_id).limit(1), "conversation read"))[0];
      if (!c) return null;
      return { id: String(m.id), tenantId: String(m.tenant_id), workspaceId: String(m.workspace_id), conversationId: String(m.conversation_id), status: String(m.status), body: str(m.body), templateId: str(m.template_id), isInternalNote: m.is_internal_note === true, channel: String(c.channel), leadId: str(c.lead_id), waId: str(c.external_thread_id), lastInboundAt: str(c.last_inbound_at) };
    },
    async listQueuedOutbound(workspaceId, limit) {
      const r = await rows(q("messages").select("id, conversations!inner(channel)").eq("workspace_id", workspaceId).eq("direction", "outbound").eq("status", "queued").eq("is_internal_note", false).eq("conversations.channel", "whatsapp").order("created_at", { ascending: true }).limit(limit), "queue read");
      return r.map((x) => String(x.id));
    },
    async patchOutbound(id, p: OutboundPatch) {
      const optional: R = { ...(p.errorCode !== undefined ? { error_code: p.errorCode } : {}), ...(p.errorDetail !== undefined ? { error_detail: p.errorDetail } : {}) };
      await tolerant("message update", (extra) => q("messages").update({ status: p.status, status_at: p.statusAt, ...(p.externalId !== undefined ? { external_id: p.externalId } : {}), ...extra }).eq("id", id).select("id"), optional);
    },
    async leadPhone(leadId) { const r = await rows(q("leads").select("phone").eq("id", leadId).limit(1), "lead read"); return str(r[0]?.phone); },

    async canContact(leadId, purpose) {
      const { data, error } = await (db as unknown as { rpc(fn: string, a: R): PromiseLike<{ data: unknown; error: unknown }> }).rpc("can_contact", { p_lead: leadId, p_purpose: purpose });
      if (error) throw failed("consent check");   // fail closed: the job retries, nothing is sent
      return data === true;
    },
    async latestConsent(leadId) {
      const r = await rows(q("consent_log").select("action").eq("lead_id", leadId).eq("purpose", "whatsapp").order("occurred_at", { ascending: false }).limit(1), "consent read");
      const a = r[0]?.action;
      return a === "granted" || a === "withdrawn" ? a : null;
    },
    async recordConsent(c: ConsentEntry) {
      let subject = c.subjectRef;
      if (c.leadId) { const e = await rows(q("consent_log").select("subject_ref").eq("lead_id", c.leadId).limit(1), "consent read"); if (e[0]) subject = String(e[0].subject_ref); }
      await rows(q("consent_log").insert({ tenant_id: c.tenantId, workspace_id: c.workspaceId, lead_id: c.leadId, subject_ref: subject, purpose: c.purpose, action: c.action, notice_version: "whatsapp-keyword-v1", captured_via: "integration", note: c.note }).select("id"), "consent insert");
    },

    async getTemplate(tenantId, id): Promise<TemplateRow | null> {
      const r = (await rows(q("message_templates").select("id, name, language, status, approval_status, body, provider_template_id, components").eq("tenant_id", tenantId).eq("id", id).limit(1), "template read"))[0];
      if (!r) return null;
      return { id: String(r.id), name: String(r.name), language: String(r.language), status: String(r.status ?? r.approval_status), body: String(r.body), providerTemplateId: str(r.provider_template_id), components: Array.isArray(r.components) ? r.components : [] };
    },
    async upsertTemplate(t: TemplateUpsert) {
      const approval = t.status === "approved" ? "approved" : t.status === "rejected" || t.status === "paused" ? "rejected" : "pending";
      const body = { name: t.name, category: t.category, body: t.body, variables: t.variables, status: t.status, approval_status: approval, components: t.components, rejected_reason: t.rejectedReason };
      const own = (await rows(q("message_templates").select("id").eq("integration_id", t.connectionId).eq("provider_template_id", t.providerTemplateId).limit(1), "template lookup"))[0];
      if (own) { await rows(q("message_templates").update(body).eq("id", own.id).select("id"), "template update"); return "updated"; }
      const clash = await rows(q("message_templates").select("id").eq("tenant_id", t.tenantId).eq("channel", "whatsapp").eq("name", t.name).eq("language", t.language).limit(1), "template lookup");
      if (clash.length) return "skipped";
      await rows(q("message_templates").insert({ ...body, tenant_id: t.tenantId, workspace_id: t.workspaceId, channel: "whatsapp", language: t.language, integration_id: t.connectionId, provider_template_id: t.providerTemplateId }).select("id"), "template insert");
      return "created";
    },
    async setTemplateStatusByProviderId(connectionId, providerTemplateId, status, reason) {
      const approval = status === "approved" ? "approved" : status === "rejected" || status === "paused" ? "rejected" : "pending";
      const r = await rows(q("message_templates").update({ status, approval_status: approval, rejected_reason: reason }).eq("integration_id", connectionId).eq("provider_template_id", providerTemplateId).select("id"), "template status");
      return r.length > 0;
    },

    async emit(e) {
      try { await emitEvent({ type: e.type, objectType: e.objectType, objectId: e.objectId, workspaceId: e.workspaceId, data: e.data }, db); }
      catch { /* best effort: row-change triggers already audit the write; an event failure must not undo or retry it */ }
    },
  };
}
