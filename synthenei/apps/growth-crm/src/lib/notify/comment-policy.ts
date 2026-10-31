// Who may edit or delete a comment. Mirrors the 0018 RLS: authors within 15 minutes, comments.moderate any time.
import { COMMENT_WINDOW_MS } from "./types";

export interface PolicyInput { authorId: string; createdAt: string; viewerId: string; now: Date; canModerate: boolean }
export function withinWindow(createdAt: string, now: Date): boolean {
  const t = Date.parse(createdAt);
  return Number.isFinite(t) && now.getTime() - t <= COMMENT_WINDOW_MS;
}
export const canEditComment = (i: PolicyInput) =>
  (i.authorId === i.viewerId && withinWindow(i.createdAt, i.now)) || i.canModerate;
export const canDeleteComment = canEditComment;
/** Why the edit/delete control is disabled, as a strings key; null when allowed. */
export function commentLockReason(i: PolicyInput): "notAuthor" | "windowClosed" | null {
  if (canEditComment(i)) return null;
  return i.authorId === i.viewerId ? "windowClosed" : "notAuthor";
}
