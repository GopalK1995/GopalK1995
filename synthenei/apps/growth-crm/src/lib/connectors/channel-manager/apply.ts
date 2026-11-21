// Applies one reservation event (created / modified / cancelled) to the `booking` object. Idempotent and order-tolerant:
//   - the same delivery twice is a no-op (content hash on the external link),
//   - an older version never overwrites a newer one,
//   - a cancellation for a reservation we never saw creates nothing,
//   - a cancelled booking is never resurrected by a late "modified".
// Everything is scoped by the connection's tenant and workspace; the store enforces it.
import { createHash } from "node:crypto";
import type { BookingRecordStore, Log, RecordScope } from "./booking-store";
import { reservationToBooking } from "./mapper";
import type { BookingData, ReservationEvent } from "./types";

export const RESERVATION_OBJECT = "reservation";
export type ApplyOutcome =
  | { outcome: "created" | "updated" | "cancelled" | "unchanged" | "already_cancelled" | "stale" | "ignored_cancel"; recordId: string | null }
  | { outcome: "rejected"; reason: string }
  | { outcome: "no_booking_object" };

export const hashOfBooking = (d: BookingData): string => {
  const { source_version: _v, ...rest } = d;
  void _v;
  const sorted = Object.fromEntries(Object.entries(rest).sort(([a], [b]) => (a < b ? -1 : 1)));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
};

export interface ApplyDeps { store: BookingRecordStore; log: Log }

export async function applyReservationEvent(d: ApplyDeps, scope: RecordScope, ev: ReservationEvent): Promise<ApplyOutcome> {
  const mapped = reservationToBooking(ev.reservation, ev.kind);
  if (!mapped.ok) return { outcome: "rejected", reason: mapped.reason };
  const objectId = await d.store.bookingObjectId(scope);
  if (!objectId) return { outcome: "no_booking_object" };
  const extId = ev.reservation.externalId;

  for (let attempt = 0; attempt < 2; attempt++) {
    const cur = await d.store.findByExternal(scope, RESERVATION_OBJECT, extId);
    if (!cur) {
      if (ev.kind === "cancelled") return { outcome: "ignored_cancel", recordId: null };
      const id = await d.store.create(scope, objectId, { title: mapped.title, data: mapped.data }, { externalObject: RESERVATION_OBJECT, externalId: extId, hash: hashOfBooking(mapped.data) });
      await d.store.emit({ type: "booking.created", workspaceId: scope.workspaceId, recordId: id, data: { source: mapped.data.source_ota, origin: "channel_manager" } });
      return { outcome: "created", recordId: id };
    }
    if (mapped.data.source_version < cur.data.source_version) return { outcome: "stale", recordId: cur.recordId };
    if (cur.data.status === "cancelled") return { outcome: ev.kind === "cancelled" ? "already_cancelled" : "stale", recordId: cur.recordId };

    // A cancellation keeps what we already know (the cancel payload may be thinner) and only flips the status.
    const next: BookingData = ev.kind === "cancelled" ? { ...cur.data, status: "cancelled", source_version: mapped.data.source_version } : mapped.data;
    const title = ev.kind === "cancelled" ? cur.title : mapped.title;
    const hash = hashOfBooking(next);
    if (hash === cur.hash && ev.kind !== "cancelled") return { outcome: "unchanged", recordId: cur.recordId };
    const r = await d.store.update(scope, cur, { title, data: next }, hash);
    if (r === "conflict") continue;
    if (ev.kind === "cancelled") {
      await d.store.emit({ type: "booking.cancelled", workspaceId: scope.workspaceId, recordId: cur.recordId, data: { source: next.source_ota, origin: "channel_manager" } });
      return { outcome: "cancelled", recordId: cur.recordId };
    }
    return { outcome: "updated", recordId: cur.recordId };
  }
  d.log.warn("booking update kept conflicting", { connection: scope.connectionId });
  throw new Error("booking record changed concurrently; will retry");
}
