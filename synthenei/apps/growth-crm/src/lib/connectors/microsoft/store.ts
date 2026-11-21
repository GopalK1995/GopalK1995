// Persistence port for the Outlook connector. Supabase implementation in store-supabase.ts (service role); tests pass a fake.
// Mail lands in conversations / messages (0001 + workspace_id), the calendar in calendar_events (0019). Every method is scoped by tenant and
// workspace (and the connection for calendar rows): the service role does not get RLS, so the scoping is the isolation.
export interface Scope { tenantId: string; workspaceId: string; connectionId: string }
export interface KnownContact { leadId: string | null; contactId: string | null }

export interface MailUpsert extends Scope {
  threadId: string; externalId: string; direction: "inbound" | "outbound"; subject: string; preview: string; at: string; leadId: string | null; contactId: string | null;
}
export type CalendarOutcome = "created" | "updated" | "cancelled" | "unchanged" | "stale";
export interface CalendarUpsert extends Scope {
  externalId: string; startsAt: string; endsAt: string; title: string; status: "confirmed" | "tentative" | "cancelled"; leadId: string | null;
}

export interface MsStore {
  /** Exact, case-insensitive email match inside ONE workspace (leads and contacts, soft-deleted ones excluded). Keys are the lower-cased input. */
  matchContacts(scope: { tenantId: string; workspaceId: string }, emails: string[]): Promise<Map<string, KnownContact>>;
  /** One conversation per (workspace, connection thread), one message per (conversation, external id). Idempotent. */
  upsertMail(m: MailUpsert): Promise<"created" | "unchanged">;
  /** Keyed by (connection, external id); a cancelled event never comes back to life from a stale update. */
  upsertCalendarEvent(r: CalendarUpsert): Promise<{ outcome: CalendarOutcome }>;
  /** Event deleted in Outlook: marks a row we hold as cancelled (never creates one). */
  cancelCalendarEvent(scope: Scope, externalId: string): Promise<"cancelled" | "unchanged" | "missing">;
}
export interface MsDeps {
  store: MsStore;
  log: { info(m: string, f?: Record<string, unknown>): void; warn(m: string, f?: Record<string, unknown>): void; error(m: string, f?: Record<string, unknown>): void };
  now: () => Date;
}
