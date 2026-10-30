// Bearer-secret check for /api/jobs/tick. Constant time; accepts JOBS_TICK_SECRET (pg_net) or CRON_SECRET (Vercel Cron).
import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string) => createHash("sha256").update(s).digest();

export function bearerToken(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return m ? m[1].trim() : null;
}

/** Compares SHA-256 digests with timingSafeEqual, so length differences leak nothing and unset secrets never match. */
export function tickAuthorized(authHeader: string | null | undefined, secrets: ReadonlyArray<string | undefined>): boolean {
  const token = bearerToken(authHeader);
  if (!token) return false;
  const t = digest(token);
  let ok = false;
  for (const s of secrets) {
    if (!s) continue;
    if (timingSafeEqual(t, digest(s))) ok = true;
  }
  return ok;
}
