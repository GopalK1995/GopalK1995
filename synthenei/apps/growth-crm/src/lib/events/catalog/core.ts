// Event catalogue: platform (BUILD-PLAN 1.10). Mirrors public.event_types; new types are added to the SQL seed by the next DB task.
import type { EventTypeDef } from "../types";

export const EVENT_TYPES = [
  { type: "ops.test", description: "Synthetic event emitted from the ops console to prove the pipeline", webhook: false, agent: false },
] as const satisfies readonly EventTypeDef[];
