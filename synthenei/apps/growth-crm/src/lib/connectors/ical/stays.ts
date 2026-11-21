// iCal event -> stay (a date range in the property's calendar). Pure.
// Conventions: an all-day DTEND is exclusive, which is exactly "check-out" (the first free night is the departure day). Timed events are
// converted to the property's time zone and reduced to dates. A floating time is read in the property zone. An unknown TZID falls back
// to the property zone and is reported as a warning, never guessed any other way. Only the dates and the kind survive: the summary and
// description (which can carry a guest's name or phone digits) are read for classification and then dropped.
import { addDays, nightsBetween } from "../channel-manager/mapper";
import { dateInZone, validZone, wallToUtc } from "../channel-manager/tz";
import type { DateOnly } from "../channel-manager/types";
import { MAX_STAY_DAYS, type FeedSource } from "./constants";
import type { IcalEvent, IcalTime } from "./parser";

export interface Stay {
  uid: string; checkIn: DateOnly; checkOut: DateOnly; kind: "reservation" | "block"; cancelled: boolean; sequence: number; modifiedMs: number | null; warnings: string[];
}
export type StayResult = { ok: true; stay: Stay } | { ok: false; reason: string };

/** A reservation shows a name or "Reserved"; a block says the dates are not available. Booking.com's feed only ever sends blocks. */
export function classify(source: FeedSource, summary: string): "reservation" | "block" {
  if (/not\s*available|unavailable|closed|blocked|\bblock(ed)?\b/i.test(summary)) return "block";
  if (source === "booking_com") return "block";
  return "reservation";
}

function dateOf(t: IcalTime, zone: string, warnings: string[]): DateOnly {
  switch (t.kind) {
    case "date": return t.date;
    case "utc": return dateInZone(t.ms, zone);
    case "floating": return dateInZone(wallToUtc(t.wall, zone), zone);
    case "zoned": {
      const tz = validZone(t.tzid) ? t.tzid : null;
      if (!tz) warnings.push("tz_unknown");
      return dateInZone(wallToUtc(t.wall, tz ?? zone), zone);
    }
  }
}
const instantOf = (t: IcalTime, zone: string): number => (t.kind === "date" ? Date.parse(`${t.date}T00:00:00Z`) : t.kind === "utc" ? t.ms : t.kind === "floating" ? wallToUtc(t.wall, zone) : wallToUtc(t.wall, validZone(t.tzid) ? t.tzid : zone));

export function eventToStay(ev: IcalEvent, opts: { zone: string; source: FeedSource }): StayResult {
  if (!ev.dtstart) return { ok: false, reason: "no_start" };
  const warnings: string[] = [];
  const zone = validZone(opts.zone) ? opts.zone : "UTC";
  const start = ev.dtstart;
  const checkIn = dateOf(start, zone, warnings);
  let checkOut: DateOnly;
  if (ev.dtend) {
    checkOut = dateOf(ev.dtend, zone, warnings);
  } else if (ev.duration) {
    checkOut = start.kind === "date"
      ? addDays(checkIn, ev.duration.days)
      : dateInZone(instantOf(start, zone) + ev.duration.days * 86_400_000 + ev.duration.ms, zone);
  } else {
    checkOut = addDays(checkIn, 1);          // RFC 5545: a DATE start with no end lasts one day
  }
  // A timed event inside one calendar day (or a zero-length one) closes that night; a date-only zero-length range is malformed.
  if (checkOut <= checkIn) {
    if (start.kind === "date") return { ok: false, reason: "empty_range" };
    checkOut = addDays(checkIn, 1);
  }
  if (nightsBetween(checkIn, checkOut) > MAX_STAY_DAYS) return { ok: false, reason: "range_too_long" };
  return { ok: true, stay: { uid: ev.uid, checkIn, checkOut, kind: classify(opts.source, ev.summary), cancelled: ev.status === "CANCELLED", sequence: ev.sequence, modifiedMs: ev.lastModifiedMs, warnings } };
}

/** One stay per UID: the highest SEQUENCE wins, then the latest LAST-MODIFIED, then the later one in the file. A cancelled copy beats a confirmed
 *  one only by those same rules (feeds that cancel by deleting the event simply do not list it). */
export function dedupeByUid(stays: Stay[]): Stay[] {
  const best = new Map<string, Stay>();
  for (const s of stays) {
    const cur = best.get(s.uid);
    if (!cur || s.sequence > cur.sequence || (s.sequence === cur.sequence && (s.modifiedMs ?? 0) >= (cur.modifiedMs ?? 0))) best.set(s.uid, s);
  }
  return [...best.values()];
}
