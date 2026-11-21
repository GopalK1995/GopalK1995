// In-memory CrmStore + CrmGateway for the engine tests. Time is a counter, ids are deterministic. The store enforces what the
// database does that matters here: workspace scoping, updated_at bumped on every write, links unique per (connection, object, id).
import { indexRow } from "@/lib/import/dedupe";
import { emptyIndex, type ExistingIndex } from "@/lib/import/types";
import { FakeStore } from "../../core/__tests__/fakes";
import type { FieldMapSpec } from "../../core/types";
import { RecordRejected, DEFAULT_OPTIONS, type CrmGateway, type CrmObject, type CrmStore, type EngineCtx, type LinkInfo, type LocalRow, type RemotePage, type RemoteRecord, type Stage, type SyncOptions } from "../engine/types";
import { OBJECT_TABLE } from "../engine/types";

export const TENANT = "t-1", WS = "w-1", CONN = "conn-1";
export const STAGES: Stage[] = [{ id: "st-discovery", key: "discovery" }, { id: "st-proposal", key: "proposal" }, { id: "st-won", key: "won" }, { id: "st-lost", key: "lost" }];

export class Clock { n = 0; tick(): string { return new Date(Date.UTC(2026, 10, 1, 0, 0, ++this.n)).toISOString(); } }

type Row = Record<string, unknown>;
class StampingStore extends FakeStore {
  constructor(private clock: Clock) { super(); }
  async insertLocal(table: string, row: Row) { return super.insertLocal(table, { ...row, updated_at: this.clock.tick() }); }
  async updateLocal(table: string, id: string, row: Row) { return super.updateLocal(table, id, { ...row, updated_at: this.clock.tick() }); }
}

export class FakeCrmStore implements CrmStore {
  clock = new Clock();
  core = new StampingStore(this.clock);
  settings: Row = {};
  stages: Stage[] = STAGES;
  reads: string[] = [];
  /** Test helper: a local edit (what a user does in the CRM). */
  edit(table: string, id: string, patch: Row) { Object.assign(this.core.tables[table][id], patch, { updated_at: this.clock.tick() }); }
  seed(table: string, row: Row): string {
    const id = `${table}-seed-${Object.keys(this.core.tables[table] ?? {}).length + 1}`;
    (this.core.tables[table] ??= {})[id] = { workspace_id: WS, tenant_id: TENANT, updated_at: this.clock.tick(), ...row };
    return id;
  }
  row(table: string, id: string): Row { return this.core.tables[table][id]; }
  all(table: string): Row[] { return Object.values(this.core.tables[table] ?? {}); }

  async getLinkByLocal(connectionId: string, table: string, localId: string): Promise<LinkInfo | null> {
    const l = this.core.links.find((x) => x.key.startsWith(`${connectionId}|`) && x.localTable === table && x.localId === localId);
    if (!l) return null;
    const [, externalObject, externalId] = l.key.split("|");
    return { id: l.id, externalObject, externalId, localId: l.localId, hash: l.contentHash };
  }
  private view(table: string, id: string, cols: string[]): LocalRow {
    const r = this.core.tables[table][id];
    return { id, updatedAt: (r.updated_at as string) ?? null, values: Object.fromEntries(cols.map((c) => [c, r[c] ?? null])) };
  }
  async readLocal(table: string, workspaceId: string, ids: string[], columns: string[]) {
    this.reads.push(`${table}:${ids.join(",")}`);
    return ids.filter((id) => this.core.tables[table]?.[id] && this.core.tables[table][id].workspace_id === workspaceId && !this.core.tables[table][id].deleted_at).map((id) => this.view(table, id, columns));
  }
  async listChangedLocal(table: string, workspaceId: string, after: { ts: string; id: string } | null, columns: string[], limit: number) {
    return Object.entries(this.core.tables[table] ?? {})
      .filter(([, r]) => r.workspace_id === workspaceId && !r.deleted_at)
      .map(([id, r]) => ({ id, ts: String(r.updated_at) }))
      .filter((x) => !after || x.ts > after.ts || (x.ts === after.ts && x.id > after.id))
      .sort((a, b) => (a.ts === b.ts ? a.id.localeCompare(b.id) : a.ts.localeCompare(b.ts)))
      .slice(0, limit).map((x) => this.view(table, x.id, columns));
  }
  async existingIndex(workspaceId: string, object: "lead" | "contact" | "account"): Promise<ExistingIndex> {
    const idx = emptyIndex();
    for (const [id, r] of Object.entries(this.core.tables[OBJECT_TABLE[object]] ?? {})) if (r.workspace_id === workspaceId && !r.deleted_at) indexRow(object, { id, email: r.email as string, phone: r.phone as string, name: r.name as string, city: r.city as string }, idx);
    return idx;
  }
  async listStages() { return this.stages; }
  async updateSettings(_id: string, patch: Row) { Object.assign(this.settings, patch); }
}

