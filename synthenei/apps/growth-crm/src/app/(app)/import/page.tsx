import { requireActive } from "@/lib/auth/server";
import { loadPrincipal } from "@/lib/authz/load";
import { can } from "@/lib/authz";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { listImportJobs } from "./actions";
import { ExportPanel } from "./_components/export-button";
import { HistoryTable } from "./_components/history";
import { ImportWizard } from "./_components/import-wizard";
import { importT, objectOptions } from "./_lib/server";

export const metadata = { title: "Import and export" };
export const dynamic = "force-dynamic";

const section = "rounded-control border border-line bg-surface p-4";

export default async function ImportPage() {
  const t = await importT();
  const { session, active } = await requireActive();
  const header = <PageHeader title={t("title")} sub={t("subtitle")} />;
  const p = await loadPrincipal();
  const canImport = can(p, "leads.import");
  const canExport = can(p, "leads.export") && !active.support;
  if (!canImport && !canExport) {
    return <main>{header}<EmptyState title={t("deniedTitle")} body={active.support ? t("deniedSupport") : t("deniedBody", { role: active.role.replace("_", " ") })} /></main>;
  }
  const objects = await objectOptions(t);
  const hist = canImport ? await listImportJobs() : null;
  return (
    <main className="space-y-6">
      {header}
      {canImport && (
        <section className={section} aria-labelledby="imp-h"><h2 id="imp-h" className="mb-3 text-15 font-semibold text-ink">{t("tabImport")}</h2>
          <ImportWizard objects={objects} demo={session.demo} /></section>
      )}
      {hist && (
        <section className={section} aria-labelledby="hist-h"><h2 id="hist-h" className="mb-3 text-15 font-semibold text-ink">{t("histTitle")}</h2>
          {hist.ok && hist.data ? <HistoryTable jobs={hist.data} objects={objects} demo={session.demo} /> : <ErrorState source={t("histTitle")} message={t("histLoadError")} />}</section>
      )}
      <section className={section} aria-labelledby="exp-h"><h2 id="exp-h" className="mb-3 text-15 font-semibold text-ink">{t("exportTitle")}</h2>
        {canExport ? <ExportPanel objects={objects} /> : <p className="text-13 text-ink-3" data-testid="export-denied">{active.support ? t("exportSupport") : t("exportDenied")}</p>}</section>
    </main>
  );
}
