"use client";
// Horizontal pill tablist (WAI-ARIA tabs, manual layout): roving tabindex, arrow keys / Home / End move and activate.
// The single tabpanel lives with the caller; only the selected tab carries aria-controls (the panel id) because the
// other panels are not rendered.
import { useRef } from "react";
import { cn } from "@/lib/utils";
import { rovingTarget } from "./roving";

export function StageTabs({ label, tabs, value, onChange, panelId, idPrefix = "stage-tab" }: {
  label: string; tabs: { value: string; label: string; count: number }[]; value: string; onChange: (v: string) => void; panelId: string; idPrefix?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="tablist" aria-label={label} className="scrollbar-thin -mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4">
      {tabs.map((t, i) => {
        const on = t.value === value;
        return (
          <button key={t.value} type="button" role="tab" id={`${idPrefix}-${t.value}`} aria-selected={on} aria-controls={on ? panelId : undefined} tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={(e) => { const j = rovingTarget(e.key, i, tabs.length); if (j < 0) return; e.preventDefault(); onChange(tabs[j].value); refs.current[j]?.focus(); }}
            ref={(el) => { refs.current[i] = el; if (el && on) el.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }}
            className={cn("inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "border-navy-900 bg-navy-900 text-navy-ink" : "border-line-strong bg-surface text-ink-2")}>
            {t.label}<span className="num text-[12px] opacity-75" aria-hidden>{t.count}</span><span className="sr-only">{`, ${t.count}`}</span>
          </button>
        );
      })}
    </div>
  );
}
