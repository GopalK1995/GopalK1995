import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { prAll } from "@/lib/privacy/strings";
import { getPrT } from "@/lib/privacy/strings-server";
import { DueChip } from "../_components/due-chip";
import { RequestActions } from "../_components/request-actions";
import { loadDetail } from "../_lib/view";
import { fmtIstDateTimeZ } from "@/lib/datetime";
import { pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("privacyRequest");
export const dynamic = "force-dynamic";

export default async function PrivacyRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, locale } = await getPrT();
  const res = await loadDetail(id);
  const header = <PageHeader title={t("owner.title")} sub={<Link href="/settings/privacy" className="text-accent underline">{t("detail.back")}</Link>} />;
  if (res.status === "denied") return <>{header}<EmptyState title={t("owner.deniedTitle")} body={res.reason === "support" ? t("owner.deniedSupport") : t("owner.deniedBody", { role: res.roleLabel.replace("_", " ") })} /></>;
  if (res.status === "missing") notFound();
  if (res.status === "error") return <>{header}<ErrorState source={t("owner.loadErrorSource")} message={t("owner.loadErrorBody")} retry={<Link href={`/settings/privacy/${id}`}><Button>{t("owner.retry")}</Button></Link>} /></>;
  const { req, now } = res;
  const fmt = fmtIstDateTimeZ; // received/due moments start legal clocks: show the time and say IST
  return (
    <main className="grid gap-4" data-testid="privacy-request">
      <PageHeader title={t(`kind.${req.kind}`)} sub={<Link href="/settings/privacy" className="text-accent underline">{t("detail.back")}</Link>} />
      {res.demo && <p className="text-13 text-ink-3" role="note">{t("owner.demoNotice")}</p>}
      <section className="grid gap-2 rounded-card border border-line bg-surface p-4" aria-labelledby="facts-h">
        <h2 id="facts-h" className="text-15 font-semibold text-ink">{t("detail.facts")}</h2>
        <dl className="grid gap-2 text-13 sm:grid-cols-2">
          <div><dt className="text-ink-3">{t("owner.col.status")}</dt><dd><Chip tone={req.status === "completed" ? "success" : req.status === "in_progress" ? "accent" : req.status === "rejected" ? "neutral" : "warn"}>{t(`owner.status.${req.status}`)}</Chip></dd></div>
          <div><dt className="text-ink-3">{t("owner.col.due")}</dt><dd><DueChip t={t} status={req.status} dueAt={req.dueAt} now={now} /></dd></div>
          <div><dt className="text-ink-3">{t("owner.col.received")}</dt><dd className="num text-ink">{fmt(req.receivedAt)}</dd></div>
          <div><dt className="text-ink-3">{t("detail.linkedLead")}</dt><dd className="text-ink">
            {req.leadId ? (res.demo ? (req.leadLabel ?? t("owner.noLead")) : <Link href={`/leads/${req.leadId}`} className="text-accent underline">{req.leadLabel ?? t("detail.openLead")}</Link>) : t("owner.noLead")}
          </dd></div>
        </dl>
        <h3 className="mt-2 text-13 font-medium text-ink">{t("detail.notes")}</h3>
        {req.notes ? <p className="whitespace-pre-line text-13 text-ink-2" data-testid="request-notes">{req.notes}</p> : <p className="text-13 text-ink-3">{t("detail.noNotes")}</p>}
      </section>
      <RequestActions s={prAll(locale)} id={req.id} kind={req.kind} status={req.status} leadId={req.leadId} subject={req.leadLabel ?? t("owner.noLead")} canErase={res.canErase} demo={res.demo} />
    </main>
  );
}
