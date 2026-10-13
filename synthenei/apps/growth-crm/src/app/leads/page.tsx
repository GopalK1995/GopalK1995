import LeadsTable from "@/components/LeadsTable";
import { PageHead, Mock } from "@/components/ui";
import { leads } from "@/data/leads";
import { campaigns } from "@/data/campaigns";
import { isBreached } from "@/lib/metrics";

export default function LeadsPage() {
  return (
    <>
      <PageHead title="Leads" sub="Every lead with source, stage, owner, response SLA and consent status. Fictional people." chips={<Mock />} />
      <LeadsTable leads={leads} campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))} breached={leads.filter(isBreached).map((l) => l.id)} />
    </>
  );
}
