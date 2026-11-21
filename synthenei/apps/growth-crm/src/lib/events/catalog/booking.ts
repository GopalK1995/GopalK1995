// Event catalogue: scheduling bookings (T047). Mirrors public.event_types; the SQL seed is in docs/migrations-backlog.md "T047 needs".
import type { EventTypeDef } from "../types";

export const EVENT_TYPES = [
  { type: "booking.created", description: "A booking was made through a connected scheduling tool", webhook: true, agent: true },
  { type: "booking.cancelled", description: "A booking was cancelled in a connected scheduling tool", webhook: true, agent: true },
  { type: "booking.unmatched", description: "A booking or cancellation came from an email that matches no lead", webhook: false, agent: true },
] as const satisfies readonly EventTypeDef[];
