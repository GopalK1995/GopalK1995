import Link from "next/link";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { requireActive } from "@/lib/auth/server";
import { emAll, getEmT } from "@/lib/connectors/email/strings";
import { loadAudiences } from "./_lib/audiences";
import { loadEmailView } from "./_lib/view";
import { EmailSettings } from "./_components/email-settings";

export const metadata = { title: "Email sending" };

export default async function EmailSettingsPage() {
  const { t, locale } = await getEmT();
  const res = await loadEmailView();
  const header = <PageHeader title={t("title")} sub={t("sub")} />;
  if (res.status === "denied") {
    return <>{header}<EmptyState title={t("deniedTitle")} body={res.reason === "support" ? t("deniedSupport") : t("deniedBody", { role: res.roleLabel.replace("_", " ") })} /></>;
  }
  if (res.status === "error") {
    return <>{header}<ErrorState source={t("loadErrorSource")} message={t("loadErrorBody")} retry={<Link href="/settings/email"><Button>{t("retry")}</Button></Link>} /></>;
  }
  const { active } = await requireActive();
  const audiences = !res.demo && res.mailchimp && res.mailchimp.status !== "disconnected" ? await loadAudiences(res.mailchimp.id, active.ws.uuid) : [];
  return <>{header}<EmailSettings s={emAll(locale)} demo={res.demo} email={res.email} mailchimp={res.mailchimp} suppressions={res.suppressions} suppressionMissing={res.suppressionMissing} segments={res.segments} audiences={audiences} webhookUrl={res.webhookUrl} /></>;
}
