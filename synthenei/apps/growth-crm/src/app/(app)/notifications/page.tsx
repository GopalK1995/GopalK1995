import Link from "next/link";
import { ActivityFeed, type FeedState } from "@/components/collab/activity-feed";
import { PageHeader } from "@/components/ui/misc";
import { ErrorState } from "@/components/ui/states";
import { demoFeed, DEMO_PEOPLE, demoNotifications } from "@/lib/notify/demo";
import { notifyRepos } from "@/lib/notify/repo";
import { collabCtx } from "@/lib/notify/session";
import { ctAll } from "@/lib/notify/strings";
import type { NotificationRow } from "@/lib/notify/types";
import { NotificationList } from "./_components/notification-list";

export const metadata = { title: "Notifications" };
type SP = { tab?: string; unread?: string };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const s = ctAll();
  const c = await collabCtx();
  const tab = sp.tab === "activity" ? "activity" : "inbox";
  const unreadOnly = sp.unread === "1";
  const tabCls = (on: boolean) => `h-8 border-b-2 px-3 text-14 font-medium ${on ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink"}`;

  const header = (
    <>
      <PageHeader title={s.notifTitle} sub={s.notifSub} />
      <nav aria-label={s.notifTitle} className="mb-4 flex gap-1 border-b border-line">
        <Link href="/notifications" className={tabCls(tab === "inbox")} aria-current={tab === "inbox" ? "page" : undefined}>{s.tabNotifications}</Link>
        <Link href="/notifications?tab=activity" className={tabCls(tab === "activity")} aria-current={tab === "activity" ? "page" : undefined}>{s.tabActivity}</Link>
      </nav>
    </>
  );

  if (tab === "activity") {
    let feed: FeedState; let names: Record<string, string> = {};
    if (c.demo) { feed = { kind: "ok", items: demoFeed("lead", "demo-lead") }; names = DEMO_PEOPLE; }
    else {
      try {
        const items = await notifyRepos.feed.forWorkspace(c.ws, 50);
        feed = { kind: "ok", items };
        names = await notifyRepos.names(items.map((i) => i.actorId).filter((x): x is string => !!x)).catch(() => ({}));
      } catch { feed = { kind: "error" }; }
    }
    return <>{header}<p className="mb-3 text-12 text-ink-3">{s.feedWorkspaceSub}</p><ActivityFeed state={feed} names={names} s={s} title={s.feedWorkspaceTitle} showObject /></>;
  }

  let rows: NotificationRow[];
  try {
    rows = c.demo ? demoNotifications(c.ws, c.uid) : await notifyRepos.notifications.list(c.uid, c.ws, { limit: 100 });
  } catch {
    return <>{header}<ErrorState source={s.notifErrorSource} message={s.notifErrorBody} /></>;
  }
  return (
    <>
      {header}
      <div className="mb-3 flex gap-2 text-12">
        <Link href="/notifications" className={unreadOnly ? "text-ink-3 hover:text-ink" : "font-semibold text-ink"}>All</Link>
        <Link href="/notifications?unread=1" className={unreadOnly ? "font-semibold text-ink" : "text-ink-3 hover:text-ink"}>{s.unreadOnly}</Link>
      </div>
      <NotificationList rows={rows} unreadOnly={unreadOnly} demo={c.demo} s={s} />
    </>
  );
}
