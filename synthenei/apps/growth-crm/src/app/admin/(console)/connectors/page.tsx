import { PageHeader } from "@/components/ui/misc";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { ConnectorMatrix } from "../../_components/connector-matrix";
import { Denied } from "../../_components/denied";
import { saveConnectorCell } from "../../_components/actions";
import { roleCan } from "../../_lib/platform-authz";
import { platformCtx } from "../../_lib/platform-session";
import { at } from "../../_lib/strings";
import { loadConnectorMatrix } from "../../_lib/view";

export const metadata = { title: "Connector availability" };

export default async function ConnectorsPage() {
  const { session, role } = await platformCtx();
  if (!roleCan(role, "platform.read")) return <Denied title={at("policyLockedTitle")}>{role === "billing" ? at("billingOnly") : at("denied")}</Denied>;
  const canEdit = roleCan(role, "platform.policies.manage");
  const loaded = await loadConnectorMatrix(session.demo);
  return (
    <>
      <PageHeader eyebrow="Synthan platform" title="Connector availability" sub="Per environment: disabled stops all vendor calls with no deploy, sandbox sends to test destinations only, live is real. The gate says what is still missing." />
      {!loaded.ok ? <ErrorState source="the connector matrix" message={loaded.error} />
        : !loaded.data.length ? <EmptyState title={at("emptyConnectors")} />
        : (
          <Card>
            <CardHeader title="Matrix" sub={canEdit ? "Changes save as you pick them." : at("connectorLockedBody")} />
            <ConnectorMatrix rows={loaded.data} canEdit={canEdit} action={saveConnectorCell} />
          </Card>
        )}
    </>
  );
}
