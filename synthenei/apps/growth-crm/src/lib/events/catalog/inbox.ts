// Event catalogue: conversations and messages (BUILD-PLAN 1.10). Mirrors public.event_types; new types are added to the SQL seed by the next DB task.
import type { EventTypeDef } from "../types";

export const EVENT_TYPES = [
  { type: "conversation.created", description: "A conversation was created", webhook: true, agent: true },
  { type: "conversation.updated", description: "A conversation was changed", webhook: true, agent: true },
  { type: "conversation.deleted", description: "A conversation was deleted", webhook: false, agent: true },
  { type: "message.created", description: "A message row was created", webhook: false, agent: true },
  { type: "message.updated", description: "A message row was changed", webhook: false, agent: true },
  { type: "message.deleted", description: "A message row was deleted", webhook: false, agent: true },
  { type: "message.received", description: "An inbound message arrived", webhook: true, agent: true },
  { type: "message.sent", description: "An outbound message was created", webhook: true, agent: true },
  { type: "message.status", description: "A message delivery status changed", webhook: true, agent: false },
] as const satisfies readonly EventTypeDef[];
