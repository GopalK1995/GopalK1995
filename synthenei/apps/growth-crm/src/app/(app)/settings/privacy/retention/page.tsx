import Link from "next/link";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { prAll } from "@/lib/privacy/strings";
import { getPrT } from "@/lib/privacy/strings-server";
import { PrivacyNav } from "../_components/privacy-nav";
import { RetentionPanel } from "../_components/retention-panel";
import { loadRetention } from "../_lib/view";
import { pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("retention");
export const dynamic = "force-dynamic";

export default async function RetentionPage() {
  const { t, locale } = await getPrT();
  const res = await loadRetention();
  const header = <PageHeader title={t("retention.title")} sub={t("retention.sub")} />;
  if (res.status === "denied") return <>{header}<EmptyState title={t("owner.deniedTitle")} body={res.reason === "support" ? t("owner.deniedSupport") : t("owner.deniedBody", { role: res.roleLabel.replace("_", " ") })} /></>;
  if (res.status === "error") return <>{header}<ErrorState source={t("retention.title")} message={t("owner.loadErrorBody")} retry={<Link href="/settings/privacy/retention"><Button>{t("owner.retry")}</Button></Link>} /></>;
  return (
    <main data-testid="privacy-retention">
      {header}
      <PrivacyNav t={t} current="retention" />
      {res.demo && <p className="mb-3 text-13 text-ink-3" role="note">{t("retention.demoRows")} {t("owner.demoNotice")}</p>}
      <RetentionPanel s={prAll(locale)} rules={res.rules} job={res.job} />
    </main>
  );
}
