// Vendor-neutral booking event. Both parsers (calendly/payload.ts, calcom/payload.ts) produce it; booking.ts consumes it.
export type BookingVendor = "calendly" | "cal-com";
export interface BookingEvent {
  kind: "booked" | "cancelled" | "ignored";
  vendor: BookingVendor;
  /** Vendor's own id for this booking (Calendly invitee uri, Cal.com booking uid). Unique per connection. */
  externalId: string;
  /** Lower-cased invitee email, or null when absent/invalid. */
  email: string | null;
  /** Invitee display name (shown to the owner only; never stored on the calendar row or in events). */
  name: string | null;
  /** Event type / meeting title. */
  title: string;
  startsAt: string | null; endsAt: string | null;
  /** booked: this booking replaces an older one. cancelled: this cancellation is the old half of a reschedule (silent). */
  rescheduled: boolean;
  reason?: string;
}
