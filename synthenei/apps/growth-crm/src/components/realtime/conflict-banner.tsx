"use client";
// Conflict banner with a field-level diff (their change vs yours) and a merge-or-discard choice. Visual language matches the
// pipeline board's "changed while you were working" banner. Conflicting fields need a pick (default: theirs, the safe side);
// fields only one side changed are applied automatically and listed so nothing is silent.
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Choice, Conflict, FieldDiff } from "@/lib/realtime/merge";
import { EN, fill, type RealtimeStrings } from "./strings";

const show = (v: unknown, empty: string) => (v == null || v === "" ? empty : typeof v === "object" ? JSON.stringify(v) : String(v));

export function ConflictBanner({ conflict, who, ago, fieldLabels = {}, onMerge, onDiscard, labels = EN }: {
  conflict: Conflict; who?: string | null; ago: string; fieldLabels?: Record<string, string>;
  onMerge: (choices: Record<string, Choice>) => void; onDiscard: () => void; labels?: RealtimeStrings;
}) {
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const title = who ? fill(labels.conflictTitle, { name: who, ago }) : fill(labels.conflictTitleUnknown, { ago });
  const pick = (d: FieldDiff, c: Choice) => setChoices((p) => ({ ...p, [d.field]: c }));
  return (
    <div role="alert" data-testid="conflict-banner" className="mb-3 rounded-control border px-3 py-2 text-[13px]" style={{ borderColor: "color-mix(in oklch, var(--warn) 50%, transparent)", background: "color-mix(in oklch, var(--warn) 12%, transparent)" }}>
      <p className="inline-flex items-start gap-2"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /><span><strong className="font-semibold">{title}</strong> <span className="text-ink-2">{labels.conflictBody}</span></span></p>
      <table className="mt-2 w-full text-left text-12" data-testid="conflict-diff">
        <thead className="text-ink-2"><tr><th className="py-1 pr-3 font-medium">{labels.colField}</th><th className="py-1 pr-3 font-medium">{labels.colTheirs}</th><th className="py-1 pr-3 font-medium">{labels.colMine}</th><th className="py-1 font-medium"><span className="sr-only">{labels.merge}</span></th></tr></thead>
        <tbody>
          {conflict.diffs.map((d) => (
            <tr key={d.field} data-field={d.field} data-kind={d.kind} className="border-t border-line align-top">
              <td className="py-1 pr-3 font-medium">{fieldLabels[d.field] ?? d.field}</td>
              <td className="num py-1 pr-3">{show(d.theirs, labels.empty)}</td>
              <td className="num py-1 pr-3">{show(d.mine, labels.empty)}</td>
              <td className="py-1">
                {d.kind === "conflict" ? (
                  <fieldset className="flex gap-3" aria-label={fieldLabels[d.field] ?? d.field}>
                    <label className="inline-flex items-center gap-1"><input type="radio" name={`c-${d.field}`} checked={(choices[d.field] ?? "theirs") === "theirs"} onChange={() => pick(d, "theirs")} />{labels.takeTheirs}</label>
                    <label className="inline-flex items-center gap-1"><input type="radio" name={`c-${d.field}`} checked={choices[d.field] === "mine"} onChange={() => pick(d, "mine")} />{labels.keepMine}</label>
                  </fieldset>
                ) : <span className="text-ink-2">{d.kind === "theirs-only" ? labels.autoTheirs : labels.autoMine}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex gap-2"><Button size="sm" variant="secondary" onClick={() => onMerge(choices)}>{labels.merge}</Button><Button size="sm" variant="ghost" onClick={onDiscard}>{labels.discard}</Button></div>
    </div>
  );
}
