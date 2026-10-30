// Event catalogue: consent (BUILD-PLAN 1.10). Mirrors public.event_types; new types are added to the SQL seed by the next DB task.
import type { EventTypeDef } from "../types";

export const EVENT_TYPES = [
  { type: "consent.changed", description: "Consent was granted or withdrawn", webhook: true, agent: true },
] as const satisfies readonly EventTypeDef[];
