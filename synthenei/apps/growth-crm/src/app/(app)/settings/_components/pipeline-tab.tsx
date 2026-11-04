"use client";
// Settings -> Pipeline stages: a read-only summary of the default pipeline and the way into the real editor at
// /settings/pipelines (add, rename, reorder, archive stages; probability, colour, outcome, SLA, required fields; more than
// one deal pipeline). The editor checks the pipelines.manage permission itself, so this tab stays a plain summary.
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useVocab } from "@/components/shell/providers";

export type Stage = { key: string; label: string; probability: number; maxDays: number | null; terminal?: "won" | "lost" };

export function PipelineTab({ initial, wsName }: { initial: Stage[]; wsName: string }) {
  const st = useVocab().st, LOST_REASONS = st.lostList;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <Card className="lg:col-span-8">
        <CardHeader title={`Stages · ${wsName}`} sub="Order is the order on the board. Probability weights the forecast."
          action={<Link href="/settings/pipelines" className="text-[13px] font-medium text-accent hover:underline">Edit pipelines</Link>} />
        <ol className="border-t border-line">
          {initial.map((s, i) => (
            <li key={s.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3 last:border-0 sm:px-5">
              <span className="w-5 text-right text-[12px] font-medium text-ink-3 num">{i + 1}</span>
              <span className="min-w-0 flex-1 basis-40 text-[13px] text-ink">{s.label}</span>
              {s.terminal ? <Badge tone={s.terminal === "won" ? "success" : "danger"}>{s.probability}% fixed</Badge> : <span className="text-[12px] text-ink-3 num">{s.probability}%</span>}
              {s.maxDays !== null && <span className="text-[12px] text-ink-3 num">{s.maxDays} days max</span>}
            </li>
          ))}
        </ol>
      </Card>
      <Card className="lg:col-span-4">
        <CardHeader title="Won and lost rules" sub="Keep the forecast honest" />
        <CardBody className="flex flex-col gap-4">
          <p className="text-[13px] text-ink-2">{st.wonRule[0]}. {st.wonRule[1]}</p>
          <div>
            <div className="eyebrow mb-2">Lost reasons</div>
            <ul className="flex flex-wrap gap-1.5">{LOST_REASONS.map((r) => <li key={r}><Badge tone="neutral">{r}</Badge></li>)}</ul>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
