import { PageHeader } from "@/components/ui/misc";
import { Denied } from "../../../_components/denied";
import { createTenant } from "../../../_components/actions";
import { roleCan } from "../../../_lib/platform-authz";
import { platformCtx } from "../../../_lib/platform-session";
import { at } from "../../../_lib/strings";
import { NewTenantForm } from "./_components/new-tenant-form";

export const metadata = { title: "Create tenant" };

export default async function NewTenantPage() {
  const { role } = await platformCtx();
  if (!roleCan(role, "platform.tenants.manage")) return <Denied title={at("policyLockedTitle")}>{at("denied")}</Denied>;
  return (
    <>
      <PageHeader eyebrow="Synthan platform" title="Create tenant" sub="Creates the tenant, its first workspace and an Owner invitation in one step. The owner finishes setup in their own onboarding wizard." />
      <NewTenantForm action={createTenant} />
    </>
  );
}
