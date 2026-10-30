// Event catalogue: leads (BUILD-PLAN 1.10). Mirrors public.event_types; new types are added to the SQL seed by the next DB task.
import type { EventTypeDef } from "../types";

export const EVENT_TYPES = [
  { type: "lead.created", description: "A lead was created", webhook: true, agent: true },
  { type: "lead.updated", description: "A lead was changed", webhook: true, agent: true },
  { type: "lead.assigned", description: "A lead got a new owner", webhook: true, agent: true },
  { type: "lead.stage_changed", description: "A lead status changed", webhook: true, agent: true },
  { type: "lead.deleted", description: "A lead was deleted", webhook: true, agent: true },
  { type: "lead.exported", description: "Leads were exported", webhook: true, agent: true },
] as const satisfies readonly EventTypeDef[];
