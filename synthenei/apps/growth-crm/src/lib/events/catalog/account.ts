// Event catalogue: accounts (BUILD-PLAN 1.10). Mirrors public.event_types; new types are added to the SQL seed by the next DB task.
import type { EventTypeDef } from "../types";

export const EVENT_TYPES = [
  { type: "account.created", description: "An account was created", webhook: true, agent: true },
  { type: "account.updated", description: "An account was changed", webhook: true, agent: true },
  { type: "account.deleted", description: "An account was deleted", webhook: true, agent: true },
] as const satisfies readonly EventTypeDef[];
