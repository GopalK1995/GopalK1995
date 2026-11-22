import Link from "next/link";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { prAll } from "@/lib/privacy/strings";
import { getPrT } from "@/lib/privacy/strings-server";
import { BreachPanel } from "../_components/breach-panel";
import { PrivacyNav } from "../_components/privacy-nav";
import { loadBreaches } from "../_lib/view";

export const metadata = { title: "Breach register" };
export const dynamic = "force-dynamic";

// Breach register: owners only. Setup state when the table is not applied yet (docs/migrations-backlog.md "T052 needs").
export default async function BreachesPage() {
  const { t, locale } = await getPrT();
  const res = await loadBreaches();
  const header = <PageHeader title={t("breach.title")} sub={t("breach.sub")} />;
  if (res.status === "denied") return <>{header}<EmptyState title={t("owner.deniedTitle")} body={res.reason === "support" ? t("owner.deniedSupport") : t("owner.deniedBody", { role: res.roleLabel.replace("_", " ") })} /></>;
  if (res.status === "error") return <>{header}<ErrorState source={t("breach.title")} message={t("owner.loadErrorBody")} retry={<Link href="/settings/privacy/breaches"><Button>{t("owner.retry")}</Button></Link>} /></>;
  return (
    <main data-testid="privacy-breaches">
      {header}
      <PrivacyNav t={t} current="breaches" />
      {res.status === "setup" ? <EmptyState title={t("breach.title")} body={t("breach.setup")} />
        : <>{res.demo && <p className="mb-3 text-13 text-ink-3" role="note">{t("owner.demoNotice")}</p>}<BreachPanel s={prAll(locale)} rows={res.rows} now={res.now} /></>}
    </main>
  );
}
