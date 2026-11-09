// Suppression logic (pure): which provider events suppress an address, how reasons rank, and whether an address may be mailed.
// Hard bounces, spam complaints and unsubscribes suppress; soft bounces and delays never do (the provider retries them).
export type SuppressionReason = "hard_bounce" | "complaint" | "unsubscribe" | "manual";
export interface SuppressionEntry { email: string; reason: SuppressionReason; source: string; at: string }

export const normaliseEmail = (e: string): string => e.normalize("NFKC").trim().toLowerCase();

export type ProviderEvent =
  | { kind: "delivered" | "sent" | "delayed" | "opened" | "clicked" }
  | { kind: "bounced"; hard: boolean }
  | { kind: "complained" }
  | { kind: "failed"; reason?: string };

/** The suppression an event causes, or null. Undetermined bounces are treated as soft: nothing is suppressed on a guess. */
export function suppressionFor(e: ProviderEvent): SuppressionReason | null {
  if (e.kind === "bounced") return e.hard ? "hard_bounce" : null;
  if (e.kind === "complained") return "complaint";
  return null;
}
/** Provider bounce type -> hard. Resend: Permanent / Transient / Undetermined. Anything unrecognised is not hard. */
export const isHardBounce = (type: unknown): boolean => typeof type === "string" && type.trim().toLowerCase() === "permanent";

/** Reasons that must also write a consent withdrawal (the person said no). A hard bounce says the address is dead, not that they declined. */
export const withdrawsConsent = (r: SuppressionReason): boolean => r === "complaint" || r === "unsubscribe";

export function isSuppressed(list: readonly Pick<SuppressionEntry, "email">[], email: string): boolean {
  const n = normaliseEmail(email);
  return list.some((s) => normaliseEmail(s.email) === n);
}
