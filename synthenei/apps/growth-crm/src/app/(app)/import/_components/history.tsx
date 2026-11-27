"use client";
// Import history table. Server-rendered rows are passed in; the table refreshes when an import_jobs change arrives.
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { DataGrid, type DataGridColumn } from "@/components/ui/data-grid";
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
  const col = (id: string, key: "colWhen" | "colObject" | "colStatus" | "colRows" | "colWritten" | "colDuplicates" | "colProblems" | "colReport", cell: DataGridColumn<JobView>["cell"], align?: "right"): DataGridColumn<JobView> => ({ id, header: t(key), label: t(key), cell, align });
  const cols: DataGridColumn<JobView>[] = [
    col("when", "colWhen", (j) => <span className="text-ink-2">{when(j.createdAt)}</span>),
    col("object", "colObject", (j) => label(j.object)),
    col("status", "colStatus", (j) => t(`status.${j.status}`)),
    col("rows", "colRows", (j) => j.rowsTotal, "right"),
    col("written", "colWritten", (j) => j.rowsOk, "right"),
    col("dup", "colDuplicates", (j) => j.rowsDup, "right"),
    col("invalid", "colProblems", (j) => j.rowsInvalid, "right"),
    col("report", "colReport", (j) => (j.hasReport ? <Button size="sm" variant="ghost" onClick={() => report(j.id)}>{t("downloadErrors")}</Button> : <span className="text-ink-3">{t("noReport")}</span>)),
  ];
  return (
    <div className="rounded-chip border border-line" data-testid="import-history">
      <DataGrid rows={jobs} columns={cols} rowId={(j) => j.id} caption={t("histCaption")} responsive="stack" minWidth={720} />
    </div>
  );
}
