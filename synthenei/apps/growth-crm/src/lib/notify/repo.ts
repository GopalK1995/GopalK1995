// Request-scoped repositories (user JWT, so RLS applies) for comments, notifications, prefs, rules, follows and the
// activity feed, plus the service-role mention lookup. Tables are not in supabase/types.ts yet, so rows are mapped by hand.
import { dbForRequest, type Db } from "@/lib/db/client";
import { DbError, throwIfError } from "@/lib/db/errors";
import { toCamel } from "@/lib/db/map";
import { from, type Qb } from "@/lib/db/query";
import { isQuietKind, quietKind } from "./prefs";
import type { Channel, CommentRow, Digest, FeedItem, Mentionable, NotificationRow, PrefRow, RuleRow } from "./types";

type Rec = Record<string, unknown>;
export type DbProvider = () => Promise<Db>;
const list = (d: unknown) => (d as Rec[] | null) ?? [];
const del = (db: Db, t: string) => (from(db, t) as unknown as { delete(): Qb }).delete();

import { UNREAD_CAP } from "./badge";
export { badgeLabel, UNREAD_CAP } from "./badge";

export function createNotifyRepos(getDb: DbProvider = dbForRequest) {
  return {
    notifications: {
      async list(userId: string, ws: string, o: { unreadOnly?: boolean; limit?: number } = {}): Promise<NotificationRow[]> {
        const db = await getDb();
        let q = from(db, "notifications").select().eq("user_id", userId).eq("workspace_id", ws);
        if (o.unreadOnly) q = q.is("read_at", null);
        const { data, error } = await q.order("created_at", { ascending: false }).limit(Math.min(o.limit ?? 50, 100));
        throwIfError(error);
        return list(data).map((r) => toCamel<NotificationRow>(r));
      },
      async unreadCount(userId: string, ws: string): Promise<number> {
        const db = await getDb();
        const { data, error } = await from(db, "notifications").select("id").eq("user_id", userId).eq("workspace_id", ws).is("read_at", null).limit(UNREAD_CAP);
        throwIfError(error);
        return list(data).length;
      },
      /** RLS limits this to the caller's own rows; only read_at is grantable. */
      async markRead(userId: string, ids: string[]): Promise<void> {
        if (!ids.length) return;
        const db = await getDb();
        const { error } = await from(db, "notifications").update({ read_at: new Date().toISOString() }).eq("user_id", userId).in("id", ids).is("read_at", null);
        throwIfError(error);
      },
      async markAllRead(userId: string, ws: string): Promise<void> {
        const db = await getDb();
        const { error } = await from(db, "notifications").update({ read_at: new Date().toISOString() }).eq("user_id", userId).eq("workspace_id", ws).is("read_at", null);
        throwIfError(error);
      },
    },

    prefs: {
      async list(userId: string, ws: string): Promise<PrefRow[]> {
        const db = await getDb();
        const { data, error } = await from(db, "notification_prefs").select().eq("user_id", userId).eq("workspace_id", ws);
        throwIfError(error);
        return list(data).map((r) => toCamel<PrefRow>(r));
      },
      async upsert(userId: string, ws: string, kind: string, channels: Channel[], digest: Digest): Promise<void> {
        const db = await getDb();
        const ex = await from(db, "notification_prefs").select("kind").eq("user_id", userId).eq("workspace_id", ws).eq("kind", kind).maybeSingle();
        throwIfError(ex.error);
        const { error } = ex.data
          ? await from(db, "notification_prefs").update({ channels, digest }).eq("user_id", userId).eq("workspace_id", ws).eq("kind", kind)
          : await from(db, "notification_prefs").insert({ user_id: userId, workspace_id: ws, kind, channels, digest });
        throwIfError(error);
      },
      /** Replaces the reserved quiet-hours row. `hhmm` null clears it. */
      async setQuiet(userId: string, ws: string, hhmm: string | null, existing: readonly PrefRow[]): Promise<void> {
        const db = await getDb();
        for (const p of existing.filter((x) => isQuietKind(x.kind))) {
          const { error } = await del(db, "notification_prefs").eq("user_id", userId).eq("workspace_id", ws).eq("kind", p.kind);
          throwIfError(error);
        }
        if (hhmm) {
          const { error } = await from(db, "notification_prefs").insert({ user_id: userId, workspace_id: ws, kind: quietKind(hhmm), channels: ["in_app"], digest: "instant" });
          throwIfError(error);
        }
      },
    },

    rules: {
      async list(ws: string): Promise<RuleRow[]> {
        const db = await getDb();
        const { data, error } = await from(db, "notification_rules").select().eq("workspace_id", ws).order("created_at", { ascending: true });
        throwIfError(error);
        return list(data).map((r) => toCamel<RuleRow>(r));
      },
      async create(ws: string, r: Pick<RuleRow, "eventType" | "recipients" | "channels" | "template" | "enabled">): Promise<RuleRow> {
        const db = await getDb();
        const { data, error } = await from(db, "notification_rules").insert({
          workspace_id: ws, event_type: r.eventType, recipients: r.recipients, channels: r.channels, template: r.template, enabled: r.enabled,
        }).select().single();
        throwIfError(error);
        return toCamel<RuleRow>(data as Rec);
      },
      async update(ws: string, id: string, r: Partial<Pick<RuleRow, "eventType" | "recipients" | "channels" | "template" | "enabled">>): Promise<RuleRow> {
        const db = await getDb();
        const body: Rec = {};
        if (r.eventType !== undefined) body.event_type = r.eventType;
        if (r.recipients !== undefined) body.recipients = r.recipients;
        if (r.channels !== undefined) body.channels = r.channels;
        if (r.template !== undefined) body.template = r.template;
        if (r.enabled !== undefined) body.enabled = r.enabled;
        const { data, error } = await from(db, "notification_rules").update(body).eq("workspace_id", ws).eq("id", id).select().maybeSingle();
        throwIfError(error);
        if (!data) throw new DbError("not_found", "not_found");
        return toCamel<RuleRow>(data as Rec);
      },
      async remove(ws: string, id: string): Promise<void> {
        const db = await getDb();
        const { error } = await del(db, "notification_rules").eq("workspace_id", ws).eq("id", id);
        throwIfError(error);
      },
    },

    follows: {
      async isFollowing(userId: string, type: string, id: string): Promise<boolean> {
        const db = await getDb();
        const { data, error } = await from(db, "follows").select("object_id").eq("user_id", userId).eq("object_type", type).eq("object_id", id).maybeSingle();
        throwIfError(error);
        return !!data;
      },
      async follow(userId: string, type: string, id: string): Promise<void> {
        const db = await getDb();
        if (await this.isFollowing(userId, type, id)) return; // idempotent
        const { error } = await from(db, "follows").insert({ user_id: userId, object_type: type, object_id: id });
        throwIfError(error);
      },
      async unfollow(userId: string, type: string, id: string): Promise<void> {
        const db = await getDb();
        const { error } = await del(db, "follows").eq("user_id", userId).eq("object_type", type).eq("object_id", id);
        throwIfError(error);
      },
    },

    comments: {
      async list(ws: string, type: string, id: string): Promise<CommentRow[]> {
        const db = await getDb();
        const { data, error } = await from(db, "comments").select().eq("workspace_id", ws).eq("object_type", type).eq("object_id", id)
          .is("deleted_at", null).order("created_at", { ascending: true }).limit(500);
        throwIfError(error);
        return list(data).map((r) => toCamel<CommentRow>(r));
      },
      async get(ws: string, id: string): Promise<CommentRow | null> {
        const db = await getDb();
        const { data, error } = await from(db, "comments").select().eq("workspace_id", ws).eq("id", id).maybeSingle();
        throwIfError(error);
        return data ? toCamel<CommentRow>(data as Rec) : null;
      },
      async create(ws: string, c: { objectType: string; objectId: string; parentId: string | null; body: string; mentions: string[] }): Promise<CommentRow> {
        const db = await getDb();
        const { data, error } = await from(db, "comments").insert({
          workspace_id: ws, object_type: c.objectType, object_id: c.objectId, parent_id: c.parentId, body: c.body, mentions: c.mentions,
        }).select().single();
        throwIfError(error);
        return toCamel<CommentRow>(data as Rec);
      },
      async edit(ws: string, id: string, body: string, mentions: string[]): Promise<CommentRow> {
        const db = await getDb();
        const { data, error } = await from(db, "comments").update({ body, mentions }).eq("workspace_id", ws).eq("id", id).select().maybeSingle();
        throwIfError(error);
        if (!data) throw new DbError("denied", "denied"); // RLS filtered the row: not the author, or the 15-minute window closed
        return toCamel<CommentRow>(data as Rec);
      },
      /** Real DELETE (0018). 0 rows removed = RLS refused (window closed / not author / no comments.moderate). */
      async remove(ws: string, id: string): Promise<void> {
        const db = await getDb();
        const { data, error } = await del(db, "comments").eq("workspace_id", ws).eq("id", id).select("id");
        throwIfError(error);
        if (list(data).length === 0) throw new DbError("denied", "denied");
      },
    },

    /** Display names only (never email or phone). */
    async names(ids: string[]): Promise<Record<string, string>> {
      if (!ids.length) return {};
      const db = await getDb();
      const { data, error } = await from(db, "profiles").select("id, full_name").in("id", [...new Set(ids)]);
      throwIfError(error);
      return Object.fromEntries(list(data).map((r) => [r.id as string, String(r.full_name)]));
    },

    feed: {
      /** v_activity_feed is security_invoker: the caller only gets events on records they can read. */
      async forObject(ws: string, type: string, id: string, limit = 30): Promise<FeedItem[]> {
        const db = await getDb();
        const { data, error } = await from(db, "v_activity_feed").select().eq("workspace_id", ws).eq("object_type", type).eq("object_id", id)
          .order("occurred_at", { ascending: false }).limit(Math.min(limit, 100));
        throwIfError(error);
        return list(data).map(toFeed);
      },
      async forWorkspace(ws: string, limit = 50): Promise<FeedItem[]> {
        const db = await getDb();
        const { data, error } = await from(db, "v_activity_feed").select().eq("workspace_id", ws)
          .order("occurred_at", { ascending: false }).limit(Math.min(limit, 100));
        throwIfError(error);
        return list(data).map(toFeed);
      },
    },
  };
}

