import Link from "next/link";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { ALL_SCOPES } from "@/lib/api/scopes";
import { ROLE_LABEL } from "@/lib/auth/roles";
import type { Role } from "@/lib/data/types";
import { ak, akAll } from "./_lib/strings";
import { loadKeys } from "./_lib/view";
import { KeysView } from "./_components/keys-view";

export const metadata = { title: "API keys" };

export default async function ApiKeysPage() {
  const res = await loadKeys();
  const header = <PageHeader title={ak("pageTitle")} sub={ak("pageSub")} />;
  if (res.status === "denied") {
    return <>{header}<EmptyState title={ak("deniedTitle")} body={res.reason === "support" ? ak("deniedSupport") : ak("deniedBody", { role: res.roleLabel.replace("_", " ") })} /></>;
  }
  if (res.status === "error") {
    return <>{header}<ErrorState source={ak("loadErrorSource")} message={ak("loadErrorBody")} retry={<Link href="/settings/api-keys"><Button>{ak("retry")}</Button></Link>} /></>;
  }
  const roles = res.creatableRoles.map((r) => ({ value: r, label: ROLE_LABEL[r as Role] ?? r }));
  return <>{header}<KeysView demo={res.demo} keys={res.keys} roles={roles} scopes={ALL_SCOPES} strings={akAll()} /></>;
}
