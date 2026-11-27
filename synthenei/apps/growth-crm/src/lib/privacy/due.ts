// Due-date tracking for privacy requests. due_at is set by the DB trigger (received + the tenant's response days, 30 unless configured).
import type { RequestStatus } from "./types";

export type DueState = "closed" | "overdue" | "due_soon" | "on_track";
const DAY = 86_400_000;

/** Whole days until due (negative = overdue). */
export const daysLeft = (dueAt: string, now: number): number => Math.ceil((new Date(dueAt).getTime() - now) / DAY);

export function dueState(status: RequestStatus, dueAt: string, now: number, soonDays = 5): DueState {
  if (status === "completed" || status === "rejected") return "closed";
  const d = daysLeft(dueAt, now);
  return d < 0 ? "overdue" : d <= soonDays ? "due_soon" : "on_track";
}

type Row = { status: RequestStatus; dueAt: string; receivedAt: string };
/** Inbox order: open requests by soonest due (overdue on top), closed requests last, newest first. */
export function inboxCompare(now: number) {
  return (a: Row, b: Row): number => {
    const ca = dueState(a.status, a.dueAt, now) === "closed", cb = dueState(b.status, b.dueAt, now) === "closed";
    if (ca !== cb) return ca ? 1 : -1;
    if (ca) return b.receivedAt.localeCompare(a.receivedAt);
    return a.dueAt.localeCompare(b.dueAt);
  };
}

/** Allowed owner moves. A closed request stays closed (the register is kept; a new request is raised instead). */
const NEXT: Record<RequestStatus, RequestStatus[]> = {
  received: ["in_progress", "completed", "rejected"], in_progress: ["completed", "rejected"], completed: [], rejected: [],
};
export const canMove = (from: RequestStatus, to: RequestStatus): boolean => NEXT[from].includes(to);

/**
 * The response clock of one request. dueAt is fixed at intake by the DB trigger (received + tenants.privacy_response_days); this only
 * reads it. "Whole days left" uses the same rule as daysLeft; percent is how much of the window has gone, clamped to 0..100.
 */
export interface SlaClock { totalDays: number; elapsedDays: number; daysLeft: number; percent: number; state: DueState }
export function slaClock(status: RequestStatus, receivedAt: string, dueAt: string, now: number, soonDays = 5): SlaClock {
  const r = new Date(receivedAt).getTime(), d = new Date(dueAt).getTime();
  const total = Math.max(1, Math.round((d - r) / DAY));
  const left = daysLeft(dueAt, now);
  const elapsed = Math.min(total, Math.max(0, Math.floor((now - r) / DAY)));
  return { totalDays: total, elapsedDays: elapsed, daysLeft: left, percent: Math.min(100, Math.max(0, Math.round(((now - r) / Math.max(1, d - r)) * 100))), state: dueState(status, dueAt, now, soonDays) };
}
