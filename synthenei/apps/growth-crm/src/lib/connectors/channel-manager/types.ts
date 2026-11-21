// Channel manager contract (T046). A channel manager is the partner system that talks to the OTAs (Booking.com, MakeMyTrip / Goibibo,
// Airbnb ...) on the property's behalf. The CRM only ever speaks to the manager: reservations come in (created / modified / cancelled)
// and become `booking` custom-object records labelled with their OTA and commission; availability goes out. Pure types, no server imports.

/** A date without a time, YYYY-MM-DD, in the property's own calendar. Check-out is the day the guest leaves (the night before is the last night). */
export type DateOnly = string;

export type ReservationEventKind = "created" | "modified" | "cancelled";

/** What an adapter hands back. Nothing here is guessed: a field the manager did not send is null, a row that cannot be understood is rejected. */
export interface Reservation {
  /** The manager's own reservation id. Unique per connection; the dedupe key. */
  externalId: string;
  /** Channel code as the manager reports it (e.g. "booking_com"); mapped to a CRM source by `channelToSource`. Free text is allowed. */
  channel: string;
  /** The OTA's own confirmation number, when the manager passes it on. */
  channelRef: string | null;
  checkIn: DateOnly;
  checkOut: DateOnly;
  /** Room / unit key as the CRM knows it (matches `booking.room`). */
  room: string | null;
  guests: number | null;
  guestName: string | null;
  /** Gross amount in minor units (paise, cents) and its ISO 4217 code. Both or neither. */
  totalMinor: number | null;
  currency: string | null;
  /** Either a percentage of the gross, or the exact commission amount in minor units. The percentage wins when both are present. */
  commissionPct: number | null;
  commissionMinor: number | null;
  /** Monotonic version of the reservation at the manager (sequence number or modification time in ms). Older deliveries never overwrite newer ones. */
  version: number;
}

export interface ReservationEvent { kind: ReservationEventKind; reservation: Reservation }

export interface ReservationPage { events: ReservationEvent[]; rejected: number; nextCursor: string | null; done: boolean }

/** One closed (or reopened) range of nights for one room. `to` is exclusive: the first night that is free again. */
export interface AvailabilityBlock { room: string; from: DateOnly; to: DateOnly }
/** The complete picture we push: every room's closed ranges inside the window. The manager treats everything else as open. */
export interface AvailabilitySnapshot { windowFrom: DateOnly; windowTo: DateOnly; closed: AvailabilityBlock[] }

export interface AdapterContext {
  /** Decrypted credential bundle for this connection. */
  secrets: Record<string, string>;
  apiBase: string;
  /** Network access is injected: adapters never call fetch themselves, so a test (or the fixture gateway) can stand in. */
  http: { json<T>(req: { method: string; url: string; headers?: Record<string, string>; body?: unknown }): Promise<T> };
}

/** The adapter interface. One implementation per partner; the generic shell (`generic.ts`) ships now, a partner adapter later. */
export interface ChannelManager {
  readonly id: string;
  /** Verifies the credentials with one cheap call. Throws CredentialError when the manager rejects them. */
  test(ctx: AdapterContext): Promise<{ accountLabel?: string; accountId?: string }>;
  /** Pull: reservation changes since the cursor (opaque, adapter-defined). Used by the poll stream and as the safety net for missed webhooks. */
  listChanges(ctx: AdapterContext, cursor: string | null): Promise<ReservationPage>;
  /** Push delivery: parse an already signature-verified webhook body. Unparseable input yields no events, never an exception. */
  parseWebhook(rawBody: string): { events: ReservationEvent[]; rejected: number };
  /** Availability out. Idempotent: the same snapshot sent twice changes nothing at the manager. */
  pushAvailability(ctx: AdapterContext, snapshot: AvailabilitySnapshot): Promise<void>;
}

/** Fields written to the booking record's `data`. The first six are the seeded `booking` fields; the rest are listed under "T046 needs". */
export interface BookingData {
  check_in: DateOnly; check_out: DateOnly; room: string | null; guests: number | null;
  source_ota: string | null; commission_pct: number | null;
  status: "confirmed" | "cancelled";
  /** "reservation" for a guest stay, "block" for a calendar block with no guest behind it (iCal). */
  entry: "reservation" | "block";
  ota_channel: string | null; external_ref: string | null;
  total_amount: number | null; currency: string | null; commission_amount: number | null;
  guest_name: string | null;
  origin: "channel_manager" | "ical";
  /** Version at the source (reservation version or iCal SEQUENCE), used to ignore stale deliveries. */
  source_version: number;
  [k: string]: unknown;
}
