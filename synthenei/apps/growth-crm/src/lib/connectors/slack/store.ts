// Persistence port for the Slack connector. The Supabase implementation (store-supabase.ts, service role) is the only one that touches
// tables; unit tests pass an in-memory fake. Every method is scoped by workspace: a subject of another workspace looks like a missing one.
import type { ConnectorStore, VaultPort } from "../core/ports";
import type { Subject } from "./alerts";

export type CoreConnPort = Pick<ConnectorStore, "getConnection" | "updateConnection" | "listActiveConnections">;

export interface SlackStore {
  /** Display facts for an alert: lead source/city/status (+ name), payment amount and the record it links to. Null when not in this workspace. */
  describe(workspaceId: string, objectType: string, objectId: string, withName: boolean): Promise<Subject | null>;
}

export interface SlackDeps {
  store: SlackStore;
  core: CoreConnPort;
  vault: VaultPort;
  log: { info(m: string, f?: Record<string, unknown>): void; warn(m: string, f?: Record<string, unknown>): void; error(m: string, f?: Record<string, unknown>): void };
  now: () => Date;
  /** True = allowed. Keyed per connection. */
  rate: (key: string, limit: number, windowMs: number) => Promise<boolean>;
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  /** Best-effort event emit (connector.sync.failed on a revoked token). */
  emit?: (e: { type: "connector.sync.failed"; workspaceId: string; objectId: string; data: Record<string, unknown> }) => Promise<void>;
}
