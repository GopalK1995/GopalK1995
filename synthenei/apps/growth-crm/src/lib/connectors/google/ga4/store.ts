// Persistence port for the GA4 connector. The Supabase implementation (store-supabase.ts, service role) is the only one that touches
// tables; unit tests pass an in-memory fake. Every method is scoped by tenant and workspace.
import type { ConnScope } from "../shared/mode";
import type { Ga4DailyRow } from "./report";

export type Ga4Source = "api" | "mock";

export interface Ga4Store {
  /**
   * Deletes this workspace's rows of the same source for the days since..until, so a re-read window REPLACES what was loaded (GA4
   * restates recent days and a dimension combination can disappear). Called once per window, before its first page is written.
   */
  clearWindow(scope: ConnScope, since: string, until: string, source: Ga4Source): Promise<void>;
  /** Upserts on the table key (workspace is derived from the tenant's row; the key includes the campaign when the column exists). */
  upsertDaily(rows: Ga4DailyRow[], ctx: ConnScope & { source: Ga4Source }): Promise<void>;
}

export interface Ga4Deps {
  store: Ga4Store;
  log: { info(m: string, f?: Record<string, unknown>): void; warn(m: string, f?: Record<string, unknown>): void; error(m: string, f?: Record<string, unknown>): void };
  now: () => Date;
}
