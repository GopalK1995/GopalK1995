// Two-way CRM sync engine shared by the Zoho CRM and HubSpot connectors (T048). Pure types: no server imports.
// The engine knows nothing about a vendor: a CrmGateway speaks to one vendor and exchanges "fields" keyed by the external field
// names used in integration_field_maps (synthetic ones such as Full_Name are produced and consumed by the gateway).
import type { ConnectorStore } from "../../core/ports";
import type { FieldMapSpec } from "../../core/types";
import type { ExistingIndex } from "@/lib/import/types";

export type CrmObject = "lead" | "contact" | "account" | "deal";
export const CRM_OBJECTS: readonly CrmObject[] = ["account", "contact", "lead", "deal"] as const;   // dependency order: lookups resolve parents first
export const OBJECT_TABLE: Record<CrmObject, string> = { lead: "leads", contact: "contacts", account: "accounts", deal: "deals" };
export const isCrmObject = (s: unknown): s is CrmObject => typeof s === "string" && (CRM_OBJECTS as readonly string[]).includes(s);

/** Columns a field map must never write, whatever a tenant row says: identity, isolation and bookkeeping columns. */
export const PROTECTED_COLUMNS: ReadonlySet<string> = new Set(["id", "tenant_id", "workspace_id", "created_at", "updated_at", "deleted_at", "external_ids", "external_data", "is_synthetic"]);
/** Columns that can never be null: a null from either side is ignored instead of written. */
export const REQUIRED_COLUMNS: Record<string, readonly string[]> = { leads: ["full_name"], contacts: ["full_name"], accounts: ["name"], deals: ["name", "stage_id"] };
/** Columns holding a reference to another synced object: the engine translates external id <-> local id through external_links. */
export const LOOKUP_COLUMNS: Record<string, Record<string, CrmObject>> = { contacts: { account_id: "account" }, deals: { account_id: "account", primary_contact_id: "contact" } };

export interface RemoteRecord { id: string; modifiedAt: string | null; fields: Record<string, unknown> }
export interface RemotePage { records: RemoteRecord[]; /** Opaque; the engine stores it per object and hands it back. */ cursor: unknown; done: boolean }

export class RecordRejected extends Error {
  /** `code` is a short vendor token (INVALID_DATA, duplicate...) and never carries record values. */
  constructor(public code: string, public duplicateId?: string) { super(`Vendor rejected the record (${code})`); this.name = "RecordRejected"; }
}

export interface CrmGateway {
  /** Remote object name used as `external_object` in links and field maps (Zoho "Leads", HubSpot "contacts"). */
  objectName(o: CrmObject): string;
  /** One page of records modified at or after the cursor's point in time. A null cursor starts at `startSince` (ISO) or the beginning. */
  list(o: CrmObject, cursor: unknown | null, wanted: string[], startSince: string | null): Promise<RemotePage>;
  getMany(o: CrmObject, ids: string[], wanted: string[]): Promise<RemoteRecord[]>;
  /** Throws RecordRejected for a vendor-side validation failure of this one record. */
  create(o: CrmObject, fields: Record<string, unknown>): Promise<{ id: string; modifiedAt: string | null }>;
  update(o: CrmObject, id: string, fields: Record<string, unknown>): Promise<{ modifiedAt: string | null }>;
}

export interface LocalRow { id: string; updatedAt: string | null; values: Record<string, unknown> }
export interface LinkInfo { id: string; externalObject: string; externalId: string; localId: string; hash: string | null }
export interface Stage { id: string; key: string }

/** Everything the engine needs from the database, in one port. The Supabase implementation is store-supabase.ts; tests use a fake. */
export interface CrmStore {
  core: Pick<ConnectorStore, "getFieldMap" | "getLink" | "putLink" | "touchLink" | "insertLocal" | "updateLocal" | "updateConnection">;
  getLinkByLocal(connectionId: string, table: string, localId: string): Promise<LinkInfo | null>;
  /** Rows by id, scoped to the workspace. Columns are the mapped system columns. */
  readLocal(table: string, workspaceId: string, ids: string[], columns: string[]): Promise<LocalRow[]>;
  /** Rows changed after the keyset (updated_at, id), oldest first, live rows only, scoped to the workspace. */
  listChangedLocal(table: string, workspaceId: string, after: { ts: string; id: string } | null, columns: string[], limit: number): Promise<LocalRow[]>;
  /** Duplicate keys of the workspace's live rows (the T034 planner input). */
  existingIndex(workspaceId: string, object: Exclude<CrmObject, "deal">): Promise<ExistingIndex>;
  listStages(workspaceId: string): Promise<Stage[]>;
  /** Merges into integrations.settings. */
  updateSettings(connectionId: string, patch: Record<string, unknown>): Promise<void>;
}

/** Per-connection options (integrations.settings). Defaults are the safe ones: nothing new is created at the vendor, local data is kept on a duplicate. */
export interface SyncOptions {
  objects: CrmObject[];
  /** Create a vendor record for each CRM record that has no link. Off unless the owner turns it on. */
  pushNew: boolean;
  /** Duplicate found while importing: keep the CRM's record (skip) or write the vendor's non-empty values over it (merge). */
  importMode: "skip" | "merge";
  /** Initial import reads only records modified since this ISO date (blank = everything). */
  importSince: string | null;
  /** HubSpot contacts land as leads (default) or contacts. */
  contactTarget: "lead" | "contact";
}
export const DEFAULT_OPTIONS: SyncOptions = { objects: [...CRM_OBJECTS], pushNew: false, importMode: "skip", importSince: null, contactTarget: "lead" };

export function optionsOf(settings: Record<string, unknown> | undefined): SyncOptions {
  const s = settings ?? {};
  const objs = Array.isArray(s.sync_objects) ? (s.sync_objects as unknown[]).filter(isCrmObject) : [];
  const since = typeof s.import_since === "string" && !Number.isNaN(Date.parse(s.import_since)) ? new Date(s.import_since).toISOString() : null;
  return {
    objects: objs.length ? CRM_OBJECTS.filter((o) => objs.includes(o)) : [...DEFAULT_OPTIONS.objects],
    pushNew: s.push_new === true,
    importMode: s.import_mode === "merge" ? "merge" : "skip",
    importSince: since,
    contactTarget: s.contact_target === "contact" ? "contact" : "lead",
  };
}

export interface EngineCtx {
  store: CrmStore;
  gateway: CrmGateway;
  conn: { id: string; tenantId: string; workspaceId: string };
  /** Vendor key written to leads.source and external_ids ("zoho", "hubspot"). */
  vendorKey: string;
  fieldMap: FieldMapSpec[];
  options: SyncOptions;
  runId: number;
  reject: (reason: string) => void;
  log: { info(m: string, f?: Record<string, unknown>): void; warn(m: string, f?: Record<string, unknown>): void };
  now: () => Date;
}

export interface Tally { created: number; linked: number; pulled: number; pushed: number; conflicts: number; noop: number; rejected: number }
export const emptyTally = (): Tally => ({ created: 0, linked: 0, pulled: 0, pushed: 0, conflicts: 0, noop: 0, rejected: 0 });
