// In-memory ConnectorStore + Vault for the connector framework tests. Time and ids are deterministic.
import type { ConnectionPatch, ConnectorStore, LinkRow, NewConnection, RunFinish, RunRow, RunStart, RuntimeDeps, VaultPort } from "../ports";
import type { AvailabilityRow } from "../status";
import type { ConnectionRow, ConsentPurpose, FieldMapSpec, Logger } from "../types";

export class FakeVault implements VaultPort {
  secrets = new Map<string, string>();
  n = 0;
  async putSecret(_name: string, value: string) { const id = `sec-${++this.n}`; this.secrets.set(id, value); return id; }
  async getSecret(id: string) { return this.secrets.get(id) ?? null; }
  async deleteSecret(id: string) { this.secrets.delete(id); }
}

export class FakeStore implements ConnectorStore {
  conns = new Map<string, ConnectionRow>();
  runs: (RunRow & { tenantId: string; mode: string })[] = [];
  cursors = new Map<string, unknown>();
  links: (LinkRow & { key: string; table: string })[] = [];
  tables: Record<string, Record<string, Record<string, unknown>>> = { leads: {} };
  availability: Record<string, AvailabilityRow | null> = {};
  fieldMap: FieldMapSpec[] = [];
  consent = new Map<string, boolean>();
  canContactCalls: string[] = [];
  private seq = 0;
  async getConnection(id: string) { return this.conns.get(id) ?? null; }
  async findConnection(ws: string, c: string) { return [...this.conns.values()].find((x) => x.workspaceId === ws && x.connectorId === c) ?? null; }
  async listActiveConnections() { return [...this.conns.values()].filter((c) => c.status === "connected" || c.status === "sandbox"); }
  async insertConnection(n: NewConnection) {
    const c: ConnectionRow = { id: `conn-${++this.seq}`, tenantId: n.tenantId, workspaceId: n.workspaceId, connectorId: n.connectorId as ConnectionRow["connectorId"], mode: n.mode, status: n.status, settings: {}, credentialSecretId: null, webhookSecretId: null, tokenExpiresAt: null };
    this.conns.set(c.id, c); return c;
  }
  async updateConnection(id: string, p: ConnectionPatch) {
    const c = this.conns.get(id); if (!c) throw new Error("no conn");
    const { externalAccountId: _a, externalAccountLabel: _b, oauthScopes: _c, connectedBy: _d, connectedAt: _e, disabledAt: _f, health: _g, ...rest } = p;
    void [_a, _b, _c, _d, _e, _f, _g];
    Object.assign(c, rest);
  }
  async getCursor(id: string, s: string) { return this.cursors.get(`${id}:${s}`) ?? null; }
  async setCursor(id: string, s: string, c: unknown) { this.cursors.set(`${id}:${s}`, c); }
  async startRun(r: RunStart) {
    const id = this.runs.length + 1;
    this.runs.push({ id, connectionId: r.connectionId, stream: r.stream, kind: r.kind, status: "running", startedAt: new Date(Date.now()).toISOString(), finishedAt: null, rowsIn: 0, rowsOut: 0, rowsRejected: 0, error: null, payloadSample: null, tenantId: r.tenantId, mode: r.mode });
    return id;
  }
  async finishRun(id: number, f: RunFinish) { Object.assign(this.runs[id - 1], { status: f.status, rowsIn: f.rowsIn, rowsOut: f.rowsOut, rowsRejected: f.rowsRejected, error: f.error ?? null, payloadSample: f.payloadSample ?? null, finishedAt: "done" }); }
  async findRunningRun(id: string, stream: string | null) { return this.runs.find((r) => r.connectionId === id && r.status === "running" && (!stream || r.stream === stream)) ?? null; }
  async listRuns(id: string, limit: number) { return this.runs.filter((r) => r.connectionId === id).slice(-limit); }
  async getFieldMap() { return this.fieldMap; }
  async getLink(id: string, o: string, e: string) { const l = this.links.find((x) => x.key === `${id}|${o}|${e}`); return l ?? null; }
  async putLink(l: { connectionId: string; externalObject: string; externalId: string; localTable: string; localId: string; contentHash: string }) {
    this.links.push({ id: `l-${this.links.length + 1}`, key: `${l.connectionId}|${l.externalObject}|${l.externalId}`, table: l.localTable, localTable: l.localTable, localId: l.localId, contentHash: l.contentHash });
  }
  async touchLink(id: string, hash: string) { const l = this.links.find((x) => x.id === id); if (l) l.contentHash = hash; }
  async findByMatchKey(table: string, _ws: string, k: { phone?: string; email?: string }) {
    for (const [id, row] of Object.entries(this.tables[table] ?? {})) if ((k.phone && row.phone === k.phone) || (k.email && row.email === k.email)) return id;
    return null;
  }
  async insertLocal(table: string, row: Record<string, unknown>) { const id = `${table}-${Object.keys(this.tables[table] ?? {}).length + 1}`; (this.tables[table] ??= {})[id] = row; return id; }
  async updateLocal(table: string, id: string, row: Record<string, unknown>) { Object.assign(this.tables[table][id], row); }
  async getAvailability(c: string) { return this.availability[c] ?? null; }
  async canContact(lead: string, _p: ConsentPurpose) { this.canContactCalls.push(lead); return this.consent.get(lead) ?? false; }
}

export const silentLog: Logger & { lines: string[] } = {
  lines: [],
  info(m, f) { this.lines.push(JSON.stringify([m, f])); },
  warn(m, f) { this.lines.push(JSON.stringify([m, f])); },
  error(m, f) { this.lines.push(JSON.stringify([m, f])); },
};

export function makeDeps(over: Partial<RuntimeDeps> = {}) {
  const store = new FakeStore(), vault = new FakeVault();
  store.availability.mock = { mode: "sandbox", gateStatus: "ready" };
  const audits: { action: string; summary: string; detail?: Record<string, unknown> }[] = [];
  const deps: RuntimeDeps = { store, vault, env: {}, log: silentLog, audit: async (e) => { audits.push(e); }, ...over };
  return { deps, store, vault, audits };
}
export const ACTOR = { uid: "u-1", tenantId: "t-1", workspaceId: "w-1" };
