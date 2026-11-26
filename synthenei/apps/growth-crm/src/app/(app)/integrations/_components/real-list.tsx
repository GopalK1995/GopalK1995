import Link from "next/link";
import { ConnectorChip } from "./connector-chip";
import { relTime } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Table, th, td } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import type { ConnectorRowView } from "../_lib/types";
import type { T } from "../_lib/strings";

const STALE_MS = 26 * 3600e3;   // freshness ruler: a live source with no sync for 26 h is stale
/** The connector behind the "Instagram and Facebook" entry. */
const META = "meta-ads";
/** Only a connection that exists and is not parked can be "stale"; a never-connected or disconnected row has no sync to judge (UXA-018). */
const SYNCING = new Set(["connected", "sandbox", "needs_attention", "error"]);
/** 44 px touch target on a phone, the compact control from md up. */
const tall = "h-11 md:h-8";

export function Freshness({ at, now, t }: { at: string | null; now: string; t: T }) {
  if (!at) return <span className="text-ink-3">{t("never")}</span>;
  const stale = Date.parse(now) - new Date(at).getTime() > STALE_MS;
  return <span className={stale ? "text-warn-ink" : "text-ink-2"} data-stale={stale ? "true" : "false"}>{t(stale ? "freshness.stale" : "freshness.fresh", { when: relTime(at, now) })}</span>;
}

const hint = (r: ConnectorRowView) => (r.chip === "sandbox" ? "chipHint.sandbox" : r.chip === "connected" ? "chipHint.connected" : r.chip === "needs_attention" ? "chipHint.needs_attention" : null);
const showSync = (r: ConnectorRowView) => !!r.connectionId && SYNCING.has(r.chip);

/** Plain-language state of the Instagram and Facebook entry, so the list says what to do next, not just a chip. */
function metaNeed(r: ConnectorRowView): string {
  switch (r.chip) {
    case "connected": case "sandbox": return "meta.listNeed.connected";
    case "needs_attention": case "error": return "meta.listNeed.reconnect";
    case "available": case "disconnected": return "meta.listNeed.connect";
    default: return "meta.listNeed.blocked";
  }
}

/** The obvious front door for Instagram and Facebook: plain description, status and a Connect button (AUD-127 / UXA-016). */
export function MetaFeatured({ r, now, t }: { r: ConnectorRowView; now: string; t: T }) {
  const idle = r.chip === "available" || r.chip === "disconnected";
  return (
    <Card className="mb-4 p-4 sm:p-5" data-testid="meta-featured" data-connector={r.id}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-[16px] font-semibold leading-6 text-ink">{t("meta-ads.name")}</h2>
            <ConnectorChip state={r.chip} label={t(`chip.${r.chip}`)} />
          </div>
          <p className="mt-1 max-w-2xl text-13 text-ink-2">{t("meta-ads.blurb")}</p>
          <p className="mt-1 text-13 font-medium text-ink" data-testid="meta-need">{t(metaNeed(r))}</p>
          {showSync(r) && <p className="mt-0.5 text-12 text-ink-3">{t("colLastSync")}: <Freshness at={r.lastSyncAt} now={now} t={t} /></p>}
        </div>
        <Link href={`/integrations/${r.id}`} className={cn(buttonVariants({ variant: idle || r.chip === "needs_attention" || r.chip === "error" ? "primary" : "quiet" }), tall, "shrink-0 self-stretch sm:self-auto")}>
          {t(idle ? "meta.listButtonConnect" : "meta.listButtonManage")}
        </Link>
      </div>
    </Card>
  );
}

export function RealList({ rows, now, t }: { rows: ConnectorRowView[]; now: string; t: T }) {
  const meta = rows.find((r) => r.id === META);
  const rest = rows.filter((r) => r.id !== META);
  return (
    <>
      {meta && <MetaFeatured r={meta} now={now} t={t} />}
      {/* Phone: one card per connector (no sideways scrolling, 44 px open button). From md up: the table. */}
      <ul className="grid gap-3 md:hidden" data-testid="list-cards">
        {rest.map((r) => (
          <li key={r.id} data-connector={r.id} className="rounded-control border border-line bg-surface p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-13 font-medium text-ink">{r.name}</p>
                <p className="text-12 text-ink-3">{t(`category.${r.category}`)}</p>
              </div>
              <ConnectorChip state={r.chip} label={t(`chip.${r.chip}`)} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="min-w-0 text-12 text-ink-2">{showSync(r) ? <><span className="text-ink-3">{t("colLastSync")}: </span><Freshness at={r.lastSyncAt} now={now} t={t} /></> : <span className="text-ink-3">{t("never")}</span>}</span>
              <Link href={`/integrations/${r.id}`} aria-label={t("openFull", { name: r.name })} className={cn(buttonVariants({ variant: "quiet" }), tall, "shrink-0")}>{t("open")}</Link>
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden md:block" data-testid="list-table">
        <Table minWidth={760}>
          <caption className="sr-only">{t("title")}</caption>
          <thead><tr className="border-b border-line">
            <th className={th} scope="col">{t("colConnector")}</th><th className={th} scope="col">{t("colCategory")}</th>
            <th className={th} scope="col">{t("colState")}</th><th className={th} scope="col">{t("colLastSync")}</th><th className={th} scope="col"><span className="sr-only">{t("colAction")}</span></th>
          </tr></thead>
          <tbody>
            {rest.map((r) => (
              <tr key={r.id} className="border-b border-line" data-connector={r.id}>
                <td className={`${td} font-medium`}>{r.name}</td>
                <td className={`${td} text-ink-2`}>{t(`category.${r.category}`)}</td>
                <td className={td}>
                  <span className="inline-flex items-center gap-2">
                    <ConnectorChip state={r.chip} label={t(`chip.${r.chip}`)} />
                    {hint(r) && <span className="text-12 text-ink-3">{t(hint(r)!)}</span>}
                  </span>
                </td>
                <td className={`${td} num`}>{showSync(r) ? <Freshness at={r.lastSyncAt} now={now} t={t} /> : <span className="text-ink-3">{t("never")}</span>}</td>
                <td className={`${td} text-right`}><Link href={`/integrations/${r.id}`} aria-label={t("openFull", { name: r.name })} className="text-13 font-medium text-accent-strong hover:underline">{t("open")}</Link></td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </>
  );
}
