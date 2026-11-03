// Retry schedule (CONTRACTS C10): after attempt n fails, wait SCHEDULE[n-1] seconds (+/- 20 % jitter). Seven attempts in all, then `dead`.
export const RETRY_SCHEDULE_SECONDS = [30, 120, 600, 3600, 21600, 86400] as const;
export const MAX_ATTEMPTS = RETRY_SCHEDULE_SECONDS.length + 1;
export const JITTER = 0.2;
/** Auto-disable: at least this many consecutive failures AND no success for this long (CONTRACTS C10). */
export const AUTO_DISABLE_FAILURES = 20;
export const AUTO_DISABLE_AFTER_MS = 5 * 24 * 3600 * 1000;
/** Rotation keeps the previous secret signing for 24 h (plan 1.8). */
export const ROTATION_GRACE_MS = 24 * 3600 * 1000;
/** Delivery log retention (days). */
export const DELIVERY_RETENTION_DAYS = 30;

/** Seconds to wait before attempt `failedAttempt + 1`, or null when attempts are exhausted. `rand` in [0,1). */
export function retryDelaySeconds(failedAttempt: number, rand: () => number = Math.random): number | null {
  if (failedAttempt < 1 || failedAttempt >= MAX_ATTEMPTS) return null;
  const base = RETRY_SCHEDULE_SECONDS[failedAttempt - 1];
  const f = 1 + (rand() * 2 - 1) * JITTER;
  return Math.max(1, Math.round(base * f));
}

export function shouldAutoDisable(consecutiveFailures: number, lastSuccessAt: string | null, endpointCreatedAt: string, now: number): boolean {
  if (consecutiveFailures < AUTO_DISABLE_FAILURES) return false;
  const since = Date.parse(lastSuccessAt ?? endpointCreatedAt);
  return now - since >= AUTO_DISABLE_AFTER_MS;
}

export const graceActive = (rotatedAt: string | null, now: number) => !!rotatedAt && now - Date.parse(rotatedAt) < ROTATION_GRACE_MS;
