import Link from "next/link";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { wh, whAll } from "../_lib/strings";
import { loadDeliveries } from "../_lib/view";
import { DeliveriesView } from "../_components/deliveries-view";

export const metadata = { title: "Webhook deliveries" };

export default async function DeliveriesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }) {
  const { id } = await params;
  const { status } = await searchParams;
  const res = await loadDeliveries(id, status);
  if (res.status === "denied") {
    return <><PageHeader title={wh("pageTitle")} /><EmptyState title={wh("deniedTitle")} body={res.reason === "support" ? wh("deniedSupport") : wh("deniedBody", { role: res.roleLabel.replace("_", " ") })} /></>;
  }
  if (res.status === "not_found") {
    return <><PageHeader title={wh("pageTitle")} /><EmptyState title={wh("notFound")} action={<Link href="/settings/webhooks"><Button>{wh("back")}</Button></Link>} /></>;
  }
  if (res.status === "error") {
    return <><PageHeader title={wh("pageTitle")} /><ErrorState source={wh("loadErrorSource")} message={wh("logErrorBody")} retry={<Link href={`/settings/webhooks/${id}`}><Button>{wh("retry")}</Button></Link>} /></>;
  }
  const name = (() => { try { return new URL(res.endpoint.url).hostname; } catch { return res.endpoint.url; } })();
  return (
    <>
      <PageHeader title={wh("logTitle", { name })} sub={wh("logSub")} />
      <DeliveriesView demo={res.demo} endpoint={res.endpoint} deliveries={res.deliveries} isOwner={res.isOwner} current={status ?? ""} strings={whAll()} />
    </>
  );
}
