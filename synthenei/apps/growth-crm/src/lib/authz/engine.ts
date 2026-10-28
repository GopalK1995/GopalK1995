// Pure authorization engine: evaluation order of BUILD-PLAN 1.3 / CONTRACTS C3.2, identical to the SQL side.
// No server imports, so it is safe in middleware, client components and unit tests. First deny wins, default deny.
import { permissionDef } from "./catalog";
import { evaluateConditions } from "./conditions";
import { moduleOfPermission } from "./pages";
import type { Decision, DenyReason, Grant, ObjectType, Principal, RecordRef, Scope, Step } from "./types";

export class AuthzError extends Error {
  constructor(public decision: Decision) { super(`Denied ${decision.permission}: ${decision.reason ?? "unknown"}`); this.name = "AuthzError"; }
}

export interface StepTrace { step: Step; name: string; passed: boolean; detail: string }
export interface Explanation { decision: Decision; grant: Grant | null; steps: StepTrace[] }

const isRead = (perm: string) => perm.endsWith(".read");
const STEP_NAME: Record<Step, string> = { 1: "authenticate", 2: "org state", 3: "entitlements", 4: "support overlay", 5: "role grant", 6: "scope", 7: "conditions", 8: "field masking" };

function sharedAllows(p: Principal, rec: RecordRef, read: boolean): boolean {
  return (rec.sharedWith ?? []).some((s) => {
    const who = (s.subjectType === "user" && s.subjectId === p.uid) || (s.subjectType === "team" && p.teamIds.includes(s.subjectId)) || (s.subjectType === "role" && s.subjectId === p.roleKey);
    return who && (read || s.relation === "editor" || s.relation === "owner");
  });
}
function scopeAllows(p: Principal, g: Grant, rec: RecordRef): boolean {
  if (rec.workspaceId !== p.workspaceId) return false;
  const own = rec.ownerId === p.uid || rec.assigneeId === p.uid;
  switch (g.scope) {
    case "all": return true;
    case "team": return rec.ownerId == null || p.teamUserIds.includes(rec.ownerId) || own;
    case "own": {
      if (own) return true;
      const districts = p.attrs.districts, d = rec.attrs?.district;
      return g.territory === true && rec.ownerId == null && rec.assigneeId == null && Array.isArray(districts) && typeof d === "string" && districts.includes(d);
    }
    default: return false;
  }
}
const usesRecord = (c: unknown) => JSON.stringify(c ?? {}).includes('"record.');

function run(p: Principal | null, perm: string, rec: RecordRef | undefined, now: Date, trace: StepTrace[] | null): { d: Decision; grant: Grant | null } {
  const read = isRead(perm);
  let grant: Grant | null = null;
  const t = (step: Step, passed: boolean, detail: string) => { trace?.push({ step, name: STEP_NAME[step], passed, detail }); };
  const deny = (reason: DenyReason, step: Step, detail: string) => { t(step, false, detail); return { d: { allow: false, reason, step, permission: perm, maskedFields: [] } as Decision, grant }; };

  if (!p) return deny("unauthenticated", 1, "no principal");
  t(1, true, `${p.kind} ${p.uid}`);

  if (p.tenant?.status === "suspended" && !read) return deny("org_suspended", 2, "organisation suspended, writes denied");
  if (p.tenant?.status === "trial" && p.tenant.trialEndsAt && new Date(p.tenant.trialEndsAt).getTime() < now.getTime() && !read) return deny("org_readonly", 2, "trial ended, read-only");
  t(2, true, p.tenant ? `organisation ${p.tenant.status}` : "no organisation");

  const mod = moduleOfPermission(perm);
  if (mod && p.modulesOff.includes(mod)) return deny("module_off", 3, `module ${mod} is off`);
  if (p.capped?.includes(perm)) return deny("plan_limit", 3, "plan cap reached");
  t(3, true, mod ? `module ${mod} on` : "not module-gated");

  if (p.kind === "platform_admin" && !p.support && !perm.startsWith("platform.")) return deny("no_permission", 4, "platform admin without a support session");
  if (p.support) {
    if (permissionDef(perm)?.supportBlocked) return deny("support_blocked", 4, "blocked in every support session");
    if (p.support.mode === "read_only" && !read) return deny("support_readonly", 4, "read-only support session");
  }
  t(4, true, p.support ? `support ${p.support.mode}` : "no support session");

  grant = p.grants[perm] ?? null;
  if (!grant || grant.scope === "none") return deny("no_permission", 5, "role has no grant");
  t(5, true, `grant scope ${grant.scope}`);

  if (rec) {
    const ok = scopeAllows(p, grant, rec) || sharedAllows(p, rec, read);
    if (!ok) return deny("out_of_scope", 6, `record outside ${grant.scope} scope`);
    t(6, true, `record within ${grant.scope} scope or shared`);
  } else t(6, true, "list-level check, record scope not applied");

  if (grant.conditions != null && (rec || !usesRecord(grant.conditions))) {
    const ok = evaluateConditions(grant.conditions, {
      record: rec ? { ...rec.attrs, ownerId: rec.ownerId, assigneeId: rec.assigneeId, type: rec.type, workspaceId: rec.workspaceId } : undefined,
      principal: { uid: p.uid, roleKey: p.roleKey, attrs: p.attrs, districts: p.attrs.districts }, now,
    });
    if (!ok) return deny("condition_failed", 7, "conditions evaluated false");
  }
  t(7, true, "conditions pass");

  const hasPii = p.grants["pii.read"] && p.grants["pii.read"].scope !== "none";
  const masked = [...new Set([...(hasPii ? [] : p.piiFields), ...(grant.fieldMask ?? [])])];
  t(8, true, masked.length ? `masked: ${masked.join(", ")}` : "nothing masked");
  return { d: { allow: true, reason: null, step: 8, permission: perm, maskedFields: masked }, grant };
}

