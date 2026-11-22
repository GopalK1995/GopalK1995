// Org billing state (pure). Decides read-only / suspended / seat cap from the subscription row, the tenant row and the plan limits.
// The authz engine (steps 2 and 3) does the denying; this module only produces the inputs it already understands:
//   suspended   -> principal.tenant.status = "suspended" (writes denied)
//   read-only   -> principal.tenant.status = "trial" with a past trialEndsAt (writes denied, reason org_readonly)
//   seats full  -> principal.capped includes "members.invite" (reason plan_limit)
import type { Principal } from "@/lib/authz/types";
import type { SubscriptionRow, TenantRow } from "./types";

export type WriteMode = "ok" | "readonly" | "suspended";
export type ModeReason = "suspended" | "trial_ended" | "cancelled" | "past_due";
export interface OrgState {
  mode: WriteMode; reason: ModeReason | null; trialEndsAt: string | null; daysLeft: number | null;
  warn: "trial_ending" | "past_due" | null;
}
const DAY = 86_400_000;
export const TRIAL_WARN_DAYS = 3;

export function orgState(i: { tenant: Pick<TenantRow, "status" | "trialEndsAt"> | null; sub: SubscriptionRow | null; now: Date; graceDays?: number | null }): OrgState {
  const now = i.now.getTime();
  const base: OrgState = { mode: "ok", reason: null, trialEndsAt: null, daysLeft: null, warn: null };
  if (i.tenant && i.tenant.status !== "active") return { ...base, mode: "suspended", reason: "suspended" };
  const s = i.sub;
  if (!s || s.status === "manual") return base;
  if (s.status === "trial") {
    const end = s.trialEndsAt ?? i.tenant?.trialEndsAt ?? null;
    if (!end) return base;
    const t = Date.parse(end);
    if (Number.isNaN(t)) return base;
    const daysLeft = Math.ceil((t - now) / DAY);
    if (t < now) return { ...base, mode: "readonly", reason: "trial_ended", trialEndsAt: end, daysLeft: 0 };
    return { ...base, trialEndsAt: end, daysLeft, warn: daysLeft <= TRIAL_WARN_DAYS ? "trial_ending" : null };
  }
  if (s.status === "cancelled") {
    const end = s.currentPeriodEnd ? Date.parse(s.currentPeriodEnd) : NaN;
    return Number.isNaN(end) || end < now ? { ...base, mode: "readonly", reason: "cancelled" } : base;
  }
  if (s.status === "past_due") {
    const end = s.currentPeriodEnd ? Date.parse(s.currentPeriodEnd) : now;
    const cutoff = i.graceDays == null ? null : end + i.graceDays * DAY;
    if (cutoff != null && now > cutoff) return { ...base, mode: "readonly", reason: "past_due", warn: "past_due" };
    return { ...base, warn: "past_due" };
  }
  return base;
}

export interface SeatStatus { used: number; limit: number | null; remaining: number | null; atLimit: boolean; over: boolean }
/** Effective seat limit: the lowest of the plan limit (already overlaid with the org policy) and the purchased seat count. Absent = unlimited. */
export function seatLimit(limits: Record<string, number>, purchased: number | null): number | null {
  const c = [limits.seats, purchased].filter((x): x is number => typeof x === "number" && x >= 0);
  return c.length ? Math.min(...c) : null;
}
export function seatStatus(used: number, limit: number | null): SeatStatus {
  if (limit == null) return { used, limit, remaining: null, atLimit: false, over: false };
  return { used, limit, remaining: Math.max(0, limit - used), atLimit: used >= limit, over: used > limit };
}
/** An invite is allowed while seats remain, or when the invitee already holds a seat. */
export const canAddSeat = (st: SeatStatus, alreadySeated = false): boolean => alreadySeated || !st.atLimit;

export const READONLY_SINCE = "1970-01-01T00:00:00.000Z";
/** Fold billing state into a principal so the engine's steps 2 and 3 enforce it. Never loosens: an already suspended tenant stays suspended. */
export function applyBilling(p: Principal, b: { org: OrgState; seats: SeatStatus }): Principal {
  let tenant = p.tenant;
  if (b.org.mode === "suspended") tenant = { status: "suspended" };
  else if (b.org.mode === "readonly" && tenant?.status !== "suspended") tenant = { status: "trial", trialEndsAt: READONLY_SINCE };
  const capped = new Set(p.capped ?? []);
  if (b.seats.atLimit) capped.add("members.invite");
  return { ...p, tenant, capped: capped.size ? [...capped] : p.capped };
}
