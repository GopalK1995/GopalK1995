// Support-session audit trail. Demo: in-process store (resets on restart). Real: start_support_session() /
// end_support_session() RPCs write platform audit + notify the workspace owner (spec 10.5).
export interface SupportEvent { id: string; at: string; admin: string; ws: string; action: "support_started" | "support_ended"; mode?: string; reason?: string; minutes?: number }
const g = globalThis as unknown as { __gcrmSupport?: SupportEvent[] };
const store = (g.__gcrmSupport ??= [
  { id: "SE-3", at: "2026-10-09T09:12:00.000Z", admin: "Vikram Anand", ws: "lawsome-tn", action: "support_ended" },
  { id: "SE-2", at: "2026-10-09T08:47:00.000Z", admin: "Vikram Anand", ws: "lawsome-tn", action: "support_started", mode: "read_only", reason: "Owner reported LinkedIn CSV import rejecting 2 rows (ticket SUP-118)", minutes: 30 },
  { id: "SE-1", at: "2026-09-24T06:05:00.000Z", admin: "Vikram Anand", ws: "kaveri-cbe", action: "support_started", mode: "read_only", reason: "Onboarding check: pipeline stages imported from Excel template", minutes: 15 },
]);
export const supportEvents = (ws?: string) => (ws ? store.filter((e) => e.ws === ws) : store);
export function logSupport(e: Omit<SupportEvent, "id" | "at">) { store.unshift({ ...e, id: `SE-${store.length + 1}`, at: new Date().toISOString() }); }
