// Event catalogue: tasks (BUILD-PLAN 1.10). Mirrors public.event_types; new types are added to the SQL seed by the next DB task.
import type { EventTypeDef } from "../types";

export const EVENT_TYPES = [
  { type: "task.created", description: "A task was created", webhook: true, agent: true },
  { type: "task.updated", description: "A task was changed", webhook: true, agent: true },
  { type: "task.completed", description: "A task was completed", webhook: true, agent: true },
  { type: "task.deleted", description: "A task was deleted", webhook: true, agent: true },
] as const satisfies readonly EventTypeDef[];
