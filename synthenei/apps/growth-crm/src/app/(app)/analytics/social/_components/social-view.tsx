"use client";
// Social page body: post timeline strip (mark height = reach, colour = kind, direct labels), sortable ledger, followers + reach trend on one
// shared axis, and a per-post sheet with its daily curve. Unknown metrics render "Not reported", never 0.
import { useMemo, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { LineTrend } from "@/components/charts/line-trend";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { fmtDate, fmtDateY, num, pct } from "@/lib/format";
import type { PostKind } from "@/lib/connectors/meta/organic/types";
import type { SocialPostView, SocialView } from "@/lib/connectors/meta/organic/view";
import { refreshSocialNow } from "../actions";

const KIND_COLOR: Record<PostKind, string> = { feed: "var(--chart-1)", reel: "var(--chart-2)", story: "var(--chart-3)", carousel: "var(--chart-4)", video: "var(--chart-5)" };
type SortKey = "postedAt" | "reach" | "impressions" | "likes" | "comments" | "shares" | "saves" | "engagement";
const valueOf = (p: SocialPostView, k: SortKey): number | string | null => (k === "postedAt" ? p.postedAt : k === "engagement" ? p.engagement : p.metrics[k]);

export function SocialBody({ view, canManage }: { view: SocialView; canManage: boolean }) {
  const t = useTranslations("social");
  const [open, setOpen] = useState<SocialPostView | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "postedAt", dir: -1 });
  const [pending, start] = useTransition();
  const n = (v: number | null) => (v === null ? <span className="text-ink-3">{t("notReported")}</span> : num(v));
  const kindLabel = (k: PostKind) => t(`kind${k[0]!.toUpperCase()}${k.slice(1)}`);
  const platformLabel = (p: string) => t(p === "instagram" ? "platformInstagram" : "platformFacebook");

  const rows = useMemo(() => [...view.posts].sort((a, b) => {
    const x = valueOf(a, sort.key), y = valueOf(b, sort.key);
    if (x === null && y === null) return 0;
    if (x === null) return 1;   // unknown always sorts last, whichever direction
    if (y === null) return -1;
    return (typeof x === "string" ? x.localeCompare(String(y)) : x - Number(y)) * sort.dir;
  }), [view.posts, sort]);

  const refresh = () => start(async () => {
    if (!view.connectionId) return;
    const r = await refreshSocialNow(view.connectionId);
    toast(r.ok ? r.message : r.message || t("refreshFailed"), r.ok ? r.sub ?? "" : "");
  });

  const cols: { key: SortKey; label: string }[] = [
    { key: "reach", label: t("colReach") }, { key: "impressions", label: t("colImpressions") }, { key: "likes", label: t("colLikes") }, { key: "comments", label: t("colComments") },
    { key: "shares", label: t("colShares") }, { key: "saves", label: t("colSaves") }, { key: "engagement", label: t("colEngagement") },
  ];
  const sortBtn = (key: SortKey, label: string) => (
    <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))} className="inline-flex items-center gap-1 hover:text-ink">
      {label}<span aria-hidden className="text-[10px]">{sort.key === key ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
    </button>
  );
  const ariaSort = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none");

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-13 text-ink-2">
        <span>{view.lastSyncedAt ? t("lastSynced", { when: fmtDateY(view.lastSyncedAt) }) : t("neverSynced")} · {t("syncEvery")}</span>
        {!view.demo && view.connectionId && (
          <Button variant="quiet" size="sm" onClick={refresh} disabled={pending || !canManage} disabledReason={canManage ? undefined : t("deniedBody")} aria-busy={pending}>
            <RefreshCw className={pending ? "animate-spin" : ""} aria-hidden />{t("refresh")}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader title={t("timelineTitle")} sub={t("timelineHelp")} />
        <CardBody><Timeline posts={view.posts} onOpen={setOpen} kindLabel={kindLabel} label={(c, f, to) => t("timelineLabel", { count: c, from: f, to })} /></CardBody>
      </Card>

      {view.trend.length > 1 && (
        <Card>
          <CardHeader title={t("trendTitle")} sub={t("trendHelp")} />
          <CardBody>
            <LineTrend label={t("trendTitle")} xKey="date" yFormat="numCompact" height={220}
              data={view.trend.map((d) => ({ date: d.day, followers: d.followers, reach: d.reach }))}
              series={[{ key: "followers", label: t("trendFollowers"), color: "var(--chart-1)" }, { key: "reach", label: t("trendReach"), color: "var(--chart-3)", dashed: true }]} />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={t("ledgerTitle")} sub={view.synced.total ? `${view.synced.done}/${view.synced.total}` : undefined} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-12">
            <thead>
              <tr className="border-b border-line text-left text-12 font-medium uppercase tracking-[0.05em] text-ink-3">
                <th className="h-9 px-3">{t("colPost")}</th>
                <th className="h-9 px-3">{t("colKind")}</th>
                <th className="h-9 px-3" aria-sort={ariaSort("postedAt")}>{sortBtn("postedAt", t("colPosted"))}</th>
                {cols.map((c) => <th key={c.key} className="h-9 px-3 text-right" aria-sort={ariaSort(c.key)}>{sortBtn(c.key, c.label)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0 hover:bg-paper-2">
                  <td className="max-w-[260px] px-3 py-2">
                    <button type="button" onClick={() => setOpen(p)} className="block w-full truncate text-left font-medium text-ink hover:underline" data-cy="social-post">{p.caption || `${kindLabel(p.kind)} · ${fmtDate(p.postedAt)}`}</button>
                    <span className="text-12 text-ink-3">{platformLabel(p.platform)} · {p.accountName}{p.status === "expired" && p.kind === "story" ? ` · ${t("statusExpired")}` : ""}</span>
                  </td>
                  <td className="px-3"><span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full" style={{ background: KIND_COLOR[p.kind] }} />{kindLabel(p.kind)}</span></td>
                  <td className="whitespace-nowrap px-3">{fmtDate(p.postedAt)}</td>
                  <td className="px-3 text-right num">{n(p.metrics.reach)}</td>
                  <td className="px-3 text-right num">{n(p.metrics.impressions)}</td>
                  <td className="px-3 text-right num">{n(p.metrics.likes)}</td>
                  <td className="px-3 text-right num">{n(p.metrics.comments)}</td>
                  <td className="px-3 text-right num">{n(p.metrics.shares)}</td>
                  <td className="px-3 text-right num">{n(p.metrics.saves)}</td>
                  <td className="px-3 text-right num">{p.engagement === null ? <span className="text-ink-3">{t("notReported")}</span> : pct(p.engagement, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Sheet open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        {open && (
          <SheetContent title={open.caption || kindLabel(open.kind)} description={`${platformLabel(open.platform)} · ${fmtDateY(open.postedAt)}`}>
            <div className="grid gap-4">
              <h3 className="text-13 font-bold text-ink">{t("sheetCurve")}</h3>
              {open.series.some((s) => s.reach !== null) ? (
                <>
                  <p className="text-12 text-ink-2">{t("sheetCurveHelp")}</p>
                  <LineTrend label={t("sheetCurve")} xKey="date" yFormat="numCompact" height={180}
                    data={open.series.map((s) => ({ date: s.day, reach: s.reach, impressions: s.impressions }))}
                    series={[{ key: "reach", label: t("colReach"), color: "var(--chart-1)" }, { key: "impressions", label: t("colImpressions"), color: "var(--chart-3)", dashed: true }]} />
                </>
              ) : <p className="text-13 text-ink-2">{t("sheetNoCurve")}</p>}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-13">
                {([["colReach", open.metrics.reach], ["colImpressions", open.metrics.impressions], ["colLikes", open.metrics.likes], ["colComments", open.metrics.comments], ["colShares", open.metrics.shares], ["colSaves", open.metrics.saves]] as const).map(([k, v]) => (
                  <div key={k}><dt className="text-12 text-ink-3">{t(k)}</dt><dd className="num font-medium">{n(v)}</dd></div>
                ))}
              </dl>
              {open.permalink && <a href={open.permalink} target="_blank" rel="noopener noreferrer" className="text-13 font-medium text-accent hover:underline">{t("openPost", { platform: platformLabel(open.platform) })}</a>}
            </div>
          </SheetContent>
        )}
      </Sheet>
    </div>
  );
}

/** One mark per post on a date axis. Height = reach (unknown reach = hairline on the baseline), colour = kind, top three labelled directly. */
function Timeline({ posts, onOpen, kindLabel, label }: { posts: SocialPostView[]; onOpen: (p: SocialPostView) => void; kindLabel: (k: PostKind) => string; label: (count: number, from: string, to: string) => string }) {
  const W = 900, H = 190, PAD = { l: 8, r: 8, t: 28, b: 26 }, ih = H - PAD.t - PAD.b, iw = W - PAD.l - PAD.r;
  if (!posts.length) return null;
  const ts = posts.map((p) => Date.parse(p.postedAt)), min = Math.min(...ts), max = Math.max(...ts), span = Math.max(1, max - min);
  const maxReach = Math.max(1, ...posts.map((p) => p.metrics.reach ?? 0));
  const x = (v: number) => PAD.l + ((v - min) / span) * iw;
  const top = new Set([...posts].filter((p) => p.metrics.reach !== null).sort((a, b) => (b.metrics.reach ?? 0) - (a.metrics.reach ?? 0)).slice(0, 3).map((p) => p.id));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * span);
  const kinds = [...new Set(posts.map((p) => p.kind))];
  return (
    <div>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-12 text-ink-2">
        {kinds.map((k) => <li key={k} className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-full" style={{ background: KIND_COLOR[k] }} />{kindLabel(k)}</li>)}
      </ul>
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={label(posts.length, fmtDate(new Date(min).toISOString()), fmtDate(new Date(max).toISOString()))} className="h-auto w-full">
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--line-strong)" />
        {ticks.map((tk, i) => <text key={i} x={x(tk)} y={H - 8} fontSize={11} fill="var(--ink-3)" textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}>{fmtDate(new Date(tk).toISOString())}</text>)}
        {posts.map((p) => {
          const h = p.metrics.reach === null ? 2 : Math.max(3, (p.metrics.reach / maxReach) * ih), cx = x(Date.parse(p.postedAt)), y = H - PAD.b - h;
          return (
            <g key={p.id} role="button" tabIndex={0} aria-label={`${kindLabel(p.kind)}, ${fmtDate(p.postedAt)}, ${p.metrics.reach === null ? "reach not reported" : `reach ${num(p.metrics.reach)}`}`}
              onClick={() => onOpen(p)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(p); } }} className="cursor-pointer outline-none" data-cy="social-mark">
              <rect x={cx - 8} y={PAD.t} width={16} height={ih} fill="transparent" />
              <rect x={cx - 4} y={y} width={8} height={h} rx={2} fill={KIND_COLOR[p.kind]} opacity={p.metrics.reach === null ? 0.5 : 1} />
              {top.has(p.id) && <text x={cx} y={y - 6} fontSize={11} fontWeight={600} fill="var(--ink-2)" textAnchor="middle" className="num">{num(p.metrics.reach ?? 0)}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
