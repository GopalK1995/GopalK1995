// Subject reference: sha256 (hex) of the lower-cased, trimmed email. Same recipe as connectors/email/withdraw.ts and consent_log.subject_ref,
// so a withdrawal made here lines up with an unsubscribe made from a campaign email. The address itself is never stored in privacy_requests.
import { createHash } from "node:crypto";

export const normaliseEmail = (e: string): string => e.trim().toLowerCase();
export const isEmail = (e: string): boolean => e.length <= 254 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(e);
export const subjectRefOf = (email: string): string => createHash("sha256").update(normaliseEmail(email)).digest("hex");
/** a***@d***.com: enough for a person to recognise their own address, not enough to harvest. */
export function maskEmail(e: string): string {
  const [u, d] = e.split("@");
  if (!u || !d) return "***";
  const dot = d.lastIndexOf(".");
  return `${u[0]}***@${d[0]}***${dot > 0 ? d.slice(dot) : ""}`;
}
