// Alerts for the data-subject workflow (AUD-064, PRIV-021). Pure over a port.
//   privacy.request_received  when a requester confirms (intake.ts calls this best-effort, never blocking the requester)
//   privacy.request_due_soon  once, 5 days before due_at   (daily sweep, job.ts)
//   privacy.request_overdue   once, when due_at has passed (daily sweep)
// Each alert is an event on the bus (privacy.* in the catalogue). The workspace's notification rules turn events into notifications; a
// workspace with no rule for that event type gets in-app notifications for its owners written directly, so the alert never depends on
// someone having configured a rule. Nothing personal travels: the kind, the id and the due date are all a message ever says.
import { daysLeft, dueState } from "./due";
import type { RequestKind, RequestStatus } from "./types";

export const ALERT_EVENTS = ["privacy.request_received", "privacy.request_due_soon", "privacy.request_overdue"] as const;
export type AlertEvent = (typeof ALERT_EVENTS)[number];
export const DUE_SOON_DAYS = 5;

export interface OpenRequest { id: string; wsUuid: string; tenantUuid: string; kind: RequestKind; status: RequestStatus; dueAt: string }
export interface NotificationRow {
  tenant_id: string; workspace_id: string; user_id: string; kind: AlertEvent; object_type: "privacy_request"; object_id: string;
  title: { en: string }; body: { en: string }; url: string;
}

export interface AlertPort {
  /** Active owners of the workspace (the privacy owner until a delegate role exists). */
  owners(wsUuid: string): Promise<string[]>;
  ruleExists(wsUuid: string, type: AlertEvent): Promise<boolean>;
  /** Did this alert already go out for this request (event on the bus or a notification)? */
  alreadySent(type: AlertEvent, requestId: string): Promise<boolean>;
  emit(type: AlertEvent, e: { wsUuid: string; requestId: string; data: Record<string, unknown> }): Promise<void>;
  notify(rows: NotificationRow[]): Promise<void>;
  /** Open requests due within `horizonDays` of `now` or already late. */
  openDue(now: number, horizonDays: number): Promise<OpenRequest[]>;
}

const KIND_LABEL: Record<RequestKind, string> = { access: "access", correction: "correction", erasure: "erasure", withdrawal: "withdrawal", grievance: "grievance" };
const day = (iso: string): string => iso.slice(0, 10);

function message(type: AlertEvent, r: Pick<OpenRequest, "kind" | "dueAt">, left?: number): { title: string; body: string } {
  const k = KIND_LABEL[r.kind];
  if (type === "privacy.request_received") return { title: "New privacy request", body: `A ${k} request needs a reply by ${day(r.dueAt)}.` };
  if (type === "privacy.request_due_soon") return { title: "Privacy request due soon", body: `A ${k} request is due on ${day(r.dueAt)} (${Math.max(0, left ?? 0)} days left).` };
  return { title: "Privacy request overdue", body: `A ${k} request was due on ${day(r.dueAt)} and is still open.` };
}

/** Sends one alert (event, then notifications when no rule covers it). Idempotent per (type, request). Returns what it did. */
export async function sendAlert(p: AlertPort, type: AlertEvent, r: OpenRequest, left?: number): Promise<{ sent: boolean; notified: number }> {
  if (await p.alreadySent(type, r.id)) return { sent: false, notified: 0 };
  await p.emit(type, { wsUuid: r.wsUuid, requestId: r.id, data: { kind: r.kind, due_at: r.dueAt, ...(left !== undefined ? { days_left: left } : {}) } });
  let notified = 0;
  if (!(await p.ruleExists(r.wsUuid, type))) {
    const m = message(type, r, left);
    const rows = (await p.owners(r.wsUuid)).map((u): NotificationRow => ({
      tenant_id: r.tenantUuid, workspace_id: r.wsUuid, user_id: u, kind: type, object_type: "privacy_request", object_id: r.id,
      title: { en: m.title }, body: { en: m.body }, url: `/settings/privacy/${r.id}`,
    }));
    if (rows.length) { await p.notify(rows); notified = rows.length; }
  }
  return { sent: true, notified };
}

/** New request confirmed by the requester. */
export const alertRequestReceived = (p: AlertPort, r: OpenRequest) => sendAlert(p, "privacy.request_received", r);

export interface SweepResult { scanned: number; dueSoon: number; overdue: number; skipped: number; failed: number }
/** Daily sweep. A failing request is counted and the rest still run. */
export async function sweepDue(p: AlertPort, now: number): Promise<SweepResult> {
  const out: SweepResult = { scanned: 0, dueSoon: 0, overdue: 0, skipped: 0, failed: 0 };
  for (const r of await p.openDue(now, DUE_SOON_DAYS)) {
    out.scanned++;
    const state = dueState(r.status, r.dueAt, now, DUE_SOON_DAYS);
    if (state !== "overdue" && state !== "due_soon") { out.skipped++; continue; }
    try {
      const res = await sendAlert(p, state === "overdue" ? "privacy.request_overdue" : "privacy.request_due_soon", r, daysLeft(r.dueAt, now));
      if (!res.sent) out.skipped++; else if (state === "overdue") out.overdue++; else out.dueSoon++;
    } catch { out.failed++; }
  }
  return out;
}
