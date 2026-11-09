// Persistence port for the Razorpay connector. The Supabase implementation (store-supabase.ts, service role) is the only one that
// touches tables; unit tests pass an in-memory fake. Every method is scoped by tenant and workspace: nothing here reads across tenants.
import type { PayStatus } from "./status";

export interface PaymentRow {
  id: string; tenantId: string; workspaceId: string; integrationId: string | null; externalId: string | null;
  amountPaise: number; currency: string; status: PayStatus; linkUrl: string | null;
  leadId: string | null; dealId: string | null; recordId: string | null; paidAt: string | null; rawRef: string | null;
}
export interface NewPayment {
  tenantId: string; workspaceId: string; integrationId: string; amountPaise: number; currency: string;
  leadId: string | null; dealId: string | null; recordId: string | null; createdBy: string | null;
}
export interface PaymentPatch {
  externalId?: string; status?: PayStatus; linkUrl?: string; paidAt?: string; rawRef?: string;
  /** Optional columns (docs/migrations-backlog.md "T037 needs"); written when present, retried without when the database lacks them. */
  failureCode?: string | null; refundedPaise?: number;
}
export interface DealInfo { id: string; name: string; valueInr: number; leadId: string | null; stageId: string; pipelineId: string | null }

export interface RzpStore {
  insertPayment(p: NewPayment): Promise<PaymentRow>;
  /** Always scoped by workspace: a payment id from another workspace updates nothing (returns false). */
  updatePayment(workspaceId: string, id: string, patch: PaymentPatch): Promise<boolean>;
  getPayment(workspaceId: string, id: string): Promise<PaymentRow | null>;
  /** Looks up by local id and/or the vendor ids (payment link id, order id) inside ONE workspace. */
  findPayment(workspaceId: string, q: { id?: string; externalIds: string[] }): Promise<PaymentRow | null>;
  /** Payments that already exist for the same deal and are not settled/closed (stops a second open link for one deal). */
  openPaymentsForDeal(workspaceId: string, dealId: string): Promise<PaymentRow[]>;
  getDeal(workspaceId: string, dealId: string): Promise<DealInfo | null>;
  /** Moves the deal to the stage with this key in its own pipeline; the DB triggers write the stage history. */
  moveDealToStage(tenantId: string, workspaceId: string, deal: DealInfo, stageKey: string): Promise<"moved" | "already" | "no_stage">;
  emit(e: { type: PaymentEventType; workspaceId: string; objectType: string; objectId: string; data: Record<string, unknown> }): Promise<void>;
}

export type PaymentEventType = "payment.created" | "payment.paid" | "payment.failed" | "payment.cancelled" | "payment.refunded" | "payment.refund_partial" | "payment.mismatch";

export interface RzpDeps {
  store: RzpStore;
  log: { info(m: string, f?: Record<string, unknown>): void; warn(m: string, f?: Record<string, unknown>): void; error(m: string, f?: Record<string, unknown>): void };
  now: () => Date;
}
