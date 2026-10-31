import Link from "next/link";
import { ConnectorChip } from "./connector-chip";
import { relTime } from "@/lib/format";
import { Table, th, td } from "@/components/ui/misc";
import type { ConnectorRowView } from "../_lib/types";
import type { T } from "../_lib/strings";

const STALE_MS = 26 * 3600e3;   // freshness ruler: a live source with no sync for 26 h is stale

export function Freshness({ at, now, t }: { at: string | null; now: string; t: T }) {
  if (!at) return <span className="text-ink-3">{t("never")}</span>;
  const stale = Date.parse(now) - new Date(at).getTime() > STALE_MS;
  return <span className={stale ? "text-warn-ink" : "text-ink-2"} data-stale={stale ? "true" : "false"}>{t(stale ? "freshness.stale" : "freshness.fresh", { when: relTime(at, now) })}</span>;
}

export function RealList({ rows, now, t }: { rows: ConnectorRowView[]; now: string; t: T }) {
  return (
    <Table minWidth={760}>
      <caption className="sr-only">{t("title")}</caption>
      <thead><tr className="border-b border-line">
        <th className={th} scope="col">{t("colConnector")}</th><th className={th} scope="col">{t("colCategory")}</th>
        <th className={th} scope="col">{t("colState")}</th><th className={th} scope="col">{t("colLastSync")}</th><th className={th} scope="col"><span className="sr-only">{t("colAction")}</span></th>
      </tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-line" data-connector={r.id}>
            <td className={`${td} font-medium`}>{r.name}</td>
            <td className={`${td} text-ink-2`}>{t(`category.${r.category}`)}</td>
            <td className={td}>
              <span className="inline-flex items-center gap-2">
                <ConnectorChip state={r.chip} label={t(`chip.${r.chip}`)} />
                {(r.chip === "sandbox" || r.chip === "connected" || r.chip === "needs_attention") && <span className="text-12 text-ink-3">{t(r.chip === "sandbox" ? "chipHint.sandbox" : r.chip === "connected" ? "chipHint.connected" : "chipHint.needs_attention")}</span>}
              </span>
            </td>
            <td className={`${td} num`}>{r.connectionId ? <Freshness at={r.lastSyncAt} now={now} t={t} /> : <span className="text-ink-3">{t("never")}</span>}</td>
            <td className={`${td} text-right`}><Link href={`/integrations/${r.id}`} className="text-13 font-medium text-accent-strong hover:underline">{t("open")}</Link></td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
