// In-memory BookingStore: same scoping and uniqueness rules as the database (calendar row unique per connection + vendor id, forward-only status).
import type { ConnectionRow } from "../../core/types";
import type { BookingDeps, BookingEventType, BookingStore, CalendarOutcome, CalendarUpsert, NewNotice, NewTask } from "../store";

export const TENANT = "t-1", WS = "ws-1", CONN = "conn-1", OWNER = "user-owner", REP = "user-rep";
export const mkConn = (over: Partial<ConnectionRow> = {}): ConnectionRow => ({
  id: CONN, tenantId: TENANT, workspaceId: WS, connectorId: "calendly", mode: "live", status: "connected", settings: {}, credentialSecretId: "c", webhookSecretId: null, tokenExpiresAt: null, ...over,
});
interface Row { id: string; workspaceId: string; integrationId: string; externalId: string; startsAt: string; endsAt: string; title: string; leadId: string | null; status: string }

export class FakeStore implements BookingStore {
  n = 0; leads: { id: string; workspaceId: string; email: string; ownerId: string | null; deleted?: boolean }[] = []; owners: Record<string, string[]> = { [WS]: [OWNER] };
  rows: Row[] = []; tasks: (NewTask & { id: string })[] = []; notices: (NewNotice & { user: string })[] = []; events: { type: BookingEventType; objectId: string; data: Record<string, unknown> }[] = [];
  async findLeadByEmail(ws: string, email: string) {
    const l = this.leads.find((x) => x.workspaceId === ws && !x.deleted && x.email.toLowerCase() === email.toLowerCase());
    return l ? { id: l.id, ownerId: l.ownerId } : null;
  }
  async upsertCalendarEvent(r: CalendarUpsert): Promise<{ outcome: CalendarOutcome; id: string | null; leadId: string | null }> {
    const cur = this.rows.find((x) => x.integrationId === r.integrationId && x.externalId === r.externalId);
    if (!cur) {
      if (r.onlyIfExists) return { outcome: "missing", id: null, leadId: null };
      const row: Row = { id: `cal-${++this.n}`, workspaceId: r.workspaceId, integrationId: r.integrationId, externalId: r.externalId, startsAt: r.startsAt, endsAt: r.endsAt, title: r.title, leadId: r.leadId, status: r.status };
      this.rows.push(row); return { outcome: "created", id: row.id, leadId: r.leadId };
    }
    const leadId = cur.leadId ?? r.leadId; if (!cur.leadId) cur.leadId = r.leadId;
    if (r.status === "cancelled") { const o = cur.status === "cancelled" ? "already_cancelled" : "cancelled"; cur.status = "cancelled"; return { outcome: o, id: cur.id, leadId }; }
    if (cur.status === "cancelled") return { outcome: "stale", id: cur.id, leadId };
    const same = cur.startsAt === r.startsAt && cur.endsAt === r.endsAt && cur.title === r.title;
    Object.assign(cur, { startsAt: r.startsAt, endsAt: r.endsAt, title: r.title });
    return { outcome: same ? "unchanged" : "updated", id: cur.id, leadId };
  }
  async insertTaskOnce(t: NewTask) {
    if (this.tasks.some((x) => x.workspaceId === t.workspaceId && x.leadId === t.leadId && x.title === t.title)) return false;
    this.tasks.push({ ...t, id: `task-${++this.n}` }); return true;
  }
  async workspaceOwners(ws: string) { return this.owners[ws] ?? []; }
  async notifyOnce(n: NewNotice) {
    let c = 0;
    for (const u of n.userIds) if (!this.notices.some((x) => x.user === u && x.workspaceId === n.workspaceId && x.dedupe === n.dedupe)) { this.notices.push({ ...n, user: u }); c++; }
    return c;
  }
  async emit(e: { type: BookingEventType; objectId: string; data: Record<string, unknown> }) { this.events.push({ type: e.type, objectId: e.objectId, data: e.data }); }
}
export const mkDeps = (store: FakeStore, now = "2030-03-01T00:00:00.000Z"): BookingDeps => ({ store, log: { info() {}, warn() {}, error() {} }, now: () => new Date(now) });
