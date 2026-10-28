// Authorization types (CONTRACTS C3.2). Pure: no server imports, safe in edge and client bundles.
export type Scope = "all" | "team" | "own" | "none";
export type ObjectType = "lead" | "contact" | "account" | "deal" | "task" | "activity" | "campaign"
  | "segment" | "conversation" | "message" | "integration" | "webhook_endpoint" | "api_key" | `obj:${string}`;
export type Relation = "owner" | "editor" | "viewer";
export interface RecordRef {
  type: ObjectType; id?: string; workspaceId: string; ownerId?: string | null; assigneeId?: string | null;
  attrs?: Record<string, unknown>;
  sharedWith?: { relation: Relation; subjectType: "user" | "team" | "role"; subjectId: string }[];
}
export type DenyReason = "unauthenticated" | "org_suspended" | "org_readonly" | "module_off" | "plan_limit"
  | "support_blocked" | "support_readonly" | "no_permission" | "out_of_scope" | "condition_failed";
export type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export interface Decision { allow: boolean; reason: DenyReason | null; step: Step; permission: string; maskedFields: string[] }

export interface PermissionDef { key: string; resource: string; action: string; description: string; isPii?: boolean; platformOnly?: boolean; supportBlocked?: boolean }

/** Conditions JSON (C3.3). */
export interface Clause { field: string; op: string; value?: unknown; tz?: string }
export type Conditions = { all: (Clause | { any: Clause[] } | { all: Clause[] })[] } | { any: (Clause | { any: Clause[] } | { all: Clause[] })[] } | Record<string, never>;

export interface Grant { scope: Scope; conditions?: unknown; fieldMask?: string[]; /** leads territory arm: unassigned records in principal.attrs.districts */ territory?: boolean }
export type PrincipalKind = "user" | "api_key" | "connector" | "agent" | "platform_admin";
export interface Principal {
  kind: PrincipalKind;
  uid: string;
  workspaceId: string;
  tenantId: string | null;
  /** System role key or custom role key; used for role-subject shares. */
  roleKey: string | null;
  grants: Record<string, Grant>;
  teamIds: string[];
  /** Users visible under `team` scope (self + my teams + managed teams). */
  teamUserIds: string[];
  attrs: Record<string, unknown>;
  tenant: { status: "active" | "suspended" | "trial"; trialEndsAt?: string | null } | null;
  /** Module ids switched off for the tenant (config modules, org policy, plan). */
  modulesOff: string[];
  /** Permission keys whose plan cap is exhausted (seats, API keys, webhooks, AI calls). */
  capped?: string[];
  support: { mode: "read_only" | "read_write" } | null;
  /** Fields treated as PII when the principal lacks pii.read. */
  piiFields: string[];
}
