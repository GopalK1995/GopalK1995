import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { bt, btAll } from "@/lib/billing/strings";
import { loadOwnerBilling } from "./_lib/view";
import { BillingView } from "./_components/billing-view";

export const metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const res = await loadOwnerBilling();
  const header = <PageHeader title={bt("pageTitle")} sub={bt("pageSub")} />;
  if (res.status === "denied") return <>{header}<EmptyState title={bt("deniedTitle")} body={res.reason === "support" ? bt("deniedSupport") : bt("deniedBody")} /></>;
  if (res.status === "error") return <>{header}<ErrorState source={bt("loadErrorSource")} message={bt("loadErrorBody")} retry={<Link href="/settings/billing"><Button>{bt("retry")}</Button></Link>} /></>;
  return <>{header}<BillingView view={res.view} strings={btAll()} /></>;
}
