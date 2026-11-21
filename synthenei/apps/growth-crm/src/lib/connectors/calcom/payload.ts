// Cal.com webhook body -> BookingEvent[]. Shape: { triggerEvent: "BOOKING_CREATED"|"BOOKING_CANCELLED"|"BOOKING_RESCHEDULED", createdAt,
//   payload: { title, startTime, endTime, uid, rescheduleUid, attendees: [{ email, name }], cancellationReason } }.
// BOOKING_RESCHEDULED = the old booking (rescheduleUid) is cancelled silently and the new one (uid) is booked, so two events come back.
import type { BookingEvent } from "../calendly/booking-types";
import { cleanEmail, cleanTime, clip } from "../calendly/payload";

type R = Record<string, unknown>;
const obj = (v: unknown): R | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as R) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export function parseCalcom(rawBody: string): BookingEvent[] {
  let j: unknown;
  try { j = JSON.parse(rawBody); } catch { return []; }
  const root = obj(j), trig = str(root?.triggerEvent), p = obj(root?.payload);
  if (!root || !trig || !p) return [];
  const uid = str(p.uid);
  const ignored: BookingEvent = { kind: "ignored", vendor: "cal-com", externalId: uid ?? "", email: null, name: null, title: "", startsAt: null, endsAt: null, rescheduled: false };
  if (!uid || !["BOOKING_CREATED", "BOOKING_CANCELLED", "BOOKING_RESCHEDULED"].includes(trig)) return [ignored];
  const a = obj(Array.isArray(p.attendees) ? p.attendees[0] : undefined);
  const base = { vendor: "cal-com" as const, email: cleanEmail(a?.email), name: clip(str(a?.name), 120) || null, title: clip(str(p.title)) || "Booking", startsAt: cleanTime(p.startTime), endsAt: cleanTime(p.endTime) };
  if (trig === "BOOKING_CANCELLED") return [{ ...base, kind: "cancelled", externalId: uid.slice(0, 300), rescheduled: false, reason: clip(str(p.cancellationReason), 120) || undefined }];
  const out: BookingEvent[] = [];
  const old = str(p.rescheduleUid);
  if (trig === "BOOKING_RESCHEDULED" && old && old !== uid) out.push({ ...base, kind: "cancelled", externalId: old.slice(0, 300), rescheduled: true });
  out.push({ ...base, kind: "booked", externalId: uid.slice(0, 300), rescheduled: trig === "BOOKING_RESCHEDULED" });
  return out;
}
