// Persistence port for `booking` custom-object records written by the channel manager and the iCal import. The Supabase implementation
// (store-supabase.ts, service role) is the only code that touches tables; unit tests use an in-memory fake with the same scoping rules.
// Every call carries the scope (tenant, workspace, connection): a record or link of another tenant can never be read or written.
import type { BookingData } from "./types";

export interface RecordScope { tenantId: string; workspaceId: string; connectionId: string }
export interface StoredBooking { recordId: string; title: string; data: BookingData; /** records.version, for compare-and-set */ version: number; /** content hash kept on the external link */ hash: string | null }
export interface BookingFields { title: string; data: BookingData }

export interface BookingRecordStore {
  /** The tenant's `booking` object (hospitality preset). Null when the tenant has none: the sync then reports needs_attention, never invents the object. */
  bookingObjectId(s: RecordScope): Promise<string | null>;
  /** Looks a record up through the external link (connection + external object + external id). Soft-deleted records count as missing. */
  findByExternal(s: RecordScope, externalObject: string, externalId: string): Promise<StoredBooking | null>;
  /** Creates the record and its link together; a lost race (link already exists) returns the existing record id. */
  create(s: RecordScope, objectId: string, f: BookingFields, link: { externalObject: string; externalId: string; hash: string }): Promise<string>;
  /** Compare-and-set on records.version. "conflict" = someone else changed it first; the caller re-reads once. */
  update(s: RecordScope, rec: StoredBooking, f: BookingFields, hash: string): Promise<"ok" | "conflict">;
  /** Every record linked under one external object (one iCal feed) with its data, for missing-event detection. */
  listByExternalObject(s: RecordScope, externalObject: string): Promise<{ externalId: string; booking: StoredBooking }[]>;
  /** Confirmed bookings whose check-out is on or after `fromDate`, any origin, workspace-wide. `room` narrows to one property. Capped. */
  listBlocking(s: { tenantId: string; workspaceId: string }, q: { fromDate: string; room?: string; limit: number }): Promise<StoredBooking[]>;
  /** Best-effort bus event (booking.created / booking.cancelled). Never throws. */
  emit(e: { type: "booking.created" | "booking.cancelled"; workspaceId: string; recordId: string; data: Record<string, unknown> }): Promise<void>;
}

export interface Log { info(m: string, f?: Record<string, unknown>): void; warn(m: string, f?: Record<string, unknown>): void; error(m: string, f?: Record<string, unknown>): void }
