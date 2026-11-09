// Pure mapping between CRM leads and Mailchimp audience members, and the pull/webhook payloads back. No I/O.
import { createHash } from "node:crypto";
import type { SuppressionReason } from "../email/suppression";
import { normaliseEmail } from "../email/suppression";
import type { Recipient } from "../email/store";

/** Mailchimp's member id: md5 of the lower-cased address. */
export const subscriberHash = (email: string): string => createHash("md5").update(normaliseEmail(email)).digest("hex");

export interface McMemberPut { email_address: string; status_if_new: "subscribed"; merge_fields: Record<string, string>; tags?: string[] }

/** One consented lead -> the member body for PUT /lists/{id}/members/{hash}. status_if_new keeps an existing member's status, so a
 *  person who unsubscribed in Mailchimp is never silently re-subscribed by a push. */
export function toMember(r: Recipient, tag?: string | null): McMemberPut | null {
  const email = r.email?.trim();
  if (!email) return null;
  const parts = r.fullName.trim().split(/\s+/).filter(Boolean);
  const fname = parts[0] ?? "", lname = parts.slice(1).join(" ");
  const merge_fields: Record<string, string> = {};
  if (fname) merge_fields.FNAME = fname.slice(0, 50);
  if (lname) merge_fields.LNAME = lname.slice(0, 50);
  const t = tag?.replace(/[\r\n]/g, " ").trim().slice(0, 100);
  return { email_address: normaliseEmail(email), status_if_new: "subscribed", merge_fields, ...(t ? { tags: [t] } : {}) };
}

export type McStatus = "subscribed" | "unsubscribed" | "cleaned" | "pending" | "transactional" | "archived";
/** Mailchimp statuses that mean "stop emailing": unsubscribed is the person's choice; cleaned is a hard bounce (or repeated soft bounces). */
export function reasonForStatus(s: string): SuppressionReason | null {
  return s === "unsubscribed" ? "unsubscribe" : s === "cleaned" ? "hard_bounce" : null;
}

export interface McPulled { email: string; status: "unsubscribed" | "cleaned"; changedAt: string | null }
/** One page of GET /lists/{id}/members?status=... */
export function parseMembers(raw: unknown, status: "unsubscribed" | "cleaned"): { rows: McPulled[]; total: number } {
  const o = (raw ?? {}) as { members?: unknown; total_items?: unknown };
  const rows = (Array.isArray(o.members) ? o.members : []).flatMap((m): McPulled[] => {
    const r = (m ?? {}) as { email_address?: unknown; last_changed?: unknown };
    return typeof r.email_address === "string" && r.email_address.includes("@") ? [{ email: normaliseEmail(r.email_address), status, changedAt: typeof r.last_changed === "string" ? r.last_changed : null }] : [];
  });
  return { rows, total: typeof o.total_items === "number" ? o.total_items : rows.length };
}

export type McHook = { type: "unsubscribe" | "cleaned"; email: string; listId: string | null; reason: string | null };
/** Mailchimp webhooks are application/x-www-form-urlencoded with bracketed keys (data[email]). Other types (subscribe, profile, upemail) are ignored. */
export function parseWebhook(raw: string): McHook[] {
  const p = new URLSearchParams(raw);
  const type = p.get("type");
  if (type !== "unsubscribe" && type !== "cleaned") return [];
  const email = p.get("data[email]");
  if (!email || !email.includes("@")) return [];
  return [{ type, email: normaliseEmail(email), listId: p.get("data[list_id]"), reason: p.get("data[reason]") }];
}
export const chunkIds = (ids: readonly string[], n = 50): string[][] => { const out: string[][] = []; for (let i = 0; i < ids.length; i += n) out.push(ids.slice(i, i + n)); return out; };
export const hookReason =(h: McHook): SuppressionReason => (h.type === "unsubscribe" ? "unsubscribe" : "hard_bounce");
