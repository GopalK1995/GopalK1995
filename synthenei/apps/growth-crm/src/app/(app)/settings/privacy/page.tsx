import Link from "next/link";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { dueState } from "@/lib/privacy/due";
import { getPrT } from "@/lib/privacy/strings-server";
import { headers } from "next/headers";
import { PublicLinks } from "./_components/public-links";
import { DueChip } from "./_components/due-chip";
import { PrivacyNav } from "./_components/privacy-nav";
import { loadInbox } from "./_lib/view";
import { fmtIstDate } from "@/lib/datetime";
import { pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("privacyRequests");
export const dynamic = "force-dynamic";

// Owner inbox: every request with its due date, oldest due first (overdue on top). The register is never deleted from.
export default async function PrivacyInboxPage() {
  const { t } = await getPrT();
  const res = await loadInbox();
  const header = <PageHeader title={t("owner.title")} sub={t("owner.sub")} />;
  if (res.status === "denied") {
    return <>{header}<EmptyState title={t("owner.deniedTitle")} body={res.reason === "support" ? t("owner.deniedSupport") : t("owner.deniedBody", { role: res.roleLabel.replace("_", " ") })} /></>;
  }
  if (res.status === "error") {
    return <>{header}<ErrorState source={t("owner.loadErrorSource")} message={t("owner.loadErrorBody")} retry={<Link href="/settings/privacy"><Button>{t("owner.retry")}</Button></Link>} /></>;
  }
  const { rows, now } = res;
  // Absolute URLs: what is shown is exactly what works when pasted elsewhere. Falls back to a relative path only if the host is unknown.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const origin = host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : "";
  const open = rows.filter((r) => dueState(r.status, r.dueAt, now) !== "closed");
  const overdue = open.filter((r) => dueState(r.status, r.dueAt, now) === "overdue").length;
  const soon = open.filter((r) => dueState(r.status, r.dueAt, now) === "due_soon").length;
  const fmt = fmtIstDate; // IST, whatever the server zone is
  return (
    <main data-testid="privacy-inbox">
      {header}
      <PrivacyNav t={t} current="requests" />
      {res.demo && <p className="mb-3 text-13 text-ink-3" role="note">{t("owner.demoNotice")}</p>}
      <PublicLinks s={{ copy: t("owner.link.copy"), copied: t("owner.link.copied"), copyFailed: t("owner.link.copyFailed"), open: t("owner.link.open") }} items={[
        { id: "notice", label: t("owner.publicPage"), help: t("owner.publicPageHelp"), url: res.publicPath ? `${origin}${res.publicPath}` : null, missing: t("owner.publicPageNone") },
        { id: "platform", label: t("owner.platformPolicy"), help: t("owner.platformPolicyHelp"), url: `${origin}/legal/privacy` },
      ]} />
      {rows.length === 0 ? <EmptyState title={t("owner.empty")} body={t("owner.emptyBody")} /> : (
        <>
          <p className="mb-2 text-13 text-ink-2" data-testid="inbox-summary">{t("owner.summary", { open: open.length, overdue, soon })}</p>
          <div className="overflow-x-auto rounded-card border border-line bg-surface">
            <table className="w-full min-w-[720px] border-collapse text-13">
              <caption className="sr-only">{t("owner.title")}</caption>
              <thead>
                <tr className="border-b border-line text-left text-12 text-ink-3">
                  <th scope="col" className="h-9 px-3 font-medium">{t("owner.col.kind")}</th>
                  <th scope="col" className="h-9 px-3 font-medium">{t("owner.col.subject")}</th>
                  <th scope="col" className="h-9 px-3 font-medium">{t("owner.col.received")}</th>
                  <th scope="col" className="h-9 px-3 font-medium">{t("owner.col.due")}</th>
                  <th scope="col" className="h-9 px-3 font-medium">{t("owner.col.status")}</th>
                  <th scope="col" className="h-9 px-3"><span className="sr-only">{t("owner.open")}</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0" data-testid="request-row" data-kind={r.kind} data-status={r.status}>
                    <td className="h-10 px-3 font-medium text-ink">{t(`kind.${r.kind}`)}</td>
                    <td className="h-10 px-3 text-ink-2">{r.leadLabel ?? t("owner.noLead")}</td>
                    <td className="num h-10 px-3 text-ink-2">{fmt(r.receivedAt)}</td>
                    <td className="h-10 px-3"><DueChip t={t} status={r.status} dueAt={r.dueAt} now={now} /></td>
                    <td className="h-10 px-3"><Chip tone={r.status === "completed" ? "success" : r.status === "rejected" ? "neutral" : r.status === "in_progress" ? "accent" : "warn"}>{t(`owner.status.${r.status}`)}</Chip></td>
                    <td className="h-10 px-3 text-right"><Link href={`/settings/privacy/${r.id}`} className="text-13 font-medium text-accent underline">{t("owner.open")}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
