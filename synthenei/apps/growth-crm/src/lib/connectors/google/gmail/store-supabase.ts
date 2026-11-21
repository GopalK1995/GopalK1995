// Supabase implementation of GmailStore on the SERVICE-ROLE client. RLS does not protect this path, so every query is scoped by
// tenant_id and workspace_id. Threads become `conversations` (channel email, external_thread_id = Gmail thread id) and `messages`.
// No schema change needed. Message bodies are stored only for threads the matcher kept.
import "server-only";
import type { Db } from "@/lib/db/client";
import { from, type Qb } from "@/lib/db/query";
import type { ContactRef } from "./matcher";
import type { GmailStore } from "./store";

type R = Record<string, unknown>;
const failed = (what: string) => new Error(`gmail store: ${what} failed`);   // PostgREST text can quote values: not echoed

export function supabaseGmailStore(db: Db): GmailStore {
  const rows = async (b: Qb, what: string): Promise<R[]> => { const { data, error } = await b; if (error) throw failed(what); return (data as R[] | null) ?? []; };
  const ws = (t: string, s: { tenantId: string; workspaceId: string }, cols = "*") => from(db, t).select(cols).eq("tenant_id", s.tenantId).eq("workspace_id", s.workspaceId);
  const tables = [["leads", "lead"], ["contacts", "contact"]] as const;
  return {
    async listKnownEmails(scope, offset, limit) {
      // One stable sequence (lead emails, then contact emails), paged by offset. Bounded: the caller caps the offset.
      const all: string[] = [];
      for (const [table] of tables) {
        const r = await rows(ws(table, scope, "email").neq("email", "").order("email", { ascending: true }).limit(offset + limit), `${table} emails`);
        all.push(...r.map((x) => String(x.email).toLowerCase()));
      }
      return [...new Set(all)].sort().slice(offset, offset + limit);
    },
    async contactsByEmail(scope, emails) {
      const out = new Map<string, ContactRef>();
      const list = [...new Set(emails.map((e) => e.toLowerCase()))].slice(0, 200);
      if (!list.length) return out;
      for (const [table, type] of tables) {
        const r = await rows(ws(table, scope, "id,email").in("email", list), `${type} lookup`);
        for (const x of r) { const e = String(x.email ?? "").toLowerCase(); if (e && !out.has(e)) out.set(e, { type, id: String(x.id) }); }
      }
      return out;
    },
    async saveThread(scope, t) {
      const found = (await rows(ws("conversations", scope, "id").eq("channel", "email").eq("external_thread_id", t.threadId).limit(1), "conversation lookup"))[0];
      const last = t.messages.reduce((a, m) => (m.sentAt > a ? m.sentAt : a), "");
      const lastIn = t.messages.filter((m) => m.direction === "inbound").reduce((a, m) => (m.sentAt > a ? m.sentAt : a), "");
      let conversationId: string;
      if (found) { conversationId = String(found.id); await rows(from(db, "conversations").update({ last_message_at: last, ...(lastIn ? { last_inbound_at: lastIn } : {}) }).eq("id", conversationId).eq("tenant_id", scope.tenantId).eq("workspace_id", scope.workspaceId).select("id"), "conversation touch"); }
      else {
        const link = t.contact.type === "lead" ? { lead_id: t.contact.id } : { contact_id: t.contact.id };
        const ins = await rows(from(db, "conversations").insert({ tenant_id: scope.tenantId, workspace_id: scope.workspaceId, channel: "email", external_thread_id: t.threadId, status: "open", last_message_at: last, ...(lastIn ? { last_inbound_at: lastIn } : {}), ...link }).select("id"), "conversation insert");
        if (!ins[0]) throw failed("conversation insert");
        conversationId = String(ins[0].id);
      }
      const have = new Set((await rows(ws("messages", scope, "external_id").eq("conversation_id", conversationId).in("external_id", t.messages.map((m) => m.id)), "message lookup")).map((x) => String(x.external_id)));
      const fresh = t.messages.filter((m) => !have.has(m.id));
      for (const m of fresh) {
        await rows(from(db, "messages").insert({ tenant_id: scope.tenantId, workspace_id: scope.workspaceId, conversation_id: conversationId, direction: m.direction, status: m.direction === "inbound" ? "received" : "sent", body: m.body, external_id: m.id, created_at: m.sentAt }).select("id"), "message insert");
      }
      return { conversationId, added: fresh.length };
    },
    async findThread(scope, threadId) {
      const c = (await rows(ws("conversations", scope, "id,lead_id,contact_id").eq("channel", "email").eq("external_thread_id", threadId).limit(1), "conversation lookup"))[0];
      if (!c) return null;
      const contact: ContactRef | null = c.lead_id ? { type: "lead", id: String(c.lead_id) } : c.contact_id ? { type: "contact", id: String(c.contact_id) } : null;
      return contact ? { conversationId: String(c.id), contact } : null;
    },
    async saveSent(scope, conversationId, m) {
      await rows(from(db, "messages").insert({ tenant_id: scope.tenantId, workspace_id: scope.workspaceId, conversation_id: conversationId, direction: "outbound", status: "sent", body: m.body, external_id: m.externalId, sent_by: m.sentBy, created_at: m.sentAt }).select("id"), "sent insert");
      await rows(from(db, "conversations").update({ last_message_at: m.sentAt }).eq("id", conversationId).eq("tenant_id", scope.tenantId).eq("workspace_id", scope.workspaceId).select("id"), "conversation touch");
    },
  };
}
