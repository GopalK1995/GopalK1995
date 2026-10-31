// audit(): explicit audit rows for actions that are not row changes (exports, support-session actions, config, role and
// permission changes). Row changes are written by the DB triggers; this adds the rest through ONE SECURITY DEFINER RPC,
// `audit_record` (contract below). There is no update or delete path anywhere in this module, and none can be added
// here: the table has no grant for it and a trigger raises (0014).
//
// RPC contract (needs a DB function, see docs/tasks/T020.md "Needs from integrator"):
//   public.audit_record(p_workspace uuid, p_action text, p_summary text, p_object_table text, p_object_id text, p_reason text,
//     p_detail jsonb, p_source text, p_actor_kind text, p_request_id text, p_ip text, p_user_agent text, p_impersonation boolean)
//   returns bigint. security definer; actor = auth.uid(); stamps tenant, support_session_id, actor_label; rejects a caller who
//   is not a member of p_workspace (or not a platform admin when p_workspace is null).
import { dbForRequest, type Db } from "@/lib/db/client";
import type { Principal } from "@/lib/authz/types";
import type { DbProvider } from "@/lib/db/repo/base";
import { ACTION_RE, AuditError, MAX_REASON, MAX_SUMMARY, MIN_REASON, REASON_REQUIRED_PREFIXES, type AuditActor, type AuditInput } from "./types";
import { redactDetail, redactLine } from "./redact";

type Rpc = { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };

export interface AuditResult { ok: true; id: string | null; demo: boolean }
type Ctx = { requestId?: string; ip?: string; userAgent?: string; demo?: boolean };

/** Pure: validates input and returns the exact, redacted RPC arguments. Exported for tests. */
export function buildAuditArgs(actor: AuditActor, input: AuditInput): Record<string, unknown> {
  if (!ACTION_RE.test(input.action)) throw new AuditError("invalid", `bad audit action "${input.action}"`);
  const reason = input.reason ? redactLine(input.reason, MAX_REASON) : "";
  const needsReason = REASON_REQUIRED_PREFIXES.some((p) => input.action.startsWith(p));
  if (needsReason && reason.length < MIN_REASON) throw new AuditError("invalid", `${input.action} needs a reason of at least ${MIN_REASON} characters`);
  const summary = redactLine(input.summary ?? "", MAX_SUMMARY);
  if (!summary) throw new AuditError("invalid", "audit summary is required");
  const detail = { ...(redactDetail(input.detail ?? {}) as Record<string, unknown>), ...(actor.impersonation ? { impersonation: true } : {}) };
  return {
    p_workspace: actor.workspaceId, p_action: input.action, p_summary: summary,
    p_object_table: input.object?.table ?? null, p_object_id: input.object?.id ?? null,
    p_reason: reason || null, p_detail: detail,
    p_source: actor.impersonation ? "support" : actor.source,
    p_actor_kind: actor.impersonation ? "support" : actor.kind,
    p_request_id: actor.requestId ?? null, p_ip: actor.ip ?? null, p_user_agent: actor.userAgent ? actor.userAgent.slice(0, 300) : null,
    p_impersonation: actor.impersonation,
  };
}

/** Actor for a signed-in workspace principal. Inside a support session the row is flagged as impersonation. */
export function actorFromPrincipal(p: Principal, ctx: Ctx = {}): AuditActor {
  const impersonation = p.support != null;
  return {
    uid: p.uid, workspaceId: p.workspaceId || null,
    kind: impersonation ? "support" : p.kind === "platform_admin" ? "platform_admin" : p.kind,
    source: impersonation ? "support" : p.kind === "api_key" ? "api" : p.kind === "connector" ? "connector" : p.kind === "agent" ? "agent" : "ui",
    impersonation, ...ctx,
  };
}

/** Actor for a platform admin outside any workspace (platform-level actions). */
export function platformActor(uid: string, ctx: Ctx = {}): AuditActor {
  return { uid, kind: "platform_admin", workspaceId: null, source: "ui", impersonation: false, ...ctx };
}

/**
 * Writes one audit row. Demo actors never touch Supabase. Throws AuditError on invalid input or a failed write:
 * callers that gate an action on its audit row (export) must let that propagate so the action does not happen unaudited.
 */
export async function audit(actor: AuditActor, input: AuditInput, getDb: DbProvider = dbForRequest): Promise<AuditResult> {
  const args = buildAuditArgs(actor, input);
  if (actor.demo) return { ok: true, id: null, demo: true };
  let db: Db;
  try { db = await getDb(); } catch { throw new AuditError("unavailable", "audit log is not available"); }
  const { data, error } = await (db as unknown as Rpc).rpc("audit_record", args);
  if (error) throw new AuditError("failed", `audit write failed${error.code ? ` (${error.code})` : ""}`);
  return { ok: true, id: data == null ? null : String(data), demo: false };
}
audit.record = audit;
