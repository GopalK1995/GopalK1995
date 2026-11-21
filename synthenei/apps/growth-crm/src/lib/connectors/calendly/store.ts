// Persistence port for the booking connectors. The Supabase implementation (store-supabase.ts, service role) is the only one that
// touches tables; unit tests pass an in-memory fake. Every method is scoped by workspace (and the connection for calendar rows).
export interface LeadHit { id: string; ownerId: string | null }
export type CalendarOutcome = "created" | "updated" | "cancelled" | "already_cancelled" | "stale" | "unchanged" | "missing";
export interface CalendarUpsert {
  tenantId: string; workspaceId: string; integrationId: string; externalId: string;
  startsAt: string; endsAt: string; title: string; leadId: string | null; status: "confirmed" | "cancelled";
  /** Cancelling only: never create a row for a booking we never saw (the old half of a reschedule). */
  onlyIfExists?: boolean;
}
export interface NewTask { tenantId: string; workspaceId: string; leadId: string; assigneeId: string | null; title: string; kind: "demo_prep" | "follow_up"; priority: 1 | 2 | 3; dueAt: string }
export type BookingEventType = "booking.created" | "booking.cancelled" | "booking.unmatched";
export interface NewNotice {
  tenantId: string; workspaceId: string; userIds: string[]; kind: BookingEventType;
  objectType: string | null; objectId: string | null; title: Record<string, string>; body: Record<string, string>; url: string | null; dedupe: string;
}

export interface BookingStore {
  /** Case-insensitive email match inside ONE workspace; soft-deleted leads are not matched. Null when none. */
  findLeadByEmail(workspaceId: string, email: string): Promise<LeadHit | null>;
  /** Forward-only (confirmed -> cancelled). Keyed by (integration, external id), so a redelivery or a second connection never collides. */
  upsertCalendarEvent(r: CalendarUpsert): Promise<{ outcome: CalendarOutcome; id: string | null; leadId: string | null }>;
  /** Returns true when a task was written; false when the same task (lead + title) already exists. */
  insertTaskOnce(t: NewTask): Promise<boolean>;
  /** Active owners of the workspace (fallback recipients). */
  workspaceOwners(workspaceId: string): Promise<string[]>;
  /** One in-app notification per user per dedupe key; returns how many were written. */
  notifyOnce(n: NewNotice): Promise<number>;
  emit(e: { type: BookingEventType; workspaceId: string; objectType: string; objectId: string; data: Record<string, unknown> }): Promise<void>;
}

export interface BookingDeps {
  store: BookingStore;
  log: { info(m: string, f?: Record<string, unknown>): void; warn(m: string, f?: Record<string, unknown>): void; error(m: string, f?: Record<string, unknown>): void };
  now: () => Date;
}
