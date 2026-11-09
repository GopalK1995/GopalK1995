// Persistence port for the email connector (and the Mailchimp connector, which shares consent + suppression handling).
// The Supabase implementation (store-supabase.ts, service role) is the only code that touches tables; unit tests pass an in-memory
// fake. Every method is scoped by tenant and/or workspace: nothing here reads across tenants.
import type { SuppressionEntry, SuppressionReason } from "./suppression";

export interface Scope { tenantId: string; workspaceId: string; connectionId: string }
export interface Recipient { leadId: string; email: string | null; fullName: string; firstName: string; company: string | null; district: string | null }

export interface OutboundRow {
  id: string; tenantId: string; workspaceId: string; conversationId: string; status: string; body: string | null; subject: string | null;
  templateId: string | null; isInternalNote: boolean; channel: string; leadId: string | null; to: string | null;
}
export interface OutboundPatch { status: string; externalId?: string | null; statusAt: string; errorCode?: string | null; errorDetail?: string | null }
export interface TemplateRow { id: string; name: string; subject: string | null; body: string; status: string; channel: string }
export interface NewOutbound { tenantId: string; workspaceId: string; leadId: string; email: string; subject: string; body: string; templateId: string | null }

export interface ConsentEntry { tenantId: string; workspaceId: string; leadId: string | null; subjectRef: string; action: "granted" | "withdrawn"; note: string }
export interface NewSuppression { tenantId: string; workspaceId: string; email: string; reason: SuppressionReason; source: string; leadId?: string | null }

export interface EmailEvent { type: "message.sent" | "message.status" | "consent.changed" | "email.bounced" | "email.complained" | "email.unsubscribed" | "email.suppressed"; workspaceId: string; objectType: string; objectId: string; data: Record<string, unknown> }

export interface EmailStore {
  getRecipient(workspaceId: string, leadId: string): Promise<Recipient | null>;
  /** Live leads of the workspace whose lower(email) equals `email`. */
  findLeadsByEmail(workspaceId: string, email: string): Promise<string[]>;
  /** public.can_contact(lead, 'marketing_email'). Throws on a database error (fail closed). */
  canContact(leadId: string): Promise<boolean>;
  /** Latest marketing_email consent action for the lead, or null when none is recorded. */
  latestConsent(leadId: string): Promise<"granted" | "withdrawn" | null>;
  recordConsent(c: ConsentEntry): Promise<void>;

  isSuppressed(workspaceId: string, email: string): Promise<boolean>;
  /** Idempotent: an address already suppressed keeps its first reason. Returns true when a row was added. */
  addSuppression(s: NewSuppression): Promise<boolean>;
  listSuppressions(workspaceId: string, limit: number): Promise<SuppressionEntry[]>;

  getOutbound(id: string): Promise<OutboundRow | null>;
  listQueuedOutbound(workspaceId: string, limit: number): Promise<string[]>;
  patchOutbound(id: string, patch: OutboundPatch): Promise<void>;
  /** Creates the conversation (per workspace + address) and an outbound message; returns the message id. Idempotent on `providerId`. */
  createOutbound(m: NewOutbound, opts?: { status: "queued" | "sent"; providerId?: string; at?: string }): Promise<string>;
  /** Delivery status by the provider's message id; never moves a message backwards. */
  applyStatus(tenantId: string, providerId: string, status: "sent" | "delivered" | "failed", atIso: string, error?: { code: string }): Promise<{ result: "updated" | "ignored" | "unknown"; messageId?: string; leadId?: string | null }>;
  /** Recipient address of a message (for webhook suppression when the event omits it). */
  messageRecipient(tenantId: string, providerId: string): Promise<{ email: string | null; leadId: string | null } | null>;

  getTemplate(tenantId: string, id: string): Promise<TemplateRow | null>;
  emit(e: EmailEvent): Promise<void>;
  /** Audit trail entry; a failure is logged by the caller, never silently dropped by the store. */
  audit(a: { workspaceId: string; action: string; summary: string; objectId: string; detail?: Record<string, unknown> }): Promise<void>;
}

export interface EmailDeps {
  store: EmailStore;
  log: { info(m: string, f?: Record<string, unknown>): void; warn(m: string, f?: Record<string, unknown>): void; error(m: string, f?: Record<string, unknown>): void };
  now: () => Date;
  /** Throttle: true = allowed. */
  rate: (key: string, limit: number, windowMs: number) => Promise<boolean>;
  /** Public base URL for links (APP_BASE_URL) and the unsubscribe signing key, read from the env by the runtime. */
  baseUrl: string;
  unsubscribeSecret: string;
}
