// Event catalogue: deals (BUILD-PLAN 1.10). Mirrors public.event_types; new types are added to the SQL seed by the next DB task.
import type { EventTypeDef } from "../types";

export const EVENT_TYPES = [
  { type: "deal.created", description: "A deal was created", webhook: true, agent: true },
  { type: "deal.updated", description: "A deal was changed", webhook: true, agent: true },
  { type: "deal.stage_changed", description: "A deal moved stage", webhook: true, agent: true },
  { type: "deal.won", description: "A deal was won", webhook: true, agent: true },
  { type: "deal.lost", description: "A deal was lost", webhook: true, agent: true },
  { type: "deal.deleted", description: "A deal was deleted", webhook: true, agent: true },
] as const satisfies readonly EventTypeDef[];
