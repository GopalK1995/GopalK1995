// Supabase implementation of BookingStore on the SERVICE-ROLE client (inbound webhooks and jobs are sanctioned users of serviceDb,
// CONTRACTS C6). RLS does not protect this path, so every query is explicitly scoped by workspace_id (and integration id for calendar rows).
// Tables used: calendar_events (0019), tasks, notifications (0018), memberships, leads. No new table; see "T047 needs" for the event types.
import "server-only";
import type { Db } from "@/lib/db/client";
import { from, type Qb } from "@/lib/db/query";
import { emitEvent } from "@/lib/events/emit";
import type { BookingStore, CalendarOutcome } from "./store";

type R = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const failed = (what: string) => new Error(`booking store: ${what} failed`);   // PostgREST text can quote values: not echoed
const UNIQUE = "23505";

export function supabaseBookingStore(db: Db): BookingStore {
  const q = (t: string) => from(db, t);
  const rows = async (b: Qb, what: string): Promise<R[]> => { const { data, error } = await b; if (error) throw failed(what); return (data as R[] | null) ?? []; };
  const readEvent = async (integrationId: string, externalId: string): Promise<R | undefined> =>
    (await rows(q("calendar_events").select("id, status, starts_at, ends_at, title, object_type, object_id").eq("integration_id", integrationId).eq("external_id", externalId).limit(1), "calendar read"))[0];

  return {
    async findLeadByEmail(workspaceId, email) {
      const r = (await rows(q("leads").select("id, owner_id").eq("workspace_id", workspaceId).is("deleted_at", null).ilike("email", email.replace(/[%_\\]/g, "\\$&")).order("created_at", { ascending: false }).limit(1), "lead match"))[0];
      return r ? { id: String(r.id), ownerId: str(r.owner_id) } : null;
    },

    async upsertCalendarEvent(r) {
      const cur = await readEvent(r.integrationId, r.externalId);
      const leadOf = (row: R | undefined): string | null => (row && row.object_type === "lead" ? str(row.object_id) : null);
      if (!cur) {
        if (r.onlyIfExists) return { outcome: "missing", id: null, leadId: null };
        const ins = await q("calendar_events").insert({
          tenant_id: r.tenantId, workspace_id: r.workspaceId, integration_id: r.integrationId, external_id: r.externalId,
          starts_at: r.startsAt, ends_at: r.endsAt, title: r.title.slice(0, 300), status: r.status,
          ...(r.leadId ? { object_type: "lead", object_id: r.leadId } : {}),
        }).select("id");
        if (ins.error) {
          if (ins.error.code !== UNIQUE) throw failed("calendar insert");
          const again = await readEvent(r.integrationId, r.externalId);   // a parallel delivery won the race: treat as an update of that row
          if (!again) throw failed("calendar insert");
          return this.upsertCalendarEvent({ ...r });
        }
        const id = ((ins.data as R[] | null) ?? [])[0]?.id;
        return { outcome: "created", id: typeof id === "string" ? id : null, leadId: r.leadId };
      }
      const id = String(cur.id), linked = leadOf(cur), leadId = linked ?? r.leadId;
      const patch: R = { updated_at: new Date().toISOString() };
      let outcome: CalendarOutcome;
      if (r.status === "cancelled") {
        outcome = cur.status === "cancelled" ? "already_cancelled" : "cancelled";
        if (outcome === "cancelled") patch.status = "cancelled";
      } else if (cur.status === "cancelled") {
        return { outcome: "stale", id, leadId };   // a booking delivered after its own cancellation never resurrects it
      } else {
        const same = new Date(String(cur.starts_at)).getTime() === Date.parse(r.startsAt) && new Date(String(cur.ends_at)).getTime() === Date.parse(r.endsAt) && cur.title === r.title.slice(0, 300);
        outcome = same ? "unchanged" : "updated";
        if (!same) Object.assign(patch, { starts_at: r.startsAt, ends_at: r.endsAt, title: r.title.slice(0, 300) });
      }
      if (!linked && r.leadId) Object.assign(patch, { object_type: "lead", object_id: r.leadId });
      if (Object.keys(patch).length > 1) await rows(q("calendar_events").update(patch).eq("integration_id", r.integrationId).eq("id", id).select("id"), "calendar update");
      return { outcome, id, leadId };
    },

    async insertTaskOnce(t) {
      const dup = await rows(q("tasks").select("id").eq("workspace_id", t.workspaceId).eq("lead_id", t.leadId).eq("title", t.title).limit(1), "task lookup");
      if (dup.length) return false;
      await rows(q("tasks").insert({
        tenant_id: t.tenantId, workspace_id: t.workspaceId, lead_id: t.leadId, assignee_id: t.assigneeId, title: t.title.slice(0, 300), kind: t.kind, priority: t.priority, due_at: t.dueAt,
      }).select("id"), "task insert");
      return true;
    },

    async workspaceOwners(workspaceId) {
      return (await rows(q("memberships").select("user_id").eq("workspace_id", workspaceId).eq("role", "owner").eq("is_active", true).limit(20), "owners")).map((r) => String(r.user_id));
    },

    async notifyOnce(n) {
      if (!n.userIds.length) return 0;
      const have = await rows(q("notifications").select("user_id").eq("workspace_id", n.workspaceId).in("user_id", n.userIds).in("body->>dedupe", [n.dedupe]), "notice lookup");
      const done = new Set(have.map((r) => String(r.user_id)));
      const todo = n.userIds.filter((u) => !done.has(u));
      if (!todo.length) return 0;
      await rows(q("notifications").insert(todo.map((u) => ({
        tenant_id: n.tenantId, workspace_id: n.workspaceId, user_id: u, kind: n.kind, object_type: n.objectType, object_id: n.objectId,
        title: n.title, body: { ...n.body, dedupe: n.dedupe }, url: n.url,
      }))).select("id"), "notice insert");
      return todo.length;
    },

    async emit(e) {
      try { await emitEvent({ type: e.type, objectType: e.objectType, objectId: e.objectId, workspaceId: e.workspaceId, data: e.data }, db); }
      catch { /* best effort: the booking row and the notification already hold the record; an event failure must not undo or retry them */ }
    },
  };
}