function toFeed(r: Rec): FeedItem {
  return {
    id: String(r.id), occurredAt: String(r.occurred_at), type: String(r.type), objectType: (r.object_type as string | null) ?? null,
    objectId: (r.object_id as string | null) ?? null, actorKind: String(r.actor_kind ?? "system"), actorId: (r.actor_id as string | null) ?? null,
  };
}

export const notifyRepos = createNotifyRepos();

/** Everyone in the workspace who can read this record. Service role: authz.user_can_read is not callable by users. */
export async function listMentionable(db: Db, ws: string, type: string, id: string, q = ""): Promise<Mentionable[]> {
  const m = await from(db, "memberships").select("user_id").eq("workspace_id", ws).eq("is_active", true).limit(200);
  throwIfError(m.error);
  const ids = list(m.data).map((r) => r.user_id as string);
  if (!ids.length) return [];
  const p = await from(db, "profiles").select("id, full_name").in("id", ids);
  throwIfError(p.error);
  const needle = q.trim().toLowerCase();
  const cands = list(p.data).map((r) => ({ id: r.id as string, name: String(r.full_name) })).filter((c) => !needle || c.name.toLowerCase().includes(needle));
  const out: Mentionable[] = [];
  for (const c of cands.slice(0, 40)) if (await canUserRead(db, c.id, ws, type, id)) out.push(c);
  return out.slice(0, 8);
}

export async function canUserRead(db: Db, userId: string, ws: string, type: string, id: string): Promise<boolean> {
  const c = db as unknown as { schema(s: string): { rpc(f: string, a: Rec): PromiseLike<{ data: unknown; error: { message?: string } | null }> } };
  const { data, error } = await c.schema("authz").rpc("user_can_read", { p_user: userId, p_ws: ws, p_type: type, p_id: id });
  if (error) throw new DbError("error", "error");
  return data === true;
}
