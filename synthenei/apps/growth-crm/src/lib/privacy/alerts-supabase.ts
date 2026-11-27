// Service-role AlertPort: events through emit_event, notifications straight into public.notifications, owners from memberships.
// Server only. Every read is scoped by workspace id; nothing personal is selected.
import "server-only";
import type { Db } from "@/lib/db/client";
import { from } from "@/lib/db/query";
import { emitEvent } from "@/lib/events/emit";
import type { AlertPort, OpenRequest } from "./alerts";
import { isRequestKind, type RequestStatus } from "./types";

type R = Record<string, unknown>;
const fail = (what: string) => new Error(`privacy alerts: ${what} failed`);

export function supabaseAlertPort(db: Db): AlertPort {
  return {
    async owners(wsUuid) {
      const r = await from(db, "memberships").select("user_id").eq("workspace_id", wsUuid).eq("role", "owner").eq("is_active", true).limit(20);
      if (r.error) throw fail("owner lookup");
      return ((r.data as R[] | null) ?? []).map((x) => String(x.user_id));
    },
    async ruleExists(wsUuid, type) {
      const r = await from(db, "notification_rules").select("id").eq("workspace_id", wsUuid).eq("event_type", type).eq("enabled", true).limit(1);
      if (r.error) return false;   // no rules table or no access: the direct notification still goes out
      return ((r.data as R[] | null) ?? []).length > 0;
    },
    async alreadySent(type, requestId) {
      const ev = await from(db, "events").select("id").eq("type", type).eq("object_id", requestId).limit(1);
      if (!ev.error && ((ev.data as R[] | null) ?? []).length > 0) return true;
      const n = await from(db, "notifications").select("id").eq("kind", type).eq("object_id", requestId).limit(1);
      return !n.error && ((n.data as R[] | null) ?? []).length > 0;
    },
    async emit(type, e) {
      await emitEvent({ type, objectType: "privacy_request", objectId: e.requestId, workspaceId: e.wsUuid, data: e.data }, db);
    },
    async notify(rows) {
      const r = await from(db, "notifications").insert(rows as unknown as R[]);
      if (r.error) throw fail("notification insert");
    },
    async openDue(now, horizonDays) {
      const until = new Date(now + horizonDays * 86_400_000).toISOString();
      const r = await from(db, "privacy_requests").select("id, workspace_id, tenant_id, kind, status, due_at").in("status", ["received", "in_progress"]).lte("due_at", until).order("due_at", { ascending: true }).limit(500);
      if (r.error) throw fail("open request read");
      return ((r.data as R[] | null) ?? []).flatMap((x): OpenRequest[] => isRequestKind(x.kind)
        ? [{ id: String(x.id), wsUuid: String(x.workspace_id), tenantUuid: String(x.tenant_id), kind: x.kind, status: x.status as RequestStatus, dueAt: String(x.due_at) }] : []);
    },
  };
}
