// In-memory BookingRecordStore with the same scoping rules as the Supabase one (tenant + workspace + connection on every read and write).
import type { BookingFields, BookingRecordStore, Log, RecordScope, StoredBooking } from "../booking-store";
import type { BookingData } from "../types";

interface Rec { id: string; tenantId: string; workspaceId: string; title: string; data: BookingData; version: number; deleted: boolean }
interface Link { tenantId: string; workspaceId: string; connectionId: string; object: string; extId: string; recordId: string; hash: string }

export const silent: Log & { lines: string[] } = { lines: [], info(m) { this.lines.push(m); }, warn(m) { this.lines.push(m); }, error(m) { this.lines.push(m); } };

export class FakeRecords implements BookingRecordStore {
  /** tenant -> booking object id; a tenant without the hospitality preset has none. */
  objects = new Map<string, string>();
  records: Rec[] = [];
  links: Link[] = [];
  events: { type: string; workspaceId: string; recordId: string }[] = [];
  /** Set to make the next `update` of a record lose the compare-and-set once. */
  conflictOnce = new Set<string>();
  private n = 0;

  withObject(tenantId: string): this { this.objects.set(tenantId, `obj-${tenantId}`); return this; }
  private view(r: Rec, hash: string | null): StoredBooking { return { recordId: r.id, title: r.title, data: structuredClone(r.data), version: r.version, hash }; }

  async bookingObjectId(s: RecordScope) { return this.objects.get(s.tenantId) ?? null; }
  async findByExternal(s: RecordScope, object: string, extId: string) {
    const l = this.links.find((x) => x.tenantId === s.tenantId && x.workspaceId === s.workspaceId && x.connectionId === s.connectionId && x.object === object && x.extId === extId);
    const r = l && this.records.find((x) => x.id === l.recordId && !x.deleted && x.tenantId === s.tenantId && x.workspaceId === s.workspaceId);
    return r && l ? this.view(r, l.hash) : null;
  }
  async create(s: RecordScope, _objectId: string, f: BookingFields, link: { externalObject: string; externalId: string; hash: string }) {
    const dup = this.links.find((x) => x.connectionId === s.connectionId && x.object === link.externalObject && x.extId === link.externalId);
    if (dup) return dup.recordId;
    const id = `rec-${++this.n}`;
    this.records.push({ id, tenantId: s.tenantId, workspaceId: s.workspaceId, title: f.title, data: structuredClone(f.data), version: 1, deleted: false });
    this.links.push({ tenantId: s.tenantId, workspaceId: s.workspaceId, connectionId: s.connectionId, object: link.externalObject, extId: link.externalId, recordId: id, hash: link.hash });
    return id;
  }
  async update(s: RecordScope, rec: StoredBooking, f: BookingFields, hash: string) {
    const r = this.records.find((x) => x.id === rec.recordId && x.tenantId === s.tenantId && x.workspaceId === s.workspaceId && !x.deleted);
    if (!r) return "conflict" as const;
    if (this.conflictOnce.delete(rec.recordId) || r.version !== rec.version) return "conflict" as const;
    r.title = f.title; r.data = structuredClone(f.data); r.version++;
    const l = this.links.find((x) => x.recordId === r.id && x.connectionId === s.connectionId); if (l) l.hash = hash;
    return "ok" as const;
  }
  async listByExternalObject(s: RecordScope, object: string) {
    return this.links.filter((x) => x.tenantId === s.tenantId && x.workspaceId === s.workspaceId && x.connectionId === s.connectionId && x.object === object)
      .flatMap((l) => { const r = this.records.find((x) => x.id === l.recordId && !x.deleted); return r ? [{ externalId: l.extId, booking: this.view(r, l.hash) }] : []; });
  }
  async listBlocking(s: { tenantId: string; workspaceId: string }, q: { fromDate: string; room?: string; limit: number }) {
    return this.records.filter((r) => r.tenantId === s.tenantId && r.workspaceId === s.workspaceId && !r.deleted && r.data.check_out >= q.fromDate && (!q.room || r.data.room === q.room) && r.data.status === "confirmed")
      .slice(0, q.limit).map((r) => this.view(r, null));
  }
  async emit(e: { type: "booking.created" | "booking.cancelled"; workspaceId: string; recordId: string }) { this.events.push({ type: e.type, workspaceId: e.workspaceId, recordId: e.recordId }); }

  /** Test helper: a booking made by hand in the CRM (no link, no origin), the way a person would add a direct booking. */
  addManual(tenantId: string, workspaceId: string, data: Partial<BookingData> & { check_in: string; check_out: string }): string {
    const id = `rec-${++this.n}`;
    const full = { room: null, guests: null, source_ota: "direct", commission_pct: null, status: "confirmed", entry: "reservation", ota_channel: null, external_ref: null, total_amount: null, currency: null, commission_amount: null, guest_name: null, origin: "channel_manager", source_version: 0, ...data } as BookingData;
    this.records.push({ id, tenantId, workspaceId, title: "Manual", data: full, version: 1, deleted: false });
    return id;
  }
}
