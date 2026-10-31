// Per-user preferences -> what to do with one notification. Pure.
// In-app is always created for a rule match (the bell must never silently miss something), except when the user
// muted the kind (digest "off"). Email follows the rule AND the user's channel choice, and respects quiet hours (IST).
import { inQuietHours, parseQuiet, quietEndsAt, type QuietHours } from "./quiet";
import type { Channel, Digest, PrefRow } from "./types";

export const QUIET_KIND_PREFIX = "_quiet:";
export const quietKind = (hhmm: string) => `${QUIET_KIND_PREFIX}${hhmm}`;
export const isQuietKind = (k: string) => k.startsWith(QUIET_KIND_PREFIX);
/** Quiet hours live in a reserved pref row (kind "_quiet:22:00-07:00") until a column exists; see report "Needs from integrator". */
export function quietFromPrefs(prefs: readonly PrefRow[]): QuietHours | null {
  const row = prefs.find((p) => isQuietKind(p.kind));
  return row ? parseQuiet(row.kind.slice(QUIET_KIND_PREFIX.length)) : null;
}

/** Most specific pref wins: exact type, then "domain.*", then "*". */
export function prefFor(prefs: readonly PrefRow[], eventType: string): PrefRow | null {
  const real = prefs.filter((p) => !isQuietKind(p.kind));
  const dom = `${eventType.split(".")[0]}.*`;
  return real.find((p) => p.kind === eventType) ?? real.find((p) => p.kind === dom) ?? real.find((p) => p.kind === "*") ?? null;
}

export interface Delivery {
  muted: boolean;
  inApp: boolean;
  /** "none" = not an email recipient; "queued" = handed to the (stub) sender, never claimed as sent. */
  email: "none" | "queued";
  /** Email waits for this ISO time (quiet hours end, or the digest window) before the sender may deliver. */
  deliverAfter?: string;
  digest: Digest;
}

export function decideDelivery(i: { ruleChannels: readonly Channel[]; prefs: readonly PrefRow[]; eventType: string; now: Date }): Delivery {
  const pref = prefFor(i.prefs, i.eventType);
  const digest: Digest = pref?.digest ?? "instant";
  if (digest === "off") return { muted: true, inApp: false, email: "none", digest };
  const wantsEmail = i.ruleChannels.includes("email") && (pref ? pref.channels.includes("email") : true);
  if (!wantsEmail) return { muted: false, inApp: true, email: "none", digest };
  const quiet = quietFromPrefs(i.prefs);
  let after: Date | null = null;
  if (inQuietHours(i.now, quiet)) after = quietEndsAt(i.now, quiet);
  if (digest === "hourly" || digest === "daily") {
    // Digest delivery is a later job (T038); the window only records the earliest time it may go out.
    const win = new Date(i.now.getTime() + (digest === "hourly" ? 3600e3 : 86400e3));
    if (!after || win > after) after = win;
  }
  return { muted: false, inApp: true, email: "queued", deliverAfter: after ? after.toISOString() : undefined, digest };
}
