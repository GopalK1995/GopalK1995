// Event catalogue: memberships (BUILD-PLAN 1.10). Mirrors public.event_types; new types are added to the SQL seed by the next DB task.
import type { EventTypeDef } from "../types";

export const EVENT_TYPES = [
  { type: "member.created", description: "A member joined a workspace", webhook: true, agent: false },
  { type: "member.updated", description: "A membership changed", webhook: true, agent: false },
  { type: "member.deleted", description: "A member was removed", webhook: true, agent: false },
] as const satisfies readonly EventTypeDef[];
