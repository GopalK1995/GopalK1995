// Persistence port for the WhatsApp connector. The Supabase implementation (store-supabase.ts, service role) is the only one that
// touches tables; unit tests pass an in-memory fake. Every method is scoped by tenant and/or workspace: nothing here reads across tenants.
import type { WaStatus } from "./payload";

export interface ConnScope { tenantId: string; workspaceId: string; connectionId: string }

export interface ConversationRef { id: string; leadId: string | null; lastInboundAt: string | null; status: string; created: boolean }
export interface NewInboundMessage {
  tenantId: string; workspaceId: string; conversationId: string; wamid: string; body: string; at: string;
  attachments?: unknown[]; replyToWamid?: string;
}
export type InsertResult = { id: string } | { duplicate: true };

export interface OutboundRow {
  id: string; tenantId: string; workspaceId: string; conversationId: string; status: string; body: string | null; templateId: string | null;
  isInternalNote: boolean; channel: string; leadId: string | null; waId: string | null; lastInboundAt: string | null;
}
export interface OutboundPatch { status: string; externalId?: string | null; statusAt: string; errorCode?: string | null; errorDetail?: string | null }

export interface TemplateRow {
  id: string; name: string; language: string; status: string; body: string; providerTemplateId: string | null; components: unknown[];
}
export interface TemplateUpsert {
  tenantId: string; workspaceId: string; connectionId: string; providerTemplateId: string; name: string; language: "en" | "ta";
  category: "marketing" | "utility" | "authentication"; status: string; body: string; variables: string[]; components: unknown[]; rejectedReason: string | null;
}
export interface ConsentEntry { tenantId: string; workspaceId: string; leadId: string | null; subjectRef: string; purpose: "whatsapp"; action: "granted" | "withdrawn"; note: string }

export interface NumberUpsert {
  tenantId: string; workspaceId: string; connectionId: string; wabaId: string; phoneNumberId: string; displayNumber: string; verifiedName?: string;
  quality: "green" | "yellow" | "red" | "unknown"; messagingLimitTier?: string;
}

export interface WaStore {
  /** phone_number_id -> workspace mapping. Globally unique: a number already owned by another workspace is refused. */
  upsertNumber(n: NumberUpsert): Promise<{ ok: true } | { ok: false; reason: "phone_number_taken" }>;

  findMessageByWamid(tenantId: string, wamid: string): Promise<{ id: string; conversationId: string } | null>;
  upsertConversation(c: { tenantId: string; workspaceId: string; waId: string; leadId: string | null }): Promise<ConversationRef>;
  /** Inserts an inbound message; a unique-violation on (tenant, wamid) comes back as { duplicate: true }. */
  insertInbound(m: NewInboundMessage): Promise<InsertResult>;
  /** last_inbound_at only moves forward; a closed conversation is reopened. */
  touchInbound(conversationId: string, atIso: string, leadId: string | null): Promise<void>;
  setAttachments(messageId: string, attachments: unknown[]): Promise<void>;

  findLeadByPhone(workspaceId: string, e164: string): Promise<string | null>;
  createLead(row: Record<string, unknown>): Promise<string>;

  /** Applies a delivery status with the rank rule (never moves a message backwards). */
  applyStatus(tenantId: string, wamid: string, status: WaStatus, atIso: string, error?: { code: string; detail?: string }): Promise<{ result: "updated" | "ignored" | "unknown"; messageId?: string }>;

  getOutbound(id: string): Promise<OutboundRow | null>;
  listQueuedOutbound(workspaceId: string, limit: number): Promise<string[]>;
  patchOutbound(id: string, patch: OutboundPatch): Promise<void>;
  leadPhone(leadId: string): Promise<string | null>;

  canContact(leadId: string, purpose: "whatsapp"): Promise<boolean>;
  /** Latest consent action for the lead and purpose, or null when none is recorded. */
  latestConsent(leadId: string): Promise<"granted" | "withdrawn" | null>;
  recordConsent(c: ConsentEntry): Promise<void>;

  getTemplate(tenantId: string, id: string): Promise<TemplateRow | null>;
  upsertTemplate(t: TemplateUpsert): Promise<"created" | "updated" | "skipped">;
  setTemplateStatusByProviderId(connectionId: string, providerTemplateId: string, status: string, reason: string | null): Promise<boolean>;

  emit(e: { type: "message.received" | "message.sent" | "message.status" | "consent.changed"; workspaceId: string; objectType: string; objectId: string; data: Record<string, unknown> }): Promise<void>;
}

export interface MediaStore {
  /** Uploads to the private bucket; returns the storage path (a reference), never a public URL. */
  put(path: string, bytes: Uint8Array, mime: string | undefined): Promise<void>;
}

export interface WaDeps {
  store: WaStore;
  media: MediaStore;
  log: { info(m: string, f?: Record<string, unknown>): void; warn(m: string, f?: Record<string, unknown>): void; error(m: string, f?: Record<string, unknown>): void };
  now: () => Date;
  /** Outbound throttle: true = allowed. */
  rate: (key: string, limit: number, windowMs: number) => Promise<boolean>;
}
