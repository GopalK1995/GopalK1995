// Persistence port for the Gmail connector. Supabase implementation: store-supabase.ts (service role). Unit tests use a fake.
// Every method is scoped by tenant and workspace; contacts are looked up in the connection's own workspace only.
import type { ConnScope } from "../shared/mode";
import type { ContactRef, ParsedMessage } from "./matcher";

export interface StoredThread { conversationId: string; contact: ContactRef; lastMessageId: string | null }

export interface GmailStore {
  /** A page of known lead / contact emails of this workspace (lower-case), stable order. Fewer than `limit` = the last page. */
  listKnownEmails(scope: ConnScope, offset: number, limit: number): Promise<string[]>;
  contactsByEmail(scope: ConnScope, emails: string[]): Promise<Map<string, ContactRef>>;
  /** Creates or updates the email conversation for a Gmail thread and adds the messages not stored yet (by external id). */
  saveThread(scope: ConnScope, t: { threadId: string; contact: ContactRef; messages: ParsedMessage[] }): Promise<{ conversationId: string; added: number }>;
  /** The stored conversation of a thread of THIS workspace (a thread of another workspace or never matched is null). */
  findThread(scope: ConnScope, threadId: string): Promise<{ conversationId: string; contact: ContactRef } | null>;
  /** Records a sent reply on the conversation. */
  saveSent(scope: ConnScope, conversationId: string, m: { externalId: string; body: string; sentBy: string; sentAt: string }): Promise<void>;
}

export interface GmailDeps {
  store: GmailStore;
  log: { info(m: string, f?: Record<string, unknown>): void; warn(m: string, f?: Record<string, unknown>): void; error(m: string, f?: Record<string, unknown>): void };
  now: () => Date;
}
