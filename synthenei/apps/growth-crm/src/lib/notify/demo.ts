// Demo-workspace content. Shown only for demo sessions; real sessions never read this and demo never touches Supabase.
import type { CommentRow, FeedItem, NotificationRow } from "./types";

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
export const DEMO_PEOPLE: Record<string, string> = { "demo-priya": "Priya Raman", "demo-arun": "Arun Kumar" };

export const demoComments = (objectType: string, objectId: string, viewerId: string): CommentRow[] => [
  { id: "demo-c1", workspaceId: "demo", objectType, objectId, parentId: null, authorId: "demo-priya", body: "Spoke to them today. They want a quote by Friday.", mentions: [], createdAt: ago(190), editedAt: null, deletedAt: null },
  { id: "demo-c2", workspaceId: "demo", objectType, objectId, parentId: null, authorId: viewerId, body: "On it. @[Arun Kumar](user:00000000-0000-4000-8000-00000000d0a1) can you check stock?", mentions: [], createdAt: ago(5), editedAt: null, deletedAt: null },
];
export const demoFeed = (objectType: string, objectId: string): FeedItem[] => [
  { id: "demo-e1", occurredAt: ago(5), type: "comment.created", objectType, objectId, actorKind: "user", actorId: "demo-priya" },
  { id: "demo-e2", occurredAt: ago(300), type: "lead.assigned", objectType, objectId, actorKind: "user", actorId: "demo-arun" },
  { id: "demo-e3", occurredAt: ago(1440), type: "lead.created", objectType, objectId, actorKind: "system", actorId: null },
];
export const demoNotifications = (ws: string, userId: string): NotificationRow[] => [
  { id: "demo-n1", workspaceId: ws, userId, kind: "mention", objectType: "lead", objectId: "demo-lead", actorId: "demo-priya", title: { en: "You were mentioned" }, body: { en: "Priya Raman: can you check stock for the Friday quote?" }, url: null, readAt: null, createdAt: ago(12) },
  { id: "demo-n2", workspaceId: ws, userId, kind: "lead.assigned", objectType: "lead", objectId: "demo-lead", actorId: "demo-arun", title: { en: "Lead assigned" }, body: { en: "By Arun Kumar" }, url: null, readAt: null, createdAt: ago(240) },
  { id: "demo-n3", workspaceId: ws, userId, kind: "comment", objectType: "lead", objectId: "demo-lead", actorId: "demo-priya", title: { en: "New comment" }, body: { en: "Spoke to them today." }, url: null, readAt: ago(100), createdAt: ago(400) },
];
