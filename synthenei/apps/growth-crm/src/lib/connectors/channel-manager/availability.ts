// Availability out: turns the workspace's confirmed `booking` records (any origin: channel manager, iCal import, direct) into the closed
// ranges per room that the channel manager must hide from every OTA. Pure. The snapshot is complete, so a cancelled booking simply
// disappears from it and the range reopens; there is no separate "reopen" call to forget.
import { createHash } from "node:crypto";
import type { StoredBooking } from "./booking-store";
import { addDays, isDateOnly } from "./mapper";
import type { AvailabilityBlock, AvailabilitySnapshot, DateOnly } from "./types";

export const DEFAULT_HORIZON_DAYS = 365;

export interface SnapshotResult { snapshot: AvailabilitySnapshot; /** bookings with no room: they close nothing, because we cannot say which unit is taken */ unassigned: number }

export function buildSnapshot(bookings: StoredBooking[], today: DateOnly, horizonDays = DEFAULT_HORIZON_DAYS): SnapshotResult {
  const windowFrom = today, windowTo = addDays(today, horizonDays);
  const byRoom = new Map<string, [DateOnly, DateOnly][]>();
  let unassigned = 0;
  for (const b of bookings) {
    const d = b.data;
    if (d.status !== "confirmed" || !isDateOnly(d.check_in) || !isDateOnly(d.check_out)) continue;
    const from = d.check_in, to = d.check_out > windowTo ? windowTo : d.check_out;   // start is kept as booked so a stay in progress does not change the hash daily
    if (to <= windowFrom || to <= from) continue;
    if (!d.room) { unassigned++; continue; }
    const list = byRoom.get(d.room) ?? [];
    list.push([from, to]);
    byRoom.set(d.room, list);
  }
  const closed: AvailabilityBlock[] = [];
  for (const room of [...byRoom.keys()].sort()) {
    const ranges = byRoom.get(room)!.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    let [cf, ct] = ranges[0];
    for (const [f, t] of ranges.slice(1)) {
      if (f <= ct) { if (t > ct) ct = t; } else { closed.push({ room, from: cf, to: ct }); cf = f; ct = t; }
    }
    closed.push({ room, from: cf, to: ct });
  }
  return { snapshot: { windowFrom, windowTo, closed }, unassigned };
}

/** Stable fingerprint of what the manager should be showing; an unchanged hash means nothing needs to be sent. */
export const snapshotHash = (s: AvailabilitySnapshot): string => createHash("sha256").update(JSON.stringify(s.closed)).digest("hex");
