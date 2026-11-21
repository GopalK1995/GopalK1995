// In-memory LinkedInStore + core lead port for unit tests: enforces the rules the database does (asset ownership, upsert by campaign + day).
import type { LinkRow } from "../../core/ports";
import type { FieldMapSpec } from "../../core/types";
import type { AccountRegistration, ConsentEntry, CoreLeadPort, DailyMetricRow, LinkedInDeps, LinkedInStore, RegisterResult } from "../store";

export class FakeStore implements LinkedInStore, CoreLeadPort {
  n = 0; accounts: AccountRegistration[] = []; campaigns: { id: string; workspaceId: string; externalId: string; name: string; synthetic: boolean }[] = [];
  metrics = new Map<string, DailyMetricRow & { source: string }>(); consent: ConsentEntry[] = []; leads: Record<string, unknown>[] = [];
  events: { type: string; data: Record<string, unknown> }[] = []; links = new Map<string, LinkRow>(); fieldMap: FieldMapSpec[] = [];
  private id(p: string) { return `${p}-${++this.n}`; }

  async registerAccount(a: AccountRegistration): Promise<RegisterResult> {
    if (this.accounts.some((o) => o.workspaceId !== a.workspaceId && o.accountId === a.accountId)) return { ok: false, reason: "account_taken" };
    this.accounts = this.accounts.filter((o) => o.connectionId !== a.connectionId); this.accounts.push(a);
    return { ok: true };
  }
  async ensureCampaign(i: { workspaceId: string; externalId: string; name: string; placeholder: boolean; synthetic: boolean }) {
    const f = this.campaigns.find((c) => c.workspaceId === i.workspaceId && c.externalId === i.externalId);
    if (f) { if (!i.placeholder && f.name.startsWith("LinkedIn campaign ")) f.name = i.name; return f.id; }
    const c = { id: this.id("camp"), workspaceId: i.workspaceId, externalId: i.externalId, name: i.name, synthetic: i.synthetic }; this.campaigns.push(c); return c.id;
  }
  async upsertDailyMetrics(rows: DailyMetricRow[], ctx: { source: "api" | "mock" }) { for (const r of rows) this.metrics.set(`${r.campaignId}|${r.day}`, { ...r, source: ctx.source }); }
  async recordConsentOnce(c: ConsentEntry) {
    if (this.consent.some((x) => x.leadId === c.leadId && x.purpose === c.purpose && x.note === c.note)) return false;
    this.consent.push(c); return true;
  }
  async emit(e: { type: string; data: Record<string, unknown> }) { this.events.push({ type: e.type, data: e.data }); }

  // CoreLeadPort
  async getFieldMap() { return this.fieldMap; }
  async getLink(_c: string, obj: string, ext: string) { return this.links.get(`${obj}|${ext}`) ?? null; }
  async putLink(l: { externalObject: string; externalId: string; localTable: string; localId: string; contentHash: string }) { this.links.set(`${l.externalObject}|${l.externalId}`, { id: this.id("link"), localTable: l.localTable, localId: l.localId, contentHash: l.contentHash }); }
  async touchLink() {}
  async findByMatchKey(_t: string, ws: string, k: { phone?: string; email?: string }) {
    const l = this.leads.find((x) => x.workspace_id === ws && ((k.phone && x.phone === k.phone) || (k.email && x.email === k.email))); return l ? String(l.id) : null;
  }
  async insertLocal(_t: string, row: Record<string, unknown>) { const id = this.id("lead"); this.leads.push({ ...row, id }); return id; }
  async updateLocal(_t: string, id: string, row: Record<string, unknown>) { Object.assign(this.leads.find((x) => x.id === id)!, row); }
}

export const CONN = { id: "5f0c1d52-8a7e-4b1c-9d3e-0a1b2c3d4e5f", tenantId: "t-1", workspaceId: "w-1", connectorId: "linkedin" as const, mode: "sandbox" as const, status: "sandbox" as const, settings: {} as Record<string, unknown>, credentialSecretId: "c", webhookSecretId: null, tokenExpiresAt: null as string | null };
export const NOW = new Date("2026-11-09T05:00:00Z");   // 10:30 IST
export function fakeDeps(now: Date = NOW): LinkedInDeps & { store: FakeStore; core: FakeStore } {
  const s = new FakeStore();
  return { store: s, core: s, log: { info() {}, warn() {}, error() {} }, now: () => now };
}
