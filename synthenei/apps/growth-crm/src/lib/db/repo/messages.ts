import { dbForRequest } from "../client";
import { makeRepo, type DbProvider, type ListQuery } from "./base";
import type { MessageInput, MessageRow } from "./types";

export function createMessagesRepo(getDb: DbProvider = dbForRequest) {
  const r = makeRepo<MessageRow, MessageInput>({ table: "messages" }, getDb);
  return {
    /** Messages of one conversation, newest first (keyset). */
    listForConversation: (ws: string, conversationId: string, q: Omit<ListQuery, "filters"> = {}) =>
      r.list(ws, { ...q, filters: [{ field: "conversationId", op: "eq", value: conversationId }] }),
    get: r.get,
    create: r.create,
  };
}

export const messagesRepo = createMessagesRepo();
