// In-memory WaStore for unit tests: enforces the same rules the database does (unique wamid, global phone number ownership, status rank).
import type { ConsentEntry, ConversationRef, InsertResult, NewInboundMessage, NumberUpsert, OutboundPatch, OutboundRow, TemplateRow, TemplateUpsert, WaDeps, WaStore } from "../store";
import type { WaStatus } from "../payload";

export interface Msg { id: string; tenantId: string; workspaceId: string; conversationId: string; direction: "inbound" | "outbound"; status: string; body: string | null; externalId: string | null; templateId: string | null; isNote: boolean; attachments?: unknown[]; errorCode?: string | null; errorDetail?: string | null }
export interface Conv { id: string; tenantId: string; workspaceId: string; waId: string; leadId: string | null; lastInboundAt: string | null; status: string; channel: string }
const RANK: Record<string, number> = { queued: 0, pending_template: 0, sent: 1, delivered: 2, read: 3 };

export class FakeStore implements WaStore {
  n = 0; numbers: NumberUpsert[] = []; msgs: Msg[] = []; convs: Conv[] = []; leads: Record<string, unknown>[] = [];
  consent: ConsentEntry[] = []; templates: (TemplateUpsert & { id: string })[] = []; events: { type: string; data: Record<string, unknown> }[] = [];
  tpl: Record<string, TemplateRow> = {};
  private id(p: string) { return `${p}-${++this.n}`; }
  async upsertNumber(x: NumberUpsert) {
    if (this.numbers.some((o) => o.phoneNumberId === x.phoneNumberId && o.workspaceId !== x.workspaceId)) return { ok: false as const, reason: "phone_number_taken" as const };
    this.numbers = this.numbers.filter((o) => !(o.phoneNumberId === x.phoneNumberId && o.workspaceId === x.workspaceId));
    this.numbers.push(x);
    return { ok: true as const };
  }
  async findMessageByWamid(tenantId: string, wamid: string) { const m = this.msgs.find((x) => x.tenantId === tenantId && x.externalId === wamid); return m ? { id: m.id, conversationId: m.conversationId } : null; }
  async upsertConversation(c: { tenantId: string; workspaceId: string; waId: string; leadId: string | null }): Promise<ConversationRef> {
    const f = this.convs.find((x) => x.workspaceId === c.workspaceId && x.waId === c.waId);
    if (f) { if (!f.leadId && c.leadId) f.leadId = c.leadId; return { id: f.id, leadId: f.leadId, lastInboundAt: f.lastInboundAt, status: f.status, created: false }; }
    const v: Conv = { id: this.id("conv"), tenantId: c.tenantId, workspaceId: c.workspaceId, waId: c.waId, leadId: c.leadId, lastInboundAt: null, status: "open", channel: "whatsapp" };
    this.convs.push(v);
    return { id: v.id, leadId: v.leadId, lastInboundAt: null, status: "open", created: true };
  }
  async insertInbound(m: NewInboundMessage): Promise<InsertResult> {
    if (this.msgs.some((x) => x.tenantId === m.tenantId && x.externalId === m.wamid)) return { duplicate: true };
    const v: Msg = { id: this.id("msg"), tenantId: m.tenantId, workspaceId: m.workspaceId, conversationId: m.conversationId, direction: "inbound", status: "received", body: m.body, externalId: m.wamid, templateId: null, isNote: false, attachments: m.attachments };
    this.msgs.push(v);
    return { id: v.id };
  }
  async touchInbound(conversationId: string, atIso: string, leadId: string | null) {
    const c = this.convs.find((x) => x.id === conversationId)!;
    if (!c.lastInboundAt || Date.parse(c.lastInboundAt) < Date.parse(atIso)) c.lastInboundAt = atIso;
    c.status = "open";
    if (!c.leadId && leadId) c.leadId = leadId;
  }
  async setAttachments(id: string, a: unknown[]) { this.msgs.find((x) => x.id === id)!.attachments = a; }
  async findLeadByPhone(ws: string, e164: string) { const l = this.leads.find((x) => x.workspace_id === ws && x.phone === e164); return l ? String(l.id) : null; }
  async createLead(row: Record<string, unknown>) { const id = this.id("lead"); this.leads.push({ ...row, id }); return id; }
  async applyStatus(tenantId: string, wamid: string, status: WaStatus, _at: string, error?: { code: string; detail?: string }) {
    const m = this.msgs.find((x) => x.tenantId === tenantId && x.externalId === wamid);
    if (!m) return { result: "unknown" as const };
    if (m.direction !== "outbound") return { result: "ignored" as const, messageId: m.id };
    const adv = status === "failed" ? !["read", "delivered", "failed"].includes(m.status) : (RANK[status] ?? 0) > (RANK[m.status] ?? 0);
    if (!adv) return { result: "ignored" as const, messageId: m.id };
    m.status = status;
    if (error) { m.errorCode = error.code; m.errorDetail = error.detail ?? null; }
    return { result: "updated" as const, messageId: m.id };
  }
  addOutbound(o: { tenantId?: string; workspaceId?: string; leadId?: string | null; body?: string | null; templateId?: string | null; lastInboundAt?: string | null; status?: string; isNote?: boolean; channel?: string; waId?: string; externalId?: string }): string {
    const cid = this.id("conv");
    this.convs.push({ id: cid, tenantId: o.tenantId ?? "t-1", workspaceId: o.workspaceId ?? "w-1", waId: o.waId ?? "919800000001", leadId: o.leadId === undefined ? "lead-x" : o.leadId, lastInboundAt: o.lastInboundAt === undefined ? null : o.lastInboundAt, status: "open", channel: o.channel ?? "whatsapp" });
    const m: Msg = { id: this.id("msg"), tenantId: o.tenantId ?? "t-1", workspaceId: o.workspaceId ?? "w-1", conversationId: cid, direction: "outbound", status: o.status ?? "queued", body: o.body === undefined ? "hi" : o.body, externalId: o.externalId ?? null, templateId: o.templateId ?? null, isNote: o.isNote ?? false };
    this.msgs.push(m);
    return m.id;
  }
  async getOutbound(id: string): Promise<OutboundRow | null> {
    const m = this.msgs.find((x) => x.id === id && x.direction === "outbound");
    if (!m) return null;
    const c = this.convs.find((x) => x.id === m.conversationId)!;
    return { id: m.id, tenantId: m.tenantId, workspaceId: m.workspaceId, conversationId: m.conversationId, status: m.status, body: m.body, templateId: m.templateId, isInternalNote: m.isNote, channel: c.channel, leadId: c.leadId, waId: c.waId, lastInboundAt: c.lastInboundAt };
  }
  async listQueuedOutbound(ws: string, limit: number) {
    return this.msgs.filter((m) => m.workspaceId === ws && m.direction === "outbound" && m.status === "queued" && !m.isNote && this.convs.find((c) => c.id === m.conversationId)?.channel === "whatsapp").slice(0, limit).map((m) => m.id);
  }
  async patchOutbound(id: string, p: OutboundPatch) {
    const m = this.msgs.find((x) => x.id === id)!;
    m.status = p.status;
    if (p.externalId !== undefined) m.externalId = p.externalId;
    if (p.errorCode !== undefined) m.errorCode = p.errorCode;
    if (p.errorDetail !== undefined) m.errorDetail = p.errorDetail;
  }
  async leadPhone() { return "+919800000001"; }
  /** Same rule as public.can_contact: the latest consent entry for the lead must be a grant. */
  async canContact(leadId: string) { const last = [...this.consent].reverse().find((c) => c.leadId === leadId); return last?.action === "granted"; }
  async latestConsent(leadId: string) { const last = [...this.consent].reverse().find((c) => c.leadId === leadId); return last ? last.action : null; }
  async recordConsent(c: ConsentEntry) { this.consent.push(c); }
  async getTemplate(_t: string, id: string) { return this.tpl[id] ?? null; }
  async upsertTemplate(t: TemplateUpsert) {
    const own = this.templates.find((x) => x.connectionId === t.connectionId && x.providerTemplateId === t.providerTemplateId);
    if (own) { Object.assign(own, t); return "updated" as const; }
    if (this.templates.some((x) => x.tenantId === t.tenantId && x.name === t.name && x.language === t.language)) return "skipped" as const;
    this.templates.push({ ...t, id: this.id("tpl") });
    return "created" as const;
  }
  async setTemplateStatusByProviderId(connectionId: string, pid: string, status: string, reason: string | null) {
    const t = this.templates.find((x) => x.connectionId === connectionId && x.providerTemplateId === pid);
    if (!t) return false;
    t.status = status; t.rejectedReason = reason;
    return true;
  }
  async emit(e: { type: string; data: Record<string, unknown> }) { this.events.push({ type: e.type, data: e.data }); }
}

export type TestDeps = WaDeps & { store: FakeStore; uploads: { path: string; mime?: string }[] };
export function fakeDeps(store = new FakeStore(), over: Partial<WaDeps> = {}): TestDeps {
  const uploads: { path: string; mime?: string }[] = [];
  return { store, media: { put: async (path, _b, mime) => { uploads.push({ path, mime }); } }, log: { info() {}, warn() {}, error() {} }, now: () => new Date("2026-01-01T12:00:00Z"), rate: async () => true, ...over, uploads } as TestDeps;
}
export const CONN = { id: "conn-1", tenantId: "t-1", workspaceId: "w-1", connectorId: "whatsapp" as const, mode: "sandbox" as const, status: "sandbox" as const, settings: {} as Record<string, unknown>, credentialSecretId: "s", webhookSecretId: null, tokenExpiresAt: null };
