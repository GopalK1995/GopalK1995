// Who must use a second factor (AUD-029 / SEC-009). Pure and edge safe.
//  * default: owner, sales_manager and any role whose grants include a manage/export permission must hold a verified TOTP factor
//    (and reach AAL2 on every sign-in); reps and read-only roles stay optional;
//  * per-tenant setting at tenant_config.config.security: { mfa: "privileged" | "all", mfaGraceUntil?: ISO date }. "all" requires
//    every member. The grace date is a short, capped (30 days) window in which privileged users WITHOUT a factor may still sign in;
//    users who already have a factor are always challenged;
//  * platform admins are always required (unchanged, see mfaStep).
import type { Role } from "../data/types";
import { systemGrants } from "../authz/system-grants";

export type MfaMode = "privileged" | "all";
export interface TenantMfaPolicy { mode: MfaMode; graceUntil: number | null }
export const DEFAULT_MFA_POLICY: TenantMfaPolicy = { mode: "privileged", graceUntil: null };
export const MFA_GRACE_MAX_MS = 30 * 24 * 3600 * 1000;
const ALWAYS: Role[] = ["owner", "sales_manager"];
const PRIVILEGED_KEY = /\.(manage|export|admin)$|^privacy\.fulfil$/;

/** Roles that hold a privileged permission (manage/export/admin) at any scope, plus owner and sales_manager. Cached per role. */
const cache = new Map<Role, boolean>();
export function isPrivilegedRole(role: Role): boolean {
  const hit = cache.get(role);
  if (hit !== undefined) return hit;
  const v = ALWAYS.includes(role) || Object.entries(systemGrants(role)).some(([k, g]) => g.scope !== "none" && PRIVILEGED_KEY.test(k));
  cache.set(role, v);
  return v;
}

/** Tolerant parse of tenant_config.config: anything unreadable falls back to the strict-enough default, never to "off". */
export function parseMfaPolicy(config: unknown, now = Date.now()): TenantMfaPolicy {
  const s = config && typeof config === "object" ? (config as Record<string, unknown>).security : null;
  if (!s || typeof s !== "object") return DEFAULT_MFA_POLICY;
  const o = s as Record<string, unknown>;
  const mode: MfaMode = o.mfa === "all" ? "all" : "privileged";
  const t = typeof o.mfaGraceUntil === "string" ? Date.parse(o.mfaGraceUntil) : NaN;
  const graceUntil = Number.isFinite(t) && t > now && t <= now + MFA_GRACE_MAX_MS ? t : null;
  return { mode, graceUntil };
}

export const roleRequiresMfa = (role: Role, p: TenantMfaPolicy = DEFAULT_MFA_POLICY) => p.mode === "all" || isPrivilegedRole(role);

/** Across all of a user's (non-support) memberships: is a factor required, and is every requiring tenant still inside its grace window? */
export function mfaRequirement(rows: { role: Role; policy: TenantMfaPolicy }[], now = Date.now()): { required: boolean; graceActive: boolean } {
  const req = rows.filter((r) => roleRequiresMfa(r.role, r.policy));
  if (!req.length) return { required: false, graceActive: false };
  return { required: true, graceActive: req.every((r) => r.policy.graceUntil !== null && r.policy.graceUntil > now) };
}
