// Event catalogue: connectors (BUILD-PLAN 1.10). Mirrors public.event_types; new types are added to the SQL seed by the next DB task.
import type { EventTypeDef } from "../types";

export const EVENT_TYPES = [
  { type: "connector.sync.completed", description: "A connector sync finished", webhook: true, agent: true },
  { type: "connector.sync.failed", description: "A connector sync failed", webhook: true, agent: true },
] as const satisfies readonly EventTypeDef[];
