// Event catalogue: outbound email (T038). Mirrors public.event_types; the SQL seed is in docs/migrations-backlog.md "T038 needs".
// Payloads carry the reason and the source only: never an address or a subject.
import type { EventTypeDef } from "../types";

export const EVENT_TYPES = [
  { type: "email.bounced", description: "An address hard-bounced and was suppressed", webhook: true, agent: true },
  { type: "email.complained", description: "A recipient reported an email as spam; marketing consent was withdrawn", webhook: true, agent: true },
  { type: "email.unsubscribed", description: "A recipient unsubscribed from email; marketing consent was withdrawn", webhook: true, agent: true },
  { type: "email.suppressed", description: "An address was added to the suppression list by hand", webhook: false, agent: true },
] as const satisfies readonly EventTypeDef[];
