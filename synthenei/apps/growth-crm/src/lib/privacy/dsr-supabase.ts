// Service-role DsrStore and audit writer for the requester-facing pages (status link, export delivery). Server only.
// Every query is scoped by workspace id; the bundle goes through the same buildAccessBundle the owner's download uses.
import "server-only";
import type { Db } from "@/lib/db/client";
import { from } from "@/lib/db/query";
import { redactDetail, redactLine } from "@/lib/audit/redact";
import { buildAccessBundle } from "./bundle";
import type { AuditEntry, DsrRequest, DsrStore } from "./dsr";
import { supabaseIntakeStore } from "./store-supabase";
import { isRequestKind, type RequestStatus } from "./types";

type R = Record<string, unknown>;
type Rpc = { rpc(fn: string, a: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };

export function supabaseDsrStore(db: Db, warn: (m: string) => void = () => undefined): DsrStore {
  const intake = supabaseIntakeStore(db, warn);
  return {
    workspaceBySlug: intake.workspaceBySlug,
    workspaceById: intake.workspaceById,
    async requestById(wsUuid, id): Promise<DsrRequest | null> {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      const r = await from(db, "privacy_requests").select("id, workspace_id, tenant_id, lead_id, subject_ref, kind, status, received_at, due_at, completed_at").eq("workspace_id", wsUuid).eq("id", id).limit(1);
      if (r.error) throw new Error("privacy dsr: request read failed");
      const x = ((r.data as R[] | null) ?? [])[0];
      if (!x || !isRequestKind(x.kind)) return null;
      return {
        id: String(x.id), wsUuid: String(x.workspace_id), tenantUuid: String(x.tenant_id), leadId: x.lead_id ? String(x.lead_id) : null,
        subjectRef: String(x.subject_ref), kind: x.kind, status: x.status as RequestStatus, receivedAt: String(x.received_at), dueAt: String(x.due_at),
        completedAt: x.completed_at ? String(x.completed_at) : null,
      };
    },
    buildBundle: (i) => buildAccessBundle(db, { workspaceId: i.wsUuid, requestId: i.requestId, subjectRef: i.subjectRef, leadId: i.leadId }),
  };
}

/** audit_record_server with a system actor. Resolves false (never throws) when the row could not be written. */
export function supabaseAuditWriter(db: Db, warn: (m: string) => void = () => undefined): (e: AuditEntry) => Promise<boolean> {
  return async (e) => {
    try {
      const r = await (db as unknown as Rpc).rpc("audit_record_server", {
        p_actor: null, p_workspace: e.wsUuid, p_action: e.action, p_summary: redactLine(e.summary, 300), p_object_table: "privacy_requests", p_object_id: e.requestId,
        p_detail: redactDetail(e.detail ?? {}) as Record<string, unknown>, p_source: "ui", p_actor_kind: "system", p_request_id: null, p_ip: null, p_user_agent: null,
      });
      if (r.error) { warn(`${e.action} not audited (${r.error.code ?? "error"})`); return false; }
      return true;
    } catch { warn(`${e.action} not audited`); return false; }
  };
}
