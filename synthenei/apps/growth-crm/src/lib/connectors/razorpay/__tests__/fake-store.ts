// In-memory RzpStore for unit tests: same scoping and uniqueness rules as the database (workspace scoped, unique vendor id per workspace).
import type { ConnectionRow } from "../../core/types";
import type { DealInfo, NewPayment, PaymentEventType, PaymentPatch, PaymentRow, RzpDeps, RzpStore } from "../store";

export const WS = "ws-1", TENANT = "t-1", CONN = "conn-1";
export const mkConn = (over: Partial<ConnectionRow> = {}): ConnectionRow => ({
  id: CONN, tenantId: TENANT, workspaceId: WS, connectorId: "razorpay", mode: "sandbox", status: "connected", settings: {}, credentialSecretId: "c", webhookSecretId: null, tokenExpiresAt: null, ...over,
});

export class FakeStore implements RzpStore {
  n = 0; payments: (PaymentRow & { failureCode?: string | null; refundedPaise?: number })[] = []; deals: (DealInfo & { workspaceId: string })[] = [];
  stages: Record<string, string> = {}; moves: { dealId: string; stageKey: string }[] = []; events: { type: PaymentEventType; objectId: string; data: Record<string, unknown> }[] = [];
  failMove = false;
  async insertPayment(p: NewPayment) {
    const row: PaymentRow = { id: `00000000-0000-4000-8000-${String(++this.n).padStart(12, "0")}`, tenantId: p.tenantId, workspaceId: p.workspaceId, integrationId: p.integrationId, externalId: null, amountPaise: p.amountPaise, currency: p.currency, status: "created", linkUrl: null, leadId: p.leadId, dealId: p.dealId, recordId: p.recordId, paidAt: null, rawRef: null };
    this.payments.push(row);
    return { ...row };
  }
  private own(ws: string, id: string) { return this.payments.find((p) => p.workspaceId === ws && p.id === id); }
  async updatePayment(ws: string, id: string, patch: PaymentPatch) {
    const p = this.own(ws, id);
    if (!p) return false;
    if (patch.externalId && this.payments.some((o) => o !== p && o.workspaceId === ws && o.externalId === patch.externalId)) throw new Error("unique violation");
    Object.assign(p, patch);
    return true;
  }
  async getPayment(ws: string, id: string) { const p = this.own(ws, id); return p ? { ...p } : null; }
  async findPayment(ws: string, q: { id?: string; externalIds: string[] }) {
    const p = this.payments.find((x) => x.workspaceId === ws && ((q.id && x.id === q.id) || (x.externalId && q.externalIds.includes(x.externalId))));
    return p ? { ...p } : null;
  }
  async openPaymentsForDeal(ws: string, dealId: string) { return this.payments.filter((p) => p.workspaceId === ws && p.dealId === dealId && ["created", "pending", "failed"].includes(p.status)).map((p) => ({ ...p })); }
  async getDeal(ws: string, id: string) { const d = this.deals.find((x) => x.workspaceId === ws && x.id === id); return d ? { ...d } : null; }
  async moveDealToStage(_t: string, _ws: string, deal: DealInfo, stageKey: string) {
    if (this.failMove) throw new Error("boom");
    if (!(stageKey in this.stages)) return "no_stage" as const;
    if (this.stages[stageKey] === deal.stageId) return "already" as const;
    this.moves.push({ dealId: deal.id, stageKey });
    return "moved" as const;
  }
  async emit(e: { type: PaymentEventType; objectId: string; data: Record<string, unknown> }) { this.events.push({ type: e.type, objectId: e.objectId, data: e.data }); }
}

export const mkDeps = (store: FakeStore, now = "2026-01-01T00:00:00.000Z"): RzpDeps => ({ store, log: { info() {}, warn() {}, error() {} }, now: () => new Date(now) });
