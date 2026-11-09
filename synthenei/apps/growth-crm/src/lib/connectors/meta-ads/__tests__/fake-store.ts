// In-memory MetaStore + core lead port for unit tests: enforces the rules the database does (unique mid, asset ownership, upsert by campaign + day).
import type { LinkRow } from "../../core/ports";
import type { FieldMapSpec } from "../../core/types";
import type { AssetRegistration, ConsentEntry, ConversationRef, CoreLeadPort, DailyMetricRow, InsertResult, MetaDeps, MetaStore, NewInboundMessage, OutboundPatch, OutboundRow, RegisterResult } from "../store";

export interface Msg { id: string; tenantId: string; workspaceId: string; conversationId: string; direction: "inbound" | "outbound"; status: string; body: string | null; externalId: string | null; isNote: boolean; errorCode?: string | null }
export interface Conv { id: string; tenantId: string; workspaceId: string; threadId: string; leadId: string | null; lastInboundAt: string | null; status: string; channel: string }

export class FakeStore implements MetaStore, CoreLeadPort {
  n = 0; assets: AssetRegistration[] = []; campaigns: { id: string; workspaceId: string; externalId: string; name: string; synthetic: boolean }[] = []; metrics = new Map<string, DailyMetricRow & { source: string }>();
  consent: ConsentEntry[] = []; msgs: Msg[] = []; convs: Conv[] = []; leads: Record<string, unknown>[] = []; events: { type: string; data: Record<string, unknown> }[] = [];
  links = new Map<string, LinkRow>(); fieldMap: FieldMapSpec[] = [];
  private id(p: string) { return `${p}-${++this.n}`; }

