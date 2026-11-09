// In-memory EmailStore and helpers for unit tests. Enforces the rules the database does: workspace-scoped suppressions (unique per
// address), consent decided by the latest consent_log row, message dedupe by provider id, status rank.
import type { ConnectionRow } from "../../core/types";
import { normaliseEmail, type SuppressionEntry } from "../suppression";
import type { ConsentEntry, EmailDeps, EmailEvent, EmailStore, NewOutbound, NewSuppression, OutboundPatch, OutboundRow, Recipient, TemplateRow } from "../store";
import { makeMockTransport, type MockEmailTransport } from "../mock";

export interface FMsg { id: string; tenantId: string; workspaceId: string; leadId: string | null; email: string; status: string; body: string; subject: string | null; providerId: string | null; internal: boolean; channel: string; errorCode?: string | null; templateId: string | null }
const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2 };

export class FakeStore implements EmailStore {
  n = 0;
  leads = new Map<string, Recipient & { workspaceId: string }>();
  consent: (ConsentEntry & { at: number })[] = [];
  suppressed: (SuppressionEntry & { workspaceId: string; leadId: string | null })[] = [];
  msgs: FMsg[] = [];
  templates = new Map<string, TemplateRow & { tenantId: string }>();
  events: EmailEvent[] = [];
  audits: string[] = [];
  consentChecks = 0;
  failConsent = false;
  private clock = 0;

  addLead(id: string, workspaceId: string, email: string | null, name = "Asha Kumar", extra: Partial<Recipient> = {}, granted = true): void {
    this.leads.set(id, { leadId: id, workspaceId, email, fullName: name, firstName: name.split(" ")[0], company: null, district: null, ...extra });
    if (granted) this.consent.push({ tenantId: "t1", workspaceId, leadId: id, subjectRef: "x", action: "granted", note: "test", at: ++this.clock });
  }
  async getRecipient(workspaceId: string, leadId: string) { const l = this.leads.get(leadId); return l && l.workspaceId === workspaceId ? { ...l } : null; }
  async findLeadsByEmail(workspaceId: string, email: string) { return [...this.leads.values()].filter((l) => l.workspaceId === workspaceId && l.email && normaliseEmail(l.email) === normaliseEmail(email)).map((l) => l.leadId); }
  async canContact(leadId: string) {
    this.consentChecks++;
    if (this.failConsent) throw new Error("db down");
    const last = this.consent.filter((c) => c.leadId === leadId).sort((a, b) => a.at - b.at).pop();
    return last?.action === "granted" && this.leads.has(leadId);
  }
  async latestConsent(leadId: string) { return this.consent.filter((c) => c.leadId === leadId).sort((a, b) => a.at - b.at).pop()?.action ?? null; }
  async recordConsent(c: ConsentEntry) { this.consent.push({ ...c, at: ++this.clock }); }

  async isSuppressed(workspaceId: string, email: string) { return this.suppressed.some((s) => s.workspaceId === workspaceId && s.email === normaliseEmail(email)); }
  async addSuppression(s: NewSuppression) {
    const email = normaliseEmail(s.email);
    if (this.suppressed.some((x) => x.workspaceId === s.workspaceId && x.email === email)) return false;
    this.suppressed.push({ email, reason: s.reason, source: s.source, at: new Date().toISOString(), workspaceId: s.workspaceId, leadId: s.leadId ?? null });
    return true;
  }
  async listSuppressions(workspaceId: string) { return this.suppressed.filter((s) => s.workspaceId === workspaceId); }

  async getOutbound(id: string): Promise<OutboundRow | null> {
    const m = this.msgs.find((x) => x.id === id);
    return m ? { id: m.id, tenantId: m.tenantId, workspaceId: m.workspaceId, conversationId: "conv", status: m.status, body: m.body, subject: m.subject, templateId: m.templateId, isInternalNote: m.internal, channel: m.channel, leadId: m.leadId, to: m.email } : null;
  }
  async listQueuedOutbound(workspaceId: string, limit: number) { return this.msgs.filter((m) => m.workspaceId === workspaceId && m.status === "queued" && !m.internal && m.channel === "email").slice(0, limit).map((m) => m.id); }
  async patchOutbound(id: string, p: OutboundPatch) { const m = this.msgs.find((x) => x.id === id)!; m.status = p.status; if (p.externalId !== undefined) m.providerId = p.externalId; if (p.errorCode !== undefined) m.errorCode = p.errorCode; }
  async createOutbound(m: NewOutbound, opts?: { status: "queued" | "sent"; providerId?: string }) {
    if (opts?.providerId) { const d = this.msgs.find((x) => x.providerId === opts.providerId); if (d) return d.id; }
    const id = `msg-${++this.n}`;
    this.msgs.push({ id, tenantId: m.tenantId, workspaceId: m.workspaceId, leadId: m.leadId, email: m.email, status: opts?.status ?? "queued", body: m.body, subject: m.subject, providerId: opts?.providerId ?? null, internal: false, channel: "email", templateId: m.templateId });
    return id;
  }
  queue(over: Partial<FMsg> & { id: string }): FMsg { const m: FMsg = { tenantId: "t1", workspaceId: "w1", leadId: "l1", email: "asha@example.com", status: "queued", body: "Hello there", subject: "Hi", providerId: null, internal: false, channel: "email", templateId: null, ...over }; this.msgs.push(m); return m; }
  async applyStatus(tenantId: string, providerId: string, status: "sent" | "delivered" | "failed", _at: string, error?: { code: string }) {
    const m = this.msgs.find((x) => x.tenantId === tenantId && x.providerId === providerId);
    if (!m) return { result: "unknown" as const };
    const advances = status === "failed" ? m.status !== "delivered" && m.status !== "failed" : (RANK[status] ?? 0) > (RANK[m.status] ?? 0);
    if (!advances) return { result: "ignored" as const, messageId: m.id, leadId: m.leadId };
    m.status = status; if (error) m.errorCode = error.code;
    return { result: "updated" as const, messageId: m.id, leadId: m.leadId };
  }
  async messageRecipient(tenantId: string, providerId: string) { const m = this.msgs.find((x) => x.tenantId === tenantId && x.providerId === providerId); return m ? { email: m.email, leadId: m.leadId } : null; }
  async getTemplate(tenantId: string, id: string) { const t = this.templates.get(id); return t && t.tenantId === tenantId ? t : null; }
  async emit(e: EmailEvent) { this.events.push(e); }
  async audit(a: { action: string }) { this.audits.push(a.action); }
}

export const CONN = (over: Partial<ConnectionRow> = {}): ConnectionRow => ({
  id: "c1", tenantId: "t1", workspaceId: "w1", connectorId: "resend", mode: "live", status: "connected", credentialSecretId: "sec", webhookSecretId: null, tokenExpiresAt: null,
  settings: { from_email: "news@brand.test", from_name: "Brand Team", reply_to: "help@brand.test", footer_text: "Brand Ltd, 1 Test Road" }, ...over,
});

export const SECRET = "unit-test-unsub-secret";
export function deps(store: FakeStore, over: Partial<EmailDeps> = {}): EmailDeps {
  return { store, log: { info() {}, warn() {}, error() {} }, now: () => new Date("2026-11-01T10:00:00Z"), rate: async () => true, baseUrl: "https://app.test", unsubscribeSecret: SECRET, ...over };
}
export const mock = (): MockEmailTransport => makeMockTransport();
