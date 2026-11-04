import Link from "next/link";
import { PageHeader } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { requireActive } from "@/lib/auth/server";
import { can } from "@/lib/authz";
import { loadPrincipal } from "@/lib/authz/load";
import { getEffectiveConfig } from "@/lib/config/resolve";
import { pipelinesFromConfig, type Pipeline } from "@/lib/metadata/pipelines";
import * as repo from "@/lib/metadata/pipelines-repo";
import { withVocabLabels } from "@/lib/metadata/pipelines-load";
import { PT } from "@/lib/metadata/pipelines-strings";
import { vocabFor } from "@/lib/vertical";
import { PipelinesView } from "./_components/pipelines-view";

export const metadata = { title: "Pipelines" };

export default async function PipelinesSettingsPage({ searchParams }: { searchParams: Promise<{ pipeline?: string; object?: string }> }) {
  const { session, active } = await requireActive();
  const header = <PageHeader title={PT.pageTitle} sub={PT.pageSub} />;
  const principal = await loadPrincipal();
  if (!can(principal, "pipelines.manage")) {
    return <>{header}<EmptyState title={PT.denied} body={active.support ? PT.deniedSupport : "Ask a workspace administrator to change stages."} /></>;
  }
  try {
    const sp = await searchParams;
    const demo = session.demo === true;
    const cfg = await getEffectiveConfig(active.tenant.id);
    const load = async (type: "lead" | "deal"): Promise<Pipeline[]> => {
      if (demo) return pipelinesFromConfig(cfg, type);
      const rows = await repo.listPipelines(active.ws.uuid, type);
      const vocab = Object.fromEntries(Object.entries(cfg.stages[type]).map(([k, s]) => [k, s.label]));
      return rows.length ? withVocabLabels(rows, type, vocab) : pipelinesFromConfig(cfg, type);
    };
    const [deal, lead] = await Promise.all([load("deal"), load("lead")]);
    const tenantId = demo ? "" : await repo.tenantOfWorkspace(active.ws.uuid);
    const custom = demo ? { deal: [], lead: [] } : { deal: await repo.listCustomFieldKeys(tenantId, "deal"), lead: await repo.listCustomFieldKeys(tenantId, "lead") };
    const v = vocabFor(active.tenant);
    return (
      <>
        {header}
        <PipelinesView
          demo={demo} pipelines={{ deal, lead }} custom={custom}
          nouns={{ deal: { one: v.n.deal.one, many: v.n.deal.many }, lead: { one: v.n.lead.one, many: v.n.lead.many } }}
          initialObject={sp.object === "lead" ? "lead" : "deal"} initialPipeline={sp.pipeline ?? null}
        />
      </>
    );
  } catch {
    return <>{header}<ErrorState source="Pipelines" message="The stages could not be loaded. Nothing was changed." retry={<Link href="/settings/pipelines"><Button>Retry</Button></Link>} /></>;
  }
}
