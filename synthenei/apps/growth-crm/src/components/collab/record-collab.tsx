// Drop-in server component for any record page: <RecordCollab objectType="lead" objectId={id} />.
// Renders follow toggle, comment thread and the record's activity feed, with empty / error / denied states.
// Demo sessions get fixture content and never touch Supabase.
import { EmptyState, ErrorState } from "@/components/ui/states";
import { demoComments, demoFeed, DEMO_PEOPLE } from "@/lib/notify/demo";
import { canUserRead, notifyRepos } from "@/lib/notify/repo";
import { canDo, collabCtx } from "@/lib/notify/session";
import { serviceDb } from "@/lib/db/service";
import { ctAll } from "@/lib/notify/strings";
import type { CommentRow, FeedItem } from "@/lib/notify/types";
import { ActivityFeed, type FeedState } from "./activity-feed";
import { CommentThread } from "./comment-thread";
import { FollowButton } from "./follow-button";

export async function RecordCollab({ objectType, objectId }: { objectType: string; objectId: string }) {
  const s = ctAll();
  const c = await collabCtx();
  const nowIso = new Date().toISOString();

  if (c.demo) {
    const comments = demoComments(objectType, objectId, c.uid);
    const feed: FeedState = { kind: "ok", items: demoFeed(objectType, objectId) };
    return (
      <div className="grid gap-6">
        <div className="flex justify-end"><FollowButton objectType={objectType} objectId={objectId} initial={false} canFollow s={s} /></div>
        <CommentThread objectType={objectType} objectId={objectId} comments={comments} names={{ ...DEMO_PEOPLE, [c.uid]: c.name }} viewerId={c.uid} viewerName={c.name} canWrite canModerate={false} demo s={s} nowIso={nowIso} />
        <ActivityFeed state={feed} names={DEMO_PEOPLE} s={s} title={s.feedTitle} />
      </div>
    );
  }

  let readable = false;
  try { readable = await canUserRead(serviceDb(), c.uid, c.ws, objectType, objectId); } catch { /* treated as an error below */ }
  let comments: CommentRow[] = [];
  let feed: FeedState;
  let names: Record<string, string> = {};
  let following = false;
  let loadFailed = false;
  if (readable) {
    try {
      comments = await notifyRepos.comments.list(c.ws, objectType, objectId);
      following = await notifyRepos.follows.isFollowing(c.uid, objectType, objectId);
    } catch { loadFailed = true; }
    let items: FeedItem[] = [];
    try { items = await notifyRepos.feed.forObject(c.ws, objectType, objectId); feed = { kind: "ok", items }; } catch { feed = { kind: "error" }; }
    try { names = await notifyRepos.names([...comments.map((x) => x.authorId), ...items.map((x) => x.actorId).filter((x): x is string => !!x)]); } catch { /* names degrade to "Someone" */ }
  } else {
    feed = { kind: "denied" };
  }
  const [canWrite, canModerate] = await Promise.all([canDo("comments.write"), canDo("comments.moderate")]);

  return (
    <div className="grid gap-6">
      {readable && !loadFailed && (
        <div className="flex justify-end"><FollowButton objectType={objectType} objectId={objectId} initial={following} canFollow={canWrite && !c.readOnlySupport} s={s} /></div>
      )}
      {!readable ? <EmptyState title={s.commentsDeniedTitle} body={s.commentsDeniedBody} />
        : loadFailed ? <ErrorState source={s.commentsErrorSource} message={s.commentsErrorBody} />
        : <CommentThread objectType={objectType} objectId={objectId} comments={comments} names={names} viewerId={c.uid} viewerName={c.name}
            canWrite={canWrite && !c.readOnlySupport} canModerate={canModerate} demo={false} s={s} nowIso={nowIso} />}
      <ActivityFeed state={feed} names={names} s={s} title={s.feedTitle} />
    </div>
  );
}
