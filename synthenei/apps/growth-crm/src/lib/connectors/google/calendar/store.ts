// Persistence port for the calendar connector. Supabase implementation: store-supabase.ts (service role). Unit tests use a fake.
// Every method is scoped by tenant and workspace.
import type { ConnScope } from "../shared/mode";
import type { CalRow, Existing, LocalEvent, ObjectRef } from "./types";

export interface CalendarStore {
  /** Local rows already linked to these external ids, with their content signature. */
  findByExternal(scope: ConnScope, externalIds: string[]): Promise<Map<string, Existing>>;
  /** Inserts or updates by (integration, external id). */
  upsertRemote(scope: ConnScope, rows: CalRow[], existing: Map<string, Existing>): Promise<void>;
  /** Marks an already-stored row cancelled; false when there was none (nothing is created for a cancellation). */
  cancelRemote(scope: ConnScope, externalId: string): Promise<boolean>;
  /** CRM-side rows to push: not linked yet (and not cancelled), or linked to this connection and changed since `sinceIso`. Oldest first. */
  listPushCandidates(scope: ConnScope, sinceIso: string | null, limit: number): Promise<LocalEvent[]>;
  markLinked(scope: ConnScope, localId: string, externalId: string): Promise<void>;
  /** Creates a CRM-side row already linked to its Google event. */
  insertLinked(scope: ConnScope, row: Omit<CalRow, "remoteUpdated" | "kind">): Promise<string>;
  /** Known leads / contacts of THIS workspace by lower-case email. */
  contactsByEmail(scope: ConnScope, emails: string[]): Promise<Map<string, ObjectRef>>;
}

export interface CalendarDeps {
  store: CalendarStore;
  log: { info(m: string, f?: Record<string, unknown>): void; warn(m: string, f?: Record<string, unknown>): void; error(m: string, f?: Record<string, unknown>): void };
  now: () => Date;
}
