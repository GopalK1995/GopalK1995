import { dbForRequest } from "../client";
import { makeRepo, type DbProvider, type ListQuery } from "./base";
import { createMessagesRepo } from "./messages";
import type { ConversationInput, ConversationRow } from "./types";

export function createConversationsRepo(getDb: DbProvider = dbForRequest) {
  const r = makeRepo<ConversationRow, ConversationInput>({ table: "conversations", orderCol: "last_message_at" }, getDb);
  const msgs = createMessagesRepo(getDb);
  return {
    list: r.list,
    get: r.get,
    create: r.create,
    update: r.updateV,
    messages: (ws: string, conversationId: string, q?: Omit<ListQuery, "filters">) => msgs.listForConversation(ws, conversationId, q),
    addMessage: msgs.create,
  };
}

export const conversationsRepo = createConversationsRepo();