  async registerAssets(a: AssetRegistration): Promise<RegisterResult> {
    if (this.assets.some((o) => o.workspaceId !== a.workspaceId && o.pageId === a.pageId)) return { ok: false, reason: "page_taken" };
    if (a.igUserId && this.assets.some((o) => o.workspaceId !== a.workspaceId && o.igUserId === a.igUserId)) return { ok: false, reason: "ig_taken" };
    this.assets = this.assets.filter((o) => o.connectionId !== a.connectionId); this.assets.push(a);
    return { ok: true };
  }
  async ensureCampaign(i: { tenantId: string; workspaceId: string; externalId: string; name: string; synthetic: boolean }) {
    const f = this.campaigns.find((c) => c.workspaceId === i.workspaceId && c.externalId === i.externalId);
    if (f) return f.id;
    const c = { id: this.id("camp"), workspaceId: i.workspaceId, externalId: i.externalId, name: i.name, synthetic: i.synthetic }; this.campaigns.push(c); return c.id;
  }
  async upsertDailyMetrics(rows: DailyMetricRow[], ctx: { source: "api" | "mock" }) { for (const r of rows) this.metrics.set(`${r.campaignId}|${r.day}`, { ...r, source: ctx.source }); }
  async recordConsentOnce(c: ConsentEntry) {
    if (this.consent.some((x) => x.leadId === c.leadId && x.purpose === c.purpose && x.note === c.note)) return false;
    this.consent.push(c); return true;
  }
  async findMessageByExternalId(tenantId: string, ext: string) { const m = this.msgs.find((x) => x.tenantId === tenantId && x.externalId === ext); return m ? { id: m.id, conversationId: m.conversationId } : null; }
  async upsertConversation(c: { tenantId: string; workspaceId: string; threadId: string; leadId: string | null }): Promise<ConversationRef> {
    const f = this.convs.find((x) => x.workspaceId === c.workspaceId && x.threadId === c.threadId);
    if (f) { if (!f.leadId && c.leadId) f.leadId = c.leadId; return { id: f.id, leadId: f.leadId, lastInboundAt: f.lastInboundAt, status: f.status, created: false }; }
    const v: Conv = { id: this.id("conv"), ...c, lastInboundAt: null, status: "open", channel: "instagram" }; this.convs.push(v);
    return { id: v.id, leadId: v.leadId, lastInboundAt: null, status: "open", created: true };
  }
  async insertInbound(m: NewInboundMessage): Promise<InsertResult> {
    if (this.msgs.some((x) => x.tenantId === m.tenantId && x.externalId === m.mid)) return { duplicate: true };
    const v: Msg = { id: this.id("msg"), tenantId: m.tenantId, workspaceId: m.workspaceId, conversationId: m.conversationId, direction: "inbound", status: "received", body: m.body, externalId: m.mid, isNote: false }; this.msgs.push(v); return { id: v.id };
  }
  async touchInbound(cid: string, at: string, leadId: string | null) {
    const c = this.convs.find((x) => x.id === cid)!;
    if (!c.lastInboundAt || Date.parse(c.lastInboundAt) < Date.parse(at)) c.lastInboundAt = at;
    c.status = "open"; if (!c.leadId && leadId) c.leadId = leadId;
  }
  async findLeadByIgsid(ws: string, igsid: string) { const l = this.leads.find((x) => x.workspace_id === ws && (x.external_ids as Record<string, string>)?.instagram_igsid === igsid); return l ? String(l.id) : null; }
  async createLead(row: Record<string, unknown>) { const id = this.id("lead"); this.leads.push({ ...row, id }); return id; }
  async getOutbound(id: string): Promise<OutboundRow | null> {
    const m = this.msgs.find((x) => x.id === id && x.direction === "outbound"); if (!m) return null;
    const c = this.convs.find((x) => x.id === m.conversationId)!;
    return { id: m.id, tenantId: m.tenantId, workspaceId: m.workspaceId, conversationId: c.id, status: m.status, body: m.body, isInternalNote: m.isNote, channel: c.channel, leadId: c.leadId, threadId: c.threadId, lastInboundAt: c.lastInboundAt };
  }
  async listQueuedOutbound(ws: string) { return this.msgs.filter((m) => m.workspaceId === ws && m.direction === "outbound" && m.status === "queued" && !m.isNote).map((m) => m.id); }
  async patchOutbound(id: string, p: OutboundPatch) { const m = this.msgs.find((x) => x.id === id)!; m.status = p.status; if (p.externalId !== undefined) m.externalId = p.externalId; if (p.errorCode !== undefined) m.errorCode = p.errorCode; }
  async emit(e: { type: string; data: Record<string, unknown> }) { this.events.push({ type: e.type, data: e.data }); }
  addOutbound(o: { body: string; lastInboundAt: string | null; workspaceId?: string; channel?: string; threadId?: string }): string {
    const c: Conv = { id: this.id("conv"), tenantId: "t-1", workspaceId: o.workspaceId ?? "w-1", threadId: o.threadId ?? "999", leadId: null, lastInboundAt: o.lastInboundAt, status: "open", channel: o.channel ?? "instagram" }; this.convs.push(c);
    const m: Msg = { id: this.id("msg"), tenantId: "t-1", workspaceId: c.workspaceId, conversationId: c.id, direction: "outbound", status: "queued", body: o.body, externalId: null, isNote: false }; this.msgs.push(m); return m.id;
  }

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

export const CONN = { id: "5f0c1d52-8a7e-4b1c-9d3e-0a1b2c3d4e5f", tenantId: "t-1", workspaceId: "w-1", connectorId: "meta-ads" as const, mode: "sandbox" as const, status: "sandbox" as const, settings: {} as Record<string, unknown>, credentialSecretId: "c", webhookSecretId: "h", tokenExpiresAt: null };
export const NOW = new Date("2026-11-09T05:00:00Z");   // 10:30 IST
export function fakeDeps(now: Date = NOW): MetaDeps & { store: FakeStore; core: FakeStore } {
  const s = new FakeStore();
  return { store: s, core: s, log: { info() {}, warn() {}, error() {} }, now: () => now, rate: async () => true };
}