export function decide(p: Principal | null, perm: string, rec?: RecordRef, now: Date = new Date()): Decision { return run(p, perm, rec, now, null).d; }
export function can(p: Principal | null, perm: string, rec?: RecordRef, now?: Date): boolean { return decide(p, perm, rec, now).allow; }
export function explain(p: Principal | null, perm: string, rec?: RecordRef, now: Date = new Date()): Explanation {
  const steps: StepTrace[] = [], r = run(p, perm, rec, now, steps);
  return { decision: r.d, grant: r.grant, steps };
}
/** Throws AuthzError when denied; returns the principal for chaining. */
export function enforce(p: Principal | null, perm: string, rec?: RecordRef): Principal {
  const d = decide(p, perm, rec);
  if (!d.allow || !p) throw new AuthzError(d);
  return p;
}
export const denyMessageKey = (d: Decision): string => `errors.authz.${d.reason ?? "no_permission"}`;

const RESOURCE_OF_TYPE: Record<string, string> = {
  lead: "leads", contact: "contacts", account: "accounts", deal: "deals", task: "tasks", activity: "activities", campaign: "campaigns",
  segment: "segments", conversation: "inbox", message: "inbox", integration: "integrations", webhook_endpoint: "webhooks", api_key: "api_keys",
};
/** Read permission that governs an object type. */
export const readPermissionOf = (type: ObjectType): string => (type.startsWith("obj:") ? `${type}.read` : `${RESOURCE_OF_TYPE[type]}.${type === "webhook_endpoint" || type === "api_key" ? "manage" : "read"}`);

export const MASK = "••••";
/** Mask PII and field-masked columns of a row for this principal. Does not mutate the input. */
export function maskRecord<T extends Record<string, unknown>>(p: Principal, type: ObjectType, row: T, piiFields: string[] = []): T {
  const g = p.grants[readPermissionOf(type)], hasPii = p.grants["pii.read"] && p.grants["pii.read"].scope !== "none";
  const fields = new Set([...(hasPii ? [] : [...p.piiFields, ...piiFields]), ...(g?.fieldMask ?? [])]);
  const out: Record<string, unknown> = { ...row };
  for (const f of fields) if (f in out && out[f] != null) out[f] = typeof out[f] === "string" ? MASK : null;
  return out as T;
}

const RANK: Record<Scope, number> = { none: 0, own: 1, team: 2, all: 3 };
/** Owner filter for list queries when the database does not enforce it (demo). */
export function scopeFilter(p: Principal | null, perm: string): { scope: Scope; ownerIds: string[] | null } {
  const g = p?.grants[perm];
  if (!p || !g || RANK[g.scope] === 0) return { scope: "none", ownerIds: [] };
  if (g.scope === "all") return { scope: "all", ownerIds: null };
  if (g.scope === "team") return { scope: "team", ownerIds: [...new Set([p.uid, ...p.teamUserIds])] };
  return { scope: "own", ownerIds: [p.uid] };
}
