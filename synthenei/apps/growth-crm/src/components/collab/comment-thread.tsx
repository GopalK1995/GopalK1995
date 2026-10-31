"use client";
// Comment thread on any record. Edit/delete follow the 15-minute author window or comments.moderate; locked controls say why.
// Demo sessions keep new comments in local state only (the actions return a demo notice and never touch Supabase).
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/states";
import { toast } from "@/components/ui/toast";
import { fmtDateTime } from "@/lib/format";
import { canEditComment, commentLockReason } from "@/lib/notify/comment-policy";
import { bodyParts, extractMentionIds, plainBody } from "@/lib/notify/mentions";
import type { CommentRow, Mentionable } from "@/lib/notify/types";
import { deleteComment, editComment, postComment } from "./actions";
import { MentionComposer, toStoredBody } from "./mention-composer";
import { fill, type Strings } from "./strings";

export function CommentThread({ objectType, objectId, comments, names, viewerId, viewerName, canWrite, canModerate, demo, s, nowIso }: {
  objectType: string; objectId: string; comments: CommentRow[]; names: Record<string, string>;
  viewerId: string; viewerName: string; canWrite: boolean; canModerate: boolean; demo: boolean; s: Strings; nowIso: string;
}) {
  const router = useRouter();
  const [list, setList] = useState(comments);
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Mentionable[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editPicked, setEditPicked] = useState<Mentionable[]>([]);
  const [busy, start] = useTransition();
  const nameOf = (id: string) => names[id] ?? (id === viewerId ? viewerName : "Someone");
  const now = new Date(nowIso);

  const post = () => start(async () => {
    setError(null);
    const body = toStoredBody(text.trim(), picked);
    const r = await postComment({ objectType, objectId, body });
    if (!r.ok) { setError(r.message); return; }
    toast(r.message, r.sub ?? "");
    if (demo) setList((l) => [...l, { id: `local-${l.length}`, workspaceId: "demo", objectType, objectId, parentId: null, authorId: viewerId, body, mentions: extractMentionIds(body), createdAt: new Date().toISOString(), editedAt: null, deletedAt: null }]);
    setText(""); setPicked([]);
    if (!demo) router.refresh();
  });
  const saveEdit = (c: CommentRow) => start(async () => {
    setError(null);
    const body = toStoredBody(editText.trim(), editPicked);
    const r = await editComment({ id: c.id, body });
    if (!r.ok) { setError(r.message); return; }
    toast(r.message, r.sub ?? "");
    if (demo) setList((l) => l.map((x) => (x.id === c.id ? { ...x, body, editedAt: new Date().toISOString() } : x)));
    setEditing(null);
    if (!demo) router.refresh();
  });
  const remove = (c: CommentRow) => start(async () => {
    setError(null);
    const r = await deleteComment({ id: c.id });
    if (!r.ok) { setError(r.message); return; }
    toast(r.message, r.sub ?? "");
    setList((l) => l.filter((x) => x.id !== c.id));
    if (!demo) router.refresh();
  });

  return (
    <section aria-labelledby="collab-comments" className="grid gap-3">
      <h2 id="collab-comments" className="text-15 font-bold tracking-[-0.015em] text-ink">{s.commentsTitle} <span className="num text-12 font-normal text-ink-3">{list.length}</span></h2>
      {list.length === 0 ? (
        <EmptyState title={s.commentsEmpty} body={s.commentsEmptyBody} />
      ) : (
        <ul className="divide-y divide-line rounded-control border border-line">
          {list.map((c) => {
            const pol = { authorId: c.authorId, createdAt: c.createdAt, viewerId, now, canModerate };
            const mine = canEditComment(pol) && canWrite;
            const lock = canWrite ? commentLockReason(pol) : null;
            return (
              <li key={c.id} className="flex gap-3 px-3 py-3" data-testid="comment">
                <Avatar name={nameOf(c.authorId)} size={24} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-12">
                    <span className="font-semibold text-ink">{nameOf(c.authorId)}</span>
                    <time className="num text-ink-3" dateTime={c.createdAt}>{fmtDateTime(c.createdAt)}</time>
                    {c.editedAt && <span className="text-ink-3">({s.edited})</span>}
                  </div>
                  {editing === c.id ? (
                    <div className="mt-1 grid gap-2">
                      <MentionComposer objectType={objectType} objectId={objectId} s={s} value={editText} onChange={setEditText} onPick={(m) => setEditPicked((p) => [...p, m])} autoFocus />
                      <div className="flex gap-2">
                        <Button size="sm" variant="primary" disabled={busy || !editText.trim()} onClick={() => saveEdit(c)}>{s.save}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{s.cancel}</Button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-13 text-ink" data-testid="comment-body">
                      {bodyParts(c.body).map((p, i) => p.t === "mention"
                        ? <span key={i} className="rounded-chip bg-accent-soft px-1 font-medium text-accent" data-mention={p.id}>{p.v}</span>
                        : <span key={i}>{p.v}</span>)}
                    </p>
                  )}
                  {editing !== c.id && (c.authorId === viewerId || canModerate) && (
                    <div className="mt-1 flex gap-1">
                      <Button size="sm" variant="ghost" disabled={busy} disabledReason={!mine ? (lock ? s[lock === "windowClosed" ? "lockWindowClosed" : "lockNotAuthor"] : s.composerDisabledNoPerm) : undefined}
                        onClick={() => { setEditing(c.id); setEditText(plainBody(c.body)); setEditPicked([]); }}>{s.edit}</Button>
                      <Button size="sm" variant="ghost" disabled={busy} disabledReason={!mine ? (lock ? s[lock === "windowClosed" ? "lockWindowClosed" : "lockNotAuthor"] : s.composerDisabledNoPerm) : undefined}
                        onClick={() => remove(c)}>{s.delete}</Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p role="alert" className="text-13 text-danger">{error}</p>}
      <div className="grid gap-2">
        <MentionComposer objectType={objectType} objectId={objectId} s={s} value={text} onChange={setText} onPick={(m) => setPicked((p) => [...p, m])} disabled={!canWrite} />
        <div>
          <Button variant="primary" disabled={busy || !text.trim()} disabledReason={!canWrite ? s.composerDisabledNoPerm : undefined} onClick={post}>
            {busy ? s.posting : s.post}
          </Button>
        </div>
      </div>
      <span className="sr-only">{fill(s.followersNote)}</span>
    </section>
  );
}
