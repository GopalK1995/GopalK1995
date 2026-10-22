"use client";
import { useState, useTransition } from "react";
import { Badge, StatusChip } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { Gated } from "../../accounts/_components/gated";
import type { Verdict } from "../../accounts/_components/perms";
import { toggleFeature } from "../actions";
import { useVocab } from "@/components/shell/providers";

export type Feature = { key: string; name: string; does: string; sends: string; where: string; status: "on" | "off" | "showcase"; lastRun: string; acceptance: string; note?: string };


function Switch({ on, label, onClick, disabled }: { on: boolean; label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={onClick} disabled={disabled}
      className={cn("relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors duration-150 disabled:opacity-50", on ? "border-accent bg-accent" : "border-line-strong bg-paper-2")}>
      <span className={cn("absolute left-0.5 size-[18px] rounded-full bg-surface shadow-1 transition-transform duration-150 ease-out", on && "translate-x-4")} />
    </button>
  );
}

export function FeatureCards({ features, toggle }: { features: Feature[]; toggle: Verdict }) {
  const TERMS = useVocab().ai.terms;
  const [state, setState] = useState<Record<string, boolean>>(() => Object.fromEntries(features.map((f) => [f.key, f.status === "on"])));
  const [asking, setAsking] = useState<Feature | null>(null);
  const [ticks, setTicks] = useState<boolean[]>([false, false, false]);
  const [pending, start] = useTransition();
  const commit = (f: Feature, on: boolean, terms: string[]) => start(async () => {
    const r = await toggleFeature(f.name, on, terms);
    toast(r.message, r.sub);
    if (r.ok) { setState((s) => ({ ...s, [f.key]: on })); setAsking(null); }
  });

  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {features.map((f) => {
          const on = state[f.key];
          return (
            <li key={f.key} className="flex flex-col rounded-md border border-line bg-surface p-4 shadow-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[14px] font-semibold text-ink">{f.name}</h3>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {on ? <Badge tone="success">On</Badge> : <Badge tone="outline">Off</Badge>}
                    {f.status === "showcase" && <StatusChip status="showcase" label="Showcase: sample outputs" />}
                  </div>
                </div>
                <Gated v={toggle}><Switch on={on} label={`${f.name}: ${on ? "on" : "off"}`} disabled={pending} onClick={() => (on ? commit(f, false, []) : (setTicks([false, false, false]), setAsking(f)))} /></Gated>
              </div>
              <p className="mt-2 text-[13px] leading-5 text-ink-2">{f.does}</p>
              <dl className="mt-3 grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 border-t border-line pt-3 text-[12px]">
                <dt className="text-ink-3">Sends</dt><dd className="text-ink">{f.sends}</dd>
                <dt className="text-ink-3">Shows in</dt><dd className="text-ink">{f.where}</dd>
                <dt className="text-ink-3">Last run</dt><dd className="text-ink num">{f.lastRun}</dd>
                <dt className="text-ink-3">Accepted</dt><dd className="text-ink num">{f.acceptance} <span className="font-mono text-[10px] text-ink-3">M52</span></dd>
              </dl>
              {f.note && <p className="mt-2 text-[11px] text-ink-3">{f.note}</p>}
            </li>
          );
        })}
      </ul>
      <Dialog open={!!asking} onOpenChange={(o) => !o && setAsking(null)}>
        {asking && (
          <DialogContent title={`Turn on ${asking.name}?`} description="First enable for this workspace. Tick each check; the Owner's answers are audit-logged.">
            <ul className="space-y-2.5">
              {TERMS.map((t, i) => (
                <li key={t}><label className="flex items-start gap-2.5 text-[13px] leading-5 text-ink">
                  <input type="checkbox" checked={ticks[i]} onChange={(e) => setTicks((x) => x.map((v, j) => (j === i ? e.target.checked : v)))} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />{t}
                </label></li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] text-ink-3">Outputs stay drafts: a person accepts, edits or dismisses each one. Phone numbers and email addresses are never sent.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAsking(null)}>Cancel</Button>
              <Button variant="primary" disabled={!ticks.every(Boolean) || pending} onClick={() => commit(asking, true, TERMS.filter((_, i) => ticks[i]))}>Turn on</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
