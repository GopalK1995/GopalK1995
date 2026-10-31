// Reconnect delay: exponential, jittered over its top half, capped.
export interface BackoffOptions { base?: number; max?: number; random?: () => number }
export function backoffDelay(attempt: number, o: BackoffOptions = {}): number {
  const base = o.base ?? 1000, max = o.max ?? 30000, rnd = o.random ?? Math.random;
  const exp = Math.min(max, base * 2 ** Math.max(0, attempt));
  return Math.round(exp / 2 + (exp / 2) * rnd());
}
