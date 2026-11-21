// Retention job (DPDP storage limitation). Reads retention_policies (tenant_id, object_type, days, action) and applies each one.
// Soft first, hard never from here:
//   * lead / obj:<key>, action delete      -> deleted_at is set. The row stays recoverable until the separate purge job removes it
//                                             (maintenance.purge_soft_deleted, DISABLED by default; docs/migrations-backlog.md T052 needs).
//   * lead / obj:<key>, action anonymise   -> personal fields are cleared in place.
//   * activity / message / lead_event      -> these tables have no deleted_at, so BOTH actions clear the content in place (body, subject,
//                                             props). Removing the empty rows is a later, owner-approved purge; this job never deletes them.
// Modes: "plan" (default) only counts what each policy would touch; "apply" changes rows. The scheduled job row ships disabled with
// mode "apply" so nothing runs until an owner enables it. Bounded: BATCH rows per statement, MAX_BATCHES per policy per run, stops at the
// handler deadline. Pure planner + a small runner over a port, so it is unit tested without a database.
import { from } from "@/lib/db/query";
import type { Db } from "@/lib/db/client";
import { scrubRecordData } from "./erasure";

type R = Record<string, unknown>;
export const BATCH = 500;
export const MAX_BATCHES = 20;
export const OBJECT_RE = /^(lead|activity|message|lead_event|obj:[a-z][a-z0-9_-]{0,40})$/;

export type PolicyAction = "anonymise" | "delete";
export interface Policy { tenantId: string; objectType: string; days: number; action: PolicyAction }
export type RunMode = "plan" | "apply";
export type PlannedKind = "soft_delete" | "anonymise" | "unsupported";
export interface PlanItem { policy: Policy; cutoff: string; kind: PlannedKind; reason?: string }

export function planPolicy(p: Policy, now: number): PlanItem {
  const cutoff = new Date(now - p.days * 86_400_000).toISOString();
  if (!OBJECT_RE.test(p.objectType)) return { policy: p, cutoff, kind: "unsupported", reason: "object type is not supported by the retention job" };
  const soft = p.objectType === "lead" || p.objectType.startsWith("obj:");
  return { policy: p, cutoff, kind: soft && p.action === "delete" ? "soft_delete" : "anonymise" };
}

/** Where each object lives and which column dates it. */
interface Target { table: string; anchor: string; live?: boolean; patch: (kind: PlannedKind) => R; /** PostgREST or() filter that is true only for rows still holding content, so a scrubbed row is never picked twice. */ pending?: string; notEq?: [string, string] }
export function targetFor(objectType: string): Target | null {
  if (objectType === "lead") return { table: "leads", anchor: "created_at", live: true, notEq: ["full_name", "Anonymised lead"], patch: (k) => (k === "soft_delete" ? { deleted_at: "now" } : { full_name: "Anonymised lead", email: null, phone: null, firm_name: null, role_title: null, utm: {}, click_ids: {}, external_ids: {}, score_factors: [] }) };
  if (objectType === "activity") return { table: "activities", anchor: "created_at", pending: "body.not.is.null,subject.not.is.null", patch: () => ({ body: null, subject: null }) };
  if (objectType === "message") return { table: "messages", anchor: "created_at", pending: "body.not.is.null", patch: () => ({ body: null }) };
  if (objectType === "lead_event") return { table: "lead_events", anchor: "occurred_at", pending: "anon_id.not.is.null,lead_id.not.is.null", patch: () => ({ props: {}, anon_id: null, lead_id: null }) };
  if (objectType.startsWith("obj:")) return { table: "records", anchor: "created_at", live: true, notEq: ["title", "Anonymised record"], patch: (k) => (k === "soft_delete" ? { deleted_at: "now" } : { title: "Anonymised record" }) };
  return null;
}

export interface PolicyOutcome { objectType: string; tenantId: string; kind: PlannedKind; cutoff: string; matched: number; changed: number; capped: boolean; error?: string }

export interface RetentionPort {
  policies(tenantId: string | null): Promise<Policy[]>;
  /** Workspace ids of a tenant (records and leads are workspace scoped). */
  workspaces(tenantId: string): Promise<string[]>;
  /** Ids older than cutoff for the target, live rows only where the table soft deletes, optionally for one object-type key. */
  due(t: Target, wsIds: string[], cutoff: string, objectKey: string | null, limit: number): Promise<string[]>;
  apply(t: Target, ids: string[], patch: R): Promise<void>;
}