export interface FakeRemote { id: string; modifiedAt: string; fields: Row }
export class FakeGateway implements CrmGateway {
  clock = new Clock();
  records: Record<string, Map<string, FakeRemote>> = {};
  calls: string[] = [];
  pageSize = 100;
  /** Fields whose value makes the vendor reject a write (RecordRejected with this code). */
  rejectWhen: { field: string; value: unknown; code: string }[] = [];
  duplicateOnCreate: string | null = null;
  private n = 100;
  constructor(public names: Record<CrmObject, string> = { lead: "Leads", contact: "Contacts", account: "Accounts", deal: "Deals" }) {}
  objectName(o: CrmObject) { return this.names[o]; }
  private bucket(o: CrmObject) { return (this.records[this.names[o]] ??= new Map()); }
  put(o: CrmObject, id: string, fields: Row): FakeRemote { const r = { id, modifiedAt: this.clock.tick(), fields }; this.bucket(o).set(id, r); return r; }
  get(o: CrmObject, id: string): FakeRemote { return this.bucket(o).get(id) as FakeRemote; }
  edit(o: CrmObject, id: string, patch: Row) { const r = this.get(o, id); Object.assign(r.fields, patch); r.modifiedAt = this.clock.tick(); }

  async list(o: CrmObject, cursor: unknown, _wanted: string[], startSince: string | null): Promise<RemotePage> {
    this.calls.push(`list:${this.names[o]}`);
    const cur = (cursor as { since: string; offset: number } | null) ?? { since: startSince ?? "", offset: 0 };
    const all = [...this.bucket(o).values()].filter((r) => r.modifiedAt >= cur.since).sort((a, b) => a.modifiedAt.localeCompare(b.modifiedAt));
    const page = all.slice(cur.offset, cur.offset + this.pageSize);
    const more = cur.offset + this.pageSize < all.length;
    const records: RemoteRecord[] = page.map((r) => ({ id: r.id, modifiedAt: r.modifiedAt, fields: { ...r.fields } }));
    return more ? { records, cursor: { since: cur.since, offset: cur.offset + this.pageSize }, done: false } : { records, cursor: { since: records.length ? records[records.length - 1].modifiedAt : cur.since, offset: 0 }, done: true };
  }
  async getMany(o: CrmObject, ids: string[]) { this.calls.push(`getMany:${this.names[o]}:${ids.join(",")}`); return ids.map((i) => this.bucket(o).get(i)).filter((r): r is FakeRemote => !!r).map((r) => ({ id: r.id, modifiedAt: r.modifiedAt, fields: { ...r.fields } })); }
  private check(fields: Row) { for (const r of this.rejectWhen) if (fields[r.field] === r.value) throw new RecordRejected(r.code); }
  async create(o: CrmObject, fields: Row) {
    this.calls.push(`create:${this.names[o]}`);
    if (this.duplicateOnCreate) throw new RecordRejected("DUPLICATE_DATA", this.duplicateOnCreate);
    this.check(fields);
    const id = String(++this.n);
    const r = this.put(o, id, { ...fields });
    return { id, modifiedAt: r.modifiedAt };
  }
  async update(o: CrmObject, id: string, fields: Row) {
    this.calls.push(`update:${this.names[o]}:${JSON.stringify(fields)}`);
    this.check(fields);
    this.edit(o, id, fields);
    return { modifiedAt: this.get(o, id).modifiedAt };
  }
}

let run = 0;   // run ids are global, like sync_runs ids: the engine caches per run
export interface Harness { store: FakeCrmStore; gw: FakeGateway; ctx: EngineCtx; rejects: string[]; withOptions(o: Partial<SyncOptions>): EngineCtx }
export function harness(map: FieldMapSpec[], opts: Partial<SyncOptions> = {}, names?: Record<CrmObject, string>): Harness {
  const store = new FakeCrmStore(), gw = new FakeGateway(names), rejects: string[] = [];

  const build = (o: Partial<SyncOptions>): EngineCtx => ({
    store, gateway: gw, conn: { id: CONN, tenantId: TENANT, workspaceId: WS }, vendorKey: "zoho", fieldMap: map, options: { ...DEFAULT_OPTIONS, ...opts, ...o },
    runId: ++run, reject: (r) => rejects.push(r), log: { info() {}, warn() {} }, now: () => new Date("2026-11-21T00:00:00Z"),
  });
  return { store, gw, rejects, ctx: build({}), withOptions: build };
}
