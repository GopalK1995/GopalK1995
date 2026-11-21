// Supabase implementation of BookingRecordStore on the SERVICE-ROLE client (jobs and the inbound consumer are sanctioned users of
// serviceDb, CONTRACTS C6). RLS does not protect this path, so every query is explicitly scoped by tenant_id and workspace_id (and the
// connection for links). Tables: object_types / records (0017), external_links (0015). `booking` is the hospitality preset's object (0019).
// Records written here carry no created_by (no user); the audit trail is the sync_runs row plus the bus event.
import "server-only";
import type { Db } from "@/lib/db/client";
import { from, type Qb } from "@/lib/db/query";
import { emitEvent } from "@/lib/events/emit";
import type { BookingRecordStore, RecordScope, StoredBooking } from "./booking-store";
import type { BookingData } from "./types";

type R = Record<string, unknown>;
const failed = (what: string) => new Error(`booking store: ${what} failed`);   // PostgREST text can quote values: not echoed
const UNIQUE = "23505";
const CHUNK = 150;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Normalises a stored `data` blob: a booking made by hand has no status/entry/origin, which means a confirmed guest stay. */
export function normaliseData(raw: unknown): BookingData {
  const d = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as R;
  return {
    ...d, check_in: String(d.check_in ?? ""), check_out: String(d.check_out ?? ""), room: str(d.room), guests: typeof d.guests === "number" ? d.guests : null,
    source_ota: str(d.source_ota), commission_pct: typeof d.commission_pct === "number" ? d.commission_pct : null,
    status: d.status === "cancelled" ? "cancelled" : "confirmed", entry: d.entry === "block" ? "block" : "reservation",
    ota_channel: str(d.ota_channel), external_ref: str(d.external_ref), total_amount: typeof d.total_amount === "number" ? d.total_amount : null, currency: str(d.currency),
    commission_amount: typeof d.commission_amount === "number" ? d.commission_amount : null, guest_name: str(d.guest_name),
    origin: d.origin === "ical" ? "ical" : "channel_manager", source_version: typeof d.source_version === "number" ? d.source_version : 0,
  };
}

export function supabaseBookingRecordStore(db: Db): BookingRecordStore {
  const q = (t: string) => from(db, t);
  const rows = async (b: Qb, what: string): Promise<R[]> => { const { data, error } = await b; if (error) throw failed(what); return (data as R[] | null) ?? []; };
  const toStored = (r: R, hash: string | null): StoredBooking => ({ recordId: String(r.id), title: str(r.title) ?? "", data: normaliseData(r.data), version: typeof r.version === "number" ? r.version : 1, hash });
  const objectId = async (tenantId: string): Promise<string | null> => {
    const r = (await rows(q("object_types").select("id").eq("tenant_id", tenantId).eq("key", "booking").eq("is_enabled", true).limit(1), "object lookup"))[0];
    return r ? String(r.id) : null;
  };
  const recordsByIds = async (s: { tenantId: string; workspaceId: string }, ids: string[]): Promise<Map<string, R>> => {
    const out = new Map<string, R>();
    for (let i = 0; i < ids.length; i += CHUNK) {
      const part = await rows(q("records").select("id, title, data, version").eq("tenant_id", s.tenantId).eq("workspace_id", s.workspaceId).is("deleted_at", null).in("id", ids.slice(i, i + CHUNK)), "record read");
      for (const r of part) out.set(String(r.id), r);
    }
    return out;
  };
  const linkQuery = (s: RecordScope) => q("external_links").select("external_id, local_id, content_hash").eq("tenant_id", s.tenantId).eq("workspace_id", s.workspaceId).eq("integration_id", s.connectionId).eq("local_table", "records");

  return {
    bookingObjectId: (s) => objectId(s.tenantId),

    async findByExternal(s, externalObject, externalId) {
      const l = (await rows(linkQuery(s).eq("external_object", externalObject).eq("external_id", externalId).limit(1), "link read"))[0];
      if (!l) return null;
      const rec = (await recordsByIds(s, [String(l.local_id)])).get(String(l.local_id));
      return rec ? toStored(rec, str(l.content_hash)) : null;
    },

    async create(s, objectTypeId, f, link) {
      const ins = await rows(q("records").insert({ tenant_id: s.tenantId, workspace_id: s.workspaceId, object_type_id: objectTypeId, title: f.title.slice(0, 300), data: f.data }).select("id"), "record insert");
      const id = String(ins[0]?.id ?? "");
      if (!id) throw failed("record insert");
      const res = await q("external_links").insert({
        tenant_id: s.tenantId, workspace_id: s.workspaceId, integration_id: s.connectionId, external_object: link.externalObject, external_id: link.externalId,
        local_table: "records", local_id: id, content_hash: link.hash, last_synced_at: new Date().toISOString(), direction: "in",
      }).select("id");
      if (res.error) {
        // A parallel delivery won the race: drop our copy (it was inserted a moment ago by this very call) and return the winner.
        await q("records").update({ deleted_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", s.tenantId).eq("workspace_id", s.workspaceId).select("id");
        if (res.error.code !== UNIQUE) throw failed("link insert");
        const l = (await rows(linkQuery(s).eq("external_object", link.externalObject).eq("external_id", link.externalId).limit(1), "link read"))[0];
        if (!l) throw failed("link insert");
        return String(l.local_id);
      }
      return id;
    },

    async update(s, rec, f, hash) {
      const hit = await rows(q("records").update({ title: f.title.slice(0, 300), data: f.data, version: rec.version + 1, updated_at: new Date().toISOString() })
        .eq("id", rec.recordId).eq("tenant_id", s.tenantId).eq("workspace_id", s.workspaceId).eq("version", rec.version).is("deleted_at", null).select("id"), "record update");
      if (!hit.length) return "conflict";
      await rows(q("external_links").update({ content_hash: hash, last_synced_at: new Date().toISOString() }).eq("tenant_id", s.tenantId).eq("workspace_id", s.workspaceId)
        .eq("integration_id", s.connectionId).eq("local_table", "records").eq("local_id", rec.recordId).select("id"), "link touch");
      return "ok";
    },

    async listByExternalObject(s, externalObject) {
      const links = await rows(linkQuery(s).eq("external_object", externalObject).limit(5000), "link list");
      const recs = await recordsByIds(s, links.map((l) => String(l.local_id)));
      const out: { externalId: string; booking: StoredBooking }[] = [];
      for (const l of links) { const r = recs.get(String(l.local_id)); if (r) out.push({ externalId: String(l.external_id), booking: toStored(r, str(l.content_hash)) }); }
      return out;
    },

    async listBlocking(s, qy) {
      const oid = await objectId(s.tenantId);
      if (!oid) return [];
      let b = q("records").select("id, title, data, version").eq("tenant_id", s.tenantId).eq("workspace_id", s.workspaceId).eq("object_type_id", oid).is("deleted_at", null).gte("data->>check_out", qy.fromDate);
      if (qy.room) b = b.eq("data->>room", qy.room);
      const all = await rows(b.order("created_at", { ascending: false }).limit(Math.min(qy.limit, 5000)), "booking list");
      return all.map((r) => toStored(r, null)).filter((x) => x.data.status === "confirmed");
    },

    async emit(e) {
      try { await emitEvent({ type: e.type, objectType: "obj:booking", objectId: e.recordId, workspaceId: e.workspaceId, data: e.data }, db); }
      catch { /* best effort: the record and the sync run already hold the fact */ }
    },
  };
}
