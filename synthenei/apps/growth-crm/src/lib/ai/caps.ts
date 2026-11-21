// Cap evaluation. The database function ai_cap_status() counts real usage; this module re-evaluates the numbers it returns and FAILS CLOSED,
// so a missing, malformed or "allowed: true" answer with exceeded numbers can never let a call through. Pure.
import type { CapStatus } from "./types";

export type CapReason = "monthly_calls" | "plan_calls" | "monthly_tokens" | "user_daily" | "unavailable";

/** Rough token estimate (chars / 3.5 covers English, Latin and Tamil prompts conservatively) used to stop a call that would cross the token cap. */
export const estimateTokens = (chars: number, maxOut: number) => Math.ceil(chars / 3.5) + maxOut;

export function evaluateCaps(s: CapStatus | null, estimate = 0): { ok: true } | { ok: false; reason: CapReason } {
  if (!s || typeof s !== "object" || !s.usage || !s.caps) return { ok: false, reason: "unavailable" };
  if (s.allowed !== true) return { ok: false, reason: (s.reason as CapReason | null) ?? "unavailable" };
  const { usage: u, caps: c } = s;
  if (c.monthly_call_cap != null && u.calls_month >= c.monthly_call_cap) return { ok: false, reason: "monthly_calls" };
  if (c.plan_calls != null && u.calls_month >= c.plan_calls) return { ok: false, reason: "plan_calls" };
  if (c.monthly_token_cap != null && u.tokens_month + estimate > c.monthly_token_cap) return { ok: false, reason: "monthly_tokens" };
  if (c.per_user_daily_cap != null && u.user_calls_today >= c.per_user_daily_cap) return { ok: false, reason: "user_daily" };
  return { ok: true };
}
