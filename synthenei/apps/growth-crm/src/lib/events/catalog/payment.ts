// Event catalogue: tenant payments (T037). Mirrors public.event_types; the SQL seed is in docs/migrations-backlog.md "T037 needs".
import type { EventTypeDef } from "../types";

export const EVENT_TYPES = [
  { type: "payment.created", description: "A payment link or order was created", webhook: true, agent: true },
  { type: "payment.paid", description: "A payment was received", webhook: true, agent: true },
  { type: "payment.failed", description: "A payment attempt failed", webhook: true, agent: true },
  { type: "payment.cancelled", description: "A payment link was cancelled or expired", webhook: true, agent: true },
  { type: "payment.refunded", description: "A payment was fully refunded", webhook: true, agent: true },
  { type: "payment.refund_partial", description: "A payment was partly refunded", webhook: true, agent: true },
  { type: "payment.mismatch", description: "A payment event did not match the stored amount or account and was not applied", webhook: false, agent: true },
] as const satisfies readonly EventTypeDef[];
