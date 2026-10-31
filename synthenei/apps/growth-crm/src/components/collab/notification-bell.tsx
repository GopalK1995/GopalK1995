"use client";
// Top-bar bell. Server passes the initial unread count; in a real session the count then follows postgres_changes on
// `notifications` filtered to this user (RLS: user_id = auth.uid()). No row data is read from the payload: any change
// triggers a count refetch. Demo sessions never open a connection.
import { createBrowserClient } from "@supabase/ssr";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { badgeLabel, UNREAD_CAP } from "@/lib/notify/badge";
import { fill, type Strings } from "./strings";

export function NotificationBell({ initialCount, userId, workspaceId, demo, s }: {
  initialCount: number; userId: string; workspaceId: string; demo: boolean; s: Strings;
}) {
  const [count, setCount] = useState(initialCount);
  const [live, setLive] = useState(false);
  const client = useRef<ReturnType<typeof createBrowserClient> | null>(null);

  useEffect(() => {
    if (demo) return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;
    const sb = (client.current ??= createBrowserClient(url, key));
    const refetch = async () => {
      const { data, error } = await sb.from("notifications").select("id").eq("user_id", userId).eq("workspace_id", workspaceId).is("read_at", null).limit(UNREAD_CAP);
      if (!error && data) setCount(data.length);
    };
    const ch = sb.channel(`notif:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => { void refetch(); })
      .subscribe((status: string) => setLive(status === "SUBSCRIBED"));
    return () => { void sb.removeChannel(ch); };
  }, [demo, userId, workspaceId]);

  const label = badgeLabel(count);
  return (
    <Link href="/notifications" aria-label={count > 0 ? fill(s.bellLabelUnread, { n: label }) : s.bellLabel}
      title={demo || live ? s.bellLabel : s.bellOffline}
      className="relative inline-grid size-8 place-items-center rounded-control text-ink-2 hover:bg-paper-2 hover:text-ink" data-testid="notification-bell">
      <Bell className="size-[17px]" strokeWidth={1.75} aria-hidden />
      {count > 0 && (
        <span className="num absolute -right-0.5 -top-0.5 min-w-4 rounded-chip bg-danger px-1 text-center text-12 font-semibold leading-4 text-accent-ink" data-testid="unread-count" aria-live="polite">{label}</span>
      )}
    </Link>
  );
}