export async function runRetention(port: RetentionPort, o: { mode: RunMode; tenantId: string | null; now: number; deadline: number }): Promise<PolicyOutcome[]> {
  const out: PolicyOutcome[] = [];
  for (const policy of await port.policies(o.tenantId)) {
    const plan = planPolicy(policy, o.now), base = { objectType: policy.objectType, tenantId: policy.tenantId, kind: plan.kind, cutoff: plan.cutoff };
    const target = targetFor(policy.objectType);
    if (plan.kind === "unsupported" || !target) { out.push({ ...base, matched: 0, changed: 0, capped: false, error: plan.reason ?? "unsupported" }); continue; }
    try {
      const ws = await port.workspaces(policy.tenantId);
      if (!ws.length) { out.push({ ...base, matched: 0, changed: 0, capped: false }); continue; }
      const key = policy.objectType.startsWith("obj:") ? policy.objectType.slice(4) : null;
      let matched = 0, changed = 0, capped = false;
      for (let b = 0; b < MAX_BATCHES; b++) {
        if (Date.now() > o.deadline) { capped = true; break; }
        const ids = await port.due(target, ws, plan.cutoff, key, BATCH);
        if (!ids.length) break;
        matched += ids.length;
        if (o.mode === "plan") { if (ids.length === BATCH) capped = true; break; }   // counting beyond one batch needs no writes: report "at least"
        await port.apply(target, ids, target.patch(plan.kind));
        changed += ids.length;
        if (ids.length < BATCH) break;
        if (b === MAX_BATCHES - 1) capped = true;
      }
      out.push({ ...base, matched, changed, capped });
    } catch (e) { out.push({ ...base, matched: 0, changed: 0, capped: false, error: e instanceof Error ? e.message.slice(0, 160) : "error" }); }
  }
  return out;
}

const fail = (w: string) => new Error(`retention: ${w} failed`);
export function supabaseRetentionPort(db: Db): RetentionPort {
  return {
    async policies(tenantId) {
      let b = from(db, "retention_policies").select("tenant_id, object_type, days, action");
      if (tenantId) b = b.eq("tenant_id", tenantId);
      const r = await b.limit(500);
      if (r.error) throw fail("policy read");
      return ((r.data as R[] | null) ?? []).map((x) => ({ tenantId: String(x.tenant_id), objectType: String(x.object_type), days: Number(x.days), action: x.action === "delete" ? "delete" : "anonymise" }));
    },
    async workspaces(tenantId) {
      const r = await from(db, "workspaces").select("id").eq("tenant_id", tenantId).is("archived_at", null).limit(200);
      if (r.error) throw fail("workspace read");
      return ((r.data as R[] | null) ?? []).map((x) => String(x.id));
    },
    async due(t, wsIds, cutoff, objectKey, limit) {
      let b = from(db, t.table).select("id").in("workspace_id", wsIds).lt(t.anchor, cutoff);
      if (t.live) b = b.is("deleted_at", null);
      if (t.notEq) b = b.neq(t.notEq[0], t.notEq[1]);   // rows already scrubbed are not picked up again
      if (t.pending) b = b.or(t.pending);
      if (objectKey) {
        const ot = await from(db, "object_types").select("id").in("workspace_id", wsIds).eq("key", objectKey).limit(50);
        if (ot.error) throw fail("object type read");
        const ids = ((ot.data as R[] | null) ?? []).map((x) => String(x.id));
        if (!ids.length) return [];
        b = b.in("object_type_id", ids);
      }
      const r = await b.order(t.anchor, { ascending: true }).limit(limit);
      if (r.error) throw fail(`${t.table} read`);
      return ((r.data as R[] | null) ?? []).map((x) => String(x.id));
    },
    async apply(t, ids, patch) {
      if (t.table === "records" && "title" in patch) {   // anonymise a custom-object record: also drop its personal fields
        const recs = await from(db, "records").select("id, object_type_id, data").in("id", ids).limit(ids.length);
        if (recs.error) throw fail("records read");
        const rows = (recs.data as R[] | null) ?? [];
        const typeIds = [...new Set(rows.map((r) => String(r.object_type_id)))];
        const defs = typeIds.length ? await from(db, "field_defs").select("object_type_id, key, is_pii").in("object_type_id", typeIds).limit(2000) : { data: [], error: null };
        if (defs.error) throw fail("field defs read");
        const byType = new Map<string, string[]>();
        for (const f of (defs.data as R[] | null) ?? []) if (f.is_pii) byType.set(String(f.object_type_id), [...(byType.get(String(f.object_type_id)) ?? []), String(f.key)]);
        for (const r of rows) {
          const u = await from(db, "records").update({ title: patch.title, data: scrubRecordData((r.data as R) ?? {}, byType.get(String(r.object_type_id)) ?? []) }).eq("id", String(r.id)).select("id");
          if (u.error) throw fail("records update");
        }
        return;
      }
      const p = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === "now" ? new Date().toISOString() : v]));
      const r = await from(db, t.table).update(p).in("id", ids).select("id");
      if (r.error) throw fail(`${t.table} update`);
    },
  };
}
