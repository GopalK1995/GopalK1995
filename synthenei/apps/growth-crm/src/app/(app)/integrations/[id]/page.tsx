import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/misc";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { DemoIntegrationDetail } from "../_demo/demo-detail";
import { RealDetail } from "../_components/real-detail";
import { viewCtx } from "../_lib/ctx";
import { getIntT } from "../_lib/strings";
import { loadDetail } from "../_lib/view";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Integration · ${id}` };
}
export const dynamic = "force-dynamic";

const BANNER: Record<string, string> = { oauth_denied: "oauthDenied", oauth_failed: "oauthFailed", oauth_expired: "oauthExpired", oauth_state: "oauthState", denied: "blocked.permission", redirect_not_allowed: "oauthFailed", wrong_workspace: "oauthFailed", unknown_connector: "err.unknown_connector" };

export default async function IntegrationDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; connected?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const v = await viewCtx();
  if (v.demo) return <DemoIntegrationDetail id={id} />;
  const t = await getIntT();
  if (!v.canRead) return <><PageHeader title={t("title")} /><EmptyState title={t("deniedTitle")} body={t("deniedBody", { role: v.role.replace("_", " ") })} /></>;

  const res = await loadDetail(v.ws, id);
  if (res.status === "not_found") notFound();
  if (res.status === "error") return <><PageHeader title={t("title")} /><ErrorState source={t("errorSource")} message={t("errorBody")} retry={<Link href={`/integrations/${id}`}><Button>{t("retry")}</Button></Link>} /></>;

  const manageBlocked = v.support ? t("blocked.support") : !v.canManage ? t("blocked.permission", { role: v.role.replace("_", " ") }) : null;
  const key = sp.error ? (BANNER[sp.error] ?? (`err.${sp.error}` in {} ? `err.${sp.error}` : "err.generic")) : null;
  return (
    <>
      {key && <p role="alert" className="state-danger mb-4 rounded-control border px-3 py-2 text-13 text-ink">{key.includes(".") && key.startsWith("blocked.") ? t(key, { role: v.role.replace("_", " ") }) : t(key)}</p>}
      <RealDetail v={res.view} t={t} now={new Date().getTime()} ws={v.ws} failed={res.failed} manageBlocked={manageBlocked} />
    </>
  );
}
