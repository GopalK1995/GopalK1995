"use client";
// Stage-age tick row: one tick per day in the current stage, red past the stage limit (BUILD-PLAN 3.2).
// State is never colour alone: the day count and an accessible name always accompany the ticks.
import { stageAgeTicks } from "../_lib/stage-age";
import { fill, type PipelineLabels } from "../_lib/labels";

export function StageAgeTicks({ days, max, labels }: { days: number; max: number; labels: Pick<PipelineLabels, "ageTitle" | "ageOver" | "ageAria"> }) {
  const m = stageAgeTicks(days, max);
  const title = fill(m.over ? labels.ageOver : labels.ageTitle, { days: m.days, max: m.max });
  return (
    <span className="inline-flex items-center gap-1.5" title={title} data-testid="stage-age" data-over={m.over ? "true" : "false"}>
      <span role="img" aria-label={fill(labels.ageAria, { days: m.days, max: m.max })} className="inline-flex h-3 items-end gap-px">
        {m.ticks.map((t) => (
          <span key={t.index} data-tick={t.over ? "over" : "ok"} className="block h-2.5 w-[2px] rounded-bar" style={{ background: t.over ? "var(--danger)" : "var(--ink-3)" }} />
        ))}
        {m.overflow > 0 && <span className="ml-0.5 text-[12px] leading-none text-danger num">+{m.overflow}</span>}
      </span>
      <span className={m.over ? "text-[12px] font-medium text-danger num" : "text-[12px] text-ink-3 num"}>{m.days}d</span>
    </span>
  );
}
