// Real repositories for the inbox actions and reads. Every call is workspace-scoped and runs with the caller's JWT (RLS applies).
import { dbForRequest, type Db } from "@/lib/db/client";
import { DbError, throwIfError } from "@/lib/db/errors";
import { toCamel } from "@/lib/db/map";
import { from } from "@/lib/db/query";
import { makeRepo, type DbProvider } from "@/lib/db/repo/base";
import { createConversationsRepo } from "@/lib/db/repo/conversations";
import { createLeadsRepo } from "@/lib/db/repo/leads";
import { createMessagesRepo } from "@/lib/db/repo/messages";
import type { ConversationInput, ConversationRow } from "@/lib/db/repo/types";
import type { Repos, TemplateRow } from "./persist";

export function createInboxRepos(getDb: DbProvider = dbForRequest): Repos {
  const convs = createConversationsRepo(getDb);
  const plain = makeRepo<ConversationRow, ConversationInput>({ table: "conversations", orderCol: "last_message_at" }, getDb);
  const msgs = createMessagesRepo(getDb);
  const leads = createLeadsRepo(getDb);
  return {
    conv: {
      get: convs.get,
      update: convs.update as Repos["conv"]["update"],
      async touch(ws, id, patch) { await plain.updatePlain(ws, id, patch as Partial<ConversationInput>); },
    },
    msgs: { create: msgs.create },
    templates: {
      async get(ws, id): Promise<TemplateRow | null> {
        const db = await getDb();
        const { data, error } = await from(db, "message_templates").select().eq("workspace_id", ws).eq("id", id).maybeSingle();
        throwIfError(error);
        return data ? toCamel<TemplateRow>(data as Record<string, unknown>) : null;
      },
    },
    consent: {
      // public.can_contact(p_lead, p_purpose): true only when the latest consent_log entry is a grant (migration 0015)
      async canContact(leadId, purpose) {
        const db = await getDb();
        const { data, error } = await (db as unknown as { rpc(f: string, a: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> })
          .rpc("can_contact", { p_lead: leadId, p_purpose: purpose });
        if (error) throw new DbError("error", "error", { detail: error.message });
        return data === true;
      },
    },
    leads: { get: async (ws, id) => (await leads.get(ws, id)) },
  };
}
export const inboxRepos = createInboxRepos();
export type { Db };
