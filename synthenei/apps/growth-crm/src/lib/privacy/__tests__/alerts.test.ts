import { describe, expect, it } from "vitest";
import { alertRequestReceived, sweepDue, type AlertEvent, type AlertPort, type NotificationRow, type OpenRequest } from "../alerts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-12-10T05:00:00Z");
const req = (over: Partial<OpenRequest> = {}): OpenRequest => ({ id: "r1", wsUuid: "w1", tenantUuid: "t1", kind: "access", status: "received", dueAt: new Date(NOW + 30 * DAY).toISOString(), ...over });

function port(over: { rules?: boolean; owners?: string[]; due?: OpenRequest[]; failEmitFor?: string } = {}) {
  const emitted: { type: AlertEvent; requestId: string; data: Record<string, unknown> }[] = [];
  const notes: NotificationRow[] = [];
  const p: AlertPort = {
    owners: async () => over.owners ?? ["owner-1", "owner-2"],
    ruleExists: async () => over.rules ?? false,
    alreadySent: async (type, id) => emitted.some((e) => e.type === type && e.requestId === id),
    emit: async (type, e) => { if (over.failEmitFor === e.requestId) throw new Error("bus down"); emitted.push({ type, requestId: e.requestId, data: e.data }); },
    notify: async (rows) => { notes.push(...rows); },
    openDue: async () => over.due ?? [],
  };
  return { p, emitted, notes };
}

describe("alertRequestReceived", () => {
  it("emits privacy.request_received and notifies every owner in-app when no rule covers it", async () => {
    const x = port();
    const r = await alertRequestReceived(x.p, req());
    expect(r).toEqual({ sent: true, notified: 2 });
    expect(x.emitted).toEqual([{ type: "privacy.request_received", requestId: "r1", data: { kind: "access", due_at: req().dueAt } }]);
    expect(x.notes.map((n) => n.user_id)).toEqual(["owner-1", "owner-2"]);
    expect(x.notes[0]).toMatchObject({ kind: "privacy.request_received", object_type: "privacy_request", object_id: "r1", url: "/settings/privacy/r1", workspace_id: "w1", tenant_id: "t1" });
  });
  it("lets a notification rule do the notifying when one exists (no duplicate rows)", async () => {
    const x = port({ rules: true });
    expect(await alertRequestReceived(x.p, req())).toEqual({ sent: true, notified: 0 });
    expect(x.emitted).toHaveLength(1);
    expect(x.notes).toHaveLength(0);
  });
  it("is idempotent per request", async () => {
    const x = port();
    await alertRequestReceived(x.p, req());
    expect(await alertRequestReceived(x.p, req())).toEqual({ sent: false, notified: 0 });
    expect(x.notes).toHaveLength(2);
  });
  it("says only the kind, the due date and the id: no personal value can be in a message", async () => {
    const x = port();
    await alertRequestReceived(x.p, req({ kind: "erasure" }));
    const text = JSON.stringify(x.notes) + JSON.stringify(x.emitted);
    expect(text).toContain("erasure request needs a reply by");
    expect(text).not.toMatch(/@|\+91|[0-9]{10}/);
  });
});

describe("sweepDue: due-5d and overdue, once each", () => {
  const due = (days: number, over: Partial<OpenRequest> = {}) => req({ id: `r${days}`, dueAt: new Date(NOW + days * DAY).toISOString(), ...over });
  it("alerts at 5 days left and when overdue, not before, not for closed requests", async () => {
    const x = port({ due: [due(20), due(5), due(4), due(-1), due(-3, { status: "completed" }), due(2, { status: "rejected" })] });
    const out = await sweepDue(x.p, NOW);
    expect(out).toMatchObject({ scanned: 6, dueSoon: 2, overdue: 1, failed: 0 });
    expect(x.emitted.map((e) => `${e.type}:${e.requestId}`).sort()).toEqual(["privacy.request_due_soon:r4", "privacy.request_due_soon:r5", "privacy.request_overdue:r-1"]);
    expect(x.emitted.find((e) => e.requestId === "r5")?.data).toMatchObject({ days_left: 5 });
  });
  it("the next day's run does not alert again, and the overdue alert is separate from the due-soon one", async () => {
    const x = port({ due: [due(5)] });
    await sweepDue(x.p, NOW);
    const again = await sweepDue(x.p, NOW + DAY / 2);
    expect(again).toMatchObject({ dueSoon: 0, overdue: 0, skipped: 1 });
    // six days later the same request is overdue: a new, different alert
    const late = await sweepDue(x.p, NOW + 6 * DAY);
    expect(late).toMatchObject({ overdue: 1 });
    expect(x.emitted.map((e) => e.type)).toEqual(["privacy.request_due_soon", "privacy.request_overdue"]);
  });
  it("one failing request is counted and the rest still run", async () => {
    const x = port({ due: [due(3), due(4)], failEmitFor: "r3" });
    expect(await sweepDue(x.p, NOW)).toMatchObject({ dueSoon: 1, failed: 1 });
    expect(x.emitted.map((e) => e.requestId)).toEqual(["r4"]);
  });
  it("no owners means the event still goes out and nobody is notified", async () => {
    const x = port({ due: [due(1)], owners: [] });
    expect(await sweepDue(x.p, NOW)).toMatchObject({ dueSoon: 1 });
    expect(x.notes).toHaveLength(0);
  });
});
