// Event catalogue: webhooks (BUILD-PLAN 1.10). Mirrors public.event_types; new types are added to the SQL seed by the next DB task.
import type { EventTypeDef } from "../types";

export const EVENT_TYPES = [
  { type: "webhook.endpoint.disabled", description: "An outbound webhook endpoint was disabled", webhook: false, agent: false },
] as const satisfies readonly EventTypeDef[];
