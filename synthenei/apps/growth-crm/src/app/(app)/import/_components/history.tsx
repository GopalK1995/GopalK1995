"use client";
// Import history table. Server-rendered rows are passed in; the table refreshes when an import_jobs change arrives.
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useTableChanges } from "@/lib/realtime/hooks";
import { errorReportUrl } from "../actions";
import type { JobView, ObjectOption } from "../types";

export function HistoryTable({ jobs, objects, demo }: { jobs: JobView[]; objects: ObjectOption[]; demo: boolean }) {
  const t = useTranslations("imports");
  const router = useRouter();
  useTableChanges("import_jobs", () => router.refresh(), { authorize: !demo });
  const label = (k: string) => objects.find((o) => o.key === k)?.label ?? k;
  const when = (s: string) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(new Date(s));
  const report = async (id: string) => { const r = await errorReportUrl(id); if (r.ok && r.data) window.location.assign(r.data.url); };
  if (jobs.length === 0) return <p className="text-13 text-ink-3" data-testid="import-history-empty">{demo ? t("histEmptyDemo") : t("histEmpty")}</p>;
  return (
    <div className="overflow-x-auto rounded-chip border border-line" data-testid="import-history">
      <table className="w-full text-left text-13">
        <thead className="bg-paper-2 text-12 text-ink-3"><tr>{(["colWhen", "colObject", "colStatus", "colRows", "colWritten", "colDuplicates", "colProblems", "colReport"] as const).map((k) => <th key={k} className="px-3 py-2 font-medium">{t(k)}</th>)}</tr></thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id} className="border-t border-line">
              <td className="px-3 py-2 text-ink-2">{when(j.createdAt)}</td>
              <td className="px-3 py-2 text-ink">{label(j.object)}</td>
              <td className="px-3 py-2">{t(`status.${j.status}`)}</td>
              <td className="num px-3 py-2">{j.rowsTotal}</td><td className="num px-3 py-2">{j.rowsOk}</td><td className="num px-3 py-2">{j.rowsDup}</td><td className="num px-3 py-2">{j.rowsInvalid}</td>
              <td className="px-3 py-2">{j.hasReport ? <Button size="sm" variant="ghost" onClick={() => report(j.id)}>{t("downloadErrors")}</Button> : <span className="text-ink-3">{t("noReport")}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
