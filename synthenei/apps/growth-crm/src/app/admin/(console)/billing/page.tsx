import { PageHeader } from "@/components/ui/misc";
import { ErrorState } from "@/components/ui/states";
import { bt, btAll } from "@/lib/billing/strings";
import { Denied } from "../../_components/denied";
import { roleCan } from "../../_lib/platform-authz";
import { platformCtx } from "../../_lib/platform-session";
import { BillingConsole } from "./_components/billing-console";
import { loadAdminBilling } from "./view";

export const metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

export default async function AdminBillingPage() {
  const { session, role } = await platformCtx();
  const canEdit = roleCan(role, "platform.billing");
  const head = <PageHeader eyebrow="Synthan platform" title={bt("adminTitle")} sub={bt("adminSub")} />;
  // The billing role sees billing only; support and read-only admins may read it, the console never lets them change it.
  if (!canEdit && !roleCan(role, "platform.read")) return <>{head}<Denied title={bt("deniedTitle")}>{bt("adminDenied")}</Denied></>;
  const res = await loadAdminBilling({ uid: session.uid, demo: session.demo === true, canEdit });
  if (!res.ok) return <>{head}<ErrorState source={bt("loadErrorSource")} message={res.error} /></>;
  return <>{head}<BillingConsole view={res.view} strings={btAll()} /></>;
}
