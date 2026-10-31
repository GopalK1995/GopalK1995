"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { toast } from "@/components/ui/toast";
import { fmtDateTime } from "@/lib/format";
import type { NotificationRow } from "@/lib/notify/types";
import { objectUrl } from "@/lib/notify/urls";
import { fill, type Strings } from "@/components/collab/strings";
import { markAllRead, markRead } from "../actions";

export function NotificationList({ rows, unreadOnly, demo, s }: { rows: NotificationRow[]; unreadOnly: boolean; demo: boolean; s: Strings }) {
  const router = useRouter();
  const [items, setItems] = useState(rows);
  const [busy, start] = useTransition();
  const visible = unreadOnly ? items.filter((n) => !n.readAt) : items;
  const unread = items.filter((n) => !n.readAt).length;
  const stamp = () => new Date().toISOString();
  const one = (n: NotificationRow) => start(async () => {
    const r = await markRead({ ids: [n.id] });
    if (!r.ok) { toast(r.message, ""); return; }
    setItems((l) => l.map((x) => (x.id === n.id ? { ...x, readAt: stamp() } : x)));
    if (!demo) router.refresh();
  });
  const all = () => start(async () => {
    const r = await markAllRead();
    if (!r.ok) { toast(r.message, ""); return; }
    toast(r.message, r.sub ?? "");
    setItems((l) => l.map((x) => ({ ...x, readAt: x.readAt ?? stamp() })));
    if (!demo) router.refresh();
  });
  const emailQueued = items.some((n) => n.body.email === "queued");

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-12 text-ink-3" aria-live="polite" data-testid="unread-summary">{unread}</span>
        <Button size="sm" variant="quiet" disabled={busy || unread === 0} disabledReason={unread === 0 ? s.notifEmptyUnread : undefined} onClick={all}>{s.markAllRead}</Button>
      </div>
      {emailQueued && <p className="rounded-control border border-line bg-paper-2 px-3 py-2 text-12 text-ink-2" role="status">{s.notifPartialEmail}</p>}
      {visible.length === 0 ? (
        <EmptyState title={unreadOnly ? s.notifEmptyUnread : s.notifEmpty} body={s.notifEmptyBody} />
      ) : (
        <ul className="divide-y divide-line rounded-control border border-line" data-testid="notification-list">
          {visible.map((n) => {
            const href = n.url ?? objectUrl(n.objectType, n.objectId);
            const title = n.title.en ?? n.kind;
            const body = n.body.en;
            return (
              <li key={n.id} className={`flex items-start gap-3 px-3 py-3 ${n.readAt ? "" : "bg-accent-soft/40"}`} data-testid="notification" data-unread={n.readAt ? "false" : "true"}>
                <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-round ${n.readAt ? "bg-line-strong" : "bg-accent"}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-13 font-semibold text-ink">
                    {href ? <Link href={href} className="hover:underline" onClick={() => { if (!n.readAt) one(n); }}>{title}</Link> : title}
                    {!n.readAt && <span className="sr-only"> (unread)</span>}
                  </p>
                  {body && <p className="truncate text-12 text-ink-2">{body}</p>}
                  <p className="num text-12 text-ink-3">
                    {fmtDateTime(n.createdAt)}
                    {n.body.email === "queued" && <> · {n.body.deliverAfter ? fill(s.emailQueuedUntil, { when: fmtDateTime(n.body.deliverAfter) }) : s.emailQueued}</>}
                  </p>
                </div>
                {!n.readAt && <Button size="sm" variant="ghost" disabled={busy} onClick={() => one(n)}>{s.markRead}</Button>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
