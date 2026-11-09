// Supabase implementation of EmailStore on the SERVICE-ROLE client (webhooks, jobs and the public unsubscribe endpoint are
// sanctioned users of serviceDb, CONTRACTS C6). RLS does not protect this path, so every query is explicitly scoped by tenant_id /
// workspace_id. Optional objects added by docs/migrations-backlog.md "T038 needs" (email_suppressions table, messages.subject,
// message_templates.subject) are tolerated: a missing column is retried without it; a missing suppression table is reported as
// "nobody suppressed" with a warning (consent withdrawals still hold through consent_log, which is what the law cares about).
import "server-only";
import type { Db } from "@/lib/db/client";
import { from, type Qb } from "@/lib/db/query";
import { emitEvent } from "@/lib/events/emit";
import { normaliseEmail, type SuppressionEntry, type SuppressionReason } from "./suppression";
import type { ConsentEntry, EmailEvent, EmailStore, NewOutbound, NewSuppression, OutboundPatch, OutboundRow, Recipient, TemplateRow } from "./store";

type R = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const failed = (what: string) => new Error(`email store: ${what} failed`);   // PostgREST text can quote values: not echoed
const MISSING_COLUMN = new Set(["PGRST204", "42703"]);
const MISSING_TABLE = new Set(["PGRST205", "42P01"]);
const RANK: Record<string, number> = { queued: 0, simulated: 0, sent: 1, delivered: 2, read: 3 };

