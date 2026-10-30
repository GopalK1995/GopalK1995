// Event catalogue: activities (BUILD-PLAN 1.10). Mirrors public.event_types; new types are added to the SQL seed by the next DB task.
import type { EventTypeDef } from "../types";

export const EVENT_TYPES = [
  { type: "activity.created", description: "An activity row was created", webhook: false, agent: true },
  { type: "activity.updated", description: "An activity row was changed", webhook: false, agent: true },
  { type: "activity.deleted", description: "An activity row was deleted", webhook: false, agent: true },
  { type: "activity.logged", description: "An activity was logged", webhook: true, agent: true },
] as const satisfies readonly EventTypeDef[];
