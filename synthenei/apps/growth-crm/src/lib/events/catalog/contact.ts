// Event catalogue: contacts (BUILD-PLAN 1.10). Mirrors public.event_types; new types are added to the SQL seed by the next DB task.
import type { EventTypeDef } from "../types";

export const EVENT_TYPES = [
  { type: "contact.created", description: "A contact was created", webhook: true, agent: true },
  { type: "contact.updated", description: "A contact was changed", webhook: true, agent: true },
  { type: "contact.deleted", description: "A contact was deleted", webhook: true, agent: true },
] as const satisfies readonly EventTypeDef[];