export function supabaseEmailStore(db: Db, warn: (m: string) => void = () => undefined): EmailStore {
  const q = (t: string) => from(db, t);
  const rows = async (b: Qb, what: string): Promise<R[]> => { const { data, error } = await b; if (error) throw failed(what); return (data as R[] | null) ?? []; };
  async function tolerant(what: string, op: (extra: R) => Qb, optional: R): Promise<R[]> {
    const first = await op(optional);
    if (!first.error) return (first.data as R[] | null) ?? [];
    if (!MISSING_COLUMN.has(String(first.error.code ?? "")) || !Object.keys(optional).length) throw failed(what);
    return rows(op({}), what);
  }
  const rpc = (fn: string, a: R) => (db as unknown as { rpc(fn: string, a: R): PromiseLike<{ data: unknown; error: { code?: string } | null }> }).rpc(fn, a);

  async function convFor(m: { tenantId: string; workspaceId: string; leadId: string; email: string }): Promise<string> {
    const thread = normaliseEmail(m.email);
    const found = await rows(q("conversations").select("id").eq("workspace_id", m.workspaceId).eq("channel", "email").eq("external_thread_id", thread).limit(1), "conversation lookup");
    if (found[0]) return String(found[0].id);
    const ins = await rows(q("conversations").insert({ tenant_id: m.tenantId, workspace_id: m.workspaceId, channel: "email", lead_id: m.leadId, external_thread_id: thread, status: "open" }).select("id"), "conversation insert");
    if (!ins[0]) throw failed("conversation insert");
    return String(ins[0].id);
  }

  return {
    async getRecipient(workspaceId, leadId): Promise<Recipient | null> {
      const r = (await rows(q("leads").select("id, full_name, email, firm_name, district").eq("id", leadId).eq("workspace_id", workspaceId).is("deleted_at", null).limit(1), "lead read"))[0];
      if (!r) return null;
      const full = String(r.full_name ?? "").trim();
      return { leadId: String(r.id), email: str(r.email), fullName: full, firstName: full.split(/\s+/)[0] ?? "", company: str(r.firm_name), district: str(r.district) };
    },
    async findLeadsByEmail(workspaceId, email) {
      const want = normaliseEmail(email);
      // ilike narrows the scan (escaped so _ and % are literal); the exact comparison below decides, so a wildcard can never match another person.
      const r = await rows(q("leads").select("id, email").eq("workspace_id", workspaceId).ilike("email", want.replace(/[\\%_]/g, "\\$&")).is("deleted_at", null).limit(50), "lead lookup");
      return r.filter((x) => normaliseEmail(String(x.email ?? "")) === want).map((x) => String(x.id));
    },
    async canContact(leadId) {
      const { data, error } = await rpc("can_contact", { p_lead: leadId, p_purpose: "marketing_email" });
      if (error) throw failed("consent check");   // fail closed: the job retries, nothing is sent
      return data === true;
    },
    async latestConsent(leadId) {
      const r = await rows(q("consent_log").select("action").eq("lead_id", leadId).eq("purpose", "marketing_email").order("occurred_at", { ascending: false }).limit(1), "consent read");
      const a = r[0]?.action;
      return a === "granted" || a === "withdrawn" ? a : null;
    },
    async recordConsent(c: ConsentEntry) {
      await rows(q("consent_log").insert({ tenant_id: c.tenantId, workspace_id: c.workspaceId, lead_id: c.leadId, subject_ref: c.subjectRef, purpose: "marketing_email", action: c.action, notice_version: "email-unsubscribe-v1", captured_via: "integration", note: c.note }).select("id"), "consent insert");
    },

    async isSuppressed(workspaceId, email) {
      const { data, error } = await q("email_suppressions").select("id").eq("workspace_id", workspaceId).eq("email", normaliseEmail(email)).limit(1);
      if (error) {
        if (MISSING_TABLE.has(String(error.code ?? ""))) { warn("email_suppressions table is missing; apply docs/migrations-backlog.md T038 needs"); return false; }
        throw failed("suppression check");   // fail closed
      }
      return ((data as R[] | null) ?? []).length > 0;
    },
    async addSuppression(s: NewSuppression) {
      const { data, error } = await q("email_suppressions").insert({ tenant_id: s.tenantId, workspace_id: s.workspaceId, email: normaliseEmail(s.email), reason: s.reason, source: s.source, lead_id: s.leadId ?? null }).select("id");
      if (error) {
        if (error.code === "23505") return false;   // already suppressed: the first reason stays
        if (MISSING_TABLE.has(String(error.code ?? ""))) { warn("email_suppressions table is missing; apply docs/migrations-backlog.md T038 needs"); return false; }
        throw failed("suppression insert");
      }
      return ((data as R[] | null) ?? []).length > 0;
    },
    async listSuppressions(workspaceId, limit): Promise<SuppressionEntry[]> {
      const { data, error } = await q("email_suppressions").select("email, reason, source, created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(limit);
      if (error) { if (MISSING_TABLE.has(String(error.code ?? ""))) return []; throw failed("suppression list"); }
      return ((data as R[] | null) ?? []).map((r) => ({ email: String(r.email), reason: String(r.reason) as SuppressionReason, source: String(r.source), at: String(r.created_at) }));
    },

    async getOutbound(id): Promise<OutboundRow | null> {
      const m = (await rows(q("messages").select("id, tenant_id, workspace_id, conversation_id, status, body, template_id, is_internal_note, direction").eq("id", id).limit(1), "message read"))[0];
      if (!m || m.direction !== "outbound") return null;
      const c = (await rows(q("conversations").select("channel, lead_id, external_thread_id").eq("id", m.conversation_id).limit(1), "conversation read"))[0];
      if (!c) return null;
      let subject: string | null = null;
      const s = await q("messages").select("subject").eq("id", id).limit(1);
      if (!s.error) subject = str(((s.data as R[] | null) ?? [])[0]?.subject);   // column added by "T038 needs"; absent = body prefix is used
      return { id: String(m.id), tenantId: String(m.tenant_id), workspaceId: String(m.workspace_id), conversationId: String(m.conversation_id), status: String(m.status), body: str(m.body), subject, templateId: str(m.template_id), isInternalNote: m.is_internal_note === true, channel: String(c.channel), leadId: str(c.lead_id), to: str(c.external_thread_id) };
    },
    async listQueuedOutbound(workspaceId, limit) {
      const r = await rows(q("messages").select("id, conversations!inner(channel)").eq("workspace_id", workspaceId).eq("direction", "outbound").eq("status", "queued").eq("is_internal_note", false).eq("conversations.channel", "email").order("created_at", { ascending: true }).limit(limit), "queue read");
      return r.map((x) => String(x.id));
    },
    async patchOutbound(id, p: OutboundPatch) {
      const optional: R = { ...(p.errorCode !== undefined ? { error_code: p.errorCode } : {}), ...(p.errorDetail !== undefined ? { error_detail: p.errorDetail } : {}) };
      await tolerant("message update", (extra) => q("messages").update({ status: p.status, status_at: p.statusAt, ...(p.externalId !== undefined ? { external_id: p.externalId } : {}), ...extra }).eq("id", id).select("id"), optional);
    },
    async createOutbound(m: NewOutbound, opts) {
      const status = opts?.status ?? "queued";
      if (opts?.providerId) {
        const dup = await rows(q("messages").select("id").eq("tenant_id", m.tenantId).eq("external_id", opts.providerId).limit(1), "message lookup");
        if (dup[0]) return String(dup[0].id);
      }
      const conversationId = await convFor(m);
      const base = { tenant_id: m.tenantId, workspace_id: m.workspaceId, conversation_id: conversationId, direction: "outbound", status, body: m.body, template_id: m.templateId, external_id: opts?.providerId ?? null, status_at: opts?.at ?? null, is_internal_note: false };
      const ins = await tolerant("message insert", (extra) => q("messages").insert({ ...base, ...extra }).select("id"), { subject: m.subject });
      if (!ins[0]) throw failed("message insert");
      if (status === "sent") await rows(q("conversations").update({ last_message_at: opts?.at ?? new Date().toISOString() }).eq("id", conversationId).select("id"), "conversation touch");
      return String(ins[0].id);
    },
    async applyStatus(tenantId, providerId, status, atIso, error) {
      const cur = (await rows(q("messages").select("id, status, direction, conversation_id").eq("tenant_id", tenantId).eq("external_id", providerId).limit(1), "message lookup"))[0];
      if (!cur) return { result: "unknown" };
      const id = String(cur.id), now = String(cur.status);
      const lead = str((await rows(q("conversations").select("lead_id").eq("id", cur.conversation_id).limit(1), "conversation read"))[0]?.lead_id);
      if (cur.direction !== "outbound") return { result: "ignored", messageId: id, leadId: lead };
      const advances = status === "failed" ? now !== "read" && now !== "delivered" && now !== "failed" : (RANK[status] ?? 0) > (RANK[now] ?? 0);
      if (!advances) return { result: "ignored", messageId: id, leadId: lead };
      await tolerant("status update", (extra) => q("messages").update({ status, status_at: atIso, ...extra }).eq("id", id).select("id"), error ? { error_code: error.code } : {});
      return { result: "updated", messageId: id, leadId: lead };
    },
    async messageRecipient(tenantId, providerId) {
      const m = (await rows(q("messages").select("conversation_id").eq("tenant_id", tenantId).eq("external_id", providerId).limit(1), "message lookup"))[0];
      if (!m) return null;
      const c = (await rows(q("conversations").select("lead_id, external_thread_id").eq("id", m.conversation_id).limit(1), "conversation read"))[0];
      return c ? { email: str(c.external_thread_id), leadId: str(c.lead_id) } : null;
    },

    async getTemplate(tenantId, id): Promise<TemplateRow | null> {
      const r = await tolerant("template read", (extra) => q("message_templates").select(`id, name, channel, body, status, approval_status${Object.keys(extra).length ? ", subject" : ""}`).eq("tenant_id", tenantId).eq("id", id).limit(1), { subject: true });
      const t = r[0];
      return t ? { id: String(t.id), name: String(t.name), subject: str(t.subject), body: String(t.body), status: String(t.status ?? t.approval_status), channel: String(t.channel) } : null;
    },

    async emit(e: EmailEvent) {
      try { await emitEvent({ type: e.type, objectType: e.objectType, objectId: e.objectId, workspaceId: e.workspaceId, data: e.data }, db); }
      catch { /* best effort: row-change triggers already audit the write; an event failure must not undo or retry it */ }
    },
    async audit(a) {
      // audit_record needs a signed-in member; on the service role it is refused, and the row-change triggers on consent_log and
      // email_suppressions (T038 needs) are the record. Never throws into the caller's path.
      await rpc("audit_record", { p_workspace: a.workspaceId, p_action: a.action, p_summary: a.summary, p_object_table: "email_suppressions", p_object_id: a.objectId, p_reason: null, p_detail: a.detail ?? {}, p_source: "connector", p_actor_kind: "connector", p_request_id: null, p_ip: null, p_user_agent: null, p_impersonation: false });
    },
  };
}
