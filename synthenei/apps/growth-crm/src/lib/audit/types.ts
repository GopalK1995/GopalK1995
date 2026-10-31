// Audit library types (BUILD-PLAN 1.11). The log is append-only: nothing here describes an update or a delete.
export const AUDIT_SOURCES = ["ui", "api", "connector", "job", "agent", "support"] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];
export const AUDIT_ACTOR_KINDS = ["user", "api_key", "system", "connector", "agent", "support", "platform_admin"] as const;
export type AuditActorKind = (typeof AUDIT_ACTOR_KINDS)[number];

/** Same shape the DB constraint audit_log_action_check enforces (0014). */
export const ACTION_RE = /^[a-z][a-z0-9_.:-]{0,63}$/;
/** Action families that must carry a human reason (config, role and permission changes, support actions). */
export const REASON_REQUIRED_PREFIXES = ["config.", "role.", "permission.", "support."] as const;
export const MIN_REASON = 8;
export const MAX_REASON = 500;
export const MAX_SUMMARY = 300;

export interface AuditInput {
  /** dotted verb, e.g. audit.exported, config.changed, role.permission_granted, support.write */
  action: string;
  /** one human-readable line; personal data and secrets are scrubbed before it is stored */
  summary: string;
  reason?: string;
  /** the object acted on, when there is one */
  object?: { table: string; id?: string };
  /** structured detail; sensitive keys are redacted before it leaves the process */
  detail?: Record<string, unknown>;
}

/** Who and how. Built from the signed-in principal (actorFromPrincipal) or from a platform admin session. */
export interface AuditActor {
  uid: string;
  kind: AuditActorKind;
  /** workspace uuid; null for platform-level actions */
  workspaceId: string | null;
  source: AuditSource;
  /** true when the actor is a platform admin acting inside a customer workspace through a support session */
  impersonation: boolean;
  requestId?: string;
  ip?: string;
  userAgent?: string;
  demo?: boolean;
}

/** One row as the viewers show it. */
export interface AuditView {
  id: string;
  at: string;
  actorId: string | null;
  actorLabel: string;
  actorKind: string;
  action: string;
  summary: string;
  objectTable: string;
  objectId: string | null;
  source: string;
  reason: string | null;
  requestId: string | null;
  ip: string;
  userAgent: string;
  supportSessionId: string | null;
  tenantId: string | null;
  workspaceId: string | null;
  changes: unknown;
  /** written during a support session (impersonation) */
  support: boolean;
}

export interface AuditFilters {
  /** user id (uuid) or part of the actor label */
  actor?: string;
  action?: string;
  /** table name, or "table:rowId" */
  object?: string;
  source?: string;
  /** YYYY-MM-DD, India time, inclusive */
  from?: string;
  to?: string;
  /** platform viewer only */
  tenant?: string;
  workspace?: string;
}

export class AuditError extends Error {
  code: "invalid" | "failed" | "unavailable";
  constructor(code: "invalid" | "failed" | "unavailable", message: string) { super(message); this.name = "AuditError"; this.code = code; }
}
