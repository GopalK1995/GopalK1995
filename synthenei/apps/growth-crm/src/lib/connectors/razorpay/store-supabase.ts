// Supabase implementation of RzpStore on the SERVICE-ROLE client (webhooks and server actions are sanctioned users of serviceDb,
// CONTRACTS C6). RLS does not protect this path, so every query is explicitly scoped by tenant_id / workspace_id.
// Optional columns (payments.failure_code / refunded_paise, docs/migrations-backlog.md "T037 needs") are written when present;
// on a database that lacks them the write is retried without, so the connector works before and after the migration.
import "server-only";
import type { Db } from "@/lib/db/client";
import { from, type Qb } from "@/lib/db/query";
import { emitEvent } from "@/lib/events/emit";
import { PROVIDER } from "./constants";
import { isPayStatus } from "./status";
import type { DealInfo, NewPayment, PaymentPatch, PaymentRow, RzpStore } from "./store";

type R = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const failed = (what: string) => new Error(`razorpay store: ${what} failed`);   // PostgREST text can quote values: not echoed
const MISSING_COLUMN = new Set(["PGRST204", "42703"]);
const COLS = "id, tenant_id, workspace_id, integration_id, external_id, amount_paise, currency, status, link_url, lead_id, deal_id, record_id, paid_at, raw_ref";

const toRow = (r: R): PaymentRow => ({
  id: String(r.id), tenantId: String(r.tenant_id), workspaceId: String(r.workspace_id), integrationId: str(r.integration_id), externalId: str(r.external_id),
  amountPaise: Number(r.amount_paise), currency: String(r.currency), status: isPayStatus(r.status) ? r.status : "created", linkUrl: str(r.link_url),
  leadId: str(r.lead_id), dealId: str(r.deal_id), recordId: str(r.record_id), paidAt: str(r.paid_at), rawRef: str(r.raw_ref),
});

export function supabaseRzpStore(db: Db): RzpStore {
  const q = (t: string) => from(db, t);
  const rows = async (b: Qb, what: string): Promise<R[]> => { const { data, error } = await b; if (error) throw failed(what); return (data as R[] | null) ?? []; };

  return {
    async insertPayment(p: NewPayment) {
      const r = await rows(q("payments").insert({
        tenant_id: p.tenantId, workspace_id: p.workspaceId, integration_id: p.integrationId, provider: PROVIDER, amount_paise: p.amountPaise, currency: p.currency,
        status: "created", lead_id: p.leadId, deal_id: p.dealId, record_id: p.recordId, ...(p.createdBy ? { created_by: p.createdBy } : {}),
      }).select(COLS), "payment insert");
      if (!r[0]) throw failed("payment insert");
      return toRow(r[0]);
    },
    async updatePayment(workspaceId, id, patch: PaymentPatch) {
      const base: R = {
        updated_at: new Date().toISOString(),
        ...(patch.externalId !== undefined ? { external_id: patch.externalId } : {}), ...(patch.status ? { status: patch.status } : {}),
        ...(patch.linkUrl !== undefined ? { link_url: patch.linkUrl } : {}), ...(patch.paidAt ? { paid_at: patch.paidAt } : {}), ...(patch.rawRef ? { raw_ref: patch.rawRef } : {}),
      };
      const optional: R = { ...(patch.failureCode !== undefined ? { failure_code: patch.failureCode } : {}), ...(patch.refundedPaise !== undefined ? { refunded_paise: patch.refundedPaise } : {}) };
      const op = (extra: R) => q("payments").update({ ...base, ...extra }).eq("workspace_id", workspaceId).eq("id", id).select("id");
      let res = await op(optional);
      if (res.error && Object.keys(optional).length && MISSING_COLUMN.has(String(res.error.code ?? ""))) res = await op({});
      if (res.error) throw failed("payment update");
      return ((res.data as R[] | null) ?? []).length > 0;
    },
    async getPayment(workspaceId, id) {
      const r = await rows(q("payments").select(COLS).eq("workspace_id", workspaceId).eq("id", id).limit(1), "payment read");
      return r[0] ? toRow(r[0]) : null;
    },
    async findPayment(workspaceId, f) {
      if (f.id && /^[0-9a-f-]{36}$/i.test(f.id)) {
        const r = await rows(q("payments").select(COLS).eq("workspace_id", workspaceId).eq("provider", PROVIDER).eq("id", f.id).limit(1), "payment lookup");
        if (r[0]) return toRow(r[0]);
      }
      if (!f.externalIds.length) return null;
      const r = await rows(q("payments").select(COLS).eq("workspace_id", workspaceId).eq("provider", PROVIDER).in("external_id", f.externalIds).limit(1), "payment lookup");
      return r[0] ? toRow(r[0]) : null;
    },
    async openPaymentsForDeal(workspaceId, dealId) {
      return (await rows(q("payments").select(COLS).eq("workspace_id", workspaceId).eq("provider", PROVIDER).eq("deal_id", dealId).in("status", ["created", "pending", "failed"]).limit(20), "open payments")).map(toRow);
    },
    async getDeal(workspaceId, dealId): Promise<DealInfo | null> {
      const r = await rows(q("deals").select("id, name, value_inr, lead_id, stage_id, pipeline_id").eq("workspace_id", workspaceId).eq("id", dealId).is("deleted_at", null).limit(1), "deal read");
      const d = r[0];
      return d ? { id: String(d.id), name: String(d.name), valueInr: Number(d.value_inr), leadId: str(d.lead_id), stageId: String(d.stage_id), pipelineId: str(d.pipeline_id) } : null;
    },
    async moveDealToStage(tenantId, workspaceId, deal, stageKey) {
      let b = q("pipeline_stages").select("id").eq("workspace_id", workspaceId).eq("key", stageKey).limit(1);
      if (deal.pipelineId) b = b.eq("pipeline_id", deal.pipelineId);
      const st = (await rows(b, "stage lookup"))[0];
      if (!st) return "no_stage";
      if (String(st.id) === deal.stageId) return "already";
      // The deals triggers write stage_entered_at/won_at and deal_stage_history.
      await rows(q("deals").update({ stage_id: st.id, updated_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("workspace_id", workspaceId).eq("id", deal.id).select("id"), "deal move");
      return "moved";
    },
    async emit(e) {
      try { await emitEvent({ type: e.type, objectType: e.objectType, objectId: e.objectId, workspaceId: e.workspaceId, data: e.data }, db); }
      catch { /* best effort: the payments row-change audit already recorded the write; an event failure must not undo or retry it */ }
    },
  };
}
