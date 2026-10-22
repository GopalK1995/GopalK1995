"use client";
// Pipeline stages for this workspace: rename, reorder (open stages only; Won and Lost stay last), probability,
// max days in stage, and the rules that keep Won/Lost honest. Owner and Sales Manager edit; S-rw support allowed.
import { useState, useTransition } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowDown, ArrowUp, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EASE } from "@/components/ui/motion";
import { toast } from "@/components/ui/toast";
import { useSession, useVocab } from "@/components/shell/providers";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import { savePipeline } from "./actions";

export type Stage = { key: string; label: string; probability: number; maxDays: number | null; terminal?: "won" | "lost" };
const inputCls = "h-8 rounded-sm border border-line-strong bg-surface px-2 text-[13px] text-ink outline-none focus:border-ring disabled:border-line disabled:bg-paper-2 disabled:text-ink-2";

export function PipelineTab({ initial, wsName }: { initial: Stage[]; wsName: string }) {
  const { role, support } = useSession();
  const st = useVocab().st, LOST_REASONS = st.lostList;
  const reduce = useReducedMotion();
  const editable = (role === "owner" || role === "sales_manager") && support?.mode !== "read_only";
  const [stages, setStages] = useState(initial);
  const [rules, setRules] = useState({ wonNeedsValue: true, lostNeedsReason: true });
  const [pending, start] = useTransition();
  const open = stages.filter((s) => !s.terminal), terminal = stages.filter((s) => s.terminal);
  const dirty = JSON.stringify(stages) !== JSON.stringify(initial);

  const move = (i: number, d: -1 | 1) => setStages((xs) => {
    const o = xs.filter((s) => !s.terminal), t = xs.filter((s) => s.terminal);
    const j = i + d; if (j < 0 || j >= o.length) return xs;
    [o[i], o[j]] = [o[j], o[i]];
    return [...o, ...t];
  });
  const patch = (key: string, p: Partial<Stage>) => setStages((xs) => xs.map((s) => (s.key === key ? { ...s, ...p } : s)));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <Card className="lg:col-span-8">
        <CardHeader title={`Stages · ${wsName}`} sub="Order is the order on the board. Probability weights the forecast."
          action={!editable ? <Badge tone="outline">{support?.mode === "read_only" ? "Read-only support session" : `Read only for ${ROLE_LABEL[role]}`}</Badge> : undefined} />
        <ol className="border-t border-line">
          {open.map((s, i) => (
            <motion.li key={s.key} layout={!reduce} transition={{ duration: 0.18, ease: EASE }} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3 sm:flex-nowrap sm:px-5">
              <span className="w-5 text-right text-[12px] font-medium text-ink-3 num">{i + 1}</span>
              <input aria-label={`Stage ${i + 1} name`} value={s.label} disabled={!editable} onChange={(e) => patch(s.key, { label: e.target.value })} className={cn(inputCls, "min-w-0 flex-1 basis-40")} />
              <label className="flex items-center gap-1.5 text-[12px] text-ink-3">
                <input aria-label={`${s.label} probability percent`} type="number" min={0} max={99} value={s.probability} disabled={!editable} onChange={(e) => patch(s.key, { probability: Math.max(0, Math.min(99, Number(e.target.value))) })} className={cn(inputCls, "w-16 text-right num")} />%
              </label>
              <label className="flex items-center gap-1.5 text-[12px] text-ink-3">
                <input aria-label={`${s.label} max days in stage`} type="number" min={1} max={180} value={s.maxDays ?? ""} disabled={!editable} onChange={(e) => patch(s.key, { maxDays: Number(e.target.value) || null })} className={cn(inputCls, "w-16 text-right num")} />days max
              </label>
              <span className="ml-auto flex gap-1">
                <Button size="icon" variant="ghost" aria-label={`Move ${s.label} up`} disabled={!editable || i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                <Button size="icon" variant="ghost" aria-label={`Move ${s.label} down`} disabled={!editable || i === open.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
              </span>
            </motion.li>
          ))}
          {terminal.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-paper/60 px-4 py-3 last:border-0 sm:px-5">
              <Lock className="size-3.5 w-5 text-ink-3" aria-hidden />
              <input aria-label={`${s.terminal} stage name`} value={s.label} disabled={!editable} onChange={(e) => patch(s.key, { label: e.target.value })} className={cn(inputCls, "min-w-0 flex-1 basis-40")} />
              <Badge tone={s.terminal === "won" ? "success" : "danger"}>{s.probability}% fixed</Badge>
              <span className="text-[12px] text-ink-3">Always last</span>
            </li>
          ))}
        </ol>
        <CardBody className="flex justify-end gap-2 pt-4">
          <Button variant="ghost" disabled={!editable || !dirty} onClick={() => setStages(initial)}>Discard</Button>
          <Button variant="primary" disabled={!editable || !dirty || pending} onClick={() => start(async () => { const r = await savePipeline(stages); toast(r.message, r.detail); })}>Save stages</Button>
        </CardBody>
      </Card>

      <Card className="lg:col-span-4">
        <CardHeader title="Won and lost rules" sub="Keep the forecast honest" />
        <CardBody className="flex flex-col gap-4">
          {([["wonNeedsValue", st.wonRule[0], st.wonRule[1]], ["lostNeedsReason", "Lost needs a reason", "Pick one of the lost reasons below."]] as const).map(([k, l, d]) => (
            <label key={k} className="flex items-start gap-2.5">
              <input type="checkbox" checked={rules[k]} disabled={!editable} onChange={(e) => { setRules((r) => ({ ...r, [k]: e.target.checked })); toast(`${l}: ${e.target.checked ? "on" : "off"}`); }} className="mt-0.5 size-4 accent-[var(--accent)]" />
              <span><span className="block text-[13px] font-medium text-ink">{l}</span><span className="text-[12px] text-ink-3">{d}</span></span>
            </label>
          ))}
          <div>
            <div className="eyebrow mb-2">Lost reasons</div>
            <ul className="flex flex-wrap gap-1.5">{LOST_REASONS.map((r) => <li key={r}><Badge tone="neutral">{r}</Badge></li>)}</ul>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
