"use server";
// Comment and follow mutations (CONTRACTS C7). Real sessions: assertCan -> mention access check (service role,
// authz.user_can_read) -> RLS-protected write. The database re-checks everything (0018 comments_guard trigger), so a
// bypass of this layer still cannot notify someone who cannot read the record. Demo sessions never touch Supabase.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { assertCan } from "@/lib/authz/load";
import { serviceDb } from "@/lib/db/service";
import { DbError } from "@/lib/db/errors";
import { from } from "@/lib/db/query";
import { canDeleteComment, canEditComment, commentLockReason } from "@/lib/notify/comment-policy";
import { checkMentions, extractMentionIds } from "@/lib/notify/mentions";
import { canUserRead, listMentionable, notifyRepos } from "@/lib/notify/repo";
import { canDo, collabCtx } from "@/lib/notify/session";
import { ct } from "@/lib/notify/strings";
import { COMMENT_MAX, MAX_MENTIONS, type CommentRow, type Mentionable } from "@/lib/notify/types";
import { isObjectType } from "@/lib/notify/urls";
import type { ObjectType } from "@/lib/authz";

const uuid = z.string().uuid();
const target = z.object({ objectType: z.string().refine(isObjectType, "Unknown record type"), objectId: uuid });
const commentSchema = target.extend({
  body: z.string().trim().min(1, ct("bodyEmpty")).max(COMMENT_MAX, ct("bodyTooLong", { max: COMMENT_MAX })),
  parentId: uuid.nullish(),
});
const invalid = (e: z.ZodError): ActionResult<never> =>
  failResult("invalid", e.issues[0]?.message ?? ct("error"), { issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });

/** Real-mode wrapper: DbError(denied/not_found) get this namespace's wording. */
async function real<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const r = await runAction(fn);
  if (r.ok) return r;
  if (r.code === "denied") return { ...r, message: r.message && r.message !== "You do not have permission to do that." ? r.message : ct("denied") };
  if (r.code === "not_found") return { ...r, message: ct("notFound") };
  if (r.code === "error") return { ...r, message: ct("error") };
  return r;
}

/** Every mentioned user (except the author) must be able to read the record. Returns a failure or null. */
async function mentionFailure(ws: string, type: string, id: string, authorId: string, ids: string[]): Promise<ActionResult<never> | null> {
  if (ids.length === 0) return null;
  const db = serviceDb();
  const readable = new Set<string>();
  for (const u of ids.slice(0, MAX_MENTIONS + 1)) if (u === authorId || (await canUserRead(db, u, ws, type, id))) readable.add(u);
  const chk = checkMentions(ids, readable, authorId);
  if (chk.tooMany) return failResult("invalid", ct("mentionTooMany", { max: MAX_MENTIONS }), { issues: [{ path: "mentions", message: "too_many" }] });
  if (chk.ok) return null;
  const names = new Map((await listMentionableNames(ws, chk.rejected)).map((m) => [m.id, m.name]));
  return failResult("invalid", ct("mentionRejected", { names: chk.rejected.map((r) => names.get(r) ?? "Someone").join(", ") }),
    { issues: chk.rejected.map((r) => ({ path: "mentions", message: `no_access:${r}` })) });
}
async function listMentionableNames(ws: string, ids: string[]): Promise<Mentionable[]> {
  const { data } = await from(serviceDb(), "profiles").select("id, full_name").in("id", ids);
  return ((data as { id: string; full_name: string }[] | null) ?? []).map((r) => ({ id: r.id, name: r.full_name }));
}

export async function postComment(input: { objectType: string; objectId: string; body: string; parentId?: string | null }): Promise<ActionResult<{ id: string }>> {
  const p = commentSchema.safeParse(input);
  if (!p.success) return invalid(p.error);
  const c = await collabCtx();
  const { objectType, objectId, body, parentId } = p.data;
  if (c.demo) return okResult(ct("posted"), { sub: ct("demoNotice"), data: { id: "demo-comment" } });
  return real(async () => {
    // Own scope here means "my own comment": the record's read access is enforced by RLS and the self read check below.
    await assertCan("comments.write", { type: objectType as ObjectType, id: objectId, workspaceId: c.wsKey, ownerId: c.uid });
    if (!(await canUserRead(serviceDb(), c.uid, c.ws, objectType, objectId))) return failResult("denied", ct("denied"));
    const mentions = extractMentionIds(body);
    const bad = await mentionFailure(c.ws, objectType, objectId, c.uid, mentions);
    if (bad) return bad;
    const row = await notifyRepos.comments.create(c.ws, { objectType, objectId, parentId: parentId ?? null, body, mentions });
    revalidatePath("/notifications");
    return okResult(ct("posted"), { data: { id: row.id } });
  });
}

