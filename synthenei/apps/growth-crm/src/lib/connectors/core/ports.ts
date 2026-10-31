// Ports the framework runs against. The Supabase implementations live in store-supabase.ts / vault.ts; unit tests pass fakes.
import type { AvailabilityRow } from "./status";
import type { ConnectionRow, ConnectionSecrets, ConnMode, ConnectorDef, ConsentPurpose, FieldMapSpec, IntegrationStatus, Logger, UpsertTarget, VendorHttp } from "./types";

export interface NewConnection {
  tenantId: string; workspaceId: string; connectorId: string; label: string; category: string; direction: "in" | "out" | "both";
  mode: ConnMode; status: IntegrationStatus; connectedBy: string;
}
export interface ConnectionPatch {
  status?: IntegrationStatus; mode?: ConnMode; credentialSecretId?: string | null; webhookSecretId?: string | null;
  tokenExpiresAt?: string | null; lastSyncAt?: string | null; lastError?: string | null;
  externalAccountId?: string | null; externalAccountLabel?: string | null; oauthScopes?: string[] | null;
  connectedBy?: string | null; connectedAt?: string | null; disabledAt?: string | null; health?: Record<string, unknown>;
}

export interface RunStart { connectionId: string; tenantId: string; workspaceId: string; kind: "poll" | "webhook" | "csv" | "outbound" | "manual"; stream: string | null; mode: ConnMode; startedBy?: string | null }
export interface RunFinish { status: "success" | "partial" | "failed"; rowsIn: number; rowsOut: number; rowsRejected: number; error?: string | null; payloadSample?: unknown }
export interface RunRow { id: number; connectionId: string; stream: string | null; kind: string; status: "running" | "success" | "partial" | "failed"; startedAt: string; finishedAt: string | null; rowsIn: number; rowsOut: number; rowsRejected: number; error: string | null; payloadSample: unknown }

export interface LinkRow { id: string; localTable: string; localId: string; contentHash: string | null }

export interface ConnectorStore {
  getConnection(id: string): Promise<ConnectionRow | null>;
  findConnection(workspaceId: string, connectorId: string): Promise<ConnectionRow | null>;
  listActiveConnections(): Promise<ConnectionRow[]>;
  insertConnection(n: NewConnection): Promise<ConnectionRow>;
  updateConnection(id: string, patch: ConnectionPatch): Promise<void>;
  getCursor(connectionId: string, stream: string): Promise<unknown>;
  setCursor(connectionId: string, stream: string, cursor: unknown): Promise<void>;
  startRun(r: RunStart): Promise<number>;
  finishRun(id: number, f: RunFinish): Promise<void>;
  /** A run for this connection+stream still marked running that started after `sinceIso`. */
  findRunningRun(connectionId: string, stream: string | null, sinceIso: string): Promise<RunRow | null>;
  listRuns(connectionId: string, limit: number): Promise<RunRow[]>;
  getFieldMap(connectionId: string): Promise<FieldMapSpec[]>;
  getLink(connectionId: string, externalObject: string, externalId: string): Promise<LinkRow | null>;
  putLink(l: { tenantId: string; workspaceId: string; connectionId: string; externalObject: string; externalId: string; localTable: string; localId: string; contentHash: string; direction: "in" | "out" | "both" }): Promise<void>;
  touchLink(id: string, contentHash: string): Promise<void>;
  /** Match keys for dedupe: E.164 phone, lower(email). Returns an existing local row id or null. */
  findByMatchKey(table: string, workspaceId: string, keys: { phone?: string; email?: string }): Promise<string | null>;
  insertLocal(table: string, row: Record<string, unknown>): Promise<string>;
  updateLocal(table: string, id: string, row: Record<string, unknown>): Promise<void>;
  /** Platform availability row for this environment (connector_availability), or null when none. */
  getAvailability(connectorId: string): Promise<AvailabilityRow | null>;
  /** public.can_contact(p_lead, p_purpose). */
  canContact(leadId: string, purpose: ConsentPurpose): Promise<boolean>;
}

export interface VaultPort {
  putSecret(name: string, value: string): Promise<string>;
  getSecret(id: string): Promise<string | null>;
  deleteSecret(id: string): Promise<void>;
}

export const TARGET_TABLE: Record<Exclude<UpsertTarget, `obj:${string}`>, string> = {
  lead: "leads", contact: "contacts", account: "accounts", deal: "deals", campaign_daily: "campaign_daily_metrics", ga4_daily: "ga4_daily",
  message: "messages", conversation: "conversations", payment: "payments", calendar_event: "calendar_events", review: "reviews",
};
export type { ConnectionSecrets };

/** Everything the lifecycle and the sync runner need, injected so tests run with fakes and no network. */
export interface RuntimeDeps {
  store: ConnectorStore;
  vault: VaultPort;
  env: Record<string, string | undefined>;
  log: Logger;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  /** Builds the vendor HTTP client for a definition (tests return a scripted client). */
  http?: (def: ConnectorDef) => VendorHttp;
  /** Best-effort event emit (connector.sync.completed|failed). */
  emit?: (e: { type: "connector.sync.completed" | "connector.sync.failed"; workspaceId: string; objectId: string; data: Record<string, unknown> }) => Promise<void>;
  /** Audit trail for connect/disconnect; a failure here stops the action (audit or nothing). */
  audit?: (e: { action: string; summary: string; connectionId: string; detail?: Record<string, unknown> }) => Promise<void>;
}
