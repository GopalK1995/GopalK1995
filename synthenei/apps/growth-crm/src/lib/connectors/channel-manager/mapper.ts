// Reservation -> `booking` record data. Pure. Rules: nothing is invented (a missing amount stays null), money is stored in major units,
// commission is either the percentage the manager sent or derived from its exact amount, and every field is bounded before it is stored.
import type { BookingData, DateOnly, Reservation, ReservationEvent } from "./types";

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;
export const clip = (s: string | null | undefined, n: number): string | null => { const t = (s ?? "").replace(CONTROL, " ").trim(); return t ? t.slice(0, n) : null; };

export const EXPONENT: Record<string, number> = { JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, KWD: 3, BHD: 3, OMR: 3, JOD: 3, TND: 3 };
export const exponentOf = (cur: string): number => EXPONENT[cur] ?? 2;
export const minorToMajor = (minor: number, cur: string): number => Math.round(minor) / 10 ** exponentOf(cur);

export const isDateOnly = (s: unknown): s is DateOnly => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
export const addDays = (s: DateOnly, n: number): DateOnly => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const nightsBetween = (a: DateOnly, b: DateOnly): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
export const MAX_STAY_NIGHTS = 366;

/** The CRM's `source_ota` choice for a manager's channel code; null when it is none of the seeded choices (the raw label is still kept). */
export function channelToSource(channel: string): "booking_com" | "makemytrip" | "airbnb" | "direct" | null {
  const k = channel.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (k === "bookingcom" || k === "booking" || k === "bdc") return "booking_com";
  if (k === "makemytrip" || k === "mmt" || k === "goibibo" || k === "ibibo" || k === "mmtgoibibo") return "makemytrip";
  if (k === "airbnb") return "airbnb";
  if (k === "direct" || k === "website" || k === "bookingengine") return "direct";
  return null;
}

export type MapResult = { ok: true; data: BookingData; title: string } | { ok: false; reason: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function reservationToBooking(r: Reservation, kind: ReservationEvent["kind"]): MapResult {
  if (!r.externalId || r.externalId.length > 300) return { ok: false, reason: "bad_id" };
  if (!isDateOnly(r.checkIn) || !isDateOnly(r.checkOut)) return { ok: false, reason: "bad_dates" };
  const nights = nightsBetween(r.checkIn, r.checkOut);
  if (nights < 1 || nights > MAX_STAY_NIGHTS) return { ok: false, reason: "bad_stay_length" };
  if (r.guests !== null && (!Number.isInteger(r.guests) || r.guests < 1 || r.guests > 99)) return { ok: false, reason: "bad_guests" };
  if (r.totalMinor !== null && (!Number.isFinite(r.totalMinor) || r.totalMinor < 0)) return { ok: false, reason: "bad_amount" };
  if (r.commissionMinor !== null && (!Number.isFinite(r.commissionMinor) || r.commissionMinor < 0)) return { ok: false, reason: "bad_commission" };
  if (r.commissionPct !== null && (!Number.isFinite(r.commissionPct) || r.commissionPct < 0 || r.commissionPct > 100)) return { ok: false, reason: "bad_commission" };
  if ((r.totalMinor !== null || r.commissionMinor !== null) && !(typeof r.currency === "string" && /^[A-Z]{3}$/.test(r.currency))) return { ok: false, reason: "bad_currency" };
  if (!Number.isFinite(r.version)) return { ok: false, reason: "bad_version" };
  const channel = clip(r.channel, 60);
  if (!channel) return { ok: false, reason: "bad_channel" };

  const cur = r.currency;
  const pct = r.commissionPct ?? (r.commissionMinor !== null && r.totalMinor !== null && r.totalMinor > 0 ? round2((r.commissionMinor / r.totalMinor) * 100) : null);
  const commissionMinor = r.commissionMinor ?? (pct !== null && r.totalMinor !== null ? Math.round((r.totalMinor * pct) / 100) : null);
  const data: BookingData = {
    check_in: r.checkIn, check_out: r.checkOut, room: clip(r.room, 80), guests: r.guests, source_ota: channelToSource(channel), commission_pct: pct,
    status: kind === "cancelled" ? "cancelled" : "confirmed", entry: "reservation", ota_channel: channel, external_ref: clip(r.channelRef, 80),
    total_amount: r.totalMinor !== null && cur ? minorToMajor(r.totalMinor, cur) : null,
    currency: r.totalMinor !== null || commissionMinor !== null ? cur : null,
    commission_amount: commissionMinor !== null && cur ? minorToMajor(commissionMinor, cur) : null,
    guest_name: clip(r.guestName, 120), origin: "channel_manager", source_version: Math.trunc(r.version),
  };
  const title = clip(`${channel} ${r.channelRef ?? r.externalId}`, 300) ?? "Booking";
  return { ok: true, data, title };
}
