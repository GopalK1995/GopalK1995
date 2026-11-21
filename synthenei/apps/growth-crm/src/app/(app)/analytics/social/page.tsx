import Link from "next/link";
import { getT } from "@/i18n/server";
import { loadPrincipal } from "@/lib/authz/load";
import { can } from "@/lib/authz";
import { loadSocialView } from "@/lib/connectors/meta/organic/read";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, PartialState } from "@/components/ui/states";
import { AssetPicker } from "./_components/asset-picker";
import { SocialBody } from "./_components/social-view";

export const metadata = { title: "Social" };
export const dynamic = "force-dynamic";

export default async function SocialPage() {
  const [t, view, principal] = await Promise.all([getT("social"), loadSocialView(), loadPrincipal()]);
  const canManage = can(principal, "integrations.manage");
  const integrations = <Link href="/integrations/meta-ads"><Button variant="primary">{t("connectCta")}</Button></Link>;
  const head = <PageHeader eyebrow={t("eyebrow")} title={t("title")} sub={t("sub")} />;

  switch (view.state) {
    case "permission_denied":
      return <>{head}<EmptyState title={t("deniedTitle")} body={t("deniedBody")} /></>;
    case "error":
      return <>{head}<ErrorState source={view.errorSource ?? t("title")} message={t("errorMessage")} /></>;
    case "not_connected":
      return <>{head}<EmptyState title={t("notConnectedTitle")} body={t("notConnectedBody")} action={integrations} /></>;
    case "needs_vendor_approval":
      return <>{head}<EmptyState title={t("approvalTitle")} body={<>{t("approvalBody")}{view.missingScopes.length ? <> {t("approvalMissing", { list: view.missingScopes.join(", ") })}</> : null}</>} /></>;
    case "empty":
      return <>{head}<div className="grid gap-4"><EmptyState title={t("emptyTitle")} body={t("emptyBody")} />{canManage && view.connectionId && !view.demo ? <AssetPicker connectionId={view.connectionId} /> : null}</div></>;
    default:
      return (
        <>
          {head}
          <div className="grid gap-4">
            {view.demo && <div role="note" className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-ink-3/60 bg-surface px-4 py-3 text-13 text-ink-2"><StatusChip status="showcase" /><span>{t("sampleBand")}</span></div>}
            {view.state === "needs_attention" && (
              <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-warn/50 bg-surface px-4 py-3 text-13 text-ink-2">
                <span className="font-medium text-warn-ink">{t("attentionTitle")}</span><span>{t("attentionBody")}</span>
                <Link href="/integrations/meta-ads" className="font-medium text-accent hover:underline">{t("reconnectCta")}</Link>
              </div>
            )}
            {view.synced.total > 0 && view.synced.done < view.synced.total && (
              <PartialState done={view.synced.done} total={view.synced.total} noun={t("partialNoun")} items={[{ label: t("partialLabel"), status: "pending" }]} />
            )}
            <SocialBody view={view} canManage={canManage} />
          </div>
        </>
      );
  }
}
