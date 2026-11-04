"use client";
// Pipeline editor: pick an object (deals / leads) and a pipeline, then edit its stages: name, order, probability, colour,
// what the stage counts as, a time limit (SLA) and the fields a record must have before it enters the stage. Nothing is
// deleted: "Archive" hides a stage and is refused while records are in it. The whole list is saved at once; the server
// re-validates it and guards every stage with the version this page loaded.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Archive, ArrowDown, ArrowUp, Plus, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Segmented } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { STAGE_COLORS, type Outcome, type StageColor } from "@/lib/config/types";
import { REQUIRED_FIELD_CATALOGUE, reorderStages, validateStageInputs, type Pipeline, type PipelineObject, type StageInput } from "@/lib/metadata/pipelines";
import { cn } from "@/lib/utils";
import { archiveDealPipeline, createDealPipeline, renameDealPipeline, savePipelineStages } from "../actions";

type Noun = { one: string; many: string };
export interface PipelinesViewProps {
  demo: boolean; pipelines: Record<PipelineObject, Pipeline[]>; custom: Record<PipelineObject, { key: string; label: string }[]>;
  nouns: Record<PipelineObject, Noun>; initialObject: PipelineObject; initialPipeline: string | null;
}

const inputCls = "h-8 rounded-sm border border-line-strong bg-surface px-2 text-[13px] text-ink outline-none focus:border-ring disabled:border-line disabled:bg-paper-2 disabled:text-ink-2";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const OUTCOME_LABEL: Record<Outcome, string> = { open: "Open", won: "Counts as won", lost: "Counts as lost" };

const toInputs = (p: Pipeline): StageInput[] =>
  [...p.stages].sort((a, b) => Number(a.archived) - Number(b.archived) || a.position - b.position).map((s) => ({
    key: s.key, id: s.id, version: s.version, name: s.name.en, probability: s.probability, color: s.color, outcome: s.outcome, slaHours: s.slaHours, requiredFields: s.requiredFields, archived: s.archived,
  }));

