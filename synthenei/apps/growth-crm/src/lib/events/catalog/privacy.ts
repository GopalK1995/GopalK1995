// Event catalogue: consent (BUILD-PLAN 1.10). Mirrors public.event_types; new types are added to the SQL seed by the next DB task.
import type { EventTypeDef } from "../types";

export const EVENT_TYPES = [
  { type: "consent.changed", description: "Consent was granted or withdrawn", webhook: true, agent: true },
  { type: "privacy.request_received", description: "A data-subject request was confirmed by the requester", webhook: false, agent: false },
  { type: "privacy.request_due_soon", description: "An open data-subject request is within 5 days of its due date", webhook: false, agent: false },
  { type: "privacy.request_overdue", description: "An open data-subject request is past its due date", webhook: false, agent: false },
] as const satisfies readonly EventTypeDef[];
