import PipelineBoard from "@/components/PipelineBoard";
import { Card, HBars, Mock, PageHead } from "@/components/ui";
import { leads } from "@/data/leads";
import { pct, ratio } from "@/lib/format";

export default function PipelinePage() {
  const reached = (i: number) => leads.filter((l) => l.maxStageIdx >= i).length;
  const steps = [["New → Contacted", 0, 1], ["Contacted → Demo booked", 1, 2], ["Demo booked → Demo done", 2, 3], ["Demo done → Won", 3, 5]] as const;
  return (
    <>
      <PageHead title="Pipeline" sub="Stages from new lead to won. Conversion strip uses the furthest stage each lead reached." chips={<Mock />} />
      <div style={{ marginBottom: 16 }}>
        <Card title="Stage-to-stage conversion" sub="Leads that reached stage B / leads that reached stage A">
          <HBars rows={steps.map(([label, a, b]) => ({ label, value: ratio(reached(b), reached(a)) * 100 || 0, max: 100, right: `${pct(ratio(reached(b), reached(a)), 0)} (${reached(b)}/${reached(a)})` }))} />
        </Card>
      </div>
      <PipelineBoard leads={leads} />
    </>
  );
}
