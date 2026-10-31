import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState, PartialState } from "@/components/ui/states";
import { DemoIntegrationsList } from "./_demo/demo-list";
import { RealList } from "./_components/real-list";
import { viewCtx } from "./_lib/ctx";
import { getIntT } from "./_lib/strings";
import { loadList } from "./_lib/view";

export const metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

/** Demo keeps the showcase screens (sample data, no database). Real sessions get the catalogue-driven, truthful screens. */
export default async function IntegrationsPage() {
  const v = await viewCtx();
  if (v.demo) return <DemoIntegrationsList />;
  const t = await getIntT();
  const header = <PageHeader title={t("title")} sub={t("subtitle")} />;
  if (!v.canRead) return <>{header}<EmptyState title={t("deniedTitle")} body={t("deniedBody", { role: v.role.replace("_", " ") })} /></>;

  const res = await loadList(v.ws, v.vertical);
  if (res.status === "error") return <>{header}<ErrorState source={t("errorSource")} message={t("errorBody")} retry={<Link href="/integrations"><Button>{t("retry")}</Button></Link>} /></>;
  if (res.rows.length === 0) return <>{header}<EmptyState title={t("emptyTitle")} body={t("emptyBody")} /></>;
  const sources = [["availability", t("partialAvailability")], ["connections", t("partialConnections")]] as const;
  return (
    <>
      {header}
      {res.failed.length > 0 && <div className="mb-4"><PartialState done={sources.length - res.failed.length} total={sources.length} noun={t("partialNoun")} items={sources.map(([k, label]) => ({ label, status: res.failed.includes(k) ? "failed" as const : "ok" as const }))} /></div>}
      <RealList rows={res.rows} now={new Date().getTime()} t={t} />
    </>
  );
}