async function ownedComment(ws: string, id: string): Promise<CommentRow> {
  const row = await notifyRepos.comments.get(ws, id);
  if (!row || row.deletedAt) throw new DbError("not_found", "not_found");
  return row;
}

export async function editComment(input: { id: string; body: string }): Promise<ActionResult<{ id: string }>> {
  const p = z.object({ id: uuid, body: commentSchema.shape.body }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const c = await collabCtx();
  if (c.demo) return okResult(ct("saved"), { sub: ct("demoNotice"), data: { id: p.data.id } });
  return real(async () => {
    await assertCan("comments.write", undefined, c.wsKey);
    const row = await ownedComment(c.ws, p.data.id);
    const pol = { authorId: row.authorId, createdAt: row.createdAt, viewerId: c.uid, now: new Date(), canModerate: await canDo("comments.moderate") };
    if (!canEditComment(pol)) return failResult("denied", ct(commentLockReason(pol) === "windowClosed" ? "lockWindowClosed" : "lockNotAuthor"));
    const mentions = extractMentionIds(p.data.body);
    const fresh = mentions.filter((m) => !row.mentions.includes(m)); // already-accepted mentions are not re-checked
    const bad = await mentionFailure(c.ws, row.objectType, row.objectId, c.uid, fresh);
    if (bad) return bad;
    await notifyRepos.comments.edit(c.ws, row.id, p.data.body, mentions);
    revalidatePath("/notifications");
    return okResult(ct("saved"), { data: { id: row.id } });
  });
}

export async function deleteComment(input: { id: string }): Promise<ActionResult> {
  const p = z.object({ id: uuid }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const c = await collabCtx();
  if (c.demo) return okResult(ct("deleted"), { sub: ct("demoNotice") });
  return real(async () => {
    await assertCan("comments.write", undefined, c.wsKey);
    const row = await ownedComment(c.ws, p.data.id);
    const pol = { authorId: row.authorId, createdAt: row.createdAt, viewerId: c.uid, now: new Date(), canModerate: await canDo("comments.moderate") };
    if (!canDeleteComment(pol)) return failResult("denied", ct(commentLockReason(pol) === "windowClosed" ? "lockWindowClosed" : "lockNotAuthor"));
    await notifyRepos.comments.remove(c.ws, row.id);
    revalidatePath("/notifications");
    return okResult(ct("deleted"));
  });
}

export async function setFollow(input: { objectType: string; objectId: string; follow: boolean }): Promise<ActionResult<{ following: boolean }>> {
  const p = target.extend({ follow: z.boolean() }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const c = await collabCtx();
  if (c.demo) return okResult(p.data.follow ? ct("followed") : ct("unfollowed"), { sub: ct("followDemo"), data: { following: p.data.follow } });
  return real(async () => {
    await assertCan("comments.write", undefined, c.wsKey);
    if (!(await canUserRead(serviceDb(), c.uid, c.ws, p.data.objectType, p.data.objectId))) return failResult("denied", ct("denied"));
    if (p.data.follow) await notifyRepos.follows.follow(c.uid, p.data.objectType, p.data.objectId);
    else await notifyRepos.follows.unfollow(c.uid, p.data.objectType, p.data.objectId);
    return okResult(p.data.follow ? ct("followed") : ct("unfollowed"), { data: { following: p.data.follow } });
  });
}

/** Autocomplete: only people who can read this record, and only if the caller can. */
export async function searchMentionable(input: { objectType: string; objectId: string; q: string }): Promise<ActionResult<{ people: Mentionable[] }>> {
  const p = target.extend({ q: z.string().max(60) }).safeParse(input);
  if (!p.success) return invalid(p.error);
  const c = await collabCtx();
  if (c.demo) return okResult("", { data: { people: [] } });
  return real(async () => {
    await assertCan("comments.write", undefined, c.wsKey);
    const db = serviceDb();
    if (!(await canUserRead(db, c.uid, c.ws, p.data.objectType, p.data.objectId))) return failResult("denied", ct("denied"));
    const people = (await listMentionable(db, c.ws, p.data.objectType, p.data.objectId, p.data.q)).filter((m) => m.id !== c.uid);
    return okResult("", { data: { people } });
  });
}
