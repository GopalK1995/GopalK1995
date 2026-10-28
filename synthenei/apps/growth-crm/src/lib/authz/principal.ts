// Principal builders (pure). Demo uses system grants; real mode maps the authz.my_grants RPC 1:1 (CONTRACTS C3.4).
import type { Role } from "../data/types";
import type { Grant, Principal, PrincipalKind, Scope } from "./types";
import { systemGrants } from "./system-grants";

export const DEFAULT_PII_FIELDS = ["email", "phone"];
export interface SystemPrincipalInput {
  uid: string; workspaceId: string; role: Role; tenantId?: string | null; kind?: PrincipalKind;
  tenant?: Principal["tenant"]; modulesOff?: string[]; attrs?: Record<string, unknown>; teamIds?: string[]; teamUserIds?: string[];
  support?: Principal["support"]; capped?: string[]; piiFields?: string[];
  /** false: a read_write support session keeps `role` (callers that already resolved the effective role). Default true: acts as owner. */
  overlay?: boolean;
}
/** Support overlay (plan 1.3 step 4): read_only acts as the system viewer, read_write as owner (blocked keys are denied by the engine). */
export function systemPrincipal(i: SystemPrincipalInput): Principal {
  const effective: Role = i.support?.mode === "read_only" ? "viewer" : i.support?.mode === "read_write" && i.overlay !== false ? "owner" : i.role;
  return {
    kind: i.kind ?? "user", uid: i.uid, workspaceId: i.workspaceId, tenantId: i.tenantId ?? null, roleKey: effective,
    grants: systemGrants(effective), teamIds: i.teamIds ?? [], teamUserIds: i.teamUserIds ?? [i.uid], attrs: i.attrs ?? {},
    tenant: i.tenant ?? null, modulesOff: i.modulesOff ?? [], capped: i.capped, support: i.support ?? null, piiFields: i.piiFields ?? DEFAULT_PII_FIELDS,
  };
}

const SCOPES: Scope[] = ["all", "team", "own", "none"];
interface MyGrants {
  role?: { id?: string; key?: string; base?: string };
  perms?: Record<string, { scope?: string; conditions?: unknown; field_mask?: string[] | null; territory?: boolean }>;
  team_user_ids?: string[]; team_ids?: string[]; attrs?: Record<string, unknown>;
  support?: { mode?: string; expires_at?: string } | null;
  tenant?: { uuid?: string; slug?: string; status?: string; trial_ends_at?: string | null };
  policy?: { allowed_modules?: string[] | null; modules_off?: string[] | null; capped?: string[] | null };
  platform_admin?: boolean;
}
/** Map the authz.my_grants(ws) jsonb to a Principal. Unknown shapes degrade to no grants (deny). */
export function principalFromMyGrants(raw: unknown, ctx: { uid: string; workspaceId: string; kind?: PrincipalKind }): Principal {
  const j = (raw && typeof raw === "object" ? raw : {}) as MyGrants;
  const grants: Record<string, Grant> = {};
  for (const [k, v] of Object.entries(j.perms ?? {})) {
    const scope = SCOPES.includes(v?.scope as Scope) ? (v.scope as Scope) : "none";
    grants[k] = { scope, conditions: v?.conditions, fieldMask: v?.field_mask ?? [], ...(v?.territory ? { territory: true } : {}) };
  }
  const status = j.tenant?.status === "suspended" || j.tenant?.status === "trial" ? j.tenant.status : "active";
  const sm = j.support?.mode, sup: Principal["support"] = sm === "read_only" || sm === "read_write" ? { mode: sm } : null;
  return {
    kind: ctx.kind ?? (j.platform_admin ? "platform_admin" : "user"), uid: ctx.uid, workspaceId: ctx.workspaceId, tenantId: j.tenant?.uuid ?? null,
    roleKey: j.role?.key ?? null, grants, teamIds: j.team_ids ?? [], teamUserIds: j.team_user_ids ?? [ctx.uid], attrs: j.attrs ?? {},
    tenant: j.tenant ? { status, trialEndsAt: j.tenant.trial_ends_at ?? null } : null,
    modulesOff: j.policy?.modules_off ?? [], capped: j.policy?.capped ?? undefined, support: sup, piiFields: DEFAULT_PII_FIELDS,
  };
}
