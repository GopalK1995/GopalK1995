import Link from "next/link";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { wh, whAll } from "./_lib/strings";
import { loadEndpoints } from "./_lib/view";
import { WebhooksView } from "./_components/webhooks-view";

export const metadata = { title: "Webhooks" };

export default async function WebhooksPage() {
  const res = await loadEndpoints();
  const header = <PageHeader title={wh("pageTitle")} sub={wh("pageSub")} />;
  if (res.status === "denied") {
    return <>{header}<EmptyState title={wh("deniedTitle")} body={res.reason === "support" ? wh("deniedSupport") : wh("deniedBody", { role: res.roleLabel.replace("_", " ") })} /></>;
  }
  if (res.status === "error") {
    return <>{header}<ErrorState source={wh("loadErrorSource")} message={wh("loadErrorBody")} retry={<Link href="/settings/webhooks"><Button>{wh("retry")}</Button></Link>} /></>;
  }
  return <>{header}<WebhooksView demo={res.demo} endpoints={res.endpoints} events={res.events} policyOff={res.policyOff} mayPii={res.mayPii} strings={whAll()} /></>;
}
