// Event catalogue: comments and mentions (BUILD-PLAN 1.10). Mirrors public.event_types; new types are added to the SQL seed by the next DB task.
import type { EventTypeDef } from "../types";

export const EVENT_TYPES = [
  { type: "comment.created", description: "A comment was added", webhook: true, agent: true },
  { type: "mention.created", description: "Someone was mentioned", webhook: false, agent: true },
] as const satisfies readonly EventTypeDef[];
