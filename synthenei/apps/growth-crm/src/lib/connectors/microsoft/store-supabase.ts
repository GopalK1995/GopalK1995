// Supabase implementation of MsStore on the SERVICE-ROLE client (scheduled jobs and the webhook consumer, CONTRACTS C6). RLS does not
// protect this path, so every query is explicitly scoped by tenant_id / workspace_id (and the connection for calendar rows and thread
// ids). Tables: leads, contacts, conversations, messages (0001 + workspace_id), calendar_events (0019). No new table.
// Leads are matched inside the workspace, contacts inside the tenant (the contacts table has no workspace column).
import "server-only";
import type { Db } from "@/lib/db/client";
import { from, type Qb } from "@/lib/db/query";
import type { KnownContact, MsStore } from "./store";

type R = Record<string, unknown>;
const failed = (what: string) => new Error(`outlook store: ${what} failed`);   // PostgREST text can quote values: not echoed
const UNIQUE = "23505";
const esc = (e: string) => e.replace(/[%_\\]/g, "\\$&");

export function supabaseMsStore(db: Db): MsStore {
  const q = (t: string) => from(db, t);
  const rows = async (b: Qb, what: string): Promise<R[]> => { const { data, error } = await b; if (error) throw failed(what); return (data as R[] | null) ?? []; };
  const threadKey = (connectionId: string, threadId: string) => `outlook:${connectionId}:${threadId}`.slice(0, 300);

  return {
    async matchContacts(scope, emails) {
      const out = new Map<string, KnownContact>();
      for (const e of emails.slice(0, 200)) {
        const lead = (await rows(q("leads").select("id").eq("tenant_id", scope.tenantId).eq("workspace_id", scope.workspaceId).is("deleted_at", null).ilike("email", esc(e)).order("created_at", { ascending: false }).limit(1), "lead match"))[0];
        const contact = (await rows(q("contacts").select("id").eq("tenant_id", scope.tenantId).is("deleted_at", null).ilike("email", esc(e)).order("created_at", { ascending: false }).limit(1), "contact match"))[0];
        if (lead || contact) out.set(e, { leadId: lead ? String(lead.id) : null, contactId: contact ? String(contact.id) : null });
      }
      return out;
    },

    async upsertMail(m) {
      const key = threadKey(m.connectionId, m.threadId);
      const find = async () => (await rows(q("conversations").select("id, last_message_at, last_inbound_at").eq("tenant_id", m.tenantId).eq("workspace_id", m.workspaceId).eq("channel", "email").eq("external_thread_id", key).limit(1), "conversation read"))[0];
      let conv = await find();
      if (!conv) {
        const ins = await q("conversations").insert({
          tenant_id: m.tenantId, workspace_id: m.workspaceId, channel: "email", external_thread_id: key, lead_id: m.leadId, contact_id: m.contactId,
          last_message_at: m.at, ...(m.direction === "inbound" ? { last_inbound_at: m.at } : {}),
        }).select("id");
        if (ins.error) { if (ins.error.code !== UNIQUE) throw failed("conversation insert"); conv = await find(); if (!conv) throw failed("conversation insert"); }
        else conv = { id: ((ins.data as R[] | null) ?? [])[0]?.id };
      }
      const convId = String(conv.id);
      const have = await rows(q("messages").select("id").eq("tenant_id", m.tenantId).eq("workspace_id", m.workspaceId).eq("conversation_id", convId).eq("external_id", m.externalId).limit(1), "message read");
      if (have.length) return "unchanged";
      const body = [m.subject, m.preview].filter(Boolean).join(" - ").slice(0, 2000);
      const ins = await q("messages").insert({
        tenant_id: m.tenantId, workspace_id: m.workspaceId, conversation_id: convId, direction: m.direction, status: m.direction === "inbound" ? "received" : "sent",
        body, external_id: m.externalId, created_at: m.at, status_at: m.at,
      }).select("id");
      if (ins.error) { if (ins.error.code === UNIQUE) return "unchanged"; throw failed("message insert"); }
      const newer = !conv.last_message_at || Date.parse(String(conv.last_message_at)) < Date.parse(m.at);
      if (newer) await rows(q("conversations").update({ last_message_at: m.at, ...(m.direction === "inbound" ? { last_inbound_at: m.at } : {}) }).eq("id", convId).eq("tenant_id", m.tenantId).eq("workspace_id", m.workspaceId).select("id"), "conversation update");
      return "created";
    },

    async upsertCalendarEvent(r) {
      const read = async () => (await rows(q("calendar_events").select("id, status, starts_at, ends_at, title, object_type, object_id").eq("tenant_id", r.tenantId).eq("workspace_id", r.workspaceId).eq("integration_id", r.connectionId).eq("external_id", r.externalId).limit(1), "calendar read"))[0];
      const cur = await read();
      if (!cur) {
        const ins = await q("calendar_events").insert({
          tenant_id: r.tenantId, workspace_id: r.workspaceId, integration_id: r.connectionId, external_id: r.externalId, starts_at: r.startsAt, ends_at: r.endsAt,
          title: r.title.slice(0, 300), status: r.status, ...(r.leadId ? { object_type: "lead", object_id: r.leadId } : {}),
        }).select("id");
        if (ins.error) { if (ins.error.code === UNIQUE) return this.upsertCalendarEvent(r); throw failed("calendar insert"); }
        return { outcome: "created" };
      }
      if (cur.status === "cancelled" && r.status !== "cancelled") return { outcome: "stale" };   // never resurrected by a late update
      const same = Date.parse(String(cur.starts_at)) === Date.parse(r.startsAt) && Date.parse(String(cur.ends_at)) === Date.parse(r.endsAt) && cur.title === r.title.slice(0, 300) && cur.status === r.status;
      const needsLink = !cur.object_id && !!r.leadId;
      if (same && !needsLink) return { outcome: "unchanged" };
      await rows(q("calendar_events").update({
        starts_at: r.startsAt, ends_at: r.endsAt, title: r.title.slice(0, 300), status: r.status, updated_at: new Date().toISOString(), ...(needsLink ? { object_type: "lead", object_id: r.leadId } : {}),
      }).eq("id", String(cur.id)).eq("tenant_id", r.tenantId).eq("workspace_id", r.workspaceId).eq("integration_id", r.connectionId).select("id"), "calendar update");
      return { outcome: same ? "unchanged" : r.status === "cancelled" ? "cancelled" : "updated" };
    },

    async cancelCalendarEvent(scope, externalId) {
      const cur = (await rows(q("calendar_events").select("id, status").eq("tenant_id", scope.tenantId).eq("workspace_id", scope.workspaceId).eq("integration_id", scope.connectionId).eq("external_id", externalId).limit(1), "calendar read"))[0];
      if (!cur) return "missing";
      if (cur.status === "cancelled") return "unchanged";
      await rows(q("calendar_events").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", String(cur.id)).eq("tenant_id", scope.tenantId).eq("workspace_id", scope.workspaceId).eq("integration_id", scope.connectionId).select("id"), "calendar cancel");
      return "cancelled";
    },
  };
}
