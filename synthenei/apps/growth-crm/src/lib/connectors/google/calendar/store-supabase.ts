// Supabase implementation of CalendarStore on the SERVICE-ROLE client (scheduled jobs). RLS does not protect this path, so every query is
// scoped by tenant_id and workspace_id explicitly. Needs no schema change: calendar_events (0019) already has everything.
// A contact lookup only ever sees the connection's own workspace.
import "server-only";
import type { Db } from "@/lib/db/client";
import { from, type Qb } from "@/lib/db/query";
import { sigOf } from "./mapper";
import type { CalendarStore } from "./store";
import type { CalStatus, Existing, LocalEvent, ObjectRef } from "./types";

type R = Record<string, unknown>;
const failed = (what: string) => new Error(`calendar store: ${what} failed`);   // PostgREST text can quote values: not echoed
const status = (v: unknown): CalStatus => (v === "cancelled" ? "cancelled" : v === "tentative" ? "tentative" : "confirmed");
const COLS = "id,integration_id,external_id,starts_at,ends_at,title,status,object_type,object_id,updated_at";

export function supabaseCalendarStore(db: Db): CalendarStore {
  const rows = async (b: Qb, what: string): Promise<R[]> => { const { data, error } = await b; if (error) throw failed(what); return (data as R[] | null) ?? []; };
  const toLocal = (r: R): LocalEvent => ({ id: String(r.id), externalId: (r.external_id as string | null) ?? null, integrationId: (r.integration_id as string | null) ?? null, startsAt: String(r.starts_at), endsAt: String(r.ends_at), title: String(r.title ?? ""), status: status(r.status), objectType: (r.object_type as string | null) ?? null, objectId: (r.object_id as string | null) ?? null, updatedAt: String(r.updated_at) });
  return {
    async findByExternal(scope, ids) {
      const out = new Map<string, Existing>();
      if (!ids.length) return out;
      const r = await rows(from(db, "calendar_events").select(COLS).eq("tenant_id", scope.tenantId).eq("workspace_id", scope.workspaceId).eq("integration_id", scope.connectionId).in("external_id", ids), "find events");
      for (const x of r) { const l = toLocal(x); out.set(l.externalId as string, { id: l.id, updatedAt: l.updatedAt, sig: sigOf(l) }); }
      return out;
    },
    async upsertRemote(scope, list, existing) {
      for (const r of list) {
        const body = { starts_at: r.startsAt, ends_at: r.endsAt, title: r.title, status: r.status, ...(r.objectType && r.objectId ? { object_type: r.objectType, object_id: r.objectId } : {}) };
        const hit = existing.get(r.externalId);
        const res = hit
          ? await from(db, "calendar_events").update(body).eq("id", hit.id).eq("tenant_id", scope.tenantId).eq("workspace_id", scope.workspaceId)
          : await from(db, "calendar_events").insert({ ...body, tenant_id: scope.tenantId, workspace_id: scope.workspaceId, integration_id: scope.connectionId, external_id: r.externalId });
        if (res.error) throw failed("event write");
      }
    },
    async cancelRemote(scope, externalId) {
      const r = await rows(from(db, "calendar_events").update({ status: "cancelled" }).eq("tenant_id", scope.tenantId).eq("workspace_id", scope.workspaceId).eq("integration_id", scope.connectionId).eq("external_id", externalId).select("id"), "cancel event");
      return r.length > 0;
    },
    async listPushCandidates(scope, since, limit) {
      const unlinked = await rows(from(db, "calendar_events").select(COLS).eq("tenant_id", scope.tenantId).eq("workspace_id", scope.workspaceId).is("integration_id", null).neq("status", "cancelled").order("updated_at", { ascending: true }).limit(limit), "list unlinked");
      let linked: R[] = [];
      if (since) linked = await rows(from(db, "calendar_events").select(COLS).eq("tenant_id", scope.tenantId).eq("workspace_id", scope.workspaceId).eq("integration_id", scope.connectionId).gt("updated_at", since).order("updated_at", { ascending: true }).limit(limit), "list changed");
      return [...unlinked, ...linked].map(toLocal).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).slice(0, limit);
    },
    async markLinked(scope, localId, externalId) {
      const r = await rows(from(db, "calendar_events").update({ integration_id: scope.connectionId, external_id: externalId }).eq("id", localId).eq("tenant_id", scope.tenantId).eq("workspace_id", scope.workspaceId).select("id"), "link event");
      if (!r.length) throw failed("link event");
    },
    async insertLinked(scope, row) {
      const r = await rows(from(db, "calendar_events").insert({ tenant_id: scope.tenantId, workspace_id: scope.workspaceId, integration_id: scope.connectionId, external_id: row.externalId, starts_at: row.startsAt, ends_at: row.endsAt, title: row.title, status: row.status, object_type: row.objectType, object_id: row.objectId }).select("id"), "insert event");
      if (!r[0]) throw failed("insert event");
      return String(r[0].id);
    },
    async contactsByEmail(scope, emails) {
      const out = new Map<string, ObjectRef>();
      const list = [...new Set(emails.map((e) => e.toLowerCase()))].slice(0, 200);
      if (!list.length) return out;
      for (const [table, type] of [["leads", "lead"], ["contacts", "contact"]] as const) {
        const r = await rows(from(db, table).select("id,email").eq("tenant_id", scope.tenantId).eq("workspace_id", scope.workspaceId).in("email", list), `${type} lookup`);
        for (const x of r) { const e = String(x.email ?? "").toLowerCase(); if (e && !out.has(e)) out.set(e, { type, id: String(x.id) }); }
      }
      return out;
    },
  };
}
