// Service-role implementation of NotifyPorts (used by the notify queue handler only). Every query is scoped by workspace.
import type { Db } from "@/lib/db/client";
import { throwIfError } from "@/lib/db/errors";
import { toCamel } from "@/lib/db/map";
import { from } from "@/lib/db/query";
import type { EventRow } from "@/lib/events/types";
import type { NotifyPorts } from "./process";
import { OBJECT_TABLE } from "./urls";
import type { PrefRow, RuleRow } from "./types";

type Rec = Record<string, unknown>;
const rows = (d: unknown) => ((d as Rec[] | null) ?? []);
const col = <T = string>(r: Rec[], k: string) => r.map((x) => x[k] as T).filter((v) => v !== null && v !== undefined);

export function supabaseNotifyPorts(db: Db): NotifyPorts {
  return {
    async event(id, occurredAt) {
      const { data, error } = await from(db, "events").select().eq("id", id).eq("occurred_at", occurredAt).maybeSingle();
      throwIfError(error);
      return (data as EventRow | null) ?? null;
    },
    async rule(id, ws) {
      const { data, error } = await from(db, "notification_rules").select().eq("id", id).eq("workspace_id", ws).maybeSingle();
      throwIfError(error);
      return data ? toCamel<RuleRow>(data as Rec) : null;
    },
    async objectOwners(type, id, ws) {
      const table = OBJECT_TABLE[type];
      const q = type.startsWith("obj:") ? from(db, "records") : table ? from(db, table) : null;
      if (!q) return null;
      const { data, error } = await q.select().eq("id", id).eq("workspace_id", ws).maybeSingle();
      throwIfError(error);
      if (!data) return null;
      const r = data as Rec;
      return { ownerId: (r.owner_id as string | null) ?? null, assigneeId: (r.assignee_id as string | null) ?? null };
    },
    async teamManagers(userIds, ws) {
      const teams = await from(db, "teams").select("id").eq("workspace_id", ws);
      throwIfError(teams.error);
      const inWs = col(rows(teams.data), "id");
      if (!inWs.length) return [];
      const mine = await from(db, "team_members").select("team_id").in("user_id", userIds).in("team_id", inWs);
      throwIfError(mine.error);
      const ids = [...new Set(col(rows(mine.data), "team_id"))];
      if (!ids.length) return [];
      const mgr = await from(db, "team_members").select("user_id").in("team_id", ids).eq("is_manager", true);
      throwIfError(mgr.error);
      return col(rows(mgr.data), "user_id");
    },
    async roleMembers(roleId, ws) {
      const { data, error } = await from(db, "memberships").select("user_id").eq("workspace_id", ws).eq("role_id", roleId).eq("is_active", true);
      throwIfError(error);
      return col(rows(data), "user_id");
    },
    async followers(type, id) {
      const { data, error } = await from(db, "follows").select("user_id").eq("object_type", type).eq("object_id", id);
      throwIfError(error);
      return col(rows(data), "user_id");
    },
    async activeMembers(ids, ws) {
      if (!ids.length) return [];
      const { data, error } = await from(db, "memberships").select("user_id, valid_until").eq("workspace_id", ws).eq("is_active", true).in("user_id", ids);
      throwIfError(error);
      const now = Date.now();
      return rows(data).filter((r) => !r.valid_until || Date.parse(String(r.valid_until)) > now).map((r) => r.user_id as string);
    },
    async canRead(userId, ws, type, id) {
      const c = (db as unknown as { schema(s: string): { rpc(f: string, a: Rec): PromiseLike<{ data: unknown; error: { message?: string } | null }> } });
      const { data, error } = await c.schema("authz").rpc("user_can_read", { p_user: userId, p_ws: ws, p_type: type, p_id: id });
      if (error) throw new Error(`user_can_read: ${(error.message ?? "error").split("\n")[0].slice(0, 160)}`);
      return data === true;
    },
    async displayName(userId) {
      const { data, error } = await from(db, "profiles").select("full_name").eq("id", userId).maybeSingle();
      throwIfError(error);
      return ((data as Rec | null)?.full_name as string | undefined) ?? null;
    },
    async prefs(userIds, ws) {
      const { data, error } = await from(db, "notification_prefs").select().eq("workspace_id", ws).in("user_id", userIds);
      throwIfError(error);
      return rows(data).map((r) => toCamel<PrefRow>(r));
    },
    async existing(userIds, ws, keys) {
      const { data, error } = await from(db, "notifications").select("body").eq("workspace_id", ws).in("user_id", userIds)
        .in("body->>dedupe", keys);
      throwIfError(error);
      return new Set(rows(data).map((r) => (r.body as Rec | null)?.dedupe as string).filter(Boolean));
    },
    async insert(list) {
      const { error } = await from(db, "notifications").insert(list.map((n) => ({
        workspace_id: n.workspaceId, user_id: n.userId, kind: n.kind, object_type: n.objectType, object_id: n.objectId,
        actor_id: n.actorId, title: n.title, body: n.body, url: n.url,
      })));
      throwIfError(error);
    },
    async emailOf(userId) {
      const { data, error } = await from(db, "profiles").select("email").eq("id", userId).maybeSingle();
      throwIfError(error);
      return ((data as Rec | null)?.email as string | undefined) ?? null;
    },
  };
}