export function PipelinesView(p: PipelinesViewProps) {
  const router = useRouter();
  const [object, setObject] = useState<PipelineObject>(p.initialObject);
  const list = p.pipelines[object];
  const [key, setKey] = useState<string | null>(p.initialPipeline);
  const current = list.find((x) => x.key === key) ?? list.find((x) => x.isDefault) ?? list[0];
  const [pending, start] = useTransition();
  const noun = p.nouns[object];

  const [draft, setDraft] = useState<StageInput[]>(() => (current ? toInputs(current) : []));
  const sig = current ? `${current.id}:${current.stages.map((s) => `${s.id}.${s.version}.${s.position}.${s.archived}`).join("|")}:${current.name.en}` : "";
  useEffect(() => { setDraft(current ? toInputs(current) : []); }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps -- reset when the server data for this pipeline changes
  const base = useMemo(() => (current ? JSON.stringify(toInputs(current)) : ""), [current]);
  const dirty = JSON.stringify(draft) !== base;
  const customKeys = p.custom[object].map((f) => f.key);
  const issues = useMemo(() => validateStageInputs(object, draft, { customKeys }), [object, draft, customKeys.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const live = draft.filter((s) => !s.archived), archived = draft.filter((s) => s.archived);
  const [newName, setNewName] = useState(""), [rename, setRename] = useState(current?.name.en ?? "");
  useEffect(() => { setRename(current?.name.en ?? ""); }, [current?.id, current?.name.en]);

  const patch = (i: number, q: Partial<StageInput>) => setDraft((xs) => xs.map((s, j) => (j === i ? { ...s, ...q } : s)));
  const indexOf = (s: StageInput) => draft.indexOf(s);
  const move = (s: StageInput, d: -1 | 1) => setDraft((xs) => reorderStages(xs, xs.filter((x) => !x.archived).indexOf(s), d));
  const add = () => setDraft((xs) => {
    const fresh: StageInput = { name: "", probability: 50, color: "neutral", outcome: "open", slaHours: null, requiredFields: [], archived: false };
    const at = xs.findIndex((s) => !s.archived && s.outcome !== "open");
    return at < 0 ? [...xs.filter((s) => !s.archived), fresh, ...xs.filter((s) => s.archived)] : [...xs.slice(0, at), fresh, ...xs.slice(at)];
  });
  const setOutcome = (i: number, o: Outcome) => patch(i, { outcome: o, ...(o === "won" ? { probability: 100 } : o === "lost" ? { probability: 0 } : {}) });
  const toggleField = (i: number, f: string) => setDraft((xs) => xs.map((s, j) => (j === i ? { ...s, requiredFields: s.requiredFields.includes(f) ? s.requiredFields.filter((x) => x !== f) : [...s.requiredFields, f] } : s)));

  const run = (fn: () => Promise<{ ok: boolean; message: string; sub?: string }>, after?: () => void) => start(async () => {
    const r = await fn();
    toast(r.message, r.sub ?? (r.ok ? "Saved." : "Nothing was changed."));
    if (r.ok) { after?.(); router.refresh(); }
  });
  const save = () => current && run(() => savePipelineStages({ objectType: object, pipelineKey: current.key, stages: draft }));
  const fieldOptions = [...REQUIRED_FIELD_CATALOGUE[object], ...p.custom[object].map((f) => ({ key: `custom.${f.key}`, label: f.label }))];
  const err = (i: number) => issues.filter((x) => x.path.startsWith(`stages.${i}.`)).map((x) => x.message);
  const general = issues.filter((x) => !/^stages\.\d+\./.test(x.path));

  const row = (s: StageInput, i: number, n: number) => (
    <li key={s.key ?? `new-${i}`} className={cn("border-b border-line px-4 py-3 sm:px-5", s.archived && "bg-paper/60")} data-testid="stage-row">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="w-5 text-right text-[12px] font-medium text-ink-3 num">{s.archived ? "–" : n + 1}</span>
        <input aria-label={`Stage ${n + 1} name`} value={s.name} maxLength={32} disabled={s.archived || pending} onChange={(e) => patch(i, { name: e.target.value })} className={cn(inputCls, "min-w-0 flex-1 basis-40")} placeholder="Stage name" />
        <select aria-label={`${s.name || "New stage"} counts as`} value={s.outcome} disabled={s.archived || pending || s.key === "won" || s.key === "lost"} onChange={(e) => setOutcome(i, e.target.value as Outcome)} className={cn(inputCls, "w-36")}>
          {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-[12px] text-ink-3">
          <input aria-label={`${s.name || "New stage"} probability percent`} type="number" min={0} max={100} value={s.probability} disabled={s.archived || pending || s.outcome !== "open"} onChange={(e) => patch(i, { probability: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })} className={cn(inputCls, "w-16 text-right num")} />%
        </label>
        <select aria-label={`${s.name || "New stage"} colour`} value={s.color} disabled={s.archived || pending} onChange={(e) => patch(i, { color: e.target.value as StageColor })} className={cn(inputCls, "w-24")}>
          {STAGE_COLORS.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-[12px] text-ink-3">
          <input aria-label={`${s.name || "New stage"} SLA hours`} type="number" min={1} max={8760} placeholder="none" value={s.slaHours ?? ""} disabled={s.archived || pending || s.outcome !== "open"} onChange={(e) => patch(i, { slaHours: e.target.value === "" ? null : Math.round(Number(e.target.value)) })} className={cn(inputCls, "w-20 text-right num")} />hours SLA
        </label>
        <span className="ml-auto flex gap-1">
          {!s.archived && <>
            <Button size="icon" variant="ghost" aria-label={`Move ${s.name || "new stage"} up`} disabled={pending || n === 0} onClick={() => move(s, -1)}><ArrowUp /></Button>
            <Button size="icon" variant="ghost" aria-label={`Move ${s.name || "new stage"} down`} disabled={pending || n === live.length - 1} onClick={() => move(s, 1)}><ArrowDown /></Button>
          </>}
          {s.id || s.archived ? (
            <Button size="icon" variant="ghost" aria-label={`${s.archived ? "Restore" : "Archive"} ${s.name}`} disabled={pending || (!s.archived && (s.key === "won" || s.key === "lost"))} onClick={() => patch(i, { archived: !s.archived })}>{s.archived ? <RotateCcw /> : <Archive />}</Button>
          ) : (
            <Button size="icon" variant="ghost" aria-label={`Remove new stage ${n + 1}`} disabled={pending} onClick={() => setDraft((xs) => xs.filter((_, j) => j !== i))}><Archive /></Button>
          )}
        </span>
      </div>
      {!s.archived && (
        <details className="mt-2 pl-8 text-[12px] text-ink-2">
          <summary className="cursor-pointer select-none text-ink-3">Required before a {noun.one} enters this stage{s.requiredFields.length ? `: ${s.requiredFields.length} field${s.requiredFields.length === 1 ? "" : "s"}` : ""}</summary>
          <fieldset className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
            <legend className="sr-only">Required fields for {s.name || "new stage"}</legend>
            {fieldOptions.map((f) => (
              <label key={f.key} className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={s.requiredFields.includes(f.key)} disabled={pending} onChange={() => toggleField(i, f.key)} className="size-4 accent-[var(--accent)]" />{f.label}
              </label>
            ))}
          </fieldset>
        </details>
      )}
      {err(i).length > 0 && <p role="alert" className="mt-1 pl-8 text-[12px] text-danger">{err(i)[0]}</p>}
    </li>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Record type" value={object} onChange={(o) => { setObject(o); setKey(null); }} options={[{ value: "deal", label: `${cap(p.nouns.deal.many)}` }, { value: "lead", label: `${cap(p.nouns.lead.many)}` }]} />
        {p.demo && <Badge tone="outline">Demo: kept in this browser</Badge>}
      </div>

      {object === "deal" && (
        <Card>
          <CardHeader title={`${cap(noun.one)} pipelines`} sub={`Each ${noun.one} belongs to one pipeline and moves through its stages.`} />
          <CardBody className="space-y-3">
            <div role="group" aria-label="Pipelines" className="flex flex-wrap gap-1.5">
              {list.map((x) => (
                <button key={x.key} type="button" aria-pressed={x.key === current?.key} onClick={() => setKey(x.key)}
                  className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring", x.key === current?.key ? "border-navy-900 bg-navy-900 text-navy-ink" : "border-line-strong bg-surface text-ink-2", x.archived && "opacity-60")}>
                  {x.name.en}{x.isDefault && <span className="text-[11px] opacity-75">default</span>}{x.archived && <span className="text-[11px] opacity-75">archived</span>}
                </button>
              ))}
            </div>
            <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (!newName.trim()) return; run(() => createDealPipeline({ name: newName }), () => setNewName("")); }}>
              <input aria-label="New pipeline name" value={newName} maxLength={40} disabled={pending} onChange={(e) => setNewName(e.target.value)} placeholder="New pipeline name" className={cn(inputCls, "w-56")} />
              <Button type="submit" variant="secondary" disabled={pending || !newName.trim()}><Plus />Add pipeline</Button>
            </form>
            {current && !current.isDefault && (
              <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (rename.trim() && rename.trim() !== current.name.en) run(() => renameDealPipeline({ key: current.key, name: rename })); }}>
                <input aria-label="Pipeline name" value={rename} maxLength={40} disabled={pending} onChange={(e) => setRename(e.target.value)} className={cn(inputCls, "w-56")} />
                <Button type="submit" variant="secondary" disabled={pending || !rename.trim() || rename.trim() === current.name.en}>Rename</Button>
                <Button type="button" variant="ghost" disabled={pending} onClick={() => run(() => archiveDealPipeline({ key: current.key, archived: !current.archived }))}>{current.archived ? "Restore pipeline" : "Archive pipeline"}</Button>
              </form>
            )}
          </CardBody>
        </Card>
      )}

      {current ? (
        <Card>
          <CardHeader title={`Stages · ${current.name.en}`} sub="Order is the order on the board. Probability weights the forecast. Won and Lost stages end a record." />
          <ol className="border-t border-line">
            {live.map((s, n) => row(s, indexOf(s), n))}
            {archived.map((s, n) => row(s, indexOf(s), n))}
          </ol>
          <CardBody className="space-y-3 pt-4">
            {general.length > 0 && <ul role="alert" className="space-y-1 text-[12px] text-danger">{general.map((g, i) => <li key={i}>{g.message}</li>)}</ul>}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="secondary" disabled={pending || draft.length >= 20} onClick={add}><Plus />Add stage</Button>
              <span className="flex gap-2">
                <Button variant="ghost" disabled={!dirty || pending} onClick={() => setDraft(toInputs(current))}>Discard</Button>
                <Button variant="primary" disabled={!dirty || pending || issues.length > 0} onClick={save}>Save stages</Button>
              </span>
            </div>
          </CardBody>
        </Card>
      ) : <p className="text-[13px] text-ink-3">No pipeline for this record type yet.</p>}
    </div>
  );
}
