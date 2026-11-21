// Calendly webhook body -> BookingEvent[]. Published shape: { event: "invitee.created"|"invitee.canceled", created_at, payload: invitee }.
// invitee: { uri, email, name, rescheduled, old_invitee, cancellation: { reason }, scheduled_event: { name, start_time, end_time } }.
// Pure and defensive: unknown events -> `ignored`, malformed bodies -> no events.
import type { BookingEvent } from "./booking-types";
import { TEXT_MAX } from "./constants";

type R = Record<string, unknown>;
const obj = (v: unknown): R | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as R) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
export const cleanEmail = (v: unknown): string | null => { const s = str(v)?.toLowerCase(); return s && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null; };
export const cleanTime = (v: unknown): string | null => { const s = str(v); if (!s) return null; const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
export const clip = (s: string | undefined, max = TEXT_MAX): string => (s ?? "").replace(/[\u0000-\u001f]+/g, " ").slice(0, max);

export function parseCalendly(rawBody: string): BookingEvent[] {
  let j: unknown;
  try { j = JSON.parse(rawBody); } catch { return []; }
  const root = obj(j), event = str(root?.event), p = obj(root?.payload);
  if (!root || !event || !p) return [];
  const kind = event === "invitee.created" ? "booked" : event === "invitee.canceled" ? "cancelled" : "ignored";
  const uri = str(p.uri);
  const se = obj(p.scheduled_event);
  if (kind === "ignored" || !uri) return [{ kind: "ignored", vendor: "calendly", externalId: uri ?? "", email: null, name: null, title: "", startsAt: null, endsAt: null, rescheduled: false }];
  return [{
    kind, vendor: "calendly", externalId: uri.slice(0, 300), email: cleanEmail(p.email), name: clip(str(p.name), 120) || null,
    title: clip(str(se?.name)) || "Booking", startsAt: cleanTime(se?.start_time), endsAt: cleanTime(se?.end_time),
    rescheduled: kind === "booked" ? obj(p.old_invitee) !== undefined || typeof p.old_invitee === "string" : p.rescheduled === true,
    reason: kind === "cancelled" ? clip(str(obj(p.cancellation)?.reason), 120) || undefined : undefined,
  }];
}
