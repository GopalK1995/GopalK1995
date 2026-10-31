// Activity feed list (ledger zone: 40 px rows, 12 px type). Presentational; the loaders pass states explicitly.
import Link from "next/link";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { fmtDateTime } from "@/lib/format";
import { objectUrl } from "@/lib/notify/urls";
import type { FeedItem } from "@/lib/notify/types";
import { fill, type Strings } from "./strings";

const humanise = (t: string) => { const s = t.replace(/[._]/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };

export type FeedState = { kind: "ok"; items: FeedItem[] } | { kind: "error" } | { kind: "denied" };

export function ActivityFeed({ state, names, s, title, showObject }: { state: FeedState; names: Record<string, string>; s: Strings; title: string; showObject?: boolean }) {
  return (
    <section aria-labelledby="collab-feed" className="grid gap-2">
      <h2 id="collab-feed" className="text-15 font-bold tracking-[-0.015em] text-ink">{title}</h2>
      {state.kind === "error" ? <ErrorState source={s.feedTitle} message={s.feedErrorBody} />
        : state.kind === "denied" ? <EmptyState title={s.commentsDeniedTitle} body={s.feedDeniedBody} />
        : state.items.length === 0 ? <EmptyState title={s.feedEmpty} body={s.feedEmptyBody} />
        : (
          <ol className="divide-y divide-line rounded-control border border-line" data-testid="activity-feed">
            {state.items.map((e) => {
              const who = e.actorId ? names[e.actorId] ?? "Someone" : s.feedSystem;
              const href = showObject ? objectUrl(e.objectType, e.objectId) : null;
              return (
                <li key={e.id} className="flex h-10 items-center gap-3 px-3 text-12">
                  <time className="num w-32 shrink-0 text-ink-3" dateTime={e.occurredAt}>{fmtDateTime(e.occurredAt)}</time>
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {href ? <Link href={href} className="font-semibold hover:underline">{humanise(e.type)}</Link> : <span className="font-semibold">{humanise(e.type)}</span>}
                    <span className="text-ink-3"> {fill(s.feedBy, { name: who })}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
    </section>
  );
}
