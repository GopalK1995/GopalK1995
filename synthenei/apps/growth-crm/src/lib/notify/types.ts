// Shared types for comments, notifications and the activity feed (BUILD-PLAN 2.6, CONTRACTS C8).
export const CHANNELS = ["in_app", "email", "whatsapp", "push"] as const;
export type Channel = (typeof CHANNELS)[number];
export const DIGESTS = ["instant", "hourly", "daily", "off"] as const;
export type Digest = (typeof DIGESTS)[number];

/** DB check on comments.body and the author edit/delete window (0018 RLS). */
export const COMMENT_MAX = 10000;
export const COMMENT_WINDOW_MS = 15 * 60 * 1000;
export const MAX_MENTIONS = 20;
/** Notification text kept short and free of PII beyond display names. */
export const NOTE_BODY_MAX = 140;

export interface NotificationRow {
  id: string; workspaceId: string; userId: string; kind: string;
  objectType: string | null; objectId: string | null; actorId: string | null;
  title: Record<string, string>; body: Record<string, string>; url: string | null;
  readAt: string | null; createdAt: string;
}
export interface PrefRow { userId: string; workspaceId: string; kind: string; channels: Channel[]; digest: Digest }
export interface RuleRow {
  id: string; workspaceId: string; eventType: string; conditions: Record<string, unknown>;
  recipients: string[]; channels: Channel[]; template: { title?: Record<string, string>; body?: Record<string, string> };
  enabled: boolean;
}
export interface CommentRow {
  id: string; workspaceId: string; objectType: string; objectId: string; parentId: string | null; authorId: string;
  body: string; mentions: string[]; createdAt: string; editedAt: string | null; deletedAt: string | null;
}
export interface FeedItem {
  id: string; occurredAt: string; type: string; objectType: string | null; objectId: string | null;
  actorKind: string; actorId: string | null; actorName?: string | null;
}
export interface Mentionable { id: string; name: string }
